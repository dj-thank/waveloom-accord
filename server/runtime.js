import {
  PROTOCOL_VERSION, LAG_COMPENSATION_POLICY,
} from '../shared/protocol.js';

export { PROTOCOL_VERSION, LAG_COMPENSATION_POLICY };
export const WS_CONNECTION_LIMIT = 32;
export const WS_JOIN_DEADLINE_MS = 5_000;
export const WS_FORCE_CLOSE_MS = 100;
export const MESSAGE_TOKEN_BUCKET_CAPACITY = 180;
export const MESSAGE_TOKEN_BUCKET_REFILL_PER_MS = 180 / 1_000;

export function createMessageTokenBucket(nowMs) {
  if (!Number.isFinite(nowMs)) throw new TypeError('token bucket time must be finite');
  return {
    capacity: MESSAGE_TOKEN_BUCKET_CAPACITY,
    tokens: MESSAGE_TOKEN_BUCKET_CAPACITY,
    refillPerMs: MESSAGE_TOKEN_BUCKET_REFILL_PER_MS,
    updatedAtMs: nowMs,
  };
}

export function consumeMessageToken(bucket, nowMs) {
  if (
    bucket === null
    || typeof bucket !== 'object'
    || !Number.isFinite(bucket.capacity)
    || !Number.isFinite(bucket.tokens)
    || !Number.isFinite(bucket.refillPerMs)
    || !Number.isFinite(bucket.updatedAtMs)
    || !Number.isFinite(nowMs)
  ) throw new TypeError('token bucket state and time must be finite');
  const updatedAtMs = Math.max(bucket.updatedAtMs, nowMs);
  const tokens = Math.min(
    bucket.capacity,
    Math.max(0, bucket.tokens) + (updatedAtMs - bucket.updatedAtMs) * bucket.refillPerMs,
  );
  const allowed = tokens >= 1;
  return {
    allowed,
    bucket: {
      capacity: bucket.capacity,
      tokens: allowed ? tokens - 1 : tokens,
      refillPerMs: bucket.refillPerMs,
      updatedAtMs,
    },
  };
}

export function bindConnection(conn, newPlayerId, sockets) {
  const oldPlayerId = conn.playerId;
  if (oldPlayerId && sockets.get(oldPlayerId) === conn.ws) sockets.delete(oldPlayerId);
  conn.playerId = newPlayerId;
  sockets.set(newPlayerId, conn.ws);
}

export function unbindConnection(conn, sockets) {
  if (conn.playerId && sockets.get(conn.playerId) === conn.ws) sockets.delete(conn.playerId);
  conn.playerId = null;
}

export function canRequestRestart(conn, matchState) {
  return !!conn.playerId && matchState === 'MATCH_END';
}

export function clampAccumulator(acc, dtMs, maxSteps) {
  const cap = dtMs * maxSteps;
  if (acc <= cap) return { acc, droppedMs: 0 };
  return { acc: cap, droppedMs: acc - cap };
}

export const LAG_COMPENSATION_ABSOLUTE_MAX_MS = LAG_COMPENSATION_POLICY.absoluteMaxMs;
export const DISPLAY_INTERPOLATION_BASE_MS = LAG_COMPENSATION_POLICY.displayInterpolationBaseMs;
export const LAG_COMPENSATION_REQUIRED_SAMPLES = 4;
export const LAG_COMPENSATION_SAMPLE_WINDOW = 20;
const SLOW_PONG_OUTLIER_DELTA_MS = 50;

// Only server-timed WebSocket ping/pong samples earn rewind credit.  The clock
// is injectable so this policy remains deterministic in tests and simulations.
export function createLagCompensationTracker({
  now = () => Number(process.hrtime.bigint()) / 1e6,
  absoluteMaxMs = LAG_COMPENSATION_ABSOLUTE_MAX_MS,
  displayInterpolationBaseMs = DISPLAY_INTERPOLATION_BASE_MS,
} = {}) {
  let pendingPingAtMs = null;
  let rttEmaMs = null;
  let jitterEmaMs = 0;
  let samples = 0;
  let slowPongOutliers = 0;
  let aboveAbsoluteCapSamples = 0;
  const recentRttSamplesMs = [];
  const absoluteCapMs = Math.max(0, Math.min(LAG_COMPENSATION_ABSOLUTE_MAX_MS, absoluteMaxMs));
  const displayBaseMs = Math.max(0, Math.min(absoluteCapMs, displayInterpolationBaseMs));
  let latestSampleExceedsAbsoluteCap = false;

  const capMs = () => {
    if (latestSampleExceedsAbsoluteCap) return 0;
    const compensationReady = recentRttSamplesMs.length >= LAG_COMPENSATION_REQUIRED_SAMPLES;
    const minimumRttMs = compensationReady ? Math.min(...recentRttSamplesMs) : 0;
    // A peer can delay pong, but cannot make a genuine round trip complete
    // sooner. A rolling minimum therefore avoids rewarding artificial delay;
    // jitter remains diagnostic only.
    const networkAllowanceMs = compensationReady ? minimumRttMs / 2 : 0;
    return Math.round(Math.min(absoluteCapMs, Math.max(0, displayBaseMs + networkAllowanceMs)));
  };
  return {
    markPing(atMs = now()) {
      if (!Number.isFinite(atMs)) return false;
      pendingPingAtMs = atMs;
      return true;
    },
    observePong(atMs = now()) {
      if (!Number.isFinite(atMs) || pendingPingAtMs === null || atMs < pendingPingAtMs) return false;
      const sampleMs = Math.min(5_000, atMs - pendingPingAtMs);
      pendingPingAtMs = null;
      latestSampleExceedsAbsoluteCap = sampleMs > absoluteCapMs;
      if (latestSampleExceedsAbsoluteCap) {
        aboveAbsoluteCapSamples++;
      } else {
        const previousMinimum = recentRttSamplesMs.length > 0
          ? Math.min(...recentRttSamplesMs)
          : null;
        if (
          previousMinimum !== null
          && sampleMs > previousMinimum + SLOW_PONG_OUTLIER_DELTA_MS
        ) slowPongOutliers++;
        recentRttSamplesMs.push(sampleMs);
        if (recentRttSamplesMs.length > LAG_COMPENSATION_SAMPLE_WINDOW) {
          recentRttSamplesMs.shift();
        }
      }
      if (rttEmaMs === null) {
        rttEmaMs = sampleMs;
        jitterEmaMs = 0;
      } else {
        const delta = Math.abs(sampleMs - rttEmaMs);
        rttEmaMs += (sampleMs - rttEmaMs) * 0.25;
        jitterEmaMs += (delta - jitterEmaMs) * 0.25;
      }
      samples++;
      return true;
    },
    apply(requestedMs) {
      const requested = Number.isFinite(requestedMs) ? Math.max(0, requestedMs) : 0;
      return Math.min(Math.round(requested), capMs());
    },
    metrics() {
      const minimumRttMs = recentRttSamplesMs.length > 0
        ? Math.min(...recentRttSamplesMs)
        : null;
      return {
        samples,
        rttEmaMs: rttEmaMs === null ? null : Math.round(rttEmaMs),
        jitterEmaMs: Math.round(jitterEmaMs),
        capMs: capMs(),
        absoluteCapMs,
        displayInterpolationBaseMs: displayBaseMs,
        minimumRttMs: minimumRttMs === null ? null : Math.round(minimumRttMs),
        compensationReady: recentRttSamplesMs.length >= LAG_COMPENSATION_REQUIRED_SAMPLES,
        requiredSamples: LAG_COMPENSATION_REQUIRED_SAMPLES,
        sampleWindowSize: LAG_COMPENSATION_SAMPLE_WINDOW,
        slowPongOutliers,
        aboveAbsoluteCapSamples,
      };
    },
  };
}

export function buildRuntimeDiagnostics(connections, sockets, world) {
  const allConnections = connections && typeof connections.values === 'function'
    ? [...connections.values()]
    : [];
  return {
    connections: Number.isSafeInteger(connections?.size) ? connections.size : 0,
    joinedPlayers: Number.isSafeInteger(sockets?.size) ? sockets.size : 0,
    unjoinedConnections: allConnections.filter(connection => !connection?.playerId).length,
    inputCommands: world?.inputCommandHealth?.() || null,
    lagCompensation: allConnections.map((connection) => {
      const playerId = connection?.playerId ?? null;
      return {
        playerId,
        appliedRewindMs: world?.players?.get?.(playerId)?.appliedRewindMs ?? 0,
        ...(connection?.lagCompensation?.metrics?.() || {}),
      };
    }),
  };
}

export function shouldExitOnInitialListenError({ hasListened = false, shuttingDown = false } = {}) {
  return !hasListened && !shuttingDown;
}

export function claimedSlotSpawnOptions(matchState) {
  return matchState === 'ACTIVE' ? { safe: true, protect: true } : {};
}

export function canAdmitWebSocketConnection(currentConnections, limit = WS_CONNECTION_LIMIT) {
  return Number.isSafeInteger(currentConnections)
    && Number.isSafeInteger(limit)
    && limit > 0
    && currentConnections < limit;
}

export function shouldCloseUnjoinedConnection({ connectedAtMs, nowMs, playerId } = {}) {
  return !playerId
    && Number.isFinite(connectedAtMs)
    && Number.isFinite(nowMs)
    && nowMs - connectedAtMs >= WS_JOIN_DEADLINE_MS;
}

export function resolveHeroId(candidate, heroById, fallbackId) {
  if (typeof candidate !== 'string') return fallbackId;
  return Object.hasOwn(heroById, candidate) ? candidate : fallbackId;
}

const BOOLEAN_INPUT_FIELDS = Object.freeze([
  'f', 'b', 'l', 'r', 'jump', 'crouch', 'fire', 'reload',
  'secondary', 'ability1', 'ability2', 'ultimate',
]);

export function sanitizeInput(payload, lastAcceptedSeq = -1) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, code: 'invalid_input' };
  }
  const input = {};
  for (const field of BOOLEAN_INPUT_FIELDS) {
    if (Object.hasOwn(payload, field) && typeof payload[field] !== 'boolean') {
      return { ok: false, code: 'invalid_input' };
    }
    input[field] = payload[field] ?? false;
  }
  for (const field of ['moveX', 'moveY']) {
    if (
      Object.hasOwn(payload, field)
      && (!Number.isFinite(payload[field]) || payload[field] < -1 || payload[field] > 1)
    ) return { ok: false, code: 'invalid_input' };
    input[field] = payload[field] ?? null;
  }
  if (!Number.isFinite(payload.yaw) || Math.abs(payload.yaw) > Math.PI * 2) {
    return { ok: false, code: 'invalid_input' };
  }
  if (!Number.isFinite(payload.pitch) || Math.abs(payload.pitch) > 1.55) {
    return { ok: false, code: 'invalid_input' };
  }
  if (!Number.isSafeInteger(payload.seq) || payload.seq < 1) {
    return { ok: false, code: 'invalid_input' };
  }
  if (!Number.isSafeInteger(payload.interpMs) || payload.interpMs < 0 || payload.interpMs > 220) {
    return { ok: false, code: 'invalid_input' };
  }
  if (payload.seq <= lastAcceptedSeq) return { ok: false, code: 'stale_input' };
  input.yaw = payload.yaw;
  input.pitch = payload.pitch;
  input.seq = payload.seq;
  input.interpMs = payload.interpMs;
  return { ok: true, input };
}

export function receiveInputCommand(world, conn, payload, receivedAtMs) {
  // Sequence ordering belongs to World so a small out-of-order delivery window
  // can recover a late lower sequence without weakening payload validation.
  const result = sanitizeInput(payload);
  if (!result.ok) {
    world?.noteInputRejection?.(result.code);
    return result;
  }
  if (!conn?.playerId || typeof world?.queueInputResult !== 'function') {
    world?.noteInputRejection?.('invalid_input');
    return { ok: false, code: 'invalid_input' };
  }
  // Keep the submitted interpMs for protocol compatibility, but only pass a
  // server-observed, hard-capped value to simulation.
  result.input.appliedRewindMs = conn.lagCompensation?.apply?.(result.input.interpMs) ?? 0;
  const queued = world.queueInputResult(conn.playerId, result.input, receivedAtMs);
  if (!queued.ok) return queued;
  conn.lastAcceptedInputSeq = Math.max(conn.lastAcceptedInputSeq ?? 0, result.input.seq);
  return { ok: true, input: result.input };
}

export function isOpenSocket(socket) {
  return socket?.readyState === 1;
}

export function connectedTeamCounts(players, sockets) {
  const counts = [0, 0];
  for (const [playerId, socket] of sockets) {
    if (!isOpenSocket(socket)) continue;
    const player = players.get(playerId);
    if (player && (player.team === 0 || player.team === 1)) counts[player.team]++;
  }
  return counts;
}

export function chooseJoinTeam(connectedCounts, claimableSlots, teamSize) {
  if (!Array.isArray(connectedCounts) || !Array.isArray(claimableSlots) || teamSize <= 0) return -1;
  const candidates = [0, 1].filter(team => (
    Number.isInteger(connectedCounts[team])
    && connectedCounts[team] >= 0
    && connectedCounts[team] < teamSize
    && claimableSlots[team] === true
  ));
  if (candidates.length === 0) return -1;
  return candidates.sort((a, b) => connectedCounts[a] - connectedCounts[b] || a - b)[0];
}

export function canSendSnapshot(socket, maxBufferedBytes) {
  return isOpenSocket(socket)
    && Number.isFinite(socket.bufferedAmount)
    && socket.bufferedAmount <= maxBufferedBytes;
}

export function canSelectHero(matchState, isAlive, isRespawnPending) {
  return matchState === 'SETUP'
    || (matchState === 'ACTIVE' && !isAlive && isRespawnPending);
}
