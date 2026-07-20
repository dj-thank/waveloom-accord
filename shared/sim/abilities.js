import { HERO_BY_ID } from '../data/heroes.js';
import { spendGauge, refundGauge } from './ult_economy.js';
import {
  rayCylinder,
  rayCylinderSide,
  sweepSphereCylinder,
  sweepSphereCylinderSide,
} from './collision.js';
import {
  DEFAULT_BARRIER_HEIGHT_M,
  DEFAULT_DEPLOYABLE_HEIGHT_M,
  LINE_OF_SIGHT_EPSILON_M,
  canAffectPoint,
  canAffectTarget,
  distance3D,
  distanceToSegment3D,
  playerTargetPoint,
} from './spatial_query.js';

export const ABILITY_SLOTS = Object.freeze(['secondary', 'ability1', 'ability2', 'ultimate']);
export { DEFAULT_BARRIER_HEIGHT_M, DEFAULT_DEPLOYABLE_HEIGHT_M };
const EFFECT_PULSE_SEC = 0.25;

export function makeAbilityState() {
  return {
    cooldowns: { secondary: 0, ability1: 0, ability2: 0 },
    previous: { secondary: false, ability1: false, ability2: false, ultimate: false },
    cast: null,
    statuses: [],
    heroState: {},
  };
}

export function tickAbilityState(world, player, dt) {
  const state = player.abilities;
  if (!state) return;
  tickNeedleWind(world, player, dt);
  tickHeroMotion(world, player);
  const rate = cooldownRate(player);
  for (const slot of ['secondary', 'ability1', 'ability2']) {
    state.cooldowns[slot] = Math.max(0, state.cooldowns[slot] - dt * rate);
  }
  for (const status of state.statuses) {
    if (status.kind === 'stored_heal' && status.convertAt <= world.t && status.amount > 0) {
      world.healPlayer?.(player, status.amount, world.players.get(status.sourceId), status.abilityId);
      status.amount = 0;
    }
    if (status.kind === 'pain_shockwave' && status.expiresAt <= world.t) {
      releasePainShockwave(world, player, status);
    }
  }
  state.statuses = state.statuses.filter(status => status.expiresAt > world.t && status.amount !== 0);
  if (!state.heroState.anchorRecall && state.heroState.anchor?.expiresAt <= world.t) {
    state.heroState.anchor = null;
    state.cooldowns.ability1 = Math.max(state.cooldowns.ability1, HERO_BY_ID[player.heroId]?.abilities?.ability1?.cooldownSec || 0);
  }
  if (state.heroState.transit?.kind !== 'rewind' && state.heroState.rewind?.expiresAt <= world.t) state.heroState.rewind = null;
  if (state.heroState.blades) {
    state.heroState.blades = state.heroState.blades.filter(blade => blade.expiresAt > world.t);
  }
  if (state.cast && world.t >= state.cast.readyAt) {
    const cast = state.cast;
    state.cast = null;
    executeAbility(world, player, cast.definition, cast.target);
  }
}

export function processAbilityInputs(world, player) {
  if (!player.abilities || !player.heroId || !player.alive) return;
  for (const slot of ABILITY_SLOTS) {
    const down = !!player.input[slot];
    if (down && !player.abilities.previous[slot]) tryActivateAbility(world, player, slot);
    player.abilities.previous[slot] = down;
  }
}

export function tryActivateAbility(world, player, slot) {
  const hero = HERO_BY_ID[player.heroId];
  const definition = hero?.abilities?.[slot];
  if (!definition || player.abilities.cast || player.abilities.heroState.transit || player.abilities.heroState.anchorRecall) return false;
  if (player.abilities.statuses.some(status => status.abilityLocked) && slot !== 'secondary') return false;
  const anchorFollowup = definition.behavior === 'anchor_launch' && !!player.abilities.heroState.anchor;
  if (slot !== 'ultimate' && !anchorFollowup && (player.abilities.cooldowns[slot] || 0) > 0) return false;
  if (slot === 'ultimate' && !spendGauge(player.ultGauge, definition.ultCost || 100, world.combat?.ultimateEconomy).ok) return false;
  if (definition.resourceCost && (!player.resource || player.resource.value < definition.resourceCost)) return false;

  const paidResourceCost = definition.resourceCost && !anchorFollowup ? definition.resourceCost : 0;
  const paidUltCost = slot === 'ultimate' ? (definition.ultCost || 100) : 0;
  const paidCooldownSec = slot !== 'ultimate' && (definition.behavior !== 'anchor_launch' || anchorFollowup)
    ? (definition.cooldownSec || 0)
    : 0;
  if (paidResourceCost) {
    player.resource.value -= definition.resourceCost;
    player.lastResourceSpendT = world.t;
  }
  if (slot === 'ultimate') player.ultGauge = spendGauge(player.ultGauge, paidUltCost, world.combat?.ultimateEconomy).gauge;
  else if (definition.behavior !== 'anchor_launch' || anchorFollowup) {
    player.abilities.cooldowns[slot] = definition.cooldownSec || 0;
  }

  const target = aimPoint(world, player, definition.rangeM || 0);
  if (definition.castSec > 0) {
    player.abilities.cast = {
      definition,
      target,
      readyAt: world.t + definition.castSec * castTimeMultiplier(player),
      spent: { resourceCost: paidResourceCost, ultCost: paidUltCost, cooldownSec: paidCooldownSec },
    };
    world.events.push({
      type: 'ability_windup', player: player.id, heroId: hero.id,
      abilityId: definition.id, slot, target, castSec: definition.castSec, pos: [...target],
    });
  } else {
    executeAbility(world, player, definition, target);
  }
  return true;
}

export function interruptAbility(world, player, reason = 'interrupted') {
  const cast = player?.abilities?.cast;
  if (!cast) return false;
  const definition = cast.definition;
  const refundPct = Math.max(0, Math.min(1,
    definition.interruptRefundPct ?? (definition.slot === 'ultimate' ? 0.5 : 0),
  ));
  if (cast.spent?.ultCost && refundPct) {
    player.ultGauge = refundGauge(player.ultGauge, cast.spent.ultCost, refundPct, world.combat?.ultimateEconomy);
  }
  if (cast.spent?.resourceCost && player.resource && refundPct) {
    player.resource.value = Math.min(player.resource.max, player.resource.value + cast.spent.resourceCost * refundPct);
  }
  if (cast.spent?.cooldownSec && definition.slot !== 'ultimate' && refundPct) {
    player.abilities.cooldowns[definition.slot] = Math.max(
      0,
      player.abilities.cooldowns[definition.slot] - cast.spent.cooldownSec * refundPct,
    );
  }
  player.abilities.cast = null;
  world.events.push({
    type: 'ability_interrupted', player: player.id, heroId: player.heroId,
    abilityId: definition.id, slot: definition.slot, reason, refundPct, pos: [...player.move.pos],
  });
  return true;
}

function executeAbility(world, player, definition, target) {
  BEHAVIOR_HANDLERS[definition.behavior](world, player, definition, target);
  for (const ally of world.players.values()) {
    if (ally.team !== player.team || ally.heroId !== 'koyomi' || ally.id === player.id || !ally.resource) continue;
    ally.resource.value = Math.min(ally.resource.max, ally.resource.value + 4);
  }
  world.events.push({
    type: definition.slot === 'ultimate' ? 'ultimate_used' : 'ability_used',
    player: player.id,
    heroId: player.heroId,
    abilityId: definition.id,
    slot: definition.slot,
    target,
    pos: Array.isArray(target) ? [...target] : undefined,
  });
}

export function tickWorldAbilityEffects(world) {
  if (!world.zones) return;
  world.zones = world.zones.filter(zone => zone.expiresAt > world.t && (zone.hp === undefined || zone.hp > 0));
  world.barriers = world.barriers.filter(barrier => barrier.expiresAt > world.t && barrier.hp > 0);
  for (const zone of world.zones) {
    const owner = world.players.get(zone.ownerId);
    if (zone.resourceDrainPerSec) {
      const cost = zone.resourceDrainPerSec * world.dt;
      if (!owner?.alive || !owner.resource || owner.resource.value + 1e-9 < cost) {
        zone.expiresAt = world.t;
        continue;
      }
      owner.resource.value = Math.max(0, owner.resource.value - cost);
      owner.lastResourceSpendT = world.t;
    }
    if (zone.followOwner) {
      if (owner?.alive) zone.center = [...owner.move.pos];
    }
    if (world.t + 1e-9 < zone.nextPulseAt) continue;
    zone.nextPulseAt = world.t + EFFECT_PULSE_SEC;
    for (const target of world.players.values()) {
      if (!target.alive || !canAffectTarget(world, zone.center, target, {
        rangeM: zone.radiusM,
        sourceId: zone.ownerId,
        ignoreLineOfSight: zone.ignoreLineOfSight === true,
      })) continue;
      const ally = target.team === zone.team;
      if (ally && zone.healPerSec) world.healPlayer?.(target, zone.healPerSec * EFFECT_PULSE_SEC, owner, zone.abilityId);
      if (!ally && zone.damagePerSec) applyAbilityDamage(
        world, target, zone.damagePerSec * EFFECT_PULSE_SEC, owner, zone.abilityId, zone.center,
      );
      if (ally && zone.allyStatus) applyStatus(world, target, { ...zone.allyStatus, id: `${zone.id}:ally` }, EFFECT_PULSE_SEC * 2, owner);
      if (!ally && zone.enemyStatus) applyStatus(world, target, { ...zone.enemyStatus, id: `${zone.id}:enemy` }, EFFECT_PULSE_SEC * 2, owner);
    }
  }
}

export function applyStatus(world, target, values, durationSec, source = null) {
  if (!target?.abilities) return null;
  const id = values.id || values.kind || 'status';
  const existing = target.abilities.statuses.find(status => status.id === id && status.sourceId === source?.id);
  const status = {
    ...values,
    id,
    sourceId: source?.id ?? values.sourceId ?? null,
    expiresAt: world.t + Math.max(0.01, durationSec || values.durationSec || 0.01),
  };
  if (existing) Object.assign(existing, status);
  else target.abilities.statuses.push(status);
  return existing || status;
}

export function outgoingDamageMultiplier(player) {
  if (!player?.abilities) return 1;
  return player.abilities.statuses.reduce((value, status) => value * (status.damageMult || 1), 1);
}

export function incomingDamageMultiplier(player) {
  if (!player?.abilities) return 1;
  return player.abilities.statuses.reduce((value, status) => value * (status.damageTakenMult || 1), 1);
}

export function redirectStatus(player) {
  return player?.abilities?.statuses.find(status => status.redirectTo && status.redirectPct > 0) || null;
}

export function barrierHit(world, origin, dir, maxDist, shooterTeam, sphereRadiusM = 0) {
  let best = null;
  for (const barrier of world.barriers || []) {
    if (barrier.hp !== undefined && barrier.hp <= 0) continue;
    if (barrier.team === shooterTeam && barrier.friendlyPass !== false) continue;
    const heightM = finiteHeight(barrier.heightM, DEFAULT_BARRIER_HEIGHT_M);
    const t = sweepSphereCylinderSide(
      origin[0], origin[1], origin[2], dir[0], dir[1], dir[2],
      barrier.center[0], barrier.center[1], barrier.center[2], barrier.center[2] + heightM,
      barrier.radiusM, sphereRadiusM, maxDist,
    );
    if (t >= 0 && (!best || t < best.dist)) best = { barrier, dist: t };
  }
  return best;
}

export function deployableHit(world, origin, dir, maxDist, shooterTeam, sphereRadiusM = 0) {
  let best = null;
  for (const zone of world.zones || []) {
    if (zone.team === shooterTeam || zone.hp === undefined || zone.hp <= 0) continue;
    const radius = zone.hitRadiusM || Math.min(0.65, zone.radiusM || 0.65);
    const heightM = finiteHeight(zone.heightM, DEFAULT_DEPLOYABLE_HEIGHT_M);
    const t = sweepSphereCylinder(
      origin[0], origin[1], origin[2], dir[0], dir[1], dir[2],
      zone.center[0], zone.center[1], zone.center[2], zone.center[2] + heightM,
      radius, sphereRadiusM, maxDist,
    );
    if (t >= 0 && (!best || t < best.dist)) best = { zone, dist: t };
  }
  return best;
}

function createZone(world, player, definition, center, values = {}) {
  const deployableHp = player.heroId === 'koyomi'
    ? (definition.behavior === 'cast_delay_zone' ? 40 : 60)
    : undefined;
  const zone = {
    id: `z${world.nextEffectId++}`,
    kind: values.kind || definition.behavior,
    abilityId: definition.id,
    ownerId: player.id,
    team: player.team,
    center: [
      center[0], center[1],
      deployableHp !== undefined && Number.isFinite(values.baseZ) ? values.baseZ
        : deployableHp !== undefined ? player.move.pos[2] : center[2],
    ],
    radiusM: values.radiusM || definition.radiusM || 4,
    expiresAt: world.t + (values.durationSec || definition.durationSec || 1),
    nextPulseAt: world.t,
    followOwner: !!values.followOwner,
    damagePerSec: values.damagePerSec || definition.damagePerSec || 0,
    healPerSec: values.healPerSec || definition.healPerSec || 0,
    allyStatus: values.allyStatus || null,
    enemyStatus: values.enemyStatus || null,
    projectileSpeedMult: definition.projectileSpeedMult || null,
    allyProjectileSpeedMult: definition.allyProjectileSpeedMult || null,
    resourceDrainPerSec: definition.resourceDrainPerSec || 0,
    ignoreLineOfSight: values.ignoreLineOfSight ?? definition.ignoreLineOfSight ?? false,
    hp: deployableHp,
    maxHp: deployableHp,
    hitRadiusM: deployableHp ? (values.hitRadiusM ?? definition.hitRadiusM ?? 0.65) : undefined,
    heightM: deployableHp
      ? finiteHeight(values.heightM ?? definition.deployableHeightM ?? definition.heightM, DEFAULT_DEPLOYABLE_HEIGHT_M)
      : undefined,
  };
  world.zones.push(zone);
  world.events.push({ type: 'zone_created', zone: snapshotZone(zone, world.t), pos: [...zone.center] });
  return zone;
}

function createBarrier(world, player, definition, center, values = {}) {
  const baseZ = Number.isFinite(values.baseZ) ? values.baseZ : player.move.pos[2];
  const barrier = {
    id: `b${world.nextEffectId++}`,
    kind: values.kind || definition.behavior,
    abilityId: definition.id,
    ownerId: player.id,
    team: player.team,
    center: [center[0], center[1], baseZ],
    radiusM: values.radiusM || definition.radiusM || 2.5,
    heightM: finiteHeight(values.heightM ?? definition.barrierHeightM ?? definition.heightM, DEFAULT_BARRIER_HEIGHT_M),
    hp: values.hp || definition.barrierHp || 300,
    maxHp: values.hp || definition.barrierHp || 300,
    expiresAt: world.t + (values.durationSec || definition.durationSec || 8),
    friendlyPass: values.friendlyPass !== false,
  };
  world.barriers.push(barrier);
  world.events.push({ type: 'barrier_created', barrier: snapshotBarrier(barrier, world.t), pos: [...barrier.center] });
  return barrier;
}

function affectRadius(world, player, center, radius, values = {}, definition = {}) {
  for (const target of world.players.values()) {
    if (!target.alive || !canAbilityAffectTarget(world, player, definition, center, target, {
      rangeM: radius,
      ignoreLineOfSight: (values.ignoreLineOfSight ?? definition.ignoreLineOfSight) === true,
    })) continue;
    const ally = target.team === player.team;
    if (!ally && values.damage) applyAbilityDamage(
      world, target, values.damage, player, values.abilityId, center,
    );
    if (ally && values.heal) world.healPlayer?.(target, values.heal, player, values.abilityId);
    if (!ally && values.enemyStatus) applyStatus(world, target, values.enemyStatus, values.durationSec || 1, player);
    if (ally && values.allyStatus) applyStatus(world, target, values.allyStatus, values.durationSec || 1, player);
    if (!ally && values.pushM) pushFrom(world, target, center, values.pushM);
    if (ally && values.shield) grantShield(target, values.shield);
  }
}

function applyAbilityDamage(world, target, amount, source, abilityId, origin) {
  const damageOrigin = [...origin];
  world.applyDamage(target, amount, source, false, {
    abilityId,
    damageOrigin,
    damageDirection: damageOrigin.map((value, index) => value - target.move.pos[index]),
  });
}

function canAbilityAffectTarget(world, player, definition, origin, target, options = {}) {
  return canAffectTarget(world, origin, target, {
    sourceId: player.id,
    ignoreLineOfSight: definition.ignoreLineOfSight === true,
    ...options,
  });
}

function grantShield(player, amount) {
  player.shield = Math.min((player.maxHp || 250) * 0.6, (player.shield || 0) + (amount || 0));
}

function nearestInAim(world, player, rangeM, relation = 'enemy', definition = {}) {
  const fx = Math.cos(player.move.yaw), fy = Math.sin(player.move.yaw);
  const origin = playerTargetPoint(player, world.mv);
  let best = null;
  for (const target of world.players.values()) {
    if (!target.alive || target.id === player.id) continue;
    const ally = target.team === player.team;
    if ((relation === 'enemy' && ally) || (relation === 'ally' && !ally)) continue;
    const dx = target.move.pos[0] - player.move.pos[0];
    const dy = target.move.pos[1] - player.move.pos[1];
    const dist = Math.hypot(dx, dy);
    if (dist < 1e-6 || !canAbilityAffectTarget(world, player, definition, origin, target, {
      rangeM,
      rangeOrigin: player.move.pos,
    })) continue;
    const dot = (dx * fx + dy * fy) / dist;
    if (dot < 0.82) continue;
    const score = dist + (1 - dot) * 20;
    if (!best || score < best.score) best = { target, score };
  }
  return best?.target || null;
}

const BEHAVIOR_HANDLERS = {
  dash(world, player, definition) {
    propel(player, definition.rangeM || 7, false);
    if (definition.shield) grantShield(player, definition.shield);
  },
  air_dash(world, player, definition) {
    const origin = [...player.move.pos];
    if (player.heroId === 'tsubakuro') {
      createZone(world, player, definition, origin, {
        kind: 'foothold', radiusM: definition.radiusM || 0.75,
        durationSec: definition.durationSec || 2.5,
      });
    }
    propel(player, definition.rangeM || 7, false);
    player.move.vel[2] = Math.max(player.move.vel[2], 5.5);
    if (definition.shield) grantShield(player, definition.shield);
    changeResource(player, definition.resourceGain || 0);
  },
  backstep(world, player, definition) {
    propel(player, definition.rangeM || 6, true);
    if (definition.damage) affectRadius(world, player, player.move.pos, definition.radiusM || 3, { damage: definition.damage, abilityId: definition.id }, definition);
  },
  cleanse_mobility(world, player, definition) {
    player.abilities.statuses = player.abilities.statuses.filter(status => !status.negative);
    applyStatus(world, player, { id: definition.id, moveSpeedMult: definition.moveSpeedMult }, definition.durationSec, player);
  },
  anchor_launch(world, player, definition, target) {
    const state = player.abilities.heroState;
    if (!state.anchor) {
      state.anchor = { pos: [...target], expiresAt: world.t + 6, origin: [...player.move.pos] };
      world.events.push({ type: 'deployable_created', player: player.id, abilityId: definition.id, pos: [...target], durationSec: 6 });
      return;
    }
    const anchor = state.anchor;
    const origin = [...player.move.pos];
    const chain = player.resource?.id === 'chain' ? player.resource.value : 0;
    const speed = 14 + Math.max(0, Math.min(1, chain / 100)) * 8;
    const travelSec = Math.max(world.dt, distance3D(origin, anchor.pos) / speed);
    state.transit = {
      kind: 'anchor', from: origin, to: [...anchor.pos], startedAt: world.t,
      endsAt: world.t + travelSec, chain, definition,
    };
    state.anchor = null;
    if (player.resource?.id === 'chain') player.resource.value = 0;
    world.events.push({
      type: 'ability_transit_started', player: player.id, abilityId: definition.id,
      from: origin, to: [...anchor.pos], durationSec: travelSec,
    });
  },
  anchor_recall(world, player, definition) {
    const anchor = player.abilities.heroState.anchor;
    if (!anchor) return;
    player.abilities.heroState.anchorRecall = {
      from: [...anchor.pos], to: [...player.move.pos], startedAt: world.t,
      endsAt: world.t + 0.9, definition,
    };
    applyStatus(world, player, { id: definition.id, moveSpeedMult: 0.8 }, 0.9, player);
    world.events.push({
      type: 'ability_transit_started', player: player.id, abilityId: definition.id,
      from: [...anchor.pos], to: [...player.move.pos], durationSec: 0.9,
    });
  },
  rewind_marker(world, player) {
    const marker = player.abilities.heroState.rewind;
    if (!marker || marker.expiresAt <= world.t) return;
    const from = [...player.move.pos];
    const durationSec = Math.max(0.8, Math.min(1.4, distance3D(from, marker.pos) / 20));
    player.abilities.heroState.transit = {
      kind: 'rewind', from, to: [...marker.pos], startedAt: world.t,
      endsAt: world.t + durationSec, definition: HERO_BY_ID.zairu.abilities.ability2,
    };
    player.move.vel = [0, 0, 0];
    world.events.push({
      type: 'ability_transit_started', player: player.id, abilityId: HERO_BY_ID.zairu.abilities.ability2.id,
      from, to: [...marker.pos], durationSec,
    });
  },
  ring_barrier(world, player, definition, target) {
    affectRadius(world, player, target, definition.radiusM / 2, { damage: definition.damage, abilityId: definition.id }, definition);
    createZone(world, player, definition, target, {
      kind: 'ring', enemyStatus: { kind: 'slow', slowMult: definition.slowMult, negative: true },
    });
    createBarrier(world, player, definition, target, { radiusM: definition.radiusM, hp: 600, friendlyPass: true });
  },
  guard(world, player, definition) {
    applyStatus(world, player, { id: definition.id, damageTakenMult: definition.damageTakenMult, moveSpeedMult: definition.moveSpeedMult }, definition.durationSec, player);
  },
  barrier(world, player, definition, target) { createBarrier(world, player, definition, target); },
  cone_blast(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM || 7, 'enemy', definition);
    if (target) {
      applyAbilityDamage(
        world, target, definition.damage || 0, player, definition.id,
        playerTargetPoint(player, world.mv),
      );
      if (definition.pushM) pushFrom(world, target, player.move.pos, definition.pushM);
      if (definition.slowMult) applyStatus(world, target, { id: `${definition.id}:slow`, slowMult: definition.slowMult, negative: true }, definition.durationSec || 1, player);
    }
  },
  fortress_buff(world, player, definition) {
    for (const angle of [-0.8, 0, 0.8]) {
      const a = player.move.yaw + angle;
      createBarrier(world, player, definition, [player.move.pos[0] + Math.cos(a) * 5, player.move.pos[1] + Math.sin(a) * 5, player.move.pos[2]], { radiusM: 2.4, hp: definition.barrierHp / 3 });
    }
    applyStatus(world, player, { id: definition.id, damageMult: definition.damageMult }, definition.durationSec, player);
  },
  precision_stance(world, player, definition) {
    applyStatus(world, player, { id: definition.id, damageMult: definition.damageMult, moveSpeedMult: definition.moveSpeedMult }, definition.durationSec, player);
  },
  precision_shot(world, player, definition) {
    if (world.precisionAbilityShot) {
      world.precisionAbilityShot(player, definition);
      return;
    }
    const target = nearestInAim(world, player, definition.rangeM || 55, 'enemy', definition);
    if (!target) return;
    applyAbilityDamage(
      world, target, definition.damage || 50, player, definition.id,
      playerTargetPoint(player, world.mv),
    );
    const existing = target.abilities.statuses.find(status => status.id === `asagi_mark:${player.id}`);
    const stacks = Math.min(5, (existing?.stacks || 0) + 2);
    applyStatus(world, target, {
      id: `asagi_mark:${player.id}`, kind: 'reveal', stacks,
      revealed: stacks >= 5, negative: true,
    }, 4, player);
    if (player.weapon.ammo > 0) player.weapon.ammo--;
  },
  projectile_field(world, player, definition, target) {
    const zone = createZone(world, player, definition, target, {
      kind: 'projectile_field',
      allyStatus: definition.allyProjectileSpeedMult ? { projectileSpeedMult: definition.allyProjectileSpeedMult } : null,
      enemyStatus: { projectileSpeedMult: definition.projectileSpeedMult, negative: true },
    });
    player.abilities.heroState.fieldId = zone.id;
  },
  field_detonate(world, player, definition) {
    const id = player.abilities.heroState.fieldId;
    const zone = world.zones.find(item => item.id === id);
    if (!zone) return;
    const maxAngle = (definition.scatterAngleDeg || 25) * Math.PI / 180;
    for (const projectile of world.projectiles || []) {
      if (!projectile.alive || projectile.team === player.team || !canAffectPoint(
        world, zone.center, projectile.pos, {
          rangeM: zone.radiusM,
          sourceTeam: zone.team,
          ignoreLineOfSight: zone.ignoreLineOfSight === true,
        },
      )) continue;
      const sign = world.rng() < 0.5 ? -1 : 1;
      const angle = sign * maxAngle * (0.2 + world.rng() * 0.8);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      const [x, y] = projectile.dir;
      projectile.dir[0] = x * cos - y * sin;
      projectile.dir[1] = x * sin + y * cos;
      world.events.push({
        type: 'projectile_scattered', projectileId: projectile.id,
        player: player.id, abilityId: definition.id, angle,
      });
    }
    affectRadius(world, player, zone.center, definition.radiusM, {
      damage: definition.damage, abilityId: definition.id,
      enemyStatus: { kind: 'slow', slowMult: definition.slowMult, negative: true }, durationSec: definition.durationSec,
    }, definition);
    zone.expiresAt = world.t;
    player.abilities.heroState.fieldId = null;
  },
  hud_suppress_zone(world, player, definition, target) {
    createZone(world, player, definition, definition.rangeM ? target : player.move.pos, {
      kind: 'hud_suppress',
      enemyStatus: { kind: 'hud_suppress', hudSuppressed: true, negative: true },
      allyStatus: definition.revealEnemies ? { revealEnemies: true } : null,
    });
  },
  target_debuff(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (!target) return;
    applyAbilityDamage(
      world, target, definition.damage || 0, player, definition.id,
      playerTargetPoint(player, world.mv),
    );
    applyStatus(world, target, { id: definition.id, slowMult: definition.slowMult, negative: true }, definition.durationSec, player);
  },
  barrier_corridor(world, player, definition) {
    for (let i = 1; i <= 4; i++) {
      const d = i * definition.rangeM / 5;
      createBarrier(world, player, definition, [player.move.pos[0] + Math.cos(player.move.yaw) * d, player.move.pos[1] + Math.sin(player.move.yaw) * d, player.move.pos[2]], { radiusM: 1.8, hp: definition.barrierHp });
    }
  },
  line_pull(world, player, definition) {
    const end = aimPoint(world, player, definition.rangeM);
    const origin = playerTargetPoint(player, world.mv);
    for (const target of world.players.values()) {
      if (!target.alive || target.team === player.team) continue;
      if (distanceToSegment3D(playerTargetPoint(target, world.mv), origin, end) <= 1.7
        && canAbilityAffectTarget(world, player, definition, origin, target, {
          rangeM: definition.rangeM,
          rangeOrigin: player.move.pos,
        })) {
        applyAbilityDamage(world, target, definition.damage, player, definition.id, origin);
        moveToward(world, target, player.move.pos, definition.pullM || 3);
      }
    }
  },
  team_wave(world, player, definition) {
    affectRadius(world, player, player.move.pos, definition.rangeM || definition.radiusM, {
      shield: definition.shield,
      pushM: definition.pushM,
      allyStatus: { id: definition.id, moveSpeedMult: definition.moveSpeedMult },
      durationSec: definition.durationSec,
    }, definition);
  },
  mark_shot(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (!target) return;
    applyAbilityDamage(
      world, target, definition.damage, player, definition.id,
      playerTargetPoint(player, world.mv),
    );
    if (world.applyAsagiMark) world.applyAsagiMark(player, target, definition.markStacks || 3);
    else applyStatus(world, target, { id: 'asagi_mark', kind: 'reveal', revealed: true, stacks: definition.markStacks || 3, negative: true }, 5, player);
  },
  team_reveal(world, player, definition) {
    const origin = playerTargetPoint(player, world.mv);
    for (const target of world.players.values()) {
      if (target.alive && target.team !== player.team
        && canAbilityAffectTarget(world, player, definition, origin, target)) {
        applyStatus(world, target, { id: definition.id, revealed: true, negative: true }, definition.durationSec, player);
      }
    }
    applyStatus(world, player, { id: `${definition.id}:buff`, damageMult: definition.damageMult }, definition.durationSec, player);
  },
  reveal_trap(world, player, definition, target) {
    createZone(world, player, definition, target, { kind: 'reveal', enemyStatus: { revealed: true, negative: true } });
  },
  self_buff(world, player, definition) {
    if (definition.resourceFloor && player.resource) player.resource.value = Math.max(player.resource.value, definition.resourceFloor);
    applyStatus(world, player, { id: definition.id, ...pickStatusFields(definition) }, definition.durationSec, player);
  },
  charged_shot(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (target) applyAbilityDamage(
      world, target, definition.damage, player, definition.id,
      playerTargetPoint(player, world.mv),
    );
  },
  blade_recall(world, player, definition) {
    const blades = (player.abilities.heroState.blades || []).filter(blade => blade.expiresAt > world.t);
    const hits = new Map();
    for (const blade of blades) {
      const returnEnd = playerTargetPoint(player, world.mv);
      for (const target of world.players.values()) {
        if (!target.alive || target.team === player.team) continue;
        const count = hits.get(target.id) || 0;
        if (count >= (definition.maxHitsPerTarget || 3)) continue;
        if (distanceToSegment3D(playerTargetPoint(target, world.mv), blade.pos, returnEnd) > 0.75) continue;
        if (!canAbilityAffectTarget(world, player, definition, blade.pos, target)) continue;
        applyAbilityDamage(
          world, target, definition.damagePerBlade || 22, player, definition.id, blade.pos,
        );
        hits.set(target.id, count + 1);
      }
      world.events.push({
        type: 'blade_returned', player: player.id, abilityId: definition.id,
        bladeId: blade.id, from: [...blade.pos], to: [...player.move.pos],
      });
    }
    player.weapon.ammo = Math.min(HERO_BY_ID[player.heroId].weapon.magSize, player.weapon.ammo + blades.length);
    changeResource(player, blades.length * (definition.resourcePerBlade || 5));
    player.abilities.heroState.blades = [];
  },
  ignite_target(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (!target) return;
    const oiled = target.abilities.statuses.find(status => status.kind === 'oiled');
    applyAbilityDamage(
      world, target, definition.damage + (oiled ? definition.igniteDamage : 0), player, definition.id,
      playerTargetPoint(player, world.mv),
    );
    if (oiled) oiled.expiresAt = world.t;
  },
  status_blast(world, player, definition, target) {
    affectRadius(world, player, target, definition.radiusM, {
      enemyStatus: { id: definition.status, kind: definition.status, negative: true }, durationSec: definition.durationSec,
    }, definition);
  },
  damage_aura(world, player, definition) {
    createZone(world, player, definition, player.move.pos, { followOwner: true, kind: 'damage_aura' });
  },
  airburst(world, player, definition, target) {
    affectRadius(world, player, target, definition.radiusM, { damage: definition.damage, abilityId: definition.id }, definition);
  },
  damage_zone(world, player, definition, target) { createZone(world, player, definition, target, { kind: 'damage' }); },
  zone_dash(world, player, definition) {
    const origin = playerTargetPoint(player, world.mv);
    const own = world.zones
      .filter(zone => zone.ownerId === player.id && (zone.hp === undefined || zone.hp > 0))
      .map(zone => ({
        zone,
        targetPoint: zone.hp === undefined
          ? [...zone.center]
          : [
            zone.center[0], zone.center[1],
            zone.center[2] + finiteHeight(zone.heightM, DEFAULT_DEPLOYABLE_HEIGHT_M) / 2,
          ],
      }))
      .filter(candidate => canAffectPoint(world, origin, candidate.targetPoint, {
        rangeM: definition.rangeM || 22,
        sourceTeam: player.team,
        ignoreLineOfSight: definition.ignoreLineOfSight === true,
      }))
      .sort((a, b) => distance3D(origin, a.targetPoint) - distance3D(origin, b.targetPoint))[0]?.zone;
    if (!own) return;
    const destination = [...own.center];
    movePlayerTowardPoint(world, player, destination);
    player.move.vel = [0, 0, 0];
    if (distance3D(player.move.pos, destination) > LINE_OF_SIGHT_EPSILON_M) return;
    own.expiresAt = world.t;
    world.events.push({
      type: 'deployable_consumed', player: player.id, abilityId: definition.id,
      zoneId: own.id, pos: [...player.move.pos],
    });
  },
  barrage_zone(world, player, definition, target) { createZone(world, player, definition, target, { kind: 'barrage' }); },
  target_reveal(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (target) applyStatus(world, target, { id: definition.id, revealed: true, negative: true }, definition.durationSec, player);
  },
  seeking_blast(world, player, definition) {
    const target = nearestInAim(world, player, definition.rangeM, 'enemy', definition);
    if (target) applyAbilityDamage(
      world, target, definition.damage, player, definition.id,
      playerTargetPoint(player, world.mv),
    );
  },
  homing_barrage(world, player, definition) {
    const origin = playerTargetPoint(player, world.mv);
    const enemies = [...world.players.values()].filter(target =>
      target.alive && !target.flags.invulnerable && !target.flags.intangible && target.team !== player.team
      && canAbilityAffectTarget(world, player, definition, origin, target, {
        rangeM: definition.rangeM,
        rangeOrigin: player.move.pos,
    }));
    for (let i = 0; i < (definition.count || 1) && enemies.length; i++) {
      const target = enemies[i % enemies.length];
      applyAbilityDamage(world, target, definition.damage, player, definition.id, origin);
    }
  },
  ammo_restore(world, player, definition) {
    if (definition.ammoPerSec) return;
    player.weapon.ammo = Math.min(HERO_BY_ID[player.heroId].weapon.magSize, player.weapon.ammo + (definition.ammoRestore || 0));
    if (player.resource?.id === 'needles') player.resource.value = player.weapon.ammo;
  },
  ally_grapple(world, player, definition) {
    const ally = nearestInAim(world, player, definition.rangeM, 'ally', definition);
    if (!ally) return;
    const dx = ally.move.pos[0] - player.move.pos[0], dy = ally.move.pos[1] - player.move.pos[1];
    const len = Math.max(0.01, Math.hypot(dx, dy));
    player.move.vel[0] = dx / len * 14; player.move.vel[1] = dy / len * 14;
    if (definition.storedHeal) storeHeal(world, ally, definition.storedHeal, player, definition.id);
  },
  release_stored_heal(world, player, definition) {
    const ally = nearestInAim(world, player, definition.rangeM, 'ally', definition);
    if (ally) releaseStoredHeal(world, ally, definition.releaseMult, player, definition.id);
  },
  stored_heal_burst(world, player, definition) {
    for (const ally of world.players.values()) {
      if (ally.alive && ally.team === player.team && canAbilityAffectTarget(world, player, definition, player.move.pos, ally, {
        rangeM: definition.radiusM,
      })) {
        releaseStoredHeal(world, ally, definition.releaseMult, player, definition.id);
      }
    }
    applyStatus(world, player, { id: `${definition.id}:conversion`, storedHealRateMult: definition.conversionRateMult }, definition.durationSec, player);
  },
  cooldown_zone(world, player, definition, target) {
    createZone(world, player, definition, target, {
      kind: 'cooldown', allyStatus: { cooldownRateMult: definition.cooldownRateMult }, healPerSec: definition.healPerSec,
    });
  },
  cast_delay_zone(world, player, definition, target) {
    createZone(world, player, definition, target, { kind: 'cast_delay', enemyStatus: { castTimeMult: definition.castTimeMult, negative: true } });
  },
  team_cooldown_buff(world, player, definition) {
    for (const ally of world.players.values()) if (ally.alive && ally.team === player.team) {
      applyStatus(world, ally, { id: definition.id, cooldownRateMult: definition.cooldownRateMult }, definition.durationSec, player);
    }
  },
  projectile_guard(world, player, definition) {
    applyStatus(world, player, { id: definition.id, damageTakenMult: definition.damageTakenMult, projectileGuard: true }, definition.durationSec, player);
  },
  team_guard(world, player, definition) {
    for (const ally of world.players.values()) if (ally.alive && ally.team === player.team) {
      applyStatus(world, ally, { id: definition.id, damageTakenMult: definition.damageTakenMult, projectileGuard: true }, definition.durationSec, player);
    }
  },
  link_ally(world, player, definition) {
    const ally = nearestInAim(world, player, definition.rangeM, 'ally', definition);
    if (ally) player.abilities.heroState.linkedId = ally.id;
  },
  ally_damage_buff(world, player, definition) {
    const linked = world.players.get(player.abilities.heroState.linkedId);
    const origin = playerTargetPoint(player, world.mv);
    const ally = linked && linked.alive && linked.team === player.team
      && canAbilityAffectTarget(world, player, definition, origin, linked, {
        rangeM: definition.rangeM,
        rangeOrigin: player.move.pos,
      })
      ? linked
      : nearestInAim(world, player, definition.rangeM, 'ally', definition);
    if (ally) applyStatus(world, ally, { id: definition.id, damageMult: definition.damageMult }, definition.durationSec, player);
  },
  team_damage_buff(world, player, definition) {
    for (const ally of world.players.values()) if (ally.alive && ally.team === player.team) {
      applyStatus(world, ally, { id: definition.id, damageMult: definition.damageMult, projectileSpeedMult: definition.projectileSpeedMult }, definition.durationSec, player);
    }
  },
  healing_trail(world, player, definition) {
    propel(player, definition.rangeM || 10, false);
    createZone(world, player, definition, player.move.pos, { kind: 'healing_trail' });
  },
  leap_heal(world, player, definition) {
    player.move.vel[2] = Math.max(player.move.vel[2], 7);
    affectRadius(world, player, player.move.pos, definition.radiusM, { heal: definition.heal, abilityId: definition.id }, definition);
  },
  redirect_link(world, player, definition) {
    const ally = nearestInAim(world, player, definition.rangeM, 'ally', definition);
    if (ally) applyStatus(world, ally, { id: definition.id, redirectTo: player.id, redirectPct: definition.redirectPct }, definition.durationSec, player);
  },
  resource_heal(world, player, definition) {
    affectRadius(world, player, player.move.pos, definition.radiusM, { heal: definition.heal, abilityId: definition.id }, definition);
  },
  team_redirect(world, player, definition) {
    for (const ally of world.players.values()) if (ally.alive && ally.team === player.team && ally.id !== player.id
      && canAbilityAffectTarget(world, player, definition, player.move.pos, ally, {
        rangeM: definition.radiusM,
      })) {
      applyStatus(world, ally, { id: definition.id, redirectTo: player.id, redirectPct: definition.redirectPct }, definition.durationSec, player);
    }
    applyStatus(world, player, {
      id: `${definition.id}:end`, kind: 'pain_shockwave', abilityId: definition.id,
      radiusM: definition.radiusM, endDamage: definition.endDamage,
    }, definition.durationSec, player);
  },
};

export const SUPPORTED_BEHAVIORS = Object.freeze(new Set(Object.keys(BEHAVIOR_HANDLERS)));

function propel(player, distance, backward) {
  const sign = backward ? -1 : 1;
  const speed = Math.max(8, distance / 0.65);
  player.move.vel[0] = Math.cos(player.move.yaw) * speed * sign;
  player.move.vel[1] = Math.sin(player.move.yaw) * speed * sign;
}

function aimPoint(world, player, range) {
  const cp = Math.cos(player.move.pitch);
  const dir = [Math.cos(player.move.yaw) * cp, Math.sin(player.move.yaw) * cp, Math.sin(player.move.pitch)];
  const origin = [player.move.pos[0], player.move.pos[1], player.move.pos[2] + world.mv.eyeStandM];
  const wall = range > 0
    ? world.collider.raycast(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], range)
    : Infinity;
  const dist = wall === Infinity ? range : Math.max(0, wall - 0.2);
  return origin.map((value, index) => Math.round((value + dir[index] * dist) * 100) / 100);
}

function cooldownRate(player) {
  let rate = 1;
  for (const status of player.abilities.statuses) rate = Math.max(rate, status.cooldownRateMult || 1);
  return rate;
}

function tickNeedleWind(world, player, dt) {
  if (player.heroId !== 'tsuzuri' || player.resource?.id !== 'needles') return;
  player.resource.value = player.weapon.ammo;
  if (!player.input.secondary) return;
  const definition = HERO_BY_ID.tsuzuri.abilities.secondary;
  const state = player.abilities.heroState;
  state.needleWindFraction = (state.needleWindFraction || 0) + (definition.ammoPerSec || 4) * dt;
  const restored = Math.floor(state.needleWindFraction + 1e-9);
  if (restored > 0) {
    const before = player.weapon.ammo;
    player.weapon.ammo = Math.min(HERO_BY_ID.tsuzuri.weapon.magSize, player.weapon.ammo + restored);
    state.needleWindFraction -= player.weapon.ammo - before;
    if (player.weapon.ammo >= HERO_BY_ID.tsuzuri.weapon.magSize) state.needleWindFraction = 0;
    player.resource.value = player.weapon.ammo;
  }
  applyStatus(world, player, {
    id: definition.id, kind: 'channel', moveSpeedMult: definition.moveSpeedMult || 0.8,
    attackLocked: true, abilityLocked: true,
  }, dt * 2.1, player);
}

function tickHeroMotion(world, player) {
  const state = player.abilities.heroState;
  const recall = state.anchorRecall;
  if (recall) {
    const ratio = Math.max(0, Math.min(1, (world.t - recall.startedAt) / Math.max(world.dt, recall.endsAt - recall.startedAt)));
    if (state.anchor) state.anchor.pos = lerpPoint(recall.from, recall.to, ratio);
    if (world.t + 1e-9 >= recall.endsAt) {
      for (const target of world.players.values()) {
        if (!target.alive || target.team === player.team) continue;
        if (distanceToSegment3D(playerTargetPoint(target, world.mv), recall.from, recall.to) <= 1.5
          && canAbilityAffectTarget(world, player, recall.definition, recall.from, target)) {
          applyAbilityDamage(
            world, target, recall.definition.damage, player, recall.definition.id, recall.from,
          );
          moveToward(world, target, recall.to, recall.definition.pullM || 2);
        }
      }
      state.anchor = null;
      state.anchorRecall = null;
      player.abilities.cooldowns.ability1 = 5;
      world.events.push({ type: 'ability_transit_ended', player: player.id, abilityId: recall.definition.id, pos: [...recall.to] });
    }
  }

  const transit = state.transit;
  if (!transit) return;
  const ratio = Math.max(0, Math.min(1, (world.t - transit.startedAt) / Math.max(world.dt, transit.endsAt - transit.startedAt)));
  const desired = lerpPoint(transit.from, transit.to, ratio);
  movePlayerTowardPoint(world, player, desired);
  player.move.vel = [0, 0, 0];
  if (world.t + 1e-9 < transit.endsAt) return;

  movePlayerTowardPoint(world, player, transit.to);
  state.transit = null;
  if (transit.kind === 'anchor') {
    state.rewind = { pos: [...transit.from], expiresAt: world.t + 5 };
    grantShield(player, Math.min(50, transit.chain * 0.5));
    affectRadius(world, player, player.move.pos, transit.definition.radiusM, {
      damage: transit.definition.damage, abilityId: transit.definition.id,
      enemyStatus: { id: `${transit.definition.id}:slow`, kind: 'slow', slowMult: transit.definition.slowMult, negative: true },
      durationSec: transit.definition.durationSec,
    }, transit.definition);
    createZone(world, player, transit.definition, player.move.pos, {
      kind: 'slow', enemyStatus: { kind: 'slow', slowMult: transit.definition.slowMult, negative: true },
    });
  } else if (transit.kind === 'rewind') {
    state.rewind = null;
    for (const zone of world.zones) {
      if (zone.ownerId === player.id && zone.abilityId === HERO_BY_ID.zairu.abilities.ability1.id) zone.expiresAt = world.t;
    }
  }
  world.events.push({
    type: 'ability_transit_ended', player: player.id, abilityId: transit.definition.id,
    pos: [...player.move.pos],
  });
}

function castTimeMultiplier(player) {
  let mult = 1;
  for (const status of player.abilities.statuses) mult = Math.max(mult, status.castTimeMult || 1);
  return mult;
}

export function movementMultiplier(player) {
  const heroBase = HERO_BY_ID[player?.heroId]?.moveSpeedMult || 1;
  if (!player?.abilities) return heroBase;
  let mult = heroBase;
  for (const status of player.abilities.statuses) {
    if (status.moveSpeedMult) mult *= status.moveSpeedMult;
    if (status.slowMult) mult *= status.slowMult;
  }
  return Math.max(0.35, Math.min(1.75, mult));
}

export function snapshotZone(zone, now = 0) {
  const snapshot = {
    id: zone.id, kind: zone.kind, abilityId: zone.abilityId,
    ownerId: zone.ownerId, team: zone.team, center: [...zone.center], radiusM: zone.radiusM,
    remaining: Math.max(0, Math.round((zone.expiresAt - now) * 10) / 10),
  };
  if (zone.hp !== undefined) {
    snapshot.hp = Math.max(0, Math.round(zone.hp));
    snapshot.maxHp = zone.maxHp;
    snapshot.hitRadiusM = zone.hitRadiusM || Math.min(0.65, zone.radiusM || 0.65);
    snapshot.heightM = finiteHeight(zone.heightM, DEFAULT_DEPLOYABLE_HEIGHT_M);
  }
  return snapshot;
}

export function snapshotBarrier(barrier, now = 0) {
  return {
    id: barrier.id, kind: barrier.kind, abilityId: barrier.abilityId,
    ownerId: barrier.ownerId, team: barrier.team, center: [...barrier.center], radiusM: barrier.radiusM,
    heightM: finiteHeight(barrier.heightM, DEFAULT_BARRIER_HEIGHT_M),
    friendlyPass: barrier.friendlyPass !== false,
    hp: Math.max(0, Math.round(barrier.hp)), maxHp: barrier.maxHp,
    remaining: Math.max(0, Math.round((barrier.expiresAt - now) * 10) / 10),
  };
}

export function storeHeal(world, target, amount, source, abilityId) {
  const sourceId = source?.id || null;
  const rateMult = (source?.abilities?.statuses || []).reduce((value, status) => Math.max(value, status.storedHealRateMult || 1), 1);
  const stitches = target.abilities.statuses.filter(status => status.kind === 'stored_heal' && status.sourceId === sourceId);
  if (stitches.length >= 4) {
    const oldest = stitches.sort((a, b) => a.convertAt - b.convertAt)[0];
    oldest.amount = 0;
  }
  const status = {
    id: `stored_heal:${sourceId}:${world.nextEffectId++}`,
    kind: 'stored_heal', sourceId, abilityId,
    amount: Math.min(60, amount),
    convertAt: world.t + (1 + Math.min(60, amount) / 45) / rateMult,
    expiresAt: world.t + 8,
  };
  target.abilities.statuses.push(status);
  const active = target.abilities.statuses.filter(item => item.kind === 'stored_heal' && item.sourceId === sourceId && item.amount > 0);
  if (active.length >= 3) {
    for (const item of active) item.convertAt = world.t + 2 / rateMult;
  }
  world.events.push({ type: 'stored_heal_added', source: sourceId, target: target.id, amount: status.amount, abilityId });
}

function releaseStoredHeal(world, target, multiplier, source, abilityId) {
  let total = 0;
  for (const status of target.abilities.statuses) {
    if (status.kind !== 'stored_heal' || status.amount <= 0) continue;
    total += status.amount;
    status.amount = 0;
  }
  if (total > 0) world.healPlayer?.(target, total * (multiplier || 1), source, abilityId);
}

function releasePainShockwave(world, player, status) {
  if (!player.alive || player.resource?.id !== 'pain') return;
  const amount = Math.max(0, player.resource.value || 0);
  player.resource.value = 0;
  const origin = [...player.move.pos];
  const targets = [];
  if (amount > 0) {
    for (const target of world.players.values()) {
      if (!target.alive || target.team === player.team || !canAffectTarget(world, origin, target, {
        rangeM: status.radiusM,
        sourceId: player.id,
      })) continue;
      const healthBefore = target.hp + (target.shield || 0);
      applyAbilityDamage(world, target, amount, player, status.abilityId, origin);
      if (target.hp + (target.shield || 0) < healthBefore) targets.push(target.id);
    }
  }
  world.events.push({
    type: 'ability_shockwave', player: player.id, abilityId: status.abilityId,
    amount: Math.round(amount * 10) / 10, radiusM: status.radiusM,
    pos: origin, targets,
  });
}

function pickStatusFields(definition) {
  const fields = {};
  for (const key of [
    'damageMult', 'damageTakenMult', 'moveSpeedMult', 'cooldownRateMult',
    'castTimeMult', 'chargeRateMult', 'projectileSpeedMult', 'multiShot', 'pierce',
  ]) if (definition[key] !== undefined) fields[key] = definition[key];
  return fields;
}

function changeResource(player, amount) {
  if (!player.resource || !amount) return;
  player.resource.value = Math.max(0, Math.min(player.resource.max, player.resource.value + amount));
}

function moveToward(world, player, point, distance) {
  const dx = point[0] - player.move.pos[0], dy = point[1] - player.move.pos[1];
  const len = Math.max(0.001, Math.hypot(dx, dy));
  const amount = Math.min(distance, len);
  movePlayerXY(world, player, dx / len * amount, dy / len * amount);
}

function pushFrom(world, player, point, distance) {
  const dx = player.move.pos[0] - point[0], dy = player.move.pos[1] - point[1];
  const len = Math.max(0.001, Math.hypot(dx, dy));
  movePlayerXY(world, player, dx / len * distance, dy / len * distance);
}

function movePlayerTowardPoint(world, player, point) {
  const horizontal = movePlayerXY(
    world,
    player,
    point[0] - player.move.pos[0],
    point[1] - player.move.pos[1],
  );
  const height = player.move.crouch ? world.mv.crouchHeightM : world.mv.standHeightM;
  const startZ = player.move.pos[2];
  let vertical = world.collider.sweepVerticalCylinder(
    player.move.pos[0], player.move.pos[1], world.mv.capsuleRadiusM,
    startZ, height, point[2] - startZ,
  );
  if (world.collider.overlapsCylinder(
    player.move.pos[0], player.move.pos[1], vertical.z,
    world.mv.capsuleRadiusM, height,
  )) {
    const scale = Math.max(1, Math.abs(vertical.z), Math.abs(vertical.z + height));
    const clearance = Number.EPSILON * scale * 32;
    const backedOffZ = vertical.z + vertical.normal[2] * clearance;
    const safeZ = vertical.normal[2] !== 0 && !world.collider.overlapsCylinder(
      player.move.pos[0], player.move.pos[1], backedOffZ,
      world.mv.capsuleRadiusM, height,
    ) ? backedOffZ : startZ;
    vertical = { ...vertical, z: safeZ };
  }
  player.move.pos[2] = vertical.z;
  return { horizontal, vertical };
}

function movePlayerXY(world, player, dx, dy) {
  const height = player.move.crouch ? world.mv.crouchHeightM : world.mv.standHeightM;
  const start = [player.move.pos[0], player.move.pos[1]];
  let result = world.collider.moveCylinder(
    start[0], start[1], world.mv.capsuleRadiusM,
    player.move.pos[2], player.move.pos[2] + height,
    dx, dy,
  );
  if (world.collider.overlapsCylinder(
    result.position[0], result.position[1], player.move.pos[2],
    world.mv.capsuleRadiusM, height,
  )) {
    const settled = world.collider.moveCylinder(
      result.position[0], result.position[1], world.mv.capsuleRadiusM,
      player.move.pos[2], player.move.pos[2] + height,
      0, 0,
    );
    const settledOverlaps = world.collider.overlapsCylinder(
      settled.position[0], settled.position[1], player.move.pos[2],
      world.mv.capsuleRadiusM, height,
    );
    const position = settledOverlaps ? start : settled.position;
    result = {
      ...result,
      position: [...position],
      displacement: [position[0] - start[0], position[1] - start[1]],
    };
  }
  player.move.pos[0] = result.position[0];
  player.move.pos[1] = result.position[1];
  return result;
}

function lerpPoint(a, b, ratio) { return a.map((value, index) => value + (b[index] - value) * ratio); }

function finiteHeight(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function rayCircle2D(origin, dir, center, radius, maxDist) {
  const fx = origin[0] - center[0], fy = origin[1] - center[1];
  const a = dir[0] * dir[0] + dir[1] * dir[1];
  if (a <= 1e-9) return -1;
  const b = 2 * (fx * dir[0] + fy * dir[1]);
  const c = fx * fx + fy * fy - radius * radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return -1;
  const root = Math.sqrt(disc);
  const t1 = (-b - root) / (2 * a), t2 = (-b + root) / (2 * a);
  for (const t of [t1, t2]) if (t >= 0 && t <= maxDist) return t;
  return -1;
}
