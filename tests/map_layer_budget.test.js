import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/data/map_oshioi.js';

// client/render.js:_buildOriginalMapPresentation は
//   layers.length > maxPresentationDrawCalls(128)  または
//   instances    > maxPresentationInstances(24000)
// のとき presentation 全体を null で返し、console.warn 1行だけを残して
// **全層が画面から無音で消える**。129層目を踏んでから気づくのでは遅いので、
// 8層の緩衝を取って120層で赤くする。7担当が同時に層を足すための安全ネット。

const HARD_LAYER_BUDGET = 128;
const SOFT_LAYER_BUDGET = 120;     // 8層の緩衝
const HARD_INSTANCE_BUDGET = 24000;
const SOFT_INSTANCE_BUDGET = 22000; // 2,000の緩衝

function presentationStats(map) {
  const layers = map.presentation.layers;
  return {
    layers: layers.length,
    instances: layers.reduce((sum, layer) => sum + layer.transforms.length, 0),
    clad: layers.filter(layer => layer.semantics === 'clad-existing-solid').length,
    outside: layers.filter(layer => layer.semantics === 'outside-playable-bounds').length,
  };
}

test('presentation layer count keeps an 8-slot margin below the hard budget', () => {
  const map = buildMap();
  const stats = presentationStats(map);
  assert.equal(map.presentation.performanceBudget.maxPresentationDrawCalls, HARD_LAYER_BUDGET);
  assert.ok(stats.layers <= SOFT_LAYER_BUDGET,
    `層 ${stats.layers} / 予備込み上限 ${SOFT_LAYER_BUDGET}。`
    + `${HARD_LAYER_BUDGET + 1} で全層が無音消滅する`);
});

test('presentation instance count keeps a 2,000-slot margin below the hard budget', () => {
  const map = buildMap();
  const stats = presentationStats(map);
  assert.equal(map.presentation.performanceBudget.maxPresentationInstances, HARD_INSTANCE_BUDGET);
  assert.ok(stats.instances <= SOFT_INSTANCE_BUDGET,
    `インスタンス ${stats.instances} / 予備込み上限 ${SOFT_INSTANCE_BUDGET}`);
});

test('every semantics group stays inside its own layer allocation', () => {
  const map = buildMap();
  const stats = presentationStats(map);
  // R が管理する境界外（遠景）の割当は20層。統合前は28層あった。
  assert.ok(stats.outside <= 20 + 2,
    `outside-playable-bounds ${stats.outside} 層。R の割当は20（+植生の境界林2）`);
  assert.equal(stats.clad + stats.outside, stats.layers,
    'semantics は clad-existing-solid か outside-playable-bounds のどちらかでなければならない');
});

test('layer ids are unique so a merge never silently drops a layer', () => {
  const map = buildMap();
  const ids = map.presentation.layers.map(layer => layer.id);
  assert.equal(new Set(ids).size, ids.length,
    `重複した層 id: ${ids.filter((id, i) => ids.indexOf(id) !== i).join(', ')}`);
});

test('no layer is empty (an empty InstancedMesh still costs a slot in review)', () => {
  const map = buildMap();
  const empty = map.presentation.layers.filter(layer => layer.transforms.length === 0);
  assert.deepEqual(empty.map(layer => layer.id), [],
    '空の層は割当を食うだけなので削るか transforms を入れる');
});

test('the far skyline supplies the 25m depth band (principle 1)', () => {
  const map = buildMap();
  let above25 = 0;
  let total = 0;
  for (const layer of map.presentation.layers) {
    for (const transform of layer.transforms) {
      total += 1;
      if (transform.position[2] + transform.scale[2] / 2 > 25) above25 += 1;
    }
  }
  assert.ok(above25 >= 600,
    `床上25mを超えるインスタンス ${above25} 個。合格ラインは600個（奥行き4層の第3層）`);
  assert.ok(above25 / total >= 0.03,
    `25m超の比率 ${(above25 / total * 100).toFixed(2)}% は3%未満`);
});

test('presentation triangle estimate stays inside the scene budget', () => {
  // _presentationGeometry を実行して index.count/3 を読んだ実測値。
  const TRIANGLES = {
    plane: 2, sawRoof: 8, box: 12, hipRoof: 16, spire: 24, dodecaLow: 36,
    cylinder: 40, terrace: 48, barrelRoof: 50, archGate: 68, sphere: 140,
    dodeca: 144, archWall: 218, dome: 240, lattice: 284, colonnade: 320,
    chamferBox: 620,
  };
  const map = buildMap();
  let triangles = 0;
  for (const layer of map.presentation.layers) {
    const cost = TRIANGLES[layer.primitive];
    assert.ok(Number.isFinite(cost), `未知の primitive: ${layer.primitive} (${layer.id})`);
    triangles += cost * layer.transforms.length;
  }
  assert.ok(triangles <= 620000,
    `presentation 三角形 ${triangles}。上限 620,000（シーン全体1,200,000の約半分）`);
});
