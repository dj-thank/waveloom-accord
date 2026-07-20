import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addGauge,
  gainFromDamage,
  gainFromHealing,
  gainFromPassive,
  spendGauge,
  refundGauge,
  carryoverGauge,
  summarizeUltimateUses,
} from '../shared/sim/ult_economy.js';

const cfg = { gaugeMax: 100, damagePerGauge: 50, healingPerGauge: 40, passiveGaugePerSec: 2, carryoverMult: 0.5 };
test('ultimate economy converts active damage and healing deterministically', () => {
  assert.equal(gainFromDamage(500, cfg), 10);
  assert.equal(gainFromHealing(400, cfg), 10);
  assert.equal(gainFromPassive(10, cfg), 20);
  assert.equal(gainFromPassive(-10, cfg), 0);
  assert.equal(addGauge(95, 20, cfg), 100);
  assert.equal(addGauge(5, -2, cfg), 5);
});
test('ultimate economy spend, refund and round carryover are capped', () => {
  assert.deepEqual(spendGauge(100, 100, cfg), { ok: true, gauge: 0, paid: 100 });
  assert.equal(spendGauge(99, 100, cfg).ok, false);
  assert.equal(refundGauge(0, 100, 0.5, cfg), 50);
  assert.equal(carryoverGauge(100, cfg), 50);
});

test('ultimate match summaries expose average, median, outliers and zero-use rate', () => {
  assert.deepEqual(summarizeUltimateUses([
    { p1: { uses: 2 }, p2: { uses: 3 } },
    { p1: { uses: 4 }, p2: { uses: 3 } },
  ]), {
    playerMatches: 4,
    averageUses: 3,
    medianUses: 3,
    minUses: 2,
    maxUses: 4,
    zeroUseRate: 0,
  });
});
