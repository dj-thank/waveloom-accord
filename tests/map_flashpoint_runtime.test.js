import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/data/map_oshioi.js';
import { OSHIOI_FLASHPOINT } from '../shared/data/map_oshioi_flashpoint.js';
import { buildOshioiFlashpointGeometry } from '../shared/data/map_oshioi_flashpoint_geometry.js';
import { buildOshioiRingGeometry } from '../shared/data/map_oshioi_ring_geometry.js';
import { Collider } from '../shared/sim/collision.js';
import { canTraverseGroundSegment } from '../server/bot_navigation.js';
import { COMBAT } from './helpers.js';

const PLAYER_RADIUS_M = 0.4;
const PLAYER_HEIGHT_M = 1.7;

// buildMap() は既に flashpoint を合成し、removeCanonicalSolidIds も除去済みである。
// 旧版はここで「もう一度2件を引き、もう一度 flashpoint.solids を連結」していたため、
// ID が192件重複した合計1,171個のコライダーでルート判定を走らせ、
// solids 数の assert が実装と無関係に永久に赤だった（979 !== 977）。
// 合成済みの solids をそのまま使う。
function composeMap() {
  const legacy = buildMap();
  const flashpoint = buildOshioiFlashpointGeometry();
  const solids = legacy.solids;
  return {
    legacy,
    flashpoint,
    map: { ...legacy, boundsM: flashpoint.boundsM, solids },
    collider: new Collider(solids),
  };
}

test('Flashpoint geometry expands the canonical map without replacing its core', () => {
  const legacy = buildMap();
  const flashpoint = buildOshioiFlashpointGeometry();

  assert.deepEqual(flashpoint.boundsM, { x: [-126, 126], y: [-92, 92] });
  assert.deepEqual(
    flashpoint.removeCanonicalSolidIds,
    ['canonical-002-wall', 'canonical-003-wall'],
  );
  assert.equal(flashpoint.sites.length, 5);
  assert.deepEqual(
    flashpoint.sites.map(site => site.id),
    ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami'],
  );

  // 合成済みの map から検証する。除去対象は既に居ない。
  for (const id of flashpoint.removeCanonicalSolidIds) {
    assert.ok(
      !legacy.solids.some(solid => solid.id === id),
      `${id} must be replaced by the flashpoint ring`,
    );
  }
  const canonical = legacy.solids.filter(solid => solid.id.startsWith('canonical-'));
  assert.ok(canonical.length > 0, 'legacy core solids must survive');
  for (const legacySolid of canonical) {
    assert.ok(
      !flashpoint.solids.some(solid => solid.id === legacySolid.id),
      `Flashpoint geometry reuses legacy id ${legacySolid.id}`,
    );
  }
  // flash-* は1件も落ちずに合成されている
  assert.equal(
    legacy.solids.filter(solid => solid.id.startsWith('flash-')).length,
    flashpoint.solids.length,
  );
  // solids は legacy(canonical-*) + flash-* + ring-* の3ソースちょうど
  const ring = legacy.solids.filter(solid => solid.id.startsWith('ring-'));
  assert.equal(legacy.solids.length, canonical.length + flashpoint.solids.length + ring.length);
});

test('runtime map composition keeps one authoritative solid per ID', () => {
  const map = buildMap();
  const flashpoint = buildOshioiFlashpointGeometry();
  const ids = map.solids.map(solid => solid.id);
  assert.equal(new Set(ids).size, ids.length, 'runtime map must not contain duplicate solid IDs');
  assert.equal(flashpoint.removeCanonicalSolidIds.filter(id => ids.includes(id)).length, 0);
  assert.equal(map.solids.filter(solid => solid.id.startsWith('flash-')).length, flashpoint.solids.length);
});

test('central lantern-tower counter-route declarations match the added ring stair flights', () => {
  const ring = buildOshioiRingGeometry().solids;
  const central = OSHIOI_FLASHPOINT.sites.find(site => site.id === 'shiogama');
  assert.equal(central.highGrounds.every(ground => ground.counterRoutes.length === 2), true);
  assert.equal(ring.filter(solid => solid.id.startsWith('ring-kilnstair-')).length, 20);
  assert.equal(ring.filter(solid => solid.id.startsWith('ring-kilnlanding-')).length, 2);
  const runtime = buildOshioiFlashpointGeometry();
  assert.equal(runtime.highGroundRoutesBySite.shiogama, undefined, 'central high grounds stay on ring geometry boundary');
});

test('the outer ring provides authoritative standing floor and a sealed perimeter', () => {
  const { flashpoint, collider } = composeMap();
  for (const site of flashpoint.sites.filter(site => site.id !== 'shiogama')) {
    const [x, y, z] = site.center;
    assert.equal(
      collider.groundHeight(x, y, z, PLAYER_RADIUS_M, 0.55),
      z,
      `${site.id} has no canonical floor`,
    );
    assert.equal(
      collider.overlapsCylinder(x, y, z, PLAYER_RADIUS_M, PLAYER_HEIGHT_M),
      false,
      `${site.id} objective volume is blocked`,
    );
  }

  assert.ok(Number.isFinite(collider.raycast(0, 0, 5, 1, 0, 0, 140)));
  assert.ok(Number.isFinite(collider.raycast(0, 0, 5, -1, 0, 0, 140)));
  assert.ok(Number.isFinite(collider.raycast(0, 0, 5, 0, 1, 0, 110)));
  assert.ok(Number.isFinite(collider.raycast(0, 0, 5, 0, -1, 0, 110)));
});

test('all thirty site routes are capsule-safe and finish at separated capture entrances', () => {
  const { map, flashpoint, collider } = composeMap();
  const world = { map, collider, mv: COMBAT.movement, combat: COMBAT };
  let routeCount = 0;

  for (const site of flashpoint.sites) {
    for (const side of ['east', 'west']) {
      const routes = flashpoint.routesBySite[site.id]?.[side];
      assert.deepEqual(
        Object.keys(routes || {}).sort(),
        ['cloister', 'front', 'shallows'],
        `${site.id}/${side} is missing a lane`,
      );
      const endpoints = [];
      for (const lane of ['front', 'cloister', 'shallows']) {
        routeCount += 1;
        const route = routes[lane];
        const spawn = flashpoint.spawnsBySite[site.id]?.[side];
        assert.ok(spawn, `${site.id}/${side} has no spawn policy`);
        assert.deepEqual(route.points[0], spawn.pos, `${route.id} does not start at its spawn`);
        assert.equal(route.spawnId, spawn.id);
        for (let index = 1; index < route.points.length; index++) {
          assert.equal(
            canTraverseGroundSegment(world, route.points[index - 1], route.points[index]),
            true,
            `${route.id} is unsafe at segment ${index - 1}->${index}`,
          );
        }
        const endpoint = route.points.at(-1);
        assert.ok(
          Math.hypot(endpoint[0] - site.center[0], endpoint[1] - site.center[1])
            <= site.radiusM - PLAYER_RADIUS_M,
          `${route.id} does not finish inside ${site.id}`,
        );
        endpoints.push(endpoint);
      }
      for (let left = 0; left < endpoints.length; left++) {
        for (let right = left + 1; right < endpoints.length; right++) {
          assert.ok(
            Math.hypot(
              endpoints[left][0] - endpoints[right][0],
              endpoints[left][1] - endpoints[right][1],
            ) >= 4,
            `${site.id}/${side} route endpoints are not separated`,
          );
        }
      }
    }
  }
  assert.equal(routeCount, 30);
});

test('outer arenas contain cover, readable massing, two stair-access high grounds, and protected spawn rooms', () => {
  const { map, flashpoint, collider } = composeMap();
  const world = { map, collider, mv: COMBAT.movement, combat: COMBAT };
  assert.ok(flashpoint.solids.length >= 100, `only ${flashpoint.solids.length} added solids`);
  assert.ok(flashpoint.solids.length <= 800, `geometry budget exceeded: ${flashpoint.solids.length}`);
  assert.ok(
    flashpoint.solids.filter(solid => solid.id.startsWith('flash-ring-rail-')).length >= 8,
    'outer ring needs explicit fall-prevention rails',
  );

  for (const site of flashpoint.sites.filter(site => site.id !== 'shiogama')) {
    const prefix = `flash-site-${site.id}-`;
    assert.ok(flashpoint.solids.some(solid => solid.id === `${prefix}objective-pad`));
    assert.ok(
      flashpoint.solids.filter(solid => solid.id.startsWith(`${prefix}cover-`)).length >= 3,
      `${site.id} needs three primary cover pieces`,
    );
    assert.ok(
      flashpoint.solids.filter(solid => solid.id.startsWith(`${prefix}mass-`)).length >= 2,
      `${site.id} needs site-readable architecture`,
    );
    assert.ok(flashpoint.solids.some(solid => solid.id === `${prefix}high-platform`));

    const accessRoutes = Object.values(flashpoint.highGroundRoutesBySite[site.id] || {});
    assert.equal(accessRoutes.length, 2, `${site.id} needs two high-ground counters`);
    for (const route of accessRoutes) {
      for (let index = 1; index < route.points.length; index++) {
        assert.equal(
          canTraverseGroundSegment(world, route.points[index - 1], route.points[index]),
          true,
          `${route.id} is unsafe at ${index - 1}->${index}`,
        );
      }
    }
  }

  assert.equal(Object.keys(flashpoint.spawnRooms).length, 6);
  for (const room of Object.values(flashpoint.spawnRooms)) {
    assert.equal(room.exits.length, 3, `${room.id} must expose three exits`);
    assert.equal(room.spawns.length, 5, `${room.id} must expose five spawn candidates`);
    assert.ok(room.wallIds.length >= 6, `${room.id} needs walls and baffles`);
    for (const point of room.spawns) {
      assert.equal(
        collider.groundHeight(...point, PLAYER_RADIUS_M, 0.55),
        point[2],
        `${room.id} spawn has no floor`,
      );
      assert.equal(
        collider.overlapsCylinder(...point, PLAYER_RADIUS_M, PLAYER_HEIGHT_M),
        false,
        `${room.id} spawn is blocked`,
      );
    }
  }
});
