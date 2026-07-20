const MIN_MOVE_SPEED_MULTIPLIER = 0.35;
const MAX_MOVE_SPEED_MULTIPLIER = 1.75;

export function resolveSnapshotGrounded(player, inferGrounded) {
  if (typeof player?.grounded === 'boolean') return player.grounded;
  return !!inferGrounded(player?.pos, player?.vel);
}

export function resolveSnapshotMoveSpeedMultiplier(player) {
  const multiplier = player?.moveSpeedMultiplier;
  if (!Number.isFinite(multiplier)) return 1;
  return Math.max(MIN_MOVE_SPEED_MULTIPLIER, Math.min(MAX_MOVE_SPEED_MULTIPLIER, multiplier));
}

export function resolvePredictionMovementConfig(movement, player) {
  const multiplier = resolveSnapshotMoveSpeedMultiplier(player);
  if (multiplier === 1) return movement;
  return { ...movement, baseSpeedMps: movement.baseSpeedMps * multiplier };
}

export function retirePendingInputs(pending, player) {
  const ack = Number.isSafeInteger(player?.ack) && player.ack >= 0 ? player.ack : 0;
  const retired = Number.isSafeInteger(player?.retired) && player.retired >= 0 ? player.retired : ack;
  const resolvedThrough = Math.max(ack, retired);
  return Array.isArray(pending) ? pending.filter(input => input?.seq > resolvedThrough) : [];
}
