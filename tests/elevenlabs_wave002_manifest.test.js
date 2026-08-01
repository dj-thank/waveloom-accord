import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Wave 002 manifest is deterministic, bounded, and candidate-only', async () => {
  const manifest = JSON.parse(await readFile('outputs/audio-factory-20260801/manifests/aaa-wave-002.json', 'utf8'));
  assert.equal(manifest.wave, 'aaa-wave-002');
  assert.equal(manifest.assets.length, 100);
  assert.deepEqual(manifest.taxonomy, { ambience: 24, foley: 24, movement: 20, objective: 16, ability: 16 });
  assert.equal(manifest.executionBudget.maxAssets, 100);
  assert.equal(manifest.executionBudget.maxEstimatedCredits, 2400);
  const ids = new Set();
  const hashes = new Set();
  for (const asset of manifest.assets) {
    assert.equal(asset.kind, 'sound_effect');
    assert.equal(asset.candidateStatus, 'pending_technical_qc');
    assert.match(asset.id, /^aaa\.wave002\.sfx\./);
    assert.ok(!ids.has(asset.id));
    ids.add(asset.id);
    assert.ok(asset.request.text.length <= 450, asset.id);
    assert.ok(!/api[-_ ]?key|authorization|elevenlabs_api_key/i.test(asset.request.text));
    const request = JSON.stringify(asset.request);
    assert.ok(!hashes.has(request));
    hashes.add(request);
    assert.equal(asset.endpoint, '/v1/sound-generation?output_format=mp3_44100_192');
    assert.match(asset.output, /^generated\/wave002\/(ambience|foley|movement|objective|ability)\/[a-z0-9-]+-v001\.mp3$/);
  }
});
