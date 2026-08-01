import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest } from '../tools/build_elevenlabs_aaa_pilot002_manifest.js';
import { validateManifest } from '../tools/elevenlabs_audio_factory.js';

test('AAA pilot 002 fills the non-weapon audio gaps with a bounded, original, candidate-only request set', () => {
  const manifest = buildManifest();
  const validation = validateManifest(manifest, { outputRoot: process.cwd() });
  assert.equal(manifest.wave, 'aaa-pilot-002');
  assert.equal(manifest.assets.length, 24);
  assert.equal(validation.planned, 24);
  assert.equal(validation.estimatedCredits, manifest.executionBudget.maxEstimatedCredits);
  assert.deepEqual([...new Set(manifest.assets.map(asset => asset.family))].sort(), ['ambient', 'foley', 'movement', 'objective', 'ui']);
  assert.ok(manifest.assets.every(asset => asset.endpoint === '/v1/sound-generation?output_format=mp3_44100_192'));
  assert.ok(manifest.assets.every(asset => asset.request.model_id === 'eleven_text_to_sound_v2'));
  assert.ok(manifest.assets.every(asset => asset.candidateStatus === 'pending_technical_qc'));
  assert.ok(manifest.assets.every(asset => /no real person, existing IP, artist, song, or brand reference/i.test(asset.request.text)));
});
