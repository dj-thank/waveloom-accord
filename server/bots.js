// 潮占を軸に、ロールの間合いと18ヒーロー固有の武器・能力を使い分けるサーバー権威ボット。
// 能力は必ず1tickのpressと次tickのreleaseをqueueInputへ流し、能力側のedge判定を共有する。

import { eyePosition } from '../shared/sim/combat.js';
import { HERO_BY_ID } from '../shared/data/heroes.js';
import {
  heroCanAnchorPressure,
  heroCanRecoverAllies,
  selectPressureAnchor,
  selectRecoveryProvider,
} from '../shared/rules/team_capabilities.js';
import { canAffectPoint, canAffectTarget, playerTargetPoint } from '../shared/sim/spatial_query.js';
import {
  canTraverseGroundSegment,
  findGroundDetourPath,
  findGroundRecoveryPath,
  hasSafeGroundAhead,
  hasSafeGroundPath,
  isOnAuthoredStair,
  intendedMovementVector,
  navigationFloorHeight,
} from './bot_navigation.js';
import { resolveFlashpointBotRoute } from './flashpoint_bot_route_adapter.js';

const DAMAGE_SIDE_ROUTES = ['cloister', 'shallows'];
const DAMAGE_ROUTES = [...DAMAGE_SIDE_ROUTES, 'front'];
const ALLY_TARGET_BEHAVIORS = new Set([
  'ally_grapple', 'link_ally', 'ally_damage_buff', 'redirect_link',
  'release_stored_heal', 'cooldown_zone', 'healing_trail',
]);
const SUPPORT_MOBILITY_BEHAVIORS = new Set(['dash', 'air_dash', 'zone_dash']);
const PROPEL_BEHAVIORS = new Set(['dash', 'air_dash', 'backstep']);
const FRONTLINE_DEFENSIVE_SLOTS = Object.freeze({
  zairu: new Set(['ability2']),
  baraga: new Set(['secondary', 'ability1']),
  vesta: new Set(['secondary', 'ability1']),
  nuedori: new Set(['secondary', 'ability1']),
  sedora: new Set(['secondary', 'ability1']),
  shiomaneki: new Set(['secondary', 'ability1']),
});

const between = (value, min, max) => value >= min && value <= max;
const hasActionResource = (context, slot) => {
  const cost = context.hero?.abilities?.[slot]?.resourceCost || 0;
  return cost <= 0 || context.resourceValue >= cost;
};
const ULTIMATE_LIVENESS_DELAY_SEC = 8;
const FRONTLINE_STANDARD_LEAD_M = 3;
const DAMAGE_FLANK_LEAD_M = 7;
const DAMAGE_FLANK_MIN_LATERAL_M = 4;
const DAMAGE_FLANK_MAX_LATERAL_M = 12;
const SUPPORT_TANK_REACH_M = 16;
const SUPPORT_WOUNDED_TANK_REACH_M = 8;
const SUPPORT_MAX_LATERAL_M = 6;
const SUPPORT_FOLLOW_DISTANCE_M = 5;
// This only prevents capsule/body stacking.  It deliberately does not impose a
// distant backline: a sustain support may still play close enough to cover and
// be protected by its tank.
const SUPPORT_MIN_COVER_DISTANCE_M = 2;
const SUPPORT_LATERAL_OFFSET_M = 2.5;
const SUPPORT_COVER_SEARCH_RADIUS_M = 18;
const SUPPORT_COVER_REPLAN_SEC = 0.5;
const SUPPORT_RESCUE_REPLAN_SEC = 0.5;
const TANK_ALLY_RANGE_M = 14;
const TANK_SUPPORT_RANGE_M = 18;
const TANK_SUPPORT_PRESSURE_RELEASE_RANGE_M = 20;
const TANK_CRITICAL_HP_RATIO = 0.32;
const TANK_RETREAT_HP_RATIO = 0.5;
const TANK_CONTEST_HP_RATIO = 0.55;
const FORMATION_STEER_MAX_DISTANCE_M = 24;
const RECOVERY_WAYPOINT_REACHED_M = 0.65;
// Rejoining an authored route may start just outside the tighter A* waypoint
// threshold because the capsule is already beside the target tread.  Treat
// that same-level node as reached instead of creating a short recovery loop.
const ROUTE_REJOIN_REACHED_M = 0.85;
const STALL_JUMP_SEC = 0.7;
const STALL_REPLAN_SEC = 1.2;
const LEDGE_BRAKE_HOLD_SEC = 0.55;
const TARGET_MEMORY_SEC = 3;
const TEAM_FOCUS_MEMORY_SEC = 2.5;
const TEAM_FOCUS_MAX_RANGE_M = 50;
const TARGET_CLAIM_MEMORY_SEC = 0.35;
// Healthy targets keep the normal two-attacker split. Once pressure exposes a
// real finish window, exactly one additional attacker may convert onto it;
// this creates coordinated picks without collapsing every angle into a 5v1.
const MAX_SHARED_TARGET_ATTACKERS = 2;
const FINISH_FOCUS_HP_RATIO = 0.7;
const MAX_FINISH_TARGET_ATTACKERS = 3;
const HOSTILE_CLAIM_PRESSURE_BONUS = 0.15;
const HOSTILE_CLAIM_PRESSURE_CAP = 0.3;
// The third attacker is a real finish-window threat, so recovery providers get
// one small, bounded rescue signal. It is deliberately weaker than a 25% HP
// deficit: a genuinely critical ally must still win the healing decision.
const FINISH_FOCUS_RESCUE_BONUS = 0.04;
const PRELOAD_HOSTILE_CLAIMS = 2;
const PURSUIT_REPLAN_SEC = 2.5;
const SQUAD_FOCUS_BY_WORLD = new WeakMap();
const TARGET_CLAIMS_BY_WORLD = new WeakMap();
const TEAM_TACTICS_BY_WORLD = new WeakMap();
const TEAM_REGROUP_STAGE_RADIUS_M = 11;
const TEAM_PRESSURE_MEMORY_SEC = 1.5;
const TEAM_TRADE_WINDOW_SEC = 2.5;
const TEAM_FRONT_ENGAGE_RADIUS_M = 18;
const REGROUP_PLAN_RETRY_SEC = 0.75;
// A failed route rejoin can involve several bounded A* attempts. When neither
// the bot nor the authored route progress has changed, retrying it every 63Hz
// only recreates the same failure and starves the simulation tick.
const ROUTE_RECOVERY_PLAN_RETRY_SEC = 0.35;
const DPS_ANGLE_RECOVERY_RETRY_SEC = 0.75;
const DEFENSE_DAMAGE_WINDOW_SEC = 0.9;
const DEFENSE_ACTION_SPACING_SEC = 1.6;
const DEFENSE_CRITICAL_SPACING_SEC = 0.55;

function stablePlayerKey(player) {
  const heroId = String(player?.heroId || 'training');
  return player?.isBot
    ? `${heroId}|bot`
    : `${heroId}|human|${String(player?.name || '')}`;
}

function compareStablePlayers(left, right) {
  const leftKey = stablePlayerKey(left);
  const rightKey = stablePlayerKey(right);
  return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
}

function logicalPlayerIdentity(player, rng) {
  return rng?.metadata?.identity || stablePlayerKey(player);
}

function winsStableDistanceTie(candidate, candidateDistance, incumbent, incumbentDistance) {
  return candidateDistance < incumbentDistance - 1e-9 || (
    Math.abs(candidateDistance - incumbentDistance) <= 1e-9 &&
    (!incumbent || compareStablePlayers(candidate, incumbent) < 0)
  );
}

function stableParity(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 2 ? 1 : -1;
}

function isSustainSupport(player) {
  const hero = HERO_BY_ID[player?.heroId];
  return hero?.role === 'support' && hero.teamFunctions?.includes('continuous_sustain');
}

function focusStateFor(world) {
  let state = SQUAD_FOCUS_BY_WORLD.get(world);
  if (!state) {
    state = new Map();
    SQUAD_FOCUS_BY_WORLD.set(world, state);
  }
  return state;
}

function targetClaimsFor(world) {
  let state = TARGET_CLAIMS_BY_WORLD.get(world);
  if (!state) {
    state = new Map();
    TARGET_CLAIMS_BY_WORLD.set(world, state);
  }
  return state;
}

function distance2d(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1]);
}

function isFlashpointWorld(world) {
  return Boolean(world?.flashpointState && world?.map?.flashpoint);
}

function flashpointRoutePlan(world, team, lane) {
  if (!isFlashpointWorld(world)) return null;
  const plan = resolveFlashpointBotRoute(world, team, lane);
  return plan.status === 'ok' ? plan : null;
}

function routePointsFor(world, team, lane) {
  const flashpointPlan = flashpointRoutePlan(world, team, lane);
  if (flashpointPlan) return flashpointPlan.points;
  // A malformed Flashpoint route must never silently fall back to a legacy
  // mirrored lane. Callers see an empty plan and keep the bot stationary.
  if (isFlashpointWorld(world)) return [];
  const points = world.map?.routes?.[lane] || [];
  if (world.sideOf(team) === 'east') return points.map(point => [...point]);
  return points.map(point => [-point[0], -point[1], point[2]]);
}

function teamStagingPoint(world, team) {
  const points = routePointsFor(world, team, 'front');
  const point = points[Math.min(2, points.length - 1)];
  return point ? [...point] : [...(world.map.objective?.center || [0, 0, 0])];
}

function objectiveClock(world) {
  return typeof world?.respawnClockSec === 'function'
    ? world.respawnClockSec()
    : (Number(world?.objective?.time) || 0);
}

function hasAnchorPressure(world, anchor) {
  if (!anchor?.alive) return false;
  const claim = targetClaimsFor(world).get(anchor.id);
  const claimedTarget = claim ? world.players.get(claim.targetId) : null;
  if (claim?.team === anchor.team && claimedTarget?.alive &&
    claimedTarget.team !== anchor.team && world.t - claim.seenAt <= TARGET_CLAIM_MEMORY_SEC) {
    return true;
  }
  if (anchor.input?.fire || anchor.input?.secondary || anchor.input?.ability1 ||
    anchor.input?.ability2 || anchor.input?.ultimate) return true;
  const mitigationActive = (anchor.shield || 0) > 0 ||
    anchor.abilities?.statuses?.some(status => (
      status.expiresAt > world.t && (status.damageTakenMult || 1) < 1
    )) || world.barriers?.some(barrier => (
      barrier.ownerId === anchor.id && barrier.hp > 0 && barrier.expiresAt > world.t
    ));
  if (mitigationActive) return true;
  const anchorEye = eyePosition(anchor, world.mv);
  return [...world.players.values()].some(enemy => {
    if (!enemy.alive || enemy.team === anchor.team) return false;
    const target = [enemy.move.pos[0], enemy.move.pos[1], enemy.move.pos[2] + 1.1];
    const dx = target[0] - anchorEye[0];
    const dy = target[1] - anchorEye[1];
    const dz = target[2] - anchorEye[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance > 22 || distance <= 1e-6) return false;
    return world.collider.raycast(
      anchorEye[0], anchorEye[1], anchorEye[2],
      dx / distance, dy / distance, dz / distance, distance,
    ) === Infinity;
  });
}

function hasIncomingHostilePressure(world, team, pressureAnchor) {
  if (!pressureAnchor?.alive) return false;
  const claims = targetClaimsFor(world);
  for (const [attackerId, claim] of claims) {
    if (world.t - claim.seenAt > TARGET_CLAIM_MEMORY_SEC) {
      claims.delete(attackerId);
      continue;
    }
    const attacker = world.players.get(attackerId);
    const target = world.players.get(claim.targetId);
    if (!attacker?.alive || !target?.alive || claim.team !== attacker.team ||
      attacker.team === team || target.team !== team) continue;
    // An isolated flanker cannot pull a regrouped squad into a bad re-engage.
    // The claim must land on the connected front owned by the current anchor.
    if (distance2d(target.move.pos, pressureAnchor.move.pos) <= TANK_ALLY_RANGE_M) return true;
  }
  return false;
}

// Team-level tactical state is intentionally shared by every bot. Individual
// line-of-sight or route decisions must never release one survivor while the
// pressure anchor, recovery provider, or respawning teammate is still missing.
export function deriveTeamTacticalIntent(world, team, { heroById = HERO_BY_ID } = {}) {
  let states = TEAM_TACTICS_BY_WORLD.get(world);
  if (!states) {
    states = new Map();
    TEAM_TACTICS_BY_WORLD.set(world, states);
  }
  let state = states.get(team);
  if (!state || state.round !== world.flow.round) {
    state = {
      round: world.flow.round,
      evaluatedAt: Number.NaN,
      released: false,
      retreating: false,
      phase: 'regroup',
      pressureUntil: Number.NEGATIVE_INFINITY,
      intent: null,
    };
    states.set(team, state);
  }
  if (state.evaluatedAt === world.t && state.intent) return state.intent;

  const members = [...world.players.values()].filter(player => player.team === team);
  const alive = members.filter(player => player.alive);
  const dead = members.filter(player => !player.alive);
  const enemyMembers = [...world.players.values()].filter(player => player.team !== team);
  const enemyDead = enemyMembers.filter(player => !player.alive);
  const expectedSize = Math.max(1, Number(world.mode?.teamSize) || 5);
  const staging = teamStagingPoint(world, team);
  const objectiveCenter = world.map.objective.center;
  const pressureAnchor = selectPressureAnchor(alive, objectiveCenter, { heroById });
  const recoveryProvider = selectRecoveryProvider(alive, pressureAnchor, { heroById });
  const staged = alive.filter(player => distance2d(player.move.pos, staging) <= TEAM_REGROUP_STAGE_RADIUS_M);
  const anchorStaged = !!pressureAnchor && staged.some(player => player.id === pressureAnchor.id);
  const providerStaged = !!recoveryProvider && staged.some(player => player.id === recoveryProvider.id);
  const rosterComplete = members.length >= expectedSize;
  const fullTeamAlive = rosterComplete && alive.length >= expectedSize;
  const coreAlive = !!pressureAnchor && !!recoveryProvider;
  const regroupReady = fullTeamAlive && coreAlive && staged.length >= 4 &&
    anchorStaged && providerStaged;
  const casualtyDelta = dead.length - enemyDead.length;
  const deathTimes = dead.map(player => world.respawn?.pending?.get(player.id))
    .filter(Number.isFinite);
  // Anchor the response window to the first unanswered loss.  A second death
  // must not reset the clock and reward an already collapsing team with a
  // longer staggered fight.
  const firstDeathAt = deathTimes.length ? Math.min(...deathTimes) : Number.NEGATIVE_INFINITY;
  const casualtyAgeSec = objectiveClock(world) - firstDeathAt;
  const anchorHoldingPressure = !!pressureAnchor &&
    distance2d(pressureAnchor.move.pos, objectiveCenter) <= TEAM_FRONT_ENGAGE_RADIUS_M &&
    hasAnchorPressure(world, pressureAnchor);
  const incomingHostilePressure = hasIncomingHostilePressure(world, team, pressureAnchor);
  const normalTradeWindowActive = coreAlive && (
    // Keep fighting an equal trade or an advantage while the opposing squad
    // remains on the front.  At a one-player deficit, allow only a short
    // response window; failing to trade then returns the whole team to regroup.
    casualtyDelta <= 0
    || (casualtyDelta === 1 && casualtyAgeSec <= TEAM_TRADE_WINDOW_SEC)
  );
  // Losing the recovery provider used to erase every target on the next bot
  // tick, even when the anchor still owned the front. Preserve only the fresh
  // response window of an already committed fight: it is not a new engage,
  // cannot survive loss of anchor pressure, and cannot outlive the bounded
  // trade timer.
  const providerCasualtyTradeWindow = !recoveryProvider && !!pressureAnchor &&
    state.phase === 'pressure' && anchorHoldingPressure &&
    casualtyDelta === 1 && casualtyAgeSec <= TEAM_TRADE_WINDOW_SEC;
  const tradeWindowActive = state.released && rosterComplete && alive.length >= 3 &&
    (normalTradeWindowActive || providerCasualtyTradeWindow);
  const combatReady = (fullTeamAlive && coreAlive) || tradeWindowActive;

  if (!combatReady) {
    state.retreating = state.retreating || state.released || state.phase !== 'regroup';
    state.released = false;
    state.phase = 'regroup';
    state.pressureUntil = Number.NEGATIVE_INFINITY;
  } else if (!state.released) {
    state.phase = regroupReady ? 'approach' : 'regroup';
    state.released = regroupReady;
    if (regroupReady) state.retreating = false;
  } else {
    const providerCanEstablishPressure = !!recoveryProvider &&
      distance2d(recoveryProvider.move.pos, pressureAnchor.move.pos) <= TANK_SUPPORT_RANGE_M;
    const providerCanMaintainPressure = !!recoveryProvider &&
      distance2d(recoveryProvider.move.pos, pressureAnchor.move.pos) <=
        TANK_SUPPORT_PRESSURE_RELEASE_RANGE_M;
    const anchorNearFront = distance2d(pressureAnchor.move.pos, objectiveCenter) <=
      TEAM_FRONT_ENGAGE_RADIUS_M;
    const frontReadyCount = alive.filter(player => (
      distance2d(player.move.pos, objectiveCenter) <= TEAM_FRONT_ENGAGE_RADIUS_M
    )).length;
    const requiredFrontReady = Math.min(4, alive.length);
    const defensiveCommitReady = incomingHostilePressure && anchorNearFront &&
      providerCanEstablishPressure && frontReadyCount >= Math.min(3, alive.length);
    if ((anchorNearFront && providerCanEstablishPressure &&
      frontReadyCount >= requiredFrontReady && anchorHoldingPressure) || defensiveCommitReady) {
      state.pressureUntil = world.t + TEAM_PRESSURE_MEMORY_SEC;
    }
    // Requiring all four front-ready members on every tick makes a legitimate
    // side angle tear down the whole engagement the instant that DPS crosses
    // the 18m boundary.  Keep the strict four-player gate for entry above, then
    // latch the fight through the short pressure-memory window while its anchor
    // and provider core are still connected.
    state.phase = providerCasualtyTradeWindow || (
      state.pressureUntil > world.t && anchorNearFront && providerCanMaintainPressure
    ) ? 'pressure' : 'approach';
  }

  state.evaluatedAt = world.t;
  state.intent = Object.freeze({
    phase: state.phase,
    staging: Object.freeze(staging),
    expectedSize,
    aliveCount: alive.length,
    stagedCount: staged.length,
    rosterComplete,
    fullTeamAlive,
    pressureAnchorId: pressureAnchor?.id || null,
    recoveryProviderId: recoveryProvider?.id || null,
    anchorStaged,
    providerStaged,
    // Legacy aliases remain during the public-intent migration.
    tankStaged: anchorStaged,
    sustainStaged: providerStaged,
    regroupReady,
    coreAlive,
    casualtyDelta,
    tradeWindowActive,
    providerCasualtyTradeWindow,
    sustainCasualtyTradeWindow: providerCasualtyTradeWindow,
    incomingHostilePressure,
    retreating: state.retreating,
  });
  return state.intent;
}

export function deriveFrontlineAnchor(objectiveCenter, teamSide, tankPosition) {
  const forward = teamSide === 'east' ? [-1, 0] : [1, 0];
  const position = [tankPosition[0], tankPosition[1]];
  return {
    position,
    forward,
    progress: (position[0] - objectiveCenter[0]) * forward[0] +
      (position[1] - objectiveCenter[1]) * forward[1],
  };
}

// 各ヒーロー4アクションの優先方針。whenは距離、味方HP、敵密度、資源、CD、ultを
// combatContextへ正規化した上で評価する。ready/resource/ultの共通ゲートは別途必ず通す。
export function botAimFloorDeg(distanceM) {
  const distance = Math.max(1, Number(distanceM) || 1);
  const bodyScaleErrorDeg = Math.atan2(0.2, distance) * 180 / Math.PI;
  return Math.min(0.8, Math.max(0.2, bodyScaleErrorDeg));
}

const HERO_POLICIES = Object.freeze({
  zairu: {
    range: [2, 9],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 20,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && c.enemyDistance <= 20],
      ['ability2', c => c.hasRewind && c.inFight && (
        c.selfHpRatio < 0.65 || (c.rewindRemainingSec < 1 && c.selfHpRatio < 0.85)
      )],
      ['ability1', c => c.hasAnchor || (
        c.resourceRatio >= 0.4 && between(c.enemyDistance, 7, 28)
      )],
      ['secondary', c => c.hasAnchor && c.enemyDistance <= 28],
    ],
  },
  baraga: {
    range: [2, 6],
    ultimateLiveness: c => c.inFight && ((c.enemyDensity >= 1 && c.enemyDistance <= 8) ||
      c.selfHpRatio < 0.78 || (c.allyHpRatio < 0.78 && c.allyDistance <= 8)),
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 || c.teamInjured >= 2],
      ['ability1', c => c.resourceValue >= 35 && c.enemyDistance <= 14 && (c.enemyDensity >= 2 || c.allyHpRatio < 0.7 || c.objectiveContested)],
      ['ability2', c => c.enemyDistance <= 6 && c.enemyDensity >= 1],
      ['secondary', c => c.selfHpRatio < 0.75 || c.enemyDistance <= 5],
    ],
  },
  vesta: {
    range: [14, 32],
    ultimateLiveness: c => c.enemyDensity >= 1 && between(c.enemyDistance, 8, 30),
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && between(c.enemyDistance, 8, 30)],
      ['secondary', c => c.resourceValue >= 10 && c.enemyDensity >= 2 && between(c.enemyDistance, 10, 30)],
      ['ability2', c => c.hasOwnZone && c.enemyDensity >= 1 && c.enemyDistance <= 12],
      ['ability1', c => c.resourceValue >= 15 && (c.enemyDistance < 12 || c.selfHpRatio < 0.55)],
    ],
  },
  nuedori: {
    range: [8, 20],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 18,
    actions: [
      ['ultimate', c => c.enemyDensity >= 1 && c.enemyDistance <= 18],
      ['ability1', c => c.enemyDensity >= 2 && c.enemyDistance <= 18],
      ['ability2', c => c.enemyDistance <= 24 && c.enemyDensity >= 1],
      ['secondary', c => c.enemyDistance < 9 || c.selfHpRatio < 0.55],
    ],
  },
  sedora: {
    range: [6, 18],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 20,
    actions: [
      ['ultimate', c => c.objectiveContested && (c.enemyDensity >= 2 || c.teamInjured >= 1)],
      ['ability1', c => c.enemyDistance <= 14 && (c.objectiveContested || c.allyHpRatio < 0.75)],
      ['ability2', c => c.enemyDistance <= 20 && c.enemyDensity >= 1],
      ['secondary', c => c.selfHpRatio < 0.72 || c.enemyDistance <= 6],
    ],
  },
  shiomaneki: {
    range: [5, 15],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 24,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 || c.objectiveContested],
      ['ability1', c => c.enemyDistance <= 18 && (c.enemyDensity >= 2 || c.allyHpRatio < 0.78)],
      ['ability2', c => c.enemyDistance <= 8 && c.enemyDensity >= 1],
      ['secondary', c => c.enemyDistance > 14 || c.selfHpRatio < 0.6],
    ],
  },
  asagi: {
    range: [12, 27],
    ultimateLiveness: c => c.enemyDensity >= 1,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 || c.enemyMarked],
      ['ability1', c => between(c.enemyDistance, 9, 35) && c.resourceValue < 3],
      ['secondary', c => between(c.enemyDistance, 14, 34) && c.enemyDensity >= 1],
      ['ability2', c => {
        const fieldRadiusM = c.hero?.abilities?.ability2?.radiusM || 4;
        return c.enemyDistance < 10 || c.selfHpRatio < 0.72 ||
          (c.pressureAnchorDistance <= fieldRadiusM && c.pressureAnchorHpRatio < 0.78) ||
          (c.recoveryProviderDistance <= fieldRadiusM && c.recoveryProviderHpRatio < 0.78) ||
          (c.allyDistance <= fieldRadiusM && c.allyHpRatio < 0.65);
      }],
    ],
  },
  shirasagi: {
    range: [24, 50],
    ultimateLiveness: c => c.enemyDistance >= 18 && c.enemyDensity >= 1,
    actions: [
      ['ultimate', c => c.enemyDistance >= 18 && c.enemyDensity >= 1],
      ['ability1', c => between(c.enemyDistance, 12, 28) && c.enemyDensity >= 1],
      ['ability2', c => c.enemyDistance < 16 || c.selfHpRatio < 0.55],
      ['secondary', c => c.enemyDistance < 24 || c.hasNegativeStatus],
    ],
  },
  tsubakuro: {
    range: [7, 18],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 25,
    actions: [
      ['ultimate', c => c.resourceValue >= 50 && (c.enemyDensity >= 2 || c.selfHpRatio < 0.65)],
      ['secondary', c => c.resourceValue >= 30 && between(c.enemyDistance, 6, 25)],
      ['ability2', c => c.ammoRatio <= 0.5 || c.resourceRatio < 0.35],
      ['ability1', c => c.resourceRatio < 0.7 && between(c.enemyDistance, 7, 24)],
    ],
  },
  hokuchi: {
    range: [3, 10],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 6,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && c.enemyDistance <= 6],
      ['ability1', c => c.resourceValue >= 30 && c.enemyDistance <= 18 && c.enemyDensity >= 1],
      ['secondary', c => c.enemyOiled || (c.enemyDistance <= 15 && c.cooldowns.ability1 > 0)],
      ['ability2', c => c.enemyDistance > 11 || c.selfHpRatio < 0.55],
    ],
  },
  botan: {
    range: [14, 28],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 32,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && c.enemyDistance <= 32],
      ['ability1', c => c.enemyDensity >= 2 && c.enemyDistance <= 24],
      ['secondary', c => between(c.enemyDistance, 10, 30) && c.enemyDensity >= 1],
      ['ability2', c => c.enemyDistance < 10 || c.selfHpRatio < 0.55],
    ],
  },
  ankou: {
    range: [16, 34],
    ultimateLiveness: c => c.enemyDensity >= 1 && between(c.enemyDistance, 10, 45),
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && between(c.enemyDistance, 10, 45)],
      ['ability1', c => c.resourceValue >= 25 && c.enemyDistance <= 35 && c.enemyDensity >= 1],
      ['secondary', c => between(c.enemyDistance, 14, 35) && c.enemyDensity >= 1],
      ['ability2', c => c.enemyDistance < 13 || c.selfHpRatio < 0.5],
    ],
  },
  tsuzuri: {
    range: [14, 28],
    ultimateLiveness: c => c.allyStoredHeal > 0 && c.allyDistance <= 14,
    actions: [
      ['ultimate', c => c.teamInjured >= 2 || c.teamStoredHeal >= 80],
      ['ability2', c => c.allyStoredHeal > 0 && c.allyHpRatio < 0.72],
      ['ability1', c => c.allyHpRatio < 0.68 && between(c.allyDistance, 5, 28)],
    ],
  },
  koyomi: {
    range: [13, 24],
    ultimateLiveness: c => c.cooldownBurden >= 6 &&
      (c.enemyDensity >= 1 || c.teamInjured >= 1),
    actions: [
      ['ultimate', c => c.cooldownBurden >= 16 && (c.enemyDensity >= 1 || c.teamInjured >= 1)],
      ['ability1', c => c.resourceValue >= 35 && (c.cooldownBurden >= 5 || c.allyHpRatio < 0.78)],
      ['ability2', c => c.resourceValue >= 35 && c.enemyDensity >= 2 && c.enemyDistance <= 20],
      ['secondary', c => c.enemyDistance <= 14 && !c.hasOwnZone],
    ],
  },
  karakasa: {
    range: [7, 16],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 22,
    actions: [
      ['ultimate', c => c.teamInjured >= 2 || (c.enemyDensity >= 2 && c.allyHpRatio < 0.8)],
      ['ability2', c => c.enemyDistance <= 5 && c.enemyDensity >= 1],
      ['secondary', c => c.enemyDistance < 9 || c.selfHpRatio < 0.65],
      ['ability1', c => c.allyHpRatio < 0.72 || c.enemyDistance > 16],
    ],
  },
  shirabe: {
    range: [13, 25],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.alliesNearby >= 1,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && c.alliesNearby >= 1],
      ['ability1', c => hasActionResource(c, 'ability1') && !!c.enemy && !!c.linkedAlly &&
        c.linkedEmpoweredHits <= 0],
      ['ability2', c => c.allyHpRatio < 0.55 && c.allyDistance > 8],
      ['secondary', c => !!c.damageAlly && (!c.linkedAlly || c.linkNearExpiry)],
    ],
  },
  hibari: {
    range: [12, 24],
    ultimateLiveness: c => c.allyHpRatio < 0.78 && c.allyDistance <= 4,
    actions: [
      ['ultimate', c => c.teamInjured >= 2 || (c.objectiveContested && c.allyHpRatio < 0.7)],
      ['ability2', c => c.allyHpRatio < 0.65 && c.allyDistance <= 5],
      ['ability1', c => c.allyHpRatio < 0.8 || c.enemyDensity >= 2],
      ['secondary', c => c.allyDistance > 18 || c.enemyDistance < 10],
    ],
  },
  kazura: {
    range: [10, 20],
    ultimateLiveness: c => c.allyHpRatio < 0.78 && c.allyDistance <= 14,
    actions: [
      ['ultimate', c => c.teamInjured >= 2 && c.alliesNearby >= 1],
      ['ability1', c => c.resourceValue >= 50 && c.allyHpRatio < 0.72 && c.allyDistance <= 6.5],
      ['ability2', c => c.enemyDistance <= 6 && c.enemyDensity >= 1],
      ['secondary', c => c.allyHpRatio < 0.82 && c.allyDistance <= 25],
    ],
  },
});

export class BotController {
  constructor(world, player, rng) {
    this.world = world;
    this.pl = player;
    this.rng = rng;
    this.mode = 'regroup';
    this.route = this.chooseRoute();
    this.teamTacticalPhase = null;
    this.projectedRouteName = null;
    this.wpIndex = 0;
    this.aimErr = 6;            // 度。可視中に収束
    this.targetId = null;
    this.targetLostT = 0;
    this.lastKnownTargetPos = null;
    this.targetMemoryUntil = 0;
    this.pursuitPath = [];
    this.pursuitGoal = null;
    this.pursuitReplanAt = 0;
    this.combatDetourPath = [];
    this.supportCoverPath = [];
    this.supportCoverThreatId = null;
    this.supportCoverReplanAt = 0;
    this.supportCoverCommitUntil = 0;
    this.supportRescuePath = [];
    this.supportRescueTargetId = null;
    this.supportRescueGoal = null;
    this.supportRescueReplanAt = 0;
    this.ignoredFocusTargetId = null;
    this.ignoredFocusUntil = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.stallT = 0;
    this.regroupT = 0;
    this.holdAngle = rng() * Math.PI * 2
      + (world.sideOf(player.team) === 'west' ? Math.PI : 0);
    this.wasAlive = true;
    this.lastRound = 1;
    this.progressPos = null;   // 実変位ベースのスタック検知
    this.progressT = 0;
    this.seq = player.lastAckSeq || 0;
    this.lastPulseSlot = null;
    this.ultimateReadySince = null;
    this.needleReloading = false;
    this.damageSamples = [];
    this.lastObservedEffectiveHp = player.hp + (player.shield || 0);
    this.lastDefensiveActionAt = Number.NEGATIVE_INFINITY;
    this.pendingActionIntent = null;
    this.pendingActionTargetId = null;
    this.recoveryPath = [];
    this.routeRecoveryPlanRetryAt = 0;
    this.routeRecoveryPlanStart = null;
    this.routeRecoveryPlanKey = null;
    this.regroupGoal = null;
    this.regroupPlanRetryAt = 0;
    this.regroupPlanStart = null;
    this.dpsAngleRecoveryGoal = null;
    this.dpsAngleRecoveryRetryAt = 0;
    this.lowGroundT = 0;
    this.ledgeAvoidances = 0;
    this.ledgeBrakeT = 0;
    this.ledgeBrakeYaw = 0;
  }

  chooseRoute() {
    const role = HERO_BY_ID[this.pl.heroId]?.role;
    if (role === 'frontline' || role === 'support') return 'front';
    return DAMAGE_ROUTES[Math.min(
      DAMAGE_ROUTES.length - 1,
      Math.floor(this.rng() * DAMAGE_ROUTES.length),
    )];
  }

  syncTeamTacticalPhase(intent, coordinatedTeam) {
    if (!coordinatedTeam) {
      this.teamTacticalPhase = null;
      this.projectedRouteName = null;
      return;
    }
    const phaseChanged = this.teamTacticalPhase !== intent.phase;
    this.teamTacticalPhase = intent.phase;
    const activeRoute = this.activeRouteName();
    const routeKey = this.routeIdentity(activeRoute);
    const routeChanged = this.projectedRouteName !== routeKey;
    this.projectedRouteName = routeKey;
    if (!phaseChanged && !routeChanged) return;
    // Each phase owns its own route progress.  Reproject against the active
    // route on phase or route transition so a DPS cannot resume an index from
    // a different lane after the anchor-led front approach releases.
    if (intent.phase === 'approach' || intent.phase === 'pressure') {
      const preStagingSideAngle = intent.phase === 'approach' &&
        HERO_BY_ID[this.pl.heroId]?.role === 'damage' && activeRoute !== 'front';
      this.wpIndex = this.nearestWpIndex({ forwardOnly: preStagingSideAngle });
    }
  }

  submit(input) {
    this.applyLedgeSafety(input);
    this.world.queueInput(this.pl.id, { ...input, seq: ++this.seq });
  }

  applyLedgeSafety(input) {
    if (!this.pl.alive || this.world.flow.state !== 'ACTIVE') return;
    if (this.ledgeBrakeT > 0) {
      this.ledgeBrakeT = Math.max(0, this.ledgeBrakeT - this.world.dt);
      this.steerTowardAngle(input, this.ledgeBrakeYaw);
      input.jump = false;
      return;
    }
    const velocity = this.pl.move.vel;
    const speed = Math.hypot(velocity[0], velocity[1]);
    if (this.pl.move.grounded && speed > 0.6) {
      const movement = this.world.mv || this.world.combat?.movement || {};
      const brakingAccel = Math.max(1, movement.accelMps2 || movement.frictionMps2 || 18);
      const brakingDistance = Math.max(
        1.25,
        speed * speed / (2 * brakingAccel) + (movement.capsuleRadiusM || 0.4) + 0.35,
      );
      const velocityYaw = Math.atan2(velocity[1], velocity[0]);
      if (!hasSafeGroundPath(this.world, this.pl, velocityYaw, brakingDistance)) {
        this.ledgeAvoidances++;
        this.ledgeBrakeT = LEDGE_BRAKE_HOLD_SEC;
        this.ledgeBrakeYaw = velocityYaw + Math.PI;
        this.steerTowardAngle(input, this.ledgeBrakeYaw);
        input.jump = false;
        if (hasSafeGroundAhead(this.world, this.pl, input, 0.8)) return;
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
        if (this.mode === 'pursue') this.planPursuit(this.lastKnownTargetPos);
        else if (this.mode === 'advance' || this.mode === 'regroup') this.rejoinCurrentRoute();
        return;
      }
    }
    const intendedProbeM = input.jump ? 1.6 : 1.05;
    if (hasSafeGroundAhead(this.world, this.pl, input, intendedProbeM)) return;
    this.ledgeAvoidances++;
    const hasLateral = input.l || input.r;
    if (hasLateral) {
      const alternative = { ...input, l: !!input.r, r: !!input.l };
      if (hasSafeGroundAhead(this.world, this.pl, alternative)) {
        input.l = alternative.l;
        input.r = alternative.r;
        this.strafeDir *= -1;
        this.strafeT = Math.max(this.strafeT, 0.45);
        return;
      }
    }
    input.f = false;
    input.b = false;
    input.l = false;
    input.r = false;
    input.jump = false;
    if (this.mode === 'pursue') this.planPursuit(this.lastKnownTargetPos);
    else if (this.mode === 'advance' || this.mode === 'regroup') this.rejoinCurrentRoute();
  }

  pulseAction(input, slot) {
    if (!slot) {
      this.lastPulseSlot = null;
      return;
    }
    if (this.lastPulseSlot === slot) {
      this.lastPulseSlot = null;
      return;
    }
    input[slot] = true;
    this.lastPulseSlot = slot;
  }

  resetDamageObservation() {
    this.damageSamples = [];
    this.lastObservedEffectiveHp = this.pl.hp + (this.pl.shield || 0);
  }

  observeDamagePressure() {
    const effectiveHp = this.pl.hp + (this.pl.shield || 0);
    if (Number.isFinite(this.lastObservedEffectiveHp) && effectiveHp < this.lastObservedEffectiveHp) {
      this.damageSamples.push({
        at: this.world.t,
        amount: this.lastObservedEffectiveHp - effectiveHp,
      });
    }
    this.lastObservedEffectiveHp = effectiveHp;
    const cutoff = this.world.t - DEFENSE_DAMAGE_WINDOW_SEC;
    while (this.damageSamples.length && this.damageSamples[0].at < cutoff) this.damageSamples.shift();
  }

  recentDamageAmount() {
    const cutoff = this.world.t - DEFENSE_DAMAGE_WINDOW_SEC;
    return this.damageSamples.reduce((total, sample) => (
      sample.at >= cutoff ? total + sample.amount : total
    ), 0);
  }

  combatContext(enemy = null) {
    const pl = this.pl;
    const hero = HERO_BY_ID[pl.heroId];
    const ally = this.woundedAlly();
    const rescueAlly = this.rescueAlly();
    const blockedRescueAlly = rescueAlly && !this.hasAllyLineOfSight(rescueAlly)
      ? rescueAlly
      : null;
    const enemies = [];
    const allies = [];
    for (const other of this.world.players.values()) {
      if (!other.alive || other.id === pl.id) continue;
      if (other.team === pl.team) allies.push(other); else enemies.push(other);
    }
    const distanceTo = other => other ? Math.hypot(
      other.move.pos[0] - pl.move.pos[0],
      other.move.pos[1] - pl.move.pos[1],
      other.move.pos[2] - pl.move.pos[2],
    ) : Infinity;
    const distanceBetween = (a, b) => Math.hypot(
      a.move.pos[0] - b.move.pos[0],
      a.move.pos[1] - b.move.pos[1],
      a.move.pos[2] - b.move.pos[2],
    );
    const storedHeal = other => other?.abilities?.statuses
      ?.filter(status => status.kind === 'stored_heal')
      .reduce((sum, status) => sum + (status.amount || 0), 0) || 0;
    const resourceValue = pl.resource?.value || 0;
    const resourceMax = pl.resource?.max || 0;
    const team = [pl, ...allies];
    const pressureAnchor = selectPressureAnchor(team, this.world.map.objective.center);
    const recoveryProvider = selectRecoveryProvider(team, pressureAnchor);
    const enemyStatuses = enemy?.abilities?.statuses || [];
    const nearestAlly = allies.reduce((best, other) => (
      winsStableDistanceTie(other, distanceTo(other), best, distanceTo(best)) ? other : best
    ), null);
    const visibleWithin = (other, maxRange) => {
      if (!other || distanceTo(other) > maxRange) return false;
      const eye = eyePosition(pl, this.world.mv);
      const target = [other.move.pos[0], other.move.pos[1], other.move.pos[2] + 1.1];
      const dx = target[0] - eye[0];
      const dy = target[1] - eye[1];
      const dz = target[2] - eye[2];
      const distance = Math.hypot(dx, dy, dz);
      return distance > 1e-6 && this.world.collider.raycast(
        eye[0], eye[1], eye[2], dx / distance, dy / distance, dz / distance, distance,
      ) === Infinity;
    };
    const nearestEnemyDistanceFrom = (actor) => enemies.reduce((nearest, other) => Math.min(
      nearest,
      Math.hypot(
        other.move.pos[0] - actor.move.pos[0],
        other.move.pos[1] - actor.move.pos[1],
        other.move.pos[2] - actor.move.pos[2],
      ),
    ), Infinity);
    const selfEnemyClearance = nearestEnemyDistanceFrom(pl);
    const escapeDefinition = hero?.abilities?.ability1?.behavior === 'ally_grapple'
      ? hero.abilities.ability1
      : null;
    const escapeRangeM = escapeDefinition
      ? (escapeDefinition.rangeM || 28)
      : 0;
    const selfHostileClaimers = this.hostileTargetClaimers(pl.id);
    const selfHostileClaims = selfHostileClaimers.length;
    const recentDamageSource = this.world.players.get(pl.lastDamageSourceId);
    const recentDamageThreat = recentDamageSource?.alive && recentDamageSource.team !== pl.team &&
      this.world.t - (pl.lastDamageTakenAt ?? Number.NEGATIVE_INFINITY) <= 2.5
      ? recentDamageSource
      : null;
    const selfThreat = selfHostileClaimers
      .sort((left, right) => distanceTo(left) - distanceTo(right) || compareStablePlayers(left, right))[0]
      || recentDamageThreat
      || null;
    const grappleStopPoint = (other) => {
      const dx = other.move.pos[0] - pl.move.pos[0];
      const dy = other.move.pos[1] - pl.move.pos[1];
      const distance = Math.hypot(dx, dy);
      const travel = Math.max(0, distance - Math.max(0, escapeDefinition?.stopDistanceM ?? 2));
      if (distance <= 1e-6) return [...pl.move.pos];
      return [
        pl.move.pos[0] + dx / distance * travel,
        pl.move.pos[1] + dy / distance * travel,
        pl.move.pos[2],
      ];
    };
    const canReachEscapeAlly = (other) => canAffectTarget(
      this.world,
      playerTargetPoint(pl, this.world.mv),
      other,
      { sourceId: pl.id, rangeM: escapeRangeM, rangeOrigin: pl.move.pos },
    ) && canTraverseGroundSegment(this.world, [...pl.move.pos], grappleStopPoint(other));
    const supportEscapeAlly = hero?.role === 'support' && escapeRangeM > 0 &&
      pl.move.grounded && !isOnAuthoredStair(this.world, pl) &&
      this.recoveryPath.length === 0 && this.combatDetourPath.length === 0
      ? allies
        .filter(other => (
          other.id === pressureAnchor?.id &&
          distanceTo(other) >= 4 &&
          canReachEscapeAlly(other) &&
          nearestEnemyDistanceFrom(other) >= selfEnemyClearance + 2
        ))
        .sort((left, right) => (
          nearestEnemyDistanceFrom(right) - nearestEnemyDistanceFrom(left) ||
          distanceTo(left) - distanceTo(right) || compareStablePlayers(left, right)
        ))[0] || null
      : null;
    const linkDefinition = Object.values(hero?.abilities || {})
      .find(definition => definition.behavior === 'link_ally');
    const buffDefinition = Object.values(hero?.abilities || {})
      .find(definition => definition.behavior === 'ally_damage_buff');
    const damageAlly = linkDefinition
      ? allies.filter(other => HERO_BY_ID[other.heroId]?.role === 'damage' &&
        visibleWithin(other, linkDefinition.rangeM || Infinity))
        .sort((left, right) => distanceTo(left) - distanceTo(right) || compareStablePlayers(left, right))[0] || null
      : null;
    const linkedCandidate = this.world.players.get(pl.abilities?.heroState?.linkedId);
    const linkRemainingSec = Math.max(0,
      (pl.abilities?.heroState?.linkExpiresAt || 0) - this.world.t);
    const linkedAlly = linkedCandidate?.alive && linkedCandidate.team === pl.team &&
      HERO_BY_ID[linkedCandidate.heroId]?.role === 'damage' && linkRemainingSec > 0 &&
      visibleWithin(linkedCandidate, buffDefinition?.rangeM || Infinity)
      ? linkedCandidate
      : null;
    const linkRefreshLeadSec = Math.min(
      linkDefinition?.durationSec || Infinity,
      Math.max(this.world.dt, linkDefinition?.cooldownSec || 0),
    );
    const linkedEmpowerment = linkedAlly?.abilities?.heroState?.empoweredHits;
    const sustain = allies.reduce((best, other) => {
      if (!isSustainSupport(other)) return best;
      return winsStableDistanceTie(other, distanceTo(other), best, distanceTo(best)) ? other : best;
    }, null);
    const recentDamage = this.recentDamageAmount();
    const incomingDps = recentDamage / DEFENSE_DAMAGE_WINDOW_SEC;
    const effectiveHp = pl.hp + (pl.shield || 0);
    const selfHpRatio = pl.hp / Math.max(1, pl.maxHp);
    const estimatedTtdSec = incomingDps > 0 ? effectiveHp / incomingDps : Infinity;
    const selfUnderPressure = (
      selfHostileClaims >= PRELOAD_HOSTILE_CLAIMS ||
      (selfHostileClaims >= 1 && (recentDamage >= 24 || selfHpRatio < 0.85)) ||
      (!!recentDamageThreat && recentDamage >= 24) ||
      selfHpRatio < 0.55 || estimatedTtdSec < 1.8
    );
    const supportUnderPressure = hero?.role === 'support' && selfUnderPressure;
    const damageReductionRemainingSec = pl.abilities?.statuses
      ?.filter(status => (status.damageTakenMult || 1) < 1 && status.expiresAt > this.world.t)
      .reduce((remaining, status) => Math.max(remaining, status.expiresAt - this.world.t), 0) || 0;
    const ownedBarrierNearby = this.world.barriers?.some(barrier => (
      barrier.ownerId === pl.id && barrier.hp > 0 && barrier.expiresAt > this.world.t &&
      distance2d(barrier.center, pl.move.pos) <= Math.max(9, (barrier.radiusM || 0) + 5)
    )) || false;
    return {
      hero,
      enemy,
      ally,
      rescueAlly,
      blockedRescueAlly,
      supportEscapeAlly,
      selfThreat,
      selfUnderPressure,
      supportUnderPressure,
      nearestAlly,
      pressureAnchor,
      recoveryProvider,
      damageAlly,
      linkedAlly,
      sustain,
      inFight: !!enemy,
      enemyDistance: distanceTo(enemy),
      allyDistance: distanceTo(ally),
      rescueAllyDistance: distanceTo(rescueAlly),
      nearestAllyDistance: distanceTo(nearestAlly),
      pressureAnchorDistance: distanceTo(pressureAnchor),
      recoveryProviderDistance: distanceTo(recoveryProvider),
      enemyDensity: enemy
        ? enemies.filter(other => distanceBetween(other, enemy) <= 8).length
        : 0,
      alliesNearby: allies.filter(other => distanceTo(other) <= 14).length,
      teamInjured: team.filter(other => other.hp / Math.max(1, other.maxHp) < 0.78).length,
      selfHpRatio,
      selfHostileClaims,
      shieldRatio: (pl.shield || 0) / Math.max(1, pl.maxHp),
      recentDamage,
      incomingDps,
      estimatedTtdSec,
      damageReductionRemainingSec,
      ownedBarrierNearby,
      allyHpRatio: ally ? ally.hp / Math.max(1, ally.maxHp) : 1,
      pressureAnchorHpRatio: pressureAnchor
        ? pressureAnchor.hp / Math.max(1, pressureAnchor.maxHp)
        : 1,
      recoveryProviderHpRatio: recoveryProvider
        ? recoveryProvider.hp / Math.max(1, recoveryProvider.maxHp)
        : 1,
      resourceValue,
      resourceRatio: resourceMax ? resourceValue / resourceMax : 0,
      ammoRatio: hero?.weapon?.magSize ? pl.weapon.ammo / hero.weapon.magSize : 1,
      cooldowns: pl.abilities?.cooldowns || {},
      cooldownBurden: team.reduce((total, other) => total + Object.values(other.abilities?.cooldowns || {})
        .reduce((sum, value) => sum + Math.max(0, value || 0), 0), 0),
      allyStoredHeal: storedHeal(ally),
      teamStoredHeal: team.reduce((sum, other) => sum + storedHeal(other), 0),
      linkRemainingSec,
      linkNearExpiry: !!linkedAlly && linkRemainingSec <= linkRefreshLeadSec,
      linkedEmpoweredHits: linkedEmpowerment?.sourceId === pl.id
        ? Math.max(0, linkedEmpowerment.remaining || 0)
        : 0,
      hasAnchor: !!pl.abilities?.heroState?.anchor,
      hasRewind: !!pl.abilities?.heroState?.rewind &&
        pl.abilities.heroState.rewind.expiresAt > this.world.t,
      rewindRemainingSec: Math.max(0,
        (pl.abilities?.heroState?.rewind?.expiresAt || 0) - this.world.t),
      hasOwnZone: this.world.zones?.some(zone => zone.ownerId === pl.id) || false,
      hasNegativeStatus: pl.abilities?.statuses?.some(status => status.negative) || false,
      enemyMarked: enemyStatuses.some(status => status.kind === 'reveal' && (status.stacks || 0) >= 3),
      enemyOiled: enemyStatuses.some(status => status.kind === 'oiled' || status.status === 'oiled'),
      objectiveContested: (this.world.objective.owner >= 0 && this.world.objective.owner !== pl.team) ||
        !!this.world.objective.ot?.active,
    };
  }

  canUseAction(slot) {
    const pl = this.pl;
    const definition = HERO_BY_ID[pl.heroId]?.abilities?.[slot];
    if (!definition || pl.abilities?.cast) return false;
    if (slot === 'ultimate') return pl.ultGauge >= (definition.ultCost || 100);
    if ((pl.abilities?.cooldowns?.[slot] || 0) > this.world.dt) return false;
    if (definition.resourceCost && (!pl.resource || pl.resource.value < definition.resourceCost)) return false;
    return true;
  }

  isFrontlineDefensiveAction(slot) {
    return FRONTLINE_DEFENSIVE_SLOTS[this.pl.heroId]?.has(slot) || false;
  }

  isCriticalDefenseContext(context) {
    return context.selfHpRatio < 0.45 || context.estimatedTtdSec < 1.8;
  }

  shouldDeferDefensiveAction(slot, context) {
    if (!this.isFrontlineDefensiveAction(slot)) return false;
    const critical = this.isCriticalDefenseContext(context);
    const spacing = critical ? DEFENSE_CRITICAL_SPACING_SEC : DEFENSE_ACTION_SPACING_SEC;
    if (this.world.t - this.lastDefensiveActionAt < spacing) return true;
    if (!critical && (
      context.damageReductionRemainingSec > 0.4 || context.ownedBarrierNearby
    )) return true;
    if (this.pl.heroId === 'vesta' && slot === 'secondary' && context.hasOwnZone) return true;
    return false;
  }

  frontlineDefensiveDecision(context) {
    if (HERO_BY_ID[this.pl.heroId]?.role !== 'frontline') return null;
    const critical = this.isCriticalDefenseContext(context);
    const pressured = critical || context.recentDamage >= 24 || (
      context.inFight && (context.selfHpRatio < 0.82 || context.teamInjured >= 2)
    );
    if (!pressured) return null;

    const choose = (slot, intent) => {
      if (!this.canUseAction(slot) || this.shouldDeferDefensiveAction(slot, context)) return null;
      if (!this.movementActionIsSafe(slot, context, intent)) return null;
      return { slot, intent };
    };
    const heroId = this.pl.heroId;
    if (heroId === 'zairu') {
      return critical && context.hasRewind ? choose('ability2', 'retreat') : null;
    }
    if (heroId === 'baraga') {
      return ((critical || context.selfHpRatio < 0.7) && choose('secondary', 'mitigate'))
        || choose('ability1', 'barrier')
        || choose('secondary', 'mitigate');
    }
    if (heroId === 'vesta') {
      return (critical && choose('ability1', 'retreat'))
        // A frontline does not need to wait for a two-person burst before
        // cycling its damage-slow field.  Sustained single-target pressure is
        // the normal tank/healer loop; holding this until enemyDensity >= 2
        // left Vesta exposed to one focused DPS and made mirrored fights
        // collapse before the support could convert healing into space.
        || ((context.enemyDensity >= 2 || context.selfHpRatio < 0.82 ||
          context.recentDamage >= 24) && choose('secondary', 'mitigate'));
    }
    if (heroId === 'nuedori') {
      return (critical && choose('secondary', 'retreat'))
        || (context.enemyDensity >= 2 && choose('ability1', 'mitigate'));
    }
    if (heroId === 'sedora') {
      return ((critical || context.selfHpRatio < 0.7) && choose('secondary', 'mitigate'))
        || choose('ability1', 'barrier')
        || choose('secondary', 'mitigate');
    }
    if (heroId === 'shiomaneki') {
      return (critical && choose('secondary', 'retreat'))
        || choose('ability1', 'mitigate');
    }
    return null;
  }

  supportDefensiveDecision(context) {
    if (HERO_BY_ID[this.pl.heroId]?.role !== 'support') return null;
    if (!context.supportUnderPressure) return null;
    if (this.pl.heroId === 'tsuzuri' && context.supportEscapeAlly && this.canUseAction('ability1')) {
      return {
        slot: 'ability1',
        intent: 'support_escape',
        targetId: context.supportEscapeAlly.id,
      };
    }
    return null;
  }

  applyHeroAction(input, context, { defenseOnly = false } = {}) {
    // A cast-time defensive movement still needs its original escape intent
    // on the windup ticks.  Clearing this every think made Vesta turn back to
    // the enemy before the dash actually executed.
    if (!this.pl.abilities?.cast) {
      this.pendingActionIntent = null;
      this.pendingActionTargetId = null;
    }
    const policy = HERO_POLICIES[this.pl.heroId];
    if (!policy) {
      this.pulseAction(input, null);
      return null;
    }
    const defensiveDecision = this.frontlineDefensiveDecision(context);
    if (defensiveDecision) {
      this.pulseAction(input, defensiveDecision.slot);
      if (input[defensiveDecision.slot]) {
        this.lastDefensiveActionAt = this.world.t;
        this.pendingActionIntent = defensiveDecision.intent;
      }
      return defensiveDecision.slot;
    }
    const supportDefensiveDecision = this.supportDefensiveDecision(context);
    if (supportDefensiveDecision) {
      this.pulseAction(input, supportDefensiveDecision.slot);
      if (input[supportDefensiveDecision.slot]) {
        this.lastDefensiveActionAt = this.world.t;
        this.pendingActionIntent = supportDefensiveDecision.intent;
        this.pendingActionTargetId = supportDefensiveDecision.targetId;
      }
      return supportDefensiveDecision.slot;
    }
    if (defenseOnly) {
      this.pulseAction(input, null);
      return null;
    }
    if (this.pl.heroId === 'tsuzuri') {
      const magSize = Math.max(1, context.hero?.weapon?.magSize || 12);
      const combatReserve = Math.ceil(magSize * 0.25);
      const safeReserve = Math.ceil(magSize * 0.85);
      const targetReserve = context.teamInjured > 0 ? combatReserve : safeReserve;
      if (this.needleReloading && this.pl.weapon.ammo >= targetReserve) {
        this.needleReloading = false;
      }
      if (!this.needleReloading && (
        this.pl.weapon.ammo <= 0 ||
        (context.teamInjured === 0 && this.pl.weapon.ammo <= Math.floor(magSize * 0.35))
      )) this.needleReloading = true;
      if (this.needleReloading) {
        // 糸繰り is a hold channel, not an edge-triggered pulse. Keeping the
        // bit down prevents ability-event spam and makes the refill window
        // predictable before primary healing resumes.
        input.secondary = true;
        this.lastPulseSlot = null;
        return 'secondary';
      }
    } else {
      this.needleReloading = false;
    }
    const ultimate = HERO_BY_ID[this.pl.heroId]?.abilities?.ultimate;
    const ultimateCharged = !!ultimate && this.pl.ultGauge >= (ultimate.ultCost || 100);
    if (!ultimateCharged) this.ultimateReadySince = null;
    else if (this.ultimateReadySince === null) this.ultimateReadySince = this.world.t;

    const policyDecision = policy.actions.find(([slot, when]) => (
      this.canUseAction(slot) && !this.shouldDeferDefensiveAction(slot, context) &&
      when(context) && this.movementActionIsSafe(slot, context)
    ));
    const heldAtCap = this.ultimateReadySince !== null &&
      this.world.t - this.ultimateReadySince >= ULTIMATE_LIVENESS_DELAY_SEC;
    const livenessDecision = policyDecision?.[0] !== 'ultimate'
      && heldAtCap
      && policy.ultimateLiveness?.(context)
      && this.canUseAction('ultimate');
    const slot = livenessDecision ? 'ultimate' : (policyDecision?.[0] || null);
    this.pulseAction(input, slot);
    if (slot && input[slot] && this.isFrontlineDefensiveAction(slot)) {
      this.lastDefensiveActionAt = this.world.t;
      const behavior = HERO_BY_ID[this.pl.heroId]?.abilities?.[slot]?.behavior;
      this.pendingActionIntent = behavior === 'barrier'
        ? 'barrier'
        : (PROPEL_BEHAVIORS.has(behavior) && this.isCriticalDefenseContext(context)
          ? 'retreat'
          : 'mitigate');
    }
    return slot;
  }

  movementActionIsSafe(slot, context, intent = null) {
    const definition = HERO_BY_ID[this.pl.heroId]?.abilities?.[slot];
    if (!definition || !PROPEL_BEHAVIORS.has(definition.behavior)) return true;
    // Recovery waypoints already encode a collision-checked movement plan.
    // A second impulse invalidates that plan, while an airborne bot cannot yet
    // reason about its landing arc. Human ability use remains unrestricted;
    // this is a conservative decision rule for the current bot planner.
    if (this.recoveryPath.length > 0 || this.combatDetourPath.length > 0 ||
      this.supportRescuePath.length > 0
      || !this.pl.move.grounded || isOnAuthoredStair(this.world, this.pl)) return false;
    const yaw = this.movementActionYaw(definition, context, intent);
    return hasSafeGroundPath(this.world, this.pl, yaw, definition.rangeM || 7);
  }

  movementActionYaw(definition, context, intent = null) {
    const role = HERO_BY_ID[this.pl.heroId]?.role;
    const retreat = intent === 'retreat' || (
      role === 'frontline' && this.isCriticalDefenseContext(context)
    );
    if (retreat) {
      const candidates = [];
      if (context.enemy) candidates.push(Math.atan2(
        this.pl.move.pos[1] - context.enemy.move.pos[1],
        this.pl.move.pos[0] - context.enemy.move.pos[0],
      ));
      const recoveryProvider = context.recoveryProvider || context.sustain;
      if (recoveryProvider) candidates.push(Math.atan2(
        recoveryProvider.move.pos[1] - this.pl.move.pos[1],
        recoveryProvider.move.pos[0] - this.pl.move.pos[0],
      ));
      const staging = teamStagingPoint(this.world, this.pl.team);
      candidates.push(Math.atan2(
        staging[1] - this.pl.move.pos[1],
        staging[0] - this.pl.move.pos[0],
      ));
      const safeYaw = candidates.find(yaw => hasSafeGroundPath(
        this.world, this.pl, yaw, definition.rangeM || 7,
      ));
      let yaw = safeYaw ?? candidates[0] ?? this.pl.move.yaw;
      if (definition.behavior === 'backstep') yaw += Math.PI;
      return yaw;
    }
    const allyHealingMovement = SUPPORT_MOBILITY_BEHAVIORS.has(definition.behavior) && (
      role === 'support' || (definition.healPerSec || 0) > 0 || (definition.heal || 0) > 0
    );
    // A hybrid healing dash is ally-directed only when there is an actual
    // wounded target.  Falling back to the healthy anchor made the same
    // action turn around during a close-range escape, so `back` moved toward
    // the attacker.
    const target = allyHealingMovement ? (context.ally || context.enemy) : context.enemy;
    let yaw = target
      ? Math.atan2(target.move.pos[1] - this.pl.move.pos[1], target.move.pos[0] - this.pl.move.pos[0])
      : this.pl.move.yaw;
    if (definition.behavior === 'backstep') yaw += Math.PI;
    return yaw;
  }

  setAimDirection(input, yaw, pitch = 0) {
    const movement = intendedMovementVector(input);
    const movementAngle = Math.hypot(movement[0], movement[1]) > 1e-6
      ? Math.atan2(movement[1], movement[0])
      : null;
    input.yaw = yaw;
    input.pitch = pitch;
    // Looking at a heal or combat target must not rotate an already selected
    // route direction into a wall. Re-encode the same world-space movement in
    // the new local aim frame.
    if (movementAngle !== null) this.steerTowardAngle(input, movementAngle);
  }

  aimAtPosition(input, position) {
    if (!position) return;
    const eye = eyePosition(this.pl, this.world.mv);
    const dx = position[0] - eye[0];
    const dy = position[1] - eye[1];
    const dz = position[2] - eye[2];
    this.setAimDirection(input, Math.atan2(dy, dx), Math.atan2(dz, Math.hypot(dx, dy)));
  }

  aimAt(input, target) {
    if (!target) return;
    this.aimAtPosition(input, [target.move.pos[0], target.move.pos[1], target.move.pos[2] + 1.1]);
  }

  aimBarrierBetween(input, context, definition) {
    const enemy = context.enemy;
    const baseYaw = enemy
      ? Math.atan2(
        enemy.move.pos[1] - this.pl.move.pos[1],
        enemy.move.pos[0] - this.pl.move.pos[0],
      )
      : (this.world.sideOf(this.pl.team) === 'east' ? Math.PI : 0);
    const maximum = Math.max(2.5, (definition.rangeM || 6) - 0.75);
    const desiredDistance = Math.min(
      maximum,
      Math.max(2.5, Number.isFinite(context.enemyDistance) ? context.enemyDistance * 0.55 : maximum * 0.65),
    );
    this.aimAtPosition(input, [
      this.pl.move.pos[0] + Math.cos(baseYaw) * desiredDistance,
      this.pl.move.pos[1] + Math.sin(baseYaw) * desiredDistance,
      this.pl.move.pos[2] + 0.05,
    ]);
  }

  aimAnchorAdvance(input, context) {
    const enemy = context.enemy;
    const yaw = enemy
      ? Math.atan2(
        enemy.move.pos[1] - this.pl.move.pos[1],
        enemy.move.pos[0] - this.pl.move.pos[0],
      )
      : (this.world.sideOf(this.pl.team) === 'east' ? Math.PI : 0);
    const enemyDistance = Number.isFinite(context.enemyDistance) ? context.enemyDistance : 16;
    // The anchor is a staged frontline step, not an instruction to teleport
    // onto (or through) the selected enemy.  Keeping the first placement
    // inside support reach gives Zairu a real engage -> pressure -> rewind
    // cycle instead of severing the healing line on every cooldown.
    const desiredDistance = Math.min(
      8,
      Math.max(4.5, Math.min(enemyDistance - 2, enemyDistance * 0.5)),
    );
    this.aimAtPosition(input, [
      this.pl.move.pos[0] + Math.cos(yaw) * desiredDistance,
      this.pl.move.pos[1] + Math.sin(yaw) * desiredDistance,
      this.pl.move.pos[2] + 0.05,
    ]);
  }

  aimForAction(input, slot, context) {
    const pendingCastDefinition = this.pendingActionIntent
      ? this.pl.abilities?.cast?.definition
      : null;
    const definition = pendingCastDefinition || (slot
      ? HERO_BY_ID[this.pl.heroId]?.abilities?.[slot]
      : null);
    if (!definition) return;
    if (definition.behavior === 'ally_grapple' && this.pendingActionIntent === 'support_escape') {
      const target = this.world.players.get(this.pendingActionTargetId) || context.supportEscapeAlly;
      this.aimAt(input, target);
      return;
    }
    if (this.pendingActionIntent === 'retreat' && PROPEL_BEHAVIORS.has(definition.behavior)) {
      this.setAimDirection(input, this.movementActionYaw(definition, context, 'retreat'));
      return;
    }
    if (definition.behavior === 'barrier' && HERO_BY_ID[this.pl.heroId]?.role === 'frontline') {
      this.aimBarrierBetween(input, context, definition);
      return;
    }
    if (definition.behavior === 'anchor_launch' && !context.hasAnchor) {
      this.aimAnchorAdvance(input, context);
      return;
    }
    const role = HERO_BY_ID[this.pl.heroId]?.role;
    const allyHealingMobility = SUPPORT_MOBILITY_BEHAVIORS.has(definition.behavior) && (
      role === 'support' || (definition.healPerSec || 0) > 0 || (definition.heal || 0) > 0
    );
    if (definition.behavior === 'link_ally') this.aimAt(input, context.damageAlly);
    else if (definition.behavior === 'ally_damage_buff') this.aimAt(input, context.linkedAlly);
    else if (ALLY_TARGET_BEHAVIORS.has(definition.behavior) || allyHealingMobility) {
      this.aimAt(input, context.ally || context.enemy);
    }
    else if ((definition.rangeM || 0) > 0) this.aimAt(input, context.enemy);
  }

  applySupportPrimary(input, context) {
    const hero = HERO_BY_ID[this.pl.heroId];
    if (hero?.role !== 'support' || !context.ally) return;
    if (!hero.weapon?.allyHeal && !hero.weapon?.allyHealStored) return;
    this.aimAt(input, context.ally);
    input.fire = true;
  }

  steerTowardAngle(input, angle) {
    input.f = false;
    input.b = false;
    input.l = false;
    input.r = false;
    const delta = Math.atan2(Math.sin(angle - input.yaw), Math.cos(angle - input.yaw));
    const absolute = Math.abs(delta);
    const diagonalStart = Math.PI / 8;
    const backwardStart = Math.PI * 5 / 8;
    if (absolute < backwardStart) {
      if (absolute <= Math.PI * 3 / 8) input.f = true;
      if (absolute >= diagonalStart) {
        if (delta > 0) input.l = true;
        else input.r = true;
      }
    } else {
      input.b = true;
      if (absolute < Math.PI * 7 / 8) {
        if (delta > 0) input.l = true;
        else input.r = true;
      }
    }
  }

  planSupportCover(threat) {
    if (!threat?.alive || threat.team === this.pl.team || !this.pl.move.grounded) return false;
    while (this.supportCoverPath.length > 0 && Math.hypot(
      this.supportCoverPath[0][0] - this.pl.move.pos[0],
      this.supportCoverPath[0][1] - this.pl.move.pos[1],
    ) < RECOVERY_WAYPOINT_REACHED_M) this.supportCoverPath.shift();
    if (this.supportCoverPath.length > 0 && this.world.t < this.supportCoverCommitUntil) return true;
    if (this.supportCoverThreatId !== threat.id) {
      this.supportCoverPath = [];
      this.supportCoverThreatId = threat.id;
      this.supportCoverReplanAt = 0;
    }
    if (this.supportCoverPath.length > 0) return true;

    const threatEye = eyePosition(threat, this.world.mv);
    const currentPoint = playerTargetPoint(this.pl, this.world.mv);
    if (!canAffectPoint(this.world, threatEye, currentPoint, {
      sourceTeam: threat.team,
      rangeM: Infinity,
    })) return true;
    if (this.world.t + 1e-9 < this.supportCoverReplanAt) return false;
    this.supportCoverReplanAt = this.world.t + SUPPORT_COVER_REPLAN_SEC;

    const radius = this.world.mv?.capsuleRadiusM || 0.4;
    const bounds = this.world.map?.boundsM;
    const objectiveCenter = this.world.map?.objective?.center || [0, 0];
    const canonicalRotation = this.world.sideOf(this.pl.team) === 'west' ? -1 : 1;
    const threatVector = [
      threat.move.pos[0] - this.pl.move.pos[0],
      threat.move.pos[1] - this.pl.move.pos[1],
    ];
    const threatDistance = Math.max(1e-6, Math.hypot(...threatVector));
    const threatForward = threatVector.map(value => value / threatDistance);
    const threatSide = [-threatForward[1], threatForward[0]];
    const coverTie = (centerX, centerY) => {
      const dx = centerX - this.pl.move.pos[0];
      const dy = centerY - this.pl.move.pos[1];
      return {
        forward: dx * threatForward[0] + dy * threatForward[1],
        side: dx * threatSide[0] + dy * threatSide[1],
        canonicalX: (centerX - objectiveCenter[0]) * canonicalRotation,
        canonicalY: (centerY - objectiveCenter[1]) * canonicalRotation,
      };
    };
    const shadows = [];
    for (const cover of this.world.map?.solids || []) {
      if (cover.tag !== 'cover') continue;
      const centerX = (cover.min[0] + cover.max[0]) / 2;
      const centerY = (cover.min[1] + cover.max[1]) / 2;
      if (Math.hypot(centerX - this.pl.move.pos[0], centerY - this.pl.move.pos[1]) >
        SUPPORT_COVER_SEARCH_RADIUS_M) continue;
      let dx = centerX - threat.move.pos[0];
      let dy = centerY - threat.move.pos[1];
      const directionLength = Math.hypot(dx, dy);
      if (directionLength <= 1e-6) continue;
      dx /= directionLength;
      dy /= directionLength;
      const halfX = (cover.max[0] - cover.min[0]) / 2;
      const halfY = (cover.max[1] - cover.min[1]) / 2;
      const projectedExtent = Math.abs(dx) * halfX + Math.abs(dy) * halfY;
      const clearance = projectedExtent + radius + 0.55;
      const x = centerX + dx * clearance;
      const y = centerY + dy * clearance;
      if (bounds && (x < bounds.x[0] + radius || x > bounds.x[1] - radius ||
        y < bounds.y[0] + radius || y > bounds.y[1] - radius)) continue;
      const z = navigationFloorHeight(this.world, x, y, this.pl.move.pos[2]);
      if (!Number.isFinite(z)) continue;
      const goal = [x, y, z];
      if (canAffectPoint(this.world, threatEye, [x, y, z + 1.1], {
        sourceTeam: threat.team,
        rangeM: Infinity,
      })) continue;
      const tie = coverTie(centerX, centerY);
      shadows.push({
        goal,
        directDistance: Math.hypot(x - this.pl.move.pos[0], y - this.pl.move.pos[1]),
        ...tie,
      });
    }
    // Detour search is substantially more expensive than the shadow/LOS
    // filter. Only pathfind the nearest deterministic candidates; farther
    // cover cannot win unless every nearer route is blocked.
    shadows.sort((left, right) => (
      left.directDistance - right.directDistance
      || Math.abs(left.side) - Math.abs(right.side)
      || left.side - right.side
      || left.forward - right.forward
      || left.canonicalX - right.canonicalX
      || left.canonicalY - right.canonicalY
    ));
    const candidates = [];
    for (const shadow of shadows.slice(0, 4)) {
      const path = findGroundDetourPath(this.world, [...this.pl.move.pos], shadow.goal);
      if (path.length === 0) continue;
      let previous = this.pl.move.pos;
      let pathLength = 0;
      for (const waypoint of path) {
        pathLength += Math.hypot(waypoint[0] - previous[0], waypoint[1] - previous[1]);
        previous = waypoint;
      }
      candidates.push({
        path,
        pathLength,
        forward: shadow.forward,
        side: shadow.side,
        canonicalX: shadow.canonicalX,
        canonicalY: shadow.canonicalY,
      });
    }
    candidates.sort((left, right) => (
      left.pathLength - right.pathLength
      || Math.abs(left.side) - Math.abs(right.side)
      || left.side - right.side
      || left.forward - right.forward
      || left.canonicalX - right.canonicalX
      || left.canonicalY - right.canonicalY
    ));
    this.supportCoverPath = candidates[0]?.path.map(point => [...point]) || [];
    if (this.supportCoverPath.length > 0) this.supportCoverCommitUntil = this.world.t + 2.5;
    return this.supportCoverPath.length > 0;
  }

  clearSupportRescuePath() {
    this.supportRescuePath = [];
    this.supportRescueTargetId = null;
    this.supportRescueGoal = null;
    this.supportRescueReplanAt = 0;
  }

  planSupportRescue(ally) {
    if (!ally?.alive || ally.team !== this.pl.team || !this.pl.move.grounded ||
      isOnAuthoredStair(this.world, this.pl)) {
      this.clearSupportRescuePath();
      return false;
    }
    while (this.supportRescuePath.length > 0 && Math.hypot(
      this.supportRescuePath[0][0] - this.pl.move.pos[0],
      this.supportRescuePath[0][1] - this.pl.move.pos[1],
    ) < RECOVERY_WAYPOINT_REACHED_M) this.supportRescuePath.shift();

    const targetMoved = !this.supportRescueGoal || Math.hypot(
      ally.move.pos[0] - this.supportRescueGoal[0],
      ally.move.pos[1] - this.supportRescueGoal[1],
      ally.move.pos[2] - this.supportRescueGoal[2],
    ) > 2;
    if (this.supportRescueTargetId !== ally.id || targetMoved) {
      this.supportRescuePath = [];
      this.supportRescueTargetId = ally.id;
      this.supportRescueGoal = [...ally.move.pos];
      this.supportRescueReplanAt = 0;
    }
    if (this.supportRescuePath.length > 0) return true;
    if (this.world.t + 1e-9 < this.supportRescueReplanAt) return false;
    this.supportRescueReplanAt = this.world.t + SUPPORT_RESCUE_REPLAN_SEC;

    const startZ = navigationFloorHeight(
      this.world, this.pl.move.pos[0], this.pl.move.pos[1], this.pl.move.pos[2],
    );
    const goalZ = navigationFloorHeight(
      this.world, ally.move.pos[0], ally.move.pos[1], ally.move.pos[2],
    );
    if (!Number.isFinite(startZ) || !Number.isFinite(goalZ)) return false;
    const start = [this.pl.move.pos[0], this.pl.move.pos[1], startZ];
    const goal = [ally.move.pos[0], ally.move.pos[1], goalZ];
    let path = findGroundDetourPath(this.world, start, goal);
    if (path.length === 0) {
      path = findGroundRecoveryPath(this.world, start, goal, {
        maxVisited: 2500,
        searchMarginM: 5,
        fallbackMarginM: 8,
      });
    }
    this.supportRescuePath = path.map(point => [...point]);
    while (this.supportRescuePath.length > 0 && Math.hypot(
      this.supportRescuePath[0][0] - this.pl.move.pos[0],
      this.supportRescuePath[0][1] - this.pl.move.pos[1],
    ) < RECOVERY_WAYPOINT_REACHED_M) this.supportRescuePath.shift();
    return this.supportRescuePath.length > 0;
  }

  applyRoleMovement(input, context) {
    const pl = this.pl;
    const hero = HERO_BY_ID[pl.heroId];
    if (hero?.role === 'support' && this.supportCoverPath.length > 0 &&
      this.world.t < this.supportCoverCommitUntil) {
      while (this.supportCoverPath.length > 0 && Math.hypot(
        this.supportCoverPath[0][0] - pl.move.pos[0],
        this.supportCoverPath[0][1] - pl.move.pos[1],
      ) < RECOVERY_WAYPOINT_REACHED_M) this.supportCoverPath.shift();
      const waypoint = this.supportCoverPath[0];
      if (waypoint) {
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
        this.steerTowardAngle(input, Math.atan2(
          waypoint[1] - pl.move.pos[1],
          waypoint[0] - pl.move.pos[0],
        ));
        return;
      }
    }
    if (hero?.role === 'support' && context.supportUnderPressure && context.selfThreat) {
      if (this.planSupportCover(context.selfThreat)) {
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
        const waypoint = this.supportCoverPath[0];
        if (waypoint) this.steerTowardAngle(input, Math.atan2(
          waypoint[1] - pl.move.pos[1],
          waypoint[0] - pl.move.pos[0],
        ));
        return;
      }
      const away = Math.atan2(
        pl.move.pos[1] - context.selfThreat.move.pos[1],
        pl.move.pos[0] - context.selfThreat.move.pos[0],
      );
      const candidates = [away, away + Math.PI / 4, away - Math.PI / 4, away + Math.PI / 2, away - Math.PI / 2];
      const safeYaw = candidates.find(yaw => hasSafeGroundPath(this.world, pl, yaw, 5));
      input.f = false;
      input.b = false;
      input.l = false;
      input.r = false;
      if (safeYaw !== undefined) this.steerTowardAngle(input, safeYaw);
      return;
    }
    const recoveryCapable = heroCanRecoverAllies(hero);
    if (recoveryCapable && !context.selfUnderPressure && context.blockedRescueAlly) {
      if (this.planSupportRescue(context.blockedRescueAlly)) {
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
        const waypoint = this.supportRescuePath[0];
        if (waypoint) this.steerTowardAngle(input, Math.atan2(
          waypoint[1] - pl.move.pos[1],
          waypoint[0] - pl.move.pos[0],
        ));
        return;
      }
    } else if (this.supportRescuePath.length > 0) {
      this.clearSupportRescuePath();
    }
    if (hero?.role === 'support') {
      this.supportCoverPath = [];
      this.supportCoverThreatId = null;
      this.supportCoverCommitUntil = 0;
    }
    if (!context.enemy) return;
    const [preferredMin, preferredMax] = HERO_POLICIES[pl.heroId]?.range || [8, 24];
    const distance = context.enemyDistance;
    if (hero?.role === 'frontline') {
      const allyToEnemy = context.nearestAlly ? Math.hypot(
        context.nearestAlly.move.pos[0] - context.enemy.move.pos[0],
        context.nearestAlly.move.pos[1] - context.enemy.move.pos[1],
      ) : Infinity;
      const allyExposed = allyToEnemy + 1 < distance;
      if (distance > preferredMax || (distance > preferredMin && (allyExposed || context.objectiveContested))) {
        input.f = true;
        input.b = false;
      } else if (distance < preferredMin && context.selfHpRatio < 0.32) {
        input.b = true;
        input.f = false;
      }
      return;
    }
    if (hero?.role === 'damage') {
      if (distance < preferredMin) {
        input.b = true;
        input.f = false;
      } else if (distance > preferredMax) {
        input.f = true;
        input.b = false;
      }
      return;
    }
    if (hero?.role === 'support') {
      if (distance < preferredMin) {
        const away = Math.atan2(
          pl.move.pos[1] - context.enemy.move.pos[1],
          pl.move.pos[0] - context.enemy.move.pos[0],
        );
        this.steerTowardAngle(input, away);
      } else if (context.ally && context.allyDistance > preferredMax && distance > preferredMin * 1.25) {
        const towardAlly = Math.atan2(
          context.ally.move.pos[1] - pl.move.pos[1],
          context.ally.move.pos[0] - pl.move.pos[0],
        );
        this.steerTowardAngle(input, towardAlly);
      }
    }
  }

  teamPressureAnchor() {
    const alive = [...this.world.players.values()]
      .filter(other => other.team === this.pl.team && other.alive);
    return selectPressureAnchor(alive, this.world.map.objective.center);
  }

  teamRecoveryProvider(pressureAnchor = this.teamPressureAnchor()) {
    const alive = [...this.world.players.values()]
      .filter(other => other.team === this.pl.team && other.alive);
    return selectRecoveryProvider(alive, pressureAnchor);
  }

  // Compatibility for older diagnostics that called the controller helper.
  teamTank() {
    return this.teamPressureAnchor();
  }

  regroupStagingPoint() {
    return teamStagingPoint(this.world, this.pl.team);
  }

  planRegroupPath() {
    const goal = this.regroupStagingPoint();
    const goalChanged = !this.regroupGoal || Math.hypot(
      goal[0] - this.regroupGoal[0],
      goal[1] - this.regroupGoal[1],
      goal[2] - this.regroupGoal[2],
    ) > 0.1;
    if (!goalChanged && this.recoveryPath.length > 0) return true;
    const distance = Math.hypot(
      goal[0] - this.pl.move.pos[0],
      goal[1] - this.pl.move.pos[1],
    );
    this.regroupGoal = goal;
    if (distance <= 2) {
      this.recoveryPath = [];
      return true;
    }
    const startZ = navigationFloorHeight(
      this.world,
      this.pl.move.pos[0],
      this.pl.move.pos[1],
      this.pl.move.pos[2],
    );
    if (!Number.isFinite(startZ)) {
      this.recoveryPath = [];
      return false;
    }
    if (Math.abs(startZ - this.pl.move.pos[2]) > 0.2) {
      this.recoveryPath = [];
      return false;
    }
    const start = [this.pl.move.pos[0], this.pl.move.pos[1], startZ];
    this.recoveryPath = findGroundDetourPath(this.world, start, goal);
    if (this.recoveryPath.length > 0) return true;
    this.recoveryPath = findGroundRecoveryPath(
      this.world,
      start,
      goal,
      { searchMarginM: 12, fallbackMarginM: 16 },
    );
    return this.recoveryPath.length > 0;
  }

  enterRegroup() {
    if (this.mode !== 'regroup') {
      this.regroupT = 0;
      this.recoveryPath = [];
      this.regroupGoal = null;
      this.regroupPlanRetryAt = 0;
      this.regroupPlanStart = null;
    }
    this.dpsAngleRecoveryGoal = null;
    this.dpsAngleRecoveryRetryAt = 0;
    this.mode = 'regroup';
    this.targetId = null;
    this.clearPursuit();
    this.combatDetourPath = [];
    const movedSinceFailedPlan = !this.regroupPlanStart || Math.hypot(
      this.pl.move.pos[0] - this.regroupPlanStart[0],
      this.pl.move.pos[1] - this.regroupPlanStart[1],
    ) > 1;
    if (this.recoveryPath.length === 0 && this.world.t < this.regroupPlanRetryAt && !movedSinceFailedPlan) {
      return;
    }
    const planned = this.planRegroupPath();
    this.regroupPlanStart = [...this.pl.move.pos];
    this.regroupPlanRetryAt = planned ? 0 : this.world.t + REGROUP_PLAN_RETRY_SEC;
  }

  planDpsAngleRecovery(safeTarget) {
    // A checked local return already owns movement. Replanning it against a
    // moving anchor every tick would recreate the same oscillation this path
    // is intended to remove.
    if (this.recoveryPath.length > 0) {
      this.mode = 'advance';
      return true;
    }
    const goalChanged = !this.dpsAngleRecoveryGoal || Math.hypot(
      safeTarget[0] - this.dpsAngleRecoveryGoal[0],
      safeTarget[1] - this.dpsAngleRecoveryGoal[1],
      safeTarget[2] - this.dpsAngleRecoveryGoal[2],
    ) > 1;
    if (!goalChanged && this.world.t < this.dpsAngleRecoveryRetryAt) return false;

    const startZ = navigationFloorHeight(
      this.world,
      this.pl.move.pos[0],
      this.pl.move.pos[1],
      this.pl.move.pos[2],
    );
    this.dpsAngleRecoveryGoal = [...safeTarget];
    if (!Number.isFinite(startZ) || Math.abs(startZ - this.pl.move.pos[2]) > 0.2) {
      this.dpsAngleRecoveryRetryAt = this.world.t + DPS_ANGLE_RECOVERY_RETRY_SEC;
      return false;
    }
    const start = [this.pl.move.pos[0], this.pl.move.pos[1], startZ];
    let path = findGroundDetourPath(this.world, start, safeTarget);
    if (path.length === 0) {
      // This is intentionally a small, local search. A side-angle correction
      // must never expand into the map-wide route-to-staging A* that can pull
      // one DPS out of an otherwise live fight.
      path = findGroundRecoveryPath(this.world, start, safeTarget, {
        maxVisited: 2500,
        searchMarginM: 4,
        fallbackMarginM: 6,
      });
    }
    if (path.length === 0) {
      this.dpsAngleRecoveryRetryAt = this.world.t + DPS_ANGLE_RECOVERY_RETRY_SEC;
      return false;
    }
    this.recoveryPath = path;
    this.mode = 'advance';
    this.regroupGoal = null;
    this.regroupPlanRetryAt = 0;
    this.regroupPlanStart = null;
    this.dpsAngleRecoveryRetryAt = 0;
    this.stallT = 0;
    this.progressPos = null;
    this.progressT = 0;
    return true;
  }

  applyFormationMovement(input, context) {
    // A collision-checked recovery path takes precedence over formation shape.
    // Overriding it with a distant anchor vector reintroduces wall/ledge cuts.
    if (this.recoveryPath.length > 0 || this.supportRescuePath.length > 0 ||
      this.mode === 'pursue' || this.mode === 'regroup') return;
    const hero = HERO_BY_ID[this.pl.heroId];
    if (!hero) return;
    // A focused backline must finish its collision-checked kite before the
    // normal anchor-relative formation target can pull it back toward the threat.
    if (hero.role === 'support' && context?.supportUnderPressure) return;
    const [preferredMin] = HERO_POLICIES[this.pl.heroId]?.range || [8, 24];
    // Damage must preserve its immediate close-range escape.  A support,
    // however, still needs the anchor-relative cover target in the exact
    // dangerous window where a direct retreat can leave it exposed beside
    // the frontline or a melee enemy.
    if (hero.role === 'damage' && context?.enemyDistance < preferredMin) return;
    if (hero.role === 'frontline' && context?.enemyDistance < preferredMin &&
      context.selfHpRatio < TANK_CRITICAL_HP_RATIO) return;
    const pressureAnchor = this.teamPressureAnchor();
    if (!pressureAnchor) return;
    const recoveryProvider = this.teamRecoveryProvider(pressureAnchor);
    const anchor = deriveFrontlineAnchor(
      this.world.map.objective.center,
      this.world.sideOf(this.pl.team),
      pressureAnchor.move.pos,
    );
    const forwardX = anchor.forward[0];
    if (hero.role === 'frontline') {
      if (pressureAnchor.id !== this.pl.id) return;
      const allies = [...this.world.players.values()].filter(other =>
        other.id !== this.pl.id && other.team === this.pl.team && other.alive);
      const distanceToSelf = other => Math.hypot(
        other.move.pos[0] - this.pl.move.pos[0],
        other.move.pos[1] - this.pl.move.pos[1],
      );
      const alliesNearby = allies.filter(other => distanceToSelf(other) <= TANK_ALLY_RANGE_M).length;
      const providerNearby = !!recoveryProvider &&
        distanceToSelf(recoveryProvider) <= TANK_SUPPORT_RANGE_M;
      const center = this.world.map.objective.center;
      const enemyOnObjective = !!context?.enemy && Math.hypot(
        context.enemy.move.pos[0] - center[0],
        context.enemy.move.pos[1] - center[1],
      ) <= this.world.map.objective.radiusM;
      const readyToContest = context?.selfHpRatio >= TANK_CONTEST_HP_RATIO &&
        alliesNearby >= 2 && providerNearby;
      const shouldRetreat = context?.inFight &&
        (context.selfHpRatio < TANK_RETREAT_HP_RATIO || alliesNearby < 2 || !providerNearby);
      if (shouldRetreat) {
        const providerBehind = recoveryProvider &&
          (recoveryProvider.move.pos[0] - this.pl.move.pos[0]) * forwardX <= 1
          ? recoveryProvider
          : null;
        const targetX = providerBehind?.move.pos[0] ?? this.pl.move.pos[0] - forwardX * 6;
        const targetY = providerBehind?.move.pos[1] ?? this.pl.move.pos[1];
        this.steerTowardAngle(input, Math.atan2(
          targetY - this.pl.move.pos[1],
          targetX - this.pl.move.pos[0],
        ));
        return;
      }
      const contestEngaged = context?.inFight || this.mode === 'hold';
      if ((context?.objectiveContested || enemyOnObjective) && readyToContest && contestEngaged) {
        this.steerTowardAngle(input, Math.atan2(
          center[1] - this.pl.move.pos[1],
          center[0] - this.pl.move.pos[0],
        ));
      }
      return;
    }
    if (pressureAnchor.id === this.pl.id) return;
    const anchorDistance = Math.hypot(
      this.pl.move.pos[0] - anchor.position[0],
      this.pl.move.pos[1] - anchor.position[1],
    );
    const forwardLead = (this.pl.move.pos[0] - anchor.position[0]) * forwardX;
    const canSteerToFormation = (this.mode === 'fight' || this.mode === 'hold') &&
      anchorDistance <= FORMATION_STEER_MAX_DISTANCE_M;
    if (hero.role === 'support') {
      const minimumCoverGap = isSustainSupport(this.pl) ? SUPPORT_MIN_COVER_DISTANCE_M : 0;
      if (!canSteerToFormation) {
        // During lane transit, the authored/recovery route is the only
        // collision-checked source of movement. Formation steering is applied
        // once the bot is actually engaged or holding an angle; overriding an
        // advance route can make it oscillate across a wall or stair landing.
        if (this.mode !== 'advance' && forwardLead > FRONTLINE_STANDARD_LEAD_M) {
          input.f = false;
          input.b = false;
          input.l = false;
          input.r = false;
        }
        return;
      }
      const supportReach = context?.selfHpRatio < 0.8
        ? SUPPORT_WOUNDED_TANK_REACH_M
        : SUPPORT_TANK_REACH_M;
      const lateralDistance = Math.abs(this.pl.move.pos[1] - anchor.position[1]);
      if (anchorDistance >= minimumCoverGap && anchorDistance <= supportReach &&
        lateralDistance <= SUPPORT_MAX_LATERAL_M && forwardLead <= FRONTLINE_STANDARD_LEAD_M) return;
      const logicalIdentity = logicalPlayerIdentity(this.pl, this.rng);
      const side = stableParity(logicalIdentity)
        * (this.world.sideOf(this.pl.team) === 'west' ? -1 : 1);
      const targetX = anchor.position[0] - forwardX * SUPPORT_FOLLOW_DISTANCE_M;
      const targetY = anchor.position[1] + side * SUPPORT_LATERAL_OFFSET_M;
      this.steerTowardAngle(input, Math.atan2(
        targetY - this.pl.move.pos[1],
        targetX - this.pl.move.pos[0],
      ));
      return;
    }
    if (hero.role !== 'damage') return;
    const lateralDistance = Math.abs(this.pl.move.pos[1] - anchor.position[1]);
    const routeName = this.activeRouteName();
    const boundedFlank = routeName !== 'front' &&
      between(lateralDistance, DAMAGE_FLANK_MIN_LATERAL_M, DAMAGE_FLANK_MAX_LATERAL_M);
    const maxLead = boundedFlank ? DAMAGE_FLANK_LEAD_M : FRONTLINE_STANDARD_LEAD_M;
    if (!canSteerToFormation) {
      if (this.mode !== 'advance' && forwardLead > maxLead) {
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
      }
      return;
    }
    const angleTooWide = routeName !== 'front' && lateralDistance > DAMAGE_FLANK_MAX_LATERAL_M;
    const angleTooNarrow = this.mode === 'fight' && routeName !== 'front' &&
      lateralDistance < DAMAGE_FLANK_MIN_LATERAL_M;
    if (forwardLead <= maxLead && !angleTooWide && !angleTooNarrow) return;
    const targetX = anchor.position[0] - forwardX * 2;
    const lateralOffset = this.pl.move.pos[1] - anchor.position[1];
    const routeSide = this.flankRouteSide();
    const targetY = angleTooNarrow
      ? anchor.position[1] + routeSide * (DAMAGE_FLANK_MIN_LATERAL_M + 2)
      : routeName === 'front'
        ? anchor.position[1]
        : anchor.position[1] + Math.max(-DAMAGE_FLANK_MAX_LATERAL_M,
          Math.min(DAMAGE_FLANK_MAX_LATERAL_M, lateralOffset));
    this.steerTowardAngle(input, Math.atan2(
      targetY - this.pl.move.pos[1],
      targetX - this.pl.move.pos[0],
    ));
  }

  flankRouteSide() {
    const centerY = this.world.map.objective.center[1];
    // Both side lanes deliberately rejoin the objective centre at their
    // final node.  Deriving the sign from that endpoint therefore erases the
    // lane's handedness exactly when a DPS needs to restore its angle.  Use
    // the furthest authored lateral node instead, which also mirrors with the
    // route on the opposite side of the map.
    const lateral = this.routePoints().reduce((furthest, point) => (
      Math.abs(point[1] - centerY) > Math.abs(furthest[1] - centerY)
        ? point
        : furthest
    ), [this.world.map.objective.center[0], centerY, 0]);
    return Math.sign(lateral[1] - centerY) || (this.world.sideOf(this.pl.team) === 'east' ? 1 : -1);
  }

  holdDpsAtSafeAngle(input) {
    const pressureAnchor = this.teamPressureAnchor();
    if (!pressureAnchor) {
      input.f = false;
      input.b = false;
      input.l = false;
      input.r = false;
      return;
    }
    const anchor = deriveFrontlineAnchor(
      this.world.map.objective.center,
      this.world.sideOf(this.pl.team),
      pressureAnchor.move.pos,
    );
    const forwardX = anchor.forward[0];
    const forwardLead = (this.pl.move.pos[0] - anchor.position[0]) * forwardX;
    const lateralOffset = this.pl.move.pos[1] - anchor.position[1];
    const lateralDistance = Math.abs(lateralOffset);
    const side = Math.sign(lateralOffset) || this.flankRouteSide();
    // Without anchor pressure a DPS can keep a useful, collision-safe angle,
    // but must be behind or level with the anchor and inside the bounded flank
    // envelope.  A bot that is already exposed backs out before it waits.
    const unsafeForward = forwardLead > 1;
    const unsafeLateral = lateralDistance > DAMAGE_FLANK_MAX_LATERAL_M;
    if (unsafeForward || unsafeLateral) {
      const targetX = anchor.position[0] - forwardX * 2;
      const targetY = this.activeRouteName() === 'front'
        ? anchor.position[1]
        : anchor.position[1] + side * Math.min(10, Math.max(4, lateralDistance));
      const safeTarget = [targetX, targetY, pressureAnchor.move.pos[2]];
      if (!canTraverseGroundSegment(this.world, [...this.pl.move.pos], safeTarget)) {
        // Keep the shared pressure phase intact. An obstructed side-angle
        // correction is a local reposition, not a command to abandon the
        // current fight and route all the way back to staging.
        this.planDpsAngleRecovery(safeTarget);
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
        return;
      }
      this.steerTowardAngle(input, Math.atan2(
        targetY - this.pl.move.pos[1],
        targetX - this.pl.move.pos[0],
      ));
      return;
    }
    input.f = false;
    input.b = false;
    input.l = false;
    input.r = false;
  }

  dpsAngleRequiresDisengage(teamIntent, input, enemy) {
    if (HERO_BY_ID[this.pl.heroId]?.role !== 'damage' || this.activeRouteName() === 'front') {
      return false;
    }
    const [preferredMin] = HERO_POLICIES[this.pl.heroId]?.range || [8, 24];
    if (enemy && Math.hypot(
      enemy.move.pos[0] - this.pl.move.pos[0],
      enemy.move.pos[1] - this.pl.move.pos[1],
      enemy.move.pos[2] - this.pl.move.pos[2],
    ) < preferredMin) return false;
    const pressureAnchor = this.teamPressureAnchor();
    if (!pressureAnchor) return false;
    const anchor = deriveFrontlineAnchor(
      this.world.map.objective.center,
      this.world.sideOf(this.pl.team),
      pressureAnchor.move.pos,
    );
    const forwardLead = (this.pl.move.pos[0] - anchor.position[0]) * anchor.forward[0];
    const lateralDistance = Math.abs(this.pl.move.pos[1] - anchor.position[1]);
    const maxLead = teamIntent?.phase === 'pressure' ? DAMAGE_FLANK_LEAD_M : 1;
    if (forwardLead <= maxLead && lateralDistance <= DAMAGE_FLANK_MAX_LATERAL_M) return false;

    // An exposed flanker first gives up the duel.  The collision-aware helper
    // either steers it back inside the anchor's envelope or gives it a bounded
    // local detour; combat strafing must not overwrite that
    // recovery during the same tick.
    this.targetId = null;
    this.clearPursuit();
    this.combatDetourPath = [];
    this.claimTarget(null);
    this.holdDpsAtSafeAngle(input);
    if (this.mode !== 'regroup') this.mode = 'advance';
    return true;
  }

  steerBackAlongRoute(input) {
    const points = this.routePoints();
    let target = null;
    for (let index = Math.max(0, Math.min(points.length - 1, this.wpIndex - 1)); index >= 0; index--) {
      const candidate = points[index];
      if (Math.hypot(
        candidate[0] - this.pl.move.pos[0],
        candidate[1] - this.pl.move.pos[1],
      ) >= 2) {
        target = candidate;
        break;
      }
    }
    if (!target) return;
    this.steerTowardAngle(input, Math.atan2(
      target[1] - this.pl.move.pos[1],
      target[0] - this.pl.move.pos[0],
    ));
  }

  // 実際に動けているか（壁ずり・落水スタックは速度では検知できない）
  updateStall(dt, moving) {
    const p = this.pl.move.pos;
    if (!moving) { this.progressPos = null; this.stallT = 0; return; }
    this.progressT += dt;
    if (!this.progressPos) { this.progressPos = [p[0], p[1]]; this.progressT = 0; return; }
    if (this.progressT >= 0.7) {
      const moved = Math.hypot(p[0] - this.progressPos[0], p[1] - this.progressPos[1]);
      if (moved < 0.8) this.stallT += this.progressT; else this.stallT = 0;
      this.progressPos = [p[0], p[1]];
      this.progressT = 0;
    }
  }

  // 落水・迷子からの復帰: 低地からでも登れる渚ルートに乗り換える
  recoverViaShallows() {
    this.route = 'shallows';
    return this.planRecoveryOnCurrentRoute({ preserveProgress: false });
  }

  rejoinCurrentRoute() {
    // Switching to the long low-ground lane is reserved for the explicit
    // lowGroundDisadvantage recovery below. A transient high-ground planning
    // failure must not send a frontline bot on a thirty-second map lap.
    return this.planRecoveryOnCurrentRoute();
  }

  planRecoveryOnCurrentRoute({ preserveProgress = true } = {}) {
    const originalWpIndex = this.wpIndex;
    const planKey = `${this.routeIdentity()}|${preserveProgress ? 'preserve' : 'reset'}|${originalWpIndex}`;
    const movedSinceFailedPlan = !this.routeRecoveryPlanStart || Math.hypot(
      this.pl.move.pos[0] - this.routeRecoveryPlanStart[0],
      this.pl.move.pos[1] - this.routeRecoveryPlanStart[1],
    ) > 0.75;
    if (this.recoveryPath.length === 0 &&
      this.routeRecoveryPlanKey === planKey &&
      this.world.t < this.routeRecoveryPlanRetryAt &&
      !movedSinceFailedPlan) {
      return false;
    }
    const supportedZ = navigationFloorHeight(
      this.world,
      this.pl.move.pos[0],
      this.pl.move.pos[1],
      this.pl.move.pos[2],
    );
    const referenceZ = Number.isFinite(supportedZ) ? supportedZ : this.pl.move.pos[2];
    const candidates = this.recoveryWaypointCandidates({
      maxVerticalDeltaM: 0.2,
      referenceZ,
      minIndex: preserveProgress ? Math.max(0, this.wpIndex - 2) : 0,
    });
    let selectedIndex = -1;
    let selectedPath = [];
    let alreadyAtRoutePoint = false;
    const recoveryStart = [this.pl.move.pos[0], this.pl.move.pos[1], referenceZ];
    for (const candidateIndex of candidates) {
      const target = this.routePoints()[candidateIndex];
      const path = target
        ? findGroundRecoveryPath(
        this.world,
        recoveryStart,
        target,
      )
        : [];
      if (path.length === 0) continue;
      // A* may begin with a cell directly under the capsule. Drop only nodes
      // on the same tread; a horizontally close node 0.5m above or below is
      // the next authored stair step and must remain in the recovery plan.
      // The slightly wider rejoin tolerance is still below a player radius
      // plus one grid cell, so it only consumes a node the capsule is already
      // beside; it never permits a ledge or wall shortcut.
      while (path.length > 0 && Math.hypot(
        path[0][0] - this.pl.move.pos[0],
        path[0][1] - this.pl.move.pos[1],
      ) < ROUTE_REJOIN_REACHED_M && Math.abs(path[0][2] - referenceZ) < 0.2) {
        const next = path[1];
        if (next && !canTraverseGroundSegment(this.world, recoveryStart, next)) break;
        path.shift();
      }
      // A point just behind the current progress is bookkeeping only: keep
      // searching for the next authored tread so a stair descent is not
      // accidentally consumed.  At or ahead of current progress, accepting
      // the already-reached point lets normal route following advance on the
      // next tick without a zero-distance recovery loop.
      if (path.length === 0 && candidateIndex >= originalWpIndex) {
        selectedIndex = Math.max(originalWpIndex, candidateIndex);
        alreadyAtRoutePoint = true;
        break;
      }
      if (path.length === 0) continue;
      selectedIndex = candidateIndex;
      selectedPath = path;
      break;
    }
    if (selectedIndex < 0) {
      this.wpIndex = originalWpIndex;
      this.recoveryPath = [];
      this.routeRecoveryPlanKey = planKey;
      this.routeRecoveryPlanStart = [...this.pl.move.pos];
      this.routeRecoveryPlanRetryAt = this.world.t + ROUTE_RECOVERY_PLAN_RETRY_SEC;
      return false;
    }
    this.wpIndex = selectedIndex;
    this.recoveryPath = selectedPath;
    this.routeRecoveryPlanKey = null;
    this.routeRecoveryPlanStart = null;
    this.routeRecoveryPlanRetryAt = 0;
    this.mode = 'advance';
    this.stallT = 0;
    this.progressPos = null;
    this.progressT = 0;
    this.lowGroundT = 0;
    return alreadyAtRoutePoint || this.recoveryPath.length > 0;
  }

  recoveryWaypointCandidates({
    maxRiseM = Infinity,
    maxVerticalDeltaM = Infinity,
    referenceZ = this.pl.move.pos[2],
    minIndex = 0,
    maxIndex = Infinity,
  } = {}) {
    const pts = this.routePoints();
    if (pts.length === 0) return [];
    const boundedMin = Math.max(0, Math.min(pts.length - 1, Math.floor(minIndex)));
    const boundedMax = Math.max(
      boundedMin,
      Math.min(pts.length - 1, Number.isFinite(maxIndex) ? Math.floor(maxIndex) : pts.length - 1),
    );
    const candidates = [];
    const seen = new Set();
    const addNearest = (from, to, enforceVerticalLimits) => {
      const ranked = [];
      for (let index = from; index <= to; index++) {
        if (enforceVerticalLimits && (
          pts[index][2] > referenceZ + maxRiseM ||
          Math.abs(pts[index][2] - referenceZ) > maxVerticalDeltaM
        )) continue;
        ranked.push({
          index,
          distance: Math.hypot(
            pts[index][0] - this.pl.move.pos[0],
            pts[index][1] - this.pl.move.pos[1],
          ),
        });
      }
      ranked.sort((a, b) => a.distance - b.distance || a.index - b.index);
      for (const candidate of ranked.slice(0, 4)) {
        if (seen.has(candidate.index)) continue;
        seen.add(candidate.index);
        candidates.push(candidate.index);
      }
    };

    // Progress-consistent, same-level waypoints are preferred. A bounded set
    // from each later tier lets A* prove reachability without turning every
    // recovery tick into a full-route search.
    addNearest(boundedMin, boundedMax, true);
    addNearest(0, pts.length - 1, true);
    addNearest(boundedMin, boundedMax, false);
    addNearest(0, pts.length - 1, false);
    return candidates;
  }

  // 現在位置から一番近い前方WPへ復帰する
  nearestWpIndex({
    maxRiseM = Infinity,
    maxVerticalDeltaM = Infinity,
    referenceZ = this.pl.move.pos[2],
    minIndex = 0,
    maxIndex = Infinity,
    forwardOnly = false,
  } = {}) {
    const pts = this.routePoints();
    if (pts.length === 0) return 0;
    const boundedMin = Math.max(0, Math.min(pts.length - 1, Math.floor(minIndex)));
    const boundedMax = Math.max(
      boundedMin,
      Math.min(pts.length - 1, Number.isFinite(maxIndex) ? Math.floor(maxIndex) : pts.length - 1),
    );
    const nearestInRange = (from, to, enforceVerticalLimits) => {
      let best = -1;
      let bestD = Infinity;
      const forwardX = this.world.sideOf(this.pl.team) === 'east' ? -1 : 1;
      for (let i = from; i <= to; i++) {
        const forwardProgress = (pts[i][0] - this.pl.move.pos[0]) * forwardX;
        if (forwardOnly && forwardProgress < 0) continue;
        if (enforceVerticalLimits && (
          pts[i][2] > referenceZ + maxRiseM ||
          Math.abs(pts[i][2] - referenceZ) > maxVerticalDeltaM
        )) continue;
        const d = Math.hypot(pts[i][0] - this.pl.move.pos[0], pts[i][1] - this.pl.move.pos[1]);
        if (d < bestD) { bestD = d; best = i; }
      }
      return best;
    };

    // Prefer a same-level waypoint near the bot's current route progress. Only
    // widen the search when a fall/teleport leaves no viable waypoint ahead.
    const sameLevelAhead = nearestInRange(boundedMin, boundedMax, true);
    if (sameLevelAhead >= 0) return sameLevelAhead;
    const sameLevelAnywhere = nearestInRange(0, pts.length - 1, true);
    if (sameLevelAnywhere >= 0) return sameLevelAnywhere;
    const anyHeightAhead = nearestInRange(boundedMin, boundedMax, false);
    if (anyHeightAhead >= 0) return anyHeightAhead;
    const anyHeightAnywhere = nearestInRange(0, pts.length - 1, false);
    if (anyHeightAnywhere >= 0) return anyHeightAnywhere;
    // A malformed/custom route may contain no forward point. Preserve the
    // existing recovery behavior instead of returning an invalid index.
    if (forwardOnly) return this.nearestWpIndex({
      maxRiseM,
      maxVerticalDeltaM,
      referenceZ,
      minIndex,
      maxIndex,
      forwardOnly: false,
    });
    return 0;
  }

  activeRouteName() {
    const role = HERO_BY_ID[this.pl.heroId]?.role;
    // One DPS pre-stages a bounded off-angle while the other four establish
    // the front.  Waiting until pressure begins forces the flanker to arrive
    // only after the first pick, while sending both DPS sideways removes the
    // damage source that should be working with the tank.
    const projectsTacticalDamageRoute = role === 'damage' &&
      (this.teamTacticalPhase === 'approach' || this.teamTacticalPhase === 'pressure');
    if (projectsTacticalDamageRoute) {
      // Recovery is a live team duty, not a role label.  If a damage hero is
      // the remaining provider, keep it on the shared front instead of
      // preserving a stale side assignment while allies lose sustain.
      if (this.teamRecoveryProvider()?.id === this.pl.id) return 'front';
      return this.isDesignatedSideFlanker() ? this.designatedSideRouteName() : 'front';
    }
    return this.route;
  }

  designatedSideRouteName() {
    if (DAMAGE_SIDE_ROUTES.includes(this.route) && this.routePoints(this.route).length) {
      return this.route;
    }
    return DAMAGE_SIDE_ROUTES.find(route => this.routePoints(route).length) || 'front';
  }

  isDesignatedSideFlanker() {
    const damage = [...this.world.players.values()]
      .filter(player => player.team === this.pl.team &&
        HERO_BY_ID[player.heroId]?.role === 'damage')
      .sort(compareStablePlayers);
    // The designation belongs to the full roster, not the current alive set.
    // A death therefore leaves the side assignment vacant until that same DPS
    // respawns instead of moving its teammate away from the tank mid-fight.
    return damage[0]?.id === this.pl.id;
  }

  routePoints(routeName = this.activeRouteName()) {
    return routePointsFor(this.world, this.pl.team, routeName);
  }

  routeIdentity(routeName = this.activeRouteName()) {
    const plan = flashpointRoutePlan(this.world, this.pl.team, routeName);
    if (plan) return `${plan.siteEpoch}:${plan.routeId}`;
    return isFlashpointWorld(this.world) ? `flashpoint:no_plan:${routeName}` : routeName;
  }

  currentSquadFocus() {
    const state = focusStateFor(this.world);
    const focus = state.get(this.pl.team);
    const target = focus ? this.world.players.get(focus.targetId) : null;
    if (!focus || !target?.alive || this.world.t - focus.seenAt > TEAM_FOCUS_MEMORY_SEC) {
      if (focus) state.delete(this.pl.team);
      return null;
    }
    return focus;
  }

  publishSquadFocus(enemy) {
    if (!enemy?.alive) return;
    const state = focusStateFor(this.world);
    const existing = this.currentSquadFocus();
    // Keep an active team target stable so independently ticking bots converge
    // instead of replacing the callout with whichever enemy they saw last.
    if (existing && existing.targetId !== enemy.id) return;
    state.set(this.pl.team, {
      targetId: enemy.id,
      pos: [...enemy.move.pos],
      seenAt: this.world.t,
      reporterId: this.pl.id,
    });
  }

  claimTarget(enemy) {
    const claims = targetClaimsFor(this.world);
    if (!enemy?.alive) {
      claims.delete(this.pl.id);
      return;
    }
    claims.set(this.pl.id, {
      team: this.pl.team,
      targetId: enemy.id,
      seenAt: this.world.t,
    });
  }

  targetClaimCount(targetId) {
    const claims = targetClaimsFor(this.world);
    let count = 0;
    for (const [playerId, claim] of claims) {
      if (this.world.t - claim.seenAt > TARGET_CLAIM_MEMORY_SEC) {
        claims.delete(playerId);
        continue;
      }
      if (playerId !== this.pl.id && claim.team === this.pl.team && claim.targetId === targetId) count++;
    }
    return count;
  }

  hostileTargetClaimCount(targetId) {
    const claims = targetClaimsFor(this.world);
    let count = 0;
    for (const [playerId, claim] of claims) {
      if (this.world.t - claim.seenAt > TARGET_CLAIM_MEMORY_SEC) {
        claims.delete(playerId);
        continue;
      }
      if (claim.team !== this.pl.team && claim.targetId === targetId) count++;
    }
    return count;
  }

  hostileTargetClaimers(targetId) {
    const claims = targetClaimsFor(this.world);
    const attackers = [];
    for (const [playerId, claim] of claims) {
      if (this.world.t - claim.seenAt > TARGET_CLAIM_MEMORY_SEC) {
        claims.delete(playerId);
        continue;
      }
      if (claim.team === this.pl.team || claim.targetId !== targetId) continue;
      const attacker = this.world.players.get(playerId);
      if (attacker?.alive && attacker.team !== this.pl.team) attackers.push(attacker);
    }
    return attackers;
  }

  rememberVisibleEnemy(enemy) {
    this.lastKnownTargetPos = [...enemy.move.pos];
    this.targetMemoryUntil = this.world.t + TARGET_MEMORY_SEC;
    if (this.ignoredFocusTargetId === enemy.id) {
      this.ignoredFocusTargetId = null;
      this.ignoredFocusUntil = 0;
    }
    const ownsIndependentFlankPressure = HERO_BY_ID[this.pl.heroId]?.role === 'damage' &&
      this.teamTacticalPhase === 'pressure' && this.activeRouteName() !== 'front' &&
      this.isDesignatedSideFlanker() && isSustainSupport(enemy);
    // The flanker splits enemy attention; it does not redirect the tank and
    // frontal DPS away from the opposing frontline to manufacture a five-man
    // burst on one healer.
    if (!ownsIndependentFlankPressure) this.publishSquadFocus(enemy);
  }

  pursuitMemory() {
    const ownTarget = this.targetId ? this.world.players.get(this.targetId) : null;
    const targetIsIgnored = targetId => targetId === this.ignoredFocusTargetId &&
      this.world.t < this.ignoredFocusUntil;
    if (ownTarget?.alive && !targetIsIgnored(ownTarget.id) && this.lastKnownTargetPos &&
      this.world.t <= this.targetMemoryUntil) {
      return { targetId: ownTarget.id, pos: [...this.lastKnownTargetPos] };
    }
    const focus = this.currentSquadFocus();
    if (!focus || targetIsIgnored(focus.targetId)) return null;
    const distance = Math.hypot(
      focus.pos[0] - this.pl.move.pos[0],
      focus.pos[1] - this.pl.move.pos[1],
      focus.pos[2] - this.pl.move.pos[2],
    );
    if (distance > TEAM_FOCUS_MAX_RANGE_M) return null;
    return { targetId: focus.targetId, pos: [...focus.pos] };
  }

  planPursuit(position) {
    if (!Array.isArray(position) || position.length < 3 || !position.every(Number.isFinite)) {
      this.pursuitPath = [];
      this.pursuitGoal = null;
      return false;
    }
    const supportedStartZ = navigationFloorHeight(
      this.world,
      this.pl.move.pos[0],
      this.pl.move.pos[1],
      this.pl.move.pos[2],
    );
    const supportedTargetZ = navigationFloorHeight(
      this.world,
      position[0],
      position[1],
      position[2],
    );
    if (!Number.isFinite(supportedStartZ) || !Number.isFinite(supportedTargetZ)) {
      this.pursuitPath = [];
      this.pursuitGoal = null;
      return false;
    }
    const start = [this.pl.move.pos[0], this.pl.move.pos[1], supportedStartZ];
    const target = [position[0], position[1], supportedTargetZ];
    // Most last-known positions are in the same lane. Avoid a full grid search
    // unless a wall or height transition actually blocks the direct capsule.
    this.pursuitPath = findGroundDetourPath(this.world, start, target);
    while (this.pursuitPath.length > 0 && Math.hypot(
      this.pursuitPath[0][0] - this.pl.move.pos[0],
      this.pursuitPath[0][1] - this.pl.move.pos[1],
    ) < RECOVERY_WAYPOINT_REACHED_M) this.pursuitPath.shift();
    this.pursuitGoal = target;
    this.pursuitReplanAt = this.world.t + PURSUIT_REPLAN_SEC;
    this.stallT = 0;
    this.progressPos = null;
    this.progressT = 0;
    return this.pursuitPath.length > 0;
  }

  enterPursuit(memory) {
    const targetChanged = this.targetId !== memory.targetId;
    const goalChanged = !this.pursuitGoal || Math.hypot(
      this.pursuitGoal[0] - memory.pos[0],
      this.pursuitGoal[1] - memory.pos[1],
      this.pursuitGoal[2] - memory.pos[2],
    ) > 1.5;
    this.mode = 'pursue';
    this.targetId = memory.targetId;
    this.lastKnownTargetPos = [...memory.pos];
    const stillNeedsPath = this.pursuitPath.length === 0 && Math.hypot(
      memory.pos[0] - this.pl.move.pos[0],
      memory.pos[1] - this.pl.move.pos[1],
    ) > 1.1;
    const replanWindowOpen = this.world.t >= this.pursuitReplanAt;
    if (!this.pursuitGoal || targetChanged || (replanWindowOpen && (goalChanged || stillNeedsPath))) {
      const planned = this.planPursuit(memory.pos);
      if (!planned && Math.hypot(
        memory.pos[0] - this.pl.move.pos[0],
        memory.pos[1] - this.pl.move.pos[1],
      ) > 1.1) {
        // The short visibility detour could not prove a safe route. Do not
        // stand forever aiming into cover; ignore this stale callout and
        // resume the authored lane until the target is actually seen again.
        this.ignoredFocusTargetId = memory.targetId;
        this.ignoredFocusUntil = this.world.t + TEAM_FOCUS_MEMORY_SEC;
        this.mode = 'advance';
        this.targetId = null;
        this.clearPursuit();
        this.rejoinCurrentRoute();
      }
    }
  }

  clearPursuit() {
    this.pursuitPath = [];
    this.pursuitGoal = null;
    this.pursuitReplanAt = 0;
    this.lastKnownTargetPos = null;
    this.targetMemoryUntil = 0;
  }

  applyCombatDetour(input, enemy, dt) {
    if (this.supportRescuePath.length > 0) {
      this.combatDetourPath = [];
      return;
    }
    if (this.mode !== 'fight' || !enemy) {
      this.combatDetourPath = [];
      // Support cover owns its own bounded lifecycle in applyRoleMovement().
      // A successful LOS break commonly flips fight to pursue for one frame;
      // clearing the route here made the support immediately re-expose itself.
      return;
    }
    while (this.combatDetourPath.length > 0 && Math.hypot(
      this.combatDetourPath[0][0] - this.pl.move.pos[0],
      this.combatDetourPath[0][1] - this.pl.move.pos[1],
    ) < RECOVERY_WAYPOINT_REACHED_M) this.combatDetourPath.shift();

    const moving = !!(input.f || input.b || input.l || input.r);
    this.updateStall(dt, moving);
    if (this.combatDetourPath.length === 0 && this.stallT > STALL_REPLAN_SEC) {
      this.combatDetourPath = findGroundDetourPath(
        this.world,
        [...this.pl.move.pos],
        [...enemy.move.pos],
      );
      this.stallT = 0;
      this.progressPos = null;
      this.progressT = 0;
    }
    const waypoint = this.combatDetourPath[0];
    if (waypoint) {
      this.steerTowardAngle(input, Math.atan2(
        waypoint[1] - this.pl.move.pos[1],
        waypoint[0] - this.pl.move.pos[0],
      ));
    }
  }

  visibleEnemy() {
    const w = this.world;
    const eye = eyePosition(this.pl, w.mv);
    const focus = this.currentSquadFocus();
    const heroRole = HERO_BY_ID[this.pl.heroId]?.role;
    const preferredMaxRange = HERO_POLICIES[this.pl.heroId]?.range?.[1] || 24;
    // A fixed 40m perception horizon made the 24-50m specialist unable to
    // acquire targets while standing inside its authored combat envelope.
    // Keep the common horizon, but honour each hero's SSOT policy range.
    const scanRangeM = Math.max(40, preferredMaxRange);
    // The single authorised side DPS can pressure a visible primary healer,
    // but only after its tank has established the shared pressure phase. This
    // makes a support pick a real way to break sustain without allowing a
    // pre-fight solo flank to manufacture the same advantage.
    const canPressureSustain = heroRole === 'damage'
      && this.teamTacticalPhase === 'pressure'
      && this.activeRouteName() !== 'front'
      && this.isDesignatedSideFlanker();
    const chargingWeapon = HERO_BY_ID[this.pl.heroId]?.weapon?.type === 'charge'
      && Number.isFinite(this.pl.weapon?.chargeStartedAt);
    // Shooting an attacker off a pressured ally is not a role-locked duty.
    // Any bot that is not currently the designated side flanker may peel; the
    // normal target-claim cap keeps this bounded to two responders.
    const canPeel = !canPressureSustain;
    const recoveryProvider = this.teamRecoveryProvider();
    const protectedAlly = this.rescueAlly() || recoveryProvider;
    const peelThreatIds = new Set(
      canPeel && protectedAlly
        ? this.hostileTargetClaimers(protectedAlly.id).map(attacker => attacker.id)
        : [],
    );
    const enemyFrontline = [...w.players.values()]
      .filter(other => (
        other.team !== this.pl.team && other.alive && HERO_BY_ID[other.heroId]?.role === 'frontline'
      ))
      .sort(compareStablePlayers)[0] || null;
    let focused = null;
    let sustain = null;
    let sustainD = Infinity;
    let peelThreat = null;
    let peelThreatD = Infinity;
    let finishable = null;
    let finishableRatio = Infinity;
    let finishableD = Infinity;
    let frontline = null;
    let frontlineD = Infinity;
    let damage = null;
    let damageD = Infinity;
    let chargingTarget = null;
    let best = null, bestD = scanRangeM;
    const visible = [];
    for (const other of w.players.values()) {
      if (other.team === this.pl.team || !other.alive) continue;
      const tp = [other.move.pos[0], other.move.pos[1], other.move.pos[2] + 1.2];
      const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > scanRangeM) continue;
      const wall = w.collider.raycast(eye[0], eye[1], eye[2], dx / d, dy / d, dz / d, d);
      if (wall !== Infinity) continue;
      const hpRatio = other.hp / Math.max(1, other.maxHp);
      const sustainDistanceFromFrontline = enemyFrontline
        ? distance2d(other.move.pos, enemyFrontline.move.pos)
        : Infinity;
      const sustainLateralFromFrontline = enemyFrontline
        ? Math.abs(other.move.pos[1] - enemyFrontline.move.pos[1])
        : Infinity;
      const sustainExposed = isSustainSupport(other) && (
        !enemyFrontline
        || hpRatio < 0.55
        || sustainDistanceFromFrontline > SUPPORT_TANK_REACH_M
        || sustainLateralFromFrontline > SUPPORT_MAX_LATERAL_M
        || (sustainDistanceFromFrontline > SUPPORT_WOUNDED_TANK_REACH_M && hpRatio < 0.8)
      );
      visible.push({ player: other, distance: d, sustainExposed });
      if (chargingWeapon && other.id === this.targetId) chargingTarget = other;
      if (other.id === focus?.targetId) focused = other;
      if (canPressureSustain && sustainExposed &&
        winsStableDistanceTie(other, d, sustain, sustainD)) {
        sustain = other;
        sustainD = d;
      }
      if (HERO_BY_ID[other.heroId]?.role === 'frontline' &&
        winsStableDistanceTie(other, d, frontline, frontlineD)) {
        frontline = other;
        frontlineD = d;
      }
      if (HERO_BY_ID[other.heroId]?.role === 'damage' &&
        winsStableDistanceTie(other, d, damage, damageD)) {
        damage = other;
        damageD = d;
      }
      const imminentCloseThreat = protectedAlly &&
        HERO_BY_ID[other.heroId]?.role === 'damage' &&
        distance2d(other.move.pos, protectedAlly.move.pos) <= 8;
      if ((peelThreatIds.has(other.id) || imminentCloseThreat) &&
        winsStableDistanceTie(other, d, peelThreat, peelThreatD)) {
        peelThreat = other;
        peelThreatD = d;
      }
      if (this.teamTacticalPhase === 'pressure' && hpRatio <= FINISH_FOCUS_HP_RATIO && (
        hpRatio < finishableRatio - 1e-9 ||
        (Math.abs(hpRatio - finishableRatio) <= 1e-9 &&
          winsStableDistanceTie(other, d, finishable, finishableD))
      )) {
        finishable = other;
        finishableRatio = hpRatio;
        finishableD = d;
      }
      if (winsStableDistanceTie(other, d, best, bestD)) { best = other; bestD = d; }
    }
    // Reprioritising during a charged shot releases a weak shot toward a new
    // angle. Finish the current visible shot, then resume normal squad focus.
    if (chargingTarget) return chargingTarget;
    // The deployable-zone support gets an explicit damage-hero fallback when
    // the opposing pressure anchor is behind cover.  Without that bounded
    // fallback, Koyomi's lane zone could decide a fight by farming the enemy
    // healer instead of helping the tank/DPS exchange.
    const preferred = sustain || peelThreat || finishable || frontline ||
      // Koyomi's deployable zone is a lane tool, not a dueling beam.  When its
      // frontline target is hidden, put the zone on an enemy damage angle
      // before allowing it to farm the opposing healer.  Other supports keep
      // the broader fallback because their direct shot is also their rescue or
      // peel affordance.
      // The authored Oshioi map's east approach exposes the damage angle
      // earlier than the west approach.  Koyomi adapts to that known sightline
      // instead of making the west-side support abandon the pressure anchor.
      (this.pl.heroId === 'koyomi' && this.world.sideOf(this.pl.team) === 'east'
        ? damage : null) || focused || best;
    const claimLimit = target => (
      this.teamTacticalPhase === 'pressure' &&
      target.hp / Math.max(1, target.maxHp) <= FINISH_FOCUS_HP_RATIO
        ? MAX_FINISH_TARGET_ATTACKERS
        : MAX_SHARED_TARGET_ATTACKERS
    );
    if (!preferred || this.targetClaimCount(preferred.id) < claimLimit(preferred)) {
      return preferred;
    }
    const alternatives = visible.filter(candidate => (
      candidate.player.id !== preferred.id
      && (!isSustainSupport(candidate.player) || candidate.sustainExposed)
      && this.targetClaimCount(candidate.player.id) < claimLimit(candidate.player)
    ));
    const rolePriority = candidate => {
      const role = HERO_BY_ID[candidate.player.heroId]?.role;
      return role === 'damage' ? 0 : role === 'frontline' ? 1 : 2;
    };
    alternatives.sort((left, right) => (
      rolePriority(left) - rolePriority(right)
      || left.distance - right.distance
      || compareStablePlayers(left.player, right.player)
    ));
    // Saturation is a hard team contract. Returning the preferred target here
    // made a lone visible enemy fail open to four or five attackers, bypassing
    // both the normal split and the bounded finish window.
    return alternatives[0]?.player || null;
  }

  hasAllyLineOfSight(other, maxRange = 40) {
    if (!other?.alive || other.team !== this.pl.team || other.id === this.pl.id) return false;
    const eye = eyePosition(this.pl, this.world.mv);
    const target = [other.move.pos[0], other.move.pos[1], other.move.pos[2] + 1.1];
    const dx = target[0] - eye[0];
    const dy = target[1] - eye[1];
    const dz = target[2] - eye[2];
    const distance = Math.hypot(dx, dy, dz);
    if (distance <= 1e-6 || distance > maxRange) return false;
    return this.world.collider.raycast(
      eye[0], eye[1], eye[2],
      dx / distance, dy / distance, dz / distance, distance,
    ) === Infinity;
  }

  rescueAlly(maxRange = 40) {
    let best = null;
    let bestScore = 0;
    for (const other of this.world.players.values()) {
      if (other.id === this.pl.id || other.team !== this.pl.team || !other.alive) continue;
      const distance = Math.hypot(
        other.move.pos[0] - this.pl.move.pos[0],
        other.move.pos[1] - this.pl.move.pos[1],
        other.move.pos[2] - this.pl.move.pos[2],
      );
      if (distance > maxRange) continue;
      const ratio = other.hp / Math.max(1, other.maxHp);
      const hostileClaims = this.hostileTargetClaimCount(other.id);
      // Reposition only for a real rescue window. A healthy ally behind a
      // wall must not pull its recovery provider out of the active front.
      if (ratio > 0.55 && !(hostileClaims >= PRELOAD_HOSTILE_CLAIMS && ratio <= 0.85)) continue;
      const anchorPriority = heroCanAnchorPressure(HERO_BY_ID[other.heroId]) ? 0.15 : 0;
      const pressurePriority = Math.min(
        HOSTILE_CLAIM_PRESSURE_CAP,
        hostileClaims * HOSTILE_CLAIM_PRESSURE_BONUS,
      ) + (
        hostileClaims >= MAX_FINISH_TARGET_ATTACKERS && ratio <= FINISH_FOCUS_HP_RATIO
          ? FINISH_FOCUS_RESCUE_BONUS
          : 0
      );
      const score = 1 - ratio + anchorPriority + pressurePriority;
      if (score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 &&
          (!best || compareStablePlayers(other, best) < 0))) {
        best = other;
        bestScore = score;
      }
    }
    return best;
  }

  woundedAlly(maxRange = 40) {
    let best = null;
    // Supports in a live frontline should start restoring health before an
    // ally reaches the emergency band.  The old 15% deficit floor let a tank
    // spend the first part of every pressure window without a healer, which
    // made the Hibari/Karakasa shell collapse before its mitigation cycle.
    // Keep the threshold bounded so healthy allies are not pulled out of lane.
    let bestScore = 0.08;
    for (const other of this.world.players.values()) {
      if (other.id === this.pl.id || other.team !== this.pl.team || !other.alive) continue;
      const distance = Math.hypot(
        other.move.pos[0] - this.pl.move.pos[0],
        other.move.pos[1] - this.pl.move.pos[1],
        other.move.pos[2] - this.pl.move.pos[2],
      );
      if (distance > maxRange) continue;
      if (!this.hasAllyLineOfSight(other, maxRange)) continue;
      const ratio = other.hp / Math.max(1, other.maxHp);
      const hostileClaims = this.hostileTargetClaimCount(other.id);
      const mayPreloadStoredHeal = this.pl.heroId === 'tsuzuri' &&
        hostileClaims >= PRELOAD_HOSTILE_CLAIMS;
      if (ratio >= 1 - 1e-9 && !mayPreloadStoredHeal) continue;
      // A visible frontline receives a modest priority bonus, but a critical
      // exposed ally still wins over a merely injured tank.
      const tankPriority = heroCanAnchorPressure(HERO_BY_ID[other.heroId]) ? 0.15 : 0;
      const pressurePriority = Math.min(
        HOSTILE_CLAIM_PRESSURE_CAP,
        hostileClaims * HOSTILE_CLAIM_PRESSURE_BONUS,
      ) + (
        hostileClaims >= MAX_FINISH_TARGET_ATTACKERS && ratio <= FINISH_FOCUS_HP_RATIO
          ? FINISH_FOCUS_RESCUE_BONUS
          : 0
      );
      const score = 1 - ratio + tankPriority + pressurePriority;
      if (score > bestScore + 1e-9 ||
        (Math.abs(score - bestScore) <= 1e-9 &&
          (!best || compareStablePlayers(other, best) < 0))) {
        best = other;
        bestScore = score;
      }
    }
    return best;
  }

  think(dt) {
    const w = this.world;
    const pl = this.pl;
    const input = {
      f: false, b: false, l: false, r: false, jump: false, crouch: false,
      fire: false, primary: false, secondary: false, ability1: false, ability2: false, ultimate: false,
      reload: false, yaw: pl.move.yaw, pitch: 0, interpMs: 0,
    };

    // ラウンドが変わったら経路と状態をリセット（サイド入替対応）
    if (w.flow.round !== this.lastRound) {
      this.lastRound = w.flow.round;
      this.route = this.chooseRoute();
      this.wpIndex = 0;
      this.mode = 'regroup';
      this.regroupT = 0;
      this.targetId = null;
      this.clearPursuit();
      this.combatDetourPath = [];
      this.clearSupportRescuePath();
      this.ignoredFocusTargetId = null;
      this.ignoredFocusUntil = 0;
      this.stallT = 0;
      this.ultimateReadySince = null;
      this.needleReloading = false;
      this.lastDefensiveActionAt = Number.NEGATIVE_INFINITY;
      this.pendingActionIntent = null;
      this.pendingActionTargetId = null;
      this.resetDamageObservation();
      this.recoveryPath = [];
      this.regroupGoal = null;
      this.regroupPlanRetryAt = 0;
      this.regroupPlanStart = null;
      this.dpsAngleRecoveryGoal = null;
      this.dpsAngleRecoveryRetryAt = 0;
      this.lowGroundT = 0;
      this.ledgeBrakeT = 0;
    }

    if (!pl.alive) {
      // 死亡→復帰時は経路を選び直し、再集合から
      if (this.wasAlive) {
        this.route = this.chooseRoute();
        this.wpIndex = 0;
        this.mode = 'regroup';
        this.regroupT = 0;
        this.targetId = null;
        this.clearPursuit();
        this.combatDetourPath = [];
        this.supportCoverPath = [];
        this.supportCoverThreatId = null;
        this.supportCoverReplanAt = 0;
        this.supportCoverCommitUntil = 0;
        this.clearSupportRescuePath();
        this.ignoredFocusTargetId = null;
        this.ignoredFocusUntil = 0;
        this.recoveryPath = [];
        this.regroupGoal = null;
        this.regroupPlanRetryAt = 0;
        this.regroupPlanStart = null;
        this.dpsAngleRecoveryGoal = null;
        this.dpsAngleRecoveryRetryAt = 0;
        this.lowGroundT = 0;
        this.ledgeBrakeT = 0;
        this.lastDefensiveActionAt = Number.NEGATIVE_INFINITY;
        this.pendingActionIntent = null;
        this.pendingActionTargetId = null;
        this.resetDamageObservation();
      }
      this.wasAlive = false;
      this.lastPulseSlot = null;
      this.ultimateReadySince = null;
      this.needleReloading = false;
      this.pendingActionIntent = null;
      this.pendingActionTargetId = null;
      this.supportCoverPath = [];
      this.supportCoverThreatId = null;
      this.supportCoverCommitUntil = 0;
      this.clearSupportRescuePath();
      this.submit(input);
      return;
    }
    this.wasAlive = true;

    const state = w.flow.state;
    if (state !== 'ACTIVE') {
      // 準備中は待機（扉が開くまで）。前を向いておく
      input.yaw = w.sideOf(pl.team) === 'east' ? Math.PI : 0;
      this.lastPulseSlot = null;
      this.ultimateReadySince = null;
      this.needleReloading = false;
      this.pendingActionIntent = null;
      this.clearSupportRescuePath();
      this.resetDamageObservation();
      this.submit(input);
      return;
    }

    this.observeDamagePressure();

    // 交戦判定
    const teamIntent = deriveTeamTacticalIntent(w, pl.team);
    const coordinatedTeam = teamIntent.rosterComplete;
    const enemyTeamIntent = deriveTeamTacticalIntent(w, pl.team === 0 ? 1 : 0);
    this.syncTeamTacticalPhase(teamIntent, coordinatedTeam);
    const teamPhaseLocked = coordinatedTeam && teamIntent.phase !== 'pressure';
    let enemy = this.visibleEnemy();
    const enemyRoster = [...w.players.values()].filter(other => other.team !== pl.team);
    // A proper match always has a full opposing roster.  An unanswered pick
    // opens a bounded trade window; after it expires, the winning team
    // consolidates instead of chasing the retreat all the way to spawn.
    const enemyHasCasualty = coordinatedTeam &&
      enemyRoster.length >= teamIntent.expectedSize && enemyRoster.some(other => !other.alive);
    const ownDeadCount = [...w.players.values()].filter(other => (
      other.team === pl.team && !other.alive
    )).length;
    const enemyDead = enemyRoster.filter(other => !other.alive);
    const enemyDeathTimes = enemyDead.map(other => w.respawn?.pending?.get(other.id))
      .filter(Number.isFinite);
    const firstEnemyDeathAt = enemyDeathTimes.length
      ? Math.min(...enemyDeathTimes)
      : Number.NEGATIVE_INFINITY;
    const enemyCasualtyAgeSec = objectiveClock(w) - firstEnemyDeathAt;
    const enemyStillAtFront = enemyRoster.some(other => other.alive &&
      distance2d(other.move.pos, w.map.objective.center) <= TEAM_FRONT_ENGAGE_RADIUS_M);
    const unansweredAdvantageExpired = enemyDead.length > ownDeadCount &&
      enemyCasualtyAgeSec > TEAM_TRADE_WINDOW_SEC;
    // A respawn is not a completed regroup. Keep the winning squad from
    // restarting pressure on an isolated returnee while the opposing team is
    // still executing its shared retreat. The latch releases when that team
    // advances or re-establishes pressure, not merely when aliveCount returns 5.
    const enemyRegrouping = enemyTeamIntent.rosterComplete &&
      enemyTeamIntent.retreating && enemyTeamIntent.phase === 'regroup';
    const enemyFightOver = enemyRegrouping || (enemyHasCasualty && (
      !enemyStillAtFront || unansweredAdvantageExpired
    ));
    if (coordinatedTeam && teamIntent.phase === 'regroup') {
      enemy = null;
      const forwardX = w.sideOf(pl.team) === 'east' ? -1 : 1;
      const aheadOfStaging = (pl.move.pos[0] - teamIntent.staging[0]) * forwardX > 2;
      const sideDpsWaitingForAnchor = !teamIntent.retreating &&
        HERO_BY_ID[pl.heroId]?.role === 'damage' && aheadOfStaging;
      if (sideDpsWaitingForAnchor) {
        // Before the first committed push, a flanker that has already reached
        // a safe forward angle waits there. It does not drift into an enemy
        // duel merely because the pressure anchor is still assembling behind it.
        this.mode = 'regroup';
        this.targetId = null;
        this.clearPursuit();
        this.combatDetourPath = [];
        this.recoveryPath = [];
      } else {
        this.enterRegroup();
      }
    } else if (coordinatedTeam && teamIntent.phase === 'approach') {
      enemy = null;
      this.targetId = null;
      this.clearPursuit();
      this.combatDetourPath = [];
      if (this.recoveryPath.length > 0 && distance2d(pl.move.pos, teamIntent.staging) > 2) {
        this.mode = 'regroup';
      } else {
        this.mode = 'advance';
      }
    }
    if (enemyFightOver) {
      enemy = null;
      this.targetId = null;
      this.clearPursuit();
      this.combatDetourPath = [];
      if (this.mode === 'fight' || this.mode === 'pursue') this.mode = 'advance';
    }
    const traversingStair = isOnAuthoredStair(w, pl);
    if (enemy && HERO_BY_ID[pl.heroId]?.role === 'damage' && this.activeRouteName() !== 'front') {
      const pressureAnchor = this.teamPressureAnchor();
      const ownAlive = [...w.players.values()].filter(o => o.team === pl.team && o.alive).length;
      const enemyAlive = [...w.players.values()].filter(o => o.team !== pl.team && o.alive).length;
      const anchorReady = !!pressureAnchor;
      if (!anchorReady || (ownAlive < enemyAlive && !teamIntent.tradeWindowActive)) {
        enemy = null;
        this.enterRegroup();
      }
    }
    if (enemy && this.dpsAngleRequiresDisengage(teamIntent, input, enemy)) enemy = null;
    let stairCombatTarget = null;
    if (enemy && traversingStair) {
      // A stair tread still owns locomotion, but it must not blind a bot that
      // already has a safe line of fire. Preserve target/charge state here;
      // movement abilities remain blocked by movementActionIsSafe().
      const targetChanged = this.targetId !== enemy.id;
      this.claimTarget(enemy);
      this.targetId = enemy.id;
      if (targetChanged) this.aimErr = 6;
      this.rememberVisibleEnemy(enemy);
      this.targetLostT = 0;
      stairCombatTarget = enemy;
    } else if (enemy) {
      // Combat movement owns the current frame. A stale recovery path would
      // otherwise resume from an obsolete pre-fight position; rebuild it when
      // the target is actually lost.
      if (this.mode !== 'fight') {
        this.recoveryPath = [];
        this.dpsAngleRecoveryGoal = null;
        this.dpsAngleRecoveryRetryAt = 0;
        this.stallT = 0;
        this.progressPos = null;
        this.progressT = 0;
        this.combatDetourPath = [];
      }
      const targetChanged = this.targetId !== enemy.id;
      this.claimTarget(enemy);
      this.targetId = enemy.id;
      if (targetChanged) this.aimErr = 6;
      this.rememberVisibleEnemy(enemy);
      this.pursuitPath = [];
      this.pursuitGoal = null;
      this.targetLostT = 0;
      this.mode = 'fight';
    } else {
      this.claimTarget(null);
      this.targetLostT += dt;
      const memory = traversingStair || teamPhaseLocked ? null : this.pursuitMemory();
      // An active recovery owns movement until it is completed or interrupted.
      // Team callouts cannot replace its carefully swept waypoint sequence.
      if (memory && this.recoveryPath.length === 0) {
        this.enterPursuit(memory);
      } else if (this.mode === 'fight' || this.mode === 'pursue') {
        this.mode = 'advance';
        this.targetId = null;
        this.clearPursuit();
        this.combatDetourPath = [];
        this.rejoinCurrentRoute();
      }
    }

    const lowGroundDisadvantage = pl.move.grounded && pl.move.pos[2] < 1
      && (this.route !== 'shallows' || (enemy && enemy.move.pos[2] > pl.move.pos[2] + 1.5));
    this.lowGroundT = lowGroundDisadvantage ? this.lowGroundT + dt : 0;
    if (this.lowGroundT >= 2) {
      this.targetId = null;
      enemy = null;
      this.clearPursuit();
      this.recoverViaShallows();
    }

    const context = this.combatContext(enemy);
    const actionSlot = this.applyHeroAction(input, context, {
      defenseOnly: coordinatedTeam && (teamIntent.phase === 'regroup' || enemyFightOver),
    });

    if (this.mode === 'regroup') {
      this.regroupT += dt;
      // 近くの生存味方が1人以上出撃準備できるか、3秒で単独進軍
      let near = 0;
      let alive = 0;
      let frontlineAlive = false;
      let sustainClustered = false;
      for (const o of w.players.values()) {
        if (o.id !== pl.id && o.team === pl.team && o.alive) {
          alive++;
          const d = Math.hypot(o.move.pos[0] - pl.move.pos[0], o.move.pos[1] - pl.move.pos[1]);
          if (d < 14) near++;
          if (HERO_BY_ID[o.heroId]?.role === 'frontline') frontlineAlive = true;
          if (isSustainSupport(o) && d < 18) sustainClustered = true;
        }
      }
      // 敵の甕が進んでいる時は再集合を省いて緊急前進（延長への関与を優先）
      const obj = w.objective;
      const urgent = obj.owner >= 0 && obj.owner !== pl.team && obj.pot[obj.owner] >= 700;
      const clustered = near >= 3;
      const ready = alive + 1 >= 4 && clustered &&
        (HERO_BY_ID[pl.heroId]?.role === 'frontline' || frontlineAlive) &&
        (isSustainSupport(pl) || sustainClustered);
      if (!coordinatedTeam && ((ready && this.regroupT > 0.25) || urgent)) this.mode = 'advance';
    }

    if (this.mode === 'pursue') {
      const waypoint = this.pursuitPath[0] || this.lastKnownTargetPos;
      if (!waypoint) {
        this.mode = 'advance';
        this.targetId = null;
        this.clearPursuit();
        this.rejoinCurrentRoute();
      } else {
        const dx = waypoint[0] - pl.move.pos[0];
        const dy = waypoint[1] - pl.move.pos[1];
        const distance = Math.hypot(dx, dy);
        if (this.pursuitPath.length > 0 && distance < RECOVERY_WAYPOINT_REACHED_M) {
          this.pursuitPath.shift();
          this.stallT = 0;
        } else if (distance > 1.1) {
          input.yaw = Math.atan2(dy, dx);
          input.f = true;
          this.updateStall(dt, true);
          if (this.stallT > STALL_JUMP_SEC && !traversingStair) input.jump = true;
          if (this.stallT > STALL_REPLAN_SEC && w.t >= this.pursuitReplanAt) {
            if (!this.planPursuit(this.lastKnownTargetPos)) {
              this.mode = 'advance';
              this.targetId = null;
              this.clearPursuit();
              this.rejoinCurrentRoute();
            }
          }
        }
      }
    }

    if (this.mode === 'advance' || this.mode === 'regroup') {
      const pts = this.routePoints();
      const followingRecovery = this.recoveryPath.length > 0;
      // Regroup movement is deliberately limited to its checked path. Once
      // that path reaches staging, falling back to the normal route would
      // leak a bot toward another lane before the tank, sustain, and squad
      // gate have released together.
      const holdingRegroupStaging = this.mode === 'regroup' && !followingRecovery;
      if (holdingRegroupStaging) {
        // Hold the staging point until the regroup gate changes mode.
      } else if (!followingRecovery && this.wpIndex >= pts.length) {
        this.mode = 'hold';
      } else {
        const wp = followingRecovery ? this.recoveryPath[0] : pts[this.wpIndex];
        const dx = wp[0] - pl.move.pos[0], dy = wp[1] - pl.move.pos[1];
        const d = Math.hypot(dx, dy);
        const verticalDistance = Math.abs(wp[2] - pl.move.pos[2]);
        const recoveryNext = this.recoveryPath[1];
        const canSafelySkipRecoveryNode = !recoveryNext || canTraverseGroundSegment(
          this.world,
          [pl.move.pos[0], pl.move.pos[1], pl.move.pos[2]],
          recoveryNext,
        );
        const reached = followingRecovery
          ? d < RECOVERY_WAYPOINT_REACHED_M && canSafelySkipRecoveryNode
          : d < 1.5 && verticalDistance < 1.2;
        if (reached) {
          if (followingRecovery) {
            this.recoveryPath.shift();
            const nextRecovery = this.recoveryPath[0];
            // A* intentionally starts with the current cell. Consume that
            // bookkeeping node and immediately move toward the next swept
            // waypoint instead of producing a visible idle frame.
            if (nextRecovery) {
              input.yaw = Math.atan2(
                nextRecovery[1] - pl.move.pos[1],
                nextRecovery[0] - pl.move.pos[0],
              );
              input.f = true;
              this.updateStall(dt, true);
            }
          } else {
            this.wpIndex++;
            // Author-authored stair and route nodes may be closer than the
            // normal reach threshold.  Consume the bookkeeping node and
            // immediately steer toward the next checked segment so a bot
            // does not visibly pause on every tread or route join.
            const nextWaypoint = pts[this.wpIndex];
            if (nextWaypoint) {
              input.yaw = Math.atan2(
                nextWaypoint[1] - pl.move.pos[1],
                nextWaypoint[0] - pl.move.pos[0],
              );
              input.f = true;
              this.updateStall(dt, true);
            }
          }
          this.stallT = 0;
        } else if (this.mode === 'advance' || this.mode === 'regroup') {
          input.yaw = Math.atan2(dy, dx);
          input.f = true;
          this.updateStall(dt, true);
          if (this.stallT > STALL_JUMP_SEC && !traversingStair) input.jump = true;
          if (this.stallT > STALL_REPLAN_SEC) {
            // A waypoint is never skipped blindly: rejoin a reachable low
            // node and let the authored shallows stair restore elevation.
            this.rejoinCurrentRoute();
          }
        }
      }
    }

    if (this.mode === 'hold') {
      const c = w.map.objective.center;
      // 自軍占有中は2人だけ点上維持、残りは敵側前方で哨戒（空間を作る）
      if (w.objective.owner === pl.team) {
        const mates = [];
        for (const o of w.players.values()) {
          if (o.team === pl.team && o.alive) {
            mates.push({
              player: o,
              distance: Math.hypot(o.move.pos[0] - c[0], o.move.pos[1] - c[1]),
            });
          }
        }
        mates.sort((left, right) => (
          left.distance - right.distance || compareStablePlayers(left.player, right.player)
        ));
        const rank = mates.findIndex(mate => mate.player.id === pl.id);
        const enemySide = w.sideOf(1 - pl.team);
        const dir = enemySide === 'east' ? 1 : -1;
        if (rank >= 2) {
          const parity = stableParity(logicalPlayerIdentity(pl, this.rng)) * 6
            * (w.sideOf(pl.team) === 'west' ? -1 : 1);
          const post = [c[0] + dir * 10, c[1] + parity];
          const dx = post[0] - pl.move.pos[0], dy = post[1] - pl.move.pos[1];
          if (Math.hypot(dx, dy) > 2) {
            input.yaw = Math.atan2(dy, dx);
            input.f = true;
            this.updateStall(dt, true);
            if (this.stallT > STALL_JUMP_SEC) input.jump = true;
          } else {
            input.yaw = Math.atan2(0 - 0, dir); // 敵側を向く
          }
          this.applySupportPrimary(input, context);
          this.aimForAction(input, actionSlot, context);
          this.applyRoleMovement(input, context);
          this.applyFormationMovement(input, context);
          input.primary = input.fire;
          this.submit(input);
          return;
        }
      }
      // 目標円柱内で井桁の周りを廻りながら維持。敵が来なければ位置を保つ
      this.holdAngle += dt * 0.5;
      const hx = c[0] + Math.cos(this.holdAngle) * 3.5;
      const hy = c[1] + Math.sin(this.holdAngle) * 3.5;
      const dx = hx - pl.move.pos[0], dy = hy - pl.move.pos[1];
      if (Math.hypot(dx, dy) > 1) {
        input.yaw = Math.atan2(dy, dx);
        input.f = true;
      }
      // 目標を外れていたら戻る。大きく離れたら経路追従に復帰
      const od = Math.hypot(pl.move.pos[0] - c[0], pl.move.pos[1] - c[1]);
      if (od > 12) {
        this.mode = 'advance';
        this.wpIndex = this.nearestWpIndex();
      } else if (od > 6.5) {
        input.yaw = Math.atan2(c[1] - pl.move.pos[1], c[0] - pl.move.pos[0]);
        input.f = true;
        this.updateStall(dt, true);
        if (this.stallT > STALL_JUMP_SEC) input.jump = true;
        if (this.stallT > STALL_REPLAN_SEC && pl.move.pos[2] < 2) this.recoverViaShallows();
      }
    }

    const activeCombatTarget = stairCombatTarget || (
      this.mode === 'fight' && enemy && this.targetId === enemy.id ? enemy : null
    );
    if (activeCombatTarget) {
      const target = activeCombatTarget;
      if (target.alive) {
        const eye = eyePosition(pl, w.mv);
        // 胸を狙う（頭は狙わない）
        const tp = [target.move.pos[0], target.move.pos[1], target.move.pos[2] + 1.1];
        const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        // 照準誤差の収束
        // A fixed angular floor turns into an ever larger linear miss radius
        // (0.8deg is about 0.7m at 50m), effectively disabling precision kits.
        // Preserve the same body-scale error used by close-range bots instead.
        this.aimErr = Math.max(botAimFloorDeg(dist), this.aimErr - 2.5 * dt);
        const err = (this.aimErr * Math.PI) / 180;
        input.yaw = Math.atan2(dy, dx) + (this.rng() * 2 - 1) * err;
        input.pitch = Math.atan2(dz, Math.hypot(dx, dy)) + (this.rng() * 2 - 1) * err;
        input.fire = this.aimErr < 3.5;
        // ストレイフ
        this.strafeT -= dt;
        if (!traversingStair) {
          if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 0.7 + this.rng() * 0.9; }
          if (this.strafeDir > 0) input.r = true; else input.l = true;
        }
      } else {
        this.mode = 'advance';
        this.targetId = null;
        this.clearPursuit();
        this.aimErr = 6;
        this.rejoinCurrentRoute();
      }
    } else {
      this.aimErr = Math.min(6, this.aimErr + 4 * dt); // 非交戦で誤差リセット
    }

    this.applySupportPrimary(input, context);
    this.aimForAction(input, actionSlot, context);
    if (!traversingStair) {
      this.applyRoleMovement(input, context);
      this.applyFormationMovement(input, context);
      this.applyCombatDetour(input, enemy, dt);
    }
    input.primary = input.fire;
    this.submit(input);
  }
}
