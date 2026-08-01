import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildImpairedSchedule } from '../tools/ws_impairment_smoke.js';

test('impaired schedule is deterministic and covers required matrix', () => {
  const a = buildImpairedSchedule({ seed: 42, clients: 10, ticks: 30 });
  const b = buildImpairedSchedule({ seed: 42, clients: 10, ticks: 30 });
  assert.deepEqual(a, b);
  assert.deepEqual([...new Set(a.map(x => x.jitterMs))], [20, 100]);
  assert.deepEqual([...new Set(a.map(x => x.lossPercent))], [1, 5, 10]);
  assert.equal(a.length, 6);
  assert.ok(a.every(x => x.sent === 300));
  assert.ok(a.every(x => x.dropped > 0));
  assert.ok(a.every(x => x.delivered + x.dropped === x.sent));
  assert.ok(a.every(x => x.packets.every(packet => packet.delayMs >= 0)));
  assert.ok(a.some(x => x.reordered > 0));
  assert.ok(a.some(x => x.clumps > 0));
});
