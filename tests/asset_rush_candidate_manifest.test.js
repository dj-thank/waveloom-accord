import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('work/asset-rush/aaa-v1-pilot');
const manifestPath = path.join(root, 'manifest.json');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

test('asset-rush manifest preserves verified original reference provenance and candidate-only admission', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.adoptionPolicy.includes('candidate-only'), true);
  assert.ok(manifest.assets.length >= 9);
  assert.equal(new Set(manifest.assets.map(asset => asset.assetId)).size, manifest.assets.length);

  for (const asset of manifest.assets) {
    assert.equal(asset.adoptionState, 'candidate', asset.assetId);
    assert.equal(asset.sourceRoute, 'imagegen-reference-to-img2threejs', asset.assetId);
    const bytes = await readFile(path.join(root, asset.sourcePath));
    assert.equal(sha256(bytes), asset.sourceSha256, asset.assetId);
    assert.equal(bytes.length, asset.sourceBytes, asset.assetId);
  }

  for (const assetId of ['prop-market-awning-01', 'prop-roof-finial-01']) {
    const asset = manifest.assets.find(candidate => candidate.assetId === assetId);
    assert.ok(asset?.safetyPolicy, `${assetId} needs an explicit safety policy`);
    const policy = await readFile(path.join(root, asset.safetyPolicy), 'utf8');
    assert.match(policy, /candidate-only/);
    assert.match(policy, /Next gate/);
  }
});

test('Tide Marker records the two-call contract and browser-render candidate evidence without runtime admission', async () => {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const tide = manifest.assets.find(asset => asset.assetId === 'prop-tide-marker-01');
  assert.ok(tide);
  assert.equal(tide.blockoutStaticBudget.trianglesEstimate, 1156);
  assert.equal(tide.blockoutStaticBudget.drawCallsEstimate, 2);
  assert.equal(tide.blockoutStaticBudget.collision, 'none');
  assert.match(tide.blockoutStaticBudget.verdict, /BROWSER-RENDER-CANDIDATE-PASS/);
  assert.match(tide.blockoutStaticBudget.browserVerification, /WebGL=true/);
  assert.match(tide.candidateState, /Tier1-and-runtime-HOLD/);
});
