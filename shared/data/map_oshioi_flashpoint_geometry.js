import { OSHIOI_FLASHPOINT } from './map_oshioi_flashpoint.js';

const REMOVE_CANONICAL_SOLID_IDS = Object.freeze([
  'canonical-002-wall',
  'canonical-003-wall',
]);

function clone(value) {
  return structuredClone(value);
}

function box(id, min, max, tag) {
  return { kind: 'box', id, min, max, tag };
}

function runtimeSolid(primitive) {
  return {
    id: primitive.id,
    min: [...primitive.min],
    max: [...primitive.max],
    tag: primitive.tag,
  };
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function rotate180(point) {
  return [
    Object.is(-point[0], -0) ? 0 : -point[0],
    Object.is(-point[1], -0) ? 0 : -point[1],
    point[2],
  ];
}

function routeLength(points) {
  let distance = 0;
  for (let index = 1; index < points.length; index++) {
    distance += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
      points[index][2] - points[index - 1][2],
    );
  }
  return round(distance);
}

const EAST_CORE_ROUTES = Object.freeze({
  front: [
    [40, 0, 4], [35, 0, 4], [28, 0, 4], [22, 2, 4], [18, 2, 4],
    [16, -1, 4], [14, 2, 4], [10, 2, 4], [10, 0, 4],
    [7.7, 0, 4], [7, 0, 4], [6.3, 0, 3.5], [5.6, 0, 2.5], [3, 0, 2.5],
  ],
  cloister: [
    [41.5, 10, 4], [41, 21, 4], [39, 21, 4], [30.5, 21, 4],
    [30.5, 19.5, 4], [13, 9.5, 4], [8, 6.5, 4], [4, 6.5, 4],
    [3.5, 6.5, 4], [3, 6.5, 4], [3, 6, 4], [2.5, 6, 4],
    [2, 6, 4], [1.5, 6, 4], [1.5, 5.5, 4], [1.5, 5, 4],
    [1.5, 4.5, 3.5], [1, 4.5, 3.5], [1, 4, 3], [0.5, 4, 3],
    [0.5, 3.5, 2.5], [0, 3.5, 2.5], [0, 3, 2.5],
  ],
  shallows: [
    [41.5, -7.4, 4], [41.5, -8.5, 3.5], [41.5, -9.125, 3],
    [41.5, -9.75, 2.5], [41.5, -10.375, 2], [41.5, -11, 1.5],
    [41.5, -11.625, 1], [41.5, -12.25, 0.5], [41.5, -13.5, 0],
    [38.5, -18, 0], [37.7, -18, 0.5], [36.95, -18, 1],
    [36.2, -18, 1.5], [35.45, -18, 2], [34.7, -18, 2.5],
    [33.95, -18, 3], [33.2, -18, 3.5], [32.45, -18, 4], [31.5, -18, 4],
    [19, -17.5, 4], [8, -7, 4], [8, -6.5, 4], [4, -6.5, 4],
    [3.5, -6.5, 4], [3, -6.5, 4], [3, -6, 4], [2.5, -6, 4],
    [2, -6, 4], [1.5, -6, 4], [1.5, -5.5, 4], [1.5, -5, 4],
    [1.5, -4.5, 3.5], [1, -4.5, 3.5], [1, -4, 3], [0.5, -4, 3],
    [0.5, -3.5, 2.5], [0, -3.5, 2.5], [0, -3, 2.5],
  ],
});

const EAST_CORE_PREFIXES = Object.freeze({
  front: [
    [118, 0, 4], [112, 0, 4], [96, 0, 4], [72, 0, 4],
    [52, 0, 4], [47.8, 0, 4], [44, 0, 4],
  ],
  cloister: [
    [118, 0, 4], [116, 5, 4], [114, 10, 4], [110, 10, 4], [96, 10, 4],
    [72, 10, 4], [52, 10, 4], [47.8, 10, 4], [47.8, 6, 4],
    [46, 6, 4], [44, 6, 4], [43, 6, 4],
  ],
  shallows: [
    [118, 0, 4], [116, -5, 4], [114, -10, 4], [110, -10, 4], [96, -10, 4],
    [72, -10, 4], [52, -10, 4], [47.8, -8, 4], [47.8, -6, 4],
    [44, -6, 4], [42.5, -6, 4],
  ],
});

function spawn(id, pos, target, spawnRooms) {
  return {
    id,
    pos: [...pos],
    yaw: Math.atan2(target[1] - pos[1], target[0] - pos[0]),
    exitsByLane: clone(spawnRooms[id].exitsByLane),
    approachesByLane: clone(spawnRooms[id].approachesByLane),
  };
}

function buildSpawnsBySite(siteById, spawnRooms) {
  const eastBase = site => spawn('east-base', [118, 0, 4], site.center, spawnRooms);
  const westBase = site => spawn('west-base', [-118, 0, 4], site.center, spawnRooms);
  return {
    shiogama: {
      east: eastBase(siteById.shiogama),
      west: westBase(siteById.shiogama),
    },
    mizuichi: {
      east: eastBase(siteById.mizuichi),
      west: spawn(
        'west-forward-north',
        [-8, 72, 4],
        siteById.mizuichi.center,
        spawnRooms,
      ),
    },
    kado: {
      east: eastBase(siteById.kado),
      west: spawn(
        'west-forward-south',
        [-8, -72, 4],
        siteById.kado.center,
        spawnRooms,
      ),
    },
    ami: {
      east: spawn(
        'east-forward-north',
        [8, 72, 4],
        siteById.ami.center,
        spawnRooms,
      ),
      west: westBase(siteById.ami),
    },
    kazami: {
      east: spawn(
        'east-forward-south',
        [8, -72, 4],
        siteById.kazami.center,
        spawnRooms,
      ),
      west: westBase(siteById.kazami),
    },
  };
}

function buildCentralRoutes(spawnsBySite) {
  const sides = {};
  for (const side of ['east', 'west']) {
    const mirrored = side === 'west';
    sides[side] = {};
    for (const lane of ['front', 'cloister', 'shallows']) {
      const eastPoints = [...EAST_CORE_PREFIXES[lane], ...EAST_CORE_ROUTES[lane]];
      const points = mirrored ? eastPoints.map(rotate180) : eastPoints.map(point => [...point]);
      sides[side][lane] = {
        id: `shiogama-${side}-${lane}-runtime`,
        lane,
        spawnId: spawnsBySite.shiogama[side].id,
        points,
        measuredLengthM: routeLength(points),
      };
    }
  }
  return sides;
}

function buildOuterRoute(site, side, lane, authoredSpawn) {
  const start = authoredSpawn.pos;
  const approach = authoredSpawn.approachesByLane[lane];
  const exit = authoredSpawn.exitsByLane[lane];
  const entrySign = Math.sign(exit[0] - site.center[0]) || (side === 'east' ? 1 : -1);
  const entry = [site.center[0] + entrySign * 14, site.center[1], site.center[2]];
  const dx = entry[0] - exit[0];
  const dy = entry[1] - exit[1];
  const length = Math.max(1, Math.hypot(dx, dy));
  const perpendicular = [-dy / length, dx / length];
  const laneSign = lane === 'cloister' ? 1 : lane === 'shallows' ? -1 : 0;
  const endpoint = [
    site.center[0],
    site.center[1] + laneSign * 4.5,
    site.center[2],
  ];
  const controlOffset = laneSign * 5;
  const control = [
    (exit[0] + entry[0]) / 2 + perpendicular[0] * controlOffset,
    (exit[1] + entry[1]) / 2 + perpendicular[1] * controlOffset,
  ];
  const points = [[...start], [...approach]];
  for (let sample = 0; sample <= 8; sample++) {
    const t = sample / 8;
    const inv = 1 - t;
    points.push([
      round(inv * inv * exit[0] + 2 * inv * t * control[0] + t * t * entry[0]),
      round(inv * inv * exit[1] + 2 * inv * t * control[1] + t * t * entry[1]),
      site.center[2],
    ]);
  }
  points[0] = [...start];
  points[1] = [...approach];
  points[2] = [...exit];
  points[points.length - 1] = entry.map(round);
  points.push(endpoint.map(round));
  let routedPoints = points;
  // The two far-side approaches below intentionally bend around the paired
  // high-ground assembly instead of treating its stairs as walk-through art.
  if (site.id === 'kado' && side === 'west') {
    // The south-west shallows exit is directly opposite the east forward
    // spawn's north-facing wall.  Its old -66m detour shaved that wall with a
    // player capsule even though the route's centre line looked clear.  Keep
    // the early shared corridor at -64m, then separate lanes inside the site.
    const laneY = lane === 'cloister' ? -62 : -64;
    routedPoints = [
      [...start],
      [...approach],
      [...exit],
      [20, laneY, 4],
      [50, laneY, 4],
      [50, -44, 4],
      entry.map(round),
      endpoint.map(round),
    ];
  } else if (site.id === 'ami' && side === 'east') {
    routedPoints = [
      [...start],
      [...approach],
      [...exit],
      [-26, 40 + laneSign * 2, 4],
      entry.map(round),
      endpoint.map(round),
    ];
  }
  return {
    id: `${site.id}-${side}-${lane}-runtime`,
    lane,
    spawnId: authoredSpawn.id,
    points: routedPoints,
    measuredLengthM: routeLength(routedPoints),
  };
}

function buildRoutesBySite(sites, spawnsBySite) {
  const routesBySite = {
    shiogama: buildCentralRoutes(spawnsBySite),
  };
  for (const site of sites) {
    if (site.id === 'shiogama') continue;
    routesBySite[site.id] = {};
    for (const side of ['east', 'west']) {
      routesBySite[site.id][side] = {};
      for (const lane of ['front', 'cloister', 'shallows']) {
        routesBySite[site.id][side][lane] = buildOuterRoute(
          site,
          side,
          lane,
          spawnsBySite[site.id][side],
        );
      }
    }
  }
  return routesBySite;
}

function buildSpawnRooms() {
  const specs = [
    {
      id: 'east-base',
      bounds: { x: [112, 126], y: [-16, 16] },
      center: [118, 0, 4],
      open: 'west',
      exitsByLane: {
        front: [110, 0, 4],
        cloister: [110, 10, 4],
        shallows: [110, -10, 4],
      },
    },
    {
      id: 'west-base',
      bounds: { x: [-126, -112], y: [-16, 16] },
      center: [-118, 0, 4],
      open: 'east',
      exitsByLane: {
        front: [-110, 0, 4],
        cloister: [-110, -10, 4],
        shallows: [-110, 10, 4],
      },
    },
    {
      id: 'east-forward-north',
      bounds: { x: [0, 16], y: [66, 78] },
      center: [8, 72, 4],
      open: 'south',
      exitsByLane: {
        front: [8, 64, 4],
        cloister: [4, 64, 4],
        shallows: [12, 64, 4],
      },
    },
    {
      id: 'west-forward-north',
      bounds: { x: [-16, 0], y: [66, 78] },
      center: [-8, 72, 4],
      open: 'south',
      exitsByLane: {
        front: [-8, 64, 4],
        cloister: [-12, 64, 4],
        shallows: [-4, 64, 4],
      },
    },
    {
      id: 'east-forward-south',
      bounds: { x: [0, 16], y: [-78, -66] },
      center: [8, -72, 4],
      open: 'north',
      exitsByLane: {
        front: [8, -64, 4],
        cloister: [12, -64, 4],
        shallows: [4, -64, 4],
      },
    },
    {
      id: 'west-forward-south',
      bounds: { x: [-16, 0], y: [-78, -66] },
      center: [-8, -72, 4],
      open: 'north',
      exitsByLane: {
        front: [-8, -64, 4],
        cloister: [-4, -64, 4],
        shallows: [-12, -64, 4],
      },
    },
  ];
  const geometry = [];
  const rooms = {};
  for (const spec of specs) {
    const [x0, x1] = spec.bounds.x;
    const [y0, y1] = spec.bounds.y;
    const cx = spec.center[0];
    const cy = spec.center[1];
    const horizontalFace = spec.open === 'west' || spec.open === 'east';
    const openWest = spec.open === 'west';
    const openSouth = spec.open === 'south';
    const prefix = `flash-spawn-${spec.id}-`;
    const walls = [];
    if (horizontalFace) {
      walls.push(
        box(
          `${prefix}back`,
          openWest ? [x1 - 1, y0, 4] : [x0, y0, 4],
          openWest ? [x1, y1, 9] : [x0 + 1, y1, 9],
          'spawnwall',
        ),
        box(`${prefix}side-south`, [x0, y0, 4], [x1, y0 + 0.6, 9], 'spawnwall'),
        box(`${prefix}side-north`, [x0, y1 - 0.6, 4], [x1, y1, 9], 'spawnwall'),
      );
    } else {
      walls.push(
        box(
          `${prefix}back`,
          openSouth ? [x0, y1 - 1, 4] : [x0, y0, 4],
          openSouth ? [x1, y1, 9] : [x1, y0 + 1, 9],
          'spawnwall',
        ),
        box(`${prefix}side-west`, [x0, y0, 4], [x0 + 0.6, y1, 9], 'spawnwall'),
        box(`${prefix}side-east`, [x1 - 0.6, y0, 4], [x1, y1, 9], 'spawnwall'),
      );
    }
    const gapHalf = spec.id.endsWith('base') ? 1.6 : 1.15;
    const spanStart = horizontalFace ? y0 : x0;
    const spanEnd = horizontalFace ? y1 : x1;
    const exitCoordinates = Object.values(spec.exitsByLane)
      .map(point => point[horizontalFace ? 1 : 0])
      .sort((a, b) => a - b);
    let segmentStart = spanStart;
    for (const exitCoordinate of exitCoordinates) {
      const segmentEnd = exitCoordinate - gapHalf;
      if (segmentEnd > segmentStart) {
        const min = horizontalFace
          ? [openWest ? x0 : x1 - 0.6, segmentStart, 4]
          : [segmentStart, openSouth ? y0 : y1 - 0.6, 4];
        const max = horizontalFace
          ? [openWest ? x0 + 0.6 : x1, segmentEnd, 8]
          : [segmentEnd, openSouth ? y0 + 0.6 : y1, 8];
        walls.push(box(
          `${prefix}face-${walls.length - 2}`,
          min,
          max,
          'spawnwall',
        ));
      }
      segmentStart = exitCoordinate + gapHalf;
    }
    if (segmentStart < spanEnd) {
      const min = horizontalFace
        ? [openWest ? x0 : x1 - 0.6, segmentStart, 4]
        : [segmentStart, openSouth ? y0 : y1 - 0.6, 4];
      const max = horizontalFace
        ? [openWest ? x0 + 0.6 : x1, spanEnd, 8]
        : [spanEnd, openSouth ? y0 + 0.6 : y1, 8];
      walls.push(box(
        `${prefix}face-${walls.length - 2}`,
        min,
        max,
        'spawnwall',
      ));
    }
    if (horizontalFace) {
      const baffleX = openWest ? [x1 - 4, x1 - 3] : [x0 + 3, x0 + 4];
      walls.push(
        box(`${prefix}baffle-south`, [baffleX[0], cy - 5, 4], [baffleX[1], cy - 2.5, 7], 'spawnwall'),
        box(`${prefix}baffle-north`, [baffleX[0], cy + 2.5, 4], [baffleX[1], cy + 5, 7], 'spawnwall'),
      );
    } else {
      const baffleY = openSouth ? [y1 - 4, y1 - 3] : [y0 + 3, y0 + 4];
      walls.push(
        box(`${prefix}baffle-west`, [cx - 5, baffleY[0], 4], [cx - 2.5, baffleY[1], 7], 'spawnwall'),
        box(`${prefix}baffle-east`, [cx + 2.5, baffleY[0], 4], [cx + 5, baffleY[1], 7], 'spawnwall'),
      );
    }
    geometry.push(...walls);
    const approachesByLane = Object.fromEntries(
      Object.entries(spec.exitsByLane).map(([lane, point]) => [
        lane,
        horizontalFace
          ? [openWest ? x0 + 2 : x1 - 2, point[1], 4]
          : [point[0], openSouth ? y0 + 2 : y1 - 2, 4],
      ]),
    );
    const openVector = spec.open === 'west'
      ? [-1, 0]
      : spec.open === 'east'
        ? [1, 0]
        : spec.open === 'south'
          ? [0, -1]
          : [0, 1];
    rooms[spec.id] = {
      id: spec.id,
      bounds: clone(spec.bounds),
      center: [...spec.center],
      exits: Object.values(spec.exitsByLane).map(point => [...point]),
      exitsByLane: clone(spec.exitsByLane),
      approachesByLane,
      spawns: [
        [...spec.center],
        [cx - 2.5, cy, 4],
        [cx + 2.5, cy, 4],
        [cx + openVector[0] * 2 - openVector[1] * 1.25,
          cy + openVector[1] * 2 + openVector[0] * 1.25, 4],
        [cx + openVector[0] * 2 + openVector[1] * 1.25,
          cy + openVector[1] * 2 - openVector[0] * 1.25, 4],
      ],
      wallIds: walls.map(wall => wall.id),
    };
  }
  return { geometry, rooms };
}

function buildRails() {
  return [
    box('flash-ring-rail-east-north', [124.5, 18, 4], [125, 90, 6], 'wall'),
    box('flash-ring-rail-east-south', [124.5, -90, 4], [125, -18, 6], 'wall'),
    box('flash-ring-rail-west-north', [-125, 18, 4], [-124.5, 90, 6], 'wall'),
    box('flash-ring-rail-west-south', [-125, -90, 4], [-124.5, -18, 6], 'wall'),
    box('flash-ring-rail-north-west', [-124, 90, 4], [-18, 90.5, 6], 'wall'),
    box('flash-ring-rail-north-east', [18, 90, 4], [124, 90.5, 6], 'wall'),
    box('flash-ring-rail-south-west', [-124, -90.5, 4], [-18, -90, 6], 'wall'),
    box('flash-ring-rail-south-east', [18, -90.5, 4], [124, -90, 6], 'wall'),
  ];
}

function buildOutwardStair({
  siteId,
  accessId,
  axis,
  sign,
  platformCenter,
  topZ,
  lateralCenter,
}) {
  const geometry = [];
  const points = [];
  const stepCount = Math.round((topZ - 4) / 0.5);
  const treadM = 1.2;
  const platformHalfM = 3;
  const edge = platformCenter[axis] + sign * platformHalfM;
  const farEdge = edge + sign * stepCount * treadM;
  const start = axis === 0
    ? [farEdge + sign * 0.8, lateralCenter, 4]
    : [lateralCenter, farEdge + sign * 0.8, 4];
  points.push(start);
  for (let index = 0; index < stepCount; index++) {
    const outer = edge + sign * (stepCount - index) * treadM;
    const inner = edge + sign * (stepCount - index - 1) * treadM;
    const lo = Math.min(inner, outer);
    const hi = Math.max(inner, outer);
    const top = 4 + (index + 1) * 0.5;
    const min = axis === 0
      ? [lo, lateralCenter - 0.9, 4]
      : [lateralCenter - 0.9, lo, 4];
    const max = axis === 0
      ? [hi, lateralCenter + 0.9, top]
      : [lateralCenter + 0.9, hi, top];
    geometry.push(box(
      `flash-site-${siteId}-stair-${accessId}-${String(index).padStart(2, '0')}`,
      min,
      max,
      'stair',
    ));
    const coordinate = (inner + outer) / 2;
    points.push(axis === 0
      ? [round(coordinate), lateralCenter, top]
      : [lateralCenter, round(coordinate), top]);
  }
  const platformPoint = edge - sign * 0.8;
  points.push(axis === 0
    ? [round(platformPoint), lateralCenter, topZ]
    : [lateralCenter, round(platformPoint), topZ]);
  return {
    geometry,
    route: {
      id: `${siteId}-high-${accessId}`,
      points,
      measuredLengthM: routeLength(points),
    },
  };
}

function buildOuterSites(sites) {
  const geometry = [];
  const highGroundRoutesBySite = {};
  const objectiveBoundariesBySite = {};
  for (const site of sites) {
    if (site.id === 'shiogama') continue;
    const [cx, cy] = site.center;
    const [x0, x1] = site.playBoundsM.x;
    const [y0, y1] = site.playBoundsM.y;
    const prefix = `flash-site-${site.id}-`;
    geometry.push(
      box(`${prefix}objective-pad`, [cx - 9, cy - 9, 3.8], [cx + 9, cy + 9, 4], 'rim'),
      box(`${prefix}boundary-post-nw`, [cx - 7.4, cy + 7.1, 4], [cx - 6.6, cy + 7.9, 5.4], 'rim'),
      box(`${prefix}boundary-post-ne`, [cx + 6.6, cy + 7.1, 4], [cx + 7.4, cy + 7.9, 5.4], 'rim'),
      box(`${prefix}boundary-post-sw`, [cx - 7.4, cy - 7.9, 4], [cx - 6.6, cy - 7.1, 5.4], 'rim'),
      box(`${prefix}boundary-post-se`, [cx + 6.6, cy - 7.9, 4], [cx + 7.4, cy - 7.1, 5.4], 'rim'),
      box(`${prefix}cover-northwest`, [cx - 8, cy + 7.5, 4], [cx - 5, cy + 9, 6.5], 'cover'),
      box(`${prefix}cover-northeast`, [cx + 5, cy + 7.5, 4], [cx + 8, cy + 9, 6.5], 'cover'),
      box(`${prefix}cover-south`, [cx - 2, cy - 9, 4], [cx + 2, cy - 7.5, 6.5], 'cover'),
      box(`${prefix}mass-north`, [cx - 8, y1 - 5, 4], [cx + 1, y1 - 1, 11 + site.index % 2], 'wall'),
      box(`${prefix}mass-south`, [cx - 1, y0 + 1, 4], [cx + 8, y0 + 5, 10 + site.index % 3], 'wall'),
    );
    objectiveBoundariesBySite[site.id] = {
      center: [...site.center],
      radiusM: site.radiusM,
      entranceClearanceM: 4,
      postIds: ['nw', 'ne', 'sw', 'se'].map(id => `${prefix}boundary-post-${id}`),
    };

    const high = site.highGrounds[0];
    const [hx, hy, hz] = high.center;
    geometry.push(box(
      `${prefix}high-platform`,
      [hx - 3, hy - 3, 4],
      [hx + 3, hy + 3, hz],
      'tower',
    ));
    const signX = Math.sign(hx - cx) || 1;
    const signY = Math.sign(hy - cy) || 1;
    const accessX = buildOutwardStair({
      siteId: site.id,
      accessId: 'x',
      axis: 0,
      sign: signX,
      platformCenter: [hx, hy],
      topZ: hz,
      lateralCenter: round(hy - signY * 1.7),
    });
    const accessY = buildOutwardStair({
      siteId: site.id,
      accessId: 'y',
      axis: 1,
      sign: signY,
      platformCenter: [hx, hy],
      topZ: hz,
      lateralCenter: round(hx + signX * 1.7),
    });
    geometry.push(...accessX.geometry, ...accessY.geometry);
    highGroundRoutesBySite[site.id] = {
      xAccess: accessX.route,
      yAccess: accessY.route,
    };
  }
  return { geometry, highGroundRoutesBySite, objectiveBoundariesBySite };
}

function buildOuterRing() {
  return [
    // Four pieces form a raised annulus around the untouched 92 x 68 legacy
    // core. Keeping the pieces separate avoids a slab through the old bowl.
    box('flash-ring-east-floor', [46, -92, -1], [126, 92, 4], 'slab'),
    box('flash-ring-west-floor', [-126, -92, -1], [-46, 92, 4], 'slab'),
    box('flash-ring-north-floor', [-46, 34, -1], [46, 92, 4], 'slab'),
    box('flash-ring-south-floor', [-46, -92, -1], [46, -34, 4], 'slab'),
    box('flash-core-gate-bridge-east', [43, -12.5, -1], [48, 12.5, 4], 'slab'),
    box('flash-core-gate-bridge-west', [-48, -12.5, -1], [-43, 12.5, 4], 'slab'),

    // The visual city continues beyond this hard competitive envelope.
    box('flash-perimeter-east', [126, -93, 0], [127, 93, 12], 'wall'),
    box('flash-perimeter-west', [-127, -93, 0], [-126, 93, 12], 'wall'),
    box('flash-perimeter-north', [-126, 92, 0], [126, 93, 12], 'wall'),
    box('flash-perimeter-south', [-126, -93, 0], [126, -92, 12], 'wall'),

    // The old east/west perimeter walls are replaced with a 26 m gate. This
    // preserves the legacy core everywhere except its three authored lanes.
    box('flash-core-gate-east-north', [46, 13, 0], [47, 34, 10], 'wall'),
    box('flash-core-gate-east-south', [46, -34, 0], [47, -13, 10], 'wall'),
    box('flash-core-gate-west-north', [-47, 13, 0], [-46, 34, 10], 'wall'),
    box('flash-core-gate-west-south', [-47, -34, 0], [-46, -13, 10], 'wall'),
  ];
}

export function buildOshioiFlashpointGeometry() {
  const boundsM = clone(OSHIOI_FLASHPOINT.layout.playableBoundsM);
  const sites = clone(OSHIOI_FLASHPOINT.sites);
  const siteById = Object.fromEntries(sites.map(site => [site.id, site]));
  const spawnRoomBuild = buildSpawnRooms();
  const spawnsBySite = buildSpawnsBySite(siteById, spawnRoomBuild.rooms);
  const routesBySite = buildRoutesBySite(sites, spawnsBySite);
  const outerSiteBuild = buildOuterSites(sites);
  const geometry = [
    ...buildOuterRing(),
    ...buildRails(),
    ...spawnRoomBuild.geometry,
    ...outerSiteBuild.geometry,
  ];
  return {
    boundsM,
    geometry: clone(geometry),
    solids: geometry.map(runtimeSolid),
    removeCanonicalSolidIds: [...REMOVE_CANONICAL_SOLID_IDS],
    sites,
    objectiveBoundariesBySite: outerSiteBuild.objectiveBoundariesBySite,
    spawnRooms: spawnRoomBuild.rooms,
    spawnsBySite,
    routesBySite,
    highGroundRoutesBySite: outerSiteBuild.highGroundRoutesBySite,
  };
}
