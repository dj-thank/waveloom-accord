#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../shared/data/heroes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_MANIFEST_ROOT = path.join(ROOT, 'assets-src', 'imagegen', 'manifests');
const DERIVED_ROOT = path.join(ROOT, 'assets-src', 'imagegen', 'derived');
const AUDIO_MANIFEST_PATH = path.join(ROOT, 'assets-src', 'local-audio', 'manifest.json');
const AUDIO_MANIFEST_RELATIVE_PATH = 'assets-src/local-audio/manifest.json';
const OUTPUT = path.join(ROOT, 'shared', 'data', 'hero_assets.js');
const PROCESSOR = path.join(ROOT, 'tools', 'process_image_atlas.py');
const PYTHON = process.env.KAGARIAI_PYTHON || process.env.PYTHON || 'python';
const SLOTS = Object.freeze(['secondary', 'ability1', 'ability2', 'ultimate']);
const ALLOW_INCOMPLETE_AUDIO = process.argv.includes('--allow-incomplete-audio');

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function fileRecord(relativePath) {
  const absolute = path.resolve(ROOT, relativePath);
  const relative = path.relative(ROOT, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`asset escaped root: ${relativePath}`);
  const bytes = await readFile(absolute);
  return {
    path: relative.replaceAll(path.sep, '/'),
    sha256: sha256(bytes),
    bytes: bytes.length,
  };
}

function recordsFromDocument(document, filename) {
  const records = Array.isArray(document)
    ? document
    : document.assets || document.records || document.items;
  if (!Array.isArray(records)) throw new Error(`${filename} must contain an assets or records array`);
  return records;
}

function firstString(record, names) {
  for (const name of names) {
    if (typeof record?.[name] === 'string' && record[name].trim()) return record[name].trim();
  }
  return null;
}

function normalizeImagePath(value, filename) {
  const normalized = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
  if (normalized.startsWith('assets-src/imagegen/')) return normalized;
  if (normalized.startsWith('heroes/')) return `assets-src/imagegen/${normalized}`;
  throw new Error(`${filename} has unsupported image path ${value}`);
}

function normalizeProvider(value, filename) {
  const provider = String(value || 'openai-built-in-imagegen').trim();
  if (provider === 'openai-built-in-imagegen' || provider === 'built-in image_gen') {
    return 'openai-built-in-imagegen';
  }
  throw new Error(`${filename} has unexpected provider ${provider}`);
}

function normalizeGrid(value, concept) {
  if (typeof value === 'string') {
    const match = value.trim().match(/^(\d+)x(\d+)$/i);
    if (match) return { rows: Number(match[1]), cols: Number(match[2]) };
  }
  return {
    rows: Number(value?.rows ?? (concept ? 2 : 4)),
    cols: Number(value?.cols ?? (concept ? 2 : 4)),
  };
}

function normalizeImageRecord(record, filename, defaults = {}) {
  const heroId = firstString(record, ['heroId', 'hero']);
  const actionId = firstString(record, ['actionId', 'abilityId']);
  const rawKind = firstString(record, ['kind', 'assetKind', 'type']) || (actionId ? 'ability' : 'hero_concept');
  const concept = /concept|character|hero/i.test(rawKind) && !actionId;
  const sourceValue = firstString(record, ['sourcePath', 'greenPath', 'sourceGreenPath', 'source']);
  const alphaValue = firstString(record, ['alphaPath', 'sourceAlphaPath', 'transparentPath', 'alpha']);
  const promptKey = concept ? `${heroId}:concept` : actionId;
  const prompt = firstString(record, ['prompt', 'finalPrompt', 'exactPrompt', 'exactFinalPrompt'])
    || firstString(defaults?.exactPrompts, [promptKey]);
  const provider = normalizeProvider(firstString(record, ['provider']) || defaults.provider, filename);
  const grid = normalizeGrid(record?.grid ?? { rows: record?.rows, cols: record?.cols }, concept);
  if (!heroId || !sourceValue || !alphaValue || !prompt) {
    throw new Error(`${filename} has incomplete image record: ${JSON.stringify({
      heroId,
      actionId,
      sourcePath: sourceValue,
      alphaPath: alphaValue,
      prompt: !!prompt,
    })}`);
  }
  if (!concept && !actionId) throw new Error(`${filename} ability record lacks actionId for ${heroId}`);
  if (prompt.length < 80) throw new Error(`${filename} prompt is too short for ${actionId || heroId}`);
  if (grid.rows !== (concept ? 2 : 4) || grid.cols !== (concept ? 2 : 4)) {
    throw new Error(`${filename} grid mismatch for ${actionId || heroId}: ${grid.rows}x${grid.cols}`);
  }
  return {
    heroId,
    actionId,
    slot: firstString(record, ['slot']),
    behavior: firstString(record, ['behavior']),
    kind: concept ? 'hero_concept' : 'ability',
    sourcePath: normalizeImagePath(sourceValue, filename),
    alphaPath: normalizeImagePath(alphaValue, filename),
    prompt,
    provider,
    keyColor: firstString(record, ['keyColor']) || defaults.keyColor || '#00FF00',
    grid,
    expectedSourceSha256: firstString(record, ['sourceSha256', 'greenSHA256', 'sha256Green', 'sha256'])?.toLowerCase() || null,
    expectedAlphaSha256: firstString(record, ['alphaSha256', 'alphaSHA256', 'sha256Alpha'])?.toLowerCase() || null,
    validationNotes: record.validationNotes ?? record.validation ?? null,
    sourceManifest: `assets-src/imagegen/manifests/${filename}`,
  };
}

async function loadImageRecords() {
  const files = (await readdir(IMAGE_MANIFEST_ROOT))
    .filter(name => /^group-[a-f]\.json$/i.test(name))
    .sort();
  if (files.length !== 6) throw new Error(`expected six image group manifests, found ${files.length}: ${files.join(', ')}`);
  const records = [];
  for (const filename of files) {
    const raw = (await readFile(path.join(IMAGE_MANIFEST_ROOT, filename), 'utf8')).replace(/^\uFEFF/, '');
    const parsed = JSON.parse(raw);
    const defaults = Array.isArray(parsed) ? {} : parsed;
    for (const record of recordsFromDocument(parsed, filename)) records.push(normalizeImageRecord(record, filename, defaults));
  }
  return records;
}

function canonicalCatalog() {
  const heroes = new Map();
  const actions = new Map();
  for (const hero of HEROES) {
    heroes.set(hero.id, hero);
    for (const slot of SLOTS) {
      const action = hero.abilities[slot];
      if (actions.has(action.id)) throw new Error(`duplicate canonical action ${action.id}`);
      actions.set(action.id, { hero, slot, action });
    }
  }
  return { heroes, actions };
}

function runProcessor(record) {
  const assetId = record.kind === 'hero_concept' ? `${record.heroId}-concept` : record.actionId;
  const runtimeDirectory = record.kind === 'hero_concept'
    ? path.join(ROOT, 'client', 'assets', 'generated', 'heroes', record.heroId)
    : path.join(ROOT, 'client', 'assets', 'generated', 'abilities', record.actionId);
  const framesDirectory = path.join(DERIVED_ROOT, record.heroId, assetId, 'frames');
  const result = spawnSync(PYTHON, [
    PROCESSOR,
    '--root', ROOT,
    '--input', path.resolve(ROOT, record.alphaPath),
    '--asset-id', assetId,
    '--rows', String(record.grid.rows),
    '--cols', String(record.grid.cols),
    '--runtime-dir', runtimeDirectory,
    '--frames-dir', framesDirectory,
  ], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const spawnError = result.error
      ? `spawn error ${result.error.code || 'UNKNOWN'}: ${result.error.message}`
      : '';
    const diagnostics = [spawnError, result.stdout || '', result.stderr || ''].filter(Boolean).join('\n');
    throw new Error(`atlas processor failed for ${assetId}\n${diagnostics}`);
  }
  const line = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1);
  return JSON.parse(line);
}

async function processVisual(record) {
  const [green, alpha] = await Promise.all([fileRecord(record.sourcePath), fileRecord(record.alphaPath)]);
  if (record.expectedSourceSha256 && green.sha256 !== record.expectedSourceSha256) {
    throw new Error(`source image hash mismatch for ${record.actionId || record.heroId}`);
  }
  if (record.expectedAlphaSha256 && alpha.sha256 !== record.expectedAlphaSha256) {
    throw new Error(`alpha image hash mismatch for ${record.actionId || record.heroId}`);
  }
  const processed = runProcessor(record);
  return {
    provider: record.provider,
    keyColor: record.keyColor.toUpperCase(),
    prompt: record.prompt,
    grid: processed.grid,
    sourceGreenPath: green.path,
    sourceGreenSha256: green.sha256,
    sourceGreenBytes: green.bytes,
    sourceAlphaPath: alpha.path,
    sourceAlphaSha256: alpha.sha256,
    sourceAlphaBytes: alpha.bytes,
    sourceWidth: processed.sourceWidth,
    sourceHeight: processed.sourceHeight,
    sourceFrames: processed.frames,
    runtimeUrl: processed.runtimeUrl,
    sha256: processed.runtimeSha256,
    bytes: processed.runtimeBytes,
    width: processed.runtimeWidth,
    height: processed.runtimeHeight,
    transparentPixelFraction: processed.transparentPixelFraction,
    partiallyTransparentPixelFraction: processed.partiallyTransparentPixelFraction,
    opaquePixelFraction: processed.opaquePixelFraction,
    validationNotes: record.validationNotes,
    sourceManifest: record.sourceManifest,
  };
}

async function loadAudioRecords() {
  const manifest = JSON.parse(await readFile(AUDIO_MANIFEST_PATH, 'utf8'));
  if (manifest.schemaVersion !== '1.0.0'
    || manifest.authoritative !== true
    || manifest.generatedFor !== 'kagariai-1.0.0-rc.5'
    || manifest.provider !== 'Kagariai Local DSP') {
    throw new Error('audio manifest is not the authoritative Kagariai Local DSP catalog');
  }
  if (manifest.contentType !== 'audio/wav'
    || manifest.sampleRateHz !== 44_100
    || manifest.channels !== 1
    || manifest.bitDepth !== 16) {
    throw new Error('audio manifest has an unsupported WAV delivery contract');
  }
  if (!/^\d+\.\d+\.\d+$/.test(manifest.generatorVersion || '')) {
    throw new Error('audio manifest has an invalid generator version');
  }
  if (!/no third-party samples or model weights/i.test(manifest.license || '')) {
    throw new Error('audio manifest lacks the project-authored provenance declaration');
  }
  if (manifest.generatorPath !== 'tools/generate_local_audio_assets.js') {
    throw new Error('audio manifest has an unexpected generator path');
  }
  const generator = await fileRecord(manifest.generatorPath);
  if (generator.sha256 !== manifest.generatorSha256) {
    throw new Error('audio manifest generator hash does not match the admitted generator');
  }
  const records = new Map();
  for (const item of manifest.assets || []) {
    const key = `${item.kind}:${item.id}`;
    if (records.has(key)) throw new Error(`duplicate audio record ${key}`);
    const source = await fileRecord(item.sourcePath);
    const runtime = await fileRecord(item.runtimePath);
    if (source.sha256 !== runtime.sha256 || source.sha256 !== item.sha256) {
      throw new Error(`audio source/runtime hash mismatch for ${key}`);
    }
    const expectedRuntimeUrl = `/${runtime.path}`;
    if (item.runtimeUrl !== expectedRuntimeUrl) throw new Error(`audio runtime URL mismatch for ${key}`);
    if (!item.runtimeUrl.endsWith(`.${item.sha256.slice(0, 12)}.wav`)) {
      throw new Error(`audio runtime filename is not content-addressed for ${key}`);
    }
    if (item.contentType !== manifest.contentType) throw new Error(`audio content type mismatch for ${key}`);
    if (!Number.isInteger(item.seed) || !String(item.profile || '').trim() || !(item.durationSec > 0)) {
      throw new Error(`audio synthesis metadata is incomplete for ${key}`);
    }
    records.set(key, {
      provider: manifest.provider,
      generatorVersion: manifest.generatorVersion,
      generatorPath: generator.path,
      generatorSha256: generator.sha256,
      outputFormat: manifest.outputFormat || 'pcm_s16le',
      sampleRateHz: manifest.sampleRateHz,
      channels: manifest.channels,
      bitDepth: manifest.bitDepth,
      license: manifest.license,
      seed: item.seed,
      profile: item.profile,
      durationSec: item.durationSec,
      sourcePath: source.path,
      sourceSha256: source.sha256,
      runtimeUrl: item.runtimeUrl,
      sha256: runtime.sha256,
      bytes: runtime.bytes,
      contentType: manifest.contentType,
      generatedAt: item.generatedAt,
    });
  }
  return records;
}

function requireUnique(records, keyOf, expectedCount, label) {
  const map = new Map();
  for (const record of records) {
    const key = keyOf(record);
    if (map.has(key)) throw new Error(`duplicate ${label}: ${key}`);
    map.set(key, record);
  }
  if (map.size !== expectedCount) throw new Error(`expected ${expectedCount} ${label} records, found ${map.size}`);
  return map;
}

async function buildManifest() {
  const { heroes: canonicalHeroes, actions: canonicalActions } = canonicalCatalog();
  const imageRecords = await loadImageRecords();
  if (imageRecords.length !== 90) throw new Error(`expected 90 image records, found ${imageRecords.length}`);
  const concepts = requireUnique(imageRecords.filter(record => record.kind === 'hero_concept'), record => record.heroId, 18, 'hero concept');
  const actions = requireUnique(imageRecords.filter(record => record.kind === 'ability'), record => record.actionId, 72, 'ability visual');
  for (const heroId of concepts.keys()) if (!canonicalHeroes.has(heroId)) throw new Error(`unknown concept hero ${heroId}`);
  for (const [actionId, record] of actions) {
    const canonical = canonicalActions.get(actionId);
    if (!canonical) throw new Error(`unknown visual action ${actionId}`);
    if (record.heroId !== canonical.hero.id) throw new Error(`visual action hero mismatch for ${actionId}`);
    if (record.slot && record.slot !== canonical.slot) throw new Error(`visual slot mismatch for ${actionId}`);
    if (record.behavior && record.behavior !== canonical.action.behavior) throw new Error(`visual behavior mismatch for ${actionId}`);
  }
  const audio = await loadAudioRecords();
  const expectedAudioKeys = [
    ...HEROES.map(hero => `weapon:${hero.weapon.id}`),
    ...HEROES.flatMap(hero => SLOTS.map(slot => `ability:${hero.abilities[slot].id}`)),
  ];
  const missingAudio = expectedAudioKeys.filter(key => !audio.has(key));
  const unexpectedAudio = [...audio.keys()].filter(key => !expectedAudioKeys.includes(key));
  if (unexpectedAudio.length > 0) throw new Error(`unexpected audio records: ${unexpectedAudio.join(', ')}`);
  if (audio.size !== expectedAudioKeys.length - missingAudio.length) {
    throw new Error(`audio catalog count mismatch: expected ${expectedAudioKeys.length}, found ${audio.size}`);
  }
  if (missingAudio.length > 0 && !ALLOW_INCOMPLETE_AUDIO) {
    throw new Error(`expected 90 audio records, found ${audio.size}; missing ${missingAudio.length}`);
  }

  const processedVisuals = new Map();
  for (const record of imageRecords) {
    const key = record.kind === 'hero_concept' ? `concept:${record.heroId}` : `ability:${record.actionId}`;
    processedVisuals.set(key, await processVisual(record));
    console.log(`[visual] ${key}`);
  }

  const heroes = HEROES.map(hero => {
    const weaponAudio = audio.get(`weapon:${hero.weapon.id}`);
    if (!weaponAudio && !ALLOW_INCOMPLETE_AUDIO) throw new Error(`missing weapon audio ${hero.weapon.id}`);
    const abilities = Object.fromEntries(SLOTS.map(slot => {
      const definition = hero.abilities[slot];
      const visual = processedVisuals.get(`ability:${definition.id}`);
      const actionAudio = audio.get(`ability:${definition.id}`);
      if (!visual || (!actionAudio && !ALLOW_INCOMPLETE_AUDIO)) throw new Error(`missing action assets ${definition.id}`);
      return [slot, {
        id: definition.id,
        slot,
        behavior: definition.behavior,
        visual,
        audio: actionAudio || null,
      }];
    }));
    return {
      heroId: hero.id,
      concept: { visual: processedVisuals.get(`concept:${hero.id}`) },
      weapon: { id: hero.weapon.id, audio: weaponAudio || null },
      abilities,
    };
  });

  const inputHashes = [];
  for (const filename of (await readdir(IMAGE_MANIFEST_ROOT)).filter(name => /^group-[a-f]\.json$/i.test(name)).sort()) {
    const bytes = await readFile(path.join(IMAGE_MANIFEST_ROOT, filename));
    inputHashes.push({ path: `assets-src/imagegen/manifests/${filename}`, sha256: sha256(bytes) });
  }
  const audioBytes = await readFile(AUDIO_MANIFEST_PATH);
  inputHashes.push({ path: AUDIO_MANIFEST_RELATIVE_PATH, sha256: sha256(audioBytes) });
  const manifest = {
    schemaVersion: '1.0.0',
    authoritative: true,
    complete: missingAudio.length === 0,
    missingAudio,
    generatedFor: 'kagariai-1.0.0-rc.5',
    sourcePolicy: 'Change visual assets through recorded ImageGen inputs and audio through the versioned local DSP generator, then rebuild this manifest.',
    inputHashes,
    heroes,
  };
  manifest.contentSha256 = sha256(Buffer.from(JSON.stringify(manifest)));
  return manifest;
}

function moduleSource(manifest) {
  return `// GENERATED by tools/build_hero_asset_manifest.js. Do not hand-edit.\n` +
    `// This module is the browser/server SSOT for admitted hero presentation assets.\n\n` +
    `function deepFreeze(value) {\n` +
    `  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;\n` +
    `  for (const child of Object.values(value)) deepFreeze(child);\n` +
    `  return Object.freeze(value);\n` +
    `}\n\n` +
    `function readonlyLookup(entries) {\n` +
    `  const map = new Map(entries);\n` +
    `  return Object.freeze({\n` +
    `    get size() { return map.size; },\n` +
    `    get: key => map.get(key),\n` +
    `    has: key => map.has(key),\n` +
    `    entries: () => map.entries(),\n` +
    `    values: () => map.values(),\n` +
    `    [Symbol.iterator]: () => map[Symbol.iterator](),\n` +
    `  });\n` +
    `}\n\n` +
    `export const HERO_ASSET_MANIFEST = deepFreeze(${JSON.stringify(manifest, null, 2)});\n\n` +
    `export const HERO_ASSET_BY_ID = readonlyLookup(HERO_ASSET_MANIFEST.heroes.map(hero => [hero.heroId, hero]));\n` +
    `export const ACTION_ASSET_BY_ID = readonlyLookup(HERO_ASSET_MANIFEST.heroes.flatMap(hero => Object.values(hero.abilities).map(action => [action.id, action])));\n` +
    `export const WEAPON_ASSET_BY_ID = readonlyLookup(HERO_ASSET_MANIFEST.heroes.map(hero => [hero.weapon.id, hero.weapon]));\n\n` +
    `export const getHeroAsset = heroId => HERO_ASSET_BY_ID.get(String(heroId || '')) || null;\n` +
    `export const getActionAsset = actionId => ACTION_ASSET_BY_ID.get(String(actionId || '')) || null;\n` +
    `export const getWeaponAsset = weaponId => WEAPON_ASSET_BY_ID.get(String(weaponId || '')) || null;\n`;
}

const manifest = await buildManifest();
await mkdir(path.dirname(OUTPUT), { recursive: true });
const temporary = `${OUTPUT}.${process.pid}.tmp`;
await writeFile(temporary, moduleSource(manifest), 'utf8');
await rename(temporary, OUTPUT);
console.log(JSON.stringify({
  output: path.relative(ROOT, OUTPUT).replaceAll(path.sep, '/'),
  heroes: manifest.heroes.length,
  actions: manifest.heroes.reduce((sum, hero) => sum + Object.keys(hero.abilities).length, 0),
  complete: manifest.complete,
  missingAudio: manifest.missingAudio.length,
  contentSha256: manifest.contentSha256,
}));
