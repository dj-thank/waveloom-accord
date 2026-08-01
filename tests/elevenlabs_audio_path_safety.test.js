import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { resolveAssetOutput } from '../tools/audit_elevenlabs_factory_batch.js';
import { resolveCandidateInput, resolveMasteredOutput } from '../tools/master_elevenlabs_sfx_candidates.js';

const rawRoot = path.resolve('work/path-safety/raw');
const masteredRoot = path.resolve('work/path-safety/mastered');

test('audio technical audit refuses manifest paths outside its declared raw root', () => {
  assert.equal(resolveAssetOutput(rawRoot, { id: 'safe', output: 'sfx/safe.mp3' }), path.join(rawRoot, 'sfx', 'safe.mp3'));
  assert.throws(() => resolveAssetOutput(rawRoot, { id: 'traversal', output: '../outside.mp3' }), /stay inside/i);
  assert.throws(() => resolveAssetOutput(rawRoot, { id: 'absolute', output: path.resolve('outside.mp3') }), /safe relative/i);
});

test('SFX mastering refuses traversal and keeps mastered derivatives under a dedicated folder', () => {
  assert.equal(resolveCandidateInput(rawRoot, { id: 'safe', output: 'sfx/safe.mp3' }), path.join(rawRoot, 'sfx', 'safe.mp3'));
  assert.equal(resolveMasteredOutput(masteredRoot, { id: 'safe', output: 'sfx/safe.mp3' }), path.join(masteredRoot, 'sfx', 'safe.mp3'));
  assert.throws(() => resolveCandidateInput(rawRoot, { id: 'traversal', output: '../outside.mp3' }), /stay inside/i);
  assert.throws(() => resolveMasteredOutput(masteredRoot, { id: 'traversal', output: '../outside.mp3' }), /stay inside/i);
});
