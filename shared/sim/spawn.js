import { eyePosition } from './combat.js';

export function selectSafeSpawn({ player, points, players, collider, movement }) {
  const height = movement.standHeightM;
  const radius = movement.capsuleRadiusM;
  const activePlayers = [...players].filter(candidate => candidate.alive && candidate !== player);
  const enemies = activePlayers.filter(enemy => enemy.team !== player.team);
  const scored = points.map((point, index) => {
    const clear = !collider.overlapsCylinder(point.pos[0], point.pos[1], point.pos[2], radius, height);
    const occupancy = activePlayers.reduce((count, candidate) => {
      const candidateHeight = candidate.move.crouch ? movement.crouchHeightM : height;
      if (
        candidate.move.pos[2] + candidateHeight <= point.pos[2]
        || candidate.move.pos[2] >= point.pos[2] + height
      ) return count;
      const dx = candidate.move.pos[0] - point.pos[0];
      const dy = candidate.move.pos[1] - point.pos[1];
      return count + (dx * dx + dy * dy < (radius * 2) ** 2 ? 1 : 0);
    }, 0);
    let nearestEnemyDistance = Infinity;
    let enemyLos = 0;
    const targetEye = [point.pos[0], point.pos[1], point.pos[2] + movement.eyeStandM];
    for (const enemy of enemies) {
      const dx = enemy.move.pos[0] - point.pos[0];
      const dy = enemy.move.pos[1] - point.pos[1];
      const dz = enemy.move.pos[2] - point.pos[2];
      const distance = Math.hypot(dx, dy, dz);
      nearestEnemyDistance = Math.min(nearestEnemyDistance, distance);
      const eye = eyePosition(enemy, movement);
      const length = Math.hypot(targetEye[0] - eye[0], targetEye[1] - eye[1], targetEye[2] - eye[2]);
      if (length > 1e-9) {
        const trace = collider.trace(
          eye[0], eye[1], eye[2],
          (targetEye[0] - eye[0]) / length, (targetEye[1] - eye[1]) / length, (targetEye[2] - eye[2]) / length,
          length,
        );
        if (!trace.hit || trace.dist >= length - 1e-6) enemyLos++;
      }
    }
    return { point, index, clear: clear ? 1 : 0, occupancy, nearestEnemyDistance, enemyLos };
  });
  scored.sort((a, b) =>
    b.clear - a.clear
    || a.occupancy - b.occupancy
    || a.enemyLos - b.enemyLos
    || b.nearestEnemyDistance - a.nearestEnemyDistance
    || a.index - b.index);
  return scored[0]?.point || points[0];
}
