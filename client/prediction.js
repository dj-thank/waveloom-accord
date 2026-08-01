const MIN_MOVE_SPEED_MULTIPLIER = 0.35;
const MAX_MOVE_SPEED_MULTIPLIER = 1.75;
// Keep deliberate headroom below the server's 32-command bounded reorder
// window.  A render or simulation hitch must slow local input generation,
// never turn a healthy ordered stream into out-of-window protocol errors.
export const MAX_UNRESOLVED_INPUT_SEQUENCES = 24;

function resolvedInputSequence(player) {
  const ack = Number.isSafeInteger(player?.ack) && player.ack >= 0 ? player.ack : 0;
  const retired = Number.isSafeInteger(player?.retired) && player.retired >= 0 ? player.retired : ack;
  return Math.max(ack, retired);
}

export function canIssueInputSequence(lastIssuedSeq, player, maxUnresolved = MAX_UNRESOLVED_INPUT_SEQUENCES) {
  const issued = Number.isSafeInteger(lastIssuedSeq) && lastIssuedSeq >= 0 ? lastIssuedSeq : 0;
  const limit = Number.isSafeInteger(maxUnresolved) && maxUnresolved > 0
    ? maxUnresolved
    : MAX_UNRESOLVED_INPUT_SEQUENCES;
  return issued - resolvedInputSequence(player) < limit;
}

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
  const resolvedThrough = resolvedInputSequence(player);
  return Array.isArray(pending) ? pending.filter(input => input?.seq > resolvedThrough) : [];
}
