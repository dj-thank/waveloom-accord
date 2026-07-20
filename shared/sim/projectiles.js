// 投射武器のサーバー権威前方シミュレーション。
// ヒットスキャンの巻き戻しとは分離し、生成後の各固定tickで世界・障壁・選手へ衝突させる。

import { hitscan, damageAtRange, traceWorld } from './combat.js';
import {
  DEFAULT_DEPLOYABLE_HEIGHT_M,
  barrierHit,
  deployableHit,
  storeHeal,
  snapshotZone,
} from './abilities.js';
import {
  LINE_OF_SIGHT_EPSILON_M,
  canAffectPoint,
  canAffectTarget,
  distance3D,
  playerTargetPoint,
} from './spatial_query.js';

const EPSILON = 1e-6;
const MAX_ADVANCE_STEPS = 32;
const POST_RICOCHET_RANGE_M = 12;
const SURFACE_SEPARATION_M = EPSILON * 4;
const FIELD_BOUNDARY_EPSILON_M = 1e-7;
const FIELD_MEMBERSHIP_PROBE_M = LINE_OF_SIGHT_EPSILON_M * 2;

export function spawnWeaponProjectile(world, owner, weapon, origin, direction, values = {}) {
  const speed = Math.max(1, values.speedMps || weapon.projectileSpeedMps || 30);
  const dir = normalize(direction);
  const projectile = {
    id: `pr${world.nextEffectId++}`,
    ownerId: owner.id,
    team: owner.team,
    heroId: owner.heroId,
    weaponId: weapon.id,
    weapon,
    type: values.type || weapon.type || 'projectile',
    pos: [...origin],
    dir,
    speedMps: speed,
    baseSpeedMps: speed,
    travelledM: 0,
    maxRangeM: values.maxRangeM || weapon.maxRangeM || 60,
    radiusM: finiteRadius(values.radiusM ?? values.projectileRadiusM ?? weapon.projectileRadiusM),
    damageScale: values.damageScale || 1,
    bouncesRemaining: weapon.type === 'ricochet_projectile' ? 1 : 0,
    postBounceRemainingM: null,
    alive: true,
  };
  world.projectiles.push(projectile);
  world.events.push({
    type: 'projectile_spawned', projectileId: projectile.id, source: owner.id,
    heroId: owner.heroId, weaponId: weapon.id, projectileType: projectile.type,
    pos: roundVec(projectile.pos), dir: roundVec(projectile.dir), speedMps: speed,
    radiusM: projectile.radiusM,
  });
  return projectile;
}

export function tickProjectiles(world, dt) {
  if (!world.projectiles?.length) return;
  for (const projectile of world.projectiles) {
    if (!projectile.alive) continue;
    const owner = world.players.get(projectile.ownerId);
    const definition = projectile.weapon;
    if (!definition) {
      projectile.alive = false;
      continue;
    }

    if (projectile.type === 'guided_projectile') steerTowardNearestEnemy(world, projectile, dt);
    const targets = [...world.players.values()]
      .filter(player => player.alive && !player.flags.invulnerable && !player.flags.intangible)
      .map(player => ({
        id: player.id, team: player.team, pos: [...player.move.pos], crouch: player.move.crouch,
      }));
    const affectsAllies = !!(definition.allyHealStored || definition.allyHeal);
    let remainingTime = Math.max(0, dt);
    let advanceSteps = 0;
    while (projectile.alive && remainingTime > EPSILON && advanceSteps++ < MAX_ADVANCE_STEPS) {
      const rangeRemaining = projectile.postBounceRemainingM == null
        ? Math.max(0, projectile.maxRangeM - projectile.travelledM)
        : Math.max(0, projectile.postBounceRemainingM);
      if (rangeRemaining <= EPSILON) {
        resolveImpact(world, projectile, definition, projectile.pos, null, owner);
        break;
      }

      const fieldSample = pointAlong(projectile.pos, projectile.dir, FIELD_MEMBERSHIP_PROBE_M);
      const speed = projectile.speedMps * projectileSpeedMultiplier(world, projectile, fieldSample);
      const unconstrainedStepDist = Math.min(rangeRemaining, speed * remainingTime);
      const fieldBoundary = nextProjectileFieldBoundary(world, projectile, unconstrainedStepDist);
      const stepDist = Math.min(unconstrainedStepDist, fieldBoundary?.dist ?? Infinity);
      if (stepDist <= EPSILON) break;
      const hit = hitscan(
        world.collider, world.mv, world.combat.headHitbox,
        projectile.pos, projectile.dir, stepDist,
        targets, projectile.ownerId, projectile.team, affectsAllies ? 'any' : 'enemy', projectile.radiusM,
      );
      const barrier = barrierHit(
        world, projectile.pos, projectile.dir, hit.dist, projectile.team, projectile.radiusM,
      );
      const deployable = deployableHit(
        world, projectile.pos, projectile.dir, hit.dist, projectile.team, projectile.radiusM,
      );
      if (deployable && (!barrier || deployable.dist < barrier.dist)) {
        const impact = pointAlong(projectile.pos, projectile.dir, deployable.dist);
        const dealt = damageAtRange(definition, projectile.travelledM + deployable.dist, false) * projectile.damageScale;
        deployable.zone.hp -= dealt;
        world.events.push({
          type: 'deployable_hit', source: projectile.ownerId, zone: deployable.zone.id,
          projectileId: projectile.id, amount: round1(dealt), hp: Math.max(0, round1(deployable.zone.hp)),
          pos: roundVec(impact),
        });
        if (deployable.zone.hp <= 0) {
          world.events.push({
            type: 'deployable_destroyed', zone: deployable.zone.id, source: projectile.ownerId,
            pos: roundVec(impact),
          });
        }
        resolveImpact(world, projectile, definition, impact, null, owner);
        break;
      }
      if (barrier) {
        const impact = pointAlong(projectile.pos, projectile.dir, barrier.dist);
        const dealt = damageAtRange(definition, projectile.travelledM + barrier.dist, false) * projectile.damageScale;
        barrier.barrier.hp -= dealt;
        world.events.push({
          type: 'barrier_hit', source: projectile.ownerId, barrier: barrier.barrier.id,
          projectileId: projectile.id, amount: round1(dealt), pos: roundVec(impact),
        });
        if (barrier.barrier.hp <= 0) {
          world.events.push({
            type: 'barrier_destroyed', barrier: barrier.barrier.id, source: projectile.ownerId,
            pos: roundVec(impact),
          });
        }
        resolveImpact(world, projectile, definition, impact, null, owner);
        break;
      }

      if (hit.type === 'world') {
        const surface = traceWorld(world.collider, projectile.pos, projectile.dir, stepDist, projectile.radiusM);
        const impact = surface.hit ? surface.point : pointAlong(projectile.pos, projectile.dir, hit.dist);
        if (projectile.bouncesRemaining > 0 && surface.hit) {
          consumeTravel(projectile, surface.dist);
          remainingTime = Math.max(0, remainingTime - surface.dist / speed);
          projectile.dir = reflect(projectile.dir, surface.normal);
          projectile.pos = pointAlong(impact, surface.normal, SURFACE_SEPARATION_M);
          projectile.damageScale *= 1.5;
          projectile.bouncesRemaining--;
          projectile.postBounceRemainingM = POST_RICOCHET_RANGE_M;
          world.events.push({
            type: 'projectile_ricochet', projectileId: projectile.id,
            pos: roundVec(impact), normal: roundVec(surface.normal),
          });
          continue;
        }
        resolveImpact(world, projectile, definition, impact, null, owner);
        break;
      }

      if (hit.type === 'player') {
        const impact = pointAlong(projectile.pos, projectile.dir, hit.dist);
        resolveImpact(world, projectile, definition, impact, world.players.get(hit.target.id), owner, hit.headshot);
        break;
      }

      projectile.pos = pointAlong(projectile.pos, projectile.dir, stepDist);
      consumeTravel(projectile, stepDist);
      remainingTime = Math.max(0, remainingTime - stepDist / speed);
      if (stepDist + EPSILON >= rangeRemaining) {
        resolveImpact(world, projectile, definition, projectile.pos, null, owner);
      }
    }
  }
  world.projectiles = world.projectiles.filter(projectile => projectile.alive);
}

export function snapshotProjectile(projectile) {
  return {
    id: projectile.id, ownerId: projectile.ownerId, team: projectile.team,
    heroId: projectile.heroId, weaponId: projectile.weaponId, type: projectile.type,
    pos: roundVec(projectile.pos), dir: roundVec(projectile.dir),
    speedMps: round1(projectile.speedMps), radiusM: finiteRadius(projectile.radiusM),
    travelledM: round1(projectile.travelledM),
  };
}

function resolveImpact(world, projectile, weapon, point, directTarget, owner, headshot = false) {
  projectile.alive = false;
  const distance = projectile.travelledM + Math.hypot(
    point[0] - projectile.pos[0], point[1] - projectile.pos[1], point[2] - projectile.pos[2],
  );
  if (directTarget?.alive) {
    if (directTarget.team === projectile.team) {
      if (weapon.allyHealStored) storeHeal(world, directTarget, weapon.allyHealStored, owner, weapon.id);
      if (weapon.allyHeal) world.healPlayer(directTarget, weapon.allyHeal, owner, weapon.id);
    } else {
      const damage = damageAtRange(weapon, distance, headshot) * projectile.damageScale;
      world.applyDamage(directTarget, damage, owner, headshot, {
        abilityId: weapon.id, projectileId: projectile.id, damageOrigin: roundVec(point),
      });
    }
  }

  const splashRadius = weapon.splashRadiusM || 0;
  if (splashRadius > 0) {
    for (const target of world.players.values()) {
      if (!target.alive) continue;
      if (target.id === directTarget?.id && target.team !== projectile.team && weapon.directTargetReceivesSplash !== true) continue;
      if (!canAffectTarget(world, point, target, {
        rangeM: splashRadius,
        sourceId: projectile.ownerId,
        ignoreLineOfSight: weapon.ignoreLineOfSight === true,
      })) continue;
      if (target.team === projectile.team) {
        if (weapon.allyHealSplash) world.healPlayer(target, weapon.allyHealSplash, owner, weapon.id);
      } else if (weapon.splashDamage) {
        world.applyDamage(target, weapon.splashDamage * projectile.damageScale, owner, false, {
          abilityId: weapon.id, projectileId: projectile.id, damageOrigin: roundVec(point),
        });
      }
    }
  }

  if (projectile.heroId === 'tsubakuro' && !directTarget && owner?.alive) {
    const blades = owner.abilities.heroState.blades || [];
    blades.push({ id: projectile.id, pos: [...point], expiresAt: world.t + 6 });
    owner.abilities.heroState.blades = blades.slice(-8);
    world.events.push({
      type: 'blade_embedded', player: owner.id, projectileId: projectile.id,
      pos: roundVec(point), durationSec: 6,
    });
  }

  if (weapon.type === 'deploy') createDeployZone(world, projectile, weapon, point);
  world.events.push({
    type: 'projectile_impact', projectileId: projectile.id, source: projectile.ownerId,
    weaponId: projectile.weaponId, target: directTarget?.id || null, pos: roundVec(point),
  });
}

function createDeployZone(world, projectile, weapon, point) {
  const zone = {
    id: `z${world.nextEffectId++}`,
    kind: 'damage', abilityId: weapon.id, ownerId: projectile.ownerId, team: projectile.team,
    center: [...point], radiusM: weapon.zoneRadiusM || weapon.splashRadiusM || 4,
    expiresAt: world.t + (weapon.zoneDurationSec || 12), nextPulseAt: world.t,
    followOwner: false, damagePerSec: weapon.zoneDamagePerSec || 50, healPerSec: 0,
    allyStatus: null,
    enemyStatus: weapon.zoneSlowMult
      ? { kind: 'slow', slowMult: weapon.zoneSlowMult, negative: true }
      : null,
    projectileSpeedMult: null, allyProjectileSpeedMult: null,
    ignoreLineOfSight: weapon.ignoreLineOfSight === true,
    hp: weapon.deployableHp || 60, maxHp: weapon.deployableHp || 60,
    hitRadiusM: weapon.hitRadiusM ?? 0.65,
    heightM: finiteHeight(weapon.deployableHeightM ?? weapon.heightM, DEFAULT_DEPLOYABLE_HEIGHT_M),
  };
  world.zones.push(zone);
  world.events.push({
    type: 'zone_created',
    zone: snapshotZone(zone, world.t),
    pos: roundVec(zone.center),
  });
}

function projectileSpeedMultiplier(world, projectile, samplePos = projectile.pos) {
  let multiplier = 1;
  for (const zone of world.zones || []) {
    const zoneMultiplier = zone.team === projectile.team
      ? zone.allyProjectileSpeedMult || 1
      : zone.projectileSpeedMult || 1;
    if (zoneMultiplier === 1 || !canAffectPoint(world, zone.center, samplePos, {
      rangeM: zone.radiusM,
      sourceTeam: zone.team,
      ignoreLineOfSight: zone.ignoreLineOfSight === true,
    })) continue;
    multiplier *= zoneMultiplier;
  }
  const owner = world.players.get(projectile.ownerId);
  for (const status of owner?.abilities?.statuses || []) multiplier *= status.projectileSpeedMult || 1;
  return Math.max(0.15, Math.min(2.5, multiplier));
}

function nextProjectileFieldBoundary(world, projectile, maxDist) {
  if (maxDist <= FIELD_BOUNDARY_EPSILON_M) return null;
  let nearest = null;
  for (const zone of world.zones || []) {
    const multiplier = zone.team === projectile.team
      ? zone.allyProjectileSpeedMult || 1
      : zone.projectileSpeedMult || 1;
    const radius = Number.isFinite(zone.radiusM) && zone.radiusM > 0 ? zone.radiusM : 0;
    if (multiplier === 1 || radius <= 0) continue;
    const offset = projectile.pos.map((value, index) => value - zone.center[index]);
    const along = offset.reduce((sum, value, index) => sum + value * projectile.dir[index], 0);
    const c = offset.reduce((sum, value) => sum + value * value, 0) - radius * radius;
    const discriminant = along * along - c;
    if (discriminant < 0) continue;
    const root = Math.sqrt(Math.max(0, discriminant));
    for (const dist of [-along - root, -along + root]) {
      if (dist <= FIELD_BOUNDARY_EPSILON_M || dist > maxDist + FIELD_BOUNDARY_EPSILON_M) continue;
      const candidate = { dist: Math.min(maxDist, dist), zoneId: String(zone.id || '') };
      if (
        !nearest
        || candidate.dist < nearest.dist - FIELD_BOUNDARY_EPSILON_M
        || (
          Math.abs(candidate.dist - nearest.dist) <= FIELD_BOUNDARY_EPSILON_M
          && candidate.zoneId < nearest.zoneId
        )
      ) nearest = candidate;
    }
  }
  return nearest;
}

function steerTowardNearestEnemy(world, projectile, dt) {
  let nearest = null;
  const acquisitionRangeM = projectile.weapon.homingRangeM ?? 35;
  for (const target of world.players.values()) {
    if (!target.alive || target.flags.invulnerable || target.flags.intangible || target.team === projectile.team) continue;
    const dist = distance3D(projectile.pos, target.move.pos);
    if (!canAffectTarget(world, projectile.pos, target, {
      rangeM: acquisitionRangeM,
      sourceId: projectile.ownerId,
      ignoreLineOfSight: projectile.weapon.ignoreLineOfSight === true,
    })) continue;
    if (!nearest || dist < nearest.dist) nearest = { target, dist };
  }
  if (!nearest) return;
  const targetPoint = playerTargetPoint(nearest.target, world.mv);
  const desired = normalize([
    targetPoint[0] - projectile.pos[0], targetPoint[1] - projectile.pos[1], targetPoint[2] - projectile.pos[2],
  ]);
  const blend = Math.min(1, dt * 1.8);
  projectile.dir = normalize(projectile.dir.map((value, index) => value * (1 - blend) + desired[index] * blend));
}

function normalize(vector) {
  const length = Math.max(EPSILON, Math.hypot(...vector));
  return vector.map(value => value / length);
}

function reflect(direction, normal) {
  const dot = direction.reduce((sum, value, index) => sum + value * normal[index], 0);
  return normalize(direction.map((value, index) => value - 2 * dot * normal[index]));
}

function finiteHeight(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function finiteRadius(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function pointAlong(origin, dir, distance) {
  return origin.map((value, index) => value + dir[index] * distance);
}

function consumeTravel(projectile, distance) {
  projectile.travelledM += distance;
  if (projectile.postBounceRemainingM !== null && projectile.postBounceRemainingM !== undefined) {
    projectile.postBounceRemainingM = Math.max(0, projectile.postBounceRemainingM - distance);
  }
}

function round1(value) { return Math.round(value * 10) / 10; }
function roundVec(vector) { return vector.map(value => Math.round(value * 100) / 100); }
