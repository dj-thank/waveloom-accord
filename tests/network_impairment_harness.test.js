import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runHarness, stableEvidence } from '../tools/network_impairment_harness.js';

test('deterministic network impairment matrix covers rc5 seam', () => {
  const a = runHarness({ seed: 0x5eedc0de });
  const b = runHarness({ seed: 0x5eedc0de });
  assert.deepEqual(stableEvidence(a), stableEvidence(b));
  assert.equal(a.pass, true);
  assert.deepEqual([...new Set(a.matrix.map(x => x.baseDelayMs))], [0, 40, 100, 200]);
  assert.deepEqual([...new Set(a.matrix.map(x => x.inputRateHz))], [30, 60, 120]);
  assert.deepEqual([...new Set(a.matrix.map(x => x.jitterMs))], [20, 100]);
  assert.deepEqual([...new Set(a.matrix.map(x => x.lossPercent))], [1, 5, 10]);
  assert.equal(a.clients, 10);
  assert.ok(a.metrics.reordered > 0);
  assert.ok(a.metrics.clumps > 0);
  assert.ok(a.metrics.maxPositionError <= a.thresholds.maxPositionError);
  assert.ok(a.metrics.reconnects >= 1);
});
