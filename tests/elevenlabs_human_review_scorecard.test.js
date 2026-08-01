import assert from 'node:assert/strict';
import test from 'node:test';
import { csvCell } from '../tools/build_elevenlabs_human_review_scorecard.js';

test('human listening scorecard quotes commas and quotes without changing candidate metadata', () => {
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
