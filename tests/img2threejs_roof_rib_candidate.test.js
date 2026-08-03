import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import {
  applyKagariaiRoofRibLightingMode,
  createKagariaiRoofRibLookDevLights,
  createKagariaiRoofRibModel,
  disposeKagariaiRoofRibModel,
  setKagariaiRoofRibFinialDetached,
} from '../client/img2threejs/roof-rib/createKagariaiRoofRibModel.js';
import {
  KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE,
  assertKagariaiRoofRibRuntimeAdmission,
  createKagariaiRoofRibReviewAdmission,
} from '../client/img2threejs/roof-rib/runtimeAdmissionCandidate.js';
import { OSHIOI_PRESENTATION } from '../shared/data/map_oshioi_presentation.js';
import { resolveKagariaiRoofRibReviewRequest } from '../client/img2threejs/roof-rib/reviewGate.js';
import {
  createKagariaiRoofRibMapReviewGroup,
  createKagariaiRoofRibRuntimeGroup,
  disposeKagariaiRoofRibRuntimeGroup,
} from '../client/img2threejs/roof-rib/runtimeAdapter.js';

test('roof-rib factory exposes a collision-free modular candidate within its authored budget', () => {
  const model = createKagariaiRoofRibModel({ THREE });
  assert.equal(model.isGroup, true);
  assert.deepEqual({ ...model.userData.assetModel, surface: undefined, optimization: undefined }, {
    schemaVersion: '1.0.0',
    assetId: 'prop-kagariai-roof-rib-01',
    candidateOnly: true,
    collision: 'none',
    sourceReferenceSha256: '526A593493B80B371F91115916432E7C93B89795E520FA44FF0FD347625B10C7',
    dimensionsM: { length: 2.4, height: 0.72, depth: 0.76 },
    resourceOwnership: {
      geometry: 'factory-owned',
      materials: 'factory-owned',
      textures: 'borrowed',
    },
    performance: model.userData.assetModel.performance,
    surface: undefined,
    optimization: undefined,
  });
  for (const name of ['tile_shell', 'copper_spine', 'end_cap_left', 'end_cap_right', 'finial_pivot']) {
    assert.ok(model.getObjectByName(name), name);
  }
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  assert.ok(size.x >= 2.35 && size.x <= 2.8, size.x);
  assert.ok(size.y >= 0.68 && size.y <= 0.8, size.y);
  assert.ok(size.z >= 0.7 && size.z <= 0.84, size.z);
  assert.ok(model.userData.assetModel.performance.triangles >= 700);
  assert.ok(model.userData.assetModel.performance.triangles <= 5000);
  assert.ok(model.userData.assetModel.performance.drawCalls <= 5);
});

test('roof-rib finial is a detachable semantic child without admitting gameplay collision', () => {
  const model = createKagariaiRoofRibModel({ THREE, finial: 'right' });
  const finial = model.getObjectByName('finial_pivot');
  const socket = model.getObjectByName('socket_finial_right');
  assert.equal(finial.parent, socket);
  assert.equal(finial.userData.detachable, true);
  assert.equal(finial.userData.parentSocket, 'socket_finial_right');
  assert.deepEqual(finial.userData.attachmentContract, {
    parentSocket: 'socket_finial_right',
    localStart: [0, -0.04, 0],
    localEnd: [0, 0.35, 0],
    contactType: 'socketed',
    embedDepth: 0.04,
    overlap: 0.02,
    gapTolerance: 0.005,
  });
  assert.ok(model.getObjectByName('socket_finial_left'));
  assert.ok(model.getObjectByName('socket_finial_right'));
  assert.deepEqual(model.getObjectByName('lower_tile_course').userData.instanceRange, { start: 0, count: 20 });
  assert.deepEqual(model.getObjectByName('middle_tile_course').userData.instanceRange, { start: 20, count: 20 });
  assert.deepEqual(model.getObjectByName('upper_tile_course').userData.instanceRange, { start: 40, count: 20 });
  assert.deepEqual(model.getObjectByName('ridge_cap_course').userData.instanceRange, { start: 60, count: 10 });
  assert.equal(model.getObjectByName('tile_instances').count, 70);
  assert.equal(model.getObjectByName('copper_spine').count, 10);
  model.traverse((object) => assert.notEqual(object.userData?.collision, true));
});

test('roof-rib publishes evidence-linked local surface treatments without spending collision or draw budget', () => {
  const model = createKagariaiRoofRibModel({ THREE });
  assert.deepEqual(model.userData.assetModel.surface, {
    pass: 'surface-pass',
    materialFeatureGroups: {
      ceramic: {
        evidenceRefs: ['ceramic-edge-chips', 'ceramic-micro-crazing', 'seam-cavity-dirt'],
        treatments: ['uv-edge-wear', 'uv-seam-dirt', 'normal-highlight-breakup'],
      },
      copper: {
        evidenceRefs: ['copper-verdigris', 'copper-spine-segments'],
        treatments: ['directional-verdigris', 'roughness-breakup'],
      },
      iron: {
        evidenceRefs: ['hidden-end-joint', 'seam-cavity-dirt'],
        treatments: ['recess-darkening', 'edge-polish'],
      },
      brass: {
        evidenceRefs: ['finial-spear-profile'],
        treatments: ['collar-edge-polish', 'oxidized-blade-separation'],
      },
    },
    reviewViews: ['grazing-closeup'],
  });
  assert.equal(model.userData.assetModel.collision, 'none');
  assert.ok(model.userData.assetModel.performance.drawCalls <= 8);
});

test('roof-rib look-dev rig exposes neutral, grazing, and reference-matched lighting as reproducible public modes', () => {
  const rig = createKagariaiRoofRibLookDevLights({ THREE });
  assert.deepEqual(rig.userData.lightingProfile, {
    toneMapping: 'ACESFilmicToneMapping',
    exposure: { neutral: 1.18, grazing: 1.18, reference: 1.05 },
    background: { neutral: 0xc9cbc8, grazing: 0xc9cbc8, reference: 0xb0a49c },
    contactShadow: { receiver: 'matte-floor', softness: 'PCFSoftShadowMap' },
    modes: ['neutral', 'grazing', 'reference'],
  });
  for (const mode of rig.userData.lightingProfile.modes) {
    assert.equal(applyKagariaiRoofRibLightingMode(rig, mode), rig);
  }
  applyKagariaiRoofRibLightingMode(rig, 'reference');
  assert.equal(rig.userData.activeLightingMode, 'reference');
  assert.deepEqual(rig.getObjectByName('lookdev_key').position.toArray(), [-3.8, 4.2, 3.1]);
  assert.equal(rig.getObjectByName('lookdev_key').intensity, 3.25);
});

test('roof-rib interaction contract detaches the finial at a stable socket without enabling collision', () => {
  const model = createKagariaiRoofRibModel({ THREE, finial: 'right' });
  assert.deepEqual(model.userData.sculptRuntime.pivots, {
    root: 'kagariai_roof_rib_root',
    tileShell: 'tile_shell',
    finial: 'finial_pivot',
    endCaps: ['end_cap_left', 'end_cap_right'],
  });
  assert.deepEqual(model.userData.sculptRuntime.colliderProxies, {
    policy: 'presentation-only',
    enabled: false,
    proxies: [],
  });
  assert.deepEqual(model.userData.sculptRuntime.destructionGroups.finial, {
    members: ['finial_pivot'],
    mode: 'socket-detach',
    runtimeAdmissionRequired: true,
  });
  const finial = model.getObjectByName('finial_pivot');
  const spear = model.getObjectByName('finial_spear');
  spear.geometry.computeBoundingBox();
  const spearSize = spear.geometry.boundingBox.getSize(new THREE.Vector3());
  assert.ok(spearSize.y / spearSize.x >= 3, spearSize.toArray());
  const attachedPosition = finial.position.clone();
  assert.equal(setKagariaiRoofRibFinialDetached(model, true), model);
  assert.equal(finial.userData.interactionState, 'detached-preview');
  assert.ok(finial.position.distanceTo(attachedPosition) > 0.2);
  assert.equal(setKagariaiRoofRibFinialDetached(model, false), model);
  assert.equal(finial.userData.interactionState, 'attached');
  assert.ok(finial.position.distanceTo(attachedPosition) < 1e-9);
  assert.equal(model.userData.assetModel.collision, 'none');
});

test('roof-rib optimization contract batches repeated tiles and documents bounded runtime tiers', () => {
  const model = createKagariaiRoofRibModel({ THREE });
  assert.deepEqual(model.userData.assetModel.optimization, {
    pass: 'optimization-pass',
    fpsTarget: 60,
    budgets: { triangles: 5000, drawCalls: 8, textures: 16 },
    measured: model.userData.assetModel.performance,
    instancing: { tileInstances: 70, tileDrawCalls: 1, spineInstances: 10, hardwareInstances: 13 },
    lodStrategy: {
      status: 'documented-not-runtime-admitted',
      tiers: [
        { id: 'lod0', maxDistanceM: 12, materialMode: 'full-pbr' },
        { id: 'lod1', maxDistanceM: 28, materialMode: 'shared-pbr-reduced-anisotropy' },
        { id: 'cull', minDistanceM: 45 },
      ],
    },
  });
  assert.equal(model.userData.assetModel.performance.drawCalls, 5);
  assert.equal(model.userData.assetModel.performance.triangles, 2572);
});

test('roof-rib supports left, right, and absent finials without changing its collision policy', () => {
  for (const [side, expectedSocket] of [
    ['left', 'socket_finial_left'],
    ['right', 'socket_finial_right'],
  ]) {
    const model = createKagariaiRoofRibModel({ THREE, finial: side });
    const finial = model.getObjectByName('finial_pivot');
    assert.equal(finial.parent.name, expectedSocket);
    assert.equal(finial.userData.parentSocket, expectedSocket);
    assert.deepEqual(model.userData.sculptRuntime.detachable, ['finial_pivot']);
    model.traverse((object) => assert.notEqual(object.userData?.collision, true));
  }

  const model = createKagariaiRoofRibModel({ THREE, finial: 'none' });
  assert.equal(model.getObjectByName('finial_pivot'), undefined);
  assert.equal(model.userData.sculptRuntime.pivots.finial, null);
  assert.deepEqual(model.userData.sculptRuntime.detachable, []);
  assert.deepEqual(model.userData.sculptRuntime.attachments, []);
  assert.deepEqual(model.userData.sculptRuntime.destructionGroups.finial.members, []);
  model.traverse((object) => assert.notEqual(object.userData?.collision, true));
});

test('roof-rib disposal is idempotent, deduplicates shared resources, and respects texture ownership', () => {
  const textureDisposals = [];
  const pbrTextures = Object.fromEntries(['ceramic', 'iron', 'copper', 'brass'].map((family) => [
    family,
    Object.fromEntries(['albedo', 'normal', 'roughness', 'ao'].map((channel) => {
      const texture = new THREE.Texture();
      texture.name = `${family}_${channel}`;
      texture.addEventListener('dispose', () => textureDisposals.push(texture.name));
      return [channel, texture];
    })),
  ]));
  const model = createKagariaiRoofRibModel({ THREE, pbrTextures, ownsPbrTextures: true });
  const geometries = new Set();
  const materials = new Set();
  const geometryDisposals = [];
  const materialDisposals = [];
  model.traverse((object) => {
    if (object.geometry) geometries.add(object.geometry);
    const objectMaterials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of objectMaterials) if (material) materials.add(material);
  });
  for (const geometry of geometries) geometry.addEventListener('dispose', () => geometryDisposals.push(geometry.uuid));
  for (const material of materials) material.addEventListener('dispose', () => materialDisposals.push(material.uuid));

  assert.equal(model.userData.assetModel.resourceOwnership.textures, 'factory-owned');
  assert.equal(disposeKagariaiRoofRibModel(model), true);
  assert.equal(disposeKagariaiRoofRibModel(model), false);
  assert.equal(geometryDisposals.length, geometries.size);
  assert.equal(new Set(geometryDisposals).size, geometries.size);
  assert.equal(materialDisposals.length, materials.size);
  assert.equal(new Set(materialDisposals).size, materials.size);
  assert.equal(textureDisposals.length, 16);
  assert.equal(new Set(textureDisposals).size, 16);
  assert.equal(model.children.length, 0);
  assert.deepEqual(model.userData.materials, []);

  const borrowedTexture = new THREE.Texture();
  let borrowedDisposals = 0;
  borrowedTexture.addEventListener('dispose', () => { borrowedDisposals += 1; });
  const borrowedMaps = Object.fromEntries(['ceramic', 'iron', 'copper', 'brass'].map((family) => [
    family,
    { albedo: borrowedTexture, normal: borrowedTexture, roughness: borrowedTexture, ao: borrowedTexture },
  ]));
  const borrowedModel = createKagariaiRoofRibModel({ THREE, pbrTextures: borrowedMaps });
  assert.equal(borrowedModel.userData.assetModel.resourceOwnership.textures, 'borrowed');
  disposeKagariaiRoofRibModel(borrowedModel);
  assert.equal(borrowedDisposals, 0);
});

test('roof-rib runtime proposal stays fail-closed and places every candidate outside competitive bounds', () => {
  const candidate = KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE;
  assert.equal(candidate.state, 'candidate-review-open');
  assert.equal(candidate.enabled, false);
  assert.equal(candidate.collisionPolicy, 'presentation-only-no-collision');
  assert.equal(candidate.placements.length, 3);
  assert.deepEqual(candidate.aggregateWorstCaseBudget, {
    triangles: 7716,
    drawCalls: 15,
    textures: 16,
  });
  const supportLayer = OSHIOI_PRESENTATION.layers.find(layer => layer.id === 'district-hip-roofs');
  assert.ok(supportLayer);
  for (const placement of candidate.placements) {
    const [x, y] = placement.position;
    const outsidePlayable = x < -126 || x > 126 || y < -92 || y > 92;
    const insideVisual = x >= -180 && x <= 180 && y >= -140 && y <= 140;
    assert.equal(outsidePlayable, true, placement.id);
    assert.equal(insideVisual, true, placement.id);
    assert.equal(placement.semantics, 'outside-playable-bounds');
    assert.equal(placement.support.layerId, 'district-hip-roofs');
    const support = supportLayer.transforms[placement.support.transformIndex];
    assert.ok(Math.abs(placement.position[0] - support.position[0]) < 1e-9, placement.id);
    assert.ok(Math.abs(placement.position[1] - support.position[1]) < 1e-9, placement.id);
    const supportTopZ = support.position[2] + support.scale[2] / 2;
    assert.ok(Math.abs(placement.position[2] - supportTopZ) < 1e-9, placement.id);
    assert.equal(placement.support.supportTopZ, placement.position[2]);
  }
  assert.equal(Object.isFrozen(candidate), true);
  assert.equal(Object.isFrozen(candidate.placements), true);
  assert.throws(
    () => assertKagariaiRoofRibRuntimeAdmission(candidate),
    /ROOF_RIB_RUNTIME_ADMISSION_BLOCKED:enabled,state,humanArt,competitiveSafety$/,
  );
});

test('roof-rib admission pins completed live-renderer evidence without clearing human gates', () => {
  const candidate = KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE;
  const evidenceBytes = readFileSync(new URL(
    '../docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json', import.meta.url,
  ));
  const evidence = JSON.parse(evidenceBytes);
  assert.equal(candidate.gates.runtimeRenderer, 'pass');
  assert.deepEqual(candidate.rendererEvidence, {
    status: 'pass',
    reportPath: 'docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json',
    reportSha256: '3778DEA513E220BA1357FF2D600FE1C1A3F47B9931535F3ED8F3D1877199B1A5',
    scene: 'production-SceneRenderer-review-only',
    views: 3,
    consoleErrors: 0,
    consoleWarnings: 0,
  });
  assert.equal(createHash('sha256').update(evidenceBytes).digest('hex').toUpperCase(),
    candidate.rendererEvidence.reportSha256);
  assert.equal(evidence.productionEnabled, false);
  assert.equal(evidence.collision, 'none');
  assert.equal(evidence.views.length, 3);
  assert.equal(evidence.automatedVerification.tests.passed, 894);
  assert.equal(candidate.gates.humanArt, 'pending');
  assert.equal(candidate.gates.competitiveSafety, 'pending');
});

test('roof-rib runtime adapter refuses the current unadmitted candidate before constructing scene objects', () => {
  assert.throws(
    () => createKagariaiRoofRibRuntimeGroup({ THREE }),
    /ROOF_RIB_RUNTIME_ADMISSION_BLOCKED:enabled,state,humanArt,competitiveSafety$/,
  );
});

test('roof-rib map review admission is immutable, visibly candidate-only, and remains invalid for production', () => {
  const review = createKagariaiRoofRibReviewAdmission();
  assert.equal(review.state, 'review-only');
  assert.equal(review.enabled, false);
  assert.equal(review.reviewOnly, true);
  assert.equal(review.gates.humanArt, 'pending');
  assert.equal(review.gates.competitiveSafety, 'pending');
  assert.equal(review.gates.runtimeRenderer, 'pass');
  assert.equal(Object.isFrozen(review), true);
  assert.equal(Object.isFrozen(review.placements), true);
  assert.throws(() => assertKagariaiRoofRibRuntimeAdmission(review), /enabled,state,humanArt,competitiveSafety$/);

  const group = createKagariaiRoofRibMapReviewGroup({ THREE, admission: review });
  assert.equal(group.name, 'kagariai_roof_rib_map_review_group');
  assert.equal(group.userData.reviewOnly, true);
  assert.equal(group.userData.collision, false);
  assert.equal(group.children.length, 3);
  for (const slot of group.children) {
    const model = slot.getObjectByName('kagariai_roof_rib_root');
    assert.equal(model.userData.assetModel.candidateOnly, true);
    assert.equal(model.userData.assetModel.reviewOnly, true);
    assert.equal(model.userData.assetModel.collision, 'none');
  }
  disposeKagariaiRoofRibRuntimeGroup(group);
});

test('roof-rib live-map review requires localhost and an explicit opt-in while normalizing review controls', () => {
  assert.deepEqual(resolveKagariaiRoofRibReviewRequest({
    protocol: 'https:', hostname: 'play.example.com', search: '?roofRibReview=1',
  }), {
    enabled: false,
    reason: 'non-local-host',
    site: 'west',
    distanceM: 12,
    lighting: 'day',
  });
  assert.deepEqual(resolveKagariaiRoofRibReviewRequest({
    protocol: 'http:', hostname: '127.0.0.1', search: '',
  }), {
    enabled: false,
    reason: 'not-requested',
    site: 'west',
    distanceM: 12,
    lighting: 'day',
  });
  assert.deepEqual(resolveKagariaiRoofRibReviewRequest({
    protocol: 'http:', hostname: 'localhost',
    search: '?roofRibReview=1&roofRibSite=east&roofRibDistance=45&roofRibLighting=backlit',
  }), {
    enabled: true,
    reason: 'explicit-local-review',
    site: 'east',
    distanceM: 45,
    lighting: 'backlit',
  });
  assert.deepEqual(resolveKagariaiRoofRibReviewRequest({
    protocol: 'http:', hostname: '::1',
    search: '?roofRibReview=1&roofRibSite=unknown&roofRibDistance=99&roofRibLighting=noir',
  }), {
    enabled: true,
    reason: 'explicit-local-review',
    site: 'west',
    distanceM: 12,
    lighting: 'day',
  });
});

test('roof-rib admission cannot be bypassed with collision drift, an interior placement, or stale evidence', () => {
  const admission = structuredClone(KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE);
  admission.enabled = true;
  admission.state = 'runtime-admitted';
  admission.gates.humanArt = 'pass';
  admission.gates.competitiveSafety = 'pass';
  admission.gates.runtimeRenderer = 'pass';
  admission.rendererEvidence.reportSha256 = 'STALE';
  admission.collisionPolicy = 'visual-mesh-collision';
  admission.gates.collisionDigest = 'pending';
  admission.placements[0].position = [0, 0, 2];

  assert.throws(
    () => assertKagariaiRoofRibRuntimeAdmission(admission),
    /ROOF_RIB_RUNTIME_ADMISSION_BLOCKED:collisionPolicy,gate:collisionDigest,rendererEvidence,placement:north-roof-rib-west:competitive-envelope/,
  );
});

test('roof-rib runtime adapter converts Y-up factory models into the map Z-up frame at pinned supports', () => {
  const admission = structuredClone(KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE);
  admission.enabled = true;
  admission.state = 'runtime-admitted';
  admission.gates.humanArt = 'pass';
  admission.gates.competitiveSafety = 'pass';
  admission.gates.runtimeRenderer = 'pass';
  const group = createKagariaiRoofRibRuntimeGroup({ THREE, admission });

  assert.equal(group.name, 'kagariai_roof_rib_runtime_group');
  assert.equal(group.children.length, 3);
  assert.equal(group.userData.collision, false);
  assert.deepEqual(group.userData.performanceWorstCase, {
    triangles: 7716,
    drawCalls: 15,
    textures: 16,
  });
  group.updateMatrixWorld(true);
  for (const [index, placement] of admission.placements.entries()) {
    const slot = group.children[index];
    const model = slot.getObjectByName('kagariai_roof_rib_root');
    assert.equal(slot.name, placement.id);
    assert.deepEqual(slot.position.toArray(), placement.position);
    assert.deepEqual(slot.scale.toArray(), placement.scale);
    assert.ok(Math.abs(model.rotation.x - Math.PI / 2) < 1e-12);
    const installedBounds = new THREE.Box3().setFromObject(model);
    assert.ok(Math.abs(installedBounds.min.z - placement.support.supportTopZ) < 1e-6,
      `${placement.id} clearance=${installedBounds.min.z - placement.support.supportTopZ}`);
    assert.deepEqual(model.userData.assetModel.supportFit, {
      mode: 'support-contact',
      verticalOffsetM: -0.07,
      clearanceM: 0,
    });
    const worldUp = new THREE.Vector3(0, 1, 0).applyQuaternion(model.quaternion);
    assert.ok(worldUp.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-12);
    assert.equal(model.userData.assetModel.candidateOnly, false);
    assert.equal(model.userData.assetModel.runtimeAdmissionId, admission.assetId);
    assert.equal(model.userData.assetModel.collision, 'none');
    const finial = model.getObjectByName('finial_pivot');
    assert.equal(finial ? finial.parent.name.endsWith(placement.finial) : placement.finial === 'none', true);
  }
});

test('roof-rib runtime group disposal releases every child once and preserves borrowed shared textures', () => {
  const admission = structuredClone(KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE);
  admission.enabled = true;
  admission.state = 'runtime-admitted';
  for (const gate of ['humanArt', 'competitiveSafety', 'runtimeRenderer']) admission.gates[gate] = 'pass';
  const sharedTexture = new THREE.Texture();
  let textureDisposals = 0;
  sharedTexture.addEventListener('dispose', () => { textureDisposals += 1; });
  const pbrTextures = Object.fromEntries(['ceramic', 'iron', 'copper', 'brass'].map(family => [
    family,
    { albedo: sharedTexture, normal: sharedTexture, roughness: sharedTexture, ao: sharedTexture },
  ]));
  const group = createKagariaiRoofRibRuntimeGroup({ THREE, admission, pbrTextures });
  const models = group.userData.runtimeModels.slice();

  assert.equal(disposeKagariaiRoofRibRuntimeGroup(group), true);
  assert.equal(disposeKagariaiRoofRibRuntimeGroup(group), false);
  assert.equal(textureDisposals, 0);
  assert.equal(group.children.length, 0);
  assert.deepEqual(group.userData.runtimeModels, []);
  for (const model of models) {
    assert.equal(model.userData.disposed, true);
    assert.deepEqual(model.userData.materials, []);
  }
});
