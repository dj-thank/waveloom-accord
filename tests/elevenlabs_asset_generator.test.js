import assert from 'node:assert/strict';
import test from 'node:test';

import {
  mapConcurrent,
  requestedAssets,
  runCli,
  shouldRetryElevenLabs,
} from '../tools/generate_elevenlabs_assets.js';

test('ElevenLabs SSOT request set is complete, unique, and within the API text limit', () => {
  const assets = requestedAssets(null);
  assert.equal(assets.length, 90, '18 weapon sounds + 72 action sounds');
  assert.equal(new Set(assets.map(asset => `${asset.kind}:${asset.id}`)).size, 90);

  const overLimit = assets
    .filter(asset => asset.prompt.length > 450)
    .map(asset => ({ id: asset.id, length: asset.prompt.length }));
  assert.deepEqual(overLimit, [], `prompts exceed ElevenLabs' 450-character limit: ${JSON.stringify(overLimit)}`);
});

test('quota exhaustion and client errors fail fast while transient API errors retry', () => {
  assert.equal(shouldRetryElevenLabs(429, '{"detail":{"status":"quota_exceeded"}}'), false);
  assert.equal(shouldRetryElevenLabs(429, '{"detail":{"status":"rate_limited"}}'), true);
  assert.equal(shouldRetryElevenLabs(503, 'temporarily unavailable'), true);
  assert.equal(shouldRetryElevenLabs(401, 'invalid key'), false);
  assert.equal(shouldRetryElevenLabs(422, 'invalid request'), false);
});

test('fatal concurrent generation stops scheduling and drains in-flight work before rejecting', async () => {
  const started = [];
  let markSlowStarted;
  let releaseSlow;
  const slowStarted = new Promise(resolve => { markSlowStarted = resolve; });
  const slowRelease = new Promise(resolve => { releaseSlow = resolve; });
  let settled = false;

  const run = mapConcurrent(['fatal', 'slow', 'must-not-start'], 2, async item => {
    started.push(item);
    if (item === 'fatal') {
      await slowStarted;
      throw new Error('quota exhausted');
    }
    if (item === 'slow') {
      markSlowStarted();
      await slowRelease;
    }
  });
  run.then(
    () => { settled = true; },
    () => { settled = true; },
  );

  await slowStarted;
  await new Promise(resolve => setImmediate(resolve));
  const rejectedBeforeInflightSettled = settled;
  releaseSlow();

  await assert.rejects(run, /quota exhausted/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(rejectedBeforeInflightSettled, false, 'fatal error must be reported only after sibling workers settle');
  assert.deepEqual(started, ['fatal', 'slow'], 'fatal error must prevent all later work from being scheduled');
});

test('fatal concurrent generation aborts sibling workers and preserves the first error', async () => {
  let markSlowStarted;
  const slowStarted = new Promise(resolve => { markSlowStarted = resolve; });
  let siblingAborted = false;

  const run = mapConcurrent(['fatal', 'slow'], 2, async (item, signal) => {
    if (item === 'fatal') {
      await slowStarted;
      throw new Error('quota exhausted');
    }
    markSlowStarted();
    await new Promise(resolve => {
      signal.addEventListener('abort', () => {
        siblingAborted = true;
        resolve();
      }, { once: true });
    });
  });

  await assert.rejects(run, /quota exhausted/);
  assert.equal(siblingAborted, true);
});

test('CLI converts a generation failure into a controlled exit code without an unhandled rejection', async () => {
  const errors = [];
  const exitCode = await runCli(
    async () => { throw new Error('quota exhausted'); },
    message => errors.push(message),
  );

  assert.equal(exitCode, 1);
  assert.deepEqual(errors, ['ElevenLabs generation failed: quota exhausted']);
});
