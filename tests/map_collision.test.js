import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collider } from '../shared/sim/collision.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { AUTHORED_COLLISION_MANIFEST as manifest } from '../shared/data/map_oshioi_authored_collision.js';
import { generateCollisionManifest } from '../tools/generate_authored_map_collision.js';

const PLAYER_RADIUS_M = 0.4;
const PLAYER_HEIGHT_M = 1.7;
const EXPECTED_MANIFEST_HASH = 'D4D471A28169A82C20D34D47E7DEBA99C271268646737BD3E93A0C6292D95219';

function authoredCollider() {
  return new Collider(manifest.proxies);
}

test('every curated structural mesh has a traceable authored proxy', () => {
  assert.equal(manifest.stats.sourceMeshCount, 422);
  assert.equal(manifest.stats.selectedMeshCount, 133);
  assert.equal(manifest.stats.proxyCount, 133);
  assert.equal(manifest.selectedMeshes.length, manifest.stats.selectedMeshCount);
  assert.equal(manifest.proxies.length, manifest.stats.proxyCount);

  for (const mesh of manifest.selectedMeshes) {
    assert.match(mesh.name, /^(?:SM_Bld_|SM_Env_)/);
    assert.doesNotMatch(mesh.name, /(?:_Door_|_Glass(?:_|$)|^SM_Bld_(?:Tent|Outhouse))/);
    assert.match(mesh.meshHash, /^[A-F0-9]{64}$/);
    assert.equal(mesh.sceneMatrix.length, 16);
    assert.ok(mesh.sceneMatrix.every(Number.isFinite));
    assert.ok(mesh.proxyCount > 0, `${mesh.name} has no proxy`);
    const owned = manifest.proxies.slice(mesh.proxyStart, mesh.proxyStart + mesh.proxyCount);
    assert.equal(owned.length, mesh.proxyCount);
    for (const proxy of owned) {
      assert.equal(proxy.provenance.kind, 'authored-glb');
      assert.equal(proxy.provenance.sourceNode, mesh.sourceNode);
      assert.equal(proxy.provenance.sourceMesh, mesh.sourceMesh);
      assert.equal(proxy.provenance.ruleId, mesh.ruleId);
    }
  }
});

test('authored proxy data remains inspectable but cannot silently enter runtime collision', () => {
  const wall = manifest.selectedMeshes.find(mesh => mesh.sourceNode === 407);
  assert.equal(wall?.name, 'SM_Env_Quarry_Wall_Straight_01__1__PolygonWesternFrontier_Texture_01_A_0');
  const map = buildMap();
  const referenceHit = authoredCollider().raycast(10, -2, 5, 1, 0, 0, 10);
  assert.ok(Math.abs(referenceHit - 1.791618) <= 1e-6, `unexpected reference hit ${referenceHit}`);
  assert.equal(new Collider(map.solids).raycast(10, -2, 5, 1, 0, 0, 10), Infinity);
  assert.equal(map.visualAsset.collision, false);
});

test('authored fixtures and runtime collision preserve gameplay route clearance', () => {
  const map = buildMap();
  const authored = authoredCollider();
  const runtime = new Collider(map.solids);
  const fixtures = [
    ...Object.entries(map.spawns).flatMap(([side, spawns]) => spawns.map((spawn, index) => ({ id: `spawn:${side}:${index}`, pos: spawn.pos, radius: PLAYER_RADIUS_M }))),
    { id: 'objective:center', pos: map.objective.center, radius: PLAYER_RADIUS_M },
    ...map.pickups.map(pickup => ({ id: `pickup:${pickup.id}`, pos: pickup.pos, radius: PLAYER_RADIUS_M })),
  ];
  for (const fixture of fixtures) {
    assert.equal(
      authored.overlapsCylinder(...fixture.pos, fixture.radius, PLAYER_HEIGHT_M),
      false,
      `${fixture.id} is blocked by an authored proxy`,
    );
  }
  for (const [route, points] of Object.entries(map.routes)) {
    for (let index = 1; index < points.length; index++) {
      const from = points[index - 1];
      const to = points[index];
      const distance = Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
      const steps = Math.max(1, Math.ceil(distance / 0.25));
      for (let sample = 0; sample <= steps; sample++) {
        const ratio = sample / steps;
        const pos = from.map((value, axis) => value + (to[axis] - value) * ratio);
        assert.equal(
          runtime.overlapsCylinder(...pos, 0.55, PLAYER_HEIGHT_M),
          false,
          `route:${route}:${index - 1}-${index}@${ratio.toFixed(3)} is blocked by an authored proxy`,
        );
      }
    }
  }
  const combined = new Collider(map.solids);
  const combinedFixtures = [
    ...Object.values(map.spawns).flatMap(spawns => spawns.map(spawn => spawn.pos)),
    ...map.pickups.map(pickup => pickup.pos),
    [3, 0, map.objective.center[2]],
  ];
  for (const pos of combinedFixtures) {
    assert.equal(combined.overlapsCylinder(...pos, PLAYER_RADIUS_M, PLAYER_HEIGHT_M), false, `gameplay fixture ${pos} is blocked`);
  }
});

test('every spawn faces a clear exit that joins an authored route', () => {
  const map = buildMap();
  const collider = new Collider(map.solids);
  for (const [side, spawns] of Object.entries(map.spawns)) {
    const routeStarts = Object.values(map.routes).map(points => {
      const point = points[0];
      return side === 'west' ? [-point[0], -point[1], point[2]] : point;
    });
    for (const [index, spawn] of spawns.entries()) {
      for (let distance = 0; distance <= 4; distance += 0.2) {
        const pos = [
          spawn.pos[0] + Math.cos(spawn.yaw) * distance,
          spawn.pos[1] + Math.sin(spawn.yaw) * distance,
          spawn.pos[2],
        ];
        assert.equal(
          collider.overlapsCylinder(...pos, PLAYER_RADIUS_M, PLAYER_HEIGHT_M),
          false,
          `spawn:${side}:${index} faces a wall at ${distance.toFixed(1)}m`,
        );
      }
      const endpoint = [
        spawn.pos[0] + Math.cos(spawn.yaw) * 4,
        spawn.pos[1] + Math.sin(spawn.yaw) * 4,
        spawn.pos[2],
      ];
      const nearestRoute = Math.min(...routeStarts.map(point => (
        Math.hypot(endpoint[0] - point[0], endpoint[1] - point[1])
      )));
      assert.ok(nearestRoute <= 2,
        `spawn:${side}:${index} does not face a route entrance (${nearestRoute.toFixed(2)}m)`);
    }
  }
});

test('proxy manifest remains deterministic while runtime collision and presentation share canonical geometry', () => {
  const envelope = manifest.collisionEnvelope;
  assert.deepEqual(envelope, { min: [-47, -35, -1], max: [47, 35, 10] });
  const aggregateMin = [Infinity, Infinity, Infinity];
  const aggregateMax = [-Infinity, -Infinity, -Infinity];
  let previousNode = -1;
  for (const proxy of manifest.proxies) {
    assert.ok(proxy.provenance.sourceNode > previousNode, 'proxies are not ordered by GLB node index');
    previousNode = proxy.provenance.sourceNode;
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(proxy.min[axis] >= envelope.min[axis]);
      assert.ok(proxy.max[axis] <= envelope.max[axis]);
      assert.ok(proxy.min[axis] < proxy.max[axis]);
      aggregateMin[axis] = Math.min(aggregateMin[axis], proxy.min[axis]);
      aggregateMax[axis] = Math.max(aggregateMax[axis], proxy.max[axis]);
    }
  }
  assert.deepEqual(aggregateMin, [-28.001321, -19.224868, -1]);
  assert.deepEqual(aggregateMax, [22.340323, 18.823759, 8.944529]);
  const map = buildMap();
  assert.equal(map.solids.length, 147, 'zero-volume legacy stair faces are not gameplay solids');
  assert.deepEqual(map.presentationSolids, map.solids);
  assert.notEqual(map.presentationSolids, map.solids, 'renderer and collider own independent arrays');
  assert.notEqual(map.presentationSolids[0], map.solids[0], 'compiled boxes are independently cloned');
  assert.ok(map.solids.every(solid => solid.min.every((value, axis) => value < solid.max[axis])));
  assert.equal(map.solids.some(solid => solid.provenance?.kind === 'authored-glb'), false);
  assert.equal(map.decorations.find(decoration => decoration.id === map.visualAsset.id)?.collision, false);
  assert.equal(map.killZ, -12);
  assert.equal(map.setupDoors.length, 6, 'setup doors must remain dynamic');
  assert.deepEqual(Object.keys(map.spawns), ['east', 'west']);
  assert.deepEqual(Object.values(map.spawns).map(spawns => spawns.length), [5, 5]);
  assert.deepEqual(Object.keys(map.routes), ['front', 'cloister', 'shallows']);
  assert.equal(manifest.stats.selectedProxyCoverageWithin0_25M, 1);
  assert.ok(manifest.stats.authoredVertexCoverageWithin0_25M >= 0.76);
  assert.ok(manifest.stats.canonicalPlusAuthoredVertexCoverageWithin0_25M >= 0.95);
});

test('checked-in authored collision manifest is a byte-stable regeneration', async () => {
  const regenerated = await generateCollisionManifest();
  assert.equal(manifest.manifestHash, EXPECTED_MANIFEST_HASH);
  assert.deepEqual(regenerated, manifest);
});
