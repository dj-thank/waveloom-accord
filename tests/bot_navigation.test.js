import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import {
  canTraverseGroundSegment,
  compareNavigationPointsByProximity,
  compareNavigationSearchCandidates,
  findGroundDetourPath,
  findGroundRecoveryPath,
  hasSafeGroundPath,
  intendedMovementVector,
  isOnAuthoredStair,
  navigationFloorHeight,
} from '../server/bot_navigation.js';
import { MODE, COMBAT } from './helpers.js';

function tickBot(world, bot, seconds) {
  const samples = [];
  const ticks = Math.ceil(seconds / world.dt);
  for (let tick = 0; tick < ticks; tick++) {
    bot.think(world.dt);
    world.tick();
    world.drainEvents();
    if (tick % world.combat.tickRateHz === 0) {
      samples.push({
        t: world.t,
        pos: [...bot.pl.move.pos],
        speed: Math.hypot(bot.pl.move.vel[0], bot.pl.move.vel[1]),
        route: bot.route,
        waypoint: bot.wpIndex,
        mode: bot.mode,
        stall: bot.stallT,
      });
    }
  }
  return samples;
}

test('recovery candidate ranking is a strict deterministic total order across epsilon chains', () => {
  const origin = [0, 0, 0];
  const toward = [1, 0, 0];
  const points = [
    [-1, 0, 0],
    [0, 1 + 0.75e-6, 0],
    [1 + 1.5e-6, 0, 0],
  ];
  const comparator = (left, right) =>
    compareNavigationPointsByProximity(left, right, origin, toward);
  const permutations = [
    points,
    [points[0], points[2], points[1]],
    [points[1], points[0], points[2]],
    [points[1], points[2], points[0]],
    [points[2], points[0], points[1]],
    [points[2], points[1], points[0]],
  ];

  for (const left of points) {
    for (const right of points) {
      const forward = comparator(left, right);
      const reverse = comparator(right, left);
      assert.equal(forward === 0, reverse === 0);
      if (forward !== 0) assert.equal(Math.sign(forward), -Math.sign(reverse));
    }
  }
  const expected = ['-1,0', `0,${1 + 0.75e-6}`, `${1 + 1.5e-6},0`];
  for (const permutation of permutations) {
    assert.deepEqual(
      [...permutation].sort(comparator).map(point => `${point[0]},${point[1]}`),
      expected,
    );
  }

  const sameDistance = [
    [1, -1, 0],
    [1, -1, 1],
    [1, 1, 0],
  ];
  const sameDistanceExpected = ['1,-1,0', '1,-1,1', '1,1,0'];
  for (const permutation of [
    sameDistance,
    [sameDistance[1], sameDistance[2], sameDistance[0]],
    [sameDistance[2], sameDistance[0], sameDistance[1]],
  ]) {
    assert.deepEqual(
      [...permutation].sort(comparator).map(point => `${point[0]},${point[1]},${point[2]}`),
      sameDistanceExpected,
    );
  }

  const scored = points.map((point, index) => ({
    point,
    score: 1 + index * 0.75e-6,
  }));
  const scoreComparator = (left, right) => compareNavigationSearchCandidates(
    left.score,
    left.point,
    right.score,
    right.point,
    origin,
    toward,
  );
  for (const permutation of [
    scored,
    [scored[0], scored[2], scored[1]],
    [scored[2], scored[1], scored[0]],
  ]) {
    assert.deepEqual(
      [...permutation].sort(scoreComparator).map(candidate => candidate.score),
      [1, 1 + 0.75e-6, 1 + 1.5e-6],
    );
  }

  // The A* open set has exactly equal scores often enough that its secondary
  // tie-break must itself be deterministic, not just the recovery sort.
  const equalScored = sameDistance.map(point => ({ point, score: 7 }));
  for (const permutation of [
    equalScored,
    [equalScored[1], equalScored[2], equalScored[0]],
    [equalScored[2], equalScored[0], equalScored[1]],
  ]) {
    assert.deepEqual(
      [...permutation].sort(scoreComparator).map(candidate => candidate.point.join(',')),
      sameDistanceExpected,
    );
  }
});

test('recovery candidate ranking remains a total order for defensive non-finite inputs', () => {
  const origin = [0, 0, 0];
  const invalidToward = [Infinity, NaN, 0];
  const points = [
    [NaN, 0, 0],
    [Infinity, -Infinity, 0],
    [0, -Infinity, 0],
    [0, 0, 0],
  ];
  const comparator = (left, right) =>
    compareNavigationPointsByProximity(left, right, origin, invalidToward);

  for (const left of points) {
    for (const right of points) {
      const forward = comparator(left, right);
      const reverse = comparator(right, left);
      assert.equal(forward === 0, reverse === 0);
      if (forward !== 0) assert.equal(Math.sign(forward), -Math.sign(reverse));
      for (const third of points) {
        if (forward <= 0 && comparator(right, third) <= 0) {
          assert.ok(comparator(left, third) <= 0, 'comparison must stay transitive');
        }
      }
    }
  }

  const labels = point => `${String(point[0])},${String(point[1])}`;
  assert.deepEqual(
    [...points].sort(comparator).map(labels),
    ['0,-Infinity', '0,0', 'Infinity,-Infinity', 'NaN,0'],
  );

  const scored = [
    { point: [0, 0, 0], score: NaN },
    { point: [1, 0, 0], score: Infinity },
    { point: [2, 0, 0], score: 0 },
    { point: [3, 0, 0], score: -Infinity },
  ];
  const scoreComparator = (left, right) => compareNavigationSearchCandidates(
    left.score,
    left.point,
    right.score,
    right.point,
    origin,
    invalidToward,
  );
  assert.deepEqual(
    [...scored].sort(scoreComparator).map(candidate => String(candidate.score)),
    ['-Infinity', '0', 'Infinity', 'NaN'],
  );

  assert.equal(comparator([], null), -1);
  assert.equal(comparator(null, undefined), -1);
  assert.equal(comparator(undefined, null), 1);
  assert.equal(comparator(undefined, undefined), 0);
  const malformedCoordinateTies = [
    [undefined, 0, 0],
    [null, 0, 0],
    [0, 0, 0],
    ['0', 0, 0],
    [false, 0, 0],
    [NaN, 0, 0],
  ];
  for (let leftIndex = 0; leftIndex < malformedCoordinateTies.length; leftIndex++) {
    for (let rightIndex = leftIndex + 1; rightIndex < malformedCoordinateTies.length; rightIndex++) {
      const left = malformedCoordinateTies[leftIndex];
      const right = malformedCoordinateTies[rightIndex];
      assert.notEqual(comparator(left, right), 0);
      assert.equal(
        Math.sign(comparator(left, right)),
        -Math.sign(comparator(right, left)),
      );
    }
  }
  const sameDescriptionFirst = Symbol('same-coordinate');
  const sameDescriptionSecond = Symbol('same-coordinate');
  const sameShapeFirst = {};
  const sameShapeSecond = {};
  const unsupportedCoordinates = [
    [sameDescriptionFirst, 0, 0],
    [sameDescriptionSecond, 0, 0],
    [sameShapeFirst, 0, 0],
    [sameShapeSecond, 0, 0],
    [-0, 0, 0],
    [0, 0, 0],
  ];
  // Non-serializable values cannot be authored coordinates. They must remain
  // harmless canonical invalid candidates rather than acquiring a retained or
  // comparison-history-dependent identity order. They sort after valid zero;
  // -0 is the same finite cell as +0 for navigation purposes.
  for (const point of unsupportedCoordinates.slice(0, 4)) {
    assert.equal(comparator(point, [0, 0, 0]), 1);
  }
  assert.equal(comparator(unsupportedCoordinates[0], unsupportedCoordinates[1]), 0);
  assert.equal(comparator(unsupportedCoordinates[2], unsupportedCoordinates[3]), 0);
  assert.equal(comparator(unsupportedCoordinates[4], unsupportedCoordinates[5]), 0);
  let coercionCalls = 0;
  const coercibleObject = {
    valueOf() {
      coercionCalls += 1;
      return 99;
    },
  };
  const coercibleFunction = () => 99;
  coercibleFunction.valueOf = () => {
    coercionCalls += 1;
    return 99;
  };
  assert.equal(comparator([coercibleObject, 0, 0], [0, 0, 0]), 1);
  assert.equal(comparator([coercibleFunction, 0, 0], [0, 0, 0]), 1);
  assert.equal(coercionCalls, 0, 'unsupported coordinates must not invoke valueOf');
  assert.notEqual(compareNavigationSearchCandidates(
    NaN,
    [NaN, 0, 0],
    NaN,
    [undefined, 0, 0],
    origin,
    invalidToward,
  ), 0);
  assert.equal(compareNavigationSearchCandidates(
    NaN,
    null,
    NaN,
    undefined,
    origin,
    invalidToward,
  ), -1);
  assert.equal(compareNavigationSearchCandidates(
    NaN,
    undefined,
    NaN,
    null,
    origin,
    invalidToward,
  ), 1);

  const huge = 1.7e308;
  assert.equal(
    compareNavigationPointsByProximity(
      [huge, 0, 0],
      [0, huge, 0],
      origin,
      [huge, huge, 0],
    ),
    -1,
  );
  assert.equal(
    compareNavigationPointsByProximity(
      [0, huge, 0],
      [huge, 0, 0],
      origin,
      [huge, huge, 0],
    ),
    1,
  );
});

test('a bot traverses the west shallows stair on grounded authored treads', () => {
  const world = new World(buildMap(), MODE, COMBAT, 73);
  assert.equal(world.sideOf(0), 'west');
  const player = world.addPlayer('stranded-bot', true, 0, 'zairu');
  const bot = new BotController(world, player, () => 0.99);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider.dynamic = [];
  bot.route = 'shallows';
  const points = bot.routePoints();
  const stairIndex = points.findIndex((point, index) => index > 0 && point[2] < points[index - 1][2]);
  assert.ok(stairIndex > 0, 'west shallows stair waypoint is missing');
  assert.equal(canTraverseGroundSegment(world, points[stairIndex - 1], points[stairIndex]), true);
  player.move.pos = [...points[stairIndex - 1]];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  bot.wpIndex = stairIndex;
  bot.mode = 'advance';
  bot.lastRound = world.flow.round;

  const start = [...player.move.pos];
  const samples = tickBot(world, bot, 3);
  const displacement = Math.hypot(
    player.move.pos[0] - start[0],
    player.move.pos[1] - start[1],
  );
  const descended = samples.some(sample => sample.pos[2] <= points[stairIndex][2] + 0.15);

  assert.ok(
    displacement >= 1 && descended && player.move.pos[2] >= 2.4,
    `bot failed grounded traversal on the west stair: ${JSON.stringify({
      start,
      final: player.move.pos,
      route: bot.route,
      waypoint: bot.wpIndex,
      mode: bot.mode,
      samples,
    })}`,
  );
});

test('navigation floor keeps authored map geometry authoritative when collider is stale', () => {
  const ground = { min: [0, 0, 0], max: [2, 2, 4], tag: 'ground' };
  const stale = { min: [100, 100, 0], max: [101, 101, 4], tag: 'ground' };
  const world = {
    map: { solids: [ground] },
    mv: { capsuleRadiusM: 0.4, stepUpM: 0.55 },
    collider: {
      solids: [stale],
      staticSolidsInAabb: () => {
        throw new Error('stale collider must not supply navigation floors');
      },
    },
  };

  assert.equal(navigationFloorHeight(world, 1, 1, 4), 4);
});

test('navigation entry points reject non-finite or coercible coordinates before reading world state', () => {
  let coercionCalls = 0;
  const coercible = { valueOf: () => { coercionCalls += 1; return 1; } };
  const unreadableWorld = new Proxy({}, { get: () => { throw new Error('invalid navigation input must not read world state'); } });
  const validTarget = [0, 0, 0];
  assert.deepEqual(findGroundDetourPath(unreadableWorld, [coercible, 0, 0], validTarget), []);
  assert.deepEqual(findGroundRecoveryPath(unreadableWorld, [Symbol('invalid'), 0, 0], validTarget), []);
  assert.equal(navigationFloorHeight({ mv: {}, map: { solids: [] }, collider: {} }, NaN, 0, 0), -Infinity);
  assert.equal(coercionCalls, 0, 'navigation must never invoke arbitrary coordinate valueOf');
});

test('a near shallows rejoin waypoint is consumed instead of starting a micro recovery loop', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20268632);
  const player = world.addPlayer('shallows-rejoin-bot', true, 0, 'ankou');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider.dynamic = [];
  bot.route = 'shallows';
  bot.wpIndex = 18;
  player.move.pos = [30.938, -17.477, 4];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;

  assert.equal(bot.rejoinCurrentRoute(), true);
  assert.equal(bot.wpIndex, 18);
  assert.deepEqual(bot.recoveryPath, []);
});

test('actual bots finish all mirrored tactical routes inside the bounded flank timing', () => {
  const arrivals = new Map();
  for (const seed of [73, 20260713]) {
    for (const route of ['front', 'cloister', 'shallows']) {
      const world = new World(buildMap(), MODE, COMBAT, seed);
      const side = world.sideOf(0);
      const player = world.addPlayer(`route-${side}-${route}`, true, 0, 'zairu');
      const bot = new BotController(world, player, () => 0.99);
      world.flow.state = 'ACTIVE';
      world.objective.unseal();
      world.collider.dynamic = [];
      bot.route = route;
      const points = bot.routePoints();
      player.move.pos = [...points[0]];
      player.move.vel = [0, 0, 0];
      player.move.grounded = true;
      bot.wpIndex = 1;
      bot.mode = 'advance';
      bot.lastRound = world.flow.round;

      let minZ = player.move.pos[2];
      for (let tick = 0; tick < Math.ceil(20 / world.dt) && bot.mode !== 'hold'; tick++) {
        bot.think(world.dt);
        world.tick();
        world.drainEvents();
        minZ = Math.min(minZ, player.move.pos[2]);
      }

      assert.equal(bot.mode, 'hold', `${side} ${route} did not reach the objective entrance`);
      assert.ok(minZ >= -0.05, `${side} ${route} fell below authored ground: ${minZ}`);
      arrivals.set(`${side}:${route}`, world.t);
    }
  }

  for (const side of ['east', 'west']) {
    const front = arrivals.get(`${side}:front`);
    for (const route of ['cloister', 'shallows']) {
      const ratio = arrivals.get(`${side}:${route}`) / front;
      assert.ok(ratio >= 1.25 && ratio <= 1.6, `${side} ${route} arrival ratio ${ratio}`);
    }
  }
  for (const route of ['front', 'cloister', 'shallows']) {
    assert.ok(
      Math.abs(arrivals.get(`east:${route}`) - arrivals.get(`west:${route}`)) <= 0.25,
      `${route} arrival is not mirrored: ${JSON.stringify(Object.fromEntries(arrivals))}`,
    );
  }
});

test('a fighting bot does not strafe off a four-metre market ledge', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('edge-bot', true, 0, 'asagi');
  const enemy = world.addPlayer('visible-enemy', false, 1, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [31.4, 10, 4];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  enemy.move.pos = [39, 10, 4];
  enemy.move.vel = [0, 0, 0];
  enemy.move.grounded = true;
  for (const slot of ['secondary', 'ability1', 'ability2']) {
    player.abilities.cooldowns[slot] = 99;
  }
  player.ultGauge = 0;
  bot.lastRound = world.flow.round;

  let minimumZ = player.move.pos[2];
  const ticks = Math.ceil(3 / world.dt);
  for (let tick = 0; tick < ticks; tick++) {
    bot.think(world.dt);
    world.tick();
    world.drainEvents();
    minimumZ = Math.min(minimumZ, player.move.pos[2]);
  }

  assert.ok(
    minimumZ >= 3.5,
    `combat strafe left the intended high-ground lane: minZ=${minimumZ}, final=${player.move.pos}`,
  );
});

test('frontline and support bots reinforce the central route', () => {
  const world = new World(buildMap(), MODE, COMBAT, 73);
  const frontline = world.addPlayer('frontline-bot', true, 0, 'zairu');
  const support = world.addPlayer('support-bot', true, 0, 'tsuzuri');

  assert.equal(new BotController(world, frontline, () => 0.99).route, 'front');
  assert.equal(new BotController(world, support, () => 0.99).route, 'front');
});

test('airborne recovery plans on authored walkable floors instead of cover tops', () => {
  const world = new World(buildMap(), MODE, COMBAT, 73);
  const path = findGroundRecoveryPath(world, [10.66, 22.86, 5], [6.5, 23, 4]);

  assert.ok(path.length >= 2, `missing path: ${JSON.stringify(path)}`);
  assert.ok(path.every(point => Math.abs(point[2] - 4) < 1e-9), JSON.stringify(path));
  assert.ok(Math.hypot(path.at(-1)[0] - 6.5, path.at(-1)[1] - 23) <= 1);
});

test('level-aware recovery climbs the authored shallows stair instead of stopping on a wrong low surface', () => {
  const world = new World(buildMap(), MODE, COMBAT, 73);
  const start = [-11.6, 26.4, 0];
  const target = [-14, 26.25, 4];
  const path = findGroundRecoveryPath(world, start, target);

  assert.ok(path.length >= 8, `missing cumulative stair path: ${JSON.stringify(path)}`);
  assert.ok(path.some(point => point[2] >= 3.5), JSON.stringify(path));
  assert.deepEqual(path.at(-1), target);
  let previous = start;
  for (const point of path) {
    assert.equal(
      canTraverseGroundSegment(world, previous, point),
      true,
      `unsafe stair recovery segment ${JSON.stringify({ previous, point, path })}`,
    );
    previous = point;
  }
});

test('recovery path preserves capsule clearance around the north wall corner', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const start = [23.6, 20.373, 4];
  const target = [30, 23, 4];
  const path = findGroundRecoveryPath(world, start, target);

  assert.ok(path.length >= 2, `missing wall-corner detour: ${JSON.stringify(path)}`);
  let previous = start;
  for (const point of path) {
    assert.equal(
      canTraverseGroundSegment(world, previous, point),
      true,
      `unsafe recovery segment ${JSON.stringify({ previous, point, path })}`,
    );
    previous = point;
  }
});

test('recovery rejoin evaluates nearby cells before farther candidates', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const start = [23.6, 20.373, 4];
  const target = [30, 23, 4];
  let sweepCount = 0;
  const sweepCylinder = world.collider.sweepCylinder.bind(world.collider);
  world.collider.sweepCylinder = (...args) => {
    sweepCount++;
    return sweepCylinder(...args);
  };

  const path = findGroundRecoveryPath(world, start, target);

  assert.ok(path.length >= 2, `missing wall-corner detour: ${JSON.stringify(path)}`);
  assert.ok(
    sweepCount < 1000,
    `recovery rechecked too many farther candidates: ${sweepCount} sweeps`,
  );
});

test('ground recovery A-star is exactly equivariant under the authored 180-degree mirror', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20268632);
  const start = [27, 2, 4];
  const target = [13, 9.5, 4];
  const rotate = point => [
    Object.is(-point[0], -0) ? 0 : -point[0],
    Object.is(-point[1], -0) ? 0 : -point[1],
    point[2],
  ];
  const forward = findGroundRecoveryPath(world, start, target);
  const mirrored = findGroundRecoveryPath(world, rotate(start), rotate(target));

  assert.ok(forward.length > 0 && mirrored.length > 0);
  assert.deepEqual(mirrored, forward.map(rotate));
});

test('recovery widens its search only when a large slab requires an outside detour', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  // The lower-lane connector now occupies the old y=18 fixture. Keep this
  // probe on valid low ground beside the market slab so the narrow search
  // still fails and the wider fallback must route around the structure.
  const start = [-32.5, 15, 0];
  const target = [-21, 30, 0];
  const narrow = findGroundRecoveryPath(world, start, target, { fallbackMarginM: null });
  const recovered = findGroundRecoveryPath(world, start, target);

  assert.deepEqual(narrow, []);
  assert.ok(recovered.length > 0);
  assert.deepEqual(recovered.at(-1), target);
  let previous = start;
  for (const waypoint of recovered) {
    assert.equal(canTraverseGroundSegment(world, previous, waypoint), true);
    previous = waypoint;
  }
});

test('a bot refuses a movement ability whose projected path leaves the platform', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('dash-bot', true, 0, 'asagi');
  const enemy = world.addPlayer('dash-target', false, 1, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [31.4, 10, 4];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  player.hp = player.maxHp * 0.4;
  // The high slab ends at x=32; this eastward dash would cross a four-metre
  // drop. The old northward fixture stayed on the slab and was actually safe.
  enemy.move.pos = [39, 10, 4];
  enemy.move.grounded = true;
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability1 = 99;
  player.abilities.cooldowns.ability2 = 0;
  bot.lastRound = world.flow.round;

  bot.think(world.dt);

  assert.equal(player.input.ability2, false);
});

test('dash safety uses the full capsule footprint across narrow stair treads', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('stair-dash-bot', true, 1, 'hokuchi');
  player.move.pos = [-41.571, 10.057, 2.5];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;

  assert.equal(hasSafeGroundPath(world, player, 0.5833, 9), false);
});

test('a bot never stacks a movement ability onto an airborne recovery', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('recovery-dash-bot', true, 1, 'hokuchi');
  const enemy = world.addPlayer('recovery-dash-target', false, 0, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  player.move.pos = [-42.157, 8.034, 4.206];
  player.move.grounded = false;
  enemy.move.pos = [-34.6, 13.05, 4];
  assert.equal(bot.movementActionIsSafe('ability2', { enemy, ally: null }), false);

  player.move.pos = [-41.5, 8, 4];
  player.move.grounded = true;
  bot.recoveryPath = [[-41.5, 9, 3.5]];
  assert.equal(bot.movementActionIsSafe('ability2', { enemy, ally: null }), false);
});

test('a bot pursues only the last seen position after line of sight is lost', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('memory-bot', true, 0, 'asagi');
  const enemy = world.addPlayer('memory-target', false, 1, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  // Start on the objective side of the new x=12.2 full-height cover. The
  // first target remains visible, then the existing market pillar occludes
  // the same remembered target when it moves to x=22.
  player.move.pos = [15, 0, 4];
  player.move.grounded = true;
  enemy.move.pos = [18, 0, 4];
  enemy.move.grounded = true;
  bot.route = 'front';
  bot.lastRound = world.flow.round;

  bot.think(world.dt);
  assert.equal(bot.mode, 'fight');
  assert.deepEqual(bot.lastKnownTargetPos, [18, 0, 4]);

  // The market pillar at x=19.2..20.8 blocks this sight line. The bot may
  // investigate the last observation, but must not track or fire at the live
  // position through the wall.
  enemy.move.pos = [22, 0, 4];
  bot.think(world.dt);

  assert.equal(bot.mode, 'pursue');
  assert.deepEqual(bot.lastKnownTargetPos, [18, 0, 4]);
  assert.equal(player.input.fire, false);
  assert.equal(player.input.primary, false);
});

test('a teammate shares a recent visible target without granting wall vision', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const scout = world.addPlayer('focus-scout', true, 0, 'asagi');
  const follower = world.addPlayer('focus-follower', true, 0, 'botan');
  const enemy = world.addPlayer('focus-target', false, 1, 'baraga');
  const scoutBot = new BotController(world, scout, () => 0.5);
  const followerBot = new BotController(world, follower, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider.dynamic = [];
  scout.move.pos = [22, 5, 4];
  follower.move.pos = [10, 0, 4];
  enemy.move.pos = [22, 0, 4];
  scout.move.grounded = follower.move.grounded = enemy.move.grounded = true;
  scoutBot.route = followerBot.route = 'front';
  scoutBot.lastRound = followerBot.lastRound = world.flow.round;

  scoutBot.think(world.dt);
  followerBot.think(world.dt);

  assert.equal(scoutBot.mode, 'fight');
  assert.equal(followerBot.mode, 'pursue');
  assert.equal(followerBot.targetId, enemy.id);
  assert.deepEqual(followerBot.lastKnownTargetPos, [22, 0, 4]);
  assert.equal(follower.input.fire, false);
  assert.equal(follower.input.primary, false);
});

test('short-lived pursuit uses a bounded safe detour around cover', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const start = [10, 0, 4];
  const target = [22, 0, 4];
  const path = findGroundDetourPath(world, start, target);

  assert.ok(path.length >= 2, JSON.stringify(path));
  let previous = start;
  for (const point of path) {
    assert.equal(
      canTraverseGroundSegment(world, previous, point),
      true,
      JSON.stringify({ previous, point, path }),
    );
    previous = point;
  }
  assert.deepEqual(path.at(-1), target);
});

test('ground detour is exactly equivariant under the authored 180-degree mirror', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const start = [10, 0, 4];
  const target = [22, 0, 4];
  const rotate = point => [
    Object.is(-point[0], -0) ? 0 : -point[0],
    Object.is(-point[1], -0) ? 0 : -point[1],
    point[2],
  ];
  const forward = findGroundDetourPath(world, start, target);
  const mirrored = findGroundDetourPath(world, rotate(start), rotate(target));

  assert.ok(forward.length > 0 && mirrored.length > 0);
  assert.deepEqual(mirrored, forward.map(rotate));
});

test('formation retreat skips the route waypoint already underfoot', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20268632);
  const player = world.addPlayer('route-retreat-bot', true, 1, 'tsuzuri');
  const bot = new BotController(world, player, () => 0.5);
  bot.route = 'shallows';
  bot.wpIndex = 13;
  const points = bot.routePoints();
  player.move.pos = [...points[12]];
  const input = {
    f: false, b: false, l: false, r: false, jump: false,
    yaw: 0,
  };

  bot.steerBackAlongRoute(input);

  const movement = intendedMovementVector(input);
  const desired = [
    points[11][0] - player.move.pos[0],
    points[11][1] - player.move.pos[1],
  ];
  const desiredLength = Math.hypot(...desired);
  const progress = (movement[0] * desired[0] + movement[1] * desired[1]) / desiredLength;
  assert.ok(progress > 0.7, JSON.stringify({ movement, desired, input }));
});

test('combat rejoin preserves authored route progress instead of returning to spawn', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20260713);
  const player = world.addPlayer('progress-rejoin-bot', true, 0, 'shirasagi');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider.dynamic = [];
  bot.route = 'shallows';
  const points = bot.routePoints();
  const descentIndices = points
    .map((point, index) => index > 0 && point[2] < points[index - 1][2] ? index : -1)
    .filter(index => index >= 0);
  const targetIndex = descentIndices.at(-1);
  assert.ok(targetIndex > 0, 'shallows must expose a grounded descent target');
  bot.wpIndex = targetIndex;
  player.move.pos = [...points[targetIndex - 1]];
  player.move.grounded = true;

  assert.equal(bot.planRecoveryOnCurrentRoute(), true);
  assert.ok(bot.wpIndex >= targetIndex - 2, `regressed to waypoint ${bot.wpIndex}`);
  assert.deepEqual(bot.recoveryPath.at(-1), points[targetIndex]);
});

test('recovery falls back from a distant same-height stair to a reachable route tread', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20276551);
  const player = world.addPlayer('wrong-stair-bot', true, 0, 'tsubakuro');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [16.114, -27, 3.5];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  bot.route = 'shallows';
  bot.wpIndex = 33;
  bot.mode = 'advance';
  bot.lastRound = world.flow.round;

  assert.equal(bot.planRecoveryOnCurrentRoute(), true);
  assert.notEqual(bot.wpIndex, 33, `unreachable same-height stair retained: ${bot.wpIndex}`);
  assert.ok(bot.recoveryPath.length > 0);
});

test('a high-ground rejoin failure never reroutes the frontline through the shallows', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20268632);
  const player = world.addPlayer('frontline-rejoin-bot', true, 1, 'nuedori');
  const bot = new BotController(world, player, () => 0.5);
  bot.route = 'front';
  bot.planRecoveryOnCurrentRoute = () => false;

  assert.equal(bot.rejoinCurrentRoute(), false);
  assert.equal(bot.route, 'front');
});

test('an unchanged failed route rejoin is retried on a bounded cadence', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20268632);
  const player = world.addPlayer('retry-bound-bot', true, 1, 'nuedori');
  const bot = new BotController(world, player, () => 0.5);
  bot.route = 'front';
  bot.wpIndex = 0;
  bot.routePoints = () => [[1000, 1000, 0]];
  bot.recoveryWaypointCandidates = () => [0];
  let staticQueries = 0;
  const staticSolidsInAabb = world.collider.staticSolidsInAabb.bind(world.collider);
  world.collider.staticSolidsInAabb = (...args) => {
    staticQueries++;
    return staticSolidsInAabb(...args);
  };

  assert.equal(bot.planRecoveryOnCurrentRoute(), false);
  const firstAttemptQueries = staticQueries;
  assert.ok(firstAttemptQueries > 0);
  assert.equal(bot.planRecoveryOnCurrentRoute(), false);
  assert.equal(staticQueries, firstAttemptQueries, 'unchanged failure was replanned in the same tick');

  world.t += 1;
  assert.equal(bot.planRecoveryOnCurrentRoute(), false);
  assert.ok(staticQueries > firstAttemptQueries, 'retry never reopened after its bounded delay');
});

test('stair traversal retains movement ownership instead of starting a strafe fight', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20276551);
  const player = world.addPlayer('stair-owner-bot', true, 0, 'tsubakuro');
  const enemy = world.addPlayer('stair-owner-target', false, 1, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [40.04, -9, 3.5];
  player.move.grounded = true;
  enemy.move.pos = [38, -12, 3.5];
  enemy.move.grounded = true;
  bot.route = 'shallows';
  bot.wpIndex = 4;
  bot.mode = 'advance';
  bot.lastRound = world.flow.round;

  assert.equal(isOnAuthoredStair(world, player), true);
  bot.think(world.dt);
  assert.equal(bot.mode, 'advance');
  assert.equal(player.input.ability1, false);
});

test('stair traversal keeps a visible precision target and charges without surrendering route movement', () => {
  const world = new World(buildMap(), MODE, COMBAT, 20276551);
  const player = world.addPlayer('stair-precision-bot', true, 0, 'shirasagi');
  const enemy = world.addPlayer('stair-precision-target', false, 1, 'baraga');
  const bot = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [40.04, -9, 3.5];
  player.move.grounded = true;
  enemy.move.pos = [38, -12, 3.5];
  enemy.move.grounded = true;
  bot.route = 'shallows';
  bot.wpIndex = 4;
  bot.mode = 'advance';
  bot.lastRound = world.flow.round;
  bot.targetId = enemy.id;
  bot.aimErr = 3;
  bot.teamPressureAnchor = () => player;

  assert.equal(isOnAuthoredStair(world, player), true);
  bot.think(world.dt);

  assert.equal(bot.mode, 'advance', 'the authored stair route still owns movement');
  assert.equal(bot.targetId, enemy.id, 'a clear firing line is retained while traversing');
  assert.equal(player.input.fire, true, 'the precision weapon continues its charge cycle');
  assert.equal(player.input.l || player.input.r, false, 'combat strafing does not replace stair safety');
  assert.equal(player.input.ability2, false, 'the backstep remains blocked on a stair tread');
});
