#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../shared/data/heroes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_ROOT = path.join(ROOT, 'assets-src', 'elevenlabs');
const RAW_ROOT = path.join(SOURCE_ROOT, 'raw');
const RUNTIME_ROOT = path.join(ROOT, 'client', 'assets', 'generated', 'audio');
const MANIFEST_PATH = path.join(SOURCE_ROOT, 'manifest.json');
const ENDPOINT = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL_ID = 'eleven_text_to_sound_v2';
const OUTPUT_FORMAT = 'mp3_44100_192';
export const MAX_PROMPT_CHARS = 450;

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = Math.max(1, Math.min(6, Number(argValue('concurrency', 3)) || 3));
const ONLY = argValue('only');
const API_KEY = process.env.ELEVENLABS_API_KEY?.trim();

const BEHAVIOR_SOUND = Object.freeze({
  anchor_recall: 'a heavy chain rapidly retracting through steel guides, ending in a magnetic lock clunk',
  anchor_launch: 'a forged anchor launching with chain rattle, fast air tear, and a compact ground impact',
  rewind_marker: 'a reverse-time suction sweep, granular tape rewind, and a precise arrival snap',
  ring_barrier: 'a massive circular energy barrier unfolding with metal resonance and a low protective pulse',
  guard: 'armor plates bracing together with a dense defensive energy thump',
  barrier: 'a hard-light barricade deploying from the ground with a weighty locking impact',
  cone_blast: 'a short-range compressed blast cone with a concussive air punch',
  fortress_buff: 'layered armor sealing around allies with a deep forge pulse and rising power tone',
  projectile_field: 'a dense spatial field activating, bending fast objects with a taut energy shimmer',
  dash: 'a forceful tactical dash whoosh with a sharp energy release and clean stop',
  field_detonate: 'a contained field collapsing inward, scattering fragments, then detonating in a tight pulse',
  hud_suppress_zone: 'an ominous electronic veil expanding with muffled radio interference and spatial pressure',
  target_debuff: 'a precise hostile mark attaching with a dark needle hit and descending warning tone',
  line_pull: 'a tether latching at range and violently pulling back with cable tension',
  barrier_corridor: 'multiple protective wall segments rising in sequence with heavy synchronized locks',
  team_wave: 'a broad pressurized wave surging forward with water weight and a powerful protective crest',
  precision_shot: 'a focused high-velocity precision discharge with a dry mechanical crack',
  mark_shot: 'a scanning shot impact followed by a clean target-lock confirmation chirp',
  team_reveal: 'a wide tactical scan sweeping the battlefield with layered locator pings',
  cleanse_mobility: 'a clean dispersal sweep stripping interference, followed by a light acceleration whoosh',
  reveal_trap: 'a compact sensor trap arming with crystalline clicks and one focused sonar ping',
  backstep: 'a rapid reverse propulsion burst with cloth snap and a controlled landing',
  self_buff: 'personal combat systems surging online with a rising resonant power layer',
  charged_shot: 'energy winding tightly into a blade-like projectile and releasing with a hard snap',
  air_dash: 'aerial direction change with a sharp pressure crack and slicing wind trail',
  blade_recall: 'multiple thrown blades reversing course through the air and locking into place',
  ignite_target: 'a compact ignition spark blooming into a focused chemical flame burst',
  status_blast: 'a sticky payload bursting across a small area with wet impact and status crackle',
  damage_aura: 'a dangerous close-range fire aura erupting and pulsing with furnace pressure',
  airburst: 'an airborne shell popping into a crisp radial firework burst with controlled debris',
  damage_zone: 'an armed explosive flower opening and sustaining a threatening crackling zone',
  barrage_zone: 'a rapid sequence of distant artillery impacts converging on one marked area',
  target_reveal: 'a guided locator attaching to a target with sonar lock and a tense tracking tone',
  seeking_blast: 'a compact projectile accelerating into a curved pursuit with a sharp impact',
  homing_barrage: 'several guided projectiles launching in sequence and converging in layered impacts',
  ammo_restore: 'fine metal needles replenishing into a magazine with rapid precise clicks',
  ally_grapple: 'a silk cable firing, latching safely, and pulling with a smooth elastic rush',
  release_stored_heal: 'stored healing energy releasing as warm layered pulses and delicate thread chimes',
  stored_heal_burst: 'many healing threads resonating together before a large restorative bloom',
  zone_dash: 'a temporal dash carving through a field with clockwork ticks and a clean phase exit',
  cooldown_zone: 'a time-acceleration zone starting with synchronized ticks and a bright rotating pulse',
  cast_delay_zone: 'a heavy time-dilation field descending with stretched ticks and viscous pressure',
  team_cooldown_buff: 'allied mechanisms accelerating together in a confident rhythmic time surge',
  projectile_guard: 'a reinforced umbrella deflecting fast projectiles with layered metallic ricochets',
  team_guard: 'a vast protective canopy opening with fabric tension, metal ribs, and a deep shield pulse',
  link_ally: 'a musical energy link connecting two allies with a tuned string resonance',
  ally_damage_buff: 'an allied weapon becoming harmonically amplified with a bright overtone rise',
  team_damage_buff: 'a full ensemble chord locking into tempo and releasing a powerful battle resonance',
  healing_trail: 'a fast migration trail of warm fire and restorative wind flowing across the ground',
  leap_heal: 'an upward wing-assisted leap, soft aerial arc, and broad restorative landing pulse',
  redirect_link: 'living vines rapidly linking allies with fiber tension and a protective heartbeat',
  release_redirect: 'a taut pain-transfer vine snapping outward in a controlled retaliatory burst',
  cleanse_burst: 'thorned vines shedding harmful energy in a clean outward purifying shockwave',
  team_redirect: 'a huge network of protective vines spreading through the team with deep organic resonance',
});

function sonicRole(role) {
  if (role === 'frontline') return 'weighty low-mid body and a strong tactical transient';
  if (role === 'support') return 'clear harmonic detail and a readable supportive transient';
  return 'fast aggressive detail, crisp transient, controlled low end';
}

export function actionPrompt(hero, slot, action) {
  const described = BEHAVIOR_SOUND[action.behavior]
    || `${String(action.behavior).replaceAll('_', ' ')} activating with a clear start, motion, and resolved impact`;
  const scale = slot === 'ultimate'
    ? 'signature ultimate one-shot, cinematic authority, powerful sub impact, memorable final accent'
    : 'compact one-shot, immediate readable attack, short controlled tail';
  return [
    `AAA hero-shooter SFX for ${hero.id}/${action.id}: ${described}.`,
    `${sonicRole(hero.role)}; ${scale}.`,
    'Professional dry centered mix; no voice, music, ambience, copyrighted motif, long silence, excessive reverb, or clipping.',
  ].join(' ');
}

export function weaponPrompt(hero) {
  const weapon = hero.weapon;
  const phrases = {
    hybrid_melee_projectile: 'heavy chain-spear launch with mechanical tension, steel scrape, air tear, and compact impact body',
    melee: 'massive forged melee swing with close air displacement and dense metal impact',
    charge: 'precision energy weapon charging quickly and releasing a focused high-velocity discharge',
    hitscan: 'modern precision rifle shot with crisp mechanical action, controlled ballistic crack, and compact low body',
    burst: 'tight tactical burst rifle discharge with distinct mechanical cadence and controlled punch',
    explosive: 'compact launcher shot with mechanical thunk, projectile rush, and restrained explosive body',
    ricochet_projectile: 'razor-sharp thrown blade launch with metal singing, air slice, and small ricochet accent',
    shotgun: 'heavy close-range scattergun blast with dense punch, mechanical body, and short tail',
    guided_projectile: 'guided projectile launch with ignition snap, accelerating motor, and tracking shimmer',
    healing_projectile: 'precise healing needle launch with tactile mechanism, silk-like air cut, and warm chime',
    deploy: 'compact device launch and deploy with mechanical click, air travel, and armed confirmation',
    beam: 'short focused combat beam pulse with electrical bite and a clean power cutoff',
    explosive_heal: 'warm flare launcher shot with tactile mechanism, bright ignition, and restorative sparkle',
  };
  return [
    `AAA competitive hero-shooter weapon one-shot for ${hero.id}, ${weapon.id}: ${phrases[weapon.type] || phrases.hitscan}.`,
    `${sonicRole(hero.role)}. Professionally designed dry game SFX, immediate transient, short controlled tail, no dialogue, no vocals, no music, no ambience, no copyrighted sound, no clipping.`,
  ].join(' ');
}

export function requestedAssets(only = ONLY) {
  const items = [];
  for (const hero of HEROES) {
    items.push({
      id: hero.weapon.id,
      heroId: hero.id,
      kind: 'weapon',
      slot: null,
      behavior: hero.weapon.type,
      durationSeconds: hero.weapon.type === 'beam' ? 0.8 : 1.2,
      promptInfluence: 0.5,
      prompt: weaponPrompt(hero),
    });
    for (const [slot, action] of Object.entries(hero.abilities)) {
      items.push({
        id: action.id,
        heroId: hero.id,
        kind: 'ability',
        slot,
        behavior: action.behavior,
        durationSeconds: slot === 'ultimate' ? 2.8 : 1.6,
        promptInfluence: slot === 'ultimate' ? 0.58 : 0.52,
        prompt: actionPrompt(hero, slot, action),
      });
    }
  }
  return only ? items.filter(item => item.id === only || item.heroId === only) : items;
}

export function assertValidRequests(items) {
  if (items.length === 0) throw new Error(`No ElevenLabs assets matched --only ${ONLY || '(none)'}`);
  const duplicateIds = items
    .map(item => `${item.kind}:${item.id}`)
    .filter((key, index, keys) => keys.indexOf(key) !== index);
  if (duplicateIds.length) throw new Error(`Duplicate ElevenLabs asset IDs: ${duplicateIds.join(', ')}`);
  const overLimit = items.filter(item => item.prompt.length > MAX_PROMPT_CHARS);
  if (overLimit.length) {
    throw new Error(`ElevenLabs prompt limit exceeded: ${overLimit.map(item => `${item.id}=${item.prompt.length}`).join(', ')}`);
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function shouldRetryElevenLabs(status, detail = '') {
  if (Number(status) >= 500) return true;
  if (Number(status) !== 429) return false;
  return !/quota[_ -]?exceeded|insufficient[_ -]?(credits|quota)/i.test(String(detail));
}

async function existingManifest() {
  try {
    const parsed = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    return new Map((parsed.assets || []).map(asset => [`${asset.kind}:${asset.id}`, asset]));
  } catch (error) {
    if (error?.code === 'ENOENT') return new Map();
    throw error;
  }
}

let manifestWrite = Promise.resolve();
let manifestSerial = 0;
function persistManifest(records) {
  manifestWrite = manifestWrite.then(async () => {
    const assets = [...records.values()].sort((a, b) => `${a.heroId}:${a.kind}:${a.id}`.localeCompare(`${b.heroId}:${b.kind}:${b.id}`));
    const manifest = {
      schemaVersion: '1.0.0',
      authoritative: true,
      provider: 'ElevenLabs',
      endpoint: ENDPOINT,
      modelId: MODEL_ID,
      outputFormat: OUTPUT_FORMAT,
      generatedFor: 'kagariai-1.0.0-rc.5',
      assets,
    };
    await mkdir(SOURCE_ROOT, { recursive: true });
    const temp = `${MANIFEST_PATH}.${process.pid}.${manifestSerial++}.tmp`;
    await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    await rename(temp, MANIFEST_PATH);
  });
  return manifestWrite;
}

async function isRecordedAssetValid(record) {
  if (!record?.sourcePath || !record?.runtimePath || !record?.sha256) return false;
  try {
    const [source, runtime] = await Promise.all([
      readFile(path.join(ROOT, record.sourcePath)),
      readFile(path.join(ROOT, record.runtimePath)),
    ]);
    return sha256(source) === record.sha256 && sha256(runtime) === record.sha256;
  } catch {
    return false;
  }
}

async function fetchWithRetry(item, attempts = 4) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const url = `${ENDPOINT}?output_format=${encodeURIComponent(OUTPUT_FORMAT)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'xi-api-key': API_KEY,
        },
        body: JSON.stringify({
          text: item.prompt,
          duration_seconds: item.durationSeconds,
          prompt_influence: item.promptInfluence,
          loop: false,
          model_id: MODEL_ID,
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const detail = (await response.text()).slice(0, 500);
        const retryable = shouldRetryElevenLabs(response.status, detail);
        const error = new Error(`ElevenLabs ${response.status} for ${item.id}: ${detail}`);
        error.retryable = retryable;
        if (!retryable) throw error;
        lastError = error;
      } else {
        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('audio/')) throw new Error(`Unexpected content-type for ${item.id}: ${contentType}`);
        const bytes = Buffer.from(await response.arrayBuffer());
        if (bytes.length < 1_000) throw new Error(`Generated audio is implausibly small for ${item.id}: ${bytes.length}`);
        return {
          bytes,
          characterCost: Number(response.headers.get('character-cost')) || null,
          requestId: response.headers.get('request-id') || null,
          contentType,
        };
      }
    } catch (error) {
      if (error?.retryable === false) throw error;
      lastError = error;
      if (attempt === attempts) break;
    }
    await new Promise(resolve => setTimeout(resolve, Math.min(12_000, 800 * (2 ** (attempt - 1)))));
  }
  throw lastError;
}

async function generateOne(item, records) {
  const key = `${item.kind}:${item.id}`;
  const existing = records.get(key);
  if (await isRecordedAssetValid(existing)) {
    console.log(`[skip] ${key} ${existing.sha256.slice(0, 12)}`);
    return;
  }
  if (existing) throw new Error(`Recorded asset failed hash validation: ${key}`);

  const rawDirectory = path.join(RAW_ROOT, item.kind);
  await mkdir(rawDirectory, { recursive: true });
  const rawPath = path.join(rawDirectory, `${item.id}-v1.mp3`);
  try {
    await stat(rawPath);
    throw new Error(`Untracked source already exists; refusing to overwrite: ${path.relative(ROOT, rawPath)}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  const generated = await fetchWithRetry(item);
  const hash = sha256(generated.bytes);
  const runtimeDirectory = path.join(RUNTIME_ROOT, item.kind === 'weapon' ? 'weapons' : 'abilities');
  const runtimePath = path.join(runtimeDirectory, `${item.id}.${hash.slice(0, 12)}.mp3`);
  await mkdir(runtimeDirectory, { recursive: true });
  const rawTemp = `${rawPath}.${process.pid}.partial`;
  const runtimeTemp = `${runtimePath}.${process.pid}.partial`;
  await Promise.all([
    writeFile(rawTemp, generated.bytes),
    writeFile(runtimeTemp, generated.bytes),
  ]);
  await rename(rawTemp, rawPath);
  await rename(runtimeTemp, runtimePath);

  const record = {
    id: item.id,
    heroId: item.heroId,
    kind: item.kind,
    slot: item.slot,
    behavior: item.behavior,
    provider: 'ElevenLabs',
    modelId: MODEL_ID,
    outputFormat: OUTPUT_FORMAT,
    requestedDurationSec: item.durationSeconds,
    promptInfluence: item.promptInfluence,
    prompt: item.prompt,
    sourcePath: path.relative(ROOT, rawPath).replaceAll(path.sep, '/'),
    runtimePath: path.relative(ROOT, runtimePath).replaceAll(path.sep, '/'),
    runtimeUrl: `/${path.relative(ROOT, runtimePath).replaceAll(path.sep, '/')}`,
    sha256: hash,
    bytes: generated.bytes.length,
    characterCost: generated.characterCost,
    requestId: generated.requestId,
    contentType: generated.contentType,
    generatedAt: new Date().toISOString(),
  };
  records.set(key, record);
  await persistManifest(records);
  console.log(`[generated] ${key} bytes=${record.bytes} cost=${record.characterCost ?? 'unknown'} sha256=${hash.slice(0, 12)}`);
}

async function mapConcurrent(items, workerCount, worker) {
  let cursor = 0;
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      await worker(items[index]);
    }
  });
  await Promise.all(workers);
}

async function main() {
  const assets = requestedAssets();
  assertValidRequests(assets);
  const estimatedCredits = assets.reduce((sum, item) => sum + Math.ceil(item.durationSeconds * 40), 0);
  console.log(JSON.stringify({ assets: assets.length, concurrency: CONCURRENCY, estimatedCredits, dryRun: DRY_RUN, only: ONLY || null }));
  if (DRY_RUN) return;
  if (!API_KEY) throw new Error('ELEVENLABS_API_KEY is required in the process environment; it is never read from source files.');

  const records = await existingManifest();
  await mapConcurrent(assets, CONCURRENCY, item => generateOne(item, records));
  await manifestWrite;

  const expected = new Set(requestedAssets().map(item => `${item.kind}:${item.id}`));
  const valid = [...expected].filter(key => records.has(key));
  console.log(JSON.stringify({ completed: valid.length, requested: expected.size, manifest: path.relative(ROOT, MANIFEST_PATH).replaceAll(path.sep, '/') }));
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) await main();
