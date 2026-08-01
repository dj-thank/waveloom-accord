#!/usr/bin/env node
/**
 * Creates the second, deliberately bounded ElevenLabs candidate pilot.
 * It fills the UI/objective/movement/ambient/Foley gap left by the existing
 * weapon, ability, BGM, and Japanese operations-voice candidates. This file
 * never reads credentials or sends network traffic.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = process.argv[2] || 'outputs/audio-factory-20260730/manifests/aaa-pilot-002.json';
const ENDPOINT = '/v1/sound-generation?output_format=mp3_44100_192';
const MODEL_ID = 'eleven_text_to_sound_v2';
const UNIVERSAL_RIGHTS_CONSTRAINT = ' No real person, existing IP, artist, song, or brand reference.';

const briefs = [
  ['ui-confirm', 'ui', 0.5, false, 0.74, 'Gameplay UI confirmation one-shot for a fictional competitive coastal stone-city game: a compact ceramic click followed by a warm brass pin, 0.5 seconds, close interface perspective, crisp 2 to 5 kHz attack with restrained low end. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['ui-cancel', 'ui', 0.5, false, 0.7, 'Gameplay UI cancel one-shot for a fictional competitive coastal stone-city game: a soft reversed ceramic tap that resolves downward, 0.5 seconds, close interface perspective, lower and gentler than confirmation, clear transient without alarm. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['ui-focus', 'ui', 0.5, false, 0.68, 'Gameplay UI focus one-shot for a fictional competitive coastal stone-city game: a tiny polished sea-glass tick with a dry ceramic accent, 0.5 seconds, close interface perspective, light high-frequency detail and nearly no bass. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['ui-hit-confirm', 'ui', 0.5, false, 0.76, 'Gameplay hit-confirm one-shot for a fictional competitive coastal stone-city game: a precise brass-and-ceramic snap with a short luminous tail, 0.5 seconds, first-person HUD perspective, strong but non-painful 2 to 4 kHz identity, compact low end. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['ui-damage-taken', 'ui', 0.5, false, 0.72, 'Gameplay damage-warning one-shot for a fictional competitive coastal stone-city game: a brief muted bronze knock and dry air pulse, 0.5 seconds, first-person HUD perspective, urgent but clearly different from hit confirmation, no sub-bass. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['objective-capture-start', 'objective', 1.4, false, 0.72, 'Gameplay objective capture-start one-shot for a fictional competitive coastal stone-city game: three measured ceramic markers, a low bronze anchor, and a clean rising final tone, 1.4 seconds, open plaza perspective, readable over combat with controlled bass. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['objective-capture-tick', 'objective', 0.7, false, 0.7, 'Gameplay objective capture-progress tick for a fictional competitive coastal stone-city game: a single small ceramic pulse with a stable brass core, 0.7 seconds, neutral plaza perspective, deliberate and not alarm-like, clear midrange signature. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['objective-contested', 'objective', 1.2, false, 0.76, 'Gameplay contested-objective warning for a fictional competitive coastal stone-city game: staggered low ceramic knocks meet a tense wind-chime scrape, 1.2 seconds, plaza perspective, urgent but not a siren, controlled low end and clear 800 Hz to 2.5 kHz core. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['objective-transition', 'objective', 1, false, 0.72, 'Gameplay objective-rotation transition one-shot for a fictional competitive coastal stone-city game: a quick stone mallet turn, airy brass lift, and concise ceramic landing, 1 second, broad map perspective, confident without cinematic boom. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-stone-footstep', 'movement', 0.5, false, 0.68, 'Gameplay movement one-shot: one boot step onto sun-warmed rough stone in a fictional coastal arena, 0.5 seconds, close third-person perspective, dry heel-to-toe texture with a short natural tail and restrained bass. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-wood-footstep', 'movement', 0.5, false, 0.68, 'Gameplay movement one-shot: one boot step onto weathered dock wood in a fictional coastal arena, 0.5 seconds, close third-person perspective, hollow but compact grain detail, distinct from stone. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-ceramic-footstep', 'movement', 0.5, false, 0.68, 'Gameplay movement one-shot: one boot step across small ceramic tiles in a fictional coastal arena, 0.5 seconds, close third-person perspective, crisp tile contact and light grit, no brittle piercing high end. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-wet-stone-footstep', 'movement', 0.5, false, 0.68, 'Gameplay movement one-shot: one boot step onto wet stone near a seawater channel in a fictional coastal arena, 0.5 seconds, close third-person perspective, damp contact with a tiny water displacement, compact and not splashy. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-stone-jump', 'movement', 0.5, false, 0.7, 'Gameplay movement one-shot: a controlled launch from stone in a fictional coastal arena, 0.5 seconds, close third-person perspective, a brief shoe scrape and airy lift, no explosive impact. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-stone-land', 'movement', 0.6, false, 0.72, 'Gameplay movement one-shot: a controlled athletic landing on rough stone in a fictional coastal arena, 0.6 seconds, close third-person perspective, compact sole impact, short cloth shift, and stable low-mid body. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['move-cloth-sprint', 'movement', 0.7, false, 0.65, 'Gameplay movement one-shot: a short sprint cloth and equipment rustle for a fictional coastal arena, 0.7 seconds, close third-person perspective, soft woven fabric and small leather movement, no footsteps. No speech, no music, no real brand, no recognizable existing game sound, no clipping.'],
  ['ambient-coastal-wind', 'ambient', 12, true, 0.64, 'Seamless gameplay ambience loop for a fictional sunlit coastal stone city: steady sea wind moving through narrow stone alleys and canvas awnings, 12 seconds, medium outdoor perspective, sparse and low-density with no gull calls, no voices, no music, no real place reference, no clipping.'],
  ['ambient-canal-water', 'ambient', 12, true, 0.62, 'Seamless gameplay ambience loop for a fictional coastal stone city: calm canal water touching masonry and a distant wooden mooring creak, 12 seconds, medium outdoor perspective, gentle rhythmic water detail with broad frequency space for combat. No voices, no music, no real place reference, no clipping.'],
  ['ambient-market-canopy', 'ambient', 12, true, 0.62, 'Seamless gameplay ambience loop for a fictional stone-market lane: soft canvas movement, distant ceramic handling, and light open-air wind, 12 seconds, medium outdoor perspective, no crowd speech, no animals, no music, no real place reference, no clipping.'],
  ['ambient-rooftop-canvas', 'ambient', 12, true, 0.62, 'Seamless gameplay ambience loop for fictional lantern rooftops: elevated sea wind, intermittent canvas flutter, and one distant small bronze bell movement, 12 seconds, medium outdoor perspective, sparse and tactically quiet. No voices, no music, no real place reference, no clipping.'],
  ['foley-rope-creak', 'foley', 0.7, false, 0.66, 'Gameplay Foley one-shot: a short tensioned ship rope creak against a weathered wooden post in a fictional coastal arena, 0.7 seconds, close object perspective, fibrous texture and compact tail. No speech, no music, no real brand, no clipping.'],
  ['foley-lantern-bronze-tap', 'foley', 0.5, false, 0.68, 'Gameplay Foley one-shot: a small weathered bronze lantern gently tapping its stone bracket in a fictional coastal arena, 0.5 seconds, close object perspective, warm metal body without sharp ringing. No speech, no music, no real brand, no clipping.'],
  ['foley-ceramic-vessel-set', 'foley', 0.7, false, 0.68, 'Gameplay Foley one-shot: a small glazed ceramic vessel set down on a rough stone counter in a fictional coastal arena, 0.7 seconds, close object perspective, one rounded contact and a quiet ceramic resonance. No speech, no music, no real brand, no clipping.'],
  ['foley-canal-drip', 'foley', 0.7, false, 0.64, 'Gameplay Foley one-shot: a single water drip into a shallow stone canal in a fictional coastal arena, 0.7 seconds, close object perspective, detailed small ripple with no large splash. No speech, no music, no real brand, no clipping.'],
];

const estimatedCredits = durationSeconds => Math.ceil(durationSeconds * 40);

export function buildManifest() {
  const assets = briefs.map(([slug, family, durationSeconds, loop, promptInfluence, text]) => ({
    id: `aaa.pilot002.sfx.${slug}.v001`,
    kind: 'sound_effect',
    family,
    endpoint: ENDPOINT,
    output: `generated/sfx/${slug}-v001.mp3`,
    estimatedCredits: estimatedCredits(durationSeconds),
    candidateStatus: 'pending_technical_qc',
    rights: 'original fictional material only; no source audio, real-person voice, artist, existing-IP, or brand reference',
    qc: { durationSeconds, loop, expectedCodec: 'mp3', expectedSampleRate: 44100, expectedChannels: 'mono-or-stereo' },
    request: { text: `${text}${UNIVERSAL_RIGHTS_CONSTRAINT}`, model_id: MODEL_ID, duration_seconds: durationSeconds, prompt_influence: promptInfluence, loop },
  }));
  const totalCredits = assets.reduce((sum, asset) => sum + asset.estimatedCredits, 0);
  return {
    schemaVersion: 1,
    wave: 'aaa-pilot-002',
    purpose: 'Bounded candidate-only gap-fill pilot for UI, objective readability, movement, ambient loops, and Foley. It never replaces the Local DSP runtime contract before technical, competitive, creative, rights, and human review.',
    executionBudget: { maxAssets: assets.length, maxEstimatedCredits: totalCredits },
    provider: { name: 'ElevenLabs', endpoint: '/v1/sound-generation', modelId: MODEL_ID, outputFormat: 'mp3_44100_192' },
    humanApproval: { status: 'user-authorized-2026-07-30', scope: 'candidate generation only; runtime admission remains separately gated' },
    assets,
  };
}

export async function writeManifest(output = OUTPUT) {
  const resolved = path.resolve(output);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${Date.now()}.partial`;
  const manifest = buildManifest();
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, resolved);
  return { output: resolved, assets: manifest.assets.length, estimatedCredits: manifest.executionBudget.maxEstimatedCredits };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  writeManifest().then(result => console.log(JSON.stringify({ output: path.relative(process.cwd(), result.output).replaceAll('\\', '/'), assets: result.assets, estimatedCredits: result.estimatedCredits }))).catch(error => { console.error(`AAA pilot manifest build failed: ${error.message}`); process.exitCode = 1; });
}
