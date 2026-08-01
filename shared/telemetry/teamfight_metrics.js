import { HERO_BY_ID } from '../data/heroes.js';
import {
  selectPressureAnchor,
  selectRecoveryProvider,
} from '../rules/team_capabilities.js';

const TEAMS = Object.freeze([0, 1]);
const ROLES = Object.freeze(['frontline', 'damage', 'support']);
const ACTIVITY_EVENTS = new Set([
  'shot',
  'hit',
  'heal',
  'barrier_hit',
  'ability_used',
  'ultimate_used',
  'kill',
]);
// A shot attempt is not proof of contact: healing primaries emit the same
// event while aiming at allies during regroup.  Only authoritative damage,
// barrier contact, and kills are allowed to start or extend a fight clock.
const HOSTILE_EVENTS = new Set(['hit', 'barrier_hit', 'kill']);

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round((Number(value) || 0) * scale) / scale;
}

function distance3d(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return Infinity;
  const dimensions = Math.max(a.length, b.length);
  if (dimensions < 2) return Infinity;
  const deltas = [];
  for (let index = 0; index < dimensions; index++) {
    const left = Number(a[index] ?? 0);
    const right = Number(b[index] ?? 0);
    if (!Number.isFinite(left) || !Number.isFinite(right)) return Infinity;
    deltas.push(left - right);
  }
  return Math.hypot(...deltas);
}

function heroForPlayer(player, heroById = HERO_BY_ID) {
  if (heroById instanceof Map) return heroById.get(player?.heroId);
  return heroById?.[player?.heroId];
}

function playerRole(player, heroById = HERO_BY_ID) {
  return player?.role || heroForPlayer(player, heroById)?.role || 'unknown';
}

function effectiveRouteName(controller) {
  return controller?.activeRouteName?.() || controller?.route || null;
}

function snapshotPlayers(source, heroById = HERO_BY_ID) {
  const values = source?.players instanceof Map
    ? [...source.players.values()]
    : Array.isArray(source?.players)
      ? source.players
      : [];
  return values.map(player => ({
    id: player.id,
    team: player.team,
    heroId: player.heroId,
    role: playerRole(player, heroById),
    alive: !!player.alive,
    insideObjective: !!player.insideObjective,
    flags: { ...(player.flags || {}) },
    pos: [...(player.pos || player.move?.pos || [])],
    input: { ...(player.input || player.inputCommandState || {}) },
  }));
}

function snapshotBarriers(source) {
  const values = source?.barriers instanceof Map
    ? [...source.barriers.values()]
    : Array.isArray(source?.barriers)
      ? source.barriers
      : [];
  return values.map(barrier => ({ ...barrier }));
}

function snapshotFlowState(source) {
  return source?.flowState || source?.flow?.state || null;
}

export function captureTeamfightSnapshot(world) {
  return {
    flowState: snapshotFlowState(world),
    players: snapshotPlayers(world),
    barriers: snapshotBarriers(world),
  };
}

export function heroProvidesSustain(hero) {
  return hero?.role === 'support' && hero.teamFunctions?.includes('continuous_sustain');
}

function makeRoleSets() {
  return {
    frontline: new Set(),
    damage: new Set(),
    support: new Set(),
    unknown: new Set(),
  };
}

function makeRoleCounts() {
  return { frontline: 0, damage: 0, support: 0, unknown: 0 };
}

function makeOffensiveEventCounts() {
  return { shots: 0, hostileContacts: 0, damage: 0 };
}

function summarizeOffensiveEventCounts(counts) {
  const summary = {
    shots: counts?.shots || 0,
    hostileContacts: counts?.hostileContacts || 0,
    damage: round(counts?.damage || 0, 1),
  };
  return {
    ...summary,
    total: summary.shots + summary.hostileContacts,
  };
}

function summarizeOffensiveEvents(events) {
  const during = summarizeOffensiveEventCounts(events?.duringAnchorEngaged);
  const outside = summarizeOffensiveEventCounts(events?.outsideAnchorEngaged);
  return {
    duringAnchorEngaged: during,
    outsideAnchorEngaged: outside,
    // Compatibility names remain available while the runtime duty is
    // capability-based and may be held by a damage hero.
    duringTankEngaged: { ...during },
    outsideTankEngaged: { ...outside },
  };
}

function eventActorId(event) {
  return event?.source || event?.player || null;
}

function validHostileEvent(event, byId, barriersById) {
  if (!HOSTILE_EVENTS.has(event?.type)) return false;
  const actor = byId.get(eventActorId(event));
  if (!actor || !TEAMS.includes(actor.team)) return false;
  if (event.type === 'barrier_hit') {
    const amount = Number(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const barrier = barriersById.get(event.barrier);
    if (!barrier) return false;
    const owner = byId.get(barrier.ownerId);
    const explicitTeam = TEAMS.includes(barrier.team) ? barrier.team : null;
    const ownerTeam = TEAMS.includes(owner?.team) ? owner.team : null;
    if (explicitTeam !== null && ownerTeam !== null && explicitTeam !== ownerTeam) return false;
    const targetTeam = explicitTeam ?? ownerTeam;
    return targetTeam !== null && targetTeam !== actor.team;
  }
  const target = byId.get(event.target);
  if (!target || !TEAMS.includes(target.team) || target.team === actor.team) return false;
  if (event.type === 'hit') {
    const amount = Number(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) return false;
  }
  return true;
}

function validActivityEvent(event, byId, barriersById) {
  if (!ACTIVITY_EVENTS.has(event?.type)) return false;
  const actor = byId.get(eventActorId(event));
  if (!actor || !TEAMS.includes(actor.team)) return false;
  if (HOSTILE_EVENTS.has(event.type)) {
    return validHostileEvent(event, byId, barriersById);
  }
  if (event.type === 'heal') {
    const target = byId.get(event.target);
    const amount = Number(event.amount);
    return !!target
      && actor.alive
      && target.alive
      && target.team === actor.team
      && Number.isFinite(amount)
      && amount > 0;
  }
  return actor.alive;
}

function effectiveObjectiveOccupants(players) {
  return TEAMS.map(team => players.filter(player => (
    player.team === team
    && player.alive
    && player.insideObjective
    && !player.flags?.invulnerable
    && !player.flags?.intangible
  )));
}

function teamClusterCount(players, team, radiusM) {
  const alive = players.filter(player => player.alive && player.team === team);
  let best = 0;
  for (const center of alive) {
    const count = alive.filter(player => distance3d(player.pos, center.pos) <= radiusM).length;
    best = Math.max(best, count);
  }
  return best;
}

function measureTeamState(
  players,
  center,
  nearObjectiveM,
  regroupClusterM,
  heroById = HERO_BY_ID,
  frontlinePreferenceM = 6,
) {
  const occupants = effectiveObjectiveOccupants(players);
  const presence = occupants.map(team => team.length);
  const alive = TEAMS.map(team => players.filter(player => player.team === team && player.alive).length);
  const near = TEAMS.map(team => players.filter(player => (
    player.team === team
    && player.alive
    && !player.flags?.invulnerable
    && !player.flags?.intangible
    && distance3d(player.pos, center) <= nearObjectiveM
  )).length);
  const clusters = TEAMS.map(team => teamClusterCount(players, team, regroupClusterM));
  const teamPlayers = TEAMS.map(team => players.filter(player => player.team === team));
  const pressureAnchors = teamPlayers.map(team => selectPressureAnchor(team, center, {
    heroById,
    frontlinePreferenceM,
  }));
  const pressureAnchorNear = pressureAnchors.map(player => !!player
    && distance3d(player.pos, center) <= nearObjectiveM);
  const recoveryProviders = teamPlayers.map((team, index) => selectRecoveryProvider(
    team,
    pressureAnchors[index],
    { heroById },
  ));
  const recoveryProviderAlive = recoveryProviders.map(player => !!player);
  const recoveryProviderClustered = recoveryProviders.map((player, index) => !!player
    && !!pressureAnchors[index]
    && distance3d(player.pos, pressureAnchors[index].pos) <= regroupClusterM);
  const readiness = TEAMS.map(team => ({
    alive: alive[team],
    nearObjective: near[team],
    clustered: clusters[team],
    pressureAnchorAlive: !!pressureAnchors[team],
    pressureAnchorNearObjective: pressureAnchorNear[team],
    recoveryProviderAlive: recoveryProviderAlive[team],
    recoveryProviderClustered: recoveryProviderClustered[team],
    // Compatibility aliases now describe the dynamically selected tactical
    // capabilities rather than a fixed role slot.
    frontlineAlive: !!pressureAnchors[team],
    frontlineNearObjective: pressureAnchorNear[team],
    sustainSupportAlive: recoveryProviderAlive[team],
    sustainSupportClustered: recoveryProviderClustered[team],
  }));
  const fullPressureAnchorContest = near[0] >= 3
    && near[1] >= 3
    && pressureAnchorNear[0]
    && pressureAnchorNear[1];
  return {
    occupants,
    presence,
    alive,
    near,
    clusters,
    pressureAnchors,
    pressureAnchorNear,
    recoveryProviders,
    recoveryProviderAlive,
    recoveryProviderClustered,
    frontlines: pressureAnchors,
    frontlineNear: pressureAnchorNear,
    sustainAlive: recoveryProviderAlive,
    sustainClustered: recoveryProviderClustered,
    readiness,
    fullPressureAnchorContest,
    fullFrontlineContest: fullPressureAnchorContest,
  };
}

function killSignature(event) {
  return [
    eventActorId(event),
    event?.target,
    event?.abilityId,
    event?.cause,
    event?.environment,
  ].map(value => value ?? '').join('|');
}

function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function serializeRoleSets(roleSets) {
  return Object.fromEntries(Object.entries(roleSets).map(([role, ids]) => [role, [...ids].sort()]));
}

function fullRoleParticipation(roleSets) {
  return ROLES.every(role => roleSets[role].size > 0);
}

export class TeamfightMetrics {
  constructor({
    nearObjectiveM = 18,
    regroupClusterM = 14,
    engagementGapSec = 3,
    healWindowGapSec = 3,
    timelineIntervalSec = 1,
    heroById = HERO_BY_ID,
    frontlinePreferenceM = 6,
  } = {}) {
    this.nearObjectiveM = nearObjectiveM;
    this.regroupClusterM = regroupClusterM;
    this.engagementGapSec = engagementGapSec;
    this.healWindowGapSec = healWindowGapSec;
    this.timelineIntervalSec = timelineIntervalSec;
    this.heroById = heroById;
    this.frontlinePreferenceM = frontlinePreferenceM;

    this.durationSec = 0;
    this.timeline = [];
    this.nextTimelineAt = 0;
    this.events = [];
    this.combatTotals = {
      killsByTeam: [0, 0],
      deathsByTeam: [0, 0],
    };
    this.killAttributions = [];
    this.nextKillId = 1;
    this.pressureAnchorHealing = new Map();
    this.frontlineHealing = this.pressureAnchorHealing;
    this.engagements = [];
    this.activeEngagement = null;
    this.nextEngagementId = 1;
    this.lastObservationAt = null;
    this.observationIntegrity = {
      accepted: 0,
      preTickSnapshotsAccepted: 0,
      duplicateRejected: 0,
      reverseOrderRejected: 0,
      duplicateKillsRejected: 0,
    };
    this.lastModes = new Map();
    this.regroupExits = [];
    this.fightEntries = [];
    this.roundStarts = new Map();
    this.roundDurations = [];
    this.dps = new Map();
    this.twoSidedNearObjectiveSec = 0;
    this.pressureAnchorNearObjectiveSec = [0, 0];
    this.frontlineNearObjectiveSec = this.pressureAnchorNearObjectiveSec;
    this.aliveSec = [0, 0];
    this.nearObjectiveSec = [0, 0];
  }

  observe({
    world,
    preTickSnapshot = null,
    controllers = [],
    events = [],
    dt = world?.dt || 0,
  }) {
    const parsedTime = Number(world?.t);
    const t = Number.isFinite(parsedTime) ? parsedTime : 0;
    if (this.lastObservationAt !== null && t <= this.lastObservationAt) {
      if (t === this.lastObservationAt) this.observationIntegrity.duplicateRejected++;
      else this.observationIntegrity.reverseOrderRejected++;
      return false;
    }
    this.lastObservationAt = t;
    this.observationIntegrity.accepted++;
    if (preTickSnapshot) this.observationIntegrity.preTickSnapshotsAccepted++;

    const parsedStep = Number(dt);
    const stepSec = Number.isFinite(parsedStep) && parsedStep > 0 ? parsedStep : 0;
    const center = world.map.objective.center;
    const controllerById = new Map(controllers.map(controller => [controller.pl.id, controller]));
    const players = snapshotPlayers(world, this.heroById);
    const state = measureTeamState(
      players,
      center,
      this.nearObjectiveM,
      this.regroupClusterM,
      this.heroById,
      this.frontlinePreferenceM,
    );
    const eventPlayers = preTickSnapshot
      ? snapshotPlayers(preTickSnapshot, this.heroById)
      : players;
    const eventState = preTickSnapshot
      ? measureTeamState(
        eventPlayers,
        center,
        this.nearObjectiveM,
        this.regroupClusterM,
        this.heroById,
        this.frontlinePreferenceM,
      )
      : state;
    const eventById = new Map(eventPlayers.map(player => [player.id, player]));
    const barriersById = new Map([
      ...snapshotBarriers(world).map(barrier => [barrier.id, barrier]),
      ...snapshotBarriers(preTickSnapshot).map(barrier => [barrier.id, barrier]),
    ]);
    const postFlowState = snapshotFlowState(world);
    const eventFlowState = preTickSnapshot
      ? snapshotFlowState(preTickSnapshot)
      : postFlowState;
    const {
      occupants,
      presence,
      alive,
      near,
      clusters,
      pressureAnchors,
      pressureAnchorNear,
      recoveryProviders,
      recoveryProviderAlive,
      frontlines,
      frontlineNear,
      sustainAlive,
      sustainClustered,
      readiness: teamReadiness,
      fullFrontlineContest,
    } = state;
    const modes = Object.fromEntries(controllers.map(controller => [controller.pl.id, controller.mode]));

    for (const pressureAnchor of [...pressureAnchors, ...eventState.pressureAnchors]) {
      if (!pressureAnchor || this.pressureAnchorHealing.has(pressureAnchor.id)) continue;
      this.pressureAnchorHealing.set(pressureAnchor.id, {
        playerId: pressureAnchor.id,
        team: pressureAnchor.team,
        heroId: pressureAnchor.heroId,
        amount: 0,
        windows: [],
        lastHealAt: null,
        atFrontAmount: 0,
        atFrontWindows: [],
        lastFrontHealAt: null,
      });
    }

    this.durationSec += stepSec;
    for (const team of TEAMS) {
      if (alive[team] > 0) this.aliveSec[team] += stepSec;
      if (eventFlowState === 'ACTIVE' && near[team] > 0) {
        this.nearObjectiveSec[team] += stepSec;
      }
      if (eventFlowState === 'ACTIVE' && pressureAnchorNear[team]) {
        this.pressureAnchorNearObjectiveSec[team] += stepSec;
      }
    }
    if (eventFlowState === 'ACTIVE' && fullFrontlineContest) {
      this.twoSidedNearObjectiveSec += stepSec;
    }

    this.observeModeTransitions(controllers, teamReadiness, t, eventFlowState);
    const dpsTickState = this.observeDps(
      players,
      controllerById,
      pressureAnchors,
      pressureAnchorNear,
      stepSec,
    );
    this.observeEvents({
      events,
      t,
      dt: stepSec,
      byId: eventById,
      barriersById,
      teamReadiness,
      startTeamReadiness: eventState.readiness,
      startRosterSizes: TEAMS.map(team => eventPlayers.filter(player => player.team === team).length),
      eventPressureAnchors: eventState.pressureAnchors,
      fullFrontlineContest,
      dpsTickState,
      eventFlowState,
      postFlowState,
      objectiveCenter: center,
    });

    if (t + 1e-9 >= this.nextTimelineAt) {
      this.timeline.push({
        t: round(t),
        presence: [...presence],
        occupants: occupants.map(team => team.map(player => player.id)),
        alive: [...alive],
        near: [...near],
        clustered: [...clusters],
        pressureAnchorIds: pressureAnchors.map(player => player?.id || null),
        recoveryProviderIds: recoveryProviders.map(player => player?.id || null),
        pressureAnchorNear: [...pressureAnchorNear],
        recoveryProviderAlive: [...recoveryProviderAlive],
        frontlineNear: [...frontlineNear],
        sustainAlive: [...sustainAlive],
        modes,
      });
      while (this.nextTimelineAt <= t + 1e-9) this.nextTimelineAt += this.timelineIntervalSec;
    }
    return true;
  }

  observeModeTransitions(controllers, readiness, t, flowState) {
    for (const controller of controllers) {
      const previous = this.lastModes.get(controller.pl.id);
      const current = controller.mode;
      const team = controller.pl.team;
      if (previous === 'regroup' && current !== 'regroup') {
        const state = readiness[team];
        const ready = state.alive >= 4
          && state.clustered >= 3
          && state.frontlineAlive
          && state.sustainSupportAlive;
        this.regroupExits.push({
          t: round(t),
          playerId: controller.pl.id,
          team,
          nextMode: current,
          ...state,
          ready,
          staggered: flowState === 'ACTIVE' && !ready,
        });
      }
      if (previous && previous !== 'fight' && current === 'fight') {
        const state = readiness[team];
        const ready = state.alive >= 4
          && state.nearObjective >= 3
          && state.frontlineAlive
          && state.sustainSupportAlive;
        this.fightEntries.push({
          t: round(t),
          playerId: controller.pl.id,
          team,
          ...state,
          ready,
          staggered: !ready,
        });
      }
      this.lastModes.set(controller.pl.id, current);
    }
  }

  observeDps(players, controllerById, pressureAnchors, pressureAnchorNear, dt) {
    const stateById = new Map();
    for (const team of TEAMS) {
      const anchor = pressureAnchors[team];
      const anchorMode = anchor ? controllerById.get(anchor.id)?.mode : null;
      const anchorEngaged = !!anchor
        && pressureAnchorNear[team]
        && (anchorMode === 'fight' || anchorMode === 'hold');
      for (const player of players.filter(candidate => (
        candidate.team === team && candidate.role === 'damage'
      ))) {
        const controller = controllerById.get(player.id);
        const route = effectiveRouteName(controller) === 'front' ? 'front' : 'side';
        const moving = player.alive && !!(
          player.input.f
          || player.input.b
          || player.input.l
          || player.input.r
        );
        const record = this.dps.get(player.id) || {
          playerId: player.id,
          team,
          heroId: player.heroId,
          activeSec: { front: 0, side: 0 },
          duringAnchorEngagedSec: { front: 0, side: 0 },
          outsideAnchorEngagedSec: { front: 0, side: 0 },
          combatEvents: { duringAnchorEngaged: 0, outsideAnchorEngaged: 0 },
          offensiveEvents: {
            duringAnchorEngaged: makeOffensiveEventCounts(),
            outsideAnchorEngaged: makeOffensiveEventCounts(),
          },
        };
        if (moving) {
          record.activeSec[route] += dt;
          const bucket = anchorEngaged
            ? record.duringAnchorEngagedSec
            : record.outsideAnchorEngagedSec;
          bucket[route] += dt;
        }
        this.dps.set(player.id, record);
        stateById.set(player.id, { anchorEngaged, route });
      }
    }
    return stateById;
  }

  observeEvents({
    events,
    t,
    dt,
    byId,
    barriersById,
    teamReadiness,
    startTeamReadiness,
    startRosterSizes,
    eventPressureAnchors,
    fullFrontlineContest,
    dpsTickState,
    eventFlowState,
    postFlowState,
    objectiveCenter,
  }) {
    const seenKills = new Set();
    const metricEvents = [];
    for (const event of events) {
      this.events.push({ t, ...event });
      this.observeRoundEvent(event, t);
      if (event.type === 'heal') {
        this.observePressureAnchorHeal(
          event,
          t,
          byId,
          eventPressureAnchors,
          objectiveCenter,
          eventFlowState,
        );
      }
      if (event.type === 'kill') {
        const signature = killSignature(event);
        if (seenKills.has(signature)) {
          this.observationIntegrity.duplicateKillsRejected++;
          continue;
        }
        seenKills.add(signature);
      }
      metricEvents.push(event);
    }

    const activity = eventFlowState === 'ACTIVE'
      ? metricEvents.filter(event => validActivityEvent(event, byId, barriersById))
      : [];
    const hasHostileEvent = activity.some(event => validHostileEvent(event, byId, barriersById));
    const fullRosterCasualty = TEAMS.some(team => (
      startRosterSizes[team] >= 5 && startTeamReadiness[team].alive < startRosterSizes[team]
    ));
    const jointFront = startTeamReadiness.every(team => (
      team.alive >= 2 && team.pressureAnchorAlive && team.pressureAnchorNearObjective
    ));
    const gapExpired = this.activeEngagement
      && t - this.activeEngagement.lastHostileAt > this.engagementGapSec;
    if (gapExpired && hasHostileEvent) {
      this.finishEngagement('inactivity', t);
    }
    if (eventFlowState === 'ACTIVE'
      && !this.activeEngagement
      && !fullRosterCasualty
      && hasHostileEvent
      && jointFront) {
      this.activeEngagement = {
        engagementId: `engagement-${this.nextEngagementId++}`,
        start: t,
        lastHostileAt: t,
        eventCount: 0,
        hostileEventsByTeam: [0, 0],
        abilityParticipationByTeam: [{}, {}],
        primaryEventsByTeam: [0, 0],
        roleEventCountsByTeam: [makeRoleCounts(), makeRoleCounts()],
        roleParticipantsByTeam: [makeRoleSets(), makeRoleSets()],
        killsByTeam: [0, 0],
        deathsByTeam: [0, 0],
        firstCasualtyAt: null,
        fullFrontlineContestSec: 0,
      };
    }

    for (const event of metricEvents) {
      const validActivity = eventFlowState === 'ACTIVE'
        && validActivityEvent(event, byId, barriersById);
      const validHostile = validActivity && validHostileEvent(event, byId, barriersById);
      if (event.type === 'kill' && validHostile) {
        const source = byId.get(eventActorId(event));
        const target = byId.get(event.target);
        const engagementId = this.activeEngagement?.engagementId || null;
        const outsideReason = engagementId
          ? null
          : fullRosterCasualty
            ? 'pre_event_roster_incomplete'
            : !jointFront
              ? 'joint_front_not_ready'
              : 'engagement_not_open';
        this.killAttributions.push({
          killId: `kill-${this.nextKillId++}`,
          t: round(t),
          source: eventActorId(event),
          target: event.target,
          sourceTeam: source.team,
          targetTeam: target.team,
          engagementId,
          outsideReason,
        });
        this.combatTotals.killsByTeam[source.team]++;
        this.combatTotals.deathsByTeam[target.team]++;
      }
      if (!this.activeEngagement || !validActivity) continue;

      // Only hostile contact keeps a fight open.  Ability setup and regroup
      // healing still count toward role participation, but cannot manufacture
      // a longer fight after both teams have stopped exchanging damage.
      if (validHostile) this.activeEngagement.lastHostileAt = t;
      this.activeEngagement.eventCount++;
      const actorId = eventActorId(event);
      const actor = byId.get(actorId);
      const fallbackTarget = byId.get(event.target);
      const team = actor?.team ?? (event.type === 'heal' ? fallbackTarget?.team : undefined);
      if (team !== 0 && team !== 1) continue;
      const role = ROLES.includes(actor?.role) ? actor.role : 'unknown';
      this.activeEngagement.roleEventCountsByTeam[team][role]++;
      if (actorId) this.activeEngagement.roleParticipantsByTeam[team][role].add(actorId);
      if (validHostile) this.activeEngagement.hostileEventsByTeam[team]++;
      if (event.type === 'shot') this.activeEngagement.primaryEventsByTeam[team]++;
      if (event.type === 'ability_used' || event.type === 'ultimate_used') {
        const slot = event.slot || (event.type === 'ultimate_used' ? 'ultimate' : event.abilityId);
        const bucket = this.activeEngagement.abilityParticipationByTeam[team];
        bucket[slot] = (bucket[slot] || 0) + 1;
      }
      if (event.type === 'kill') {
        if (this.activeEngagement.firstCasualtyAt === null) {
          this.activeEngagement.firstCasualtyAt = t;
        }
        this.activeEngagement.killsByTeam[team]++;
        const target = byId.get(event.target);
        if (target?.team === 0 || target?.team === 1) {
          this.activeEngagement.deathsByTeam[target.team]++;
        }
      }
      const dpsState = dpsTickState.get(actorId);
      if (actor?.role === 'damage' && dpsState) {
        const record = this.dps.get(actorId);
        const key = dpsState.anchorEngaged
          ? 'duringAnchorEngaged'
          : 'outsideAnchorEngaged';
        record.combatEvents[key]++;
        const offensive = record.offensiveEvents[key];
        if (event.type === 'shot') offensive.shots++;
        if (validHostile) {
          offensive.hostileContacts++;
          if (event.type === 'hit' || event.type === 'barrier_hit') {
            offensive.damage += Number(event.amount) || 0;
          }
        }
      }
    }

    if (this.activeEngagement && eventFlowState === 'ACTIVE' && fullFrontlineContest) {
      const intervalStart = t - dt;
      const contestSec = Math.max(0, t - Math.max(intervalStart, this.activeEngagement.start));
      this.activeEngagement.fullFrontlineContestSec += contestSec;
    }

    if (this.activeEngagement) {
      const reason = postFlowState !== 'ACTIVE'
        ? 'state_change'
        : teamReadiness.some(team => team.alive === 0)
          ? 'team_wipe'
          : t - this.activeEngagement.lastHostileAt > this.engagementGapSec
            ? 'inactivity'
            : null;
      if (reason) this.finishEngagement(reason, t);
    }
  }

  observeRoundEvent(event, t) {
    if (event.type === 'round_active') {
      this.roundStarts.set(event.round, t);
      return;
    }
    if (event.type !== 'round_end') return;
    const start = this.roundStarts.get(event.round);
    if (start === undefined) return;
    this.roundDurations.push({
      round: event.round,
      winner: event.winner,
      durationSec: round(t - start),
    });
    this.roundStarts.delete(event.round);
  }

  observePressureAnchorHeal(event, t, byId, pressureAnchors, objectiveCenter, flowState) {
    if (flowState !== 'ACTIVE') return;
    const target = byId.get(event.target);
    const source = byId.get(event.source);
    if (!target
      || !source
      || !target.alive
      || !source.alive
      || !TEAMS.includes(target.team)
      || source.team !== target.team
      || pressureAnchors?.[target.team]?.id !== target.id) return;
    const record = this.pressureAnchorHealing.get(target.id);
    if (!record) return;
    const amount = Number(event.amount);
    if (!Number.isFinite(amount) || amount <= 0) return;
    record.amount += amount;
    if (record.lastHealAt === null || t - record.lastHealAt > this.healWindowGapSec) {
      record.windows.push({ start: t, end: t, amount: 0 });
    }
    const window = record.windows.at(-1);
    window.end = t;
    window.amount += amount;
    record.lastHealAt = t;

    if (distance3d(target.pos, objectiveCenter) > this.nearObjectiveM) return;
    record.atFrontAmount += amount;
    if (record.lastFrontHealAt === null || t - record.lastFrontHealAt > this.healWindowGapSec) {
      record.atFrontWindows.push({ start: t, end: t, amount: 0 });
    }
    const frontWindow = record.atFrontWindows.at(-1);
    frontWindow.end = t;
    frontWindow.amount += amount;
    record.lastFrontHealAt = t;
  }

  observeFrontlineHeal(event, t, byId, objectiveCenter, flowState, pressureAnchors = []) {
    return this.observePressureAnchorHeal(
      event,
      t,
      byId,
      pressureAnchors,
      objectiveCenter,
      flowState,
    );
  }

  finishEngagement(reason, closedAt = this.lastObservationAt) {
    if (!this.activeEngagement) return;
    const engagement = this.activeEngagement;
    const parsedClosedAt = Number(closedAt);
    const safeClosedAt = Math.max(
      engagement.start,
      engagement.lastHostileAt,
      Number.isFinite(parsedClosedAt) ? parsedClosedAt : engagement.lastHostileAt,
    );
    this.engagements.push({
      ...engagement,
      closedAt: safeClosedAt,
      endReason: reason,
      resolved: reason !== 'summary_partial',
    });
    this.activeEngagement = null;
  }

  serializeEngagement(engagement) {
    const participants = engagement.roleParticipantsByTeam.map(serializeRoleSets);
    const lastHostileAt = Math.max(engagement.start, engagement.lastHostileAt);
    const liveClosedAt = Number.isFinite(this.lastObservationAt)
      ? this.lastObservationAt
      : lastHostileAt;
    const closedAt = Math.max(
      lastHostileAt,
      Number.isFinite(engagement.closedAt) ? engagement.closedAt : liveClosedAt,
    );
    const contactSpanSec = Math.max(0, lastHostileAt - engagement.start);
    const trackerOpenSec = Math.max(0, closedAt - engagement.start);
    const firstCasualtyAt = Number.isFinite(engagement.firstCasualtyAt)
      ? engagement.firstCasualtyAt
      : null;
    return {
      engagementId: engagement.engagementId,
      start: round(engagement.start),
      lastHostileAt: round(lastHostileAt),
      closedAt: round(closedAt),
      contactSpanSec: round(contactSpanSec),
      trackerOpenSec: round(trackerOpenSec),
      // Compatibility aliases are contact-based. Acceptance gates must use
      // contactSpanSec explicitly so tracker grace cannot inflate fight time.
      end: round(lastHostileAt),
      durationSec: round(contactSpanSec),
      firstCasualtyAt: firstCasualtyAt === null ? null : round(firstCasualtyAt),
      timeToFirstCasualtySec: firstCasualtyAt === null
        ? null
        : round(firstCasualtyAt - engagement.start),
      postFirstCasualtySec: firstCasualtyAt === null
        ? null
        : round(Math.max(0, lastHostileAt - firstCasualtyAt)),
      endReason: engagement.endReason || 'summary_partial',
      resolved: engagement.resolved ?? false,
      eventCount: engagement.eventCount,
      hostileEventsByTeam: [...engagement.hostileEventsByTeam],
      bilateralHostileContact: engagement.hostileEventsByTeam.every(count => count > 0),
      abilityParticipationByTeam: engagement.abilityParticipationByTeam.map(value => ({ ...value })),
      primaryEventsByTeam: [...engagement.primaryEventsByTeam],
      roleEventCountsByTeam: engagement.roleEventCountsByTeam.map(value => ({ ...value })),
      roleParticipantsByTeam: participants,
      fullRoleParticipationByTeam: engagement.roleParticipantsByTeam.map(fullRoleParticipation),
      killsByTeam: [...engagement.killsByTeam],
      deathsByTeam: [...engagement.deathsByTeam],
      fullFrontlineContestSec: round(Math.min(
        Math.max(0, engagement.fullFrontlineContestSec),
        trackerOpenSec,
      )),
    };
  }

  summary(meta = {}) {
    const liveEngagements = this.activeEngagement
      ? [...this.engagements, { ...this.activeEngagement, endReason: 'summary_partial', resolved: false }]
      : [...this.engagements];
    const engagements = liveEngagements.map(engagement => this.serializeEngagement(engagement));
    const resolvedContactSpans = engagements
      .filter(engagement => engagement.resolved)
      .map(engagement => engagement.contactSpanSec);
    const resolvedTrackerOpenSpans = engagements
      .filter(engagement => engagement.resolved && engagement.trackerOpenSec > 0)
      .map(engagement => engagement.trackerOpenSec);
    // A short residual projectile/zone event after a casualty is a skirmish,
    // not a fresh 5v5.  Report it in the raw count above, but use only fights
    // with hostile contact and all three roles participating on both teams for
    // the teamfight duration acceptance criterion.
    const resolvedTeamfightContactSpans = engagements
      .filter(engagement => engagement.resolved && engagement.contactSpanSec > 0 &&
        engagement.bilateralHostileContact &&
        engagement.fullRoleParticipationByTeam.every(Boolean))
      .map(engagement => engagement.contactSpanSec);
    const resolvedTeamfightTrackerOpenSpans = engagements
      .filter(engagement => engagement.resolved && engagement.trackerOpenSec > 0 &&
        engagement.bilateralHostileContact &&
        engagement.fullRoleParticipationByTeam.every(Boolean))
      .map(engagement => engagement.trackerOpenSec);
    const resolvedTeamfightFirstCasualtyDurations = engagements
      .filter(engagement => engagement.resolved && engagement.contactSpanSec > 0 &&
        engagement.bilateralHostileContact &&
        engagement.fullRoleParticipationByTeam.every(Boolean) &&
        Number.isFinite(engagement.timeToFirstCasualtySec))
      .map(engagement => engagement.timeToFirstCasualtySec);
    const score = meta.score || meta.finalFlow?.score || [0, 0];
    const healing = [...this.pressureAnchorHealing.values()].map(record => ({
      playerId: record.playerId,
      team: record.team,
      heroId: record.heroId,
      amount: round(record.amount, 1),
      windows: record.windows.map(window => ({
        start: round(window.start),
        end: round(window.end),
        durationSec: round(window.end - window.start),
        amount: round(window.amount, 1),
      })),
      atFrontAmount: round(record.atFrontAmount, 1),
      atFrontWindows: record.atFrontWindows.map(window => ({
        start: round(window.start),
        end: round(window.end),
        durationSec: round(window.end - window.start),
        amount: round(window.amount, 1),
      })),
    }));
    const healingByTeam = TEAMS.map(team => {
      const records = healing.filter(record => record.team === team);
      const atFrontDurations = records.flatMap(record => (
        record.atFrontWindows.map(window => window.durationSec)
      ));
      return {
        team,
        amount: round(records.reduce((total, record) => total + record.amount, 0), 1),
        windows: records.reduce((total, record) => total + record.windows.length, 0),
        atFrontAmount: round(records.reduce(
          (total, record) => total + record.atFrontAmount,
          0,
        ), 1),
        atFrontWindows: records.reduce(
          (total, record) => total + record.atFrontWindows.length,
          0,
        ),
        atFrontActiveSec: round(atFrontDurations.reduce((total, value) => total + value, 0)),
        longestAtFrontWindowSec: round(Math.max(0, ...atFrontDurations)),
        pressureAnchors: records.map(record => record.playerId),
        frontlines: records.map(record => record.playerId),
      };
    });
    const staggeredRegroupExits = this.regroupExits.filter(exit => exit.staggered).length;
    const staggeredFightEntries = this.fightEntries.filter(entry => entry.staggered).length;
    const engagementKillsByTeam = TEAMS.map(team => this.killAttributions.filter(attribution => (
      attribution.sourceTeam === team && attribution.engagementId !== null
    )).length);
    const outsideEngagementKillsByTeam = TEAMS.map(team => this.killAttributions.filter(attribution => (
      attribution.sourceTeam === team && attribution.engagementId === null
    )).length);
    const reportedEngagementKillsByTeam = TEAMS.map(team => engagements.reduce(
      (total, engagement) => total + engagement.killsByTeam[team],
      0,
    ));
    const attributionConsistent = TEAMS.every(team => (
      this.combatTotals.killsByTeam[team]
        === engagementKillsByTeam[team] + outsideEngagementKillsByTeam[team]
      && engagementKillsByTeam[team] === reportedEngagementKillsByTeam[team]
    ));

    return {
      ...meta,
      schemaVersion: 2,
      durationSec: round(this.durationSec),
      combatTotals: {
        killsByTeam: [...this.combatTotals.killsByTeam],
        deathsByTeam: [...this.combatTotals.deathsByTeam],
        engagementKillsByTeam,
        outsideEngagementKillsByTeam,
        attributionConsistent,
      },
      killAttributions: this.killAttributions.map(attribution => ({ ...attribution })),
      observationIntegrity: { ...this.observationIntegrity },
      objective: {
        timeline: this.timeline,
        twoSidedNearObjectiveSec: round(this.twoSidedNearObjectiveSec),
        pressureAnchorNearObjectiveSec: this.pressureAnchorNearObjectiveSec
          .map(value => round(value)),
        frontlineNearObjectiveSec: this.frontlineNearObjectiveSec.map(value => round(value)),
      },
      pressureAnchorHealing: Object.fromEntries(healing.map(record => [record.playerId, record])),
      pressureAnchorHealingByTeam: healingByTeam,
      frontlineHealing: Object.fromEntries(healing.map(record => [record.playerId, record])),
      frontlineHealingByTeam: healingByTeam,
      engagements,
      engagementSummary: {
        count: engagements.length,
        resolvedCount: engagements.filter(engagement => engagement.resolved).length,
        resolvedContactSpansSec: [...resolvedContactSpans],
        medianResolvedContactSpanSec: round(median(resolvedContactSpans)),
        medianResolvedTrackerOpenSec: round(median(resolvedTrackerOpenSpans)),
        // Compatibility aliases remain contact-based.
        medianResolvedDurationSec: round(median(resolvedContactSpans)),
        resolvedTeamfightCount: resolvedTeamfightContactSpans.length,
        medianResolvedTeamfightContactSpanSec: round(median(resolvedTeamfightContactSpans)),
        medianResolvedTeamfightTrackerOpenSec: round(median(resolvedTeamfightTrackerOpenSpans)),
        medianResolvedTeamfightDurationSec: round(median(resolvedTeamfightContactSpans)),
        medianResolvedTeamfightTimeToFirstCasualtySec: round(median(
          resolvedTeamfightFirstCasualtyDurations,
        )),
        fullRoleParticipationCount: engagements.filter(engagement => (
          engagement.fullRoleParticipationByTeam.every(Boolean)
        )).length,
      },
      teamPresence: {
        aliveSec: this.aliveSec.map(value => round(value)),
        nearObjectiveSec: this.nearObjectiveSec.map(value => round(value)),
      },
      regroup: {
        exits: this.regroupExits,
        staggeredExits: staggeredRegroupExits,
        staggeredExitRate: round(staggeredRegroupExits / Math.max(1, this.regroupExits.length)),
        fightEntries: this.fightEntries,
        staggeredFightEntries,
        staggeredFightEntryRate: round(staggeredFightEntries / Math.max(1, this.fightEntries.length)),
      },
      dps: Object.fromEntries([...this.dps].map(([id, record]) => [id, {
        ...record,
        activeSec: Object.fromEntries(Object.entries(record.activeSec).map(([key, value]) => [key, round(value)])),
        duringAnchorEngagedSec: Object.fromEntries(Object.entries(record.duringAnchorEngagedSec)
          .map(([key, value]) => [key, round(value)])),
        outsideAnchorEngagedSec: Object.fromEntries(Object.entries(record.outsideAnchorEngagedSec)
          .map(([key, value]) => [key, round(value)])),
        duringTankEngagedSec: Object.fromEntries(Object.entries(record.duringAnchorEngagedSec)
          .map(([key, value]) => [key, round(value)])),
        outsideTankEngagedSec: Object.fromEntries(Object.entries(record.outsideAnchorEngagedSec)
          .map(([key, value]) => [key, round(value)])),
        combatEvents: {
          ...record.combatEvents,
          duringTankEngaged: record.combatEvents.duringAnchorEngaged,
          outsideTankEngaged: record.combatEvents.outsideAnchorEngaged,
        },
        offensiveEvents: summarizeOffensiveEvents(record.offensiveEvents),
      }])),
      rounds: {
        score: [...score],
        durations: this.roundDurations,
        twoZero: score.includes(2) && score.includes(0),
      },
    };
  }
}

export function aggregateTeamfightMetrics(observations, options = {}) {
  const metrics = new TeamfightMetrics(options);
  for (const observation of observations || []) metrics.observe(observation);
  return metrics.summary(options.meta || {});
}
