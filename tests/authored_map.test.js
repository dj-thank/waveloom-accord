import { createHash } from 'node:crypto';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTHORED_MAP_TRANSFORM, buildMap, verifyAuthoredAssetIdentity } from '../shared/data/map_oshioi.js';
import { AUTHORED_COLLISION_MANIFEST } from '../shared/data/map_oshioi_authored_collision.js';

const EXPECTED_SHA256 = 'DC9017A5F1D875B7CB45C00183E158491FAE042F6A33CE8EC42FCA8D9CA2E597';

test('提供GLBを改変せず同梱し、CC BY 4.0クレジットを保持する', () => {
  const asset = readFileSync(new URL('../client/assets/chicken_gun_fruzer_mine.glb', import.meta.url));
  const license = readFileSync(new URL('../client/assets/chicken_gun_fruzer_mine.LICENSE.txt', import.meta.url), 'utf8');
  assert.equal(asset.subarray(0, 4).toString('ascii'), 'glTF');
  assert.equal(createHash('sha256').update(asset).digest('hex').toUpperCase(), EXPECTED_SHA256);
  assert.match(license, /amogusstrikesback2/);
  assert.match(license, /CC BY 4\.0/);
});

test('ブラウザは提供GLBをGLTFLoaderで読み込み、失敗時もゲームを継続する', () => {
  const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const render = readFileSync(new URL('../client/render.js', import.meta.url), 'utf8');
  const serverStatic = readFileSync(new URL('../server/static.js', import.meta.url), 'utf8');
  assert.match(html, /type="importmap"/);
  assert.match(render, /GLTFLoader/);
  const map = buildMap();
  assert.equal(map.visualAsset.url, '/client/assets/chicken_gun_fruzer_mine.glb');
  assert.equal(map.visualAsset.collisionModel, 'decorative-only');
  assert.equal(map.visualAsset.collision, false);
  assert.equal(map.visualAsset.displayMode, 'verified-reference-hidden');
  assert.ok(map.decorations.some(decoration =>
    decoration.id === map.visualAsset.id && decoration.collision === false));
  assert.match(render, /_setAuthoredMapStatus\('loaded'/);
  assert.match(render, /_setAuthoredMapStatus\('fallback'/);
  assert.match(serverStatic, /\/vendor\/addons\//);
});

test('authored GLB transform is pinned for decorative rendering and identity verification', () => {
  const map = buildMap();
  const bounds = AUTHORED_MAP_TRANSFORM.sourceBounds;
  const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
  const center = bounds.min.map((value, axis) => value + size[axis] / 2);
  const expectedScale = (AUTHORED_MAP_TRANSFORM.fit.mapWidthM / size[0]) * AUTHORED_MAP_TRANSFORM.fit.ratio;
  const expectedTerrain = bounds.min[1] + size[1] * AUTHORED_MAP_TRANSFORM.terrain.planeRatio;
  const expectedPosition = [-center[0] * expectedScale, -expectedTerrain * expectedScale, -center[2] * expectedScale];

  assert.ok(Math.abs(AUTHORED_MAP_TRANSFORM.scale - expectedScale) < 1e-12);
  assert.ok(Math.abs(AUTHORED_MAP_TRANSFORM.terrain.plane - expectedTerrain) < 1e-12);
  expectedPosition.forEach((value, axis) => {
    assert.ok(Math.abs(AUTHORED_MAP_TRANSFORM.scenePosition[axis] - value) < 1e-12);
  });
  assert.deepEqual(map.visualAsset.transform, AUTHORED_MAP_TRANSFORM);
  assert.deepEqual(AUTHORED_COLLISION_MANIFEST.transform, AUTHORED_MAP_TRANSFORM);
  assert.equal(AUTHORED_COLLISION_MANIFEST.assetSha256, EXPECTED_SHA256);
  assert.equal(map.visualAsset.sha256, AUTHORED_COLLISION_MANIFEST.assetSha256);
  assert.deepEqual(map.visualAsset.collisionManifest, {
    schemaVersion: AUTHORED_COLLISION_MANIFEST.schemaVersion,
    hash: AUTHORED_COLLISION_MANIFEST.manifestHash,
  });

  const render = readFileSync(new URL('../client/render.js', import.meta.url), 'utf8');
  assert.match(render, /asset\.transform/);
  assert.doesNotMatch(render, /canonicalMapPresentation\.visible\s*=\s*false/);
  assert.doesNotMatch(render, /this\._disposeCanonicalMapPresentation\(\)/);
  assert.match(render, /verifyAuthoredAssetIdentity\(bytes, asset\)/);
  assert.match(render, /loader\.parseAsync\(bytes, resourcePath\)/);
});

test('authored bytes and manifest identity are verified fail-closed before parsing', async () => {
  const map = buildMap();
  const bytes = readFileSync(new URL('../client/assets/chicken_gun_fruzer_mine.glb', import.meta.url));
  const digest = webcrypto.subtle.digest.bind(webcrypto.subtle);
  const verified = await verifyAuthoredAssetIdentity(bytes, map.visualAsset, digest);
  assert.equal(verified.assetSha256, EXPECTED_SHA256);
  assert.equal(verified.manifestHash, AUTHORED_COLLISION_MANIFEST.manifestHash);

  const tampered = Buffer.from(bytes);
  tampered[tampered.length - 1] ^= 1;
  await assert.rejects(verifyAuthoredAssetIdentity(tampered, map.visualAsset, digest), /SHA-256 mismatch/);
  await assert.rejects(
    verifyAuthoredAssetIdentity(bytes, { ...map.visualAsset, collisionManifest: { ...map.visualAsset.collisionManifest, hash: '0'.repeat(64) } }, digest),
    /metadata does not match/,
  );
  await assert.rejects(verifyAuthoredAssetIdentity(bytes, map.visualAsset, false), /verification is unavailable/);
});
