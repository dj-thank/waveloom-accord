import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../shared/data/heroes.js';
import { HERO_ASSET_MANIFEST } from '../shared/data/hero_assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(ROOT, 'shared', 'data', 'character_model_assets.js');
const ROLLOUT_SOURCE_PATH = 'assets-src/img2threejs/rollout.json';
const COHORTS = Object.freeze({ frontline: 'frontline', damage: 'damage', support: 'support' });
const QUALITY_GATE_IDS = Object.freeze([
  'strictSpec',
  'silhouette',
  'multiAngle',
  'material',
  'runtimeContract',
  'performance',
  'visualReview',
]);
const REQUIRED_PIVOTS = Object.freeze([
  'root',
  'head',
  'torso',
  'pelvis',
  'leftShoulder',
  'rightShoulder',
  'leftArm',
  'rightArm',
  'leftLeg',
  'rightLeg',
]);
const REQUIRED_SOCKETS = Object.freeze([
  'weapon_primary',
  'hand_off',
  'back_accessory',
  'vfx_origin',
]);

function conceptFor(heroId) {
  const hero = HERO_ASSET_MANIFEST.heroes.find((item) => item.heroId === heroId);
  const visual = hero?.concept?.visual;
  if (!visual?.sourceGreenPath || !visual?.sourceAlphaPath) throw new Error(`missing authoritative concept for ${heroId}`);
  return {
    sourceGreenPath: visual.sourceGreenPath,
    sourceAlphaPath: visual.sourceAlphaPath,
    sourceManifest: visual.sourceManifest,
  };
}

function requireText(value, label, minLength = 1) {
  if (typeof value !== 'string' || value.trim().length < minLength) {
    throw new Error(`${label} must be text with at least ${minLength} characters`);
  }
}

function requireTextArray(value, label, minItems) {
  if (!Array.isArray(value) || value.length < minItems) {
    throw new Error(`${label} must contain at least ${minItems} entries`);
  }
  value.forEach((item, index) => requireText(item, `${label}[${index}]`, 4));
}

function validateProfile(profile, hero) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
    throw new Error(`model profile must be an object for ${hero.id}`);
  }
  if (profile.id !== hero.id) throw new Error(`model profile id mismatch for ${hero.id}`);
  if (profile.role !== hero.role) throw new Error(`model profile role mismatch for ${hero.id}`);
  requireText(profile.cohort, `${hero.id}.cohort`, 3);
  requireText(profile.modelArchetype, `${hero.id}.modelArchetype`, 5);
  if (!Number.isFinite(profile.proportions?.heightM)
    || profile.proportions.heightM < 1.2
    || profile.proportions.heightM > 3.5) {
    throw new Error(`${hero.id}.proportions.heightM is outside the supported range`);
  }
  requireText(profile.proportions?.bodyRatio, `${hero.id}.proportions.bodyRatio`, 5);
  requireText(profile.proportions?.notes, `${hero.id}.proportions.notes`, 12);
  requireTextArray(profile.silhouetteAnchors?.front, `${hero.id}.silhouetteAnchors.front`, 3);
  requireTextArray(profile.silhouetteAnchors?.side, `${hero.id}.silhouetteAnchors.side`, 3);
  if (!Array.isArray(profile.materialPalette) || profile.materialPalette.length < 3) {
    throw new Error(`${hero.id}.materialPalette must contain at least three materials`);
  }
  profile.materialPalette.forEach((material, index) => {
    requireText(material?.name, `${hero.id}.materialPalette[${index}].name`, 3);
    if (typeof material?.hex !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(material.hex)) {
      throw new Error(`${hero.id}.materialPalette[${index}].hex must be #RRGGBB`);
    }
    requireText(material?.finish, `${hero.id}.materialPalette[${index}].finish`, 4);
  });
  for (const [key, minimum] of Object.entries({
    head: 1,
    torso: 1,
    limbs: 2,
    weapons: 1,
    accessories: 1,
  })) {
    requireTextArray(profile.primitives?.[key], `${hero.id}.primitives.${key}`, minimum);
  }
  requireText(profile.rig?.pivot, `${hero.id}.rig.pivot`, 5);
  if (!profile.rig.pivot.includes('+Y up') || !profile.rig.pivot.includes('+Z forward')) {
    throw new Error(`${hero.id}.rig.pivot must use the Three.js +Y up, +Z forward convention`);
  }
  requireTextArray(profile.rig?.sockets, `${hero.id}.rig.sockets`, 3);
  for (const socket of REQUIRED_SOCKETS) {
    if (!profile.rig.sockets.includes(socket)) throw new Error(`${hero.id} profile lacks required socket ${socket}`);
  }
  requireTextArray(profile.rig?.colliders, `${hero.id}.rig.colliders`, 2);
  requireTextArray(profile.animation?.locomotion, `${hero.id}.animation.locomotion`, 3);
  requireTextArray(profile.animation?.combat, `${hero.id}.animation.combat`, 2);
  requireText(profile.animation?.deformationBudget, `${hero.id}.animation.deformationBudget`, 12);
  requireTextArray(profile.reconstructionRisks, `${hero.id}.reconstructionRisks`, 2);
  requireTextArray(profile.qualityAcceptance?.targets, `${hero.id}.qualityAcceptance.targets`, 3);
  requireTextArray(profile.qualityAcceptance?.gates, `${hero.id}.qualityAcceptance.gates`, 2);
  if (!Number.isInteger(profile.rollout?.priority)
    || profile.rollout.priority < 1
    || profile.rollout.priority > 18) {
    throw new Error(`${hero.id}.rollout.priority must be an integer from 1 through 18`);
  }
  requireText(profile.rollout?.rationale, `${hero.id}.rollout.rationale`, 12);
  if (!['brief', 'in-progress', 'blocked', 'qa'].includes(profile.status)) {
    throw new Error(`${hero.id}.status is invalid`);
  }
}

async function profileFor(hero, concept) {
  const sourcePath = `assets-src/img2threejs/heroes/${hero.id}.json`;
  const bytes = await readFile(path.join(ROOT, ...sourcePath.split('/')));
  const profile = JSON.parse(bytes.toString('utf8'));
  validateProfile(profile, hero);
  if (profile.references?.green !== concept.sourceGreenPath
    || profile.references?.alpha !== concept.sourceAlphaPath) {
    throw new Error(`model profile references diverge from authoritative concept for ${hero.id}`);
  }
  return {
    sourcePath,
    bytes: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    schemaPath: 'assets-src/img2threejs/model-profile.schema.json',
    status: profile.status,
    rolloutPriority: profile.rollout?.priority,
  };
}

async function loadRollout(ids) {
  const bytes = await readFile(path.join(ROOT, ...ROLLOUT_SOURCE_PATH.split('/')));
  const rollout = JSON.parse(bytes.toString('utf8'));
  if (JSON.stringify(rollout.qualityGateIds) !== JSON.stringify(QUALITY_GATE_IDS)) {
    throw new Error('rollout qualityGateIds diverge from the manifest policy');
  }
  for (const heroId of Object.keys(rollout.overrides || {})) {
    if (!ids.has(heroId)) throw new Error(`rollout override contains unknown hero ${heroId}`);
  }
  return {
    data: rollout,
    identity: {
      sourcePath: ROLLOUT_SOURCE_PATH,
      bytes: bytes.byteLength,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    },
  };
}

function defaultRuntimeFor(heroId) {
  const pascal = String(heroId || '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((segment) => segment.slice(0, 1).toUpperCase() + segment.slice(1))
    .join('');
  if (!pascal) throw new Error('cannot derive runtime module for empty hero id');
  return {
    moduleUrl: `/client/img2threejs/${heroId}/create${pascal}Model.js`,
    factoryExport: `create${pascal}PlayableHeroModel`,
  };
}

async function rolloutFor(heroId, rollout) {
  const defaults = rollout.defaults || {};
  const override = rollout.overrides?.[heroId] || {};
  const status = override.status || defaults.status || 'planned';
  if (!['planned', 'candidate', 'blocked', 'accepted'].includes(status)) {
    throw new Error(`invalid rollout status for ${heroId}: ${status}`);
  }
  // Candidate metadata advertises the real factory module for every canonical
  // hero, while runtime eligibility remains strictly gated on accepted status
  // plus every independent quality gate. This keeps the client fail-closed
  // without pretending that a planned/candidate model is game-ready.
  const runtime = override.runtime ?? defaults.runtime ?? defaultRuntimeFor(heroId);
  const gates = {
    ...(defaults.quality?.gates || {}),
    ...(override.quality?.gates || {}),
  };
  const evidence = override.quality?.evidence ?? defaults.quality?.evidence ?? [];
  for (const evidencePath of evidence) {
    if (typeof evidencePath !== 'string'
      || path.isAbsolute(evidencePath)
      || evidencePath.includes('..')
      || evidencePath.includes('\\')) {
      throw new Error(`non-portable quality evidence for ${heroId}: ${evidencePath}`);
    }
    await readFile(path.join(ROOT, ...evidencePath.split('/')));
  }
  const qualityComplete = QUALITY_GATE_IDS.every((id) => gates[id] === true)
    && evidence.length >= QUALITY_GATE_IDS.length;
  const runtimeEligible = status === 'accepted' && qualityComplete;
  if (status === 'accepted' && (!runtime || !runtimeEligible)) {
    throw new Error(`accepted model ${heroId} lacks runtime metadata, gates, or evidence`);
  }
  return {
    status,
    runtime,
    gates,
    evidence,
    acceptedAt: override.quality?.acceptedAt ?? defaults.quality?.acceptedAt ?? null,
    notes: override.notes || null,
    runtimeEligible,
  };
}

async function buildManifest() {
  const ids = new Set(HEROES.map((hero) => hero.id));
  if (ids.size !== 18) throw new Error(`expected exact 18 heroes, found ${ids.size}`);
  const rolloutSource = await loadRollout(ids);
  const heroes = await Promise.all(HEROES.map(async (hero) => {
    const concept = conceptFor(hero.id);
    const profile = await profileFor(hero, concept);
    const rollout = await rolloutFor(hero.id, rolloutSource.data);
    return {
      heroId: hero.id,
      cohort: COHORTS[hero.role],
      status: rollout.status,
      concept,
      profile,
      runtime: rollout.runtime,
      moduleUrl: rollout.runtime?.moduleUrl || null,
      factoryExport: rollout.runtime?.factoryExport || null,
      contract: {
        schemaVersion: '1.0.0',
        requiredPivots: REQUIRED_PIVOTS,
        requiredSockets: REQUIRED_SOCKETS,
        requireColliderHints: true,
        coordinateSystem: 'three-y-up-front-positive-z',
      },
      quality: {
        policyVersion: '1.0.0',
        gates: rollout.gates,
        evidence: rollout.evidence,
        acceptedAt: rollout.acceptedAt,
        policy: "Only status 'accepted' is runtime-eligible; candidate/planned entries use the fallback model.",
      },
      runtimeEligible: rollout.runtimeEligible,
      notes: rollout.notes,
      fallback: {
        kind: 'generic',
        reason: rollout.status === 'candidate'
          ? 'candidate quality gates incomplete'
          : rollout.status === 'blocked'
            ? 'model rollout is blocked'
            : 'model not implemented',
      },
    };
  }));
  return {
    schemaVersion: '1.0.0',
    authoritative: true,
    generatedFor: 'kagariai-1.0.0-rc.5',
    pipeline: {
      profileSchemaPath: 'assets-src/img2threejs/model-profile.schema.json',
      runtimeStatus: 'accepted',
      qualityGateIds: QUALITY_GATE_IDS,
      rolloutSource: rolloutSource.identity,
      cohorts: ['frontline', 'damage', 'support'],
      rolloutOrder: ['shiomaneki', 'frontline', 'damage', 'support'],
      fallback: 'verified RobotExpressive rig, then articulated procedural silhouette',
    },
    heroes,
  };
}

function moduleSource(manifest) {
  return `// GENERATED by tools/build_character_model_manifest.js. Do not hand-edit.\n` +
    `const DATA = ${JSON.stringify(manifest, null, 2)};\n` +
    `function freeze(value) { if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value; for (const child of Object.values(value)) freeze(child); return Object.freeze(value); }\n` +
    `export const CHARACTER_MODEL_ASSETS = freeze(DATA);\n` +
    `export const CHARACTER_MODEL_PIPELINE = CHARACTER_MODEL_ASSETS.pipeline;\n` +
    `export const CHARACTER_MODEL_ASSETS_BY_HERO_ID = Object.freeze(Object.fromEntries(CHARACTER_MODEL_ASSETS.heroes.map((entry) => [entry.heroId, entry])));\n` +
    `export function getCharacterModelAsset(heroId) { return CHARACTER_MODEL_ASSETS_BY_HERO_ID[String(heroId || '')] || null; }\n` +
    `export function isCharacterModelQualityAccepted(entry) { const ids = CHARACTER_MODEL_PIPELINE.qualityGateIds; return !!entry && entry.status === CHARACTER_MODEL_PIPELINE.runtimeStatus && entry.runtimeEligible === true && ids.every((id) => entry.quality?.gates?.[id] === true) && Array.isArray(entry.quality?.evidence) && entry.quality.evidence.length >= ids.length; }\n` +
    `export function getRuntimeEligibleCharacterModelAsset(heroId) { const entry = getCharacterModelAsset(heroId); return isCharacterModelQualityAccepted(entry) ? entry : null; }\n`;
}

const check = process.argv.includes('--check');
const source = moduleSource(await buildManifest());
if (check) {
  const actual = await readFile(OUTPUT, 'utf8').catch(() => null);
  if (actual !== source) throw new Error(`character model manifest is stale: ${path.relative(ROOT, OUTPUT).replaceAll(path.sep, '/')}`);
  console.log('character model manifest is deterministic and up to date');
} else {
  await mkdir(path.dirname(OUTPUT), { recursive: true });
  const temporary = `${OUTPUT}.${process.pid}.tmp`;
  await writeFile(temporary, source, 'utf8');
  await rename(temporary, OUTPUT);
  console.log(JSON.stringify({ output: path.relative(ROOT, OUTPUT).replaceAll(path.sep, '/'), heroes: 18 }));
}
