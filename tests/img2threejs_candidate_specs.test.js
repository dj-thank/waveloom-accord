import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve('work/asset-rush/aaa-v1-pilot');

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function linkedKeys(spec) {
  const keys = new Set();
  for (const component of spec.componentTree) {
    keys.add(component.id);
    for (const feature of component.localFeatures ?? []) {
      const id = typeof feature === 'string' ? feature : feature.id;
      if (id) {
        keys.add(id);
        keys.add(`${component.id}/${id}`);
      }
    }
  }
  for (const material of spec.materials) {
    keys.add(material.id);
    for (const override of material.localOverrides ?? []) {
      keys.add(override.id);
      keys.add(`${material.id}/${override.id}`);
    }
  }
  return keys;
}

test('new image-to-Three.js candidates have authored strict-depth contracts and stay candidate-only', async () => {
  const manifest = await json('manifest.json');
  for (const assetId of ['prop-market-awning-01', 'prop-roof-finial-01']) {
    const asset = manifest.assets.find(item => item.assetId === assetId);
    assert.ok(asset, assetId);
    assert.match(asset.candidateState, /strict-spec-authored/);
    assert.equal(asset.adoptionState, 'candidate');
    const spec = await json(asset.sculptSpec);
    const inventory = await json(asset.detailInventory);
    assert.equal(spec.candidateStatus.admission, 'NOT_RUNTIME_ADMITTED');
    assert.equal(spec.sculptPipeline.currentPass, 'blockout');
    assert.ok(spec.componentTree.length >= 8);
    assert.ok(spec.materials.length >= 3);
    assert.ok(spec.repetitionSystems.length >= 2);
    assert.ok(spec.preSpecAssessment.detailInventory.details.length >= 6);
    assert.equal(inventory.detailInventory.details.length, spec.preSpecAssessment.detailInventory.details.length);
    const keys = linkedKeys(spec);
    for (const detail of spec.preSpecAssessment.detailInventory.details) {
      assert.ok(keys.has(detail.mapsTo.ref), `${assetId} detail link ${detail.mapsTo.ref}`);
    }
    for (const material of spec.materials) {
      assert.equal(material.referencePbr.usable, true, `${assetId}/${material.id}`);
      assert.ok(material.referencePbr.confidence >= 0.7, `${assetId}/${material.id}`);
      assert.ok(material.ambientOcclusion?.map, `${assetId}/${material.id} AO map`);
    }
  }
});
