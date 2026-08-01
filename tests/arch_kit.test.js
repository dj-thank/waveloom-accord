import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';

import {
  createArchKit,
  createArchMaterials,
  auditArchPalette,
  archOutlinePoints,
  archRandom,
  ARCH_VOCABULARY,
  ARCH_DOME_SCALES,
  ARCH_KIT_ERRORS,
  ARCH_WALKABLE_TAGS,
} from '../client/img2threejs/runtime/arch_kit.js';
import { buildOshioiFlashpointGeometry } from '../shared/data/map_oshioi_flashpoint_geometry.js';

const kit = createArchKit(THREE, { detail: 'medium' });

/** 語彙IDごとの既定の生成物。ARCH_VOCABULARY と 1:1 で対応させる。 */
const SAMPLES = {
  dome: () => kit.createDome({ scale: 'medium' }),
  archOpening: () => kit.createArchOpening({}),
  archWall: () => kit.createArchWall({ width: 9, height: 6, openings: 2 }),
  roof: () => kit.createRoof({ width: 9, depth: 5, height: 2.2 }),
  eave: () => kit.createEave({}),
  curvedTerrace: () => kit.createCurvedTerrace({}),
  latticeScreen: () => kit.createLatticeScreen({}),
  colonnade: () => kit.createColonnade({ count: 6, arcade: true }),
  parapet: () => kit.createParapet({ length: 9 }),
  pavingPatch: () => kit.createPavingPatch({ width: 12, depth: 12 }),
  tree: () => kit.createTree({}),
  plantingBed: () => kit.createPlantingBed({}),
  silhouetteMass: () => kit.createSilhouetteMass({ kind: 'tower' }),
  lampPost: () => kit.createLampPost({}),
  wrapSolid: () => kit.wrapSolid({
    id: 'sample-mass', tag: 'wall', min: [-4.5, -2, 4], max: [4.5, 2, 11],
  }, { siteId: 'mizuichi' }),
};

test('ARCH_VOCABULARY covers every advertised factory and each one builds', () => {
  assert.equal(ARCH_VOCABULARY.length, Object.keys(SAMPLES).length);
  for (const entry of ARCH_VOCABULARY) {
    assert.equal(typeof kit[entry.factory], 'function', `missing factory ${entry.factory}`);
    assert.ok(SAMPLES[entry.id], `missing sample for ${entry.id}`);
    const node = SAMPLES[entry.id]();
    assert.ok(node.isObject3D, `${entry.id} must return an Object3D`);
    let meshes = 0;
    node.traverse(child => { if (child.isMesh) meshes += 1; });
    assert.ok(meshes >= 1, `${entry.id} produced no mesh`);
  }
});

test('every vocabulary item stays inside its triangle budget', () => {
  const report = [];
  for (const entry of ARCH_VOCABULARY) {
    const node = SAMPLES[entry.id]();
    const measured = kit.measureArch(node);
    report.push(`${entry.id}: ${measured.triangles} tri / ${measured.drawCalls} draw (budget ${entry.triangleBudget})`);
    assert.ok(measured.triangles > 0, `${entry.id} has no triangles`);
    assert.ok(
      measured.triangles <= entry.triangleBudget,
      `${entry.id} over budget: ${measured.triangles} > ${entry.triangleBudget}`,
    );
    assert.equal(measured.textures, 0, `${entry.id} must not use textures`);
  }
  console.log(report.join('\n'));
});

test('nothing the kit builds carries collision', () => {
  for (const entry of ARCH_VOCABULARY) {
    const node = SAMPLES[entry.id]();
    const violations = kit.auditDecorative(node);
    assert.deepEqual(violations, [], `${entry.id} leaked collision on: ${violations.join(', ')}`);
    node.traverse(child => {
      assert.equal(child.userData.collision, false);
      assert.equal(child.userData.decorativeOnly, true);
      assert.equal(child.userData.archKit, true);
    });
    assert.equal(kit.measureArch(node).collisionLeaks, 0);
  }
});

test('all geometry is vertex-coloured and texture-free (no new PNG)', () => {
  for (const entry of ARCH_VOCABULARY) {
    const node = SAMPLES[entry.id]();
    node.traverse(child => {
      if (!child.isMesh) return;
      assert.ok(child.geometry.attributes.color, `${entry.id}: missing vertex colors`);
      assert.ok(child.geometry.attributes.normal, `${entry.id}: missing normals`);
      const list = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of list) {
        assert.equal(material.vertexColors, true, `${entry.id}: material must use vertex colors`);
        for (const value of Object.values(material)) {
          assert.ok(!value?.isTexture, `${entry.id}: material carries a texture`);
        }
      }
    });
  }
});

test('palette follows ARCH_BRIEF 3.4 (pale warm base / gold accent / one cool hue / green)', () => {
  const audit = auditArchPalette();
  assert.equal(audit.baseIsWarmPale, true, '貝灰漆喰の白が基調でない');
  assert.equal(audit.coolIsSingleHue, true, `寒色が1色相に収まっていない: ${audit.coolHueSpreadDeg}deg`);
  assert.equal(audit.accentKey, 'gold');
  assert.deepEqual(audit.vegetationKeys, ['foliage', 'foliageDeep']);
  const materials = createArchMaterials(THREE);
  assert.ok(Object.keys(materials).length >= 12);
  for (const material of Object.values(materials)) assert.equal(material.vertexColors, true);
});

test('arch outlines are curved and closed for every style', () => {
  for (const style of ['pointed', 'round', 'segmental']) {
    const points = archOutlinePoints({ width: 2.2, height: 3.4, style, segments: 8 });
    assert.ok(points.length >= 8, `${style}: too few points`);
    const apex = Math.max(...points.map(p => p[1]));
    assert.ok(Math.abs(apex - 3.4) < 0.35, `${style}: apex ${apex} != 3.4`);
    const distinctHeights = new Set(points.map(p => p[1].toFixed(3)));
    assert.ok(distinctHeights.size >= 6, `${style}: outline is not curved`);
    const xs = points.map(p => p[0]);
    assert.ok(Math.max(...xs) <= 1.1001 && Math.min(...xs) >= -1.1001, `${style}: outline wider than opening`);
  }
  const flat = archOutlinePoints({ style: 'flat' });
  assert.equal(flat.length, 4);
});

test('dome reuses one generator across three scales (ARCH_BRIEF 3.2)', () => {
  const counts = [];
  for (const scale of Object.keys(ARCH_DOME_SCALES)) {
    const dome = kit.createDome({ scale });
    const measured = kit.measureArch(dome);
    counts.push(measured.triangles);
    const bounds = new THREE.Box3().setFromObject(dome);
    const size = bounds.getSize(new THREE.Vector3());
    const preset = ARCH_DOME_SCALES[scale];
    assert.ok(size.x > preset.radiusM * 1.4 && size.x < preset.radiusM * 3.2, `${scale}: width ${size.x}`);
    assert.ok(size.y > 0, `${scale}: no height`);
  }
  // 同一部品の使い回しなので三角形数はスケールに依らず一定
  assert.equal(new Set(counts).size, 1, `dome triangle counts diverge: ${counts.join(',')}`);
});

test('archWall really punches holes: opening count changes the geometry', () => {
  const solid = kit.createArchWall({ width: 9, height: 6, openings: 0 });
  const pierced = kit.createArchWall({ width: 9, height: 6, openings: 3 });
  assert.equal(solid.userData.openings.length, 0);
  assert.equal(pierced.userData.openings.length, 3);
  const a = kit.measureArch(solid).triangles;
  const b = kit.measureArch(pierced).triangles;
  assert.ok(b > a, `pierced wall (${b}) should have more triangles than solid (${a})`);
});

test('wrapSolid wraps the collision box without intruding at player height', () => {
  const aabb = { id: 'flash-site-mizuichi-mass-north', tag: 'wall', min: [48, 39, 4], max: [57, 43, 11] };
  const wrapped = kit.wrapSolid(aabb, { siteId: 'mizuichi', seed: 5 });
  assert.equal(wrapped.userData.sourceSolidId, aabb.id);
  assert.equal(wrapped.userData.collision, false);
  assert.equal(wrapped.rotation.x, Math.PI / 2, 'Y-up build must be mounted with rotation.x = +PI/2');
  wrapped.updateMatrixWorld(true);

  // プレイ高さ（底面 +2.2 m）では AABB の水平フットプリントから 1 mm も出ない
  const footprint = kit.auditFootprint(wrapped, aabb);
  assert.equal(footprint.safe, true, `protrudes ${footprint.maxProtrusionM}m at player height`);
  assert.ok(footprint.verticesOutsideAboveClearance > 0, '軒の出が無い＝影を作る庇/屋根が出ていない');

  const bounds = new THREE.Box3().setFromObject(wrapped);
  assert.ok(Math.abs(bounds.min.z - aabb.min[2]) < 0.2, `z min ${bounds.min.z}`);
  assert.ok(bounds.max.z > aabb.max[2], 'roof must rise above the box to create a silhouette');
  assert.ok(bounds.max.z < aabb.max[2] + 4, `roof too tall: ${bounds.max.z}`);
  // 軒の出は 0.6 m 以内（借景でない限り張り出しすぎない）
  assert.ok(bounds.max.x - aabb.max[0] <= 0.6, `overhang ${bounds.max.x - aabb.max[0]}`);
});

test('every wrapped flashpoint solid is footprint-safe at player height', () => {
  const geometry = buildOshioiFlashpointGeometry();
  const solids = (geometry.solids || geometry.geometry || []).filter(s => s.tag !== 'ground');
  const offenders = [];
  let index = 0;
  for (const solid of solids) {
    const wrapped = kit.wrapSolid(solid, { seed: 17 + index * 13 });
    const audit = kit.auditFootprint(wrapped, solid);
    if (!audit.safe) offenders.push(`${solid.id}(${solid.tag}) +${audit.maxProtrusionM}m`);
    index += 1;
  }
  assert.deepEqual(offenders.slice(0, 8), [], `footprint intrusions: ${offenders.length}/${solids.length}`);
});

test('wrapSolid keeps walkable tags free of roofs and overhead geometry', () => {
  for (const tag of ARCH_WALKABLE_TAGS) {
    const aabb = { id: `walkable-${tag}`, tag, min: [-3, -3, 4], max: [3, 3, 9] };
    const wrapped = kit.wrapSolid(aabb, { seed: 3 });
    wrapped.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(wrapped);
    assert.ok(
      bounds.max.z <= aabb.max[2] + 1.15,
      `${tag}: geometry rises ${bounds.max.z - aabb.max[2]}m above a walkable surface`,
    );
  }
});

test('wrapSolid is deterministic for a given seed', () => {
  const aabb = { id: 'det', tag: 'wall', min: [0, 0, 0], max: [8, 4, 6] };
  const a = kit.measureArch(kit.wrapSolid(aabb, { seed: 42, siteId: 'kado' }));
  const b = kit.measureArch(kit.wrapSolid(aabb, { seed: 42, siteId: 'kado' }));
  assert.deepEqual(a, b);
  const random = archRandom(42);
  const first = [random(), random(), random()];
  const again = archRandom(42);
  assert.deepEqual([again(), again(), again()], first);
});

test('site styles give the five sites different architectural vocabulary', () => {
  const aabb = { id: 'site-mass', tag: 'wall', min: [-4.5, -2, 4], max: [4.5, 2, 11] };
  const signatures = new Set();
  for (const siteId of ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami']) {
    const wrapped = kit.wrapSolid(aabb, { siteId, seed: 9 });
    const measured = kit.measureArch(wrapped);
    signatures.add(`${kit.siteStyles[siteId].archStyle}/${kit.siteStyles[siteId].roof}/${measured.triangles}`);
  }
  assert.ok(signatures.size >= 4, `sites share too much vocabulary: ${[...signatures].join(' | ')}`);
});

test('wrapSolids converts real flashpoint collision boxes within budget', () => {
  const geometry = buildOshioiFlashpointGeometry();
  const solids = geometry.solids || geometry.geometry || [];
  assert.ok(solids.length > 100, `expected the 192-solid flashpoint set, got ${solids.length}`);
  const before = solids.map(s => JSON.stringify([s.id, s.min, s.max, s.tag]));

  const subset = solids.filter(s => typeof s.id === 'string' && s.id.includes('mizuichi'));
  assert.ok(subset.length > 0);
  const wrapped = kit.wrapSolids(subset, { siteId: 'mizuichi', seed: 21, detail: 'medium' });
  const measured = kit.measureArch(wrapped);
  assert.equal(measured.collisionLeaks, 0);
  assert.deepEqual(kit.auditDecorative(wrapped), []);
  // マテリアル単位に畳まれているので、拠点1つぶんでもドローコールはマテリアル数で頭打ち
  assert.ok(measured.drawCalls <= 14, `draw calls ${measured.drawCalls} exceeded the material count`);
  assert.ok(measured.triangles < 120000, `site wrap too heavy: ${measured.triangles}`);
  console.log(
    `wrapSolids(mizuichi): ${wrapped.userData.wrappedCount} solids -> `
    + `${measured.triangles} tri / ${measured.drawCalls} draw`,
  );

  // 入力の solids を一切変更していないこと（当たり判定はゲーム権威）
  assert.deepEqual(solids.map(s => JSON.stringify([s.id, s.min, s.max, s.tag])), before);
});

test('mergeArchRoot collapses draw calls without losing triangles', () => {
  const group = new THREE.Group();
  group.name = 'merge-target';
  for (let i = 0; i < 6; i++) {
    const node = kit.createDome({ scale: 'small', name: `dome-${i}` });
    node.position.set(i * 2, 0, 0);
    group.add(node);
  }
  const before = kit.measureArch(group);
  const stats = kit.mergeArchRoot(group);
  const after = kit.measureArch(group);
  assert.equal(after.triangles, before.triangles, 'merging must not change triangle count');
  assert.ok(after.drawCalls < before.drawCalls, 'merging must reduce draw calls');
  assert.equal(after.drawCalls, after.materials);
  assert.ok(stats.drawCallsRemoved > 0);
  assert.equal(kit.auditDecorative(group).length, 0);
});

test('kit passes through the whole geometry_kit API without editing it', () => {
  for (const api of [
    'addMesh', 'addPlate', 'addTrimmedPlate', 'addOutline', 'addCurvedTube', 'addRivet',
    'addRivetRow', 'addTube', 'addTaperedTube', 'addRing', 'addSocket', 'rebasePivot',
    'measureModelPerformance', 'mergeStaticMeshesByMaterial',
  ]) {
    assert.equal(typeof kit[api], 'function', `geometry_kit API missing: ${api}`);
  }
});

test('invalid input is rejected loudly', () => {
  assert.throws(() => createArchKit({}), /ARCH_THREE_INVALID/);
  assert.throws(() => kit.wrapSolid({ min: [0, 0, 0] }), new RegExp(ARCH_KIT_ERRORS.AABB_INVALID));
  assert.throws(() => kit.wrapSolid({ min: [0, 0, 0], max: [0, 0, 0] }), new RegExp(ARCH_KIT_ERRORS.AABB_INVALID));
  assert.throws(() => kit.createArchWall({ width: 0 }), new RegExp(ARCH_KIT_ERRORS.PARAM_INVALID));
  assert.throws(() => kit.createDome({ radius: -1 }), new RegExp(ARCH_KIT_ERRORS.PARAM_INVALID));
  assert.throws(() => kit.createCurvedTerrace({ innerRadius: 5, outerRadius: 2 }), new RegExp(ARCH_KIT_ERRORS.PARAM_INVALID));
});

test('detail levels trade triangles for distance layers (ARCH_BRIEF 3.1)', () => {
  const counts = ['low', 'medium', 'high'].map(detail => {
    const localKit = createArchKit(THREE, { detail });
    return localKit.measureArch(localKit.createDome({ scale: 'large' })).triangles;
  });
  assert.ok(counts[0] < counts[1] && counts[1] < counts[2], `detail ladder broken: ${counts.join(',')}`);
});
