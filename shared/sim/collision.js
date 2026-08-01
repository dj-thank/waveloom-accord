import { SpatialIndex } from './spatial_index.js';

// ソリッドAABB集合に対する衝突・接地・レイの問い合わせ。
// モデル: プレイヤーは半径r・高さhの円柱。top面=床、側面=壁。

// 円(cx,cy,r)とAABBのXY重なり
function circleOverlapsXY(cx, cy, r, b) {
  const nx = Math.max(b.min[0], Math.min(cx, b.max[0]));
  const ny = Math.max(b.min[1], Math.min(cy, b.max[1]));
  const dx = cx - nx, dy = cy - ny;
  return dx * dx + dy * dy < r * r;
}

const SWEEP_EPSILON = 1e-9;
const MAX_SLIDE_ITERATIONS = 4;
const MAX_DEPENETRATION_SOLIDS = 16;
const MAX_DEPENETRATION_CANDIDATES = 1024;
const MAX_DEPENETRATION_RADII = 4;

function clipIntoPlanes(vector, planes) {
  const clipped = [...vector];
  // 新しい面への射影で以前の面へ戻ることがあるため、面数ぶんだけ再評価する。
  for (let pass = 0; pass < planes.length; pass++) {
    let changed = false;
    for (const [nx, ny] of planes) {
      const into = clipped[0] * nx + clipped[1] * ny;
      if (into < -SWEEP_EPSILON) {
        clipped[0] -= into * nx;
        clipped[1] -= into * ny;
        changed = true;
      }
    }
    if (!changed) break;
  }
  return clipped;
}

function initialOverlapNormal(cx, cy, box, dx, dy) {
  const nearestX = Math.max(box.min[0], Math.min(cx, box.max[0]));
  const nearestY = Math.max(box.min[1], Math.min(cy, box.max[1]));
  const outsideX = cx - nearestX, outsideY = cy - nearestY;
  const outsideLength = Math.hypot(outsideX, outsideY);
  if (outsideLength > SWEEP_EPSILON) {
    return [outsideX / outsideLength, outsideY / outsideLength];
  }

  const faces = [
    { distance: cx - box.min[0], normal: [-1, 0] },
    { distance: box.max[0] - cx, normal: [1, 0] },
    { distance: cy - box.min[1], normal: [0, -1] },
    { distance: box.max[1] - cy, normal: [0, 1] },
  ];
  const nearestDistance = Math.min(...faces.map(face => face.distance));
  const candidates = faces.filter(face => face.distance <= nearestDistance + SWEEP_EPSILON);
  candidates.sort((a, b) =>
    (b.normal[0] * dx + b.normal[1] * dy) - (a.normal[0] * dx + a.normal[1] * dy));
  return candidates[0].normal;
}

function sweepTieBreaksBefore(hit, solid, nearest) {
  const candidateKey = [...hit.normal, ...solid.min, ...solid.max];
  const nearestKey = [...nearest.normal, ...nearest.solid.min, ...nearest.solid.max];
  for (let i = 0; i < candidateKey.length; i++) {
    if (candidateKey[i] < nearestKey[i]) return true;
    if (candidateKey[i] > nearestKey[i]) return false;
  }
  return false;
}

// 移動する円とAABBのXY Minkowski和（角が丸い矩形）の最初の接触を返す。
function sweepCircleAabb(cx, cy, r, dx, dy, box) {
  const motionLengthSq = dx * dx + dy * dy;
  if (motionLengthSq < SWEEP_EPSILON * SWEEP_EPSILON) return null;

  let best = null;
  const consider = (fraction, nx, ny) => {
    if (fraction < -SWEEP_EPSILON || fraction > 1 + SWEEP_EPSILON) return;
    const enteringSpeed = dx * nx + dy * ny;
    if (enteringSpeed >= -SWEEP_EPSILON) return;
    const t = Math.max(0, Math.min(1, fraction));
    if (
      best === null
      || t < best.fraction - SWEEP_EPSILON
      || (Math.abs(t - best.fraction) <= SWEEP_EPSILON && enteringSpeed < best.enteringSpeed)
    ) {
      best = { fraction: t, normal: [nx, ny], enteringSpeed };
    }
  };

  // 4辺。辺の端より外側は、下の角円が担当する。
  if (dx > SWEEP_EPSILON) {
    const t = (box.min[0] - r - cx) / dx;
    const y = cy + dy * t;
    if (y >= box.min[1] - SWEEP_EPSILON && y <= box.max[1] + SWEEP_EPSILON) {
      consider(t, -1, 0);
    }
  } else if (dx < -SWEEP_EPSILON) {
    const t = (box.max[0] + r - cx) / dx;
    const y = cy + dy * t;
    if (y >= box.min[1] - SWEEP_EPSILON && y <= box.max[1] + SWEEP_EPSILON) {
      consider(t, 1, 0);
    }
  }
  if (dy > SWEEP_EPSILON) {
    const t = (box.min[1] - r - cy) / dy;
    const x = cx + dx * t;
    if (x >= box.min[0] - SWEEP_EPSILON && x <= box.max[0] + SWEEP_EPSILON) {
      consider(t, 0, -1);
    }
  } else if (dy < -SWEEP_EPSILON) {
    const t = (box.max[1] + r - cy) / dy;
    const x = cx + dx * t;
    if (x >= box.min[0] - SWEEP_EPSILON && x <= box.max[0] + SWEEP_EPSILON) {
      consider(t, 0, 1);
    }
  }

  // 4つの丸角。二次方程式で移動線分と半径rの円の交点を求める。
  const corners = [
    [box.min[0], box.min[1], -1, -1],
    [box.min[0], box.max[1], -1, 1],
    [box.max[0], box.min[1], 1, -1],
    [box.max[0], box.max[1], 1, 1],
  ];
  for (const [qx, qy, sx, sy] of corners) {
    const fx = cx - qx, fy = cy - qy;
    const b = 2 * (fx * dx + fy * dy);
    const c = fx * fx + fy * fy - r * r;
    const discriminant = b * b - 4 * motionLengthSq * c;
    if (discriminant < -SWEEP_EPSILON) continue;
    const root = (-b - Math.sqrt(Math.max(0, discriminant))) / (2 * motionLengthSq);
    if (root < -SWEEP_EPSILON || root > 1 + SWEEP_EPSILON) continue;
    const x = cx + dx * root, y = cy + dy * root;
    if (sx * (x - qx) < -SWEEP_EPSILON || sy * (y - qy) < -SWEEP_EPSILON) continue;
    const nx = (x - qx) / r, ny = (y - qy) / r;
    consider(root, nx, ny);
  }
  return best;
}

function closestPointOnAabb(point, box) {
  return point.map((value, axis) => Math.max(box.min[axis], Math.min(value, box.max[axis])));
}

function pointAabbDistanceSq(point, box) {
  const closest = closestPointOnAabb(point, box);
  let distanceSq = 0;
  for (let axis = 0; axis < 3; axis++) {
    const delta = point[axis] - closest[axis];
    distanceSq += delta * delta;
  }
  return { closest, distanceSq };
}

// Earliest t where |offset + velocity*t| == radius. The coefficients are
// scaled together to keep ordinary huge world deltas out of overflow range.
function movingPointSphereEntry(offset, velocity, radius) {
  const scale = Math.max(1, Math.abs(radius), ...offset.map(Math.abs), ...velocity.map(Math.abs));
  if (!Number.isFinite(scale)) return -1;
  const f = offset.map(value => value / scale);
  const v = velocity.map(value => value / scale);
  const scaledRadius = radius / scale;
  const a = v.reduce((sum, value) => sum + value * value, 0);
  if (!(a > 0) || !Number.isFinite(a)) return -1;
  // Closest-approach form avoids subtracting two ~offset^2 terms in the
  // quadratic discriminant (for example a shot starting at x=1_000_000).
  const closestT = -f.reduce((sum, value, axis) => sum + value * v[axis], 0) / a;
  const closest = f.map((value, axis) => value + v[axis] * closestT);
  const closestSq = closest.reduce((sum, value) => sum + value * value, 0);
  let clearanceSq = scaledRadius * scaledRadius - closestSq;
  const tolerance = Number.EPSILON * Math.max(
    scaledRadius * scaledRadius,
    closestSq,
    Number.MIN_VALUE,
  ) * 64;
  if (clearanceSq < -tolerance || !Number.isFinite(clearanceSq)) return -1;
  clearanceSq = Math.max(0, clearanceSq);
  const halfSpan = Math.sqrt(clearanceSq / a);
  const roots = [closestT - halfSpan, closestT + halfSpan];
  roots.sort((left, right) => left - right);
  return roots.find(value => Number.isFinite(value) && value >= 0) ?? -1;
}

function evaluatePolynomial(coefficients, value) {
  let result = 0;
  for (let index = coefficients.length - 1; index >= 0; index--) {
    result = result * value + coefficients[index];
  }
  return result;
}

function uniqueSorted(values, epsilon = 1e-10) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  const unique = [];
  for (const value of sorted) {
    if (unique.length === 0 || Math.abs(value - unique.at(-1)) > epsilon) unique.push(value);
  }
  return unique;
}

// Isolate every real root of a degree <= 4 polynomial in [0, 1]. Derivative
// roots split the interval into monotonic pieces, so double/tangent roots are
// retained instead of being lost by a sign-change-only search.
function polynomialRootsInUnitInterval(rawCoefficients) {
  const scale = Math.max(...rawCoefficients.map(Math.abs));
  if (!(scale > 0) || !Number.isFinite(scale)) return [];
  const coefficients = rawCoefficients.map(value => value / scale);
  const trim = values => {
    const result = [...values];
    while (result.length > 1 && Math.abs(result.at(-1)) <= Number.EPSILON * 128) result.pop();
    return result;
  };
  const roots = values => {
    const polynomial = trim(values);
    const degree = polynomial.length - 1;
    if (degree <= 0) return [];
    if (degree === 1) {
      const root = -polynomial[0] / polynomial[1];
      return root >= 0 && root <= 1 ? [root] : [];
    }

    const derivative = polynomial.slice(1).map((value, index) => value * (index + 1));
    const critical = uniqueSorted(roots(derivative).filter(value => value > 0 && value < 1));
    const points = [0, ...critical, 1];
    const found = [];
    const valueTolerance = 1e-11 * Math.max(1, ...polynomial.map(Math.abs));
    for (const point of points) {
      if (Math.abs(evaluatePolynomial(polynomial, point)) <= valueTolerance) found.push(point);
    }
    for (let index = 0; index + 1 < points.length; index++) {
      let left = points[index];
      let right = points[index + 1];
      let leftValue = evaluatePolynomial(polynomial, left);
      let rightValue = evaluatePolynomial(polynomial, right);
      if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)
        || leftValue === 0 || rightValue === 0
        || Math.sign(leftValue) === Math.sign(rightValue)) continue;
      for (let iteration = 0; iteration < 80; iteration++) {
        const middle = (left + right) / 2;
        const middleValue = evaluatePolynomial(polynomial, middle);
        if (middleValue === 0) {
          left = middle;
          right = middle;
          break;
        }
        if (Math.sign(middleValue) === Math.sign(leftValue)) {
          left = middle;
          leftValue = middleValue;
        } else {
          right = middle;
          rightValue = middleValue;
        }
      }
      found.push((left + right) / 2);
    }
    return uniqueSorted(found);
  };
  return roots(coefficients);
}

function rayTorusRoots(
  ox, oy, oz, dx, dy, dz, cx, cy, cz, majorRadius, minorRadius, maxDist,
) {
  if (![ox, oy, oz, dx, dy, dz, cx, cy, cz, majorRadius, minorRadius, maxDist]
    .every(Number.isFinite)
    || majorRadius < 0 || minorRadius < 0 || maxDist <= 0) return [];
  const p = [ox - cx, oy - cy, oz - cz];
  const travel = [dx * maxDist, dy * maxDist, dz * maxDist];
  if (!travel.every(Number.isFinite)) return [];
  const spatialScale = Math.max(
    1, majorRadius, minorRadius, ...p.map(Math.abs), ...travel.map(Math.abs),
  );
  const [px, py, pz] = p.map(value => value / spatialScale);
  const [vx, vy, vz] = travel.map(value => value / spatialScale);
  const major = majorRadius / spatialScale;
  const minor = minorRadius / spatialScale;
  const q0 = px * px + py * py + pz * pz + major * major - minor * minor;
  const q1 = 2 * (px * vx + py * vy + pz * vz);
  const q2 = vx * vx + vy * vy + vz * vz;
  const radial0 = px * px + py * py;
  const radial1 = 2 * (px * vx + py * vy);
  const radial2 = vx * vx + vy * vy;
  const coefficients = [
    q0 * q0 - 4 * major * major * radial0,
    2 * q0 * q1 - 4 * major * major * radial1,
    q1 * q1 + 2 * q0 * q2 - 4 * major * major * radial2,
    2 * q1 * q2,
    q2 * q2,
  ];
  return polynomialRootsInUnitInterval(coefficients).map(value => value * maxDist);
}

function finiteCylinderDistanceSq(px, py, pz, cx, cy, zLo, zHi, radius, capless) {
  const radial = Math.hypot(px - cx, py - cy);
  const radialDistance = capless ? Math.abs(radial - radius) : Math.max(0, radial - radius);
  const verticalDistance = pz < zLo ? zLo - pz : pz > zHi ? pz - zHi : 0;
  return radialDistance * radialDistance + verticalDistance * verticalDistance;
}

function boundedSweepTime(value, maxDist) {
  if (!Number.isFinite(value)) return -1;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(value), Math.abs(maxDist)) * 64;
  if (value < -epsilon || value > maxDist + epsilon) return -1;
  return Math.min(maxDist, Math.max(0, value));
}

function radialCylinderSurfaceHit(
  ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, radius, maxDist,
) {
  if (!(radius >= 0)) return -1;
  const hit = boundedSweepTime(
    movingPointSphereEntry([ox - cx, oy - cy], [dx, dy], radius),
    maxDist,
  );
  if (hit < 0) return -1;
  const z = oz + dz * hit;
  const epsilon = Number.EPSILON * Math.max(1, Math.abs(z), Math.abs(zLo), Math.abs(zHi)) * 64;
  return z >= zLo - epsilon && z <= zHi + epsilon ? hit : -1;
}

function sweepSphereFiniteCylinder(
  ox, oy, oz, dx, dy, dz,
  cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist,
  capless,
) {
  if (![ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist]
    .every(Number.isFinite)
    || cylinderRadius < 0 || sphereRadius < 0 || zHi < zLo || maxDist < 0) return -1;
  if (finiteCylinderDistanceSq(
    ox, oy, oz, cx, cy, zLo, zHi, cylinderRadius, capless,
  ) <= sphereRadius * sphereRadius) return 0;

  let best = Infinity;
  const consider = value => {
    const bounded = boundedSweepTime(value, maxDist);
    if (bounded >= 0 && bounded < best) best = bounded;
  };
  consider(radialCylinderSurfaceHit(
    ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi,
    cylinderRadius + sphereRadius, maxDist,
  ));
  if (capless && cylinderRadius > sphereRadius) {
    consider(radialCylinderSurfaceHit(
      ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi,
      cylinderRadius - sphereRadius, maxDist,
    ));
  }

  if (!capless && Math.abs(dz) > 0) {
    for (const capZ of [zLo - sphereRadius, zHi + sphereRadius]) {
      const hit = boundedSweepTime((capZ - oz) / dz, maxDist);
      if (hit < 0) continue;
      const x = ox + dx * hit - cx;
      const y = oy + dy * hit - cy;
      if (x * x + y * y <= cylinderRadius * cylinderRadius) consider(hit);
    }
  }

  const featureEpsilon = Number.EPSILON * Math.max(
    1, Math.abs(cx), Math.abs(cy), Math.abs(zLo), Math.abs(zHi),
    cylinderRadius, sphereRadius,
  ) * 128 + 1e-12;
  for (const [capZ, verticalSign] of [[zLo, -1], [zHi, 1]]) {
    for (const hit of rayTorusRoots(
      ox, oy, oz, dx, dy, dz,
      cx, cy, capZ, cylinderRadius, sphereRadius, maxDist,
    )) {
      const z = oz + dz * hit;
      if (verticalSign * (z - capZ) < -featureEpsilon) continue;
      if (!capless) {
        const radial = Math.hypot(ox + dx * hit - cx, oy + dy * hit - cy);
        if (radial < cylinderRadius - featureEpsilon) continue;
      }
      consider(hit);
    }
  }
  return Number.isFinite(best) ? best : -1;
}

// Exact swept sphere vs AABB: 6 offset faces, 12 rounded edges and 8 rounded
// corners. A simple expanded box is not exact at edges/corners.
function sweepSphereAabb(ox, oy, oz, dx, dy, dz, radius, box, maxDist) {
  const origin = [ox, oy, oz];
  const direction = [dx, dy, dz];
  if (![...origin, ...direction, radius, maxDist].every(Number.isFinite)
    || radius < 0 || maxDist < 0) return -1;
  const initial = pointAabbDistanceSq(origin, box);
  if (initial.distanceSq <= radius * radius) return 0;

  let best = Infinity;
  const consider = value => {
    if (!Number.isFinite(value) || value < 0 || value > maxDist || value >= best) return;
    best = value;
  };
  const coordinateScale = Math.max(
    1, radius, ...origin.map(Math.abs), ...box.min.map(Math.abs), ...box.max.map(Math.abs),
  );
  const featureEpsilon = Number.EPSILON * coordinateScale * 64 + 1e-12;

  // Faces. The other two center coordinates must project onto the face.
  for (let axis = 0; axis < 3; axis++) {
    for (const [coordinate, sign] of [[box.min[axis] - radius, -1], [box.max[axis] + radius, 1]]) {
      const speed = direction[axis];
      if (speed * sign >= 0 || speed === 0) continue;
      const t = (coordinate - origin[axis]) / speed;
      if (!Number.isFinite(t) || t < 0 || t > maxDist) continue;
      let projects = true;
      for (let other = 0; other < 3; other++) {
        if (other === axis) continue;
        const value = origin[other] + direction[other] * t;
        if (value < box.min[other] - featureEpsilon
          || value > box.max[other] + featureEpsilon) {
          projects = false;
          break;
        }
      }
      if (projects) consider(t);
    }
  }

  // Edges: ray vs a radius-r cylinder around each finite box edge.
  for (let edgeAxis = 0; edgeAxis < 3; edgeAxis++) {
    const perpendicular = [0, 1, 2].filter(axis => axis !== edgeAxis);
    for (const firstSign of [-1, 1]) {
      for (const secondSign of [-1, 1]) {
        const signs = [firstSign, secondSign];
        const fixed = perpendicular.map((axis, index) =>
          signs[index] < 0 ? box.min[axis] : box.max[axis]);
        const offset = perpendicular.map((axis, index) => origin[axis] - fixed[index]);
        const velocity = perpendicular.map(axis => direction[axis]);
        const t = movingPointSphereEntry(offset, velocity, radius);
        if (t < 0 || t > maxDist) continue;
        const along = origin[edgeAxis] + direction[edgeAxis] * t;
        if (along < box.min[edgeAxis] - featureEpsilon
          || along > box.max[edgeAxis] + featureEpsilon) continue;
        let inEdgeRegion = true;
        for (let index = 0; index < perpendicular.length; index++) {
          const axis = perpendicular[index];
          const value = origin[axis] + direction[axis] * t;
          if (signs[index] * (value - fixed[index]) < -featureEpsilon) {
            inEdgeRegion = false;
            break;
          }
        }
        if (inEdgeRegion) consider(t);
      }
    }
  }

  // Corners: ray vs the radius-r sphere in the corresponding outside octant.
  for (const xSign of [-1, 1]) {
    for (const ySign of [-1, 1]) {
      for (const zSign of [-1, 1]) {
        const signs = [xSign, ySign, zSign];
        const corner = signs.map((sign, axis) => sign < 0 ? box.min[axis] : box.max[axis]);
        const offset = origin.map((value, axis) => value - corner[axis]);
        const t = movingPointSphereEntry(offset, direction, radius);
        if (t < 0 || t > maxDist) continue;
        let inCornerRegion = true;
        for (let axis = 0; axis < 3; axis++) {
          const value = origin[axis] + direction[axis] * t;
          if (signs[axis] * (value - corner[axis]) < -featureEpsilon) {
            inCornerRegion = false;
            break;
          }
        }
        if (inCornerRegion) consider(t);
      }
    }
  }
  return Number.isFinite(best) ? best : -1;
}

function sphereAabbSurfaceNormal(point, direction, box) {
  const { closest } = pointAabbDistanceSq(point, box);
  const delta = point.map((value, axis) => value - closest[axis]);
  const length = Math.hypot(...delta);
  if (length > 0 && Number.isFinite(length)) return delta.map(value => value / length);
  return aabbSurfaceNormal(point, direction, box);
}

export class Collider {
  constructor(solids, options = {}) {
    this.solids = solids;      // 常時有効
    this.dynamic = [];         // 状態依存（準備扉など）。server/matchが差し替える
    this._staticIndex = new SpatialIndex({ enabled: options.broadphase !== false });
    this._lastBroadphaseQuery = {
      kind: 'none', mode: 'linear', totalSolids: solids.length, candidateSolids: solids.length,
    };
    this._lastDepenetration = {
      attempted: false, resolved: false, reason: 'not-needed', displacement: [0, 0],
    };
  }

  allSolids() {
    return this.dynamic.length ? this.solids.concat(this.dynamic) : this.solids;
  }

  // Navigation needs a static-only local view. Keep collision diagnostics tied
  // to the collision query paths below rather than recording this public read.
  staticSolidsInAabb(minX, minY, maxX, maxY) {
    this._staticIndex.update(this.solids);
    const finiteQuery = [minX, minY, maxX, maxY].every(Number.isFinite);
    if (finiteQuery) {
      if (minX > maxX) [minX, maxX] = [maxX, minX];
      if (minY > maxY) [minY, maxY] = [maxY, minY];
    }
    const candidates = this._staticIndex.queryAabb(minX, minY, maxX, maxY);
    if (!finiteQuery) return candidates;

    return candidates.filter(solid => {
      const bounds = [solid?.min?.[0], solid?.min?.[1], solid?.max?.[0], solid?.max?.[1]];
      // SpatialIndex sends malformed source bounds through its overflow path.
      // Leave those candidates fail-open so this broadphase read preserves the
      // legacy narrow-phase behaviour instead of silently dropping geometry.
      if (!bounds.every(Number.isFinite) ||
        solid.min[0] > solid.max[0] || solid.min[1] > solid.max[1]) return true;
      return solid.max[0] >= minX
        && solid.min[0] <= maxX
        && solid.max[1] >= minY
        && solid.min[1] <= maxY;
    });
  }

 // Static AABBs are immutable during a match. Authoring or tooling that edits
 // an existing `solids` array in place must call this once after the batch so
  // its grid is rebuilt once without adding per-query full scans.
  refreshStaticGeometry() {
    this._staticIndex.invalidate();
    this._staticIndex.update(this.solids);
  }

  _recordCandidates(kind, staticCandidates) {
    const candidates = this.dynamic.length
      ? staticCandidates.concat(this.dynamic)
      : staticCandidates;
    const indexMode = this._staticIndex.mode;
    const mode = indexMode === 'grid' && staticCandidates === this.solids
      ? 'linear-fallback'
      : indexMode;
    this._lastBroadphaseQuery = {
      kind,
      mode,
      totalSolids: this.solids.length + this.dynamic.length,
      candidateSolids: candidates.length,
    };
    return candidates;
  }

  _queryAabbCandidates(kind, minX, minY, maxX, maxY) {
    this._staticIndex.update(this.solids);
    return this._recordCandidates(
      kind,
      this._staticIndex.queryAabb(minX, minY, maxX, maxY),
    );
  }

  _querySegmentCandidates(kind, ox, oy, dx, dy, maxDist, padding = 0) {
    this._staticIndex.update(this.solids);
    return this._recordCandidates(
      kind,
      this._staticIndex.querySegment(ox, oy, dx, dy, maxDist, padding),
    );
  }

  diagnostics() {
    const index = this._staticIndex.diagnostics();
    const lastQuery = Object.freeze({ ...this._lastBroadphaseQuery });
    const broadphase = Object.freeze({
      enabled: this._staticIndex.enabled,
      index,
      lastQuery,
    });
    const depenetration = Object.freeze({
      ...this._lastDepenetration,
      displacement: Object.freeze([...this._lastDepenetration.displacement]),
    });
    return Object.freeze({ broadphase, depenetration });
  }

  overlapsCylinder(cx, cy, zLo, r, height) {
    const zHi = zLo + height;
    return this._queryAabbCandidates(
      'overlapsCylinder', cx - r, cy - r, cx + r, cy + r,
    ).some(b =>
      b.max[2] > zLo && b.min[2] < zHi && circleOverlapsXY(cx, cy, r, b));
  }

  // 円柱をXY平面で連続 sweep する。fraction=1 は非衝突、position は安全な到達点。
  // ダッシュ・押し出し・強制移動も通常歩行と同じ経路安全性を再利用できる公開境界。
  sweepCylinder(cx, cy, r, zLo, zHi, dx, dy) {
    let nearest = null;
    const endX = cx + dx;
    const endY = cy + dy;
    const candidates = this._queryAabbCandidates(
      'sweepCylinder',
      Math.min(cx, endX) - r,
      Math.min(cy, endY) - r,
      Math.max(cx, endX) + r,
      Math.max(cy, endY) + r,
    );
    for (const box of candidates) {
      if (box.max[2] <= zLo || box.min[2] >= zHi) continue;
      let hit;
      if (circleOverlapsXY(cx, cy, r, box)) {
        const normal = initialOverlapNormal(cx, cy, box, dx, dy);
        const enteringSpeed = dx * normal[0] + dy * normal[1];
        // 接触面から離れる（または接線方向の）移動だけは、脱出のため許可する。
        if (enteringSpeed >= -SWEEP_EPSILON) continue;
        hit = { fraction: 0, normal, enteringSpeed };
      } else {
        hit = sweepCircleAabb(cx, cy, r, dx, dy, box);
      }
      if (hit && (
        nearest === null
        || hit.fraction < nearest.fraction - SWEEP_EPSILON
        || (
          Math.abs(hit.fraction - nearest.fraction) <= SWEEP_EPSILON
          && (
            hit.enteringSpeed < nearest.enteringSpeed - SWEEP_EPSILON
            || (
              Math.abs(hit.enteringSpeed - nearest.enteringSpeed) <= SWEEP_EPSILON
              && sweepTieBreaksBefore(hit, box, nearest)
            )
          )
        )
      )) {
        nearest = { ...hit, solid: box };
      }
    }
    if (nearest === null) {
      return {
        hit: false,
        fraction: 1,
        position: [cx + dx, cy + dy],
        normal: [0, 0],
        solid: null,
      };
    }
    return {
      hit: true,
      fraction: nearest.fraction,
      position: [cx + dx * nearest.fraction, cy + dy * nearest.fraction],
      normal: nearest.normal,
      solid: nearest.solid,
    };
  }

  _findDepenetration(cx, cy, r, zLo, zHi, preferredDelta = null) {
    const noOverlap = {
      attempted: false,
      resolved: false,
      reason: 'not-needed',
      displacement: [0, 0],
      position: [cx, cy],
      overlaps: [],
    };
    if (![cx, cy, r, zLo, zHi].every(Number.isFinite) || r <= 0 || zHi <= zLo) {
      return { ...noOverlap, attempted: true, reason: 'invalid-input' };
    }

    const local = this._queryAabbCandidates(
      'depenetration', cx - r, cy - r, cx + r, cy + r,
    );
    const overlaps = local.filter(box =>
      box.max[2] > zLo && box.min[2] < zHi && circleOverlapsXY(cx, cy, r, box));
    if (overlaps.length === 0) return noOverlap;
    if (overlaps.length > MAX_DEPENETRATION_SOLIDS) {
      return { ...noOverlap, attempted: true, reason: 'no-safe-candidate', overlaps };
    }

    let outwardNormals = null;
    if (preferredDelta) {
      outwardNormals = overlaps
        .map(box => initialOverlapNormal(cx, cy, box, preferredDelta[0], preferredDelta[1]))
        .filter(normal =>
          preferredDelta[0] * normal[0] + preferredDelta[1] * normal[1] > SWEEP_EPSILON);
      if (outwardNormals.length === 0) {
        return { ...noOverlap, attempted: true, reason: 'no-outward-component', overlaps };
      }
    }

    const maxPush = r * MAX_DEPENETRATION_RADII;
    const relevant = this._queryAabbCandidates(
      'depenetration',
      cx - maxPush - r,
      cy - maxPush - r,
      cx + maxPush + r,
      cy + maxPush + r,
    ).filter(box => box.max[2] > zLo && box.min[2] < zHi);
    const xValues = new Set();
    const yValues = new Set();
    const radial = [];
    for (const box of overlaps) {
      if (![...box.min, ...box.max].every(Number.isFinite)) continue;
      const pad = Number.EPSILON * Math.max(1, r, ...box.min.map(Math.abs), ...box.max.map(Math.abs)) * 4;
      let minX = box.min[0] - r;
      let maxX = box.max[0] + r;
      let minY = box.min[1] - r;
      let maxY = box.max[1] + r;
      if (circleOverlapsXY(minX, cy, r, box)) minX -= pad;
      if (circleOverlapsXY(maxX, cy, r, box)) maxX += pad;
      if (circleOverlapsXY(cx, minY, r, box)) minY -= pad;
      if (circleOverlapsXY(cx, maxY, r, box)) maxY += pad;
      xValues.add(minX);
      xValues.add(maxX);
      yValues.add(minY);
      yValues.add(maxY);

      const nearestX = Math.max(box.min[0], Math.min(cx, box.max[0]));
      const nearestY = Math.max(box.min[1], Math.min(cy, box.max[1]));
      const outsideX = cx - nearestX;
      const outsideY = cy - nearestY;
      const outsideLength = Math.hypot(outsideX, outsideY);
      if (outsideLength > SWEEP_EPSILON) {
        let radialX = nearestX + outsideX / outsideLength * r;
        let radialY = nearestY + outsideY / outsideLength * r;
        if (circleOverlapsXY(radialX, radialY, r, box)) {
          radialX += outsideX / outsideLength * pad;
          radialY += outsideY / outsideLength * pad;
        }
        radial.push([radialX, radialY]);
      }
    }

    const xs = [...xValues].sort((a, b) => a - b);
    const ys = [...yValues].sort((a, b) => a - b);
    const unique = new Set();
    const candidates = [];
    const addCandidate = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (Object.is(x, -0)) x = 0;
      if (Object.is(y, -0)) y = 0;
      const dx = x - cx;
      const dy = y - cy;
      const distanceSq = dx * dx + dy * dy;
      if (!Number.isFinite(distanceSq)
        || distanceSq <= 0
        || distanceSq > maxPush * maxPush + SWEEP_EPSILON) return;
      if (outwardNormals && (
        dx * preferredDelta[0] + dy * preferredDelta[1] <= 0
        || !outwardNormals.some(normal => dx * normal[0] + dy * normal[1] > 0)
      )) return;
      const key = `${x},${y}`;
      if (unique.has(key)) return;
      unique.add(key);
      candidates.push({ position: [x, y], displacement: [dx, dy], distanceSq });
    };
    for (const x of xs) addCandidate(x, cy);
    for (const y of ys) addCandidate(cx, y);
    for (const x of xs) for (const y of ys) addCandidate(x, y);
    for (const [x, y] of radial) addCandidate(x, y);

    candidates.sort((a, b) =>
      a.distanceSq - b.distanceSq
      || a.position[0] - b.position[0]
      || a.position[1] - b.position[1]);
    for (const candidate of candidates.slice(0, MAX_DEPENETRATION_CANDIDATES)) {
      const blocked = relevant.some(box =>
        circleOverlapsXY(candidate.position[0], candidate.position[1], r, box));
      if (!blocked) {
        return {
          attempted: true,
          resolved: true,
          reason: 'resolved',
          ...candidate,
          overlaps,
        };
      }
    }
    return { ...noOverlap, attempted: true, reason: 'no-safe-candidate', overlaps };
  }

  // 円柱を連続 sweep し、接触面に残りの移動を射影してスライドさせる。
  // 反復上限に達した残りは適用しないため、複雑な角でも安全側かつ有限時間で終了する。
  moveCylinder(cx, cy, r, zLo, zHi, dx, dy) {
    this._lastDepenetration = {
      attempted: false, resolved: false, reason: 'not-needed', displacement: [0, 0],
    };
    if (![cx, cy, r, zLo, zHi, dx, dy].every(Number.isFinite)) {
      this._lastDepenetration = {
        attempted: true, resolved: false, reason: 'invalid-input', displacement: [0, 0],
      };
      return {
        position: [Number.isFinite(cx) ? cx : 0, Number.isFinite(cy) ? cy : 0],
        displacement: [0, 0],
        clippedDelta: [0, 0],
        blocked: [false, false],
        normals: [],
        iterations: 0,
        truncated: false,
      };
    }

    const stationary = dx * dx + dy * dy <= SWEEP_EPSILON * SWEEP_EPSILON;
    const depenetration = this._findDepenetration(
      cx, cy, r, zLo, zHi, stationary ? null : [dx, dy],
    );
    this._lastDepenetration = {
      attempted: depenetration.attempted,
      resolved: depenetration.resolved,
      reason: depenetration.reason,
      displacement: depenetration.resolved ? [...depenetration.displacement] : [0, 0],
    };

    if (stationary) {
      const position = depenetration.resolved ? depenetration.position : [cx, cy];
      return {
        position: [...position],
        displacement: [position[0] - cx, position[1] - cy],
        clippedDelta: [0, 0],
        blocked: [false, false],
        normals: [],
        iterations: 0,
        truncated: false,
      };
    }

    if (depenetration.attempted && !depenetration.resolved) {
      const normals = depenetration.overlaps.map(box =>
        initialOverlapNormal(cx, cy, box, dx, dy));
      return {
        position: [cx, cy],
        displacement: [0, 0],
        clippedDelta: [0, 0],
        blocked: [
          normals.some(([nx]) => Math.abs(nx) > SWEEP_EPSILON),
          normals.some(([, ny]) => Math.abs(ny) > SWEEP_EPSILON),
        ],
        normals: normals.map(normal => [...normal]),
        iterations: 1,
        truncated: false,
      };
    }

    let position = depenetration.resolved ? [...depenetration.position] : [cx, cy];
    let remaining = [dx, dy];
    if (depenetration.resolved) {
      const correction = depenetration.displacement;
      const correctionLengthSq = correction[0] * correction[0] + correction[1] * correction[1];
      const ratio = Math.max(0, Math.min(1,
        (dx * correction[0] + dy * correction[1]) / correctionLengthSq));
      remaining = [dx - correction[0] * ratio, dy - correction[1] * ratio];
    }
    const planes = [];
    let iterations = 0;

    while (
      iterations < MAX_SLIDE_ITERATIONS
      && remaining[0] * remaining[0] + remaining[1] * remaining[1]
        > SWEEP_EPSILON * SWEEP_EPSILON
    ) {
      iterations++;
      const hit = this.sweepCylinder(
        position[0], position[1], r, zLo, zHi, remaining[0], remaining[1],
      );
      position = hit.position;
      if (!hit.hit) {
        remaining = [0, 0];
        break;
      }

      planes.push(hit.normal);
      const left = 1 - hit.fraction;
      remaining = clipIntoPlanes([remaining[0] * left, remaining[1] * left], planes);
    }

    const clippedDelta = clipIntoPlanes([dx, dy], planes);
    return {
      position,
      displacement: [position[0] - cx, position[1] - cy],
      clippedDelta,
      blocked: [
        planes.some(([nx]) => Math.abs(nx) > SWEEP_EPSILON),
        planes.some(([, ny]) => Math.abs(ny) > SWEEP_EPSILON),
      ],
      normals: planes.map(normal => [...normal]),
      iterations,
      truncated: remaining[0] * remaining[0] + remaining[1] * remaining[1]
        > SWEEP_EPSILON * SWEEP_EPSILON,
    };
  }

  // 平らな上下端を持つ円柱のZ移動を連続 sweep する。
  sweepVerticalCylinder(cx, cy, r, zLo, height, dz) {
    if (Math.abs(dz) <= SWEEP_EPSILON) {
      return { hit: false, fraction: 1, z: zLo + dz, normal: [0, 0, 0], solid: null };
    }

    const zHi = zLo + height;
    let nearest = null;
    for (const box of this._queryAabbCandidates(
      'sweepVerticalCylinder', cx - r, cy - r, cx + r, cy + r,
    )) {
      if (!circleOverlapsXY(cx, cy, r, box)) continue;
      const overlapsZ = box.max[2] > zLo && box.min[2] < zHi;
      let fraction;
      let normal;

      if (overlapsZ) {
        // 初期重複は、今回の変位だけで完全に外へ出られる場合に限って許可する。
        // 微小な「脱出方向」入力を無衝突扱いすると、重複したまま速度を維持してしまう。
        const clears = dz > 0
          ? zLo + dz >= box.max[2] - SWEEP_EPSILON
          : zHi + dz <= box.min[2] + SWEEP_EPSILON;
        if (clears) continue;
        fraction = 0;
        normal = dz > 0 ? [0, 0, -1] : [0, 0, 1];
      } else if (dz > 0 && zHi <= box.min[2]) {
        fraction = (box.min[2] - zHi) / dz;
        normal = [0, 0, -1];
      } else if (dz < 0 && zLo >= box.max[2]) {
        fraction = (box.max[2] - zLo) / dz;
        normal = [0, 0, 1];
      } else {
        continue;
      }

      if (fraction < -SWEEP_EPSILON || fraction > 1 + SWEEP_EPSILON) continue;
      const t = Math.max(0, Math.min(1, fraction));
      if (nearest === null || t < nearest.fraction - SWEEP_EPSILON) {
        nearest = { fraction: t, normal, solid: box };
      }
    }

    if (nearest === null) {
      return { hit: false, fraction: 1, z: zLo + dz, normal: [0, 0, 0], solid: null };
    }
    return {
      hit: true,
      fraction: nearest.fraction,
      z: zLo + dz * nearest.fraction,
      normal: nearest.normal,
      solid: nearest.solid,
    };
  }

  // 足元z・半径rで立てる最も高い床（feetZ+maxStep以下のtop面）を返す
  groundHeight(cx, cy, feetZ, r, maxStep) {
    let best = -Infinity;
    const lim = feetZ + maxStep;
    for (const b of this._queryAabbCandidates(
      'groundHeight', cx - r, cy - r, cx + r, cy + r,
    )) {
      const top = b.max[2];
      if (top > lim || top <= best) continue;
      if (circleOverlapsXY(cx, cy, r, b)) best = top;
    }
    return best;
  }

  // 水平移動の押し出し。z範囲[zLo,zHi]と交差するソリッドが壁になる。
  // axis: 0=x, 1=y。移動後座標を返す。
  resolveAxis(cx, cy, r, zLo, zHi, axis, moved) {
    const start = axis === 0 ? cx : cy;
    if (moved === start) return moved;
    const positive = moved > start;
    let resolved = moved;
    const endX = axis === 0 ? moved : cx;
    const endY = axis === 1 ? moved : cy;
    for (const b of this._queryAabbCandidates(
      'resolveAxis',
      Math.min(cx, endX) - r,
      Math.min(cy, endY) - r,
      Math.max(cx, endX) + r,
      Math.max(cy, endY) + r,
    )) {
      if (b.max[2] <= zLo || b.min[2] >= zHi) continue;
      const other = axis === 0 ? cy : cx;
      const otherAxis = axis === 0 ? 1 : 0;
      const gap = other < b.min[otherAxis]
        ? b.min[otherAxis] - other
        : other > b.max[otherAxis] ? other - b.max[otherAxis] : 0;
      if (gap >= r) continue;

      // 円とAABBのMinkowski和を軸方向に解析的に sweep する。
      // 到着点だけでなく経路全体を見るため、薄い壁も大きい移動量も貫通しない。
      const reach = Math.sqrt(Math.max(0, r * r - gap * gap));
      if (circleOverlapsXY(cx, cy, r, b)) {
        const dx = axis === 0 ? moved - start : 0;
        const dy = axis === 1 ? moved - start : 0;
        const normal = initialOverlapNormal(cx, cy, b, dx, dy);
        const into = dx * normal[0] + dy * normal[1];
        if (into >= -SWEEP_EPSILON) continue;
        resolved = normal[axis] < 0 ? b.min[axis] - reach : b.max[axis] + reach;
        continue;
      }
      const contact = positive ? b.min[axis] - reach : b.max[axis] + reach;
      if (positive) {
        if (start <= contact && resolved > contact) resolved = contact;
      } else if (start >= contact && resolved < contact) {
        resolved = contact;
      }
    }
    return resolved;
  }

  // レイ vs 全ソリッド。最近ヒットの位置・面法線を含む詳細結果を返す。
  trace(ox, oy, oz, dx, dy, dz, maxDist) {
    let nearest = null;
    for (const solid of this._querySegmentCandidates(
      'trace', ox, oy, dx, dy, maxDist,
    )) {
      const dist = rayAabb(ox, oy, oz, dx, dy, dz, solid, nearest?.dist ?? maxDist);
      // 従来の raycast と同じく maxDist ちょうどの面は範囲外として扱う。
      if (dist < 0 || dist >= maxDist) continue;
      const point = [ox + dx * dist, oy + dy * dist, oz + dz * dist];
      const candidate = {
        hit: true,
        dist,
        point,
        normal: aabbSurfaceNormal(point, [dx, dy, dz], solid),
        solid,
      };
      if (!nearest || traceCandidateBefore(candidate, nearest)) nearest = candidate;
    }
    if (nearest) return nearest;
    return {
      hit: false,
      dist: Infinity,
      point: [ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist],
      normal: [0, 0, 0],
      solid: null,
    };
  }

  // Moving sphere center vs AABBs. point is the sphere-center position at TOI;
  // normal is the exact face/edge/corner contact normal.
  traceSphere(ox, oy, oz, dx, dy, dz, maxDist, radius) {
    if (!Number.isFinite(radius) || radius <= 0) {
      return this.trace(ox, oy, oz, dx, dy, dz, maxDist);
    }
    let nearest = null;
    for (const solid of this._querySegmentCandidates(
      'traceSphere', ox, oy, dx, dy, maxDist, radius,
    )) {
      const dist = sweepSphereAabb(
        ox, oy, oz, dx, dy, dz, radius, solid, nearest?.dist ?? maxDist,
      );
      if (dist < 0 || dist >= maxDist) continue;
      const point = [ox + dx * dist, oy + dy * dist, oz + dz * dist];
      const candidate = {
        hit: true,
        dist,
        point,
        normal: sphereAabbSurfaceNormal(point, [dx, dy, dz], solid),
        solid,
      };
      if (!nearest || traceCandidateBefore(candidate, nearest)) nearest = candidate;
    }
    if (nearest) return nearest;
    return {
      hit: false,
      dist: Infinity,
      point: [ox + dx * maxDist, oy + dy * maxDist, oz + dz * maxDist],
      normal: [0, 0, 0],
      solid: null,
    };
  }

  // 既存呼び出し向けの数値API。詳細 trace の距離だけを公開する。
  raycast(ox, oy, oz, dx, dy, dz, maxDist) {
    return this.trace(ox, oy, oz, dx, dy, dz, maxDist).dist;
  }
}

function traceCandidateBefore(candidate, nearest) {
  if (candidate.dist < nearest.dist) return true;
  if (candidate.dist > nearest.dist) return false;
  const candidateKey = [...candidate.normal, ...candidate.solid.min, ...candidate.solid.max, String(candidate.solid.tag || '')];
  const nearestKey = [...nearest.normal, ...nearest.solid.min, ...nearest.solid.max, String(nearest.solid.tag || '')];
  for (let i = 0; i < candidateKey.length; i++) {
    if (candidateKey[i] < nearestKey[i]) return true;
    if (candidateKey[i] > nearestKey[i]) return false;
  }
  return false;
}

function aabbSurfaceNormal(point, direction, box) {
  const scale = Math.max(1, ...point.map(Math.abs), ...box.min.map(Math.abs), ...box.max.map(Math.abs));
  const epsilon = SWEEP_EPSILON * scale * 16;
  const faces = [];
  for (let axis = 0; axis < 3; axis++) {
    for (const [coordinate, sign] of [[box.min[axis], -1], [box.max[axis], 1]]) {
      const normal = [0, 0, 0];
      normal[axis] = sign;
      faces.push({
        distance: Math.abs(point[axis] - coordinate),
        enteringSpeed: direction[axis] * sign,
        normal,
      });
    }
  }
  const onSurface = faces.filter(face => face.distance <= epsilon);
  const candidates = onSurface.length ? onSurface : faces;
  candidates.sort((a, b) => {
    const aEntering = a.enteringSpeed < -SWEEP_EPSILON ? 0 : 1;
    const bEntering = b.enteringSpeed < -SWEEP_EPSILON ? 0 : 1;
    if (aEntering !== bEntering) return aEntering - bEntering;
    if (Math.abs(a.enteringSpeed - b.enteringSpeed) > SWEEP_EPSILON) return a.enteringSpeed - b.enteringSpeed;
    if (Math.abs(a.distance - b.distance) > epsilon) return a.distance - b.distance;
    for (let axis = 0; axis < 3; axis++) {
      if (a.normal[axis] !== b.normal[axis]) return a.normal[axis] - b.normal[axis];
    }
    return 0;
  });
  return candidates[0].normal;
}

// slab法。ヒットしなければ-1
export function rayAabb(ox, oy, oz, dx, dy, dz, b, maxDist) {
  let tmin = 0, tmax = maxDist;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < b.min[i] || o[i] > b.max[i]) return -1;
    } else {
      const inv = 1 / d[i];
      let t1 = (b.min[i] - o[i]) * inv;
      let t2 = (b.max[i] - o[i]) * inv;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// レイ vs 縦円柱の側面（上下capなし）。ヒット距離 or -1
export function rayCylinderSide(ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, r, maxDist) {
  const fx = ox - cx, fy = oy - cy;
  const a = dx * dx + dy * dy;
  let best = Infinity;
  if (a >= 1e-9) {
    const bq = 2 * (fx * dx + fy * dy);
    const cq = fx * fx + fy * fy - r * r;
    const disc = bq * bq - 4 * a * cq;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const t1 = (-bq - sq) / (2 * a);
      const t2 = (-bq + sq) / (2 * a);
      for (const tc of [t1, t2]) {
        if (tc < 0 || tc > maxDist) continue;
        const z = oz + dz * tc;
        if (z >= zLo && z <= zHi) best = Math.min(best, tc);
      }
    }
  }
  return Number.isFinite(best) ? best : -1;
}

// レイ vs 縦円柱（プレイヤー胴体）。ヒット距離 or -1
export function rayCylinder(ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, r, maxDist) {
  const fx = ox - cx, fy = oy - cy;
  const side = rayCylinderSide(ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, r, maxDist);
  let best = side >= 0 ? side : Infinity;
  // 急角度のレイは側面より先に上下の円盤へ入るため、フタも常に判定する。
  if (Math.abs(dz) >= 1e-9) {
    for (const zCap of [zLo, zHi]) {
      const tc = (zCap - oz) / dz;
      if (tc < 0 || tc > maxDist) continue;
      const x = fx + dx * tc, y = fy + dy * tc;
      if (x * x + y * y <= r * r) best = Math.min(best, tc);
    }
  }
  return Number.isFinite(best) ? best : -1;
}

// Moving sphere vs a closed, capped finite vertical cylinder. radius=0 keeps
// the historical rayCylinder contract exactly.
export function sweepSphereCylinder(
  ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist,
) {
  if (!(sphereRadius > 0) || !Number.isFinite(sphereRadius)) {
    return rayCylinder(
      ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, cylinderRadius, maxDist,
    );
  }
  return sweepSphereFiniteCylinder(
    ox, oy, oz, dx, dy, dz,
    cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist,
    false,
  );
}

// Moving sphere vs a capless finite cylindrical shell. radius=0 keeps the
// historical rayCylinderSide contract exactly.
export function sweepSphereCylinderSide(
  ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist,
) {
  if (!(sphereRadius > 0) || !Number.isFinite(sphereRadius)) {
    return rayCylinderSide(
      ox, oy, oz, dx, dy, dz, cx, cy, zLo, zHi, cylinderRadius, maxDist,
    );
  }
  return sweepSphereFiniteCylinder(
    ox, oy, oz, dx, dy, dz,
    cx, cy, zLo, zHi, cylinderRadius, sphereRadius, maxDist,
    true,
  );
}

// レイ vs 球（頭部）。ヒット距離 or -1
export function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxDist) {
  const fx = ox - cx, fy = oy - cy, fz = oz - cz;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const c = fx * fx + fy * fy + fz * fz - r * r;
  const disc = b * b - 4 * c;
  if (disc < 0) return -1;
  const t = (-b - Math.sqrt(disc)) / 2;
  if (t < 0 || t > maxDist) return -1;
  return t;
}
