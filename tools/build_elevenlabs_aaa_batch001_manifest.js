#!/usr/bin/env node
/**
 * Reproducibly expands the first 100-slot AAA SFX batch. It is deliberately
 * candidate-only and has no credential or network dependency; the separately
 * bounded factory is the sole execution path.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const OUTPUT = process.argv[2] || 'outputs/audio-factory-20260730/manifests/aaa-batch-001.json';
const ENDPOINT = '/v1/sound-generation?output_format=mp3_44100_192';
const MODEL_ID = 'eleven_text_to_sound_v2';
const RIGHTS = 'No speech, music, real person, existing IP, artist, song, or brand reference. No clipping.';
const estimate = seconds => Math.ceil(seconds * 40);

function asset({ id, family, output, durationSeconds, promptInfluence = 0.72, text, role }) {
  const prompt = `${text} ${RIGHTS}`;
  if (prompt.length > 450) throw new Error(`${id} prompt exceeds the live Sound Generation 450-character ceiling (${prompt.length})`);
  return {
    id: `aaa.batch001.sfx.${id}.v001`,
    kind: 'sound_effect',
    family,
    role,
    endpoint: ENDPOINT,
    output: `generated/sfx/${output}-v001.mp3`,
    estimatedCredits: estimate(durationSeconds),
    candidateStatus: 'pending_technical_qc',
    rights: 'original fictional material only; no source audio, real-person voice, artist, existing-IP, song, or brand reference',
    qc: { durationSeconds, loop: false, expectedCodec: 'mp3', expectedSampleRate: 44100, expectedChannels: 'mono-or-stereo' },
    request: { text: prompt, model_id: MODEL_ID, duration_seconds: durationSeconds, prompt_influence: promptInfluence, loop: false },
  };
}

function weaponAssets() {
  const weapons = [
    ['asagi', 'precision survey carbine', 'a ceramic bolt and brass iris followed by a narrow luminous crack'],
    ['hokuchi', 'close-range pressure scatterer', 'a compact copper pressure pulse and coarse stone-dust snap'],
    ['shirasagi', 'crystal needle projector', 'a faceted sea-glass ignition and a tight high-energy thread'],
    ['ankou', 'tide-lure launcher', 'a wet bronze chamber turn and a focused water-pressure impulse'],
  ];
  const events = [
    ['primary-fire-near', 0.55, 'close first-person fire, dry courtyard reflection, readable 2 to 5 kHz transient'],
    ['primary-fire-mid', 0.7, 'mid-distance fire, softened transient and small stone reflection'],
    ['primary-fire-far', 0.8, 'far-distance fire, compact distant identity without low-end boom'],
    ['reload', 1.2, 'tactical reload mechanism, two clear hand-scale mechanical stages'],
    ['dry-fire', 0.5, 'empty trigger response, small inert mechanism click, clearly non-damaging'],
    ['impact-stone', 0.65, 'projectile impact on rough sun-warmed stone, sharp material response'],
    ['impact-metal', 0.65, 'projectile impact on weathered bronze, compact metallic body without ringing'],
    ['charge', 0.8, 'short charge-up, controlled rising energy with no alarm-like siren'],
    ['overheat', 1, 'brief thermal release, ceramic vent and warm pressure decay'],
    ['equip', 0.5, 'quick ready action, one compact secure mechanism lock'],
  ];
  return weapons.flatMap(([hero, archetype, signature]) => events.map(([event, durationSeconds, perspective]) => asset({
    id: `weapon.${hero}.${event}`, family: 'weapon', role: `${hero}:${event}`, output: `weapons/${hero}-${event}`,
    durationSeconds, promptInfluence: 0.74,
    text: `Gameplay weapon one-shot for a fictional ${archetype}: ${signature}; ${perspective}; ${durationSeconds} seconds. Original competitive-game mix with controlled low end.`,
  })));
}

function abilityAssets() {
  const abilities = [
    ['asagi.scan-ripple', 'a measured ceramic pulse that maps open air'],
    ['hokuchi.heat-bastion', 'a warm bronze pressure field'],
    ['shirasagi.prism-step', 'a refracted sea-glass directional burst'],
    ['ankou.tide-snare', 'a tightened water ribbon around a stone anchor'],
    ['hibari.wind-lift', 'a light canvas-and-air vertical gust'],
    ['tsuzuri.thread-bind', 'a taut woven cord energy weave'],
  ];
  const events = [
    ['cast', 0.65, 'clear start cue with a focused midrange identity'],
    ['travel', 0.8, 'short motion cue with directional air and no impact'],
    ['impact', 0.75, 'compact arrival cue with distinct material contact'],
    ['resolve', 0.9, 'brief utility completion cue, calm rather than explosive'],
  ];
  return abilities.flatMap(([abilityId, material]) => events.map(([event, durationSeconds, behavior]) => asset({
    id: `ability.${abilityId}.${event}`, family: 'ability', role: `${abilityId}:${event}`, output: `abilities/${abilityId.replace('.', '-')}-${event}`,
    durationSeconds, promptInfluence: 0.73,
    text: `Gameplay ability one-shot for a fictional coastal competitive game: ${material}; ${event} event, ${behavior}; ${durationSeconds} seconds; readable against combat with restrained bass.`,
  })));
}

function uiAssets() {
  const events = [
    ['confirm', 0.5, 'a small ceramic click and warm brass pin, positive but restrained'],
    ['cancel', 0.5, 'a soft descending sea-glass tap, distinct from confirmation'],
    ['focus', 0.5, 'a tiny polished tile tick with nearly no bass'],
    ['hit-confirm', 0.5, 'a precise luminous ceramic snap, concise and readable'],
    ['critical-confirm', 0.6, 'two tightly spaced brass-and-glass accents, important but non-painful'],
    ['damage-taken', 0.5, 'a muted bronze knock and dry air pulse, urgent but not a siren'],
    ['low-health', 0.7, 'a sparse low ceramic pulse with large breathing space'],
    ['heal-received', 0.65, 'a warm water-and-glass lift, restorative and not musical'],
    ['ally-ping', 0.55, 'a rounded ceramic marker, neutral and cooperative'],
    ['enemy-ping', 0.55, 'a sharper bronze marker, clearly different from ally ping'],
    ['menu-open', 0.55, 'a small stone drawer open and air lift'],
    ['menu-close', 0.5, 'a soft stone drawer settle'],
    ['cooldown-ready', 0.6, 'a clean ceramic completion pulse'],
    ['ability-blocked', 0.55, 'a dry crossed-brass tick, informative not harsh'],
    ['respawn-ready', 0.7, 'a calm rising stone-and-air cue'],
    ['scoreboard-open', 0.55, 'a light parchment-and-ceramic unfold'],
    ['scoreboard-close', 0.5, 'a compact parchment fold'],
    ['objective-route', 0.65, 'a focused two-step ceramic navigation marker'],
    ['party-ready', 0.6, 'a short warm brass-and-glass acknowledgement'],
    ['error', 0.55, 'a dry low ceramic denial tick, clear and non-alarming'],
  ];
  return events.map(([event, durationSeconds, material]) => asset({
    id: `ui.${event}`, family: 'ui', role: `ui:${event}`, output: `ui/${event}`,
    durationSeconds, promptInfluence: 0.7,
    text: `Gameplay UI one-shot for a fictional coastal stone city: ${material}; close interface perspective, ${durationSeconds} seconds, concise frequency separation for a competitive mix.`,
  }));
}

function objectiveAssets() {
  const events = [
    ['unlock', 0.9, 'a sealed stone marker opens with a restrained brass lift'],
    ['capture-start', 1, 'three measured ceramic markers establish a new control action'],
    ['capture-tick', 0.55, 'one stable ceramic pulse that communicates progress'],
    ['contested', 1, 'staggered low ceramic knocks and tense wind-chime scrape, urgent but not a siren'],
    ['lead-change', 0.9, 'a concise bronze pivot and rising ceramic response'],
    ['transition', 0.9, 'a fast stone mallet turn and airy brass cue'],
    ['secured', 1, 'a grounded stone anchor settles into a warm glass resolution'],
    ['round-end', 1.2, 'a dignified ceramic-and-brass landing with space for voice-over'],
  ];
  return events.map(([event, durationSeconds, material]) => asset({
    id: `objective.${event}`, family: 'objective', role: `objective:${event}`, output: `objective/${event}`,
    durationSeconds, promptInfluence: 0.75,
    text: `Gameplay objective one-shot for a fictional competitive coastal arena: ${material}; open-plaza perspective, ${durationSeconds} seconds, intelligible over combat with controlled low end.`,
  }));
}

function movementAssets() {
  const events = [
    ['stone-step-heavy', 0.5, 'one heavy boot step on rough sun-warmed stone, dry heel-to-toe texture'],
    ['wood-step', 0.5, 'one boot step on weathered dock wood, compact hollow grain'],
    ['bronze-step', 0.5, 'one boot step on aged bronze grating, controlled metallic weight'],
    ['tile-step', 0.5, 'one boot step on small glazed ceramic tile, crisp but not brittle'],
    ['shallow-water-step', 0.55, 'one boot step through a thin canal edge, compact water displacement'],
    ['jump', 0.5, 'an athletic launch from stone, short sole scrape and airy lift'],
    ['land', 0.6, 'an athletic controlled landing on stone, compact impact and cloth shift'],
    ['slide-stop', 0.65, 'a short tactical slide stop on stone grit, controlled friction tail'],
  ];
  return events.map(([event, durationSeconds, material]) => asset({
    id: `movement.${event}`, family: 'movement', role: `movement:${event}`, output: `movement/${event}`,
    durationSeconds, promptInfluence: 0.68,
    text: `Gameplay movement one-shot for a fictional coastal arena: ${material}; close third-person perspective, ${durationSeconds} seconds, distinct surface identity with restrained bass.`,
  }));
}

export function buildManifest() {
  const assets = [...weaponAssets(), ...abilityAssets(), ...uiAssets(), ...objectiveAssets(), ...movementAssets()];
  const expected = { weapon: 40, ability: 24, ui: 20, objective: 8, movement: 8 };
  if (assets.length !== 100 || Object.entries(expected).some(([family, count]) => assets.filter(asset => asset.family === family).length !== count)) throw new Error('batch-001 catalogue shape drifted');
  const totalCredits = assets.reduce((sum, candidate) => sum + candidate.estimatedCredits, 0);
  return {
    schemaVersion: 1,
    wave: 'aaa-batch-001',
    purpose: 'First 100-slot candidate-only AAA SFX batch: weapon vocabulary, abilities, UI, objectives, and movement. It does not replace the Local DSP runtime contract before technical, competitive, creative, rights, and human approval.',
    executionBudget: { maxAssets: assets.length, maxEstimatedCredits: totalCredits },
    provider: { name: 'ElevenLabs', endpoint: '/v1/sound-generation', modelId: MODEL_ID, outputFormat: 'mp3_44100_192' },
    humanApproval: { status: 'user-authorized-2026-07-30', scope: 'candidate generation only; runtime admission remains separately gated' },
    assets,
  };
}

export async function writeManifest(output = OUTPUT) {
  const resolved = path.resolve(output);
  const manifest = buildManifest();
  await mkdir(path.dirname(resolved), { recursive: true });
  const temporary = `${resolved}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, resolved);
  return { output: resolved, assets: manifest.assets.length, estimatedCredits: manifest.executionBudget.maxEstimatedCredits };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  writeManifest().then(result => console.log(JSON.stringify({ output: path.relative(process.cwd(), result.output).replaceAll('\\', '/'), assets: result.assets, estimatedCredits: result.estimatedCredits }))).catch(error => { console.error(`AAA Batch 001 manifest build failed: ${error.message}`); process.exitCode = 1; });
}
