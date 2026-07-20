import assert from 'node:assert/strict';
import test from 'node:test';

import { requestedAssets, shouldRetryElevenLabs } from '../tools/generate_elevenlabs_assets.js';

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
