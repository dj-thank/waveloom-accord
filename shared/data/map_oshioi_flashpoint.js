// Original Kagariai five-site competitive layout.
//
// This is a gameplay authoring SSOT, not a recreation of any shipped map.
// The five-site count and rotating-objective mode are genre-level rules. Site
// coordinates, identities, route geometry, spawn policy, and landmarks below
// are original to Kagariai's tide-harbour setting.

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function routeLength(points) {
  let length = 0;
  for (let index = 1; index < points.length; index++) {
    length += Math.hypot(
      points[index][0] - points[index - 1][0],
      points[index][1] - points[index - 1][1],
      points[index][2] - points[index - 1][2],
    );
  }
  return round(length);
}

function routeFromBase(side, target, lane) {
  const east = side === 'east';
  const start = [east ? 116 : -116, 0, 4];
  const [targetX, targetY, targetZ] = target;
  const dx = targetX - start[0];
  const dy = targetY - start[1];
  const planarLength = Math.max(1, Math.hypot(dx, dy));
  const perpendicular = [-dy / planarLength, dx / planarLength];
  const amplitude = lane === 'front' ? 0 : lane === 'cloister' ? 12 : -12;
  const samples = [0, 0.16, 0.34, 0.54, 0.72, 0.87, 0.95, 1];
  return samples.map((ratio) => {
    const envelope = Math.sin(Math.PI * ratio);
    const lateral = amplitude * envelope;
    return [
      round(start[0] + dx * ratio + perpendicular[0] * lateral),
      round(start[1] + dy * ratio + perpendicular[1] * lateral),
      round(start[2] + (targetZ - start[2]) * Math.max(0, (ratio - 0.87) / 0.13)),
    ];
  });
}

const SITE_DEFINITIONS = [
  {
    id: 'shiogama',
    index: 0,
    displayName: '燈塔・塩窯',
    shortName: '塩窯',
    center: [0, 0, 2.5],
    radiusM: 7,
    heightM: 5,
    playBoundsM: { x: [-22, 22], y: [-20, 20] },
    identity: {
      landmark: '潮圧を光へ変える塩窯灯塔',
      silhouette: 'octagonal-kiln-and-square-beacon',
      materialPair: ['shell', 'basalt'],
      navigationColor: 0xf2b66d,
      coverLanguage: 'staggered-kiln-walls',
    },
    highGrounds: [
      { id: 'north-kiln-roof', center: [0, 13, 8], counterRoutes: ['east-stair', 'west-stair'] },
      { id: 'south-kiln-roof', center: [0, -13, 8], counterRoutes: ['east-stair', 'west-stair'] },
    ],
  },
  {
    id: 'mizuichi',
    index: 1,
    displayName: '浮標市場',
    shortName: '水市',
    center: [56, 44, 4],
    radiusM: 7,
    heightM: 5,
    playBoundsM: { x: [36, 76], y: [27, 61] },
    identity: {
      landmark: '吊り浮標と競り鐘',
      silhouette: 'suspended-buoy-market',
      materialPair: ['indigo', 'copper'],
      navigationColor: 0x76e6df,
      coverLanguage: 'alternating-auction-stalls',
    },
    highGrounds: [
      { id: 'auction-crane', center: [68, 50, 9], counterRoutes: ['market-ramp', 'crane-stair'] },
    ],
  },
  {
    id: 'kado',
    index: 2,
    displayName: '潮門乾ドック',
    shortName: '乾門',
    center: [56, -44, 4],
    radiusM: 7,
    heightM: 5,
    playBoundsM: { x: [36, 76], y: [-61, -27] },
    identity: {
      landmark: '二重潮門と垂直潮位計',
      silhouette: 'twin-tide-gates',
      materialPair: ['basalt', 'copper'],
      navigationColor: 0x78b7d2,
      coverLanguage: 'winches-and-dry-dock-ribs',
    },
    highGrounds: [
      { id: 'service-gantry', center: [44, -52, 8], counterRoutes: ['dock-ramp', 'gantry-stair'] },
    ],
  },
  {
    id: 'ami',
    index: 3,
    displayName: '網橋運河',
    shortName: '網橋',
    center: [-56, 44, 4],
    radiusM: 7,
    heightM: 5,
    playBoundsM: { x: [-76, -36], y: [27, 61] },
    identity: {
      landmark: '二連網橋と水門塔',
      silhouette: 'paired-net-bridges',
      materialPair: ['cedar', 'indigo'],
      navigationColor: 0x8fd7be,
      coverLanguage: 'lock-gates-and-net-racks',
    },
    highGrounds: [
      { id: 'lockhouse', center: [-44, 50, 8], counterRoutes: ['lock-ramp', 'bridge-stair'] },
    ],
  },
  {
    id: 'kazami',
    index: 4,
    displayName: '風見造船所',
    shortName: '風見',
    center: [-56, -44, 4],
    radiusM: 7,
    heightM: 5,
    playBoundsM: { x: [-76, -36], y: [-61, -27] },
    identity: {
      landmark: '三本帆柱と船殻肋骨',
      silhouette: 'three-masts-and-keel',
      materialPair: ['cedar', 'roofCopper'],
      navigationColor: 0xd9ad72,
      coverLanguage: 'keel-ribs-and-timber-stacks',
    },
    highGrounds: [
      { id: 'keel-gantry', center: [-68, -50, 9], counterRoutes: ['slipway-ramp', 'gantry-stair'] },
    ],
  },
];

const routesBySite = Object.fromEntries(SITE_DEFINITIONS.map((site) => {
  const sides = {};
  for (const side of ['east', 'west']) {
    const routes = Object.fromEntries(['front', 'cloister', 'shallows'].map((lane) => {
      const points = routeFromBase(side, site.center, lane);
      return [lane, {
        id: `${site.id}-${side}-${lane}`,
        lane,
        intent: lane === 'front'
          ? 'frontline-and-sustain'
          : lane === 'cloister'
            ? 'high-ground-off-angle'
            : 'low-profile-recontest',
        points,
        measuredLengthM: routeLength(points),
      }];
    }));
    sides[side] = routes;
  }
  return [site.id, sides];
}));

export const OSHIOI_FLASHPOINT = deepFreeze({
  schemaVersion: 1,
  id: 'oshioi-fivefold-tide-original-v1',
  mode: 'five-site-flashpoint',
  authorship: {
    origin: 'original-kagariai',
    externalRuntimeAssets: [],
    prohibitedReferenceReuse: [
      'suravasa-layout-copy',
      'suravasa-mesh-copy',
      'suravasa-texture-copy',
      'suravasa-landmark-copy',
    ],
  },
  layout: {
    playableBoundsM: { x: [-126, 126], y: [-92, 92] },
    visualBoundsM: { x: [-180, 180], y: [-140, 140] },
    topology: 'central-hub-with-four-tide-districts',
    symmetry: 'competitive-180-geometry-with-distinct-art-pairs',
    openingSiteId: 'shiogama',
    siteCount: 5,
  },
  progression: {
    pointsToWin: 3,
    transitionSec: 12,
    completedSitePolicy: 'no-repeat-in-match',
    nextSitePolicy: 'seeded-choice-from-uncompleted-with-losing-team-travel-bias',
    diagonalTransitionPolicy: 'avoid-longest-cross-map-transition-when-an-alternative-exists',
    selector: {
      version: 'tidal-draw-v1',
      maxTravelBiasWeight: 0.25,
      rngStream: 'flashpoint-selection-dedicated',
    },
    status: 'implementation-target',
  },
  spawnNetworks: {
    east: {
      base: {
        id: 'east-base',
        center: [118, 0, 4],
        exits: [[110, 0, 4], [110, 10, 4], [110, -10, 4]],
      },
      forwardNorth: {
        id: 'east-forward-north',
        center: [8, 72, 4],
        exits: [[8, 64, 4], [4, 64, 4], [12, 64, 4]],
        activation: ['ami'],
      },
      forwardSouth: {
        id: 'east-forward-south',
        center: [8, -72, 4],
        exits: [[8, -64, 4], [12, -64, 4], [4, -64, 4]],
        activation: ['kazami'],
      },
    },
    west: {
      base: {
        id: 'west-base',
        center: [-118, 0, 4],
        exits: [[-110, 0, 4], [-110, -10, 4], [-110, 10, 4]],
      },
      forwardNorth: {
        id: 'west-forward-north',
        center: [-8, 72, 4],
        exits: [[-8, 64, 4], [-12, 64, 4], [-4, 64, 4]],
        activation: ['mizuichi'],
      },
      forwardSouth: {
        id: 'west-forward-south',
        center: [-8, -72, 4],
        exits: [[-8, -64, 4], [-4, -64, 4], [-12, -64, 4]],
        activation: ['kado'],
      },
    },
  },
  sites: SITE_DEFINITIONS,
  routesBySite,
  tacticalPhases: [
    { id: 'transition', purpose: 'choose-spawn-and-route-before-point-opens' },
    { id: 'regroup', purpose: 'reassemble-around-pressure-anchor-and-recovery-provider' },
    { id: 'first-contact', purpose: 'trade-resources-without-forcing-objective-touch' },
    { id: 'pressure', purpose: 'frontline-holds-while-damage-creates-off-angle' },
    { id: 'commit', purpose: 'convert-cooldown-or-casualty-advantage-onto-point' },
    { id: 'recontest', purpose: 'short-safe-touch-route-with-disengage-option' },
  ],
  telemetryContract: {
    dimensions: [
      'buildId', 'matchId', 'round', 'activeSiteId', 'team', 'side',
      'heroId', 'role', 'botPolicyId', 'routeId', 'position', 'elevation',
    ],
    events: [
      'spawn', 'route_commit', 'first_enemy_visible', 'first_damage',
      'objective_touch', 'fight_start', 'first_casualty', 'fight_end',
      'team_wipe', 'regroup_complete', 'site_captured', 'site_transition',
    ],
    metrics: [
      'spawn_to_first_contact_sec',
      'spawn_to_objective_touch_sec',
      'fight_contact_span_sec',
      'time_to_first_casualty_sec',
      'regroup_sec',
      'two_sided_contest_sec',
      'route_share_by_role',
      'high_ground_hold_and_retake_rate',
      'site_and_side_win_rate',
      'p95_frame_ms_during_ten_player_fight',
    ],
  },
  preregisteredHypotheses: [
    {
      id: 'H-FP-01',
      statement: 'No site or route is accepted solely from visual inspection.',
      gate: 'bot mirror audit plus human 5v5 replication',
    },
    {
      id: 'H-FP-02',
      statement: 'Every objective supports a front, an off-angle, and a bounded recontest route.',
      gate: 'three capsule-safe routes per side with no direct enemy-spawn sightline',
    },
    {
      id: 'H-FP-03',
      statement: 'Site transitions must not create an unrecoverable travel advantage.',
      gate: 'counterbalanced spawn-to-contact distributions stratified by site and side',
    },
    {
      id: 'H-FP-04',
      statement: 'Decorative density must not become false cover or target-search noise.',
      gate: 'zero collision/presentation mismatch and controlled eye-height screenshot review',
    },
  ],
});

export const OSHIOI_FLASHPOINT_SITE_BY_ID = deepFreeze(Object.fromEntries(
  OSHIOI_FLASHPOINT.sites.map(site => [site.id, site]),
));

export function flashpointSite(siteId) {
  return OSHIOI_FLASHPOINT_SITE_BY_ID[String(siteId || '')] || null;
}

export function flashpointRoutes(siteId, side) {
  return OSHIOI_FLASHPOINT.routesBySite?.[siteId]?.[side] || null;
}
