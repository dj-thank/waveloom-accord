import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Collider,
  rayCylinder,
  rayCylinderSide,
  sweepSphereCylinder,
  sweepSphereCylinderSide,
} from '../shared/sim/collision.js';
import { buildMap } from '../shared/data/map_oshioi.js';

function makeRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function between(rng, lo, hi) {
  return lo + (hi - lo) * rng();
}

function assertSameQuery(fast, linear, method, args) {
  assert.deepEqual(
    fast[method](...args),
    linear[method](...args),
    `${method}(${args.join(', ')})`,
  );
}

function overlapsAabbXY(solid, minX, minY, maxX, maxY) {
  return solid.max[0] >= minX
    && solid.min[0] <= maxX
    && solid.max[1] >= minY
    && solid.min[1] <= maxY;
}

test('sphere-cylinder sweep は radius=0 で既存 ray API へ完全委譲する', () => {
  const queries = [
    [-3, 0, 1, 1, 0, 0, 0, 0, 0, 2, 1, 10],
    [3, 0.5, 3, -1, 0, -0.5, 0, 0, 0, 2, 1, 10],
    [0, 0, 4, 0, 0, -1, 0, 0, 0, 2, 1, 10],
  ];
  for (const query of queries) {
    const [...prefix] = query;
    const cylinderRadius = prefix.at(-2);
    const maxDist = prefix.at(-1);
    const common = prefix.slice(0, -2);
    assert.equal(
      sweepSphereCylinder(...common, cylinderRadius, 0, maxDist),
      rayCylinder(...query),
    );
    assert.equal(
      sweepSphereCylinderSide(...common, cylinderRadius, 0, maxDist),
      rayCylinderSide(...query),
    );
  }
});

test('closed cylinder は side・cap・丸いrimの exact sphere TOIを返す', () => {
  const hit = (origin, direction, maxDist = 10, sphereRadius = 0.25) =>
    sweepSphereCylinder(
      ...origin, ...direction,
      0, 0, 0, 2, 1, sphereRadius, maxDist,
    );

  assert.equal(hit([-3, 0, 1], [1, 0, 0]), 1.75);
  assert.equal(hit([0, 0, 4], [0, 0, -1]), 1.75);
  assert.ok(Math.abs(hit([-3, 0, 2.2], [1, 0, 0]) - 1.85) < 1e-10);
  assert.equal(hit([3, 0, 1], [-1, 0, 0]), 1.75);
  assert.equal(hit([1.1, 0, 1], [1, 0, 0], 10, 0.2), 0);
  assert.equal(hit([-3, 0, 1], [1, 0, 0], 1.75), 1.75);
  assert.ok(Math.abs(hit([-3, 1.25, 1], [1, 0, 0]) - 3) < 1e-10);
});

test('capless cylinder shell は outside・inside・開放端rimの exact offsetを返す', () => {
  const hit = (origin, direction, maxDist = 10, sphereRadius = 0.2) =>
    sweepSphereCylinderSide(
      ...origin, ...direction,
      0, 0, 0, 2, 1, sphereRadius, maxDist,
    );
  const rimOffset = Math.sqrt(0.2 ** 2 - 0.15 ** 2);

  assert.ok(Math.abs(hit([3, 0, 1], [-1, 0, 0]) - 1.8) < 1e-12);
  assert.ok(Math.abs(hit([0, 0, 1], [1, 0, 0]) - 0.8) < 1e-12);
  assert.equal(hit([0.9, 0, 1], [1, 0, 0]), 0);
  assert.ok(Math.abs(hit([-3, 0, -0.15], [1, 0, 0]) - (2 - rimOffset)) < 1e-10);
  assert.ok(Math.abs(hit([0, 0, -0.15], [1, 0, 0]) - (1 - rimOffset)) < 1e-10);
  assert.equal(hit([0, 0, -1], [0, 0, 1]), -1);
  assert.ok(Math.abs(hit([-3, 1.2, 1], [1, 0, 0]) - 3) < 1e-10);
  assert.ok(Math.abs(hit([3, 0, 1], [-1, 0, 0], 1.8) - 1.8) < 1e-12);
  assert.equal(hit([3, 0, 1], [-1, 0, 0], 1.799), -1);
  assert.ok(Math.abs(hit([1_000_000, 0, 1], [-1, 0, 0], 2_000_000) - 999_998.8) < 1e-8);
});

test('broadphase は authored map の full-linear oracle と決定論的に一致する', () => {
  const map = buildMap();
  const fast = new Collider(map.solids);
  const linear = new Collider(map.solids, { broadphase: false });
  fast.dynamic = map.setupDoors;
  linear.dynamic = map.setupDoors;
  const rng = makeRng(0xc0111de);

  for (let i = 0; i < 180; i++) {
    const origin = [between(rng, -60, 60), between(rng, -45, 45), between(rng, -2, 12)];
    let direction = [between(rng, -1, 1), between(rng, -1, 1), between(rng, -1, 1)];
    const length = Math.hypot(...direction) || 1;
    direction = direction.map(value => value / length);
    const maxDist = between(rng, 0.01, 180);
    assertSameQuery(fast, linear, 'trace', [...origin, ...direction, maxDist]);

    const cx = between(rng, -60, 60);
    const cy = between(rng, -45, 45);
    const radius = between(rng, 0.15, 0.9);
    const zLo = between(rng, -2, 10);
    const zHi = zLo + between(rng, 0.2, 3);
    const scale = i % 17 === 0 ? 1000 : 12;
    const dx = between(rng, -scale, scale);
    const dy = between(rng, -scale, scale);
    assertSameQuery(fast, linear, 'sweepCylinder', [cx, cy, radius, zLo, zHi, dx, dy]);
    assertSameQuery(fast, linear, 'moveCylinder', [cx, cy, radius, zLo, zHi, dx, dy]);
    assertSameQuery(fast, linear, 'overlapsCylinder', [cx, cy, zLo, radius, zHi - zLo]);
    assertSameQuery(fast, linear, 'groundHeight', [cx, cy, zLo, radius, between(rng, 0, 3)]);
    assertSameQuery(fast, linear, 'resolveAxis', [
      cx, cy, radius, zLo, zHi, i % 2, (i % 2 ? cy : cx) + dx,
    ]);
    assertSameQuery(fast, linear, 'sweepVerticalCylinder', [
      cx, cy, radius, zLo, zHi - zLo, between(rng, -100, 100),
    ]);
  }

  const boundaryQueries = [
    [-48, -36, 1, 1, 0, 0, 200],
    [48, 36, 1, -1, 0, 0, 200],
    [0, 0, 20, 0, 0, -1, 100],
    [0, 0, -20, 0, 0, 1, 100],
    [-4, -4, 1, Math.SQRT1_2, Math.SQRT1_2, 0, 200],
  ];
  for (const query of boundaryQueries) assertSameQuery(fast, linear, 'trace', query);
});

test('staticSolidsInAabb は authored map の完全な静的候補のみを返し、solids 再代入を即時反映する', () => {
  const map = buildMap();
  const fast = new Collider(map.solids);
  const linear = new Collider(map.solids, { broadphase: false });
  const dynamicOnly = { min: [-1, -1, 0], max: [1, 1, 3], tag: 'dynamic-only' };
  fast.dynamic = [dynamicOnly];
  linear.dynamic = [dynamicOnly];

  const queries = [
    [-48, -36, -32, -20],
    [-12, -10, 12, 10],
    [28, 20, 44, 36],
  ];
  for (const query of queries) {
    const expected = map.solids.filter(solid => overlapsAabbXY(solid, ...query));
    const fastCandidates = fast.staticSolidsInAabb(...query);
    const linearCandidates = linear.staticSolidsInAabb(...query);
    assert.deepEqual(fastCandidates, expected, `fast(${query.join(', ')})`);
    assert.deepEqual(linearCandidates, expected, `linear(${query.join(', ')})`);
    assert.equal(fastCandidates.includes(dynamicOnly), false);
    assert.equal(linearCandidates.includes(dynamicOnly), false);
  }

  fast.trace(-44, -30, 1, 1, 0, 0, 8);
  const lastCollisionQuery = fast.diagnostics().broadphase.lastQuery;
  fast.staticSolidsInAabb(...queries[0]);
  assert.deepEqual(fast.diagnostics().broadphase.lastQuery, lastCollisionQuery);

  const replacement = { min: [500, 500, 0], max: [501, 501, 3], tag: 'replacement' };
  fast.solids = [replacement];
  linear.solids = [replacement];
  assert.deepEqual(fast.staticSolidsInAabb(499, 499, 502, 502), [replacement]);
  assert.deepEqual(linear.staticSolidsInAabb(499, 499, 502, 502), [replacement]);
  assert.deepEqual(fast.staticSolidsInAabb(-2, -2, 2, 2), []);
  assert.deepEqual(linear.staticSolidsInAabb(-2, -2, 2, 2), []);
});

test('refreshStaticGeometry makes in-place static edits visible to the spatial index', () => {
  const moved = { min: [-1, -1, 0], max: [1, 1, 3], tag: 'moved' };
  const replaced = { min: [8, -1, 0], max: [9, 1, 3], tag: 'replaced' };
  const first = { min: [16, -1, 0], max: [17, 1, 3], tag: 'first' };
  const second = { min: [20, -1, 0], max: [21, 1, 3], tag: 'second' };
  const fillers = Array.from({ length: 33 }, (_, index) => ({
    min: [100 + index * 3, 100, 0],
    max: [101 + index * 3, 101, 3],
    tag: `filler-${index}`,
  }));
  const solids = [moved, replaced, first, second, ...fillers];
  const fast = new Collider(solids);
  const linear = new Collider(solids, { broadphase: false });
  const assertMatchesLinearOracle = (...query) => {
    const expected = solids.filter(solid => overlapsAabbXY(solid, ...query));
    assert.deepEqual(fast.staticSolidsInAabb(...query), expected, `fast(${query.join(', ')})`);
    assert.deepEqual(linear.staticSolidsInAabb(...query), expected, `linear(${query.join(', ')})`);
  };

  assertMatchesLinearOracle(-2, -2, 2, 2);
  assert.equal(fast.diagnostics().broadphase.index.mode, 'grid');

  moved.min[0] = 40;
  moved.min[1] = 40;
  moved.max[0] = 41;
  moved.max[1] = 41;
  fast.refreshStaticGeometry();
  assertMatchesLinearOracle(39, 39, 42, 42);
  assertMatchesLinearOracle(-2, -2, 2, 2);
  assertSameQuery(fast, linear, 'trace', [38, 40.5, 1, 1, 0, 0, 5]);
  assertSameQuery(fast, linear, 'sweepCylinder', [38, 40.5, 0.25, 0.5, 2, 5, 0]);

  const replacement = { min: [50, -1, 0], max: [51, 1, 3], tag: 'replacement' };
  solids[1] = replacement;
  fast.refreshStaticGeometry();
  assertMatchesLinearOracle(49, -2, 52, 2);
  assertMatchesLinearOracle(7, -2, 10, 2);
  assertSameQuery(fast, linear, 'trace', [48, 0, 1, 1, 0, 0, 5]);
  assertSameQuery(fast, linear, 'sweepCylinder', [48, 0, 0.25, 0.5, 2, 5, 0]);

  solids.reverse();
  fast.refreshStaticGeometry();
  assertMatchesLinearOracle(15, -2, 22, 2);
});

test('grid collision hot paths do not rescan every static solid after indexing', () => {
  const target = { min: [0, -1, 0], max: [1, 1, 3], tag: 'target' };
  const backing = [target, ...Array.from({ length: 48 }, (_, index) => ({
    min: [100 + index * 3, 100, 0],
    max: [101 + index * 3, 101, 3],
    tag: `filler-${index}`,
  }))];
  let indexedReads = 0;
  const solids = new Proxy(backing, {
    get(source, property, receiver) {
      if (typeof property === 'string' && /^(?:0|[1-9]\d*)$/.test(property)) indexedReads++;
      return Reflect.get(source, property, receiver);
    },
  });
  const collider = new Collider(solids);

  // Build the grid, explicitly refresh it once, then count source-array index
  // reads made by narrow local collision calls. A broadphase rebuild would read
  // all 49 entries per call; the direct candidate reads below stay bounded by
  // the local target.
  collider.trace(-3, 0, 1, 1, 0, 0, 10);
  collider.refreshStaticGeometry();
  indexedReads = 0;
  for (let index = 0; index < 3; index++) {
    assert.equal(collider.trace(-3, 0, 1, 1, 0, 0, 10).solid, target);
    assert.equal(collider.sweepCylinder(-3, 0, 0.25, 0.5, 2, 5, 0).solid, target);
  }
  assert.ok(indexedReads <= 8, `expected bounded local candidate reads, got ${indexedReads}`);
  const broadphase = collider.diagnostics().broadphase;
  assert.equal(broadphase.index.mode, 'grid');
  assert.equal(broadphase.lastQuery.mode, 'grid');
  assert.equal(broadphase.lastQuery.candidateSolids, 1);

  // Navigation asks this public AABB API directly, so guard it separately from
  // trace/sweep against a future all-source filter or linear fallback.
  indexedReads = 0;
  for (let index = 0; index < 3; index++) {
    assert.deepEqual(collider.staticSolidsInAabb(-3, -3, 3, 3), [target]);
  }
  assert.ok(indexedReads <= 3, `expected bounded navigation candidate reads, got ${indexedReads}`);
});

test('staticSolidsInAabb keeps malformed static bounds fail-open for legacy narrow phase', () => {
  const malformed = { min: [10, 0, 0], max: [0, 1, 4], tag: 'ground' };
  const fillers = Array.from({ length: 33 }, (_, index) => ({
    min: [100 + index * 2, 100, 0],
    max: [101 + index * 2, 101, 1],
    tag: 'ground',
  }));
  const collider = new Collider([malformed, ...fillers]);

  const candidates = collider.staticSolidsInAabb(9.5, 0.4, 10.5, 0.6);

  assert.deepEqual(candidates, [malformed]);
});

test('broadphase は候補を削減し diagnostics の snapshot は深く immutable', () => {
  const map = buildMap();
  const collider = new Collider(map.solids);

  collider.trace(-44, -30, 1, 1, 0, 0, 8);
  const snapshot = collider.diagnostics();
  const query = snapshot.broadphase.lastQuery;

  assert.equal(query.kind, 'trace');
  assert.equal(query.totalSolids, map.solids.length);
  assert.ok(query.candidateSolids <= 40, JSON.stringify(query));
  assert.ok(query.candidateSolids < query.totalSolids / 4, JSON.stringify(query));
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.broadphase), true);
  assert.equal(Object.isFrozen(query), true);
  assert.equal(Object.isFrozen(snapshot.depenetration), true);
  assert.equal(Object.isFrozen(snapshot.depenetration.displacement), true);
  assert.throws(() => { query.candidateSolids = 0; }, TypeError);
  assert.equal(collider.diagnostics().broadphase.lastQuery.candidateSolids, query.candidateSolids);
});

test('small-map linear fallback と solids/dynamic 配列の再代入を即時反映する', () => {
  const first = { min: [2, -1, 0], max: [2.2, 1, 3], tag: 'first' };
  const second = { min: [5, -1, 0], max: [5.2, 1, 3], tag: 'second' };
  const collider = new Collider([first]);

  assert.equal(collider.trace(0, 0, 1, 1, 0, 0, 10).solid, first);
  assert.equal(collider.diagnostics().broadphase.lastQuery.mode, 'linear');

  collider.solids = [second];
  assert.equal(collider.trace(0, 0, 1, 1, 0, 0, 10).solid, second);
  collider.dynamic = [first];
  assert.equal(collider.trace(0, 0, 1, 1, 0, 0, 10).solid, first);
  collider.dynamic = [];
  assert.equal(collider.trace(0, 0, 1, 1, 0, 0, 10).solid, second);
});

test('grid 候補の dedupe 後も完全 tie は static 元配列の先着 identity を保つ', () => {
  const first = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const second = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const fillers = Array.from({ length: 40 }, (_, index) => ({
    min: [100 + index * 3, 100, 0],
    max: [101 + index * 3, 101, 3],
  }));

  for (const [expected, solids] of [[first, [first, second]], [second, [second, first]]]) {
    const collider = new Collider([...solids, ...fillers]);
    assert.equal(collider.trace(0, 0, 1, 1, 0, 0, 10).solid, expected);
    assert.equal(collider.sweepVerticalCylinder(2.1, 0, 0.2, 4, 1, -10).solid, expected);
  }
});

test('1e308 の有限 AABB は unsafe cell loop に入らず overflow から正確に判定する', () => {
  const hugeCoordinate = { min: [1e308, 1e308, 0], max: [1e308, 1e308, 1] };
  const fillers = Array.from({ length: 40 }, (_, index) => ({
    min: [index * 3, -1, 0],
    max: [index * 3 + 1, 1, 1],
  }));
  const collider = new Collider([...fillers, hugeCoordinate]);

  const hit = collider.trace(1e308, 1e308, 0.5, 1, 0, 0, 1);

  assert.equal(hit.solid, hugeCoordinate);
  assert.equal(hit.dist, 0);
  assert.ok(collider.diagnostics().broadphase.index.overflowSolids >= 1);
});

test('traceSphere radius=0 は既存 trace と完全互換', () => {
  const map = buildMap();
  const collider = new Collider(map.solids);
  const queries = [
    [0, 0, 2, 1, 0, 0, 100],
    [40, 30, 5, -1, -0.5, -0.1, 200],
    [0, 0, 20, 0, 0, -1, 100],
    [-50, -40, 1, 1, 1, 0, 1_000_000],
  ];
  for (const query of queries) {
    assert.deepEqual(collider.traceSphere(...query, 0), collider.trace(...query));
  }
});

test('traceSphere は expanded-box の角 false positive を避け真の角 TOI と法線を返す', () => {
  const box = { min: [0, 0, 0], max: [1, 1, 1], tag: 'box' };
  const collider = new Collider([box]);

  const miss = collider.traceSphere(-1, 1.15, 1.15, 1, 0, 0, 3, 0.2);
  const hit = collider.traceSphere(-1, 1.1, 1.1, 1, 0, 0, 3, 0.2);

  assert.equal(miss.hit, false);
  assert.equal(miss.dist, Infinity);
  assert.equal(hit.solid, box);
  assert.ok(Math.abs(hit.dist - (1 - Math.sqrt(0.02))) < 1e-12, `${hit.dist}`);
  assert.ok(Math.abs(hit.point[0] + Math.sqrt(0.02)) < 1e-12, `${hit.point}`);
  assert.ok(Math.abs(hit.point[1] - 1.1) < 1e-12, `${hit.point}`);
  assert.ok(Math.abs(hit.point[2] - 1.1) < 1e-12, `${hit.point}`);
  assert.ok(Math.abs(hit.normal[0] + Math.SQRT1_2) < 1e-12, `${hit.normal}`);
  assert.ok(Math.abs(hit.normal[1] - 0.5) < 1e-12, `${hit.normal}`);
  assert.ok(Math.abs(hit.normal[2] - 0.5) < 1e-12, `${hit.normal}`);
});

test('traceSphere は床・天井・負方向と開始 overlap、maxDist 終端除外を保つ', () => {
  const floor = { min: [-5, -5, -1], max: [5, 5, 0], tag: 'floor' };
  const box = { min: [0, 0, 0], max: [1, 1, 1], tag: 'box' };

  const floorHit = new Collider([floor]).traceSphere(0, 0, 2, 0, 0, -1, 10, 0.25);
  assert.equal(floorHit.dist, 1.75);
  assert.deepEqual(floorHit.point, [0, 0, 0.25]);
  assert.deepEqual(floorHit.normal, [0, 0, 1]);

  const ceilingHit = new Collider([box]).traceSphere(0.5, 0.5, -2, 0, 0, 1, 10, 0.25);
  assert.equal(ceilingHit.dist, 1.75);
  assert.deepEqual(ceilingHit.normal, [0, 0, -1]);

  const negative = new Collider([box]).traceSphere(2, 0.5, 0.5, -1, 0, 0, 10, 0.2);
  assert.ok(Math.abs(negative.dist - 0.8) < 1e-12, `${negative.dist}`);
  assert.deepEqual(negative.normal, [1, 0, 0]);

  const overlap = new Collider([box]).traceSphere(-0.1, 0.5, 0.5, 1, 0, 0, 10, 0.2);
  assert.equal(overlap.dist, 0);
  assert.deepEqual(overlap.point, [-0.1, 0.5, 0.5]);
  assert.deepEqual(overlap.normal, [-1, 0, 0]);
  assert.equal(new Collider([box]).traceSphere(2, 0.5, 0.5, -1, 0, 0, 0.8, 0.2).dist, Infinity);
});

test('traceSphere broadphase は full-linear oracle と dynamic/tie/巨大負移動で一致する', () => {
  const map = buildMap();
  const fast = new Collider(map.solids);
  const linear = new Collider(map.solids, { broadphase: false });
  fast.dynamic = map.setupDoors;
  linear.dynamic = map.setupDoors;
  const rng = makeRng(0x5fee1234);
  for (let index = 0; index < 240; index++) {
    const origin = [between(rng, -70, 70), between(rng, -55, 55), between(rng, -5, 15)];
    let direction = [between(rng, -1, 1), between(rng, -1, 1), between(rng, -1, 1)];
    const length = Math.hypot(...direction) || 1;
    direction = direction.map(value => value / length);
    const maxDist = index % 31 === 0 ? 1_000_000 : between(rng, 0.01, 200);
    const radius = between(rng, 0.01, 0.8);
    assertSameQuery(fast, linear, 'traceSphere', [...origin, ...direction, maxDist, radius]);
  }

  const first = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const second = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const fillers = Array.from({ length: 40 }, (_, index) => ({
    min: [100 + index * 3, 100, 0], max: [101 + index * 3, 101, 3],
  }));
  const tie = new Collider([first, second, ...fillers]);
  assert.equal(tie.traceSphere(0, 0, 1, 1, 0, 0, 10, 0.2).solid, first);

  const huge = new Collider([{ min: [0, -1, 0], max: [1, 1, 2] }]);
  const hugeHit = huge.traceSphere(1_000_000, 0, 1, -1, 0, 0, 2_000_000, 0.4);
  assert.ok(Math.abs(hugeHit.dist - 999_998.6) < 1e-9, `${hugeHit.dist}`);
});

test('静止中の単一壁 overlap は最小距離かつ決定論的な位置へ押し出す', () => {
  const wall = { min: [-0.1, -1, 0], max: [0.1, 1, 3], tag: 'wall' };
  const collider = new Collider([wall]);

  const motion = collider.moveCylinder(0, 0, 0.4, 0, 1.7, 0, 0);
  const diagnostics = collider.diagnostics().depenetration;

  assert.deepEqual(motion.position, [-0.5, 0]);
  assert.deepEqual(motion.displacement, [-0.5, 0]);
  assert.equal(collider.overlapsCylinder(...motion.position, 0, 0.4, 1.7), false);
  assert.equal(diagnostics.attempted, true);
  assert.equal(diagnostics.resolved, true);
  assert.deepEqual(diagnostics.displacement, [-0.5, 0]);
});

test('複数 solid の完全な十字 overlap は配列順によらず同じ最短候補へ脱出する', () => {
  const walls = [
    { min: [-0.1, -1, 0], max: [0.1, 1, 3], tag: 'vertical' },
    { min: [-1, -0.1, 0], max: [1, 0.1, 3], tag: 'horizontal' },
  ];
  const positions = [];

  for (const solids of [walls, [...walls].reverse()]) {
    const collider = new Collider(solids);
    const motion = collider.moveCylinder(0, 0, 0.2, 0, 1.7, 0, 0);
    positions.push(motion.position);
    assert.equal(collider.overlapsCylinder(...motion.position, 0, 0.2, 1.7), false);
    assert.ok(motion.position.every(Number.isFinite));
  }

  const negativeExit = -0.1 - 0.2;
  assert.deepEqual(positions, [
    [negativeExit, negativeExit],
    [negativeExit, negativeExit],
  ]);
});

test('完全囲いで安全候補が上限内にない場合は有限な元位置に据え置き diagnostic を返す', () => {
  const enclosure = { min: [-100, -100, 0], max: [100, 100, 3], tag: 'enclosure' };
  const collider = new Collider([enclosure]);

  const motion = collider.moveCylinder(0, 0, 0.4, 0, 1.7, 0, 0);
  const diagnostics = collider.diagnostics().depenetration;

  assert.deepEqual(motion.position, [0, 0]);
  assert.ok(motion.position.every(Number.isFinite));
  assert.equal(diagnostics.attempted, true);
  assert.equal(diagnostics.resolved, false);
  assert.equal(diagnostics.reason, 'no-safe-candidate');
  assert.deepEqual(diagnostics.displacement, [0, 0]);
});

test('dynamic door の再代入は同 tick の静止 depenetration に反映される', () => {
  const door = { min: [-0.1, -1, 0], max: [0.1, 1, 3], tag: 'setup-door' };
  const collider = new Collider([]);

  assert.deepEqual(collider.moveCylinder(0, 0, 0.4, 0, 1.7, 0, 0).position, [0, 0]);
  collider.dynamic = [door];
  assert.deepEqual(collider.moveCylinder(0, 0, 0.4, 0, 1.7, 0, 0).position, [-0.5, 0]);
  collider.dynamic = [];
  assert.deepEqual(collider.moveCylinder(0, 0, 0.4, 0, 1.7, 0, 0).position, [0, 0]);
});

test('移動入力で overlap から脱出できる既存契約は depenetration で変えない', () => {
  const collider = new Collider([{ min: [1, -1, 0], max: [2, 1, 3] }]);

  const escape = collider.moveCylinder(0.8, 0, 0.4, 0, 1.7, -0.3, 0);
  const inward = collider.moveCylinder(0.8, 0, 0.4, 0, 1.7, 0.2, 0);

  assert.deepEqual(escape.position, [0.5, 0]);
  assert.deepEqual(inward.position, [0.8, 0]);
});

test('初期 overlap の微小な外向き成分で巨大な接線移動を solid 内から始めない', () => {
  const wall = { min: [0, -10, 0], max: [0.2, 10, 3], tag: 'long-wall' };
  const collider = new Collider([wall]);

  const motion = collider.moveCylinder(-0.2, 0, 0.4, 0, 1.7, -0.05, 100);

  assert.deepEqual(motion.position, [-0.4, 100]);
  assert.deepEqual(motion.displacement, [-0.2, 100]);
  assert.ok(motion.position.every(Number.isFinite));
});

test('refreshStaticGeometry preserves the new source-order identity after reverse', () => {
  const first = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const second = { min: [2, -1, 0], max: [2.2, 1, 3] };
  const fillers = Array.from({ length: 40 }, (_, index) => ({
    min: [100 + index * 3, 100, 0],
    max: [101 + index * 3, 101, 3],
    tag: 'filler-' + index,
  }));
  const solids = [first, second, ...fillers];
  const fast = new Collider(solids);
  const linear = new Collider(solids, { broadphase: false });

  assert.equal(fast.trace(0, 0, 1, 1, 0, 0, 10).solid, first);
  solids.reverse();
  fast.refreshStaticGeometry();

  assert.equal(fast.trace(0, 0, 1, 1, 0, 0, 10).solid, second);
  assert.equal(fast.sweepVerticalCylinder(2.1, 0, 0.2, 4, 1, -10).solid, second);
  assert.equal(linear.trace(0, 0, 1, 1, 0, 0, 10).solid, second);
  assert.equal(linear.sweepVerticalCylinder(2.1, 0, 0.2, 4, 1, -10).solid, second);
});

test('grid refresh keeps source-order ties across distinct spatial cells', () => {
  const right = { min: [4, 0, 0], max: [5, 1, 3], tag: 'right' };
  const left = { min: [0, 0, 0], max: [1, 1, 3], tag: 'left' };
  const fillers = Array.from({ length: 40 }, (_, index) => ({
    min: [100 + index * 3, 100, 0],
    max: [101 + index * 3, 101, 3],
  }));
  const solids = [right, left, ...fillers];
  const fast = new Collider(solids);
  const linear = new Collider(solids, { broadphase: false });
  const query = [2.5, 0.5, 2, 4, 1, -10];

  assert.equal(fast.sweepVerticalCylinder(...query).solid, right);
  assert.equal(linear.sweepVerticalCylinder(...query).solid, right);
  solids.reverse();
  fast.refreshStaticGeometry();

  assert.equal(fast.sweepVerticalCylinder(...query).solid, left);
  assert.equal(linear.sweepVerticalCylinder(...query).solid, left);
});
