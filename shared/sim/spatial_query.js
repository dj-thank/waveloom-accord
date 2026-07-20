// 3D effect queries shared by abilities and projectile impacts.
// The first and last epsilon of a segment are excluded so an effect spawned on
// a solid surface, or aimed at a target touching one, does not occlude itself.

import { rayCylinder, rayCylinderSide } from './collision.js';

export const LINE_OF_SIGHT_EPSILON_M = 1e-4;
export const DEFAULT_BARRIER_HEIGHT_M = 3;
export const DEFAULT_DEPLOYABLE_RADIUS_M = 0.65;
export const DEFAULT_DEPLOYABLE_HEIGHT_M = 1.2;

export function hasLineOfSight(colliderOrWorld, origin, target, epsilonM = LINE_OF_SIGHT_EPSILON_M, options = {}) {
  const world = colliderOrWorld?.collider ? colliderOrWorld : null;
  const collider = world?.collider || colliderOrWorld;
  const delta = target.map((value, index) => value - origin[index]);
  const distance = Math.hypot(...delta);
  const epsilon = Math.max(0, Math.min(epsilonM, distance / 2));
  if (distance <= epsilon * 2) return true;

  const dir = delta.map(value => value / distance);
  const start = origin.map((value, index) => value + dir[index] * epsilon);
  const queryDistance = distance - epsilon * 2;
  if (collider.raycast(
    start[0], start[1], start[2],
    dir[0], dir[1], dir[2],
    queryDistance,
  ) !== Infinity) return false;
  if (!world) return true;

  for (const barrier of world.barriers || []) {
    if (barrier.hp !== undefined && barrier.hp <= 0) continue;
    if (barrier.blocksLineOfSight === false) continue;
    if (options.sourceTeam !== undefined
      && barrier.team === options.sourceTeam
      && barrier.friendlyPass !== false) continue;
    const radiusM = Number.isFinite(barrier.radiusM) && barrier.radiusM > 0 ? barrier.radiusM : 0;
    const heightM = Number.isFinite(barrier.heightM) && barrier.heightM > 0
      ? barrier.heightM
      : DEFAULT_BARRIER_HEIGHT_M;
    if (radiusM <= 0) continue;
    const hit = rayCylinderSide(
      start[0], start[1], start[2], dir[0], dir[1], dir[2],
      barrier.center[0], barrier.center[1], barrier.center[2], barrier.center[2] + heightM,
      radiusM, queryDistance,
    );
    if (hit >= 0 && hit < queryDistance) return false;
  }

  for (const zone of world.zones || []) {
    if (zone.hp === undefined || zone.hp <= 0) continue;
    if (zone.blocksLineOfSight === false) continue;
    if (options.sourceTeam !== undefined && zone.team === options.sourceTeam) continue;
    const radiusM = Number.isFinite(zone.hitRadiusM) && zone.hitRadiusM > 0
      ? zone.hitRadiusM
      : DEFAULT_DEPLOYABLE_RADIUS_M;
    const heightM = Number.isFinite(zone.heightM) && zone.heightM > 0
      ? zone.heightM
      : DEFAULT_DEPLOYABLE_HEIGHT_M;
    const hit = rayCylinder(
      start[0], start[1], start[2], dir[0], dir[1], dir[2],
      zone.center[0], zone.center[1], zone.center[2], zone.center[2] + heightM,
      radiusM, queryDistance,
    );
    if (hit >= 0 && hit < queryDistance) return false;
  }
  return true;
}

export function playerTargetPoint(player, movement) {
  const height = player.move.crouch ? movement.crouchHeightM : movement.standHeightM;
  return [player.move.pos[0], player.move.pos[1], player.move.pos[2] + height / 2];
}

export function distance3D(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

export function canAffectPoint(world, origin, targetPoint, options = {}) {
  const {
    rangeM = Infinity,
    rangeOrigin = origin,
    sourceTeam,
    ignoreLineOfSight = false,
  } = options;
  if (distance3D(rangeOrigin, targetPoint) > rangeM + LINE_OF_SIGHT_EPSILON_M) return false;
  if (ignoreLineOfSight) return true;
  return hasLineOfSight(world, origin, targetPoint, LINE_OF_SIGHT_EPSILON_M, { sourceTeam });
}

export function canAffectTarget(world, origin, target, options = {}) {
  const {
    rangeM = Infinity,
    rangeOrigin = origin,
    sourceId = null,
    ignoreLineOfSight = false,
  } = options;
  if (!target?.move) return false;
  const targetPoint = playerTargetPoint(target, world.mv);
  return canAffectPoint(world, origin, targetPoint, {
    rangeM,
    rangeOrigin,
    sourceTeam: world.players?.get(sourceId)?.team,
    ignoreLineOfSight: target.id === sourceId || ignoreLineOfSight,
  });
}

export function distanceToSegment3D(point, a, b) {
  const segment = b.map((value, index) => value - a[index]);
  const offset = point.map((value, index) => value - a[index]);
  const lengthSq = segment.reduce((sum, value) => sum + value * value, 0);
  const ratio = lengthSq <= 1e-12
    ? 0
    : Math.max(0, Math.min(1, offset.reduce((sum, value, index) => sum + value * segment[index], 0) / lengthSq));
  const closest = a.map((value, index) => value + segment[index] * ratio);
  return distance3D(point, closest);
}
