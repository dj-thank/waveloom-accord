#!/usr/bin/env node
/**
 * Author a deterministic, candidate-only 100-slot ElevenLabs SFX wave.
 * This file only writes a redacted request manifest; the provider key is never
 * read here. The execution worker owns the server-side key boundary.
 */
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(process.cwd());
const outArg = process.argv.indexOf('--out');
const outputPath = path.resolve(root, outArg >= 0 ? process.argv[outArg + 1] : 'outputs/audio-factory-20260801/manifests/aaa-wave-002.json');

const rights = 'original fictional material only; no source audio, real person, artist, existing IP, song, brand, or recognizable signature sound';
const sourceTail = ' Original candidate only. No speech, music, recognizable melody, real person, existing IP, artist, song, brand, trademark, or copied signature sound.';

const rows = [
  // 24 environmental ambience / loop candidates.
  ['ambience', 'sea-spray-near', 'sea spray against a stone quay', 'near', 4.0, 'foam density rises and falls', 'soft layered wash with a clear loop seam', true],
  ['ambience', 'sea-spray-far', 'distant surf beyond a coastal market', 'far', 5.0, 'wind opens and closes the stereo field', 'low-detail wide wash that stays behind combat', true],
  ['ambience', 'market-crowd-low', 'small coastal market with sparse movement', 'near', 5.0, 'footfall density varies without intelligible speech', 'muffled human presence with no words and a clean loop seam', true],
  ['ambience', 'market-cloth-flap', 'several canvas awnings moving in salt wind', 'near', 3.5, 'gust strength changes slowly', 'dry fabric pulses with a readable repeating cycle', true],
  ['ambience', 'lantern-wind', 'wind passing through a bronze lantern frame', 'near', 3.0, 'hollow resonance varies subtly', 'thin metal air tone with controlled low end', true],
  ['ambience', 'rain-on-stone', 'light rain striking salt-stained stone', 'near', 5.0, 'droplet density alternates', 'small bright transients and soft bed, seamless loop', true],
  ['ambience', 'rain-on-canvas', 'light rain on a taut market canopy', 'near', 4.0, 'rain intensity breathes', 'close soft patter without a musical pulse', true],
  ['ambience', 'salt-mist-gust', 'a short salt-mist gust through an empty plaza', 'near', 2.5, 'gust attack changes', 'airy filtered swell with no tonal melody', true],
  ['ambience', 'harbor-bell-far', 'one distant fictional harbor marker bell in fog', 'far', 4.0, 'distance and wind vary', 'single muted metallic event surrounded by air', true],
  ['ambience', 'shrine-water-trickle', 'water trickling over a small stone basin', 'near', 5.0, 'stream rate varies', 'gentle high-frequency detail below gameplay focus', true],
  ['ambience', 'courtyard-wind', 'wind circling a walled stone courtyard', 'near', 4.0, 'directional gusts alternate', 'diffuse air movement with a stable loop seam', true],
  ['ambience', 'algae-dock-bubbles', 'small bubbles under a wooden coastal dock', 'near', 3.0, 'bubble clusters vary', 'subtle wet pops with no exaggerated cartoon tone', true],
  ['ambience', 'tide-pool-foam', 'foam pulling through a shallow tide pool', 'near', 4.0, 'water pull timing varies', 'wet granular wash with readable loop boundary', true],
  ['ambience', 'storm-distant-rumble', 'distant coastal storm behind playable space', 'far', 6.0, 'rumble timing and intensity vary', 'low controlled thunder bed that never masks calls', true],
  ['ambience', 'sunlit-market-air', 'warm daytime market air with canvas and wood', 'far', 5.0, 'density varies gently', 'quiet open-space bed with no intelligible voices', true],
  ['ambience', 'night-coast-insects', 'night insects beside a fictional rocky coast', 'far', 5.0, 'insect density shifts', 'dark sparse texture with a clean loop seam', true],
  ['ambience', 'rigging-creak', 'rope rigging and a weathered mast under wind', 'near', 4.0, 'creak intervals vary', 'wood and rope strain with distinct separated transients', true],
  ['ambience', 'awning-groan', 'a heavy timber awning flexing in a gust', 'near', 3.0, 'stress bends vary', 'low wood groan with restrained resonance', true],
  ['ambience', 'bronze-sign-sway', 'a small oxidized bronze market sign swaying', 'near', 3.0, 'contact rhythm varies', 'soft metallic ticks in a short repeating cycle', true],
  ['ambience', 'far-combat-muffled', 'distant fictional arena activity behind walls', 'far', 5.0, 'event density varies', 'muffled nonverbal impacts with no identifiable weapon signature', true],
  ['ambience', 'objective-zone-hum', 'a neutral coastal objective marker field', 'near', 4.0, 'pulse density shifts slowly', 'subtle non-musical energy bed that leaves speech clear', true],
  ['ambience', 'wind-canyon-low', 'wind funneling through a narrow salt-stone passage', 'near', 4.0, 'pressure waves vary', 'low air pressure movement with a seamless loop seam', true],
  ['ambience', 'drizzle-roof', 'fine drizzle on a tiled coastal roof', 'near', 4.0, 'droplet spread varies', 'soft dispersed roof patter with no tonal pitch', true],
  ['ambience', 'crowd-rise-nonverbal', 'a fictional market crowd reacting without intelligible words', 'far', 4.0, 'reaction swell varies', 'nonverbal crowd lift and settle, tactically unobtrusive', true],

  // 24 physical object / surface Foley candidates.
  ['foley', 'stone-step-light', 'a light shoe step on dry salt stone', 'near', 0.65, 'shoe mass varies', 'short dry contact with a crisp but soft transient', false],
  ['foley', 'stone-step-heavy', 'a heavy boot step on dry salt stone', 'near', 0.75, 'body mass varies', 'low thump with a clear stone click', false],
  ['foley', 'ceramic-pickup', 'a glazed ceramic vessel lifted from a table', 'near', 0.8, 'grip speed varies', 'small finger contact and hollow ceramic movement', false],
  ['foley', 'ceramic-setdown', 'a glazed ceramic vessel placed on stone', 'near', 0.8, 'impact softness varies', 'controlled ceramic tap with a short room tail', false],
  ['foley', 'bronze-latch', 'a weathered bronze latch opening on a wooden panel', 'near', 1.0, 'latch resistance varies', 'two-stage metal click followed by a small wood creak', false],
  ['foley', 'rope-pull', 'a salt-worn rope pulled taut around a timber post', 'near', 1.1, 'tension changes', 'fiber strain and a brief wooden knock', false],
  ['foley', 'wood-crate-set', 'a small weathered wood crate set onto stone', 'near', 0.9, 'crate mass varies', 'wood scrape into a muted stone contact', false],
  ['foley', 'saltwater-splash-small', 'one hand-sized splash in shallow coastal water', 'near', 0.8, 'water volume varies', 'bright droplets with a soft low body', false],
  ['foley', 'sand-scrape', 'a boot scraping across damp beach sand', 'near', 0.9, 'pressure varies', 'granular drag with a dry tail', false],
  ['foley', 'metal-ring-drop', 'a small bronze tension ring dropped onto stone', 'near', 0.8, 'ring size varies', 'bright metallic ping with a restrained decay', false],
  ['foley', 'cloth-fold', 'a weathered canvas fold pulled across a wooden frame', 'near', 0.9, 'fabric tension varies', 'dry layered cloth movement with a clear start', false],
  ['foley', 'glass-bead-tap', 'a small sea-glass bead tapping a bronze fitting', 'near', 0.7, 'bead size varies', 'tiny glass tick followed by muted metal resonance', false],
  ['foley', 'stone-impact-light', 'a small stone chip striking a larger stone slab', 'near', 0.7, 'chip size varies', 'sharp mineral tick with minimal tail', false],
  ['foley', 'stone-impact-heavy', 'a heavy stone block contacting a stone floor', 'near', 1.0, 'impact weight varies', 'dense low impact with a short room reflection', false],
  ['foley', 'ceramic-break-small', 'one small fictional ceramic shard breaking on stone', 'near', 1.0, 'break energy varies', 'brief brittle crack with no exaggerated debris swarm', false],
  ['foley', 'chest-lid-wood', 'a small timber lid opened and settled on a hinge', 'near', 1.2, 'hinge age varies', 'wooden hinge creak and a controlled stop', false],
  ['foley', 'gate-hinge-salt', 'a salt-stiffened bronze gate hinge moving once', 'near', 1.3, 'rust friction varies', 'metal strain with a readable stop', false],
  ['foley', 'water-bucket-lift', 'a wooden water bucket lifted from a wet stone floor', 'near', 1.0, 'water slosh varies', 'rope strain, wood movement, and a soft water shift', false],
  ['foley', 'shell-crunch-light', 'a small shell fragment crushed under a shoe', 'near', 0.7, 'shell size varies', 'dry granular crunch with no gore', false],
  ['foley', 'bronze-chain-set', 'a short bronze chain set onto a timber rail', 'near', 0.9, 'chain mass varies', 'linked metallic contacts with a clear final settle', false],
  ['foley', 'wet-wood-drag', 'a wet plank dragged across a stone dock', 'near', 1.2, 'drag speed varies', 'low wood friction and a damp stone scrape', false],
  ['foley', 'sandbag-drop', 'a small sandbag dropped onto a canvas mat', 'near', 0.8, 'drop height varies', 'soft cloth thump with granular internal shift', false],
  ['foley', 'bronze-bowl-rub', 'a bronze bowl rotated on a wooden counter', 'near', 1.0, 'rotation speed varies', 'muted rim rub with light metal resonance', false],
  ['foley', 'tile-fragment-slide', 'a roof tile fragment sliding a short distance', 'near', 0.9, 'slide distance varies', 'ceramic scrape ending in a small stop', false],

  // 20 movement / traversal candidates.
  ['movement', 'footstep-stone-close', 'a fast close footstep on dry stone', 'near', 0.55, 'stride length varies', 'tight transient with a short dry tail', false],
  ['movement', 'footstep-wood-close', 'a fast close footstep on weathered wood', 'near', 0.55, 'stride length varies', 'hollow wood contact with clear surface identity', false],
  ['movement', 'footstep-sand-close', 'a fast close footstep on damp sand', 'near', 0.65, 'pressure varies', 'soft granular compression with a clear onset', false],
  ['movement', 'footstep-metal-close', 'a fast close footstep on a bronze walkway', 'near', 0.55, 'shoe material varies', 'bright controlled metal click without ringing overload', false],
  ['movement', 'footstep-wet-stone', 'a careful footstep on wet salt stone', 'near', 0.7, 'slip risk varies', 'rubberized contact and a small water squeeze', false],
  ['movement', 'sprint-burst-stone', 'two rapid sprint steps on stone', 'near', 0.9, 'speed varies', 'paired readable transients with restrained breathless motion', false],
  ['movement', 'landing-light', 'a light landing from a short drop onto stone', 'near', 0.8, 'landing weight varies', 'soft impact with a small shoe scrape', false],
  ['movement', 'landing-heavy', 'a heavy landing from a short drop onto stone', 'near', 1.0, 'landing weight varies', 'dense impact and a brief body-weight settle', false],
  ['movement', 'slide-stop-sand', 'a short controlled slide ending on damp sand', 'near', 1.0, 'slide distance varies', 'granular drag with a decisive stop', false],
  ['movement', 'jump-takeoff', 'a quick jump takeoff from a stone floor', 'near', 0.75, 'push strength varies', 'shoe scrape, air displacement, and no voice', false],
  ['movement', 'mantle-wood-edge', 'hands and boots pulling over a low timber edge', 'near', 1.2, 'effort varies', 'wood contact and cloth movement without speech', false],
  ['movement', 'dodge-snap', 'a rapid lateral dodge across dry stone', 'near', 0.8, 'direction changes', 'fast cloth and shoe displacement with a crisp tail', false],
  ['movement', 'crouch-shift', 'a crouched weight shift on a canvas mat', 'near', 0.8, 'body mass varies', 'soft fabric and floor friction, no voice', false],
  ['movement', 'gear-swivel', 'a compact bronze equipment ring rotating while moving', 'near', 0.7, 'motion speed varies', 'tiny layered metal movement that remains readable', false],
  ['movement', 'rope-climb-pull', 'a short rope pull during a fictional traversal action', 'near', 1.0, 'tension varies', 'fiber strain and glove friction, no exertion voice', false],
  ['movement', 'water-wade-step', 'one step through shallow coastal water', 'near', 0.9, 'water depth varies', 'wet foot displacement with a compact splash', false],
  ['movement', 'far-footstep-stone', 'one distant footstep on a stone corridor', 'far', 0.8, 'distance varies', 'muffled low detail with a clear spatial identity', false],
  ['movement', 'far-landing', 'a distant heavy landing behind a wall', 'far', 1.0, 'wall occlusion varies', 'soft low impact with an occluded tail', false],
  ['movement', 'breath-exertion-nonverbal', 'a short nonverbal exertion breath during traversal', 'near', 0.8, 'effort level varies', 'original nonverbal breath texture, no words or identity', false],
  ['movement', 'stop-turn-stone', 'a shoe stop and turn on dry stone', 'near', 0.9, 'turn angle varies', 'short scrape and pivot with a clean end', false],

  // 16 objective / UI candidates.
  ['objective', 'zone-enter-friendly', 'a friendly objective zone entry confirmation', 'near', 0.8, 'brightness varies', 'short clear non-musical UI chime with a soft attack', false],
  ['objective', 'zone-enter-enemy', 'an enemy objective zone entry warning', 'near', 0.8, 'urgency varies', 'short low-to-mid alert pulse that stays readable in combat', false],
  ['objective', 'capture-tick-friendly', 'one friendly capture progress tick', 'near', 0.55, 'progress intensity varies', 'brief positive tactile tick without a melody', false],
  ['objective', 'capture-tick-enemy', 'one enemy capture progress tick', 'near', 0.55, 'progress intensity varies', 'brief tense tactile tick without a melody', false],
  ['objective', 'capture-complete', 'a fictional objective capture completion signal', 'near', 1.1, 'completion weight varies', 'clear resolved layered tone with no recognizable melody', false],
  ['objective', 'objective-contested', 'a fictional objective contested warning', 'near', 1.0, 'urgency varies', 'two-part urgent pulse that leaves voice frequencies clear', false],
  ['objective', 'round-start', 'a fictional round start confirmation', 'near', 1.1, 'energy varies', 'short assertive start signal without orchestral music', false],
  ['objective', 'round-end', 'a fictional round end confirmation', 'near', 1.1, 'finality varies', 'short resolved signal with a clean tail', false],
  ['objective', 'victory-confirm', 'a compact fictional victory confirmation', 'near', 1.2, 'warmth varies', 'bright resolved UI tone with no melody', false],
  ['objective', 'defeat-confirm', 'a compact fictional defeat confirmation', 'near', 1.2, 'gravity varies', 'muted descending-feel texture without a tune', false],
  ['objective', 'respawn-ready', 'a fictional respawn ready confirmation', 'near', 0.8, 'clarity varies', 'clean neutral pulse with a soft tail', false],
  ['objective', 'ping-soft', 'a soft teammate location ping', 'near', 0.55, 'distance varies', 'small spatial click with low fatigue', false],
  ['objective', 'ping-urgent', 'an urgent teammate location ping', 'near', 0.65, 'urgency varies', 'sharp but non-painful spatial pulse', false],
  ['objective', 'timer-warning', 'a fictional objective timer warning', 'near', 0.8, 'remaining-time urgency varies', 'clear repetitive-ready pulse with no melody', false],
  ['objective', 'objective-lost', 'a fictional objective lost warning', 'near', 1.0, 'impact varies', 'muted alert with a decisive ending', false],
  ['objective', 'interact-confirm-cancel', 'a neutral UI cancel confirmation', 'near', 0.55, 'softness varies', 'short dry click distinct from success sounds', false],

  // 16 ability / impact candidates.
  ['ability', 'water-burst-near', 'a compact water ability burst striking stone', 'near', 1.0, 'water volume varies', 'bright splash transient with a controlled low body', false],
  ['ability', 'water-burst-far', 'a distant water ability burst behind a wall', 'far', 1.1, 'occlusion varies', 'muffled wet impact with clear distance', false],
  ['ability', 'stone-shield-form', 'a fictional stone shield forming from fragments', 'near', 1.3, 'fragment density varies', 'layered mineral clicks and a short low resonance', false],
  ['ability', 'stone-shield-hit', 'a fictional stone shield receiving one impact', 'near', 1.0, 'impact weight varies', 'dense mineral knock with a readable transient', false],
  ['ability', 'bronze-resonance', 'a fictional bronze ability pulse on a metal surface', 'near', 1.0, 'ring intensity varies', 'controlled metallic resonance without a musical note', false],
  ['ability', 'sea-glass-shimmer', 'a fictional sea-glass energy ability activating', 'near', 1.0, 'shimmer density varies', 'small crystalline ticks and airy sparkle', false],
  ['ability', 'sand-plume', 'a compact sand ability plume crossing stone', 'near', 1.0, 'grain density varies', 'dry granular rush with a clean short tail', false],
  ['ability', 'barrier-hit-near', 'a fictional energy barrier taking a close hit', 'near', 0.9, 'hit strength varies', 'short layered impact with readable midrange', false],
  ['ability', 'barrier-hit-far', 'a fictional energy barrier taking a distant hit', 'far', 1.0, 'distance varies', 'soft occluded impact with a restrained tail', false],
  ['ability', 'heal-pulse', 'a fictional restorative ability pulse on stone', 'near', 1.0, 'warmth varies', 'gentle non-musical pulse with a clean finish', false],
  ['ability', 'dash-snap', 'a fictional short-range ability dash release', 'near', 0.8, 'speed varies', 'fast air displacement and a compact snap', false],
  ['ability', 'scan-pulse', 'a fictional tactical scan pulse through coastal air', 'near', 1.0, 'range varies', 'clear electronic-organic pulse with no melody', false],
  ['ability', 'anchor-chain', 'a fictional anchor ability chain locking onto stone', 'near', 1.2, 'chain mass varies', 'bronze links and a firm locking impact', false],
  ['ability', 'suppression-hit', 'a fictional suppression ability hitting wet stone', 'near', 1.0, 'intensity varies', 'low controlled thump with a crisp wet transient', false],
  ['ability', 'ultimate-charge', 'a fictional ultimate ability reaching full charge', 'near', 1.3, 'charge intensity varies', 'rising textural energy without a tune or chord progression', false],
  ['ability', 'ultimate-release', 'a fictional ultimate ability releasing across a plaza', 'near', 1.5, 'scale varies', 'wide impact, readable transient, controlled low end', false],
];

if (rows.length !== 100) throw new Error(`expected 100 rows, got ${rows.length}`);

const slugify = value => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const assets = rows.map(([family, slug, source, perspective, duration, variation, design, loop], index) => {
  const id = `aaa.wave002.sfx.${family}.${slug}.v001`;
  const text = `Original ${source} for a fictional coastal competitive action game. Perspective: ${perspective}; duration ${duration.toFixed(2)} seconds; variation: ${variation}. Sound design: ${design}.${sourceTail}`;
  if (text.length > 450) throw new Error(`${id} prompt is ${text.length} characters`);
  const output = `generated/wave002/${family}/${slugify(slug)}-v001.mp3`;
  return {
    id,
    kind: 'sound_effect',
    family,
    role: `wave002:${family}:${slug}`,
    endpoint: '/v1/sound-generation?output_format=mp3_44100_192',
    output,
    estimatedCredits: 24,
    candidateStatus: 'pending_technical_qc',
    rights,
    qc: { durationSeconds: duration, loop, expectedCodec: 'mp3', expectedSampleRate: 44100, expectedChannels: 'mono-or-stereo' },
    request: { text, model_id: 'eleven_text_to_sound_v2', duration_seconds: duration, prompt_influence: 0.74, loop },
    sourceIndex: index,
  };
});

const manifest = {
  schemaVersion: 1,
  wave: 'aaa-wave-002',
  purpose: 'Second 100-slot candidate-only SFX wave: environmental loops, physical Foley, traversal, objective/UI, and ability impacts. It does not modify runtime audio.',
  executionBudget: { maxAssets: 100, maxEstimatedCredits: 2400 },
  provider: { name: 'ElevenLabs', endpoint: '/v1/sound-generation', modelId: 'eleven_text_to_sound_v2', outputFormat: 'mp3_44100_192' },
  humanApproval: { status: 'user-authorized-2026-08-01', scope: 'candidate generation only; runtime admission remains separately gated' },
  policy: 'All 100 outputs are candidate-only. Technical pass, mastering, and acoustic triage never grant rights, creative, competitive, mix, human, release, or runtime admission.',
  taxonomy: { ambience: 24, foley: 24, movement: 20, objective: 16, ability: 16 },
  assets,
};
const manifestHash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ out: path.relative(root, outputPath).replaceAll('\\', '/'), assets: assets.length, taxonomy: manifest.taxonomy, estimatedCredits: manifest.executionBudget.maxEstimatedCredits, manifestHash }));
