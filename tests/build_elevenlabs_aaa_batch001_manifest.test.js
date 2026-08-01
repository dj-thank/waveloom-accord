import assert from 'node:assert/strict';
import test from 'node:test';
import { buildManifest } from '../tools/build_elevenlabs_aaa_batch001_manifest.js';
import { validateManifest } from '../tools/elevenlabs_audio_factory.js';

test('AAA Batch 001 is a 100-slot original SFX catalogue with enforceable per-wave cost and family boundaries', () => {
  const manifest = buildManifest();
  const validation = validateManifest(manifest, { outputRoot: process.cwd() });
  assert.equal(manifest.wave, 'aaa-batch-001');
  assert.equal(manifest.assets.length, 100);
  assert.equal(validation.planned, 100);
  assert.equal(validation.estimatedCredits, manifest.executionBudget.maxEstimatedCredits);
  assert.deepEqual(Object.fromEntries(['weapon', 'ability', 'ui', 'objective', 'movement'].map(family => [family, manifest.assets.filter(asset => asset.family === family).length])), { weapon: 40, ability: 24, ui: 20, objective: 8, movement: 8 });
  assert.ok(manifest.assets.every(asset => asset.request.text.length <= 450));
  assert.ok(manifest.assets.every(asset => /no speech, music, real person, existing ip, artist, song, or brand reference/i.test(asset.request.text)));
  assert.equal(new Set(manifest.assets.map(asset => asset.id)).size, 100);
  assert.equal(new Set(manifest.assets.map(asset => asset.output)).size, 100);
});
