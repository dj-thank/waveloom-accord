import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ReusableEffectPool } from '../client/bounded_pool.js';
import { PerformanceBudget, QUALITY_PROFILES } from '../client/performance_budget.js';

test('high quality uses the 1080p p95 frame-time acceptance threshold', () => {
  assert.equal(QUALITY_PROFILES.high.targetFrameMs, 16.7);
  assert.equal(QUALITY_PROFILES.low.targetFrameMs, 33.34);
});

test('reusable effect pool caps active slots without shifting or reallocating', () => {
  let created = 0;
  const released = [];
  const pool = new ReusableEffectPool(3, () => ({ id: ++created }), item => released.push(item.id));
  const first = pool.acquire();
  pool.acquire();
  pool.acquire();
  const reused = pool.acquire();

  assert.equal(created, 3);
  assert.equal(pool.active.length, 3);
  assert.equal(reused, first);
  assert.deepEqual(released, [first.id]);
  assert.equal(pool.peak, 3);
});

test('quality budget降格時のacquireはactiveを新budgetまで即座に縮小する', () => {
  const released = [];
  const pool = new ReusableEffectPool(5, index => ({ id: index }), item => released.push(item.id));
  for (let index = 0; index < 5; index++) pool.acquire();

  pool.acquire(2);
  assert.equal(pool.active.length, 2);
  assert.equal(released.length, 4);

  assert.equal(pool.acquire(0), null);
  assert.equal(pool.active.length, 0);
  assert.equal(released.length, 6);
});

test('swap removal後もoverflow evictionはacquire sequenceの古い順を守る', () => {
  const released = [];
  const pool = new ReusableEffectPool(3, index => ({ id: index }), item => released.push(item));
  const first = pool.acquire();
  const second = pool.acquire();
  pool.acquire();

  pool.acquire();
  pool.acquire();

  assert.deepEqual(released, [first, second]);
});

test('quality budget reports immutable rolling percentiles and falls back deterministically', () => {
  const budget = new PerformanceBudget({ quality: 'high', sampleSize: 8, fallbackMinSamples: 5 });
  for (let index = 0; index < 4; index++) assert.equal(budget.recordFrameMs(40), null);
  assert.equal(budget.recordFrameMs(40), 'medium');

  const snapshot = budget.snapshot({
    rendererInfo: { render: { calls: 12 } },
    pools: { particles: { active: 41, capacity: 420, peak: 78 } },
  });
  assert.equal(snapshot.quality, 'medium');
  assert.equal(snapshot.frameMs.p95, 40);
  assert.equal(snapshot.frameMs.p99, 40);
  assert.equal(snapshot.frameMs.max, 40);
  assert.equal(snapshot.pools.particles.capacity, 420);
  assert.ok(Object.isFrozen(snapshot));
  assert.ok(Object.isFrozen(snapshot.frameMs));
  assert.throws(() => { snapshot.quality = 'low'; }, TypeError);
});
