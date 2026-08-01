import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collider } from '../shared/sim/collision.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { World } from '../shared/sim/sim.js';
import { canTraverseGroundSegment } from '../server/bot_navigation.js';
import { AUTHORED_COLLISION_MANIFEST as manifest } from '../shared/data/map_oshioi_authored_collision.js';
import { generateCollisionManifest } from '../tools/generate_authored_map_collision.js';
import { MODE, COMBAT } from './helpers.js';

const PLAYER_RADIUS_M = 0.4;
const PLAYER_HEIGHT_M = 1.7;
const EXPECTED_MANIFEST_HASH = '66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29';

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
        const floor = runtime.groundHeight(
          pos[0], pos[1], pos[2], PLAYER_RADIUS_M, 0.55,
        );
        assert.ok(
          Number.isFinite(floor),
          `route:${route}:${index - 1}-${index}@${ratio.toFixed(3)} has no walkable floor`,
        );
        assert.ok(
          Math.abs(floor - pos[2]) <= 0.75,
          `route:${route}:${index - 1}-${index}@${ratio.toFixed(3)} floor drift ${floor - pos[2]}`,
        );
        assert.equal(
          runtime.overlapsCylinder(pos[0], pos[1], floor, PLAYER_RADIUS_M, PLAYER_HEIGHT_M),
          false,
          `route:${route}:${index - 1}-${index}@${ratio.toFixed(3)} is blocked at its floor`,
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

test('side routes stay within a bounded regroup envelope and mirror exactly', () => {
  const map = buildMap();
  const length = points => points.slice(1).reduce((sum, point, index) => (
    sum + Math.hypot(...point.map((value, axis) => value - points[index][axis]))
  ), 0);
  const frontLength = length(map.routes.front);
  const sideLengths = ['cloister', 'shallows'].map(route => length(map.routes[route]));
  for (const route of ['cloister', 'shallows']) {
    const ratio = length(map.routes[route]) / frontLength;
    assert.ok(ratio >= 1.35 && ratio <= 1.5,
      `${route} route ratio ${ratio.toFixed(3)} is outside the 1.35-1.50 flank budget`);
  }
  assert.ok(Math.abs(sideLengths[0] - sideLengths[1]) < 1,
    `side routes drift by ${Math.abs(sideLengths[0] - sideLengths[1]).toFixed(3)}m`);
  for (const [name, points] of Object.entries(map.routes)) {
    const mirrored = points.map(([x, y, z]) => [-x, -y, z]);
    assert.equal(length(mirrored), length(points), `${name} mirror length drift`);
    assert.ok(mirrored.every(point => point.every(Number.isFinite)), `${name} mirror contains invalid waypoint`);
  }
});

test('shallows uses its physical exit, lower lane, and dedicated connector in order', () => {
  const points = buildMap().routes.shallows;
  const lowerIndex = points.findIndex(([, , z]) => z <= 0.2);
  const connectorIndex = points.findIndex(([x, y]) => x >= 31.5 && x <= 38.5 && y >= -19.5 && y <= -16.5);
  const southEntryIndex = points.findIndex(([x, y]) => Math.abs(x) <= 1.5 && y >= -6 && y <= -4);
  assert.ok(lowerIndex > 0, 'shallows must leave the south spawn exit and reach z=0');
  assert.ok(connectorIndex > lowerIndex, 'the lower lane must reach its authored connector stair');
  assert.ok(southEntryIndex > connectorIndex, 'the connector must lead to the south bowl entrance');
});

test('all tactical routes finish inside the objective through distinct entrances', () => {
  const map = buildMap();
  const endpoints = Object.values(map.routes).map(points => points.at(-1));
  for (const point of endpoints) {
    assert.ok(Math.hypot(point[0] - map.objective.center[0], point[1] - map.objective.center[1]) <= map.objective.radiusM);
  }
  for (let left = 0; left < endpoints.length; left++) {
    for (let right = left + 1; right < endpoints.length; right++) {
      assert.ok(Math.hypot(
        endpoints[left][0] - endpoints[right][0],
        endpoints[left][1] - endpoints[right][1],
      ) >= 4, `routes ${left}/${right} collapse onto one objective entrance`);
    }
  }
});

test('authored full-height cover breaks the longest market and cloister eye rays', () => {
  const collider = new Collider(buildMap().solids);
  for (const [from, to] of [
    [[37, 3.5, 5.6], [8, 3.5, 5.6]],
    [[18, 0.1, 5.6], [8, 0.1, 5.6]],
    [[41, 22.8, 5.6], [30, 22.8, 5.6]],
    [[29, 12.5, 5.6], [14, 12.5, 5.6]],
  ]) {
    const delta = to.map((value, axis) => value - from[axis]);
    const distance = Math.hypot(...delta);
    const direction = delta.map(value => value / distance);
    assert.ok(collider.raycast(...from, ...direction, distance) < distance,
      `eye ray ${from} -> ${to} remains unbroken`);
  }
});

test('every runtime tactical route is capsule-traversable on both rotated sides', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260722);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider.dynamic = [];

  for (const [route, eastPoints] of Object.entries(world.map.routes)) {
    for (const side of ['east', 'west']) {
      const points = side === 'east'
        ? eastPoints
        : eastPoints.map(([x, y, z]) => [-x, -y, z]);
      for (let index = 1; index < points.length; index++) {
        assert.equal(
          canTraverseGroundSegment(world, points[index - 1], points[index]),
          true,
          `${side}:${route}:${index - 1}-${index} is not capsule-traversable`,
        );
      }
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
  const legacySolids = map.solids.filter(solid => solid.id.startsWith('canonical-'));
  const flashpointSolids = map.solids.filter(solid => solid.id.startsWith('flash-'));
  assert.equal(legacySolids.length, 175, 'the legacy core keeps every solid except its two opened side walls');
  assert.ok(flashpointSolids.length >= 100, 'the five-site expansion must be authoritative gameplay geometry');
  // 移動リングの港湾街区（ring-*）が第3のソースとして加わった。
  // リングは 34,348 m² に構造箱30個・密度0.87/1000m² しか無く、
  // 東半分の直線100m超が無遮蔽だったため、射線分割と高低差のために追加している。
  const ringSolids = map.solids.filter(solid => solid.id.startsWith('ring-'));
  assert.ok(ringSolids.length >= 100, 'the travel ring must carry authoritative cover, not just dressing');
  assert.equal(
    map.solids.length,
    legacySolids.length + flashpointSolids.length + ringSolids.length,
  );
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
