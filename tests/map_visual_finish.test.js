import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/data/map_oshioi.js';
import { GROUND_LAYERS } from '../shared/data/map_oshioi_ground.js';

function layer(map, id) {
  const candidate = map.presentation.layers.find(item => item.id === id);
  assert.ok(candidate, `expected presentation layer ${id}`);
  return candidate;
}

function xyKey(transform) {
  return transform.position.slice(0, 2).map(value => value.toFixed(4)).join(',');
}

function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

const CENTRAL_APPROACH_AXES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
function isCentralApproachWedge(transform) {
  const [x, y] = transform.position;
  const radius = Math.hypot(x, y);
  if (radius < 8 || radius > 31) return false;
  const angle = Math.atan2(y, x);
  return CENTRAL_APPROACH_AXES.some(axis => angleDistance(angle, axis) < 0.28);
}

test('far roof families use a bounded authored color and silhouette mix outside play', () => {
  const map = buildMap();
  const rebuilt = buildMap();
  const hip = layer(map, 'district-hip-roofs');
  const barrel = layer(map, 'metropolis-barrel-roofs');
  const saw = layer(map, 'metropolis-saw-roofs');
  const dome = layer(map, 'metropolis-dome-roofs');
  const roofLayers = [hip, barrel, saw, dome];

  assert.equal(barrel.material, 'farRoofWarm');
  assert.equal(saw.material, 'farRoofLight');
  assert.deepEqual(roofLayers.map(roofLayer => roofLayer.transforms.length), [56, 25, 24, 17],
    'the reviewed 17-roof cadence and three outliers should keep their authored family balance');
  for (const roofLayer of roofLayers) {
    assert.equal(roofLayer.semantics, 'outside-playable-bounds');
    assert.ok(roofLayer.transforms.length >= 16,
      `${roofLayer.id} should remain a readable skyline family`);
    assert.deepEqual(roofLayer.transforms, layer(rebuilt, roofLayer.id).transforms,
      `${roofLayer.id} should retain its seed-stable placement, footprint, and silhouette`);
  }

  const roofHeights = roofLayers.flatMap(roofLayer =>
    roofLayer.transforms.map(transform => transform.scale[2]));
  assert.ok(Math.max(...roofHeights) >= 7,
    'reviewed skyline outliers must create a visibly taller roof silhouette');
});

test('central objective floor keeps four clean approach wedges while retaining one motif', () => {
  const map = buildMap();
  const seams = layer(map, 'ground-figure-seam').transforms
    .filter(transform => Math.hypot(transform.position[0], transform.position[1]) >= 8
      && Math.hypot(transform.position[0], transform.position[1]) <= 31
      && transform.scale[0] > 2.55);
  const smallGold = layer(map, 'ground-lane-gold').transforms
    .filter(transform => Math.hypot(transform.position[0], transform.position[1]) >= 8
      && Math.hypot(transform.position[0], transform.position[1]) <= 24
      && transform.scale[1] <= 1.1);

  // 敷石の継ぎ目に1層（ground-joint）を足した。目地は紋様（cedar の暖色線）と
  // 役割が違い、色相を変えず明度だけ落とす影色でなければ床の「貼り紙」感が消えない。
  // 層を増やす判断は実測で裏づけている: presentation 層 110/128、実画面ドロー
  // コール 146/250、三角形 506,552/1,200,000。予算が尽きたらここを 9 から戻す。
  assert.equal(GROUND_LAYERS.length, 9, 'floor readability must stay inside the measured draw budget');
  assert.equal(seams.filter(isCentralApproachWedge).length, 0,
    'central seam ornament must leave each cardinal approach readable');
  assert.equal(smallGold.filter(isCentralApproachWedge).length, 0,
    'central gold markers must not refill the approach wedges');
  assert.ok(seams.length >= 80,
    'the central floor still needs enough cedar detail to read as an authored motif');
  assert.ok(smallGold.length >= 12 && smallGold.length <= 36,
    `central gold should be intentionally thinner than the dense 52-marker baseline, got ${smallGold.length}`);
});

test('string-line finials keep their supports but use deterministic skips and a two-level crown palette', () => {
  const map = buildMap();
  const pillars = layer(map, 'clad-shell-trim').transforms.filter(transform =>
    transform.scale[0] === 0.34 && transform.scale[1] === 0.34 && transform.position[2] >= 6.5);
  const pillarKeys = new Set(pillars.map(xyKey));
  const finials = layer(map, 'clad-ring-finial').transforms
    .filter(transform => pillarKeys.has(xyKey(transform)));
  const crownScales = new Set(finials.map(transform => transform.scale[0].toFixed(3)));

  assert.ok(finials.length < pillars.length,
    'some existing supports should intentionally omit a crown rather than making a picket row');
  assert.ok(finials.length >= pillars.length * 0.82 && finials.length <= pillars.length * 0.90,
    'one crown in roughly every five to eight supports should be omitted, without losing the string rhythm');
  assert.ok(crownScales.has('0.320') && crownScales.has('0.420'),
    'the string-line crowns need the reviewed two-level silhouette palette');
});
