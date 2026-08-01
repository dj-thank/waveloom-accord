import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { createModelProvider } from '../client/img2threejs/runtime/model_provider.js';
import { createGeometryKit } from '../client/img2threejs/runtime/geometry_kit.js';

const quality = () => ({
  gates: {
    strictSpec: true,
    silhouette: true,
    multiAngle: true,
    material: true,
    runtimeContract: true,
    performance: true,
    visualReview: true,
  },
  evidence: ['spec', 'silhouette', 'angles', 'material', 'runtime', 'performance', 'visual'],
});

const acceptedEntry = (heroId = 'alpha') => ({
  heroId,
  status: 'accepted',
  runtimeEligible: true,
  moduleUrl: `${heroId}.js`,
  factoryExport: 'make',
  quality: quality(),
  contract: {
    requiredPivots: ['root'],
    requiredSockets: [],
    requireColliderHints: true,
  },
});

const root = (heroId) => {
  const objects = { model_root: { name: 'model_root' } };
  return {
  isObject3D: true,
  position: {},
  traverse(visitor) { visitor(this); },
  getObjectByName(name) { return objects[name] || null; },
  userData: {
    heroId,
    characterModel: {
      heroId,
      pivots: { root: 'model_root' },
      sockets: {},
      colliderHints: { torso: { type: 'capsule' } },
    },
  },
  };
};

test('runtime admits accepted entries and caches dynamic modules', async () => {
  let imports = 0;
  const provider = createModelProvider({
    manifest: { alpha: acceptedEntry() },
    importModule: async () => { imports += 1; return { make: () => root('alpha') }; },
  });
  assert.equal((await provider.instantiate('alpha')).userData.heroId, 'alpha');
  assert.equal((await provider.instantiate('alpha')).userData.heroId, 'alpha');
  assert.equal(imports, 1);
  provider.clearCache('alpha');
  await provider.instantiate('alpha');
  assert.equal(imports, 2);
});

test('unknown and non-accepted heroes fail closed without importing', async () => {
  let imports = 0;
  const provider = createModelProvider({
    manifest: {
      candidate: {
        ...acceptedEntry('candidate'),
        status: 'candidate',
        runtimeEligible: false,
      },
    },
    importModule: async () => { imports += 1; return { make: () => root('candidate') }; },
  });
  await assert.rejects(provider.instantiate('missing'), { code: 'MODEL_UNKNOWN_HERO' });
  await assert.rejects(provider.instantiate('candidate'), { code: 'MODEL_NOT_ACCEPTED' });
  assert.equal(imports, 0);
});

test('bad factory exports and invalid roots are rejected deterministically', async () => {
  const base = (factoryExport, importer) => createModelProvider({
    manifest: { alpha: { ...acceptedEntry(), factoryExport } },
    importModule: importer,
  });
  await assert.rejects(base('missing', async () => ({})).instantiate('alpha'), { code: 'MODEL_FACTORY_INVALID' });
  await assert.rejects(base('make', async () => ({ make: () => root('wrong') })).instantiate('alpha'), { code: 'MODEL_ROOT_HERO_MISMATCH' });
  await assert.rejects(base('make', async () => ({ make: () => ({}) })).instantiate('alpha'), { code: 'MODEL_ROOT_INVALID' });
});

test('accepted status without every gate and evidence remains fail closed', async () => {
  let imports = 0;
  const incomplete = acceptedEntry();
  incomplete.quality.gates.performance = false;
  const provider = createModelProvider({
    manifest: { alpha: incomplete },
    importModule: async () => { imports += 1; return { make: () => root('alpha') }; },
  });
  await assert.rejects(provider.instantiate('alpha'), { code: 'MODEL_QUALITY_INCOMPLETE' });
  assert.equal(imports, 0);
});

test('the shared geometry kit rebases semantic pivots without moving built geometry', () => {
  const { addMesh, rebasePivot, measureModelPerformance } = createGeometryKit(THREE);
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.scale.set(1.2, 0.9, 1.1);
  root.add(pivot);
  const mesh = addMesh(
    pivot,
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial(),
    'fixture-mesh',
    [2, 3, 4],
  );
  root.updateMatrixWorld(true);
  const before = mesh.getWorldPosition(new THREE.Vector3());
  rebasePivot(pivot, [1, 2, 3]);
  root.updateMatrixWorld(true);
  const after = mesh.getWorldPosition(new THREE.Vector3());
  assert.ok(before.distanceTo(after) < 1e-9);
  assert.deepEqual(pivot.userData.pivotRestPosition, pivot.position.toArray());
  assert.deepEqual(measureModelPerformance(root), {
    triangles: 12,
    drawCalls: 1,
    textures: 0,
  });
});

test('the shared geometry kit compacts decorative meshes without flattening sockets', () => {
  const {
    addMesh,
    addSocket,
    mergeStaticMeshesByMaterial,
    measureModelPerformance,
  } = createGeometryKit(THREE, { mergeGeometries });
  const root = new THREE.Group();
  const pivot = new THREE.Group();
  pivot.name = 'pivot_fixture';
  root.add(pivot);
  const material = new THREE.MeshStandardMaterial({ color: 0x227788 });
  addMesh(pivot, new THREE.BoxGeometry(1, 1, 1), material, 'part-a', [0, 0, 0]);
  addMesh(pivot, new THREE.BoxGeometry(1, 1, 1), material, 'part-b', [2, 0, 0]);
  const socket = addSocket(pivot, 'socket_fixture', [1, 2, 3]);
  const beforeBox = new THREE.Box3().setFromObject(root);
  assert.equal(measureModelPerformance(root).drawCalls, 2);
  const result = mergeStaticMeshesByMaterial(pivot);
  const afterBox = new THREE.Box3().setFromObject(root);
  assert.deepEqual(result, {
    sourceMeshes: 2,
    mergedMeshes: 1,
    drawCallsRemoved: 1,
  });
  assert.equal(measureModelPerformance(root).drawCalls, 1);
  assert.ok(beforeBox.min.distanceTo(afterBox.min) < 1e-9);
  assert.ok(beforeBox.max.distanceTo(afterBox.max) < 1e-9);
  assert.equal(root.getObjectByName('socket_fixture'), socket);
});

test('Shiomaneki geometry destructured API remains callable', () => {
  const kit = createGeometryKit(THREE, { mergeGeometries });
  for (const name of ['addMesh', 'addPlate', 'addTrimmedPlate', 'addOutline', 'addCurvedTube', 'addRivet', 'addRivetRow', 'addTube', 'addTaperedTube', 'addRing', 'addSocket', 'rebasePivot', 'mergeStaticMeshesByMaterial', 'measureModelPerformance']) {
    assert.equal(typeof kit[name], 'function', name);
  }
});
