#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { HERO_BY_ID } from '../shared/data/heroes.js';
import { BotController } from '../server/bots.js';
import {
  BOT_RNG_SCHEME,
  makeBotRng,
  scheduleBotThinkOrder,
} from '../server/bot_fairness.js';
import { competitiveBotRotation } from '../shared/rules/bot_roster.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUTPUT = path.join(ROOT, 'outputs', 'rc5-bot-evidence', 'bot-navigation-audit.json');
const CONTRIBUTION_EVENTS = new Set([
  'shot', 'ability_used', 'ultimate_used', 'heal', 'kill', 'pickup',
  'barrier_hit', 'barrier_destroyed', 'deployable_hit', 'deployable_destroyed',
]);
const TACTICAL_CONTRIBUTION_EVENTS = new Set([
  'ability_used', 'ultimate_used', 'heal', 'kill', 'pickup',
  'barrier_hit', 'barrier_destroyed', 'deployable_hit', 'deployable_destroyed',
]);
const MOBILITY_BEHAVIORS = new Set(['dash', 'air_dash', 'backstep', 'zone_dash']);
const MOBILITY_ACTION_IDS = new Set(Object.values(HERO_BY_ID).flatMap(hero =>
  Object.values(hero.abilities || {})
    .filter(action => MOBILITY_BEHAVIORS.has(action.behavior))
    .map(action => action.id)));

export const DEFAULT_BOT_AUDIT_THRESHOLDS = Object.freeze({
  warmupSec: 2,
  trajectoryIntervalSec: 1,
  movementMarkM: 0.5,
  inactivitySec: 8,
  tacticalInactivitySec: 30,
  stallSec: 2.5,
  stallMovementM: 0.5,
  recoveryTimeoutSec: 5,
  recoveryProgressM: 2,
  fallGraceSec: 0.75,
  fallBelowM: -0.5,
  fallVelocityMps: -1,
  // The central objective bowl has an intentional 1.5m playable descent.
  // Only larger transitions that strand the bot on the low ground are harmful;
  // stepping down from a 6m prop onto the main 4m combat deck is valid FPS play.
  largeDropM: 2,
  harmfulLandingBelowM: 1,
  boundsMarginM: 1,
  voidMarginM: 4,
  maxZ: 14,
});

function rounded(value, digits = 2) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function horizontalDistance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

function movementRequested(player) {
  const input = player.inputCommandState || player.input || {};
  return !!(input.f || input.b || input.l || input.r)
    || Math.hypot(Number(input.moveX) || 0, Number(input.moveY) || 0) > 0.1;
}

function objectiveDistance(world, player) {
  return horizontalDistance(world.map.objective.center, player.move.pos);
}

function effectiveRouteName(controller) {
  return controller?.activeRouteName?.() || controller?.route || null;
}

function continuousSustain(player) {
  const hero = HERO_BY_ID[player?.heroId];
  return hero?.role === 'support' && hero.teamFunctions?.includes('continuous_sustain');
}

function isSafeCoordinatedRegroupHold(world, player, controller) {
  if (controller?.mode !== 'regroup' || (controller.recoveryPath?.length || 0) > 0) return false;
  const expectedSize = Math.max(1, Number(world.mode?.teamSize) || 5);
  const members = [...world.players.values()].filter(other => other.team === player.team);
  // Never hide an incomplete fixture or a lone stuck bot.  This exception is
  // only for an actual match roster that is intentionally waiting together.
  if (members.length < expectedSize) return false;
  const stageBase = world.map.routes.front[Math.min(2, world.map.routes.front.length - 1)];
  const stage = world.sideOf(player.team) === 'east'
    ? stageBase
    : [-stageBase[0], -stageBase[1], stageBase[2]];
  if (horizontalDistance(player.move.pos, stage) > 2.5) return false;

  const alive = members.filter(other => other.alive);
  const tank = alive.find(other => HERO_BY_ID[other.heroId]?.role === 'frontline');
  const sustain = alive.find(continuousSustain);
  const staged = alive.filter(other => horizontalDistance(other.move.pos, stage) <= 11);
  const tankStaged = !!tank && staged.some(other => other.id === tank.id);
  const sustainStaged = !!sustain && staged.some(other => other.id === sustain.id);
  return alive.length < expectedSize || !tank || !sustain || staged.length < 4 || !tankStaged || !sustainStaged;
}

function statsSnapshot(player) {
  return {
    kills: player.stats.kills || 0,
    damage: player.stats.dmg || 0,
    healing: player.stats.healing || 0,
    objectiveSec: player.stats.objectiveSec || 0,
  };
}

function statsAdvanced(before, after) {
  return Object.keys(before).some(key => after[key] > before[key] + 1e-9);
}

export class BotNavigationAudit {
  constructor(world, controllers, thresholds = {}) {
    this.world = world;
    this.controllers = new Map(controllers.map(controller => [controller.pl.id, controller]));
    this.thresholds = Object.freeze({ ...DEFAULT_BOT_AUDIT_THRESHOLDS, ...thresholds });
    this.states = new Map();
    this.violations = [];
    this.violationKeys = new Set();
    this.activeSince = null;
    this.nextTrajectoryAt = 0;
    this.trajectory = [];
    this.mobilityEvents = [];
    this.round = world.flow.round;
    this.activeObservedSec = 0;
    this.setupObservedSec = 0;
    this.roundTransitions = 0;
    for (const player of world.players.values()) this.states.set(player.id, this.makeState(player));
  }

  makeState(player) {
    const controller = this.controllers.get(player.id);
    return {
      playerId: player.id,
      heroId: player.heroId,
      role: HERO_BY_ID[player.heroId]?.role || 'unknown',
      team: player.team,
      lastPos: [...player.move.pos],
      activityPos: [...player.move.pos],
      lastMeaningfulAt: this.world.t,
      lastTacticalAt: this.world.t,
      maxInactiveSec: 0,
      maxTacticalInactiveSec: 0,
      coordinatedRegroupHoldSec: 0,
      coordinatedRegroupHold: false,
      stallAnchor: null,
      fallDangerSec: 0,
      airborneStartZ: null,
      falls: 0,
      contributionEvents: 0,
      movementMarks: 0,
      objectiveSamples: 0,
      recoveryStarts: 0,
      recoveryCompletions: 0,
      recoveryInterruptions: 0,
      recovery: null,
      lastRecoveryDepth: controller?.recoveryPath?.length || 0,
      deaths: 0,
      environmentalDeaths: 0,
      voidDeaths: 0,
      deathAt: null,
      respawnDowntimeSec: 0,
      maxRespawnDowntimeSec: 0,
      lastStats: statsSnapshot(player),
    };
  }

  resetTemporalState(state, player) {
    state.lastPos = [...player.move.pos];
    state.activityPos = [...player.move.pos];
    state.lastMeaningfulAt = this.world.t;
    state.lastTacticalAt = this.world.t;
    state.stallAnchor = null;
    state.fallDangerSec = 0;
    state.airborneStartZ = null;
    state.recovery = null;
    state.lastStats = statsSnapshot(player);
  }

  interruptRecovery(state, controller) {
    if (state.lastRecoveryDepth > 0) {
      state.recoveryInterruptions++;
    }
    state.recovery = null;
    state.lastRecoveryDepth = 0;
  }

  noteViolation(type, player, controller, detail = {}) {
    const key = `${this.world.flow.round}:${player.id}:${type}`;
    if (this.violationKeys.has(key)) return;
    this.violationKeys.add(key);
    this.violations.push({
      type,
      seed: this.world.seed,
      round: this.world.flow.round,
      t: rounded(this.world.t, 3),
      playerId: player.id,
      heroId: player.heroId,
      role: HERO_BY_ID[player.heroId]?.role || 'unknown',
      team: player.team,
      pos: player.move.pos.map(value => rounded(value, 3)),
      vel: player.move.vel.map(value => rounded(value, 3)),
      grounded: player.move.grounded,
      mode: controller?.mode || null,
      route: effectiveRouteName(controller),
      rawRoute: controller?.route || null,
      waypoint: controller?.wpIndex ?? null,
      recoveryDepth: controller?.recoveryPath?.length || 0,
      ...detail,
    });
  }

  markContribution(playerId, { meaningful = true, tactical = false } = {}) {
    const state = this.states.get(playerId);
    if (!state) return;
    if (meaningful) state.lastMeaningfulAt = this.world.t;
    if (tactical) state.lastTacticalAt = this.world.t;
    state.contributionEvents++;
  }

  recordEvents(events) {
    for (const event of events) {
      if (MOBILITY_ACTION_IDS.has(event.abilityId)
        && ['ability_windup', 'ability_used', 'ability_interrupted'].includes(event.type)) {
        const player = this.world.players.get(event.player);
        this.mobilityEvents.push({
          t: rounded(this.world.t, 3),
          type: event.type,
          playerId: event.player,
          heroId: event.heroId || player?.heroId || null,
          abilityId: event.abilityId,
          pos: player?.move.pos?.map(value => rounded(value, 3)) || null,
          yaw: Number.isFinite(player?.move?.yaw) ? rounded(player.move.yaw, 4) : null,
          velocity: player?.move?.vel?.map(value => rounded(value, 3)) || null,
        });
      }
      if (event.type === 'round_active') this.activeSince = this.world.t;
      if (event.type === 'round_setup') {
        this.activeSince = null;
        if (event.round !== this.round) this.roundTransitions++;
        this.round = event.round;
        for (const player of this.world.players.values()) {
          const state = this.states.get(player.id);
          const controller = this.controllers.get(player.id);
          if (!state) continue;
          this.interruptRecovery(state, controller);
          state.deathAt = null;
          this.resetTemporalState(state, player);
        }
      }
      if (event.type === 'kill' && event.target) {
        const player = this.world.players.get(event.target);
        const state = this.states.get(event.target);
        const controller = this.controllers.get(event.target);
        if (player && state) {
          state.deaths++;
          state.deathAt = this.world.t;
          this.interruptRecovery(state, controller);
          if (event.cause === 'environment' || event.environment) {
            state.environmentalDeaths++;
            if (event.environment === 'void_fall') state.voidDeaths++;
            this.noteViolation('environmental_death', player, controller, {
              cause: event.cause || null,
              environment: event.environment || null,
            });
          }
        }
      }
      if (CONTRIBUTION_EVENTS.has(event.type)) {
        const tactical = TACTICAL_CONTRIBUTION_EVENTS.has(event.type);
        const meaningful = event.type !== 'shot';
        if (event.source) this.markContribution(event.source, { meaningful, tactical });
        if (event.player) this.markContribution(event.player, { meaningful, tactical });
      }
      if (event.type === 'respawn' && event.player) {
        const player = this.world.players.get(event.player);
        const state = this.states.get(event.player);
        if (player && state) {
          if (state.deathAt !== null) {
            const downtime = Math.max(0, this.world.t - state.deathAt);
            state.respawnDowntimeSec += downtime;
            state.maxRespawnDowntimeSec = Math.max(state.maxRespawnDowntimeSec, downtime);
          }
          state.deathAt = null;
          this.resetTemporalState(state, player);
        }
      }
    }
  }

  observeTick(dt = this.world.dt) {
    if (this.world.flow.round !== this.round) {
      this.round = this.world.flow.round;
      this.activeSince = null;
      this.roundTransitions++;
      for (const player of this.world.players.values()) {
        const state = this.states.get(player.id);
        const controller = this.controllers.get(player.id);
        if (state) {
          this.interruptRecovery(state, controller);
          state.deathAt = null;
          this.resetTemporalState(state, player);
        }
      }
    }
    const active = this.world.flow.state === 'ACTIVE';
    if (active) this.activeObservedSec += dt;
    else this.setupObservedSec += dt;
    if (active && this.activeSince === null) this.activeSince = this.world.t;
    for (const player of this.world.players.values()) {
      const state = this.states.get(player.id);
      const controller = this.controllers.get(player.id);
      if (!state || !controller) continue;
      this.observePlayer(state, player, controller, active, dt);
    }
    if (this.world.t + 1e-9 >= this.nextTrajectoryAt) {
      this.captureTrajectory();
      this.nextTrajectoryAt = this.world.t + this.thresholds.trajectoryIntervalSec;
    }
  }

  observePlayer(state, player, controller, active, dt) {
    const eligible = active && player.alive && !player.spawnProtected;
    if (!eligible) {
      if (!player.alive && state.deathAt === null) state.deathAt = this.world.t;
      if (!active || !player.alive) this.interruptRecovery(state, controller);
      this.resetTemporalState(state, player);
      state.lastRecoveryDepth = 0;
      return;
    }

    const currentStats = statsSnapshot(player);
    if (statsAdvanced(state.lastStats, currentStats)) {
      state.lastMeaningfulAt = this.world.t;
      state.lastTacticalAt = this.world.t;
    }
    state.lastStats = currentStats;

    if (horizontalDistance(state.activityPos, player.move.pos) >= this.thresholds.movementMarkM) {
      state.activityPos = [...player.move.pos];
      state.lastMeaningfulAt = this.world.t;
      state.movementMarks++;
    }
    if (player.insideObjective) {
      state.lastMeaningfulAt = this.world.t;
      state.lastTacticalAt = this.world.t;
      state.objectiveSamples++;
    }
    state.coordinatedRegroupHold = isSafeCoordinatedRegroupHold(this.world, player, controller);
    if (state.coordinatedRegroupHold) {
      // A death-triggered, fully rostered regroup at the declared staging
      // point is intentional tactical restraint, not a silent freeze.  Keep
      // it observable in the report while preserving strict stall checks for
      // every other location, phase, and incomplete fixture.
      state.lastMeaningfulAt = this.world.t;
      state.lastTacticalAt = this.world.t;
      state.coordinatedRegroupHoldSec += dt;
    }
    const inactiveFor = Math.max(0, this.world.t - state.lastMeaningfulAt);
    state.maxInactiveSec = Math.max(state.maxInactiveSec, inactiveFor);
    const tacticalInactiveFor = Math.max(0, this.world.t - state.lastTacticalAt);
    state.maxTacticalInactiveSec = Math.max(state.maxTacticalInactiveSec, tacticalInactiveFor);

    const outsideWarmup = this.activeSince !== null
      && this.world.t - this.activeSince >= this.thresholds.warmupSec;
    if (outsideWarmup && inactiveFor >= this.thresholds.inactivitySec) {
      this.noteViolation('combat_ineffective', player, controller, {
        inactiveSec: rounded(inactiveFor, 2),
        objectiveDistanceM: rounded(objectiveDistance(this.world, player), 2),
      });
    }
    if (outsideWarmup && tacticalInactiveFor >= this.thresholds.tacticalInactivitySec) {
      this.noteViolation('tactically_ineffective', player, controller, {
        inactiveSec: rounded(tacticalInactiveFor, 2),
        objectiveDistanceM: rounded(objectiveDistance(this.world, player), 2),
      });
    }

    this.observeBoundsAndFall(state, player, controller, dt);
    this.observeStall(state, player, controller, outsideWarmup);
    this.observeRecovery(state, player, controller);
    state.lastPos = [...player.move.pos];
  }

  observeBoundsAndFall(state, player, controller, dt) {
    const { boundsM, killZ } = this.world.map;
    const margin = this.thresholds.boundsMarginM;
    const [x, y, z] = player.move.pos;
    if (x < boundsM.x[0] - margin || x > boundsM.x[1] + margin
      || y < boundsM.y[0] - margin || y > boundsM.y[1] + margin) {
      this.noteViolation('out_of_bounds', player, controller);
    }
    if (z > this.thresholds.maxZ) this.noteViolation('invalid_altitude', player, controller);
    if (Number.isFinite(killZ) && z < killZ + this.thresholds.voidMarginM) {
      this.noteViolation('void_fall', player, controller);
    }

    if (state.airborneStartZ === null && !player.move.grounded) {
      state.airborneStartZ = state.lastPos[2];
    } else if (state.airborneStartZ !== null && player.move.grounded) {
      const drop = state.airborneStartZ - z;
      if (drop >= this.thresholds.largeDropM && z < this.thresholds.harmfulLandingBelowM) {
        state.falls++;
        this.noteViolation('large_drop', player, controller, { dropM: rounded(drop, 2) });
      }
      state.airborneStartZ = null;
    }

    const dangerousFall = !player.move.grounded
      && z < this.thresholds.fallBelowM
      && player.move.vel[2] < this.thresholds.fallVelocityMps;
    state.fallDangerSec = dangerousFall ? state.fallDangerSec + dt : 0;
    if (state.fallDangerSec + 1e-9 >= this.thresholds.fallGraceSec) {
      this.noteViolation('sustained_fall', player, controller, {
        fallDurationSec: rounded(state.fallDangerSec, 2),
      });
    }
  }

  observeStall(state, player, controller, outsideWarmup) {
    const routeLength = controller.routePoints?.().length || 0;
    const eligible = outsideWarmup
      && (controller.mode === 'advance' || controller.mode === 'regroup')
      && controller.wpIndex < routeLength
      && (controller.recoveryPath?.length || 0) === 0
      && movementRequested(player);
    if (!eligible) {
      state.stallAnchor = null;
      return;
    }
    if (!state.stallAnchor) {
      state.stallAnchor = { t: this.world.t, pos: [...player.move.pos] };
      return;
    }
    const moved = horizontalDistance(state.stallAnchor.pos, player.move.pos);
    if (moved >= this.thresholds.stallMovementM) {
      state.stallAnchor = { t: this.world.t, pos: [...player.move.pos] };
      return;
    }
    const stalledFor = this.world.t - state.stallAnchor.t;
    if (stalledFor + 1e-9 >= this.thresholds.stallSec) {
      this.noteViolation('persistent_stall', player, controller, {
        stalledSec: rounded(stalledFor, 2),
        requestedMovement: true,
      });
    }
  }

  observeRecovery(state, player, controller) {
    const depth = controller.recoveryPath?.length || 0;
    if (depth > 0 && state.lastRecoveryDepth === 0) {
      const target = controller.recoveryPath.at(-1) || player.move.pos;
      state.recoveryStarts++;
      state.recovery = {
        t: this.world.t,
        pos: [...player.move.pos],
        z: player.move.pos[2],
        target: [...target],
        startDistance: horizontalDistance(player.move.pos, target),
      };
    }
    if (depth === 0 && state.lastRecoveryDepth > 0) {
      state.recoveryCompletions++;
      state.recovery = null;
    }
    if (depth > 0 && state.recovery) {
      const elapsed = this.world.t - state.recovery.t;
      const moved = horizontalDistance(state.recovery.pos, player.move.pos);
      const climbed = player.move.pos[2] - state.recovery.z;
      const remaining = horizontalDistance(player.move.pos, state.recovery.target);
      const closed = state.recovery.startDistance - remaining;
      if (moved >= this.thresholds.recoveryProgressM
        || climbed >= this.thresholds.recoveryProgressM
        || closed >= this.thresholds.recoveryProgressM) {
        state.recovery = {
          t: this.world.t,
          pos: [...player.move.pos],
          z: player.move.pos[2],
          target: [...state.recovery.target],
          startDistance: remaining,
        };
      } else if (elapsed + 1e-9 >= this.thresholds.recoveryTimeoutSec) {
        this.noteViolation('recovery_failed', player, controller, {
          recoverySec: rounded(elapsed, 2),
          recoveryProgressM: rounded(Math.max(moved, climbed, closed), 2),
        });
      }
    }
    state.lastRecoveryDepth = depth;
  }

  captureTrajectory() {
    for (const player of this.world.players.values()) {
      const controller = this.controllers.get(player.id);
      if (!controller) continue;
      this.trajectory.push({
        t: rounded(this.world.t, 2),
        round: this.world.flow.round,
        flow: this.world.flow.state,
        playerId: player.id,
        heroId: player.heroId,
        role: HERO_BY_ID[player.heroId]?.role || 'unknown',
        team: player.team,
        alive: player.alive,
        grounded: player.move.grounded,
        pos: player.move.pos.map(value => rounded(value, 2)),
        speedMps: rounded(Math.hypot(player.move.vel[0], player.move.vel[1]), 2),
        objectiveDistanceM: rounded(objectiveDistance(this.world, player), 2),
        mode: controller.mode,
        route: effectiveRouteName(controller),
        rawRoute: controller.route || null,
        waypoint: controller.wpIndex,
        stallSec: rounded(controller.stallT || 0, 2),
        recoveryDepth: controller.recoveryPath?.length || 0,
        recoveryNext: controller.recoveryPath?.[0]?.map(value => rounded(value, 2)) || null,
        recoveryGoal: controller.recoveryPath?.at(-1)?.map(value => rounded(value, 2)) || null,
        ledgeAvoidances: controller.ledgeAvoidances || 0,
      });
    }
  }

  summary(context = {}) {
    for (const state of this.states.values()) {
      const controller = this.controllers.get(state.playerId);
      const player = this.world.players.get(state.playerId);
      if (!player || !controller) continue;
      const activeRecovery = this.world.flow.state === 'ACTIVE'
        && player.alive
        && !player.spawnProtected
        && (controller.recoveryPath?.length || 0) > 0 ? 1 : 0;
      const accounted = state.recoveryCompletions + state.recoveryInterruptions + activeRecovery;
      if (accounted !== state.recoveryStarts) {
        this.noteViolation('recovery_accounting_error', player, controller, {
          recoveryStarts: state.recoveryStarts,
          recoveryCompletions: state.recoveryCompletions,
          recoveryInterruptions: state.recoveryInterruptions,
          activeRecoveries: activeRecovery,
        });
      }
    }
    const players = [...this.states.values()].map(state => {
      const controller = this.controllers.get(state.playerId);
      const player = this.world.players.get(state.playerId);
      const activeRecovery = this.world.flow.state === 'ACTIVE'
        && player?.alive
        && !player.spawnProtected
        && (controller?.recoveryPath?.length || 0) > 0 ? 1 : 0;
      return {
        playerId: state.playerId,
        heroId: state.heroId,
        role: state.role,
        team: state.team,
        falls: state.falls,
        deaths: state.deaths,
        environmentalDeaths: state.environmentalDeaths,
        voidDeaths: state.voidDeaths,
        respawnDowntimeSec: rounded(state.respawnDowntimeSec, 2),
        maxRespawnDowntimeSec: rounded(state.maxRespawnDowntimeSec, 2),
        recoveryStarts: state.recoveryStarts,
        recoveryCompletions: state.recoveryCompletions,
        recoveryInterruptions: state.recoveryInterruptions,
        activeRecoveries: activeRecovery,
        activeRecoveryProgressAgeSec: activeRecovery && state.recovery
          ? rounded(this.world.t - state.recovery.t, 2)
          : 0,
        ledgeAvoidances: controller?.ledgeAvoidances || 0,
        maxInactiveSec: rounded(state.maxInactiveSec, 2),
        maxTacticalInactiveSec: rounded(state.maxTacticalInactiveSec, 2),
        coordinatedRegroupHoldSec: rounded(state.coordinatedRegroupHoldSec, 2),
        contributionEvents: state.contributionEvents,
        movementMarks: state.movementMarks,
        kills: player?.stats.kills || 0,
        damage: rounded(player?.stats.dmg || 0, 1),
        healing: rounded(player?.stats.healing || 0, 1),
        objectiveSec: rounded(player?.stats.objectiveSec || 0, 2),
      };
    });
    return {
      schemaVersion: 2,
      ...context,
      thresholds: this.thresholds,
      aggregate: {
        pass: this.violations.length === 0,
        violations: this.violations.length,
        players: players.length,
        falls: players.reduce((sum, player) => sum + player.falls, 0),
        deaths: players.reduce((sum, player) => sum + player.deaths, 0),
        environmentalDeaths: players.reduce((sum, player) => sum + player.environmentalDeaths, 0),
        voidDeaths: players.reduce((sum, player) => sum + player.voidDeaths, 0),
        recoveryStarts: players.reduce((sum, player) => sum + player.recoveryStarts, 0),
        recoveryCompletions: players.reduce((sum, player) => sum + player.recoveryCompletions, 0),
        recoveryInterruptions: players.reduce((sum, player) => sum + player.recoveryInterruptions, 0),
        activeRecoveries: players.reduce((sum, player) => sum + player.activeRecoveries, 0),
        ledgeAvoidances: players.reduce((sum, player) => sum + player.ledgeAvoidances, 0),
        maxInactiveSec: Math.max(0, ...players.map(player => player.maxInactiveSec)),
        maxTacticalInactiveSec: Math.max(0, ...players.map(player => player.maxTacticalInactiveSec)),
        coordinatedRegroupHoldSec: rounded(players.reduce(
          (sum, player) => sum + player.coordinatedRegroupHoldSec, 0,
        ), 2),
        activeObservedSec: rounded(this.activeObservedSec, 3),
        nonActiveObservedSec: rounded(this.setupObservedSec, 3),
        roundTransitions: this.roundTransitions,
      },
      players,
      violations: this.violations,
      mobilityEvents: this.mobilityEvents,
      trajectory: this.trajectory,
    };
  }
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), 'utf8'));
}

export async function runBotNavigationAudit({
  seed,
  matchIndex = 0,
  durationSec = 150,
  thresholds = {},
} = {}) {
  const [mode, combat] = await Promise.all([
    readJson('shared/data/mode_shioura.json'),
    readJson('shared/data/combat.json'),
  ]);
  const rotation = competitiveBotRotation(matchIndex);
  const resolvedSeed = seed === undefined ? rotation.acceptanceSeed : seed;
  const world = new World(buildMap(), mode, combat, resolvedSeed);
  const teams = rotation.teams;
  const botRecords = [];
  let botIndex = 0;
  for (let team = 0; team < teams.length; team++) {
    for (let slotIndex = 0; slotIndex < teams[team].length; slotIndex++) {
      const slot = teams[team][slotIndex];
      const player = world.addPlayer(`audit-bot-${botIndex++}`, true, team, slot.heroId);
      const rngSlot = rotation.rngSlots[team][slotIndex];
      player.logicalActionSlot = rngSlot.logicalLineupSlot;
      botRecords.push({ player, rngSlot });
    }
  }
  const botPlayers = botRecords.map(record => record.player);
  const botRngControllers = [];
  const controllers = botRecords.map(({ player, rngSlot }) => {
    const rng = makeBotRng(world.seed, player, botPlayers, {
      logicalLineupSlot: rngSlot.logicalLineupSlot,
    });
    botRngControllers.push({
      playerId: player.id,
      physicalTeam: player.team,
      ...rng.metadata,
    });
    return new BotController(world, player, rng);
  });
  const audit = new BotNavigationAudit(world, controllers, thresholds);
  const ticks = Math.ceil(durationSec / world.dt);
  let executedTicks = 0;
  for (; executedTicks < ticks && world.flow.state !== 'MATCH_END'; executedTicks++) {
    for (const controller of scheduleBotThinkOrder(controllers, world.tickCount)) controller.think(world.dt);
    world.tick();
    const events = world.drainEvents();
    audit.recordEvents(events);
    audit.observeTick(world.dt);
  }
  return audit.summary({
    seed: resolvedSeed,
    matchIndex,
    requestedDurationSec: durationSec,
    simulatedDurationSec: rounded(world.t, 3),
    ticks: executedTicks,
    tickRateHz: combat.tickRateHz,
    teamCompositions: teams,
    rotation: {
      rotationIndex: rotation.rotationIndex,
      canonicalLineupIndex: rotation.canonicalLineupIndex,
      mirrored: rotation.mirrored,
      mirrorMatchIndex: rotation.mirrorMatchIndex,
      acceptanceSeed: rotation.acceptanceSeed,
      logicalLineupSlots: rotation.rngSlots.map(team => (
        team.map(slot => slot.logicalLineupSlot)
      )),
    },
    botRng: {
      scheme: BOT_RNG_SCHEME,
      matchSeed: Number(world.seed) >>> 0,
      controllers: botRngControllers,
    },
    finalFlow: world.flow.snapshot(),
  });
}

async function writeJsonAtomic(outputPath, value) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp-${process.pid}`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, outputPath);
}

function numericFlag(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const parsed = Number(args[index + 1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function main(args) {
  const requestedSeed = numericFlag(args, 'seed', undefined);
  const seed = requestedSeed === undefined ? undefined : Math.floor(requestedSeed);
  const matchIndex = Math.max(0, Math.floor(numericFlag(args, 'match', 0)));
  const durationSec = Math.max(1, numericFlag(args, 'seconds', 150));
  const outputIndex = args.indexOf('--output');
  const outputPath = outputIndex >= 0 ? path.resolve(args[outputIndex + 1]) : DEFAULT_OUTPUT;
  const result = await runBotNavigationAudit({ seed, matchIndex, durationSec });
  if (!args.includes('--no-write')) await writeJsonAtomic(outputPath, result);
  if (args.includes('--json')) console.log(JSON.stringify(result));
  else console.log(JSON.stringify(result.aggregate));
  if (!result.aggregate.pass) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
