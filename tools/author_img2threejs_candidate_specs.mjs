import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

// Reproducible authoring pass for the two new image-to-Three.js candidates.
// This intentionally stops at strict spec validation: no browser render or runtime admission is implied.

const ROOT = 'C:/Users/rambo/projects/kagariai-props';
const PILOT = path.join(ROOT, 'work/asset-rush/aaa-v1-pilot');
const IMG2 = path.join(PILOT, 'img2threejs');

const rgba = (hex, alpha = '1.0') => {
  const value = hex.replace('#', '');
  const rgb = value.length === 3
    ? value.split('').map((c) => parseInt(c + c, 16))
    : [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16));
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
};

const clone = (value) => JSON.parse(JSON.stringify(value));

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function pbrReference(report, sourceImage) {
  return {
    version: 'reference-pbr-evidence-v1',
    sourceImage,
    extractor: 'forge/stage1_intake/extract_pbr_evidence.py',
    method: 'candidate four-view sheet pixel extraction; shared source evidence for early procedural materials',
    usable: true,
    verdict: report.verdict,
    confidence: report.confidence,
    estimatedFidelity: report.estimatedFidelity,
    targetThreshold: report.targetThreshold,
    hardLimit: 'Reference-derived inference only; shared maps do not prove per-material inverse rendering. Neutral and grazing browser renders remain required.',
    maps: report.maps,
  };
}

function material({ id, name, baseColor, palette, materialClass, roughness, metalness, report, sourceImage, overrides, wear, dirt, notes }) {
  const map = (channel) => report.maps[channel]?.url || report.maps[channel]?.path || `pbr-evidence/reference-surface_${channel}.png`;
  return {
    id,
    name,
    type: 'physical',
    qualityTier: 'hero',
    shaderModel: 'MeshPhysicalMaterial dielectric/metallic PBR approximation',
    baseColor,
    color: baseColor,
    albedo: {
      dominant: baseColor,
      secondary: palette.slice(1),
      samplingNotes: 'Palette is extracted from the user-owned candidate sheet; treat it as reference evidence, not a baked final texture.',
    },
    colorVariation: {
      palette,
      pattern: materialClass === 'fabric' ? 'directional weave-and-weathering breakup' : 'localized value and hue variation by exposure and cavity',
      amplitude: 0.14,
      heightCorrelation: 0.22,
    },
    textureResolution: 1024,
    textureProjection: {
      mode: 'uv with object-space fallback',
      repeat: [1, 1],
      anisotropy: 8,
      texelDensityIntent: 'Keep world-scale detail stable across all components; do not stretch shared evidence maps per part.',
    },
    surfaceFrequencyBands: [
      { id: 'macro', frequency: 1.5, amplitude: 0.16, role: 'broad color and weathering breakup' },
      { id: 'meso', frequency: 10, amplitude: 0.065, role: 'seams, dents, weave, patina, or shallow relief' },
      { id: 'micro', frequency: 52, amplitude: 0.022, role: 'grazing-light highlight breakup' },
    ],
    roughness: {
      base: roughness,
      variation: 0.16,
      map: map('roughness'),
      localResponse: 'Cavities and accumulated dirt are rougher; worn edges and handled metal are lower roughness.',
    },
    metalness: { base: metalness, variation: metalness > 0 ? 0.08 : 0.0 },
    normal: {
      pattern: 'reference-derived independent height-gradient normal',
      strength: materialClass === 'fabric' ? 0.24 : 0.19,
      scale: 24,
      map: map('normal'),
      heightSource: map('height'),
      space: 'tangent',
    },
    bump: { pattern: 'reference-derived independent height field', amplitude: 0.018, scale: 1, map: map('height') },
    displacement: {
      pattern: 'geometry for silhouette-affecting folds, bevels, chips, and fasteners; map for sub-silhouette relief',
      amplitude: 0.008,
      scale: 1,
      silhouetteAffects: false,
    },
    ambientOcclusion: {
      cavityStrength: 0.36,
      contactShadowBias: 0.32,
      map: map('ao'),
      notes: 'Independent AO response for seams, overlaps, sockets, and ground contact.',
    },
    wear: wear || { edgeWear: 0.08, scratches: [], chips: [] },
    dirt: dirt || { amount: 0.12, cavityBias: 0.28, color: '#332F29' },
    localOverrides: overrides,
    referencePbr: pbrReference(report, sourceImage),
    shaderNotes: [
      'Keep albedo, roughness, height/normal, and AO independent; never alias albedo into another PBR channel.',
      'Use geometry for raised fasteners, hems, folds, collars, and chips that affect the silhouette.',
      'This candidate remains presentation-only until render review proves material readability under neutral and grazing light.',
    ],
    notes,
  };
}

function attachment(parentId, socket, localStart = [0, 0, 0], localEnd = [0, 0.1, 0], contactType = 'overlap') {
  return {
    parentId,
    parentSocket: socket,
    localStart,
    localEnd,
    contactType,
    embedDepth: 0.025,
    overlap: 0.025,
    gapTolerance: 0.005,
    contactNormal: [0, 1, 0],
    evidenceRefs: ['full-object'],
  };
}

function component({
  id,
  name,
  level,
  role,
  primitive,
  topologyClass,
  topologyRationale,
  material,
  dimensions,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  parent = null,
  socket = `${id}-socket`,
  localStart = [0, 0, 0],
  localEnd = [0, 0.1, 0],
  localFeatures = [],
  evidenceRefs = ['full-object'],
  materialClass,
  dominantAlbedo,
  secondaryAlbedo,
  primitiveNotes,
}) {
  const attached = parent ? attachment(parent, socket, localStart, localEnd, role === 'cable' ? 'tension' : 'overlap') : null;
  const classColor = dominantAlbedo || '#8A8171';
  return {
    id,
    name,
    level,
    role,
    importance: level === 'macro' ? 1.0 : level === 'meso' ? 0.82 : 0.62,
    confidence: 0.82,
    primitive,
    topologyClass,
    topologyRationale,
    geometryDescriptor: {
      topologyIntent: primitiveNotes || `Explicit ${primitive} volume preserving the observed ${name.toLowerCase()} silhouette.`,
      edgeTreatment: { type: level === 'micro' ? 'small-bevel' : 'bevel', bevelRadius: level === 'micro' ? 0.008 : 0.02, segments: 1 },
      deformationStack: level === 'macro' ? ['deterministic low-amplitude asymmetry below silhouette threshold'] : [],
      uvStrategy: 'stable object-space scale with generated procedural coordinates',
      normalStrategy: 'smooth normals with weighted bevel normals where appropriate',
    },
    parent,
    attachment: attached,
    dimensions: { ...dimensions, units: 'world', confidence: 0.82 },
    transform: { position, rotation, scale: [1, 1, 1] },
    actionProfile: {
      animationRole: parent ? (role === 'cable' ? 'tension-line' : 'attached-static') : 'root',
      pivot: { mode: parent ? 'parent-socket' : 'center', localPosition: [0, 0, 0], axis: [0, 1, 0], confidence: 0.82 },
      transformChannels: { translate: true, rotate: true, scale: true, bend: role === 'cable', twist: role === 'cable', detach: false, visibility: true, materialState: true },
      sockets: [{ id: socket, localPosition: [0, 0, 0], axis: [0, 1, 0], notes: 'Candidate attachment socket; verify against browser render.' }],
      collider: { type: 'none', offset: [0, 0, 0], scale: [0, 0, 0], isTrigger: false, notes: 'Presentation-only candidate; do not add gameplay collision or cover without a separate safety review.' },
      constraints: ['Keep all parts within the authored envelope; no climbable or body-height cover behavior.'],
      destruction: { breakable: false, fractureGroup: `${id}-static`, seamRefs: [], detachableFragments: [], breakImpulse: 0, debrisMaterial: material },
    },
    material,
    materialLayers: [material],
    colorMaterialRecipe: {
      dominantAlbedo: rgba(classColor),
      secondaryAlbedo: rgba(secondaryAlbedo || classColor),
      materialClass: materialClass || 'unknown',
      materialClassConfidence: 0.82,
    },
    deformations: [],
    joints: [],
    seams: parent ? [`${parent}-to-${id}-overlap`] : [],
    localFeatures,
    surfaceDetail: {
      macroRoughness: 0.72,
      microRoughness: 0.18,
      bumpAmplitude: 0.02,
      normalPattern: 'independent reference-derived normal evidence',
      displacementPattern: 'geometry-first for silhouette-affecting features',
      occlusionPattern: 'contact and cavity AO at all overlaps',
      edgeWearPattern: 'exposed perimeter and handling points',
      notes: 'Candidate-only until neutral/grazing browser captures exist.',
    },
    evidenceRefs,
    details: localFeatures.map((feature) => typeof feature === 'string' ? feature : feature.id),
    fidelityTier: 'candidate-spec',
  };
}

function viewEvidence(observations) {
  return [
    { id: 'full-object', view: 'full four-view reference sheet', imageRegion: { x: 0, y: 0, width: 1, height: 1, units: 'normalized' }, observations: observations.full, confidence: 0.83 },
    { id: 'front', view: 'front/hero panel', imageRegion: { x: 0.02, y: 0.08, width: 0.46, height: 0.82, units: 'normalized' }, observations: observations.front, confidence: 0.78 },
    { id: 'three-quarter', view: 'three-quarter/side panel', imageRegion: { x: 0.52, y: 0.08, width: 0.46, height: 0.82, units: 'normalized' }, observations: observations.threeQuarter, confidence: 0.78 },
    { id: 'rear-side', view: 'rear-side panel', imageRegion: { x: 0.02, y: 0.08, width: 0.46, height: 0.82, units: 'normalized' }, observations: observations.rear, confidence: 0.68 },
    { id: 'top-clearance', view: 'top/clearance inspection', imageRegion: { x: 0.52, y: 0.08, width: 0.46, height: 0.82, units: 'normalized' }, observations: observations.top, confidence: 0.65 },
  ];
}

function buildPasses(componentRefs) {
  return [
    { id: 'blockout', goal: 'Match the authored envelope, primary silhouette, and negative spaces before material polish.', componentRefs, acceptance: ['Envelope dimensions match the safety policy.', 'Silhouette and clearance read from front and three-quarter views.'] },
    { id: 'structural-pass', goal: 'Build the explicit parent-child hierarchy, seam overlaps, sockets, and repeated hardware.', componentRefs, acceptance: ['Every attached part has parent socket/local endpoints/overlap/gap tolerance.', 'No nearby parts create body-height fake cover.'] },
    { id: 'form-refinement', goal: 'Add bevels, folds, tapers, collar transitions, and controlled asymmetry.', componentRefs, acceptance: ['No flat-card bias from orbit views.', 'Silhouette-affecting folds and chips are geometry, not color-only.'] },
    { id: 'material-pass', goal: 'Apply independent albedo, roughness, normal/height, AO, wear, and local overrides.', componentRefs, acceptance: ['All hero materials have independent map evidence and local masks.', 'Reference-derived confidence remains at or above 0.7.'] },
    { id: 'surface-pass', goal: 'Expose meso/micro identity details such as seams, stitch/fastener rhythm, patina, and stains.', componentRefs, acceptance: ['Detail inventory is fully linked to components or material overrides.', 'No single-frequency noise substitutes for authored details.'] },
    { id: 'lighting-pass', goal: 'Match key/fill/rim intent while preserving material readability under neutral and grazing light.', componentRefs, acceptance: ['Neutral, grazing, and reference-matched captures are recorded.', 'Exposure, tone mapping, background, and contact shadow are explicit.'] },
    { id: 'interaction-pass', goal: 'Verify presentation-only placement, clearance, sockets, and safety constraints in the real map.', componentRefs, acceptance: ['No collision or climb affordance is introduced.', 'Fake-cover cluster and sightline checks pass.'] },
    { id: 'optimization-pass', goal: 'Meet the candidate triangle/draw-call budget without losing identity-defining features.', componentRefs, acceptance: ['Near/far LOD plan is measured in the renderer.', 'No candidate is runtime-admitted without independent visual and safety gates.'] },
  ];
}

const sharedQualityContract = (name, minimumSpecDepth, evidenceIds) => ({
  qualityBar: 'AAA-candidate reference-fidelity spec; browser and human review still required',
  definitionOfDone: [
    `The ${name} candidate matches the reference sheet silhouette, explicit component hierarchy, material response, and linked identity details at the selected fidelity tier.`,
    'Strict sculpt-spec validation passes with no quality warnings.',
    'Browser renders prove neutral, grazing, reference-matched, and orbit-view readability before any runtime admission.',
    'Safety audit proves the asset remains presentation-only and cannot create uncollidable body-height cover.',
  ],
  minimumSpecDepth,
  featureGroups: [
    { id: 'silhouette-system', name: 'Silhouette and negative-space system', required: true, qualityCriteria: ['Envelope, dominant curves, negative spaces, and clearance are explicit.'], evidenceRefs: evidenceIds, failureModes: ['Generic placeholder silhouette', 'Unmeasured envelope drift'] },
    { id: 'component-hierarchy', name: 'Component hierarchy and attachment system', required: true, qualityCriteria: ['Major parts, sockets, seams, overlaps, and repeated hardware are explicit.'], evidenceRefs: evidenceIds, failureModes: ['Merged visible parts', 'Floating or centered child parts'] },
    { id: 'surface-response', name: 'Surface material and local response', required: true, qualityCriteria: ['Independent PBR evidence, macro/meso/micro bands, wear, dirt, and local overrides are explicit.'], evidenceRefs: evidenceIds, failureModes: ['Flat plastic response', 'Prose-only detail claims'] },
    { id: 'lighting-readability', name: 'Lighting and camera readability', required: true, qualityCriteria: ['Key/fill/rim, exposure, tone mapping, background, and contact shadow behavior are explicit.'], evidenceRefs: evidenceIds, failureModes: ['Ambient-only lighting', 'Unreadable material under relight'] },
  ],
  visualDeltaChecks: ['silhouette and clearance delta', 'component hierarchy depth delta', 'repetition density delta', 'material albedo/roughness/normal response delta', 'local feature placement delta'],
  antiShallowSpecRules: [
    'Do not proceed to code if the quality bar is unassessed.',
    'Do not proceed to browser render if any attached child lacks socket, endpoints, overlap, and gap tolerance.',
    'Do not pass material look-dev when albedo is reused as roughness, height, normal, or AO.',
    'Do not satisfy raised relief or fasteners with a map alone when the feature affects form.',
    'Do not admit the candidate to runtime until safety and renderer evidence are independently recorded.',
  ],
  mustNotDo: [
    'No alpha fringe stack, billboard shell, or hidden collision may be used to fake the authored volume.',
    'No nearby-cladding cluster may become body-height cover without collision.',
    'No exact PBR or AAA completion claim may be made from extraction alone.',
  ],
});

function target(id, name, tier, passIds, componentRefs, evidenceRefs) {
  return { id, name, tier, passIds, minimumScore: tier === 'critical' ? 0.82 : 0.7, mustPass: tier === 'critical', componentRefs, evidenceRefs };
}

function detail(id, kind, description, scale, affects, ref, evidenceRef, region) {
  return {
    id,
    kind,
    description,
    region: { ...region, units: 'normalized' },
    scale,
    affects,
    mapsTo: { type: ref.includes('/') ? 'component.localFeatures' : 'material.localOverrides', ref },
    evidenceRef,
    confidence: 0.76,
  };
}

function baseSpec(spec, config, report, sourceImage) {
  const evidenceIds = ['full-object', 'front', 'three-quarter', 'rear-side', 'top-clearance'];
  const componentRefs = config.components.map((item) => item.id);
  spec.suitability = 'conditional';
  spec.sourceImage = sourceImage;
  spec.preSpecAssessment = {
    ...spec.preSpecAssessment,
    objectClass: {
      primaryType: config.primaryType,
      primaryDomain: 'object',
      formLanguage: config.formLanguage,
      structureKind: config.structureKind,
      motionPotential: config.motionPotential,
      materialFamilies: config.materialFamilies,
      notes: 'Authored from direct visual inspection of the local four-view candidate sheet. Hidden backsides remain implementation assumptions.',
    },
    complexity: {
      tier: 'moderate',
      scores: config.complexityScores,
      estimatedCounts: config.estimatedCounts,
      reasoning: config.complexityReasoning,
    },
    specDepthDecision: {
      requiredDepth: 'moderate',
      minimumComponentLevels: ['macro', 'meso', 'micro'],
      needsRepetitionSystems: true,
      needsMaterialLocalOverrides: true,
      needsMultipleReviewViews: true,
      needsActionReadyHierarchy: true,
      rationale: 'Visible supports, seams, repeated hardware, and material boundaries require a multi-level candidate spec before code generation.',
    },
    unknownsToResolveBeforeImplementation: [],
    detailInventory: {
      scanMethod: 'grid-3x3 plus direct four-view inspection',
      targetMinDetails: config.details.length,
      note: 'Every listed detail is linked to a component.localFeatures or material.localOverrides entry. Add new entries if browser review exposes a missing identity feature.',
      details: config.details,
    },
  };
  spec.componentTree = config.components;
  spec.materials = config.materials;
  spec.repetitionSystems = config.repetitionSystems;
  spec.viewEvidence = viewEvidence(config.observations);
  spec.buildPasses = buildPasses(componentRefs);
  spec.featureReviewTargets = config.featureReviewTargets;
  spec.qualityContract = sharedQualityContract(config.name, {
    macroComponents: 2,
    mesoComponents: 3,
    microFeatureGroups: config.microMinimum,
    materialLayers: config.materials.length,
    repetitionSystems: config.repetitionSystems.length,
    reviewViewpoints: evidenceIds.length,
  }, evidenceIds);
  spec.qualityTargets = {
    targetFidelity: 0.82,
    mustMatch: ['macro silhouette and envelope', 'primary material albedo/roughness response', 'linked local identity details', 'presentation-only safety placement'],
    niceToHave: ['micro stains/chips after neutral and grazing review', 'secondary lighting match', 'far-LOD merge'],
    fpsTarget: 60,
    reviewViewpoints: ['front', 'three-quarter', 'rear-side', 'top-clearance', 'orbit'],
  };
  spec.sculptPipeline = {
    passGateMode: 'locked-sequential',
    passOrder: ['blockout', 'structural-pass', 'form-refinement', 'material-pass', 'surface-pass', 'lighting-pass', 'interaction-pass', 'optimization-pass'],
    currentPass: 'blockout',
    completedPasses: [],
    lastCompletedPass: null,
    blockedReason: 'Awaiting browser-generated neutral/grazing/reference-matched captures; strict spec is authored but no render pass is claimed.',
    nextRequiredEvidence: ['browser neutral render', 'browser grazing-light render', 'reference-matched comparison sheet', 'orbit silhouette capture', 'safety/fake-cover cluster audit'],
  };
  spec.lightingFromPhoto = [
    { id: 'key-light', type: 'key light', direction: [-0.35, 0.82, 0.42], intensity: 1.0, notes: 'Warm directional key from the reference sheet; preserve readable edge gradients.' },
    { id: 'fill-light', type: 'fill light', direction: [0.62, 0.35, -0.48], intensity: 0.42, notes: 'Cool low-intensity fill keeps shadow-side structure legible.' },
    { id: 'rim-environment', type: 'rim or environment light', direction: [0.0, 0.55, -0.82], intensity: 0.35, notes: 'Neutral environment/rim separates the silhouette from the gray source background.' },
    { id: 'exposure-tone', type: 'exposure and tone mapping', exposure: 0.0, toneMapping: 'ACESFilmic', notes: 'Lock exposure before comparing material response.' },
    { id: 'contact-shadow', type: 'contact shadow', notes: 'Use grounded contact shadow/AO at every socket, overlap, and host-roof contact; do not use shadow to create gameplay cover.' },
  ];
  spec.performanceBudget = {
    qualityPriority: 'reference-fidelity',
    targetTriangles: config.triangleBudget,
    maxDrawCalls: config.drawCallBudget,
    textureSize: 1024,
    fpsTarget: 60,
    optimizationPolicy: 'Keep silhouette-affecting geometry and identity details; merge only static far-LOD parts after renderer measurement.',
  };
  spec.actionReadiness = {
    contract: 'presentation-only prop; transformable for placement but never a gameplay collider or cover volume',
    defaultRigType: 'static-hierarchy',
    rootMotionNode: 'root',
    requiredComponentFields: ['parent', 'attachment', 'dimensions', 'transform', 'actionProfile', 'materialLayers', 'evidenceRefs'],
    transformChannels: ['translate', 'rotate', 'scale', 'visibility', 'materialState'],
    authoringRules: ['Use local sockets and overlap contracts.', 'Keep the authored envelope and host clearance.', 'Never add collision to make an uncollidable cover cluster appear safe.'],
    destructionPolicy: { enabled: false, notes: 'No destruction or cover gameplay is authored in this candidate pass.' },
  };
  spec.silhouette = config.silhouette;
  spec.risks = config.risks;
  spec.reviewHistory = [];
  spec.visualEvidence = [];
  spec.scores = { silhouette: 2, structure: 2, materials: 2, safety: 2, renderer: 0 };
  spec.candidateStatus = {
    state: 'strict-spec-authored-browser-render-pending',
    admission: 'NOT_RUNTIME_ADMITTED',
    limitations: ['PBR maps are reference-derived shared evidence.', 'No browser render or human visual review has been recorded for these candidates.', 'Safety policy is authored but still needs real-map placement audit.'],
  };
  spec.authoringEvidence = {
    sourceImage,
    pbrReport: path.relative(ROOT, config.pbrReport).replaceAll('\\', '/'),
    pbrConfidence: report.confidence,
    pbrVerdict: report.verdict,
    sourceHash: config.sourceHash,
  };
  return spec;
}

const awningSource = path.join(PILOT, 'image-candidates/prop-market-awning-01-v1.png');
const awningDir = path.join(IMG2, 'prop-market-awning-01');
const awningReportPath = path.join(awningDir, 'pbr-evidence-report.json');
const awningPbr = await readJson(awningReportPath);
const awningDetails = [
  detail('canopy-hem-linework', 'linework', 'Double folded front hem creates the dark horizontal identity line and must remain geometry or a seam mask.', 'meso', 'silhouette and material break', 'canopy-panel/canopy-hem-linework', 'front', { x: 0.02, y: 0.5, width: 0.46, height: 0.16 }),
  detail('canopy-fold-groove', 'groove', 'Two shallow tension folds run from the upper frame toward the front hem.', 'meso', 'highlight breakup and cloth sag', 'canvas-fabric/canopy-fold-groove', 'three-quarter', { x: 0.52, y: 0.2, width: 0.46, height: 0.35 }),
  detail('post-bevel', 'bevel', 'Rounded exposed timber post edges prevent a square placeholder read.', 'meso', 'silhouette and edge highlight', 'left-post/post-bevel', 'front', { x: 0.02, y: 0.08, width: 0.46, height: 0.82 }),
  detail('ring-gloss', 'gloss', 'Worn bronze tension rings catch a controlled lower-roughness highlight.', 'micro', 'material response', 'oxidized-bronze/ring-gloss', 'three-quarter', { x: 0.52, y: 0.45, width: 0.46, height: 0.3 }),
  detail('ring-fastener-rhythm', 'fastener', 'Paired ring/bolt rhythm repeats symmetrically but not as a body-height barrier.', 'micro', 'repetition and attachment', 'fastener-cluster/fastener-spacing', 'front', { x: 0.02, y: 0.4, width: 0.46, height: 0.3 }),
  detail('cord-seam', 'seam', 'Thin tension cords terminate at the ring sockets with a visible overlap.', 'micro', 'attachment and tension', 'left-cord/cord-seam', 'three-quarter', { x: 0.52, y: 0.35, width: 0.46, height: 0.4 }),
  detail('timber-stain', 'stain', 'Lower timber receives darker moisture staining and cavity dirt.', 'micro', 'local material variation', 'weathered-timber/lower-moisture-stain', 'rear-side', { x: 0.02, y: 0.55, width: 0.46, height: 0.28 }),
  detail('fabric-stitch', 'stitch', 'Short stitch/hem marks break the fabric edge without alpha fringe stacking.', 'micro', 'surface identity', 'canvas-fabric/fabric-stitch', 'front', { x: 0.02, y: 0.47, width: 0.46, height: 0.18 }),
];

const awningComponents = [
  component({ id: 'awning-root', name: 'Market awning authored envelope', level: 'macro', role: 'root', primitive: 'box', topologyClass: 'assembled-solid', topologyRationale: 'The safety envelope is a rectangular host volume around the timber frame and cloth canopy, not a gameplay collider.', material: 'weathered-timber', dimensions: { width: 2.8, height: 2.55, depth: 0.55 }, localFeatures: [{ id: 'envelope-clearance', type: 'safety-envelope', evidenceRefs: ['front', 'top-clearance'], notes: 'Keep the 2.8 x .55 x 2.55 m presentation-only envelope.' }], evidenceRefs: ['full-object', 'front', 'top-clearance'], materialClass: 'wood', dominantAlbedo: '#6E614B', secondaryAlbedo: '#A08F70', primitiveNotes: 'Explicit host envelope for the market awning; no collision and no free-standing lane cover.' }),
  component({ id: 'canopy-panel', name: 'Weathered fabric canopy panel', level: 'macro', role: 'body', primitive: 'extrude', topologyClass: 'conforming-shell', topologyRationale: 'A shallow extruded cloth shell preserves the visible canopy plane, folded front hem, and underside clearance without a billboard-only shortcut.', material: 'canvas-fabric', dimensions: { width: 2.8, height: 0.12, depth: 0.55 }, parent: 'awning-root', socket: 'awning-root-canopy-socket', localStart: [0, 1.9, 0], localEnd: [0, 2.2, 0], localFeatures: [{ id: 'canopy-hem-linework', type: 'folded-front-hem', evidenceRefs: ['front'], notes: 'Geometry-first hem; no stacked alpha fringe.' }, { id: 'canopy-fold-groove', type: 'tension-fold', evidenceRefs: ['three-quarter'], notes: 'Two shallow folds only; avoid noisy cloth displacement.' }, { id: 'fabric-stitch', type: 'stitch-line', evidenceRefs: ['front'], notes: 'Use a small instanced stitch strip or material local override.' }], evidenceRefs: ['full-object', 'front', 'three-quarter', 'top-clearance'], materialClass: 'fabric', dominantAlbedo: '#9DA59C', secondaryAlbedo: '#7C7C6F', primitiveNotes: 'One contiguous cloth panel with a controlled sag and folded hem; canopy underside remains above the authored 2.20 m clearance.' }),
  component({ id: 'left-post', name: 'Left weathered timber support', level: 'meso', role: 'support', primitive: 'cylinder', topologyClass: 'assembled-solid', topologyRationale: 'A low-segment rounded timber support is a separate visible structural member attached to the envelope frame.', material: 'weathered-timber', dimensions: { radius: 0.07, height: 2.45, depth: 0.14 }, position: [-1.25, 1.18, 0], parent: 'awning-root', socket: 'awning-root-left-post-socket', localStart: [-1.25, 0.05, 0], localEnd: [-1.25, 2.45, 0], localFeatures: [{ id: 'post-bevel', type: 'exposed-edge-bevel', evidenceRefs: ['front'], notes: 'One-segment bevel preserves a hand-worked edge without overdraw.' }, { id: 'lower-moisture-stain', type: 'localized-stain', evidenceRefs: ['rear-side'], notes: 'Darker lower third only.' }], evidenceRefs: ['full-object', 'front', 'rear-side'], materialClass: 'wood', dominantAlbedo: '#6E614B', secondaryAlbedo: '#4A4438' }),
  component({ id: 'right-post', name: 'Right weathered timber support', level: 'meso', role: 'support', primitive: 'cylinder', topologyClass: 'assembled-solid', topologyRationale: 'The paired right support mirrors the left support while allowing a small deterministic rotation offset for hand-built asymmetry.', material: 'weathered-timber', dimensions: { radius: 0.07, height: 2.45, depth: 0.14 }, position: [1.25, 1.18, 0], rotation: [0, 0.015, 0], parent: 'awning-root', socket: 'awning-root-right-post-socket', localStart: [1.25, 0.05, 0], localEnd: [1.25, 2.45, 0], localFeatures: [{ id: 'post-bevel-right', type: 'exposed-edge-bevel', evidenceRefs: ['front'], notes: 'Same bevel family as left post, slightly different wear seed.' }], evidenceRefs: ['full-object', 'front', 'three-quarter'], materialClass: 'wood', dominantAlbedo: '#6E614B', secondaryAlbedo: '#4A4438' }),
  component({ id: 'front-hem', name: 'Front hem cord and folded edge', level: 'meso', role: 'support', primitive: 'tube', topologyClass: 'fiber-strand', topologyRationale: 'A shallow tube follows the hem curve and carries the cloth edge highlight without a flat texture-only line.', material: 'canvas-fabric', dimensions: { radius: 0.018, length: 2.65 }, position: [0, 1.98, 0.28], parent: 'canopy-panel', socket: 'canopy-panel-front-hem-socket', localStart: [-1.3, 0, 0], localEnd: [1.3, 0, 0], localFeatures: [{ id: 'hem-contact-shadow', type: 'seam-shadow', evidenceRefs: ['front'], notes: 'Use AO/contact response at the folded hem.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'fabric', dominantAlbedo: '#7C7C6F', secondaryAlbedo: '#4A4438' }),
  component({ id: 'left-tension-ring', name: 'Left oxidized bronze tension ring', level: 'micro', role: 'connector', primitive: 'torus', topologyClass: 'assembled-solid', topologyRationale: 'A torus captures the visible ring opening and catches the localized worn-metal highlight.', material: 'oxidized-bronze', dimensions: { radius: 0.075, depth: 0.018 }, position: [-1.15, 1.85, 0.3], parent: 'canopy-panel', socket: 'canopy-panel-left-ring-socket', localStart: [0, 0, 0], localEnd: [0, 0.02, 0], localFeatures: [{ id: 'ring-gloss', type: 'worn-highlight', evidenceRefs: ['three-quarter'], notes: 'Lower roughness only on exposed outer arc.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#6B6652', secondaryAlbedo: '#A18B5C' }),
  component({ id: 'right-tension-ring', name: 'Right oxidized bronze tension ring', level: 'micro', role: 'connector', primitive: 'torus', topologyClass: 'assembled-solid', topologyRationale: 'A paired torus repeats the visible tension hardware while preserving a clear gap to the body-height lane.', material: 'oxidized-bronze', dimensions: { radius: 0.075, depth: 0.018 }, position: [1.15, 1.85, 0.3], parent: 'canopy-panel', socket: 'canopy-panel-right-ring-socket', localStart: [0, 0, 0], localEnd: [0, 0.02, 0], localFeatures: [{ id: 'ring-gloss-right', type: 'worn-highlight', evidenceRefs: ['three-quarter'], notes: 'Same family with a deterministic patina offset.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#6B6652', secondaryAlbedo: '#A18B5C' }),
  component({ id: 'left-cord', name: 'Left tension cord', level: 'micro', role: 'cable', primitive: 'curve-sweep', topologyClass: 'fiber-strand', topologyRationale: 'A curve sweep follows the tension path from ring to support; a flat card would lose the cord silhouette in orbit.', material: 'canvas-fabric', dimensions: { radius: 0.012, length: 0.6 }, position: [-1.15, 1.8, 0.3], parent: 'canopy-panel', socket: 'canopy-panel-left-cord-socket', localStart: [0, 0, 0], localEnd: [-0.1, -0.55, 0], localFeatures: [{ id: 'cord-seam', type: 'termination-seam', evidenceRefs: ['three-quarter'], notes: 'Keep the cord visibly seated at the ring and post.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'fabric', dominantAlbedo: '#4A4438', secondaryAlbedo: '#696355' }),
  component({ id: 'right-cord', name: 'Right tension cord', level: 'micro', role: 'cable', primitive: 'curve-sweep', topologyClass: 'fiber-strand', topologyRationale: 'The paired curve sweep preserves the mirrored tension line without creating a solid cover cluster.', material: 'canvas-fabric', dimensions: { radius: 0.012, length: 0.6 }, position: [1.15, 1.8, 0.3], parent: 'canopy-panel', socket: 'canopy-panel-right-cord-socket', localStart: [0, 0, 0], localEnd: [0.1, -0.55, 0], localFeatures: [{ id: 'cord-seam-right', type: 'termination-seam', evidenceRefs: ['three-quarter'], notes: 'Paired termination remains separate and readable.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'fabric', dominantAlbedo: '#4A4438', secondaryAlbedo: '#696355' }),
  component({ id: 'fastener-cluster', name: 'Awning fastener cluster', level: 'micro', role: 'connector', primitive: 'instanced-cluster', topologyClass: 'assembled-solid', topologyRationale: 'A small instanced row represents visible bolts/eyelets; it is not allowed to merge with the canopy into body-height cover.', material: 'oxidized-bronze', dimensions: { width: 2.3, height: 0.03, depth: 0.03 }, position: [0, 1.93, 0.29], parent: 'canopy-panel', socket: 'canopy-panel-fastener-socket', localStart: [-1.1, 0, 0], localEnd: [1.1, 0, 0], localFeatures: [{ id: 'fastener-spacing', type: 'instanced-eyelet-row', evidenceRefs: ['front'], notes: 'Six low-profile instances; no alpha fringe.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#6B6652', secondaryAlbedo: '#A18B5C' }),
];

const awningMaterials = [
  material({ id: 'canvas-fabric', name: 'Salt-faded canvas fabric', baseColor: '#9DA59C', palette: ['#9DA59C', '#7C7C6F', '#8C9287', '#B2B7AE'], materialClass: 'fabric', roughness: 0.78, metalness: 0, report: awningPbr, sourceImage: awningSource, overrides: [{ id: 'canopy-fold-groove', type: 'directional-fold-roughness', roughness: 0.82, normalStrength: 0.28, evidenceRefs: ['three-quarter'] }, { id: 'fabric-stitch', type: 'hem-stitch-mask', roughness: 0.72, evidenceRefs: ['front'] }], notes: 'Shared reference evidence supports palette and response; cloth folds remain geometry-first.' }),
  material({ id: 'weathered-timber', name: 'Weathered market timber', baseColor: '#6E614B', palette: ['#6E614B', '#4A4438', '#8A7A5F', '#A08F70'], materialClass: 'wood', roughness: 0.74, metalness: 0, report: awningPbr, sourceImage: awningSource, overrides: [{ id: 'lower-moisture-stain', type: 'baseward-stain', roughness: 0.84, colorBias: '#4A4438', evidenceRefs: ['rear-side'] }, { id: 'post-bevel', type: 'edge-wear-mask', roughness: 0.56, evidenceRefs: ['front'] }], wear: { edgeWear: 0.12, scratches: [{ source: 'post-bevel', geometryRequired: false }], chips: [] }, notes: 'Wood grain is procedural and restrained; no generic high-frequency bark noise.' }),
  material({ id: 'oxidized-bronze', name: 'Oxidized bronze hardware', baseColor: '#6B6652', palette: ['#6B6652', '#A18B5C', '#4A4438', '#8C9287'], materialClass: 'metal', roughness: 0.32, metalness: 0.78, report: awningPbr, sourceImage: awningSource, overrides: [{ id: 'ring-gloss', type: 'worn-edge-gloss', roughness: 0.24, evidenceRefs: ['three-quarter'] }, { id: 'ring-patina', type: 'oxidized-patina', roughness: 0.48, colorBias: '#4A4438', evidenceRefs: ['front'] }], wear: { edgeWear: 0.16, scratches: [{ source: 'ring-gloss', geometryRequired: false }], chips: [] }, dirt: { amount: 0.16, cavityBias: 0.34, color: '#332F29' }, notes: 'Metal highlights are localized to ring/eyelet arcs; avoid a uniformly mirror-like shader.' }),
];

const awningConfig = {
  name: 'Market Awning 01',
  primaryType: 'market canopy prop',
  formLanguage: ['shallow pitched canopy', 'folded cloth hem', 'paired vertical timber supports', 'small tension hardware'],
  structureKind: ['assembled frame', 'conforming fabric shell', 'fiber-strand tension lines', 'instanced hardware row'],
  motionPotential: ['static placement', 'subtle cloth bend only if explicitly animated later'],
  materialFamilies: ['weathered wood', 'salt-faded canvas', 'oxidized bronze'],
  complexityScores: { silhouetteComplexity: 2, componentCount: 2, hierarchyDepth: 2, repetitionDensity: 2, materialLayerCount: 3, localDetailDensity: 2, occlusionRisk: 2, actionReadinessNeed: 2 },
  estimatedCounts: { macroComponents: 2, mesoComponents: 3, microFeatureGroups: 8, materialLayers: 3, repetitionSystems: 2 },
  complexityReasoning: ['The visible canopy has two macro masses, paired supports, a folded hem, tension cords/rings, and a small repeated fastener row.', 'The awning must stay visually rich without creating body-height cover or alpha overdraw.'],
  components: awningComponents,
  materials: awningMaterials,
  details: awningDetails,
  microMinimum: 8,
  repetitionSystems: [
    { id: 'awning-fastener-row', name: 'Front hem fastener row', realization: 'instanced geometry', geometry: 'six low-profile bronze eyelets along the folded hem', instances: 6, buildsGeometry: true, componentRefs: ['fastener-cluster'], evidenceRefs: ['front'] },
    { id: 'awning-tension-pair', name: 'Paired tension hardware', realization: 'mirrored authored components', geometry: 'two rings and two curve-sweep cords with independent patina seeds', instances: 2, buildsGeometry: true, componentRefs: ['left-tension-ring', 'right-tension-ring', 'left-cord', 'right-cord'], evidenceRefs: ['three-quarter'] },
  ],
  featureReviewTargets: [
    target('canopy-silhouette-clearance', 'Canopy silhouette, folded hem, and 2.20 m underside clearance', 'critical', ['blockout', 'form-refinement', 'interaction-pass'], ['canopy-panel', 'front-hem'], ['full-object', 'front', 'top-clearance']),
    target('timber-support-rhythm', 'Paired timber support placement and frame contact', 'critical', ['structural-pass', 'form-refinement'], ['left-post', 'right-post'], ['front', 'three-quarter']),
    target('tension-hardware-identity', 'Ring, cord, and eyelet repetition without fake cover', 'important', ['structural-pass', 'surface-pass', 'interaction-pass'], ['left-tension-ring', 'right-tension-ring', 'left-cord', 'right-cord', 'fastener-cluster'], ['front', 'three-quarter']),
    target('canvas-wood-bronze-response', 'Independent cloth, timber, and bronze material response', 'important', ['material-pass', 'surface-pass', 'lighting-pass'], ['canopy-panel', 'left-post', 'left-tension-ring'], ['front', 'three-quarter', 'rear-side']),
  ],
  observations: {
    full: 'Four-view sheet shows a shallow market awning with a broad pale cloth canopy, dark folded hem, paired timber supports, and small bronze/tension accents.',
    front: 'Front read is governed by canopy width, folded hem, two supports, and a deliberately open underside; no opaque body-height wall is present.',
    threeQuarter: 'Three-quarter read exposes canopy thickness, hem roll, cord/ring attachment, and restrained fabric sag.',
    rear: 'Rear-side evidence is lower confidence; keep hidden frame surfaces simple and do not invent unseen decorative panels.',
    top: 'Top/clearance inspection is a placement guard: host above the canopy, underside clearance, and no climb/cover affordance.',
  },
  silhouette: { boundingShape: 'wide shallow canopy over paired posts', aspectRatios: { widthToHeight: 1.098, widthToDepth: 5.09 }, symmetry: 'bilateral support symmetry with small hand-built wear offsets', dominantCurves: ['folded front hem', 'shallow canopy pitch', 'paired tension lines'], negativeSpaces: ['open underside', 'space between supports', 'gap around each tension cord'], landmarks: ['front hem line', 'left/right post centers', 'bronze ring pair', 'underside clearance plane'] },
  triangleBudget: 1400,
  drawCallBudget: 3,
  risks: ['Canvas overdraw or alpha fringe can hide the open underside.', 'Adjacent canopy, rings, cords, and posts could be misread as a body-height cover cluster if placement changes.', 'Single-sheet rear-side evidence is incomplete; do not invent hidden graphics.', 'Shared PBR evidence is not final per-material calibration until browser neutral/grazing renders exist.'],
  pbrReport: awningReportPath,
  sourceHash: '3C6454844EB182002CC1722C729AB8FD7388ACCCE7B37A787B8D1CF1D3518E93',
};

const finialSource = path.join(PILOT, 'image-candidates/prop-roof-finial-01-v1.png');
const finialDir = path.join(IMG2, 'prop-roof-finial-01');
const finialReportPath = path.join(finialDir, 'pbr-evidence-report.json');
const finialPbr = await readJson(finialReportPath);
const finialDetails = [
  detail('collar-bevel', 'bevel', 'Chiseled stone collar has a softened bevel that catches the upper key light.', 'meso', 'silhouette and highlight', 'stone-collar/collar-bevel', 'front', { x: 0.02, y: 0.3, width: 0.46, height: 0.34 }),
  detail('socket-groove', 'groove', 'Small socket groove separates the stone collar from the bronze cap.', 'micro', 'component boundary', 'stone-collar/socket-groove', 'three-quarter', { x: 0.52, y: 0.35, width: 0.46, height: 0.28 }),
  detail('fin-pair-contour', 'contour', 'Paired fins define the distinctive crown silhouette and remain solid geometry.', 'meso', 'silhouette', 'left-fin/fin-pair-contour', 'front', { x: 0.02, y: 0.08, width: 0.46, height: 0.82 }),
  detail('bronze-gloss', 'gloss', 'Worn bronze cap and fins receive a constrained lower-roughness response on exposed ridges.', 'micro', 'material response', 'oxidized-bronze/bronze-gloss', 'three-quarter', { x: 0.52, y: 0.2, width: 0.46, height: 0.38 }),
  detail('fin-fastener', 'fastener', 'Small paired fasteners anchor the fin roots to the cap.', 'micro', 'repetition and attachment', 'finial-fastener-cluster/fin-fastener', 'front', { x: 0.02, y: 0.45, width: 0.46, height: 0.25 }),
  detail('stone-salt-stain', 'stain', 'Salt/dirt accumulation darkens the lower stone collar without becoming a decal.', 'micro', 'local material variation', 'salt-stone/lower-salt-stain', 'rear-side', { x: 0.02, y: 0.58, width: 0.46, height: 0.22 }),
  detail('glass-bead-highlight', 'gloss', 'The small sea-glass bead is a single controlled highlight accent, not a particle cloud.', 'micro', 'material response', 'sea-glass/glass-bead-highlight', 'three-quarter', { x: 0.52, y: 0.4, width: 0.46, height: 0.24 }),
];

const finialComponents = [
  component({ id: 'finial-root', name: 'Roof finial authored envelope', level: 'macro', role: 'root', primitive: 'lathe', topologyClass: 'assembled-solid', topologyRationale: 'The root is a low-segment turned host volume for the roof socket and crown; the safety envelope remains separate from map collision.', material: 'salt-stone', dimensions: { width: 0.85, height: 1.65, depth: 0.85 }, localFeatures: [{ id: 'roof-socket-clearance', type: 'host-roof-clearance', evidenceRefs: ['top-clearance'], notes: 'Place above the roof socket with at least 0.25 m clearance from playable surfaces.' }], evidenceRefs: ['full-object', 'front', 'top-clearance'], materialClass: 'stone', dominantAlbedo: '#A5A096', secondaryAlbedo: '#625E53', primitiveNotes: 'Host envelope only; no collision, climb, or cover volume.' }),
  component({ id: 'stone-collar', name: 'Chiseled salt-stone collar', level: 'macro', role: 'body', primitive: 'lathe', topologyClass: 'assembled-solid', topologyRationale: 'A stepped low-segment lathe preserves the collar taper and socket groove as actual 3D volume.', material: 'salt-stone', dimensions: { width: 0.72, height: 0.55, depth: 0.72 }, position: [0, 0.31, 0], parent: 'finial-root', socket: 'finial-root-stone-collar-socket', localStart: [0, 0.03, 0], localEnd: [0, 0.55, 0], localFeatures: [{ id: 'collar-bevel', type: 'chiseled-bevel', evidenceRefs: ['front'], notes: 'One-segment bevel plus deterministic chips below silhouette threshold.' }, { id: 'socket-groove', type: 'socket-groove', evidenceRefs: ['three-quarter'], notes: 'Geometry-first separation line.' }, { id: 'lower-salt-stain', type: 'localized-salt-stain', evidenceRefs: ['rear-side'], notes: 'Baseward darkening only.' }], evidenceRefs: ['full-object', 'front', 'three-quarter', 'rear-side'], materialClass: 'stone', dominantAlbedo: '#A5A096', secondaryAlbedo: '#625E53' }),
  component({ id: 'bronze-cap', name: 'Oxidized bronze crown cap', level: 'meso', role: 'connector', primitive: 'cylinder', topologyClass: 'assembled-solid', topologyRationale: 'A short bronze cylinder forms the cap socket and gives the fins a real attachment volume.', material: 'oxidized-bronze', dimensions: { radius: 0.26, height: 0.26, depth: 0.52 }, position: [0, 0.78, 0], parent: 'stone-collar', socket: 'stone-collar-bronze-cap-socket', localStart: [0, 0.48, 0], localEnd: [0, 0.75, 0], localFeatures: [{ id: 'bronze-gloss', type: 'worn-ridge-highlight', evidenceRefs: ['three-quarter'], notes: 'Localized low roughness on the crown ridge.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#7B786B', secondaryAlbedo: '#D1CAC2' }),
  component({ id: 'left-fin', name: 'Left bronze crown fin', level: 'meso', role: 'appendage', primitive: 'extrude', topologyClass: 'assembled-solid', topologyRationale: 'A thick extruded fin preserves the crown contour from front and orbit views; it is not a flat alpha card.', material: 'oxidized-bronze', dimensions: { width: 0.2, height: 0.58, depth: 0.08 }, position: [-0.16, 1.06, 0], parent: 'bronze-cap', socket: 'bronze-cap-left-fin-socket', localStart: [0, 0, 0], localEnd: [0, 0.54, 0], localFeatures: [{ id: 'fin-pair-contour', type: 'crown-contour', evidenceRefs: ['front'], notes: 'Keep fin thickness visible from three-quarter orbit.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#7B786B', secondaryAlbedo: '#D1CAC2' }),
  component({ id: 'right-fin', name: 'Right bronze crown fin', level: 'meso', role: 'appendage', primitive: 'extrude', topologyClass: 'assembled-solid', topologyRationale: 'The paired fin is a separate thick solid with a small deterministic asymmetry, preserving the readable crown gap.', material: 'oxidized-bronze', dimensions: { width: 0.2, height: 0.58, depth: 0.08 }, position: [0.16, 1.06, 0], rotation: [0, 0.02, 0], parent: 'bronze-cap', socket: 'bronze-cap-right-fin-socket', localStart: [0, 0, 0], localEnd: [0, 0.54, 0], localFeatures: [{ id: 'fin-pair-contour-right', type: 'crown-contour', evidenceRefs: ['front'], notes: 'Paired contour with a controlled wear offset.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#7B786B', secondaryAlbedo: '#D1CAC2' }),
  component({ id: 'sea-glass-bead', name: 'Single sea-glass crown bead', level: 'micro', role: 'connector', primitive: 'sphere', topologyClass: 'assembled-solid', topologyRationale: 'One small solid bead supplies the observed highlight accent without particles or a translucent body shell.', material: 'sea-glass', dimensions: { radius: 0.09, height: 0.18, depth: 0.18 }, position: [0, 1.42, 0], parent: 'bronze-cap', socket: 'bronze-cap-bead-socket', localStart: [0, 0.05, 0], localEnd: [0, 0.18, 0], localFeatures: [{ id: 'glass-bead-highlight', type: 'controlled-highlight', evidenceRefs: ['three-quarter'], notes: 'Use clearcoat/transmission only if browser render proves it remains readable.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'glass', dominantAlbedo: '#A5A096', secondaryAlbedo: '#D1CAC2' }),
  component({ id: 'socket-ring', name: 'Roof socket ring', level: 'micro', role: 'socket', primitive: 'torus', topologyClass: 'assembled-solid', topologyRationale: 'A low-profile torus defines the host socket boundary and prevents the finial from reading as a floating card.', material: 'oxidized-bronze', dimensions: { radius: 0.3, depth: 0.035 }, position: [0, 0.08, 0], parent: 'stone-collar', socket: 'stone-collar-socket-ring', localStart: [0, 0, 0], localEnd: [0, 0.03, 0], localFeatures: [{ id: 'socket-ring-bevel', type: 'socket-bevel', evidenceRefs: ['top-clearance'], notes: 'Host-roof contact ring only; not a climbable step.' }], evidenceRefs: ['top-clearance', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#7B786B', secondaryAlbedo: '#4E4B42' }),
  component({ id: 'finial-fastener-cluster', name: 'Fin root fastener pair', level: 'micro', role: 'connector', primitive: 'instanced-cluster', topologyClass: 'assembled-solid', topologyRationale: 'Two small solid fasteners anchor the fins to the cap and preserve the crown’s mechanical read.', material: 'oxidized-bronze', dimensions: { width: 0.34, height: 0.03, depth: 0.04 }, position: [0, 0.94, 0.1], parent: 'bronze-cap', socket: 'bronze-cap-fastener-socket', localStart: [-0.14, 0, 0], localEnd: [0.14, 0, 0], localFeatures: [{ id: 'fin-fastener', type: 'paired-fastener', evidenceRefs: ['front'], notes: 'Two low-profile instances; no alpha or particle substitute.' }], evidenceRefs: ['front', 'three-quarter'], materialClass: 'metal', dominantAlbedo: '#7B786B', secondaryAlbedo: '#D1CAC2' }),
];

const finialMaterials = [
  material({ id: 'salt-stone', name: 'Salt-worn pale roof stone', baseColor: '#A5A096', palette: ['#A5A096', '#D1CAC2', '#7B786B', '#625E53'], materialClass: 'stone', roughness: 0.72, metalness: 0, report: finialPbr, sourceImage: finialSource, overrides: [{ id: 'lower-salt-stain', type: 'baseward-salt-and-dirt', roughness: 0.84, colorBias: '#625E53', evidenceRefs: ['rear-side'] }, { id: 'socket-groove', type: 'cavity-darkening', roughness: 0.8, evidenceRefs: ['three-quarter'] }], wear: { edgeWear: 0.1, scratches: [], chips: [{ source: 'collar-bevel', geometryRequired: true }] }, notes: 'Stone chips remain low-amplitude geometry; shared map evidence only supports sub-silhouette pitting.' }),
  material({ id: 'oxidized-bronze', name: 'Oxidized bronze crown metal', baseColor: '#7B786B', palette: ['#7B786B', '#D1CAC2', '#4E4B42', '#A5A096'], materialClass: 'metal', roughness: 0.3, metalness: 0.82, report: finialPbr, sourceImage: finialSource, overrides: [{ id: 'bronze-gloss', type: 'worn-ridge-gloss', roughness: 0.22, evidenceRefs: ['three-quarter'] }, { id: 'socket-ring-bevel', type: 'socket-patina', roughness: 0.52, colorBias: '#4E4B42', evidenceRefs: ['top-clearance'] }], wear: { edgeWear: 0.14, scratches: [{ source: 'bronze-gloss', geometryRequired: false }], chips: [] }, notes: 'Bronze stays dark and oxidized; avoid a uniform bright gold crown.' }),
  material({ id: 'sea-glass', name: 'Muted sea-glass bead', baseColor: '#A5A096', palette: ['#A5A096', '#D1CAC2', '#7B786B', '#4E4B42'], materialClass: 'glass', roughness: 0.24, metalness: 0.02, report: finialPbr, sourceImage: finialSource, overrides: [{ id: 'glass-bead-highlight', type: 'single-bead-clearcoat', roughness: 0.18, evidenceRefs: ['three-quarter'] }], notes: 'Use a single controlled glass response; no particles, glow shell, or fake emissive halo.' }),
];

const finialConfig = {
  name: 'Roof Finial 01',
  primaryType: 'roof crown finial prop',
  formLanguage: ['stepped stone collar', 'short bronze socket', 'paired solid crown fins', 'single sea-glass accent'],
  structureKind: ['turned stone base', 'assembled metal crown', 'paired appendages', 'single highlight accent'],
  motionPotential: ['static placement', 'optional visibility/material state only'],
  materialFamilies: ['salt-worn stone', 'oxidized bronze', 'muted sea glass'],
  complexityScores: { silhouetteComplexity: 2, componentCount: 2, hierarchyDepth: 2, repetitionDensity: 1, materialLayerCount: 3, localDetailDensity: 2, occlusionRisk: 1, actionReadinessNeed: 2 },
  estimatedCounts: { macroComponents: 2, mesoComponents: 3, microFeatureGroups: 7, materialLayers: 3, repetitionSystems: 2 },
  complexityReasoning: ['The finial has a stepped stone collar, bronze cap, paired crown fins, one bead, a host socket ring, and paired fin fasteners.', 'The crown must remain solid from orbit views and must not become a roof collision or climb affordance.'],
  components: finialComponents,
  materials: finialMaterials,
  details: finialDetails,
  microMinimum: 7,
  repetitionSystems: [
    { id: 'finial-fin-pair', name: 'Paired crown fins', realization: 'mirrored authored solids', geometry: 'two thick extruded fins with independent wear offsets', instances: 2, buildsGeometry: true, componentRefs: ['left-fin', 'right-fin'], evidenceRefs: ['front', 'three-quarter'] },
    { id: 'finial-fastener-pair', name: 'Fin root fasteners', realization: 'instanced geometry', geometry: 'two low-profile bronze fasteners at the fin roots', instances: 2, buildsGeometry: true, componentRefs: ['finial-fastener-cluster'], evidenceRefs: ['front'] },
  ],
  featureReviewTargets: [
    target('finial-crown-silhouette', 'Paired solid fin silhouette and crown gap', 'critical', ['blockout', 'form-refinement'], ['left-fin', 'right-fin', 'bronze-cap'], ['full-object', 'front', 'three-quarter']),
    target('stone-socket-envelope', 'Stepped stone collar, socket boundary, and 0.25 m roof clearance', 'critical', ['structural-pass', 'interaction-pass'], ['finial-root', 'stone-collar', 'socket-ring'], ['front', 'top-clearance']),
    target('finial-metal-glass-response', 'Oxidized bronze and single sea-glass highlight response', 'important', ['material-pass', 'surface-pass', 'lighting-pass'], ['bronze-cap', 'sea-glass-bead'], ['three-quarter', 'rear-side']),
    target('finial-detail-rhythm', 'Bevel, groove, stain, and fastener linkage', 'important', ['surface-pass', 'optimization-pass'], ['stone-collar', 'finial-fastener-cluster'], ['front', 'three-quarter']),
  ],
  observations: {
    full: 'Four-view sheet shows a compact roof crown with pale stepped stone, dark oxidized metal fins, a socket ring, and one muted glass highlight.',
    front: 'Front read is governed by collar width, paired fin contour, center gap, and the small crown accent; avoid adding extra symbols.',
    threeQuarter: 'Three-quarter read exposes fin thickness, bronze socket overlap, stone bevels, and the bead highlight.',
    rear: 'Rear-side evidence is lower confidence; preserve simple backside volume and do not invent engravings.',
    top: 'Top/clearance inspection is a safety guard: mount only in the roof socket zone, clear playable surfaces by 0.25 m, and keep collision disabled.',
  },
  silhouette: { boundingShape: 'compact stepped base with narrow paired crown', aspectRatios: { widthToHeight: 0.515, widthToDepth: 0.515 }, symmetry: 'bilateral fin symmetry with small controlled wear offsets', dominantCurves: ['stone collar taper', 'bronze socket shoulder', 'paired fin outer contours'], negativeSpaces: ['crown center gap', 'socket-to-cap seam', 'air around bead'], landmarks: ['stone collar shoulder', 'bronze cap', 'fin pair', 'single bead', 'host socket ring'] },
  triangleBudget: 900,
  drawCallBudget: 2,
  risks: ['Thin fins can become flat cards if thickness is dropped during optimization.', 'Socket ring or collar may accidentally become a climbable roof step if placed on a playable surface.', 'Bronze and glass can collapse into the same value range at distance; verify landmark readability in orbit.', 'Shared PBR evidence is not final per-material calibration until browser neutral/grazing renders exist.'],
  pbrReport: finialReportPath,
  sourceHash: '757EE0CF226EC57042A8E01F5C9531906E18314A6A0B456E1C0B74F7948A726B',
};

for (const [config, sourceImage, dir, report] of [[awningConfig, awningSource, awningDir, awningPbr], [finialConfig, finialSource, finialDir, finialPbr]]) {
  const specPath = path.join(dir, 'OBJECT_SCULPT_SPEC.json');
  const inventoryPath = path.join(dir, 'detail-inventory.json');
  const starter = await readJson(specPath);
  const authored = baseSpec(starter, config, report, sourceImage);
  const inventory = {
    sourceImage,
    zonesDir: path.join(dir, 'detail-zones'),
    detailInventory: {
      scanMethod: 'grid-3x3 plus direct four-view inspection',
      targetMinDetails: config.details.length,
      details: config.details,
    },
    authoringInstruction: 'This inventory is authored and linked to the strict candidate spec. Any browser review finding must add a new linked detail rather than leaving a prose-only note.',
  };
  await writeJson(specPath, authored);
  await writeJson(inventoryPath, inventory);
  console.log(JSON.stringify({ asset: config.name, specPath, inventoryPath, components: authored.componentTree.length, materials: authored.materials.length, details: authored.preSpecAssessment.detailInventory.details.length, pbrConfidence: report.confidence }, null, 2));
}
