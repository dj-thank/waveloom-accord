import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap } from '../shared/data/map_oshioi.js';
import {
  OSHIOI_FLASHPOINT,
  flashpointRoutes,
  flashpointSite,
} from '../shared/data/map_oshioi_flashpoint.js';

const rotate180 = point => [-point[0], -point[1], point[2]];
const close = (left, right, epsilon = 0.001) =>
  left.length === right.length && left.every((value, index) => Math.abs(value - right[index]) <= epsilon);

test('five-site competitive layout is an original frozen SSOT', () => {
  assert.equal(OSHIOI_FLASHPOINT.mode, 'five-site-flashpoint');
  assert.equal(OSHIOI_FLASHPOINT.layout.siteCount, 5);
  assert.equal(OSHIOI_FLASHPOINT.sites.length, 5);
  assert.equal(new Set(OSHIOI_FLASHPOINT.sites.map(site => site.id)).size, 5);
  assert.equal(OSHIOI_FLASHPOINT.progression.pointsToWin, 3);
  assert.equal(OSHIOI_FLASHPOINT.authorship.origin, 'original-kagariai');
  assert.deepEqual(OSHIOI_FLASHPOINT.authorship.externalRuntimeAssets, []);
  assert.equal(Object.isFrozen(OSHIOI_FLASHPOINT), true);
  assert.equal(Object.isFrozen(OSHIOI_FLASHPOINT.sites[0]), true);
});

test('all five sites have distinct readable identities and playable capture contracts', () => {
  const landmarks = new Set();
  const silhouettes = new Set();
  for (const site of OSHIOI_FLASHPOINT.sites) {
    assert.equal(flashpointSite(site.id), site);
    assert.ok(site.displayName);
    assert.ok(site.radiusM >= 6 && site.radiusM <= 8);
    assert.ok(site.heightM >= 4);
    assert.ok(site.playBoundsM.x[0] < site.center[0] - site.radiusM);
    assert.ok(site.playBoundsM.x[1] > site.center[0] + site.radiusM);
    assert.ok(site.playBoundsM.y[0] < site.center[1] - site.radiusM);
    assert.ok(site.playBoundsM.y[1] > site.center[1] + site.radiusM);
    landmarks.add(site.identity.landmark);
    silhouettes.add(site.identity.silhouette);
    assert.ok(site.identity.coverLanguage);
    assert.ok(site.highGrounds.every(highGround => highGround.counterRoutes.length >= 2));
  }
  assert.equal(landmarks.size, 5);
  assert.equal(silhouettes.size, 5);
});

test('every site exposes front, off-angle, and recontest-capable routes from both sides', () => {
  const bounds = OSHIOI_FLASHPOINT.layout.playableBoundsM;
  for (const site of OSHIOI_FLASHPOINT.sites) {
    for (const side of ['east', 'west']) {
      const routes = flashpointRoutes(site.id, side);
      assert.deepEqual(Object.keys(routes).sort(), ['cloister', 'front', 'shallows']);
      for (const [lane, route] of Object.entries(routes)) {
        assert.equal(route.lane, lane);
        assert.ok(route.measuredLengthM > 0);
        assert.ok(route.points.length >= 7);
        assert.ok(close(route.points.at(-1), site.center));
        for (const point of route.points) {
          assert.ok(point[0] >= bounds.x[0] && point[0] <= bounds.x[1], `${route.id} x out of bounds`);
          assert.ok(point[1] >= bounds.y[0] && point[1] <= bounds.y[1], `${route.id} y out of bounds`);
        }
      }
      assert.ok(routes.cloister.measuredLengthM > routes.front.measuredLengthM);
      assert.ok(routes.shallows.measuredLengthM > routes.front.measuredLengthM);
    }
  }
});

test('competitive route geometry preserves the declared 180-degree pairing', () => {
  const pairs = [
    ['shiogama', 'shiogama'],
    ['mizuichi', 'kazami'],
    ['kado', 'ami'],
  ];
  for (const [eastSite, westSite] of pairs) {
    for (const lane of ['front', 'cloister', 'shallows']) {
      const eastRoute = flashpointRoutes(eastSite, 'east')[lane];
      const westRoute = flashpointRoutes(westSite, 'west')[lane];
      assert.equal(eastRoute.points.length, westRoute.points.length);
      for (let index = 0; index < eastRoute.points.length; index++) {
        assert.ok(
          close(rotate180(eastRoute.points[index]), westRoute.points[index]),
          `${eastSite}/${westSite} ${lane} is not rotationally paired at ${index}`,
        );
      }
      assert.equal(eastRoute.measuredLengthM, westRoute.measuredLengthM);
    }
  }
});

test('spawn networks are outside capture spaces and expose multiple authored exits', () => {
  for (const [side, network] of Object.entries(OSHIOI_FLASHPOINT.spawnNetworks)) {
    for (const spawn of Object.values(network)) {
      assert.ok(spawn.exits.length >= 2, `${side}/${spawn.id} needs multiple exits`);
      for (const site of OSHIOI_FLASHPOINT.sites) {
        const distance = Math.hypot(
          spawn.center[0] - site.center[0],
          spawn.center[1] - site.center[1],
        );
        assert.ok(distance > site.radiusM + 10, `${spawn.id} overlaps ${site.id}`);
      }
    }
  }
});

test('authored spawn exits exactly match the runtime rooms and never share an opposing forward threshold', () => {
  const map = buildMap();
  for (const network of Object.values(OSHIOI_FLASHPOINT.spawnNetworks)) {
    for (const spawn of Object.values(network)) {
      const runtimeRoom = map.flashpoint.runtime.spawnRooms[spawn.id];
      assert.ok(runtimeRoom, `${spawn.id} needs a runtime spawn room`);
      assert.deepEqual(spawn.exits, runtimeRoom.exits, `${spawn.id} metadata drifted from runtime exits`);
    }
  }
  for (const suffix of ['North', 'South']) {
    const east = OSHIOI_FLASHPOINT.spawnNetworks.east[`forward${suffix}`];
    const west = OSHIOI_FLASHPOINT.spawnNetworks.west[`forward${suffix}`];
    for (const eastExit of east.exits) {
      for (const westExit of west.exits) {
        assert.notDeepEqual(
          eastExit,
          westExit,
          `${suffix} forward rooms share an enemy-facing exit`,
        );
      }
    }
  }
});

test('the active map and visual review surface expose the same five-site SSOT', () => {
  const map = buildMap();
  const { runtime, ...authoredFlashpoint } = map.flashpoint;
  assert.deepEqual(authoredFlashpoint, OSHIOI_FLASHPOINT);
  assert.deepEqual(map.objectives, OSHIOI_FLASHPOINT.sites);
  assert.notEqual(map.flashpoint, OSHIOI_FLASHPOINT, 'compiled maps must independently own Flashpoint data');
  assert.notEqual(map.objectives, OSHIOI_FLASHPOINT.sites, 'compiled maps must independently own objective data');
  assert.equal(map.objectives.length, 5);
  assert.deepEqual(map.boundsM, OSHIOI_FLASHPOINT.layout.playableBoundsM);
  assert.deepEqual(runtime.boundsM, map.boundsM);
  assert.equal(Object.keys(runtime.routesBySite).length, 5);
  assert.equal(Object.keys(runtime.spawnRooms).length, 6);
  const previewSource = readFileSync(
    new URL('../client/map-preview.js', import.meta.url),
    'utf8',
  );
  const previewHtml = readFileSync(
    new URL('../client/map-preview.html', import.meta.url),
    'utf8',
  );
  assert.match(previewSource, /flashpointSites = map\.flashpoint\?\.sites/);
  assert.match(previewSource, /siteCount: flashpointSites\.length/);
  for (const site of OSHIOI_FLASHPOINT.sites) {
    assert.match(previewHtml, new RegExp(`data-view="site-${site.id}"`));
  }
});
