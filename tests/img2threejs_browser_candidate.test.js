import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('outputs');

test('new img2threejs previews have browser candidate evidence within authored budgets', async () => {
  const evidence = JSON.parse(await readFile(path.join(root, 'aaa_img2threejs_browser_evidence_20260801.json'), 'utf8'));
  assert.equal(evidence.browser.webgl, true);
  assert.equal(evidence.browser.consoleErrors, 0);
  assert.equal(evidence.assets.length, 2);
  for (const asset of evidence.assets) {
    assert.equal(asset.metrics.candidateOnly, true, asset.assetId);
    assert.equal(asset.metrics.collision, 'none', asset.assetId);
    assert.ok(asset.metrics.assetTriangles <= asset.metrics.triangleBudget, asset.assetId);
    assert.ok(asset.metrics.assetDrawCalls <= asset.metrics.drawCallBudget, asset.assetId);
    assert.equal(asset.screenshots.length, 4, asset.assetId);
    for (const screenshot of asset.screenshots) {
      const bytes = await readFile(path.resolve(screenshot.path));
      assert.equal(bytes.length, screenshot.bytes, `${asset.assetId}/${screenshot.view}`);
      assert.match(screenshot.sha256, /^[A-F0-9]{64}$/);
    }
  }
});
