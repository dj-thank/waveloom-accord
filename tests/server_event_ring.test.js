import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEventRing, appendEventRing, readEventRing, eventRingHealth,
  eventDeliveryHealth,
} from '../server/event_ring.js';

test('event cursors retry after backpressure and advance exactly once after delivery', () => {
  const empty = createEventRing({ capacity: 8, ttlMs: 5_000, maxBatch: 8 });
  const ring = appendEventRing(empty, [{ type: 'hit' }, { type: 'kill' }], 100);
  assert.equal(empty.entries.length, 0, 'append is pure');

  const firstAttempt = readEventRing(ring, 0);
  assert.deepEqual(firstAttempt.events, [{ type: 'hit' }, { type: 'kill' }]);
  assert.deepEqual(readEventRing(ring, 0), firstAttempt, 'an uncommitted cursor retries the same events');
  assert.deepEqual(readEventRing(ring, firstAttempt.nextCursor).events, []);
});

test('event ring capacity overflow requires an explicit latest-state resync', () => {
  let ring = createEventRing({ capacity: 3, ttlMs: 5_000, maxBatch: 3 });
  ring = appendEventRing(ring, [
    { type: 'e1' }, { type: 'e2' }, { type: 'e3' }, { type: 'e4' }, { type: 'e5' },
  ], 100);

  assert.deepEqual(readEventRing(ring, 0), {
    kind: 'resync', events: [], nextCursor: 5, dropped: 5, remaining: 0,
    reason: 'retention_overflow',
  });
  assert.deepEqual(eventRingHealth(ring), {
    retained: 3, capacity: 3, ttlMs: 5_000, maxBatch: 3,
    oldestSeq: 3, latestSeq: 5,
  });
});

test('event ring TTL overflow resyncs and a null cursor baselines pre-join events', () => {
  let ring = createEventRing({ capacity: 8, ttlMs: 100, maxBatch: 8 });
  ring = appendEventRing(ring, [{ type: 'before_join' }], 0);
  const baseline = readEventRing(ring, null);
  assert.equal(baseline.kind, 'baseline');
  assert.equal(baseline.nextCursor, 1);
  ring = appendEventRing(ring, [{ type: 'after_join' }], 50);
  assert.deepEqual(readEventRing(ring, baseline.nextCursor).events, [{ type: 'after_join' }]);

  ring = appendEventRing(ring, [], 151);
  assert.deepEqual(readEventRing(ring, 0), {
    kind: 'resync', events: [], nextCursor: 2, dropped: 2, remaining: 0,
    reason: 'retention_overflow',
  });
});

test('event ring bounds catch-up batches without reordering', () => {
  let ring = createEventRing({ capacity: 8, ttlMs: 5_000, maxBatch: 2 });
  ring = appendEventRing(ring, [{ n: 1 }, { n: 2 }, { n: 3 }], 1);
  const first = readEventRing(ring, 0);
  const second = readEventRing(ring, first.nextCursor);
  assert.deepEqual(first.events, [{ n: 1 }, { n: 2 }]);
  assert.equal(first.remaining, 1);
  assert.deepEqual(second.events, [{ n: 3 }]);
  assert.equal(second.remaining, 0);
});

test('event delivery health counts lag only for joined connections', () => {
  let ring = createEventRing({ capacity: 8, ttlMs: 5_000, maxBatch: 8 });
  ring = appendEventRing(ring, [{ n: 1 }, { n: 2 }, { n: 3 }], 1);
  const connections = new Map([
    [{}, { playerId: null, eventCursor: 0 }],
    [{}, { playerId: 'p1', eventCursor: 1 }],
    [{}, { playerId: 'p2', eventCursor: 3 }],
  ]);
  assert.deepEqual(eventDeliveryHealth(ring, connections, {
    backpressureSkips: 4, sendFailures: 1, overflowResyncs: 2, droppedDeliveries: 7,
  }), {
    retained: 3, capacity: 8, ttlMs: 5_000, maxBatch: 8,
    oldestSeq: 1, latestSeq: 3,
    laggingConnections: 1, maxLagEvents: 2,
    backpressureSkips: 4, sendFailures: 1, overflowResyncs: 2, droppedDeliveries: 7,
  });
});
