// 潮占を軸に、ロールの間合いと18ヒーロー固有の武器・能力を使い分けるサーバー権威ボット。
// 能力は必ず1tickのpressと次tickのreleaseをqueueInputへ流し、能力側のedge判定を共有する。

import { eyePosition } from '../shared/sim/combat.js';
import { HERO_BY_ID } from '../shared/data/heroes.js';

const ROUTES = ['front', 'front', 'cloister', 'shallows']; // frontを厚めに
const ALLY_TARGET_BEHAVIORS = new Set([
  'ally_grapple', 'link_ally', 'ally_damage_buff', 'redirect_link',
  'release_stored_heal', 'cooldown_zone', 'healing_trail',
]);
const SUPPORT_MOBILITY_BEHAVIORS = new Set(['dash', 'air_dash', 'zone_dash']);

const between = (value, min, max) => value >= min && value <= max;
const ULTIMATE_LIVENESS_DELAY_SEC = 8;
const FRONTLINE_STANDARD_LEAD_M = 3;
const DAMAGE_FLANK_LEAD_M = 7;
const DAMAGE_FLANK_MIN_LATERAL_M = 4;
const DAMAGE_FLANK_MAX_LATERAL_M = 12;
const SUPPORT_TANK_REACH_M = 16;
const SUPPORT_FOLLOW_DISTANCE_M = 5;
const SUPPORT_LATERAL_OFFSET_M = 2.5;
const TANK_ALLY_RANGE_M = 14;
const TANK_SUPPORT_RANGE_M = 18;
const TANK_CRITICAL_HP_RATIO = 0.32;
const TANK_RETREAT_HP_RATIO = 0.5;
const TANK_CONTEST_HP_RATIO = 0.55;
const FORMATION_STEER_MAX_DISTANCE_M = 24;

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
const HERO_POLICIES = Object.freeze({
  zairu: {
    range: [2, 9],
    ultimateLiveness: c => c.enemyDensity >= 1 && c.enemyDistance <= 20,
    actions: [
      ['ultimate', c => c.enemyDensity >= 2 && c.enemyDistance <= 20],
      ['ability2', c => c.inFight && (c.selfHpRatio < 0.58 || (c.resourceRatio >= 0.8 && c.enemyDistance <= 9))],
      ['ability1', c => !c.hasAnchor && c.resourceRatio >= 0.55 && between(c.enemyDistance, 7, 28)],
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
      ['ability2', c => c.enemyDistance < 10 || c.selfHpRatio < 0.5],
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
      ['secondary', c => c.ammoRatio <= 0.5],
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
      ['ability1', c => c.resourceValue >= 40 && c.allyHpRatio < 0.85 && c.enemyDensity >= 1],
      ['ability2', c => c.allyHpRatio < 0.55 && c.allyDistance > 8],
      ['secondary', c => c.allyDistance <= 30 && c.enemyDensity >= 1],
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
    this.route = ROUTES[Math.floor(rng() * ROUTES.length)];
    this.wpIndex = 0;
    this.aimErr = 6;            // 度。可視中に収束
    this.targetId = null;
    this.targetLostT = 0;
    this.strafeDir = 1;
    this.strafeT = 0;
    this.stallT = 0;
    this.regroupT = 0;
    this.holdAngle = rng() * Math.PI * 2;
    this.wasAlive = true;
    this.lastRound = 1;
    this.progressPos = null;   // 実変位ベースのスタック検知
    this.progressT = 0;
    this.seq = player.lastAckSeq || 0;
    this.lastPulseSlot = null;
    this.ultimateReadySince = null;
  }

  submit(input) {
    this.world.queueInput(this.pl.id, { ...input, seq: ++this.seq });
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

  combatContext(enemy = null) {
    const pl = this.pl;
    const hero = HERO_BY_ID[pl.heroId];
    const ally = this.woundedAlly();
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
    const enemyStatuses = enemy?.abilities?.statuses || [];
    const nearestAlly = allies.reduce((best, other) =>
      (!best || distanceTo(other) < distanceTo(best) ? other : best), null);
    return {
      hero,
      enemy,
      ally,
      nearestAlly,
      inFight: !!enemy,
      enemyDistance: distanceTo(enemy),
      allyDistance: distanceTo(ally),
      nearestAllyDistance: distanceTo(nearestAlly),
      enemyDensity: enemy
        ? enemies.filter(other => distanceBetween(other, enemy) <= 8).length
        : enemies.filter(other => distanceTo(other) <= 18).length,
      alliesNearby: allies.filter(other => distanceTo(other) <= 14).length,
      teamInjured: team.filter(other => other.hp / Math.max(1, other.maxHp) < 0.78).length,
      selfHpRatio: pl.hp / Math.max(1, pl.maxHp),
      allyHpRatio: ally ? ally.hp / Math.max(1, ally.maxHp) : 1,
      resourceValue,
      resourceRatio: resourceMax ? resourceValue / resourceMax : 0,
      ammoRatio: hero?.weapon?.magSize ? pl.weapon.ammo / hero.weapon.magSize : 1,
      cooldowns: pl.abilities?.cooldowns || {},
      cooldownBurden: team.reduce((total, other) => total + Object.values(other.abilities?.cooldowns || {})
        .reduce((sum, value) => sum + Math.max(0, value || 0), 0), 0),
      allyStoredHeal: storedHeal(ally),
      teamStoredHeal: team.reduce((sum, other) => sum + storedHeal(other), 0),
      hasAnchor: !!pl.abilities?.heroState?.anchor,
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

  applyHeroAction(input, context) {
    const policy = HERO_POLICIES[this.pl.heroId];
    if (!policy) {
      this.pulseAction(input, null);
      return null;
    }
    const ultimate = HERO_BY_ID[this.pl.heroId]?.abilities?.ultimate;
    const ultimateCharged = !!ultimate && this.pl.ultGauge >= (ultimate.ultCost || 100);
    if (!ultimateCharged) this.ultimateReadySince = null;
    else if (this.ultimateReadySince === null) this.ultimateReadySince = this.world.t;

    const policyDecision = policy.actions.find(([slot, when]) => this.canUseAction(slot) && when(context));
    const heldAtCap = this.ultimateReadySince !== null &&
      this.world.t - this.ultimateReadySince >= ULTIMATE_LIVENESS_DELAY_SEC;
    const livenessDecision = policyDecision?.[0] !== 'ultimate'
      && heldAtCap
      && policy.ultimateLiveness?.(context)
      && this.canUseAction('ultimate');
    const slot = livenessDecision ? 'ultimate' : (policyDecision?.[0] || null);
    this.pulseAction(input, slot);
    return slot;
  }

  aimAt(input, target) {
    if (!target) return;
    const eye = eyePosition(this.pl, this.world.mv);
    const dx = target.move.pos[0] - eye[0];
    const dy = target.move.pos[1] - eye[1];
    const dz = target.move.pos[2] + 1.1 - eye[2];
    input.yaw = Math.atan2(dy, dx);
    input.pitch = Math.atan2(dz, Math.hypot(dx, dy));
  }

  aimForAction(input, slot, context) {
    if (!slot) return;
    const definition = HERO_BY_ID[this.pl.heroId]?.abilities?.[slot];
    if (!definition) return;
    const supportMobility = HERO_BY_ID[this.pl.heroId]?.role === 'support' &&
      SUPPORT_MOBILITY_BEHAVIORS.has(definition.behavior);
    if (ALLY_TARGET_BEHAVIORS.has(definition.behavior) || supportMobility) this.aimAt(input, context.ally);
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
    if (Math.abs(delta) <= Math.PI / 4) input.f = true;
    else if (Math.abs(delta) >= Math.PI * 3 / 4) input.b = true;
    else if (delta > 0) input.l = true;
    else input.r = true;
  }

  applyRoleMovement(input, context) {
    if (!context.enemy) return;
    const pl = this.pl;
    const hero = HERO_BY_ID[pl.heroId];
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

  teamTank() {
    return [...this.world.players.values()]
      .filter(other => other.team === this.pl.team && other.alive &&
        HERO_BY_ID[other.heroId]?.role === 'frontline')
      .sort((a, b) => a.id.localeCompare(b.id))[0] || null;
  }

  applyFormationMovement(input, context) {
    const hero = HERO_BY_ID[this.pl.heroId];
    if (!hero) return;
    const [preferredMin] = HERO_POLICIES[this.pl.heroId]?.range || [8, 24];
    if (hero.role !== 'frontline' && context?.enemyDistance < preferredMin) return;
    if (hero.role === 'frontline' && context?.enemyDistance < preferredMin &&
      context.selfHpRatio < TANK_CRITICAL_HP_RATIO) return;
    const tank = this.teamTank();
    if (!tank) return;
    const anchor = deriveFrontlineAnchor(
      this.world.map.objective.center,
      this.world.sideOf(this.pl.team),
      tank.move.pos,
    );
    const forwardX = anchor.forward[0];
    if (hero.role === 'frontline') {
      if (tank.id !== this.pl.id) return;
      const allies = [...this.world.players.values()].filter(other =>
        other.id !== this.pl.id && other.team === this.pl.team && other.alive);
      const distanceToSelf = other => Math.hypot(
        other.move.pos[0] - this.pl.move.pos[0],
        other.move.pos[1] - this.pl.move.pos[1],
      );
      const alliesNearby = allies.filter(other => distanceToSelf(other) <= TANK_ALLY_RANGE_M).length;
      const supports = allies.filter(other => HERO_BY_ID[other.heroId]?.role === 'support');
      const supportNearby = supports.some(other => distanceToSelf(other) <= TANK_SUPPORT_RANGE_M);
      const center = this.world.map.objective.center;
      const enemyOnObjective = !!context?.enemy && Math.hypot(
        context.enemy.move.pos[0] - center[0],
        context.enemy.move.pos[1] - center[1],
      ) <= this.world.map.objective.radiusM;
      const readyToContest = context?.selfHpRatio >= TANK_CONTEST_HP_RATIO &&
        alliesNearby >= 2 && supportNearby;
      const shouldRetreat = context?.inFight &&
        (context.selfHpRatio < TANK_RETREAT_HP_RATIO || alliesNearby < 2 || !supportNearby);
      if (shouldRetreat) {
        const supportBehind = supports
          .filter(other => (other.move.pos[0] - this.pl.move.pos[0]) * forwardX <= 1)
          .sort((a, b) => distanceToSelf(a) - distanceToSelf(b) || a.id.localeCompare(b.id))[0];
        const targetX = supportBehind?.move.pos[0] ?? this.pl.move.pos[0] - forwardX * 6;
        const targetY = supportBehind?.move.pos[1] ?? this.pl.move.pos[1];
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
    if (tank.id === this.pl.id) return;
    const tankDistance = Math.hypot(
      this.pl.move.pos[0] - anchor.position[0],
      this.pl.move.pos[1] - anchor.position[1],
    );
    const forwardLead = (this.pl.move.pos[0] - anchor.position[0]) * forwardX;
    const canSteerToFormation = (this.mode === 'fight' || this.mode === 'hold') &&
      tankDistance <= FORMATION_STEER_MAX_DISTANCE_M;
    if (hero.role === 'support') {
      if (!canSteerToFormation) {
        if (forwardLead > FRONTLINE_STANDARD_LEAD_M) {
          input.f = false;
          input.b = false;
          input.l = false;
          input.r = false;
        }
        return;
      }
      if (tankDistance <= SUPPORT_TANK_REACH_M && forwardLead <= FRONTLINE_STANDARD_LEAD_M) return;
      const side = [...String(this.pl.id)]
        .reduce((total, char) => total + char.charCodeAt(0), 0) % 2 ? 1 : -1;
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
    const boundedFlank = this.route !== 'front' &&
      between(lateralDistance, DAMAGE_FLANK_MIN_LATERAL_M, DAMAGE_FLANK_MAX_LATERAL_M);
    const maxLead = boundedFlank ? DAMAGE_FLANK_LEAD_M : FRONTLINE_STANDARD_LEAD_M;
    if (!canSteerToFormation) {
      if (forwardLead > maxLead) {
        input.f = false;
        input.b = false;
        input.l = false;
        input.r = false;
      }
      return;
    }
    const angleTooWide = this.route !== 'front' && lateralDistance > DAMAGE_FLANK_MAX_LATERAL_M;
    const angleTooNarrow = this.mode === 'fight' && this.route !== 'front' &&
      lateralDistance < DAMAGE_FLANK_MIN_LATERAL_M;
    if (forwardLead <= maxLead && !angleTooWide && !angleTooNarrow) return;
    const targetX = anchor.position[0] - forwardX * 2;
    const lateralOffset = this.pl.move.pos[1] - anchor.position[1];
    const routeEndY = this.routePoints().at(-1)?.[1] ?? this.world.map.objective.center[1];
    const routeSide = Math.sign(routeEndY - this.world.map.objective.center[1]);
    const targetY = angleTooNarrow
      ? anchor.position[1] + routeSide * (DAMAGE_FLANK_MIN_LATERAL_M + 2)
      : this.route === 'front'
        ? anchor.position[1]
        : anchor.position[1] + Math.max(-DAMAGE_FLANK_MAX_LATERAL_M,
          Math.min(DAMAGE_FLANK_MAX_LATERAL_M, lateralOffset));
    this.steerTowardAngle(input, Math.atan2(
      targetY - this.pl.move.pos[1],
      targetX - this.pl.move.pos[0],
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
    this.wpIndex = this.nearestWpIndex();
    this.mode = 'advance';
    this.stallT = 0;
  }

  // 現在位置から一番近い前方WPへ復帰する
  nearestWpIndex() {
    const pts = this.routePoints();
    let best = 0, bestD = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(pts[i][0] - this.pl.move.pos[0], pts[i][1] - this.pl.move.pos[1]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  routePoints() {
    const pts = this.world.map.routes[this.route];
    if (this.world.sideOf(this.pl.team) === 'east') return pts;
    return pts.map(p => [-p[0], -p[1], p[2]]); // 西側は180度回転
  }

  visibleEnemy() {
    const w = this.world;
    const eye = eyePosition(this.pl, w.mv);
    let best = null, bestD = 40;
    for (const other of w.players.values()) {
      if (other.team === this.pl.team || !other.alive) continue;
      const tp = [other.move.pos[0], other.move.pos[1], other.move.pos[2] + 1.2];
      const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
      const d = Math.hypot(dx, dy, dz);
      if (d > bestD) continue;
      const wall = w.collider.raycast(eye[0], eye[1], eye[2], dx / d, dy / d, dz / d, d);
      if (wall === Infinity) { best = other; bestD = d; }
    }
    return best;
  }

  woundedAlly(maxRange = 40) {
    let best = null;
    let bestRatio = 0.85;
    for (const other of this.world.players.values()) {
      if (other.id === this.pl.id || other.team !== this.pl.team || !other.alive) continue;
      const distance = Math.hypot(
        other.move.pos[0] - this.pl.move.pos[0],
        other.move.pos[1] - this.pl.move.pos[1],
        other.move.pos[2] - this.pl.move.pos[2],
      );
      const ratio = other.hp / Math.max(1, other.maxHp);
      if (distance <= maxRange && ratio < bestRatio) {
        best = other;
        bestRatio = ratio;
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
      this.route = ROUTES[Math.floor(this.rng() * ROUTES.length)];
      this.wpIndex = 0;
      this.mode = 'regroup';
      this.regroupT = 0;
      this.targetId = null;
      this.stallT = 0;
      this.ultimateReadySince = null;
    }

    if (!pl.alive) {
      // 死亡→復帰時は経路を選び直し、再集合から
      if (this.wasAlive) {
        this.route = ROUTES[Math.floor(this.rng() * ROUTES.length)];
        this.wpIndex = 0;
        this.mode = 'regroup';
        this.regroupT = 0;
        this.targetId = null;
      }
      this.wasAlive = false;
      this.lastPulseSlot = null;
      this.ultimateReadySince = null;
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
      this.submit(input);
      return;
    }

    // 交戦判定
    const enemy = this.visibleEnemy();
    if (enemy) {
      this.targetId = enemy.id;
      this.targetLostT = 0;
      this.mode = 'fight';
    } else if (this.mode === 'fight') {
      this.targetLostT += dt;
      if (this.targetLostT > 1.5) { this.mode = 'advance'; this.targetId = null; }
    }

    const context = this.combatContext(enemy);
    const actionSlot = this.applyHeroAction(input, context);

    if (this.mode === 'regroup') {
      this.regroupT += dt;
      // 近くの生存味方が1人以上出撃準備できるか、3秒で単独進軍
      let near = 0;
      for (const o of w.players.values()) {
        if (o.id !== pl.id && o.team === pl.team && o.alive) {
          const d = Math.hypot(o.move.pos[0] - pl.move.pos[0], o.move.pos[1] - pl.move.pos[1]);
          if (d < 14) near++;
        }
      }
      // 敵の甕が進んでいる時は再集合を省いて緊急前進（延長への関与を優先）
      const obj = w.objective;
      const urgent = obj.owner >= 0 && obj.owner !== pl.team && obj.pot[obj.owner] >= 700;
      if (near >= 1 || this.regroupT > 3 || urgent) this.mode = 'advance';
    }

    if (this.mode === 'advance' || this.mode === 'regroup') {
      const pts = this.routePoints();
      if (this.wpIndex >= pts.length) {
        this.mode = 'hold';
      } else {
        const wp = pts[this.wpIndex];
        const dx = wp[0] - pl.move.pos[0], dy = wp[1] - pl.move.pos[1];
        const d = Math.hypot(dx, dy);
        if (d < 1.5) {
          this.wpIndex++;
          this.stallT = 0;
        } else if (this.mode === 'advance') {
          input.yaw = Math.atan2(dy, dx);
          input.f = true;
          this.updateStall(dt, true);
          if (this.stallT > 0.7) input.jump = true;
          if (this.stallT > 2.0) {
            // 目標WPが自分より1.5m以上高い（＝落ちて登れない）なら渚経由で復帰
            if (wp[2] > pl.move.pos[2] + 1.5) this.recoverViaShallows();
            else { this.wpIndex++; this.stallT = 0; }
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
            mates.push([o.id, Math.hypot(o.move.pos[0] - c[0], o.move.pos[1] - c[1])]);
          }
        }
        mates.sort((a, b) => a[1] - b[1]);
        const rank = mates.findIndex(m => m[0] === pl.id);
        const enemySide = w.sideOf(1 - pl.team);
        const dir = enemySide === 'east' ? 1 : -1;
        if (rank >= 2) {
          const parity = (pl.id.charCodeAt(1) % 2) ? 6 : -6;
          const post = [c[0] + dir * 15, c[1] + parity];
          const dx = post[0] - pl.move.pos[0], dy = post[1] - pl.move.pos[1];
          if (Math.hypot(dx, dy) > 2) {
            input.yaw = Math.atan2(dy, dx);
            input.f = true;
            this.updateStall(dt, true);
            if (this.stallT > 0.7) input.jump = true;
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
        if (this.stallT > 0.7) input.jump = true;
        if (this.stallT > 2.0 && pl.move.pos[2] < 2) this.recoverViaShallows();
      }
    }

    if (this.mode === 'fight' && this.targetId) {
      const target = w.players.get(this.targetId);
      if (target && target.alive) {
        const eye = eyePosition(pl, w.mv);
        // 胸を狙う（頭は狙わない）
        const tp = [target.move.pos[0], target.move.pos[1], target.move.pos[2] + 1.1];
        const dx = tp[0] - eye[0], dy = tp[1] - eye[1], dz = tp[2] - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        // 照準誤差の収束
        this.aimErr = Math.max(0.8, this.aimErr - 2.5 * dt);
        const err = (this.aimErr * Math.PI) / 180;
        input.yaw = Math.atan2(dy, dx) + (this.rng() * 2 - 1) * err;
        input.pitch = Math.atan2(dz, Math.hypot(dx, dy)) + (this.rng() * 2 - 1) * err;
        input.fire = this.aimErr < 3.5;
        // ストレイフ
        this.strafeT -= dt;
        if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = 0.7 + this.rng() * 0.9; }
        if (this.strafeDir > 0) input.r = true; else input.l = true;
      } else {
        this.mode = 'advance';
        this.targetId = null;
        this.aimErr = 6;
      }
    } else {
      this.aimErr = Math.min(6, this.aimErr + 4 * dt); // 非交戦で誤差リセット
    }

    this.applySupportPrimary(input, context);
    this.aimForAction(input, actionSlot, context);
    this.applyRoleMovement(input, context);
    this.applyFormationMovement(input, context);
    input.primary = input.fire;
    this.submit(input);
  }
}
