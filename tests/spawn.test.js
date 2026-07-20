import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { MODE, COMBAT } from './helpers.js';

function makeSpawnMap(points, solids = []) {
  const map = buildMap();
  map.solids = solids;
  map.setupDoors = [];
  map.pickups = [];
  map.spawns = {
    east: points.map(point => ({ ...point, pos: [...point.pos] })),
    west: points.map(point => ({ ...point, pos: [...point.pos] })),
  };
  return map;
}

function spawnFloor(z = 4) {
  return { min: [-20, -20, z - 1], max: [20, 20, z], tag: 'test-spawn-floor' };
}

test('spawnAtBase snaps authored feet to a clear walkable surface', () => {
  const floor = { min: [-2, -2, -1], max: [2, 2, 0], tag: 'test-floor' };
  const world = new World(
    makeSpawnMap([{ pos: [0, 0, 1.5], yaw: 0 }], [floor]),
    MODE,
    COMBAT,
    500,
  );
  const player = world.addPlayer('grounded', false, 0, 'asagi');

  assert.deepEqual(player.move.pos, [0, 0, 0]);
  assert.equal(player.move.grounded, true);
  assert.equal(world.collider.overlapsCylinder(
    player.move.pos[0],
    player.move.pos[1],
    player.move.pos[2],
    COMBAT.movement.capsuleRadiusM,
    COMBAT.movement.standHeightM,
  ), false);
});

test('floorless or body-overlapped spawn points fail closed', () => {
  const localFloor = { min: [-1, -1, 3], max: [1, 1, 4], tag: 'local-floor' };
  const lowCeiling = { min: [-1, -1, 5], max: [1, 1, 6], tag: 'low-ceiling' };
  const world = new World(
    makeSpawnMap([
      { pos: [0, 0, 4], yaw: 0 },
      { pos: [5, 0, 4], yaw: 0 },
    ], [localFloor, lowCeiling]),
    MODE,
    COMBAT,
    504,
  );
  const player = world.addPlayer('blocked', false, 0, 'asagi');

  assert.equal(player.alive, false);
  assert.equal(player.move.grounded, false);
  assert.equal(world.respawn.pending.has(player.id), true);
  assert.equal(world.drainEvents().some(event => (
    event.type === 'spawn_failed'
    && event.player === player.id
    && event.reason === 'no_walkable_surface'
  )), true);

  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  for (let tick = 0; tick < 800; tick++) world.tick();
  assert.equal(player.alive, false);
  assert.equal(world.respawn.pending.has(player.id), true, 'failed wave retry stays pending');
  assert.equal(world.drainEvents().some(event => (
    event.type === 'respawn' && event.player === player.id
  )), false, 'failed spawn is never announced as a respawn');
});

test('safe respawn prefers fewer enemy lines of sight before enemy distance', () => {
  const hiddenNear = { pos: [0, 0, 4], yaw: 0 };
  const visibleFar = { pos: [0, 5, 4], yaw: 0 };
  const map = makeSpawnMap([visibleFar, hiddenNear], [spawnFloor(), {
    min: [4, -1, 4],
    max: [4.5, 1, 7],
    tag: 'test-los-wall',
  }]);
  const world = new World(map, MODE, COMBAT, 501);
  const respawning = world.addPlayer('respawning', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'asagi');
  enemy.move.pos = [10, 0, 4];

  world.spawnAtBase(respawning, { safe: true, protect: true });

  assert.deepEqual(respawning.move.pos, hiddenNear.pos);
});

test('allies respawning in one wave receive distinct clear spawn points', () => {
  const firstPoint = { pos: [0, 0, 4], yaw: 0 };
  const secondPoint = { pos: [3, 0, 4], yaw: 0 };
  const world = new World(makeSpawnMap([firstPoint, secondPoint], [spawnFloor()]), MODE, COMBAT, 502);
  const first = world.addPlayer('first', false, 0, 'asagi');
  const second = world.addPlayer('second', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  for (const player of [first, second]) {
    player.alive = false;
    world.respawn.onDeath(player.id, 0);
  }

  for (let tick = 0; tick < 800 && (!first.alive || !second.alive); tick++) world.tick();

  assert.equal(first.alive, true);
  assert.equal(second.alive, true);
  assert.deepEqual(first.move.pos, firstPoint.pos);
  assert.deepEqual(second.move.pos, secondPoint.pos);
});

test('an undersized spawn set falls back to the least occupied point, then map order', () => {
  const firstPoint = { pos: [0, 0, 4], yaw: 0 };
  const secondPoint = { pos: [3, 0, 4], yaw: 0 };
  const world = new World(makeSpawnMap([firstPoint, secondPoint], [spawnFloor()]), MODE, COMBAT, 503);
  const players = Array.from(
    { length: 4 },
    (_, index) => world.addPlayer(`wave-${index}`, false, 0, 'asagi'),
  );
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  for (const player of players) {
    player.alive = false;
    world.respawn.onDeath(player.id, 0);
  }

  for (let tick = 0; tick < 800 && players.some(player => !player.alive); tick++) world.tick();

  assert.deepEqual(players.map(player => player.move.pos), [
    firstPoint.pos,
    secondPoint.pos,
    firstPoint.pos,
    secondPoint.pos,
  ]);
});
