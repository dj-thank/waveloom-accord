function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

export function createEventRing({ capacity = 4_096, ttlMs = 5_000, maxBatch = 256 } = {}) {
  return {
    capacity: positiveInteger(capacity, 4_096),
    ttlMs: positiveInteger(ttlMs, 5_000),
    maxBatch: positiveInteger(maxBatch, 256),
    nextSeq: 1,
    entries: [],
  };
}

export function appendEventRing(ring, events, nowMs) {
  if (!ring || !Array.isArray(ring.entries) || !Number.isFinite(nowMs)) {
    throw new TypeError('event ring and monotonic time are required');
  }
  const retained = ring.entries.filter(entry => nowMs - entry.atMs <= ring.ttlMs);
  let nextSeq = ring.nextSeq;
  for (const event of Array.isArray(events) ? events : []) {
    retained.push({ seq: nextSeq++, atMs: nowMs, event });
  }
  return {
    ...ring,
    nextSeq,
    entries: retained.length > ring.capacity ? retained.slice(-ring.capacity) : retained,
  };
}

export function readEventRing(ring, cursor) {
  if (!ring || !Array.isArray(ring.entries)) throw new TypeError('event ring is required');
  const latestSeq = ring.nextSeq - 1;
  if (cursor === null) {
    return {
      kind: 'baseline', events: [], nextCursor: latestSeq, dropped: 0, remaining: 0,
    };
  }
  const safeCursor = Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : 0;
  const oldestSeq = ring.entries[0]?.seq ?? ring.nextSeq;
  if (safeCursor < oldestSeq - 1) {
    return {
      kind: 'resync', events: [], nextCursor: latestSeq,
      dropped: Math.max(0, latestSeq - safeCursor), remaining: 0,
      reason: 'retention_overflow',
    };
  }
  const available = ring.entries.filter(entry => entry.seq > safeCursor);
  const batch = available.slice(0, ring.maxBatch);
  return {
    kind: 'events',
    events: batch.map(entry => entry.event),
    nextCursor: batch.at(-1)?.seq ?? safeCursor,
    dropped: 0,
    remaining: Math.max(0, available.length - batch.length),
  };
}

export function eventRingHealth(ring) {
  return {
    retained: ring.entries.length,
    capacity: ring.capacity,
    ttlMs: ring.ttlMs,
    maxBatch: ring.maxBatch,
    oldestSeq: ring.entries[0]?.seq ?? null,
    latestSeq: ring.nextSeq > 1 ? ring.nextSeq - 1 : null,
  };
}

export function eventDeliveryHealth(ring, connections, counters = {}) {
  const latestSeq = ring.nextSeq - 1;
  const lags = connections && typeof connections.values === 'function'
    ? [...connections.values()]
      .filter(connection => connection?.playerId)
      .map(connection => Math.max(0, latestSeq - (connection.eventCursor ?? latestSeq)))
    : [];
  return {
    ...eventRingHealth(ring),
    laggingConnections: lags.filter(lag => lag > 0).length,
    maxLagEvents: lags.length > 0 ? Math.max(...lags) : 0,
    backpressureSkips: Math.max(0, counters.backpressureSkips || 0),
    sendFailures: Math.max(0, counters.sendFailures || 0),
    overflowResyncs: Math.max(0, counters.overflowResyncs || 0),
    droppedDeliveries: Math.max(0, counters.droppedDeliveries || 0),
  };
}
