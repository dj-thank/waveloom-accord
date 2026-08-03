const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
};

const ASSET_ID = 'prop-kagariai-roof-rib-01';
const SOURCE_SHA256 = '526A593493B80B371F91115916432E7C93B89795E520FA44FF0FD347625B10C7';
const PLAYABLE_BOUNDS_M = { x: [-126, 126], y: [-92, 92] };
const VISUAL_BOUNDS_M = { x: [-180, 180], y: [-140, 140] };
const RENDERER_EVIDENCE = {
  status: 'pass',
  reportPath: 'docs/evidence/AAA_ROOF_RIB_LIVE_REVIEW_EVIDENCE_20260803.json',
  reportSha256: '3778DEA513E220BA1357FF2D600FE1C1A3F47B9931535F3ED8F3D1877199B1A5',
  scene: 'production-SceneRenderer-review-only',
  views: 3,
  consoleErrors: 0,
  consoleWarnings: 0,
};

export const KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE = deepFreeze({
  schemaVersion: 1,
  assetId: ASSET_ID,
  sourceReferenceSha256: SOURCE_SHA256,
  state: 'candidate-review-open',
  enabled: false,
  collisionPolicy: 'presentation-only-no-collision',
  adoptionPolicy: 'production admission stays fail-closed until every required gate passes',
  reviewActivationPolicy: 'localhost-and-explicit-query-only; never production admission',
  playableBoundsM: PLAYABLE_BOUNDS_M,
  visualBoundsM: VISUAL_BOUNDS_M,
  perAssetBudget: { triangles: 2572, drawCalls: 5, textures: 16 },
  aggregateWorstCaseBudget: { triangles: 7716, drawCalls: 15, textures: 16 },
  rendererEvidence: RENDERER_EVIDENCE,
  placements: [
    {
      id: 'north-roof-rib-west',
      position: [-95.55, 103, 39.3],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      finial: 'left',
      semantics: 'outside-playable-bounds',
      support: { layerId: 'district-hip-roofs', transformIndex: 0, supportTopZ: 39.3 },
    },
    {
      id: 'north-roof-rib-mid',
      position: [-26.95, 103, 32.8],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      finial: 'none',
      semantics: 'outside-playable-bounds',
      support: { layerId: 'district-hip-roofs', transformIndex: 2, supportTopZ: 32.8 },
    },
    {
      id: 'north-roof-rib-east',
      position: [46.55, 103, 47.8],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      finial: 'right',
      semantics: 'outside-playable-bounds',
      support: { layerId: 'district-hip-roofs', transformIndex: 4, supportTopZ: 47.8 },
    },
  ],
  gates: {
    sourceProvenance: 'pass',
    strictSculptSpec: 'pass',
    browserLookDev: 'pass',
    collisionDigest: 'pass',
    disposalLifecycle: 'pass',
    humanArt: 'pending',
    competitiveSafety: 'pending',
    runtimeRenderer: 'pass',
  },
});

function collectIntegrityBlockers(candidate) {
  const blockers = [];
  if (candidate.schemaVersion !== 1) blockers.push('schemaVersion');
  if (candidate.assetId !== ASSET_ID) blockers.push('assetId');
  if (candidate.sourceReferenceSha256 !== SOURCE_SHA256) blockers.push('sourceReferenceSha256');
  if (candidate.collisionPolicy !== 'presentation-only-no-collision') blockers.push('collisionPolicy');
  for (const gate of [
    'sourceProvenance',
    'strictSculptSpec',
    'browserLookDev',
    'collisionDigest',
    'disposalLifecycle',
  ]) {
    if (candidate.gates?.[gate] !== 'pass') blockers.push(`gate:${gate}`);
  }
  const rendererEvidenceValid = Object.entries(RENDERER_EVIDENCE)
    .every(([key, expected]) => candidate.rendererEvidence?.[key] === expected);
  if (candidate.gates?.runtimeRenderer === 'pass' && !rendererEvidenceValid) {
    blockers.push('rendererEvidence');
  }
  const placementIds = new Set();
  const placements = Array.isArray(candidate.placements) ? candidate.placements : [];
  for (const placement of placements) {
    const placementId = typeof placement?.id === 'string' && placement.id ? placement.id : 'unknown';
    if (placementIds.has(placementId)) blockers.push(`placement:${placementId}:duplicate`);
    placementIds.add(placementId);
    const transformValid = [placement.position, placement.rotation, placement.scale]
      .every(vector => Array.isArray(vector) && vector.length === 3 && vector.every(Number.isFinite))
      && placement.scale.every(value => value > 0);
    if (!transformValid) {
      blockers.push(`placement:${placementId}:transform`);
      continue;
    }
    const [x, y] = placement.position;
    const outsidePlayable = x < PLAYABLE_BOUNDS_M.x[0] || x > PLAYABLE_BOUNDS_M.x[1]
      || y < PLAYABLE_BOUNDS_M.y[0] || y > PLAYABLE_BOUNDS_M.y[1];
    const insideVisual = x >= VISUAL_BOUNDS_M.x[0] && x <= VISUAL_BOUNDS_M.x[1]
      && y >= VISUAL_BOUNDS_M.y[0] && y <= VISUAL_BOUNDS_M.y[1];
    if (!outsidePlayable || !insideVisual || placement.semantics !== 'outside-playable-bounds') {
      blockers.push(`placement:${placementId}:competitive-envelope`);
    }
    if (!['left', 'right', 'none'].includes(placement.finial)) blockers.push(`placement:${placementId}:finial`);
  }
  if (placements.length === 0) blockers.push('placements');
  return blockers;
}

export function createKagariaiRoofRibReviewAdmission() {
  const review = JSON.parse(JSON.stringify(KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE));
  review.state = 'review-only';
  review.enabled = false;
  review.reviewOnly = true;
  return deepFreeze(review);
}

export function assertKagariaiRoofRibReviewAdmission(candidate) {
  const blockers = [];
  if (candidate?.state !== 'review-only') blockers.push('state');
  if (candidate?.enabled !== false) blockers.push('enabled');
  if (candidate?.reviewOnly !== true) blockers.push('reviewOnly');
  blockers.push(...collectIntegrityBlockers(candidate || {}));
  if (blockers.length > 0) {
    throw new Error(`ROOF_RIB_REVIEW_ADMISSION_BLOCKED:${blockers.join(',')}`);
  }
  return true;
}

export function assertKagariaiRoofRibRuntimeAdmission(candidate = KAGARIAI_ROOF_RIB_RUNTIME_CANDIDATE) {
  const blockers = [];
  if (candidate.enabled !== true) blockers.push('enabled');
  if (candidate.state !== 'runtime-admitted') blockers.push('state');
  blockers.push(...collectIntegrityBlockers(candidate));
  for (const gate of ['humanArt', 'competitiveSafety', 'runtimeRenderer']) {
    if (candidate.gates?.[gate] !== 'pass') blockers.push(gate);
  }
  if (blockers.length > 0) {
    throw new Error(`ROOF_RIB_RUNTIME_ADMISSION_BLOCKED:${blockers.join(',')}`);
  }
  return true;
}
