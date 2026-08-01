import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compileMapBlueprint } from '../shared/data/map_blueprint.js';

test('map blueprint compiles one source of truth for visible and collidable gameplay geometry', () => {
  const map = compileMapBlueprint({
    id: 'test_arena',
    displayName: 'Test Arena',
    boundsM: { x: [-10, 10], y: [-8, 8] },
    killZ: -6,
    geometry: [
      { id: 'floor', kind: 'box', min: [-10, -8, -1], max: [10, 8, 0], tag: 'ground' },
      { id: 'east-cover', kind: 'box', min: [3, 1, 0], max: [4, 2, 2], tag: 'cover', mirror180: true },
    ],
    objective: { center: [0, 0, 0], radiusM: 4, heightM: 3 },
    spawns: {
      east: [{ pos: [8, 0, 0], yaw: Math.PI }],
      west: [{ pos: [-8, 0, 0], yaw: 0 }],
    },
    routes: { front: [[8, 0, 0], [0, 0, 0]] },
    pickups: [],
    setupDoors: [],
    decorations: [{ id: 'skyline', assetId: 'cc0-skyline', collision: false }],
  });

  assert.equal(map.solids.length, 3);
  assert.deepEqual(
    map.presentationSolids.map(({ id, min, max, tag }) => ({ id, min, max, tag })),
    map.solids.map(({ id, min, max, tag }) => ({ id, min, max, tag })),
  );
  assert.deepEqual(map.solids[2], {
    id: 'east-cover@rot180', min: [-4, -2, 0], max: [-3, -1, 2], tag: 'cover',
  });
  assert.equal(map.decorations[0].collision, false);
  assert.equal(map.killZ, -6);
});

test('descending stairs omit the zero-volume terminal slice instead of creating a fake floor', () => {
  const map = compileMapBlueprint({
    id: 'stairs_fixture',
    displayName: 'Stairs fixture',
    boundsM: { x: [-4, 4], y: [-4, 4] },
    geometry: [{
      id: 'down', kind: 'stairs', axis: 'x', from: 0, to: 4,
      cross: [-1, 1], z: [4, 0], steps: 4, tag: 'stair',
    }],
    spawns: {}, routes: {}, pickups: [], setupDoors: [], decorations: [],
  });

  assert.equal(map.solids.length, 3);
  assert.ok(map.solids.every(solid => solid.min.every((value, axis) => value < solid.max[axis])));
  assert.deepEqual(map.presentationSolids, map.solids);
});

test('flashpoint objectives are validated and cloned as an ordered SSOT', () => {
  const objectives = Array.from({ length: 5 }, (_, index) => ({
    id: `site-${index + 1}`,
    center: [index - 2, index * 0.5, 0],
    radiusM: 7,
    heightM: 5,
  }));
  const flashpoint = {
    layout: { siteCount: 5 },
    sites: objectives.map(objective => ({ ...objective })),
  };
  const map = compileMapBlueprint({
    id: 'flashpoint_fixture',
    displayName: 'Flashpoint fixture',
    boundsM: { x: [-10, 10], y: [-10, 10] },
    geometry: [],
    objective: objectives[0],
    objectives,
    flashpoint,
    spawns: {},
    routes: {},
  });

  assert.deepEqual(map.objectives.map(objective => objective.id), [
    'site-1', 'site-2', 'site-3', 'site-4', 'site-5',
  ]);
  assert.notEqual(map.objectives, objectives);
  assert.notEqual(map.objectives[0], objectives[0]);
  assert.notEqual(map.flashpoint, flashpoint);
  objectives[0].center[0] = 99;
  flashpoint.sites[0].center[0] = 99;
  assert.equal(map.objectives[0].center[0], -2);
  assert.equal(map.flashpoint.sites[0].center[0], -2);
});

test('flashpoint objective cardinality, identity, and dimensions fail closed', () => {
  const base = {
    id: 'invalid_flashpoint_fixture',
    displayName: 'Invalid Flashpoint fixture',
    boundsM: { x: [-10, 10], y: [-10, 10] },
    geometry: [],
    spawns: {},
    routes: {},
  };
  const sites = Array.from({ length: 5 }, (_, index) => ({
    id: `site-${index + 1}`,
    center: [index, 0, 0],
    radiusM: 7,
    heightM: 5,
  }));

  assert.throws(() => compileMapBlueprint({
    ...base,
    flashpoint: { layout: { siteCount: 5 }, sites },
    objectives: sites.slice(0, 4),
  }), /siteCount/);
  assert.throws(() => compileMapBlueprint({
    ...base,
    flashpoint: { layout: { siteCount: 5 }, sites },
    objectives: sites.map((site, index) => ({ ...site, id: index === 4 ? 'site-1' : site.id })),
  }), /duplicate objective id/);
  assert.throws(() => compileMapBlueprint({
    ...base,
    objectives: sites.map((site, index) => ({ ...site, radiusM: index === 2 ? 0 : site.radiusM })),
  }), /radiusM must be positive/);
});
