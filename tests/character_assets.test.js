import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_RIG_ANIMATIONS, HERO_RIG_ASSET } from '../shared/data/character_assets.js';

function localPath(runtimeUrl) {
  assert.match(runtimeUrl, /^\/client\/assets\/generated\/characters\//);
  return new URL(`..${runtimeUrl}`, import.meta.url);
}

test('character rig SSOT pins the admitted GLB, rights, and animation aliases', () => {
  assert.ok(Object.isFrozen(HERO_RIG_ASSET));
  assert.ok(Object.isFrozen(HERO_RIG_ASSET.animations));
  assert.equal(HERO_RIG_ANIMATIONS, HERO_RIG_ASSET.animations);
  assert.equal(HERO_RIG_ASSET.contentType, 'model/gltf-binary');
  assert.ok(HERO_RIG_ASSET.maxBytes >= HERO_RIG_ASSET.bytes);
  assert.ok(HERO_RIG_ASSET.maxBytes <= 1024 * 1024);
  assert.match(HERO_RIG_ASSET.runtimeUrl,
    new RegExp(`\\.${HERO_RIG_ASSET.sha256.slice(0, 12)}\\.glb$`));
  assert.equal(HERO_RIG_ASSET.license, 'CC0 1.0');
  assert.equal(HERO_RIG_ASSET.authors.length, 2);

  const glb = readFileSync(localPath(HERO_RIG_ASSET.runtimeUrl));
  assert.equal(glb.subarray(0, 4).toString('ascii'), 'glTF');
  assert.equal(glb.byteLength, HERO_RIG_ASSET.bytes);
  assert.equal(createHash('sha256').update(glb).digest('hex'), HERO_RIG_ASSET.sha256);

  const jsonChunkLength = glb.readUInt32LE(12);
  assert.equal(glb.subarray(16, 20).toString('ascii'), 'JSON');
  const manifest = JSON.parse(glb.subarray(20, 20 + jsonChunkLength).toString('utf8').trim());
  const clipNames = new Set((manifest.animations || []).map(clip => clip.name));
  for (const [state, clip] of Object.entries(HERO_RIG_ANIMATIONS)) {
    assert.ok(clipNames.has(clip), `${state} maps to missing GLB clip ${clip}`);
  }

  const licenseUrl = new URL(`..${HERO_RIG_ASSET.licenseFile}`, import.meta.url);
  const license = readFileSync(licenseUrl, 'utf8');
  assert.match(license, /CC0 1\.0/);
  assert.match(license, new RegExp(HERO_RIG_ASSET.sha256, 'i'));
  assert.match(license, /Tomas Laulhe/);
  assert.match(license, /Don McCurdy/);
});
