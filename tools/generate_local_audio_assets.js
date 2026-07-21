#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../shared/data/heroes.js';

export const SLOTS = Object.freeze(['secondary', 'ability1', 'ability2', 'ultimate']);
export const GENERATOR_VERSION = '1.0.0';
export const PROVIDER = 'Kagariai Local DSP';
export const SAMPLE_RATE_HZ = 44_100;
export const CHANNELS = 1;
export const BIT_DEPTH = 16;
export const CONTENT_TYPE = 'audio/wav';
export const LICENSE = 'Project-authored; no third-party samples or model weights';

const SCHEMA_VERSION = '1.0.0';
const GENERATED_FOR = 'kagariai-1.0.0-rc.5';
const GENERATED_AT = '2026-07-21T00:00:00.000Z';
const TWO_PI = Math.PI * 2;
const PCM_MAX = 32_767;

const GENERATOR_FILE = fileURLToPath(import.meta.url);
const GENERATOR_PATH = 'tools/generate_local_audio_assets.js';
const PROJECT_ROOT = path.resolve(path.dirname(GENERATOR_FILE), '..');

function fixedSeed(...parts) {
  return createHash('sha256')
    .update(parts.map(part => String(part ?? 'none')).join('\u001f'))
    .digest()
    .readUInt32LE(0);
}

function soundCategory(kind, behavior) {
  if (kind === 'weapon') {
    if (['melee', 'hybrid_melee_projectile', 'ricochet_projectile'].includes(behavior)) return 'metal';
    if (['hitscan', 'burst', 'shotgun'].includes(behavior)) return 'ballistic';
    if (['explosive', 'explosive_heal'].includes(behavior)) return 'explosive';
    if (['charge', 'beam', 'guided_projectile'].includes(behavior)) return 'energy';
    if (behavior === 'healing_projectile') return 'healing';
    return 'mechanical';
  }
  if (/dash|backstep|leap|mobility|air_/.test(behavior)) return 'mobility';
  if (/barrier|guard|redirect|fortress/.test(behavior)) return 'shield';
  if (/heal|cleanse|link_ally|ammo_restore/.test(behavior)) return 'healing';
  if (/reveal|mark|suppress|debuff|target_/.test(behavior)) return 'scan';
  if (/ignite|fire|damage|blast|detonate|airburst|barrage/.test(behavior)) return 'explosive';
  if (/anchor|pull|blade|projectile|shot|grapple/.test(behavior)) return 'metal';
  if (/cooldown|cast_delay|buff/.test(behavior)) return 'temporal';
  if (/wave|zone|field|aura|trail|ring/.test(behavior)) return 'field';
  return 'energy';
}

function durationFor(kind, slot, behavior, seed) {
  const variation = (seed % 9) / 100;
  if (slot === 'ultimate') return 1.72 + variation;
  if (kind === 'weapon') {
    if (['melee', 'shotgun', 'hitscan', 'burst'].includes(behavior)) return 0.88 + variation;
    if (behavior === 'beam') return 1.12 + variation;
    return 1.02 + variation;
  }
  return 1.12 + variation;
}

function descriptor(hero, values) {
  const category = soundCategory(values.kind, values.behavior);
  const seed = fixedSeed(values.id, values.behavior, values.slot ?? 'weapon');
  return Object.freeze({
    ...values,
    heroRole: hero.role,
    seed,
    category,
    profile: `${hero.role}.${values.kind}.${values.slot ?? 'primary'}.${category}.${hero.id}`,
    durationSec: durationFor(values.kind, values.slot, values.behavior, seed),
  });
}

export function requestedAssets() {
  const assets = [];
  for (const hero of HEROES) {
    assets.push(descriptor(hero, {
      id: hero.weapon.id,
      heroId: hero.id,
      kind: 'weapon',
      slot: null,
      behavior: hero.weapon.type,
    }));
    for (const slot of SLOTS) {
      const action = hero.abilities[slot];
      assets.push(descriptor(hero, {
        id: action.id,
        heroId: hero.id,
        kind: 'ability',
        slot,
        behavior: action.behavior,
      }));
    }
  }
  return assets;
}

export function assertValidCatalog(assets) {
  if (HEROES.length !== 18) throw new Error(`expected 18 canonical heroes, found ${HEROES.length}`);
  if (assets.length !== 90) throw new Error(`expected 90 local audio assets, found ${assets.length}`);
  const weapons = assets.filter(asset => asset.kind === 'weapon');
  const abilities = assets.filter(asset => asset.kind === 'ability');
  if (weapons.length !== 18 || abilities.length !== 72) {
    throw new Error(`expected 18 weapons and 72 abilities, found ${weapons.length} and ${abilities.length}`);
  }
  const keys = new Set();
  for (const asset of assets) {
    if (!asset.id || !asset.heroId || !asset.behavior || !Number.isInteger(asset.seed)
      || asset.seed < 0 || asset.seed > 0xffff_ffff || !asset.profile || !Number.isFinite(asset.durationSec)) {
      throw new Error(`invalid canonical audio descriptor: ${JSON.stringify(asset)}`);
    }
    if (!/^[a-z0-9_]+$/.test(asset.id) || !/^[a-z0-9_]+$/.test(asset.heroId)) {
      throw new Error(`unsafe canonical audio ID: ${asset.kind}:${asset.id}`);
    }
    if (asset.slot === 'ultimate' ? asset.durationSec < 1.5 : asset.durationSec < 0.75 || asset.durationSec > 1.35) {
      throw new Error(`invalid local audio duration for ${asset.kind}:${asset.id}: ${asset.durationSec}`);
    }
    const key = `${asset.kind}:${asset.id}`;
    if (keys.has(key)) throw new Error(`duplicate canonical audio descriptor: ${key}`);
    keys.add(key);
  }
}

const CATEGORY_MIX = Object.freeze({
  ballistic: Object.freeze({ noise: 0.72, tone: 0.12, chirp: 0.08, metal: 0.28, sub: 0.24, decay: 0.19, cutoff: 7_600, brightness: 0.88 }),
  metal: Object.freeze({ noise: 0.30, tone: 0.18, chirp: 0.16, metal: 0.64, sub: 0.30, decay: 0.34, cutoff: 5_800, brightness: 0.68 }),
  explosive: Object.freeze({ noise: 0.70, tone: 0.08, chirp: 0.06, metal: 0.12, sub: 0.62, decay: 0.46, cutoff: 3_600, brightness: 0.38 }),
  energy: Object.freeze({ noise: 0.13, tone: 0.48, chirp: 0.58, metal: 0.18, sub: 0.23, decay: 0.42, cutoff: 7_000, brightness: 0.72 }),
  mechanical: Object.freeze({ noise: 0.36, tone: 0.24, chirp: 0.12, metal: 0.42, sub: 0.22, decay: 0.28, cutoff: 5_200, brightness: 0.62 }),
  mobility: Object.freeze({ noise: 0.48, tone: 0.20, chirp: 0.62, metal: 0.08, sub: 0.15, decay: 0.32, cutoff: 6_800, brightness: 0.84 }),
  shield: Object.freeze({ noise: 0.18, tone: 0.46, chirp: 0.20, metal: 0.28, sub: 0.52, decay: 0.56, cutoff: 4_400, brightness: 0.44 }),
  healing: Object.freeze({ noise: 0.08, tone: 0.62, chirp: 0.38, metal: 0.34, sub: 0.10, decay: 0.52, cutoff: 7_400, brightness: 0.76 }),
  scan: Object.freeze({ noise: 0.10, tone: 0.52, chirp: 0.50, metal: 0.14, sub: 0.13, decay: 0.36, cutoff: 6_600, brightness: 0.70 }),
  temporal: Object.freeze({ noise: 0.12, tone: 0.52, chirp: 0.46, metal: 0.38, sub: 0.19, decay: 0.50, cutoff: 6_200, brightness: 0.68 }),
  field: Object.freeze({ noise: 0.26, tone: 0.48, chirp: 0.24, metal: 0.16, sub: 0.42, decay: 0.62, cutoff: 4_800, brightness: 0.52 }),
});

function makeRng(seed) {
  let state = seed || 0x6d2b79f5;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x1_0000_0000;
  };
}

function smoothstep(value) {
  const x = Math.max(0, Math.min(1, value));
  return x * x * (3 - 2 * x);
}

function synthesisParameters(asset) {
  const mix = CATEGORY_MIX[asset.category] || CATEGORY_MIX.energy;
  const rolePitch = asset.heroRole === 'frontline' ? 0.78 : asset.heroRole === 'support' ? 1.12 : 1.30;
  const heroPitch = 94 + (asset.seed % 173);
  const seedUnit = ((asset.seed >>> 8) & 0xffff) / 0xffff;
  const sweepDirection = ['mobility', 'healing', 'scan'].includes(asset.category) ? 1 : -1;
  return {
    ...mix,
    baseHz: heroPitch * rolePitch,
    chirpStartHz: (heroPitch * rolePitch) * (sweepDirection > 0 ? 1.1 : 5.2),
    chirpEndHz: (heroPitch * rolePitch) * (sweepDirection > 0 ? 5.6 : 0.82),
    signatureHz: 420 + ((asset.seed >>> 16) % 1_180),
    seedUnit,
    ultimate: asset.slot === 'ultimate',
    weapon: asset.kind === 'weapon',
  };
}

export function synthesizeWav(asset) {
  const params = synthesisParameters(asset);
  const frameCount = Math.round(asset.durationSec * SAMPLE_RATE_HZ);
  const durationSec = frameCount / SAMPLE_RATE_HZ;
  const samples = new Float64Array(frameCount);
  const rng = makeRng(asset.seed);
  const partialRatios = [1.00, 1.371, 2.113, 3.779];
  const partialPhases = partialRatios.map(() => rng() * TWO_PI);
  const partialDetune = partialRatios.map(() => 0.97 + rng() * 0.07);
  const partialAmplitudes = [0.50, 0.28, 0.15, 0.08];
  const noiseAlpha = 1 - Math.exp(-TWO_PI * Math.min(12_000, params.cutoff) / SAMPLE_RATE_HZ);
  const heroPulseStart = 0.13 + params.seedUnit * 0.13;
  const pulseCount = 1 + ((asset.seed >>> 28) % 3);
  const tailSec = params.ultimate ? 0.19 : 0.13;
  let lowNoise = 0;
  let mainPhase = rng() * TWO_PI;
  let subPhase = rng() * TWO_PI;
  let chirpPhase = rng() * TWO_PI;
  let peak = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const t = index / SAMPLE_RATE_HZ;
    const progress = t / durationSec;
    const attack = smoothstep(t / (params.weapon ? 0.0012 : 0.0020));
    const fade = smoothstep((durationSec - t) / tailSec);
    const transientEnvelope = Math.exp(-t / (params.weapon ? 0.020 : 0.030));
    const bodyEnvelope = Math.exp(-t / params.decay);
    const longEnvelope = Math.exp(-t / (params.decay * (params.ultimate ? 2.6 : 1.65)));

    const white = rng() * 2 - 1;
    lowNoise += noiseAlpha * (white - lowNoise);
    const highNoise = white - lowNoise;
    const coloredNoise = highNoise * params.brightness + lowNoise * (1 - params.brightness) * 2.2;

    const pitchDrop = 1 + 0.28 * Math.exp(-t / 0.055);
    mainPhase += TWO_PI * params.baseHz * pitchDrop / SAMPLE_RATE_HZ;
    subPhase += TWO_PI * params.baseHz * 0.47 / SAMPLE_RATE_HZ;
    const chirpProgress = smoothstep(Math.min(1, t / (params.ultimate ? 0.72 : 0.34)));
    const chirpHz = params.chirpStartHz + (params.chirpEndHz - params.chirpStartHz) * chirpProgress;
    chirpPhase += TWO_PI * chirpHz / SAMPLE_RATE_HZ;

    let metal = 0;
    for (let partial = 0; partial < partialRatios.length; partial += 1) {
      partialPhases[partial] += TWO_PI * params.baseHz * partialRatios[partial] * partialDetune[partial] / SAMPLE_RATE_HZ;
      metal += Math.sin(partialPhases[partial]) * partialAmplitudes[partial];
    }

    const tonal = Math.sin(mainPhase) * 0.68 + Math.sin(mainPhase * 1.997 + params.seedUnit) * 0.22;
    const sub = Math.sin(subPhase);
    const chirp = Math.sin(chirpPhase);
    const click = coloredNoise * 0.72 + Math.sin(TWO_PI * (2_400 + params.signatureHz) * t) * 0.28;
    let value = transientEnvelope * (click * (0.64 + params.noise * 0.34) + sub * params.sub * 0.64);
    value += bodyEnvelope * (
      coloredNoise * params.noise * 0.52
      + tonal * params.tone
      + chirp * params.chirp * 0.58
      + metal * params.metal * 0.60
      + sub * params.sub * 0.40
    );

    if (t >= heroPulseStart) {
      const local = t - heroPulseStart;
      const pulseEnvelope = smoothstep(local / 0.003) * Math.exp(-local / 0.16);
      value += Math.sin(TWO_PI * params.signatureHz * local) * pulseEnvelope * 0.22;
    }
    for (let pulse = 0; pulse < pulseCount; pulse += 1) {
      const start = 0.24 + pulse * (params.ultimate ? 0.28 : 0.19);
      if (t < start) continue;
      const local = t - start;
      const pulseEnvelope = smoothstep(local / 0.0025) * Math.exp(-local / (0.055 + params.seedUnit * 0.035));
      const pulseHz = params.signatureHz * (1 + pulse * 0.17);
      value += (Math.sin(TWO_PI * pulseHz * local) * 0.24 + coloredNoise * 0.10) * pulseEnvelope;
    }

    if (params.ultimate) {
      const rise = smoothstep(Math.min(1, t / 0.42)) * Math.exp(-t / 1.20);
      value += (Math.sin(TWO_PI * (params.baseHz * 0.31 + 24 * progress) * t) * 0.32
        + Math.sin(TWO_PI * params.baseHz * 1.51 * t) * 0.13) * rise;
      const accentStart = durationSec * 0.57;
      if (t >= accentStart) {
        const local = t - accentStart;
        const accent = smoothstep(local / 0.002) * Math.exp(-local / 0.20);
        value += (coloredNoise * 0.35 + Math.sin(TWO_PI * params.baseHz * 0.58 * local) * 0.55) * accent;
      }
    }

    value *= attack * fade * (0.88 + longEnvelope * 0.12);
    if (!Number.isFinite(value)) throw new Error(`non-finite DSP sample for ${asset.kind}:${asset.id}`);
    samples[index] = value;
    peak = Math.max(peak, Math.abs(value));
  }

  if (peak < 1e-6) throw new Error(`silent DSP output for ${asset.kind}:${asset.id}`);
  const targetPeak = params.ultimate ? 0.91 : params.weapon ? 0.89 : 0.90;
  const gain = targetPeak / peak;
  const dataBytes = frameCount * 2;
  const wav = Buffer.alloc(44 + dataBytes);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(36 + dataBytes, 4);
  wav.write('WAVE', 8, 'ascii');
  wav.write('fmt ', 12, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  wav.writeUInt32LE(SAMPLE_RATE_HZ * CHANNELS * (BIT_DEPTH / 8), 28);
  wav.writeUInt16LE(CHANNELS * (BIT_DEPTH / 8), 32);
  wav.writeUInt16LE(BIT_DEPTH, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(dataBytes, 40);
  for (let index = 0; index < frameCount; index += 1) {
    const normalized = Math.max(-0.999, Math.min(0.999, samples[index] * gain));
    wav.writeInt16LE(Math.round(normalized * PCM_MAX), 44 + index * 2);
  }
  return wav;
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function relativeAssetPath(value) {
  return value.split(path.sep).join('/');
}

let tempSerial = 0;
async function atomicWrite(destination, bytes, force = false) {
  try {
    const existing = await readFile(destination);
    if (existing.equals(bytes)) return 'unchanged';
    if (!force) throw new Error(`refusing to overwrite non-matching generated asset without --force: ${destination}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await mkdir(path.dirname(destination), { recursive: true });
  const temp = `${destination}.${process.pid}.${tempSerial++}.partial`;
  try {
    await writeFile(temp, bytes);
    await rename(temp, destination);
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
  return 'written';
}

function rooted(root, relativePath) {
  const destination = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, destination);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`generated asset escaped output root: ${relativePath}`);
  }
  return destination;
}

async function generateAssets(root, assets, force) {
  const records = [];
  for (const asset of assets) {
    const bytes = synthesizeWav(asset);
    const hash = sha256(bytes);
    const sourcePath = `assets-src/local-audio/raw/${asset.kind}/${asset.id}.wav`;
    const runtimeDirectory = asset.kind === 'weapon' ? 'weapons' : 'abilities';
    const runtimePath = `client/assets/generated/audio/${runtimeDirectory}/${asset.id}.${hash.slice(0, 12)}.wav`;
    await atomicWrite(rooted(root, sourcePath), bytes, force);
    await atomicWrite(rooted(root, runtimePath), bytes, force);
    records.push({
      id: asset.id,
      heroId: asset.heroId,
      kind: asset.kind,
      slot: asset.slot,
      behavior: asset.behavior,
      seed: asset.seed,
      profile: asset.profile,
      durationSec: bytes.readUInt32LE(40) / (SAMPLE_RATE_HZ * CHANNELS * (BIT_DEPTH / 8)),
      sourcePath,
      runtimePath,
      runtimeUrl: `/${runtimePath}`,
      sha256: hash,
      bytes: bytes.length,
      contentType: CONTENT_TYPE,
      generatedAt: GENERATED_AT,
    });
  }
  const manifest = {
    schemaVersion: SCHEMA_VERSION,
    authoritative: true,
    provider: PROVIDER,
    generatorVersion: GENERATOR_VERSION,
    generatorPath: GENERATOR_PATH,
    generatorSha256: sha256(await readFile(GENERATOR_FILE)),
    sampleRateHz: SAMPLE_RATE_HZ,
    channels: CHANNELS,
    bitDepth: BIT_DEPTH,
    contentType: CONTENT_TYPE,
    license: LICENSE,
    generatedFor: GENERATED_FOR,
    assets: records,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const manifestPath = 'assets-src/local-audio/manifest.json';
  await atomicWrite(rooted(root, manifestPath), manifestBytes, true);
  return { manifest, manifestPath };
}

function optionValue(argv, name) {
  const index = argv.indexOf(name);
  if (index < 0) return null;
  if (!argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}

export function parseArgs(argv = process.argv.slice(2)) {
  const known = new Set(['--check', '--force', '--root']);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!known.has(argument)) throw new Error(`unknown argument: ${argument}`);
    if (argument === '--root') index += 1;
  }
  return {
    check: argv.includes('--check'),
    force: argv.includes('--force'),
    root: path.resolve(optionValue(argv, '--root') || PROJECT_ROOT),
  };
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const options = parseArgs(argv);
  const assets = requestedAssets();
  assertValidCatalog(assets);
  const summary = {
    mode: options.check ? 'check' : 'generate',
    assets: assets.length,
    weapons: assets.filter(asset => asset.kind === 'weapon').length,
    abilities: assets.filter(asset => asset.kind === 'ability').length,
    sampleRateHz: SAMPLE_RATE_HZ,
    channels: CHANNELS,
    bitDepth: BIT_DEPTH,
    provider: PROVIDER,
    generatorVersion: GENERATOR_VERSION,
  };
  if (!options.check) {
    const generated = await generateAssets(options.root, assets, options.force);
    summary.manifest = generated.manifestPath;
  }
  log(JSON.stringify(summary));
  return summary;
}

export async function runCli(argv = process.argv.slice(2), log = console.log, logError = console.error) {
  try {
    await main(argv, log);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Local DSP generation failed: ${message}`);
    return 1;
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) process.exitCode = await runCli();
