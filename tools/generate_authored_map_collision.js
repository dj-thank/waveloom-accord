#!/usr/bin/env node
// Deterministic, offline collision inspection/generation for the checked-in GLB.
import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AUTHORED_COLLISION_MANIFEST } from '../shared/data/map_oshioi_authored_collision.js';
import {
  AUTHORED_COLLISION_PROTECTED_ROUTES,
  AUTHORED_MAP_TRANSFORM,
  buildMap,
} from '../shared/data/map_oshioi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GLB_PATH = path.join(ROOT, 'client', 'assets', 'chicken_gun_fruzer_mine.glb');
const MANIFEST_PATH = path.join(ROOT, 'shared', 'data', 'map_oshioi_authored_collision.js');
const EXPECTED_ASSET_SHA256 = 'DC9017A5F1D875B7CB45C00183E158491FAE042F6A33CE8EC42FCA8D9CA2E597';
const SCHEMA_VERSION = 1;
const QUANTIZE_DIGITS = 6;
const PLAYER_RADIUS_M = 0.4;
const PLAYER_HEIGHT_M = 1.7;
const COLLISION_ENVELOPE = Object.freeze({ min: [-47, -35, -1], max: [47, 35, 10] });

// Deny is evaluated before allow. These regex strings are serialized into the
// manifest so selection changes remain explicit and code-reviewable.
export const SELECTION_RULES = Object.freeze({
  allow: Object.freeze([
    Object.freeze({ id: 'quarry-wall', pattern: '^SM_Env_Quarry_Wall_', tag: 'authored-wall' }),
    Object.freeze({ id: 'building-shell', pattern: '^SM_Bld_', tag: 'authored-building' }),
    Object.freeze({ id: 'mine-blocker', pattern: '^SM_Env_Mine_(?:Entrance_Blocked|Tunnel_Blocker)', tag: 'authored-blocker' }),
    Object.freeze({ id: 'natural-cover', pattern: '^SM_Env_(?:RockTall|Quarry_Rocks_)', tag: 'authored-rock', minSpanM: 0.55, maxSpanM: 12 }),
  ]),
  deny: Object.freeze([
    Object.freeze({ id: 'terrain', pattern: '^SM_Env_(?:Mound|Quarry_Ground|Road_)', reason: 'canonical floor and routes remain authoritative' }),
    Object.freeze({ id: 'ramps', pattern: 'Wall_Ramp', reason: 'a single AABB would turn a traversable slope into a wall' }),
    Object.freeze({ id: 'open-mine-shells', pattern: '^SM_Env_Mine_(?:Entrance_01|Framing|Tunnel_(?!Blocker))', reason: 'a mesh AABB would seal authored openings' }),
    Object.freeze({ id: 'track-detail', pattern: '^SM_Env_Mine_Track_', reason: 'thin rail detail is not player-blocking structure' }),
    Object.freeze({ id: 'small-props', pattern: '^SM_Prop_', reason: 'decorative prop' }),
    Object.freeze({ id: 'building-openings', pattern: '(?:_Door_|_Glass(?:_|$)|^SM_Bld_(?:Tent|Outhouse))', reason: 'dynamic/open/decorative building part' }),
  ]),
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex').toUpperCase();
}

function quantize(value) {
  const rounded = Number(Number(value).toFixed(QUANTIZE_DIGITS));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function quantizedArray(values) {
  return Array.from(values, quantize);
}

function assertNear(actual, expected, label, tolerance = 1e-6) {
  if (!Number.isFinite(actual) || Math.abs(actual - expected) > tolerance) {
    throw new Error(`${label} drifted: expected ${expected}, received ${actual}`);
  }
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function protectedFixtures(map) {
  const fixtures = [];
  for (const [side, spawns] of Object.entries(map.spawns)) {
    for (let index = 0; index < spawns.length; index++) {
      fixtures.push({ id: `spawn:${side}:${index}`, pos: spawns[index].pos, radius: PLAYER_RADIUS_M, height: PLAYER_HEIGHT_M });
    }
  }
  fixtures.push({ id: 'objective:center', pos: map.objective.center, radius: PLAYER_RADIUS_M, height: PLAYER_HEIGHT_M });
  for (const pickup of map.pickups) {
    fixtures.push({ id: `pickup:${pickup.id}`, pos: pickup.pos, radius: PLAYER_RADIUS_M, height: PLAYER_HEIGHT_M });
  }
  for (const [route, points] of Object.entries(AUTHORED_COLLISION_PROTECTED_ROUTES)) {
    for (let index = 0; index < points.length; index++) {
      fixtures.push({ id: `route:${route}:${index}`, pos: points[index], radius: 0.55, height: PLAYER_HEIGHT_M });
      if (index === 0) continue;
      const from = points[index - 1];
      const to = points[index];
      const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const steps = Math.max(1, Math.ceil(distance / 0.25));
      for (let sample = 1; sample < steps; sample++) {
        const ratio = sample / steps;
        fixtures.push({
          id: `route:${route}:${index - 1}-${index}:${sample}`,
          pos: from.map((value, axis) => value + (to[axis] - value) * ratio),
          radius: 0.55,
          height: PLAYER_HEIGHT_M,
        });
      }
    }
  }
  return fixtures;
}

function circleOverlapsBox(cx, cy, radius, box) {
  const x = Math.max(box.min[0], Math.min(cx, box.max[0]));
  const y = Math.max(box.min[1], Math.min(cy, box.max[1]));
  return (cx - x) ** 2 + (cy - y) ** 2 < radius ** 2;
}

function proxyOverlapsFixture(proxy, fixture) {
  const zLo = fixture.pos[2];
  const zHi = zLo + fixture.height;
  return proxy.max[2] > zLo && proxy.min[2] < zHi
    && circleOverlapsBox(fixture.pos[0], fixture.pos[1], fixture.radius, proxy);
}

function clipBox(box) {
  const min = box.min.map((value, axis) => Math.max(value, COLLISION_ENVELOPE.min[axis]));
  const max = box.max.map((value, axis) => Math.min(value, COLLISION_ENVELOPE.max[axis]));
  if (min.some((value, axis) => value >= max[axis])) return null;
  return { min: quantizedArray(min), max: quantizedArray(max) };
}

function pointDistanceSquaredToBox(point, box) {
  let distance = 0;
  for (let axis = 0; axis < 3; axis++) {
    if (point[axis] < box.min[axis]) distance += (box.min[axis] - point[axis]) ** 2;
    else if (point[axis] > box.max[axis]) distance += (point[axis] - box.max[axis]) ** 2;
  }
  return distance;
}

function withinEnvelope(point) {
  return point.every((value, axis) => value >= COLLISION_ENVELOPE.min[axis] && value <= COLLISION_ENVELOPE.max[axis]);
}

function scenePointToGame(point) {
  const components = { x: point.x, y: point.y, z: point.z };
  return AUTHORED_MAP_TRANSFORM.gameFromSceneAxes.map(axis => {
    const sign = axis.startsWith('-') ? -1 : 1;
    return sign * components[axis.replace(/^-/, '')];
  });
}

function meshRule(name, proxy) {
  const denied = SELECTION_RULES.deny.find(rule => new RegExp(rule.pattern).test(name));
  if (denied) return { selected: false, reason: denied.id };
  const allowed = SELECTION_RULES.allow.find(rule => new RegExp(rule.pattern).test(name));
  if (!allowed) return { selected: false, reason: 'not-structural' };
  const spans = proxy.max.map((value, axis) => value - proxy.min[axis]);
  if (allowed.minSpanM && Math.max(...spans) < allowed.minSpanM) return { selected: false, reason: 'below-min-span' };
  if (allowed.maxSpanM && Math.max(spans[0], spans[1]) > allowed.maxSpanM) return { selected: false, reason: 'above-max-span' };
  return { selected: true, rule: allowed };
}

function meshHash(mesh, association) {
  const hash = createHash('sha256');
  hash.update(`${mesh.name}\0${association.nodes}\0${association.meshes}\0`);
  hash.update(stableJson(quantizedArray(mesh.matrixWorld.elements)));
  const position = mesh.geometry.getAttribute('position');
  hash.update(Buffer.from(position.array.buffer, position.array.byteOffset, position.array.byteLength));
  if (mesh.geometry.index) {
    const index = mesh.geometry.index.array;
    hash.update(Buffer.from(index.buffer, index.byteOffset, index.byteLength));
  }
  return hash.digest('hex').toUpperCase();
}

function loadTexturelessPlugin() {
  return { name: 'NO_TEXTURES_FOR_COLLISION', loadTexture: () => Promise.resolve(null) };
}

async function loadGlb(bytes) {
  globalThis.ProgressEvent ??= class ProgressEvent {
    constructor(type, init = {}) { this.type = type; Object.assign(this, init); }
  };
  const loader = new GLTFLoader();
  loader.register(loadTexturelessPlugin);
  const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return loader.parseAsync(arrayBuffer, pathToFileURL(path.dirname(GLB_PATH) + path.sep).href);
}

function transformedGamePoints(mesh) {
  const position = mesh.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  const points = new Array(position.count);
  for (let index = 0; index < position.count; index++) {
    point.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
    points[index] = scenePointToGame(point);
  }
  return points;
}

function gameBoxForMesh(mesh) {
  const sceneBox = new THREE.Box3().setFromObject(mesh, true);
  return clipBox({
    min: [sceneBox.min.x, -sceneBox.max.z, sceneBox.min.y],
    max: [sceneBox.max.x, -sceneBox.min.z, sceneBox.max.y],
  });
}

function countCoverage(points, proxies, thresholdM = 0.25) {
  const thresholdSquared = thresholdM ** 2;
  let eligible = 0;
  let covered = 0;
  for (const point of points) {
    if (!withinEnvelope(point)) continue;
    eligible++;
    if (proxies.some(proxy => pointDistanceSquaredToBox(point, proxy) <= thresholdSquared)) covered++;
  }
  return { eligible, covered, ratio: eligible ? quantize(covered / eligible) : 0 };
}

export async function generateCollisionManifest() {
  const bytes = await readFile(GLB_PATH);
  const assetSha256 = sha256(bytes);
  if (assetSha256 !== EXPECTED_ASSET_SHA256) throw new Error(`GLB SHA-256 mismatch: ${assetSha256}`);

  const gltf = await loadGlb(bytes);
  const scene = gltf.scene;
  scene.updateMatrixWorld(true);
  const sourceBounds = new THREE.Box3().setFromObject(scene);
  for (let axis = 0; axis < 3; axis++) {
    assertNear(sourceBounds.min.getComponent(axis), AUTHORED_MAP_TRANSFORM.sourceBounds.min[axis], `sourceBounds.min[${axis}]`);
    assertNear(sourceBounds.max.getComponent(axis), AUTHORED_MAP_TRANSFORM.sourceBounds.max[axis], `sourceBounds.max[${axis}]`);
  }
  scene.scale.setScalar(AUTHORED_MAP_TRANSFORM.scale);
  scene.position.fromArray(AUTHORED_MAP_TRANSFORM.scenePosition);
  scene.updateMatrixWorld(true);

  const map = buildMap();
  const fixtures = protectedFixtures(map);
  // This manifest audits the historical decorative GLB against the original
  // 92 x 68 m reference courtyard, not against later competitive expansions.
  // Keep that evidence byte-stable even though the live five-site map removes
  // the two reference side walls to open its east/west connectors.
  const canonical = map.solids.filter(solid => solid.id?.startsWith('canonical-'));
  canonical.push(
    { id: 'canonical-002-wall', min: [-47, -34, 0], max: [-46, 34, 10], tag: 'wall' },
    { id: 'canonical-003-wall', min: [46, -34, 0], max: [47, 34, 10], tag: 'wall' },
  );
  const meshes = [];
  scene.traverse(object => { if (object.isMesh) meshes.push(object); });
  const associations = gltf.parser.associations;
  meshes.sort((left, right) => associations.get(left).nodes - associations.get(right).nodes);

  const selectedMeshes = [];
  const proxies = [];
  const allPoints = [];
  const selectedPoints = [];
  const exclusionCounts = {};
  let sourceVertexCount = 0;
  let sourceTriangleCount = 0;
  let selectedVertexCount = 0;
  let selectedTriangleCount = 0;

  for (const mesh of meshes) {
    const association = associations.get(mesh);
    if (!association || !Number.isInteger(association.nodes) || !Number.isInteger(association.meshes)) {
      throw new Error(`GLTFLoader association missing for ${mesh.name}`);
    }
    const points = transformedGamePoints(mesh);
    allPoints.push(...points);
    const vertexCount = points.length;
    const triangleCount = mesh.geometry.index ? mesh.geometry.index.count / 3 : vertexCount / 3;
    sourceVertexCount += vertexCount;
    sourceTriangleCount += triangleCount;
    const proxyBounds = gameBoxForMesh(mesh);
    if (!proxyBounds) {
      exclusionCounts['outside-playfield'] = (exclusionCounts['outside-playfield'] || 0) + 1;
      continue;
    }
    const decision = meshRule(mesh.name, proxyBounds);
    if (!decision.selected) {
      exclusionCounts[decision.reason] = (exclusionCounts[decision.reason] || 0) + 1;
      continue;
    }
    const conflict = fixtures.find(fixture => proxyOverlapsFixture(proxyBounds, fixture));
    if (conflict) {
      const reason = `protected-${conflict.id.split(':')[0]}`;
      exclusionCounts[reason] = (exclusionCounts[reason] || 0) + 1;
      continue;
    }

    const sourceNode = association.nodes;
    const sourceMesh = association.meshes;
    const hash = meshHash(mesh, association);
    const proxyIndex = proxies.length;
    proxies.push({
      min: proxyBounds.min,
      max: proxyBounds.max,
      tag: decision.rule.tag,
      provenance: { kind: 'authored-glb', sourceNode, sourceMesh, ruleId: decision.rule.id },
    });
    selectedMeshes.push({
      sourceNode,
      sourceMesh,
      name: mesh.name,
      meshHash: hash,
      sceneMatrix: quantizedArray(mesh.matrixWorld.elements),
      ruleId: decision.rule.id,
      vertexCount,
      triangleCount,
      proxyStart: proxyIndex,
      proxyCount: 1,
    });
    selectedPoints.push(...points);
    selectedVertexCount += vertexCount;
    selectedTriangleCount += triangleCount;
  }

  const transformHash = sha256(stableJson(AUTHORED_MAP_TRANSFORM));
  const selectedCoverage = countCoverage(selectedPoints, proxies);
  const authoredCoverage = countCoverage(allPoints, proxies);
  const combinedCoverage = countCoverage(allPoints, [...canonical, ...proxies]);
  const core = {
    schemaVersion: SCHEMA_VERSION,
    assetSha256,
    assetByteLength: bytes.byteLength,
    transformHash,
    transform: AUTHORED_MAP_TRANSFORM,
    collisionEnvelope: COLLISION_ENVELOPE,
    rules: SELECTION_RULES,
    stats: {
      sourceNodeCount: gltf.parser.json.nodes.length,
      sourceMeshCount: meshes.length,
      sourceVertexCount,
      sourceTriangleCount,
      selectedMeshCount: selectedMeshes.length,
      selectedVertexCount,
      selectedTriangleCount,
      proxyCount: proxies.length,
      selectedVertexRatio: quantize(selectedVertexCount / sourceVertexCount),
      selectedProxyCoverageWithin0_25M: selectedCoverage.ratio,
      authoredVertexCoverageWithin0_25M: authoredCoverage.ratio,
      canonicalPlusAuthoredVertexCoverageWithin0_25M: combinedCoverage.ratio,
      inPlayfieldVertexCount: authoredCoverage.eligible,
      exclusionCounts,
    },
    selectedMeshes,
    proxies,
  };
  return Object.freeze({ ...core, manifestHash: sha256(stableJson(core)) });
}

export function renderManifestModule(manifest) {
  return `// Generated by tools/generate_authored_map_collision.js. Do not hand edit.\n`
    + `function deepFreeze(value) {\n`
    + `  if (value && typeof value === 'object' && !Object.isFrozen(value)) {\n`
    + `    Object.freeze(value);\n`
    + `    for (const child of Object.values(value)) deepFreeze(child);\n`
    + `  }\n`
    + `  return value;\n`
    + `}\n\n`
    + `export const AUTHORED_COLLISION_MANIFEST = deepFreeze(${JSON.stringify(manifest, null, 2)});\n`;
}

function inspectionSummary(manifest) {
  return {
    assetSha256: manifest.assetSha256,
    transformHash: manifest.transformHash,
    manifestHash: manifest.manifestHash,
    transform: manifest.transform,
    stats: manifest.stats,
    selectedMeshes: manifest.selectedMeshes.map(mesh => ({
      sourceNode: mesh.sourceNode,
      sourceMesh: mesh.sourceMesh,
      name: mesh.name,
      meshHash: mesh.meshHash,
      sceneMatrix: mesh.sceneMatrix,
      ruleId: mesh.ruleId,
      proxyStart: mesh.proxyStart,
      proxyCount: mesh.proxyCount,
    })),
  };
}

async function main(args) {
  const manifest = await generateCollisionManifest();
  if (args.includes('--stdout')) {
    process.stdout.write(renderManifestModule(manifest));
    return;
  }
  if (args.includes('--write')) {
    const temporaryPath = `${MANIFEST_PATH}.tmp-${process.pid}`;
    await writeFile(temporaryPath, renderManifestModule(manifest), 'utf8');
    await rename(temporaryPath, MANIFEST_PATH);
    console.log(`wrote authored collision manifest ${manifest.manifestHash}`);
    return;
  }
  if (args.includes('--check')) {
    if (stableJson(manifest) !== stableJson(AUTHORED_COLLISION_MANIFEST)) {
      throw new Error('generated authored collision manifest is stale; run with --stdout and apply the diff');
    }
    console.log(`authored collision manifest OK ${manifest.manifestHash}`);
    return;
  }
  console.log(JSON.stringify(inspectionSummary(manifest), null, 2));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(error => {
    console.error(error?.stack || error);
    process.exitCode = 1;
  });
}
