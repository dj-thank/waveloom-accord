// Deterministic navigation helpers for server-authoritative bots. The authored
// routes remain the primary plan; this module only finds short ground-level
// recovery paths and prevents blind movement over large drops.

const DEFAULT_GRID_M = 1;
const DEFAULT_MAX_DROP_M = 0.8;
const DEFAULT_SEGMENT_SAMPLE_M = 0.2;
const EPSILON = 1e-6;
const WALKABLE_SURFACE_TAGS = new Set(['ground', 'slab', 'rim', 'stair', 'tower']);

// Route coordinates cross a JSON/network boundary. Treat every non-number,
// non-finite input as invalid rather than allowing arithmetic to coerce an
// object/function/Symbol or touch world state before failing.
function isFinitePoint(point) {
  return Array.isArray(point)
    && point.length >= 3
    && point.slice(0, 3).every(value => typeof value === 'number' && Number.isFinite(value));
}

function movementSettings(world) {
  return world.mv || world.combat?.movement || {};
}

function floorAt(world, x, y, referenceZ, radiusScale = 1) {
  const movement = movementSettings(world);
  const radius = Math.max(0.08, (movement.capsuleRadiusM || 0.4) * radiusScale);
  const stepUp = Number.isFinite(movement.stepUpM) ? movement.stepUpM : 0.55;
  return world.collider.groundHeight(x, y, referenceZ, radius, stepUp);
}

function canStandAt(world, x, y, z) {
  const movement = movementSettings(world);
  const radius = movement.capsuleRadiusM || 0.4;
  const height = movement.standHeightM || 1.7;
  return !world.collider.overlapsCylinder(x, y, z, radius, height);
}

function circleOverlapsBox(x, y, radius, box) {
  const nearestX = Math.max(box.min[0], Math.min(x, box.max[0]));
  const nearestY = Math.max(box.min[1], Math.min(y, box.max[1]));
  return (x - nearestX) ** 2 + (y - nearestY) ** 2 < radius ** 2;
}

// Recovery navigation historically scanned every authored solid for each floor
// sample. Reuse Collider's static-only broadphase when it is demonstrably
// backed by the same authored array; otherwise retain the exact legacy scan.
// This deliberately excludes dynamic match objects because the old navigation
// support rule only considered world.map.solids.
function navigationSolidsNearCircle(world, x, y, radius) {
  const solids = world.map?.solids || [];
  const collider = world.collider;
  if (collider?.solids !== solids || typeof collider.staticSolidsInAabb !== 'function') {
    return solids;
  }
  return collider.staticSolidsInAabb(x - radius, y - radius, x + radius, y + radius);
}

export function navigationFloorHeight(world, x, y, referenceZ) {
  if (![x, y, referenceZ].every(value => typeof value === 'number' && Number.isFinite(value))) return -Infinity;
  const movement = movementSettings(world);
  // Navigation support must use the same footprint as movement. A smaller
  // point-like probe sees the centre of a narrow stair tread while the actual
  // capsule already overlaps the next riser, producing a route the player can
  // never occupy. With the full radius the floor snaps to each reachable tread
  // at the same point as shared/sim/movement.js.
  const radius = movement.capsuleRadiusM || 0.4;
  const stepUp = Number.isFinite(movement.stepUpM) ? movement.stepUpM : 0.55;
  let best = -Infinity;
  for (const solid of navigationSolidsNearCircle(world, x, y, radius)) {
    if (!WALKABLE_SURFACE_TAGS.has(solid.tag)) continue;
    const top = solid.max[2];
    if (top > referenceZ + stepUp + EPSILON || top <= best) continue;
    if (circleOverlapsBox(x, y, radius, solid)) best = top;
  }
  return best;
}

export function isOnAuthoredStair(world, player) {
  const movement = movementSettings(world);
  const radius = movement.capsuleRadiusM || 0.4;
  const [x, y, z] = player.move.pos;
  return navigationSolidsNearCircle(world, x, y, radius).some(solid =>
    solid.tag === 'stair'
    && Math.abs(solid.max[2] - z) <= 0.2
    && circleOverlapsBox(x, y, radius, solid));
}

function navigationFloorHeights(world, x, y) {
  const movement = movementSettings(world);
  const radius = movement.capsuleRadiusM || 0.4;
  const heights = [];
  for (const solid of navigationSolidsNearCircle(world, x, y, radius)) {
    if (!WALKABLE_SURFACE_TAGS.has(solid.tag) || !circleOverlapsBox(x, y, radius, solid)) continue;
    const z = solid.max[2];
    if (!Number.isFinite(z) || !canStandAt(world, x, y, z)) continue;
    if (!heights.some(existing => Math.abs(existing - z) <= EPSILON)) heights.push(z);
  }
  heights.sort((a, b) => a - b);
  return heights;
}

export function intendedMovementVector(input) {
  let localRight = 0;
  let localForward = 0;
  if (input.f) localForward += 1;
  if (input.b) localForward -= 1;
  if (input.l) localRight -= 1;
  if (input.r) localRight += 1;
  const localLength = Math.hypot(localRight, localForward);
  if (localLength <= EPSILON) return [0, 0];
  localRight /= localLength;
  localForward /= localLength;
  const cos = Math.cos(input.yaw || 0);
  const sin = Math.sin(input.yaw || 0);
  return [
    localForward * cos + localRight * sin,
    localForward * sin - localRight * cos,
  ];
}

export function hasSafeGroundAhead(world, player, input, distanceM = 1.05) {
  if (!player.move.grounded) return true;
  const direction = intendedMovementVector(input);
  if (Math.hypot(direction[0], direction[1]) <= EPSILON) return true;
  const [x, y, z] = player.move.pos;
  const currentFloor = floorAt(world, x, y, z);
  // Unit tests and forced movement can temporarily mark a position grounded
  // before collision validates it. Ledge guarding only applies to real support.
  if (!Number.isFinite(currentFloor) || Math.abs(currentFloor - z) > 0.15) return true;
  const movement = movementSettings(world);
  const maxDrop = Number.isFinite(movement.botSafeDropM)
    ? movement.botSafeDropM
    : DEFAULT_MAX_DROP_M;
  // Compare adjacent floor samples instead of every sample with the starting
  // elevation. A staircase can descend several safe 0.5m treads over 1m,
  // while a ledge presents the full drop in a single adjacent sample.
  const sampleCount = Math.max(2, Math.ceil(distanceM / 0.25));
  let previousFloor = currentFloor;
  for (let sample = 1; sample <= sampleCount; sample++) {
    const distance = distanceM * sample / sampleCount;
    const probeX = x + direction[0] * distance;
    const probeY = y + direction[1] * distance;
    const floor = floorAt(world, probeX, probeY, previousFloor);
    if (!Number.isFinite(floor) || floor < previousFloor - maxDrop - EPSILON) return false;
    previousFloor = floor;
  }
  return true;
}

export function hasSafeGroundPath(world, player, yaw, distanceM) {
  if (!player.move.grounded || !Number.isFinite(distanceM) || distanceM <= 0) return true;
  const [x, y, z] = player.move.pos;
  const currentFloor = floorAt(world, x, y, z);
  // Preserve forced fixtures and unusual ability states; the guard is only
  // authoritative after collision has validated real ground contact.
  if (!Number.isFinite(currentFloor) || Math.abs(currentFloor - z) > 0.15) return true;
  const movement = movementSettings(world);
  const maxDrop = Number.isFinite(movement.botSafeDropM)
    ? movement.botSafeDropM
    : DEFAULT_MAX_DROP_M;
  const stepUp = Number.isFinite(movement.stepUpM) ? movement.stepUpM : 0.55;
  const sampleCount = Math.max(2, Math.ceil(distanceM / 0.25));
  const dx = Math.cos(yaw);
  const dy = Math.sin(yaw);
  let previousFloor = currentFloor;
  for (let sample = 1; sample <= sampleCount; sample++) {
    const distance = distanceM * sample / sampleCount;
    const floor = floorAt(world, x + dx * distance, y + dy * distance, previousFloor);
    if (!Number.isFinite(floor)
      || floor < previousFloor - maxDrop - EPSILON
      || floor > previousFloor + stepUp + EPSILON) return false;
    previousFloor = floor;
  }
  return true;
}

// A* cell centres are only useful when the full player capsule can travel
// between them. Sample floor support and sweep every short sub-segment so a
// route cannot cut across a thin wall, a missing tread, or an AABB corner.
export function canTraverseGroundSegment(world, from, to, {
  maxDropM = null,
  sampleM = DEFAULT_SEGMENT_SAMPLE_M,
} = {}) {
  if (!isFinitePoint(from) || !isFinitePoint(to)) return false;
  const movement = movementSettings(world);
  const radius = movement.capsuleRadiusM || 0.4;
  const height = movement.standHeightM || 1.7;
  const stepUp = Number.isFinite(movement.stepUpM) ? movement.stepUpM : 0.55;
  const safeDrop = Number.isFinite(maxDropM)
    ? maxDropM
    : Number.isFinite(movement.botSafeDropM) ? movement.botSafeDropM : DEFAULT_MAX_DROP_M;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const distance = Math.hypot(dx, dy);
  const samples = Math.max(1, Math.ceil(distance / Math.max(0.05, sampleM)));
  let previousX = from[0];
  let previousY = from[1];
  let previousFloor = navigationFloorHeight(world, previousX, previousY, from[2]);
  if (!Number.isFinite(previousFloor) || Math.abs(previousFloor - from[2]) > 0.2) return false;

  for (let sample = 1; sample <= samples; sample++) {
    const ratio = sample / samples;
    const x = from[0] + dx * ratio;
    const y = from[1] + dy * ratio;
    const floor = navigationFloorHeight(world, x, y, previousFloor);
    if (!Number.isFinite(floor)
      || floor > previousFloor + stepUp + EPSILON
      || floor < previousFloor - safeDrop - EPSILON
      || !canStandAt(world, x, y, floor)) return false;

    const sweep = world.collider.sweepCylinder(
      previousX,
      previousY,
      radius,
      previousFloor + stepUp,
      previousFloor + height,
      x - previousX,
      y - previousY,
    );
    if (sweep.hit && sweep.fraction < 1 - EPSILON) return false;
    previousX = x;
    previousY = y;
    previousFloor = floor;
  }

  return Math.abs(previousFloor - to[2]) <= 0.2;
}

// Short-lived combat investigation should not pay for a full fine-grid A*.
// Try a bounded visibility detour on either side of the blocked sight line.
// Every candidate segment still receives the same capsule, floor and ledge
// checks as recovery navigation, so this cannot become a wall-cut shortcut.
export function findGroundDetourPath(world, start, target, {
  maxDropM = null,
} = {}) {
  if (!isFinitePoint(start) || !isFinitePoint(target)) return [];
  if (canTraverseGroundSegment(world, start, target, { maxDropM })) return [[...target]];
  const dx = target[0] - start[0];
  const dy = target[1] - start[1];
  const distance = Math.hypot(dx, dy);
  if (distance <= EPSILON) return [];
  const perpendicular = [-dy / distance, dx / distance];
  const makePoint = (ratio, side, offset) => {
    const x = start[0] + dx * ratio + perpendicular[0] * side * offset;
    const y = start[1] + dy * ratio + perpendicular[1] * side * offset;
    const referenceZ = start[2] + (target[2] - start[2]) * ratio;
    const z = navigationFloorHeight(world, x, y, referenceZ);
    return Number.isFinite(z) ? [x, y, z] : null;
  };
  const pathIsSafe = path => {
    let previous = start;
    for (const point of path) {
      if (!point || !canTraverseGroundSegment(world, previous, point, { maxDropM })) return false;
      previous = point;
    }
    return true;
  };
  const pathLength = path => {
    let previous = start;
    let total = 0;
    for (const point of path) {
      total += Math.hypot(point[0] - previous[0], point[1] - previous[1]);
      previous = point;
    }
    return total;
  };
  const pathBasis = localBasis(start, target);
  const comparePaths = (a, b) => {
    const lengthDifference = pathLength(a) - pathLength(b);
    if (lengthDifference !== 0) return lengthDifference;
    for (let index = 0; index < Math.min(a.length, b.length); index++) {
      const waypointDifference = compareInLocalBasis(a[index], b[index], start, pathBasis);
      if (waypointDifference !== 0) return waypointDifference;
    }
    return a.length - b.length;
  };

  for (const offset of [1.5, 2, 2.5, 3, 4, 6, 8]) {
    const safe = [];
    for (const side of [-1, 1]) {
      const midpoint = makePoint(0.5, side, offset);
      const single = midpoint ? [midpoint, [...target]] : [];
      if (single.length && pathIsSafe(single)) safe.push(single);
      const first = makePoint(0.33, side, offset);
      const second = makePoint(0.67, side, offset);
      const double = first && second ? [first, second, [...target]] : [];
      if (double.length && pathIsSafe(double)) safe.push(double);
    }
    if (safe.length > 0) {
      safe.sort(comparePaths);
      return safe[0];
    }
  }
  return [];
}

function numberOrNaN(value) {
  // Never invoke valueOf()/toString() on an arbitrary object while ranking a
  // recovery candidate. Coordinates are JSON primitives; non-primitives are
  // handled as the inert unsupported sentinel by the raw tie-break below.
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint' || typeof value === 'string' || typeof value === 'boolean') {
    return Number(value);
  }
  return NaN;
}

function finiteCoordinate(value) {
  const number = numberOrNaN(value);
  return Number.isFinite(number) ? number : 0;
}

function compareTotalNumber(left, right) {
  const first = numberOrNaN(left);
  const second = numberOrNaN(right);
  const rank = value => {
    if (value === -Infinity) return 0;
    if (Number.isFinite(value)) return 1;
    if (value === Infinity) return 2;
    return 3; // NaN and values that do not coerce to a number sort last.
  };
  const firstRank = rank(first);
  const secondRank = rank(second);
  if (firstRank !== secondRank) return firstRank < secondRank ? -1 : 1;
  if (firstRank !== 1) return 0;
  return first < second ? -1 : first > second ? 1 : 0;
}

function rawCoordinateKind(value) {
  if (value === undefined) return 0;
  if (value === null) return 1;
  if (typeof value === 'number') return 2;
  if (typeof value === 'bigint') return 3;
  if (typeof value === 'string') return 4;
  if (typeof value === 'boolean') return 5;
  // Map coordinates cross a JSON boundary. Symbols, objects, and functions
  // are therefore unsupported and intentionally collapse to one inert
  // sentinel instead of acquiring identity-based, history-dependent ordering.
  return 6;
}

function compareRawCoordinate(left, right) {
  if (Object.is(left, right)) return 0;
  const leftKind = rawCoordinateKind(left);
  const rightKind = rawCoordinateKind(right);
  if (leftKind !== rightKind) return leftKind < rightKind ? -1 : 1;
  if (typeof left === 'string') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'bigint') return left < right ? -1 : left > right ? 1 : 0;
  if (typeof left === 'boolean') return left === false ? -1 : 1;
  return 0;
}

function localBasis(from, toward) {
  const fromX = finiteCoordinate(from?.[0]);
  const fromY = finiteCoordinate(from?.[1]);
  const towardX = finiteCoordinate(toward?.[0]);
  const towardY = finiteCoordinate(toward?.[1]);
  let dx = towardX - fromX;
  let dy = towardY - fromY;
  let length = Math.hypot(dx, dy);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(length)) {
    const scale = Math.max(1, Math.abs(fromX), Math.abs(fromY), Math.abs(towardX), Math.abs(towardY));
    dx = towardX / scale - fromX / scale;
    dy = towardY / scale - fromY / scale;
    length = Math.hypot(dx, dy);
  }
  if (length <= EPSILON) return { forward: [1, 0], side: [0, 1] };
  const forward = [dx / length, dy / length];
  return { forward, side: [-forward[1], forward[0]] };
}

function compareInLocalBasis(left, right, origin, basis) {
  if (left == null || right == null) {
    if (left === right) return 0;
    const missingRank = point => point === null ? 1 : point === undefined ? 2 : 0;
    return compareTotalNumber(missingRank(left), missingRank(right));
  }
  const project = point => {
    const dx = finiteCoordinate(point?.[0]) - finiteCoordinate(origin?.[0]);
    const dy = finiteCoordinate(point?.[1]) - finiteCoordinate(origin?.[1]);
    return {
      forward: dx * basis.forward[0] + dy * basis.forward[1],
      side: dx * basis.side[0] + dy * basis.side[1],
      z: finiteCoordinate(point?.[2]),
    };
  };
  const a = project(left);
  const b = project(right);
  let comparison = compareTotalNumber(b.forward, a.forward);
  if (comparison !== 0) return comparison;
  comparison = compareTotalNumber(Math.abs(a.side), Math.abs(b.side));
  if (comparison !== 0) return comparison;
  comparison = compareTotalNumber(a.side, b.side);
  if (comparison !== 0) return comparison;
  comparison = compareTotalNumber(a.z, b.z);
  if (comparison !== 0) return comparison;
  for (let axis = 0; axis < 3; axis++) {
    comparison = compareTotalNumber(left?.[axis], right?.[axis]);
    if (comparison !== 0) return comparison;
    comparison = compareRawCoordinate(left?.[axis], right?.[axis]);
    if (comparison !== 0) return comparison;
  }
  return 0;
}

function compareNavigationPointsByProximityWithBasis(left, right, origin, basis) {
  const leftDistance = Math.hypot(
    finiteCoordinate(left?.[0]) - finiteCoordinate(origin?.[0]),
    finiteCoordinate(left?.[1]) - finiteCoordinate(origin?.[1]),
  );
  const rightDistance = Math.hypot(
    finiteCoordinate(right?.[0]) - finiteCoordinate(origin?.[0]),
    finiteCoordinate(right?.[1]) - finiteCoordinate(origin?.[1]),
  );
  const distanceComparison = compareTotalNumber(leftDistance, rightDistance);
  if (distanceComparison !== 0) return distanceComparison;
  return compareInLocalBasis(left, right, origin, basis);
}

function compareNavigationSearchCandidatesWithBasis(
  leftScore, left, rightScore, right, origin, basis,
) {
  const scoreComparison = compareTotalNumber(leftScore, rightScore);
  if (scoreComparison !== 0) return scoreComparison;
  return compareInLocalBasis(left, right, origin, basis);
}

// A strict total order keeps recovery-cell selection deterministic. Distance
// remains the first criterion; local direction is only a true-distance tie
// break, rather than an epsilon relation that can form comparison cycles.
export function compareNavigationPointsByProximity(left, right, origin, tieToward) {
  return compareNavigationPointsByProximityWithBasis(
    left,
    right,
    origin,
    localBasis(origin, tieToward),
  );
}

export function compareNavigationSearchCandidates(
  leftScore, left, rightScore, right, origin, tieToward,
) {
  return compareNavigationSearchCandidatesWithBasis(
    leftScore,
    left,
    rightScore,
    right,
    origin,
    localBasis(origin, tieToward),
  );
}

function nearestWalkableCell(
  cells,
  x,
  y,
  preferredZ,
  predicate = () => true,
  tieToward = [x + 1, y],
) {
  if (!Number.isFinite(preferredZ)) return null;
  const origin = [x, y, preferredZ];
  const basis = localBasis(origin, tieToward);
  const candidates = [];
  for (const cell of cells) {
    if (!cell.walkable || Math.abs(cell.z - preferredZ) > 0.2) continue;
    candidates.push({ cell });
  }
  // Route-cell predicates perform capsule sweeps. Evaluate candidates in the
  // deterministic distance/local-basis order, then stop at the first
  // reachable one. This avoids scans of every farther candidate without
  // letting an epsilon-based comparator make sort behaviour engine-dependent.
  candidates.sort((left, right) =>
    compareNavigationPointsByProximityWithBasis(
      [left.cell.x, left.cell.y, left.cell.z],
      [right.cell.x, right.cell.y, right.cell.z],
      origin,
      basis,
    ));
  for (const { cell } of candidates) {
    if (predicate(cell)) return cell;
  }
  return null;
}

function reconstructPath(cameFrom, byKey, goalKey) {
  const path = [];
  let key = goalKey;
  while (key) {
    const cell = byKey.get(key);
    if (!cell) break;
    path.push([cell.x, cell.y, cell.z]);
    key = cameFrom.get(key) || null;
  }
  return path.reverse();
}

export function findGroundRecoveryPath(world, start, target, {
  gridM = DEFAULT_GRID_M,
  maxDropM = DEFAULT_MAX_DROP_M,
  maxVisited = 12000,
  searchMarginM = 8,
  fallbackMarginM = 12,
} = {}) {
  if (!isFinitePoint(start) || !isFinitePoint(target)) return [];
  const bounds = world.map.boundsM;
  if (!bounds?.x || !bounds?.y || gridM <= 0) return [];
  const movement = movementSettings(world);
  const stepUp = Number.isFinite(movement.stepUpM) ? movement.stepUpM : 0.55;
  const supportedStartZ = navigationFloorHeight(world, start[0], start[1], start[2]);
  const supportedTargetZ = navigationFloorHeight(world, target[0], target[1], target[2]);
  if (!Number.isFinite(supportedStartZ) || !Number.isFinite(supportedTargetZ)) return [];
  if (Math.abs(supportedTargetZ - target[2]) > 0.2) return [];
  const normalizedStart = [start[0], start[1], supportedStartZ];
  const normalizedTarget = [target[0], target[1], supportedTargetZ];
  // The common recovery case is a same-level route rejoin with a clear,
  // capsule-safe segment.  Prove that segment directly before constructing a
  // fine-grid A* search; rebuilding hundreds of cells only to rediscover a
  // straight line makes a transient Bot stall consume an entire simulation
  // frame on presentation-heavy authored maps.  Preserve the regular path
  // shape (current support plus target) so callers retain their existing
  // waypoint-consumption behaviour.
  if (canTraverseGroundSegment(world, normalizedStart, normalizedTarget, { maxDropM })) {
    return [[...normalizedStart], [...normalizedTarget]];
  }
  // Flat rejoin searches are the hot path for ten server bots and do not need
  // half-metre cells. Only cumulative elevation changes require the finer
  // spacing needed to represent each authored 0.5m stair tread.
  if (Math.abs(supportedStartZ - supportedTargetZ) > stepUp + EPSILON) {
    gridM = Math.min(gridM, 0.5);
  }
  const marginM = Math.max(gridM, searchMarginM);
  const minX = Math.max(bounds.x[0], Math.floor((Math.min(start[0], target[0]) - marginM) / gridM) * gridM);
  const maxX = Math.min(bounds.x[1], Math.ceil((Math.max(start[0], target[0]) + marginM) / gridM) * gridM);
  const minY = Math.max(bounds.y[0], Math.floor((Math.min(start[1], target[1]) - marginM) / gridM) * gridM);
  const maxY = Math.min(bounds.y[1], Math.ceil((Math.max(start[1], target[1]) + marginM) / gridM) * gridM);
  const width = Math.floor((maxX - minX) / gridM) + 1;
  const height = Math.floor((maxY - minY) / gridM) + 1;
  const cells = [];
  const byKey = new Map();
  const byCoordinate = new Map();
  for (let iy = 0; iy < height; iy++) {
    const y = minY + iy * gridM;
    for (let ix = 0; ix < width; ix++) {
      const x = minX + ix * gridM;
      const coordinateKey = `${ix},${iy}`;
      const coordinateCells = [];
      for (const z of navigationFloorHeights(world, x, y)) {
        const key = `${coordinateKey},${z.toFixed(6)}`;
        const cell = { key, ix, iy, x, y, z, walkable: true };
        cells.push(cell);
        coordinateCells.push(cell);
        byKey.set(key, cell);
      }
      byCoordinate.set(coordinateKey, coordinateCells);
    }
  }
  const startCell = nearestWalkableCell(
    cells,
    normalizedStart[0],
    normalizedStart[1],
    normalizedStart[2],
    cell => canTraverseGroundSegment(world, normalizedStart, [cell.x, cell.y, cell.z], { maxDropM }),
    normalizedTarget,
  );
  const goalCell = nearestWalkableCell(
    cells,
    normalizedTarget[0],
    normalizedTarget[1],
    normalizedTarget[2],
    cell => canTraverseGroundSegment(world, [cell.x, cell.y, cell.z], normalizedTarget, { maxDropM }),
    normalizedStart,
  );
  if (!startCell || !goalCell) return [];

  const open = new Set([startCell.key]);
  const cameFrom = new Map();
  const gScore = new Map([[startCell.key, 0]]);
  const fScore = new Map([[
    startCell.key,
    Math.hypot(startCell.x - goalCell.x, startCell.y - goalCell.y)
      + Math.abs(startCell.z - goalCell.z) * 0.25,
  ]]);
  const searchBasis = localBasis(normalizedStart, normalizedTarget);
  const directions = [
    [1, 0], [-1, 0], [0, 1], [0, -1],
  ].sort((left, right) => compareInLocalBasis(
    [left[0], left[1], 0],
    [right[0], right[1], 0],
    [0, 0, 0],
    searchBasis,
  ));
  let visited = 0;
  while (open.size > 0 && visited < maxVisited) {
    visited++;
    let currentKey = null;
    let currentScore = Infinity;
    for (const key of open) {
      const score = fScore.get(key) ?? Infinity;
      const candidate = byKey.get(key);
      const incumbent = currentKey === null ? null : byKey.get(currentKey);
      if (currentKey === null || compareNavigationSearchCandidatesWithBasis(
        score,
        candidate && [candidate.x, candidate.y, candidate.z],
        currentScore,
        incumbent && [incumbent.x, incumbent.y, incumbent.z],
        normalizedStart,
        searchBasis,
      ) < 0) {
        currentKey = key;
        currentScore = score;
      }
    }
    if (currentKey === goalCell.key) {
      const path = reconstructPath(cameFrom, byKey, currentKey);
      if (path.length > 0 && !canTraverseGroundSegment(
        world,
        normalizedStart,
        path[0],
        { maxDropM },
      )) return [];
      if (path.length > 0 && (Math.hypot(
        path.at(-1)[0] - normalizedTarget[0],
        path.at(-1)[1] - normalizedTarget[1],
      ) > EPSILON || Math.abs(path.at(-1)[2] - normalizedTarget[2]) > EPSILON)) {
        if (!canTraverseGroundSegment(world, path.at(-1), normalizedTarget, { maxDropM })) return [];
        path.push([...normalizedTarget]);
      }
      return path;
    }
    open.delete(currentKey);
    const current = byKey.get(currentKey);
    if (!current) continue;
    for (const [dx, dy] of directions) {
      const neighbors = byCoordinate.get(`${current.ix + dx},${current.iy + dy}`) || [];
      for (const neighbor of neighbors) {
        const elevationDelta = neighbor.z - current.z;
        if (elevationDelta > stepUp + EPSILON || elevationDelta < -maxDropM - EPSILON) continue;
        if (!canTraverseGroundSegment(
          world,
          [current.x, current.y, current.z],
          [neighbor.x, neighbor.y, neighbor.z],
          { maxDropM },
        )) continue;
        const stepCost = gridM + Math.abs(elevationDelta) * 0.25;
        const tentative = (gScore.get(currentKey) ?? Infinity) + stepCost;
        if (tentative + EPSILON >= (gScore.get(neighbor.key) ?? Infinity)) continue;
        cameFrom.set(neighbor.key, currentKey);
        gScore.set(neighbor.key, tentative);
        fScore.set(
          neighbor.key,
          tentative + Math.hypot(neighbor.x - goalCell.x, neighbor.y - goalCell.y)
            + Math.abs(neighbor.z - goalCell.z) * 0.25,
        );
        open.add(neighbor.key);
      }
    }
  }
  // Most rejoins fit inside the fast 8m window. A large authored building can
  // separate two nearby points, though, and require a wider route around its
  // outside edge. Retry only after the bounded search fails so the common path
  // retains its current cost.
  if (Number.isFinite(fallbackMarginM) && fallbackMarginM > marginM + EPSILON) {
    return findGroundRecoveryPath(world, start, target, {
      gridM,
      maxDropM,
      maxVisited,
      searchMarginM: fallbackMarginM,
      fallbackMarginM: null,
    });
  }
  return [];
}
