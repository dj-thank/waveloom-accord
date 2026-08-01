import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeSideBalance } from '../shared/telemetry/side_balance.js';

test('side-balance audit counts physical-side wins across BO3 swaps and flags a severe skew', () => {
  const result = summarizeSideBalance([
    {
      matchWinner: 0,
      rounds: [
        { round: 1, winner: 0, sides: ['east', 'west'] },
        { round: 2, winner: 1, sides: ['west', 'east'] },
      ],
    },
    {
      matchWinner: 1,
      rounds: [
        { round: 1, winner: 1, sides: ['west', 'east'] },
        { round: 2, winner: 0, sides: ['east', 'west'] },
      ],
    },
  ]);

  assert.deepEqual(result.sideWins, { east: 4, west: 0 });
  assert.equal(result.completedBo3, 2);
  assert.deepEqual(result.roundTwoSwap, { expected: 2, observed: 2, rate: 1 });
  assert.equal(result.severeBiasDetected, true);
  assert.equal(result.verdict, 'severe_side_bias_detected');
});
