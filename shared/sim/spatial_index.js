// Deterministic broadphase for immutable AABBs.
// Buckets contain source-array ordinals; every query restores ordinal order
// before narrow phase so collision ties behave exactly like a linear scan.

const DEFAULT_CELL_SIZE = 4;
const DEFAULT_LINEAR_THRESHOLD = 32;
const DEFAULT_MAX_CELLS_PER_SOLID = 64;
const DEFAULT_MAX_QUERY_CELLS = 256;

function cellCoordinate(value, cellSize) {
  return Math.floor(value / cellSize);
}

function cellKey(x, y) {
  return `${x},${y}`;
}

function safeCellRange(min, max, cellSize) {
  const cellMin = cellCoordinate(min, cellSize);
  const cellMax = cellCoordinate(max, cellSize);
  if (!Number.isSafeInteger(cellMin) || !Number.isSafeInteger(cellMax) || cellMax < cellMin) {
    return null;
  }
  const span = cellMax - cellMin + 1;
  if (!Number.isSafeInteger(span) || span <= 0) return null;
  return { min: cellMin, max: cellMax, span };
}

function finiteBounds(box) {
  return box
    && Array.isArray(box.min)
    && Array.isArray(box.max)
    && Number.isFinite(box.min[0])
    && Number.isFinite(box.min[1])
    && Number.isFinite(box.max[0])
    && Number.isFinite(box.max[1])
    && box.min[0] <= box.max[0]
    && box.min[1] <= box.max[1];
}

export class SpatialIndex {
  constructor(options = {}) {
    this.cellSize = options.cellSize ?? DEFAULT_CELL_SIZE;
    this.linearThreshold = options.linearThreshold ?? DEFAULT_LINEAR_THRESHOLD;
    this.maxCellsPerSolid = options.maxCellsPerSolid ?? DEFAULT_MAX_CELLS_PER_SOLID;
    this.maxQueryCells = options.maxQueryCells ?? DEFAULT_MAX_QUERY_CELLS;
    this.enabled = options.enabled !== false;
    this.source = null;
    this.sourceLength = -1;
    this.mode = 'linear';
    this.buckets = new Map();
    this.overflow = [];
    this.seen = new Uint32Array(0);
    this.stamp = 0;
  }

  update(source) {
    if (source === this.source && source.length === this.sourceLength) return;
    this.source = source;
    this.sourceLength = source.length;
    this.buckets = new Map();
    this.overflow = [];
    this.seen = new Uint32Array(source.length);
    this.stamp = 0;
    this.mode = this.enabled && source.length > this.linearThreshold ? 'grid' : 'linear';
    if (this.mode === 'linear') return;

    for (let index = 0; index < source.length; index++) {
      const box = source[index];
      if (!finiteBounds(box)) {
        this.overflow.push(index);
        continue;
      }
      const xRange = safeCellRange(box.min[0], box.max[0], this.cellSize);
      const yRange = safeCellRange(box.min[1], box.max[1], this.cellSize);
      if (!xRange || !yRange || xRange.span > this.maxCellsPerSolid / yRange.span) {
        this.overflow.push(index);
        continue;
      }
      for (let x = xRange.min; x <= xRange.max; x++) {
        for (let y = yRange.min; y <= yRange.max; y++) {
          const key = cellKey(x, y);
          let bucket = this.buckets.get(key);
          if (!bucket) {
            bucket = [];
            this.buckets.set(key, bucket);
          }
          bucket.push(index);
        }
      }
    }
  }

  invalidate() {
    this.source = null;
    this.sourceLength = -1;
    this.mode = 'linear';
    this.buckets = new Map();
    this.overflow = [];
    this.seen = new Uint32Array(0);
    this.stamp = 0;
  }

  all() {
    return this.source;
  }

  queryAabb(minX, minY, maxX, maxY) {
    if (this.mode === 'linear') return this.source;
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return this.source;
    if (minX > maxX) [minX, maxX] = [maxX, minX];
    if (minY > maxY) [minY, maxY] = [maxY, minY];
    const xRange = safeCellRange(minX, maxX, this.cellSize);
    const yRange = safeCellRange(minY, maxY, this.cellSize);
    if (!xRange || !yRange || xRange.span > this.maxQueryCells / yRange.span) return this.source;

    return this.collect(visit => {
      for (let x = xRange.min; x <= xRange.max; x++) {
        for (let y = yRange.min; y <= yRange.max; y++) visit(x, y);
      }
    });
  }

  querySegment(ox, oy, dx, dy, maxDist, padding = 0) {
    if (this.mode === 'linear') return this.source;
    if (![ox, oy, dx, dy, maxDist, padding].every(Number.isFinite)
      || maxDist < 0 || padding < 0) return this.source;
    const ex = ox + dx * maxDist;
    const ey = oy + dy * maxDist;
    if (!Number.isFinite(ex) || !Number.isFinite(ey)) return this.source;

    const startX = cellCoordinate(ox, this.cellSize);
    const startY = cellCoordinate(oy, this.cellSize);
    const endX = cellCoordinate(ex, this.cellSize);
    const endY = cellCoordinate(ey, this.cellSize);
    if (![startX, startY, endX, endY].every(Number.isSafeInteger)) return this.source;
    const estimatedCells = Math.abs(endX - startX) + Math.abs(endY - startY) + 1;
    const cellPadding = Math.ceil(padding / this.cellSize);
    const neighborhoodWidth = cellPadding * 2 + 1;
    const cellsPerVisit = neighborhoodWidth * neighborhoodWidth;
    if (!Number.isSafeInteger(estimatedCells)
      || !Number.isSafeInteger(cellsPerVisit)
      || estimatedCells > this.maxQueryCells / cellsPerVisit) {
      return this.source;
    }

    return this.collect(visit => {
      const visitPadded = (x, y) => {
        for (let offsetX = -cellPadding; offsetX <= cellPadding; offsetX++) {
          for (let offsetY = -cellPadding; offsetY <= cellPadding; offsetY++) {
            visit(x + offsetX, y + offsetY);
          }
        }
      };
      let cellX = startX;
      let cellY = startY;
      visitPadded(cellX, cellY);
      if (cellX === endX && cellY === endY) return;

      const segmentX = ex - ox;
      const segmentY = ey - oy;
      const stepX = Math.sign(segmentX);
      const stepY = Math.sign(segmentY);
      const tDeltaX = stepX === 0 ? Infinity : this.cellSize / Math.abs(segmentX);
      const tDeltaY = stepY === 0 ? Infinity : this.cellSize / Math.abs(segmentY);
      const boundaryX = stepX > 0 ? (cellX + 1) * this.cellSize : cellX * this.cellSize;
      const boundaryY = stepY > 0 ? (cellY + 1) * this.cellSize : cellY * this.cellSize;
      let tMaxX = stepX === 0 ? Infinity : (boundaryX - ox) / segmentX;
      let tMaxY = stepY === 0 ? Infinity : (boundaryY - oy) / segmentY;

      for (let visited = 1; visited < estimatedCells; visited++) {
        if (tMaxX < tMaxY) {
          cellX += stepX;
          tMaxX += tDeltaX;
        } else if (tMaxY < tMaxX) {
          cellY += stepY;
          tMaxY += tDeltaY;
        } else {
          cellX += stepX;
          cellY += stepY;
          tMaxX += tDeltaX;
          tMaxY += tDeltaY;
        }
        visitPadded(cellX, cellY);
        if (cellX === endX && cellY === endY) break;
      }
    });
  }

  collect(enumerateCells) {
    this.stamp++;
    if (this.stamp === 0xffff_ffff) {
      this.seen.fill(0);
      this.stamp = 1;
    }
    const stamp = this.stamp;
    const indices = [];
    const add = index => {
      if (this.seen[index] === stamp) return;
      this.seen[index] = stamp;
      indices.push(index);
    };
    for (const index of this.overflow) add(index);
    enumerateCells((x, y) => {
      const bucket = this.buckets.get(cellKey(x, y));
      if (bucket) for (const index of bucket) add(index);
    });
    indices.sort((a, b) => a - b);
    return indices.map(index => this.source[index]);
  }

  diagnostics() {
    return Object.freeze({
      mode: this.mode,
      solidCount: this.sourceLength < 0 ? 0 : this.sourceLength,
      cellCount: this.buckets.size,
      overflowSolids: this.overflow.length,
    });
  }
}
