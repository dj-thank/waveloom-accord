import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const preview = path.resolve('work/asset-rush/aaa-v1-pilot/img2threejs/prop-tide-marker-01/tide-marker-preview.js');
const previewHtml = path.resolve('work/asset-rush/aaa-v1-pilot/img2threejs/prop-tide-marker-01/preview.html');

test('Tide Marker batching preview keeps two asset meshes, a real sea-glass inset region, and no collision contract', async () => {
  const source = await readFile(preview, 'utf8');
  assert.match(source, /tideMarker\.add\(mesh\)/);
  assert.match(source, /assetDrawCalls: tideMarker\.children\.length/);
  assert.match(source, /new THREE\.CircleGeometry\(0\.122, 16\)/);
  assert.match(source, /irregularLathe\(profile, 14/);
  assert.match(source, /tideMarker\.scale\.set\(1\.13, 0\.93, 1\.13\)/);
  assert.match(source, /attribute float tideRegion/);
  assert.match(source, /tideMarker\.userData\.collision = 'none'/);
  assert.match(source, /assetDrawCalls: 2/);
  assert.match(source, /window\.__tideMarkerRuntime = runtime/);
  assert.match(source, /renderer\.info\.render/);
  const html = await readFile(previewHtml, 'utf8');
  assert.match(html, /tide-marker-preview\.js\?v=20260801-11/);
});
