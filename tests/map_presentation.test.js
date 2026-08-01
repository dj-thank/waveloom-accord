import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/data/map_oshioi.js';
import { OSHIOI_PRESENTATION } from '../shared/data/map_oshioi_presentation.js';

function axisAlignedBounds(transform) {
  const [x, y, z] = transform.position;
  const [sx, sy, sz] = transform.scale;
  const [rx = 0, ry = 0, rz = 0] = transform.rotation || [];
  const rotate = ([px, py, pz]) => {
    const cx = Math.cos(rx), sxr = Math.sin(rx);
    const cy = Math.cos(ry), syr = Math.sin(ry);
    const cz = Math.cos(rz), szr = Math.sin(rz);
    const x1 = px;
    const y1 = py * cx - pz * sxr;
    const z1 = py * sxr + pz * cx;
    const x2 = x1 * cy + z1 * syr;
    const y2 = y1;
    const z2 = -x1 * syr + z1 * cy;
    return [x2 * cz - y2 * szr, x2 * szr + y2 * cz, z2];
  };
  const corners = [];
  for (const dx of [-sx / 2, sx / 2]) {
    for (const dy of [-sy / 2, sy / 2]) {
      for (const dz of [-sz / 2, sz / 2]) corners.push(rotate([dx, dy, dz]));
    }
  }
  return {
    min: [
      x + Math.min(...corners.map(corner => corner[0])),
      y + Math.min(...corners.map(corner => corner[1])),
      z + Math.min(...corners.map(corner => corner[2])),
    ],
    max: [
      x + Math.max(...corners.map(corner => corner[0])),
      y + Math.max(...corners.map(corner => corner[1])),
      z + Math.max(...corners.map(corner => corner[2])),
    ],
  };
}

test('Oshioi presentation is an original, external-asset-free SSOT', () => {
  const map = buildMap();
  assert.equal(map.presentation, OSHIOI_PRESENTATION);
  assert.equal(map.presentation.authorship.origin, 'original-kagariai');
  assert.deepEqual(map.presentation.authorship.externalRuntimeAssets, []);
  assert.equal(map.presentation.authorship.referencePolicy, 'abstract-quality-benchmark-only');
  assert.ok(map.presentation.authorship.prohibitedMotifs.includes('suravasa-layout'));
  assert.ok(Object.isFrozen(map.presentation));
  assert.ok(Object.isFrozen(map.presentation.layers));
});

test('opaque signature-map dressing never creates false cover inside the playable bounds', () => {
  const map = buildMap();
  const { x: boundsX, y: boundsY } = map.boundsM;
  const layers = map.presentation.layers.filter(layer => layer.semantics === 'outside-playable-bounds');
  assert.ok(layers.length >= 8);
  for (const layer of layers) {
    assert.ok(layer.transforms.length > 0, `${layer.id} must not be empty`);
    for (const [index, transform] of layer.transforms.entries()) {
      const bounds = axisAlignedBounds(transform);
      const outsideX = bounds.max[0] <= boundsX[0] || bounds.min[0] >= boundsX[1];
      const outsideY = bounds.max[1] <= boundsY[0] || bounds.min[1] >= boundsY[1];
      assert.ok(outsideX || outsideY,
        `${layer.id}[${index}] overlaps the playable x/y envelope`);
    }
  }
});

test('presentation density stays inside the declared WebGL budget', () => {
  const { layers, performanceBudget } = OSHIOI_PRESENTATION;
  const instanceCount = layers.reduce((sum, layer) => sum + layer.transforms.length, 0);
  assert.ok(layers.length <= performanceBudget.maxPresentationDrawCalls);
  assert.ok(instanceCount <= performanceBudget.maxPresentationInstances);
  assert.ok(instanceCount >= 240, 'the original skyline should provide production-scale visual density');
  assert.equal(performanceBudget.maxDynamicLights, 0,
    'emissive markers must remain material-driven rather than spawning point lights');
});
