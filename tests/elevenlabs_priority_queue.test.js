import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPriorityQueue, parseCsvRow, parseScorecardCsv } from '../tools/build_elevenlabs_priority_queue.js';

test('priority queue parses quoted scorecard fields and orders unsafe candidates first', () => {
  assert.deepEqual(parseCsvRow('"a,""b""",c'), ['a,"b"', 'c']);
  const scorecard = parseScorecardCsv('candidate_id,review_priority,automated_flag\n"z",P2,"x,y"\n"a",P1,');
  const queue = buildPriorityQueue({ candidateOnly: true, results: [
    { candidateId: 'z', disposition: 'NORMAL_LISTENING_QUEUE', reviewPriority: 'P2', decode: 'pass', rawCandidateFile: 'z.mp3', metrics: { durationSec: 1 } },
    { candidateId: 'a', disposition: 'REJECT_OR_REGENERATE_REVIEW', reviewPriority: 'P1', decode: 'fail', flags: ['decode_failed'], rawCandidateFile: 'a.mp3' },
  ] }, scorecard);
  assert.deepEqual(queue.rows.map(row => row.candidate_id), ['a', 'z']);
  assert.equal(queue.rows[0].candidate_only, true);
  assert.equal(queue.rows[0].admission, 'NOT_RUNTIME_ADMITTED');
  assert.equal(queue.rows[0].human_decision, '');
  assert.deepEqual(queue.counts, { total: 2, REJECT_OR_REGENERATE_REVIEW: 1, NORMAL_LISTENING_QUEUE: 1 });
});

test('priority queue fails closed for non-candidate triage reports', () => {
  assert.throws(() => buildPriorityQueue({ candidateOnly: false, results: [] }), /candidate-only/);
});
