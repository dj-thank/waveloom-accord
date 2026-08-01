#!/usr/bin/env node
/**
 * Creates a reproducible, rights-conscious ElevenLabs candidate manifest for
 * the first AAA audio wave.  This script never reads or writes credentials and
 * never sends a network request; execution is delegated to
 * elevenlabs_audio_factory.js with ELEVENLABS_API_KEY supplied at runtime.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const outputPath = process.argv[2] || 'outputs/audio-factory-20260729/manifests/aaa-wave-001.json';
const voice = {
  voice_id: 'Xb7hH8MSUJpSbSDYk0k2',
  category: 'premade',
  selection: 'provider-premade multilingual candidate; no clone, impersonation, or real-person likeness',
};

const musicBriefs = [
  ['oshioi-main-menu', 24000, 'Original instrumental main-menu theme for a fictional competitive coastal stone-city game. 96 BPM feel, weathered hand percussion, low strings, warm horn breaths, ceramic chimes, sea wind, and a unique four-note ascending identity. Elegant and inviting, restrained dynamics, clean ending, generous 1 to 4 kHz space for UI. No vocals, no lyrics, no artist references, no existing melody, no trailer braams.'],
  ['match-setup-briefing', 22000, 'Original instrumental pre-match briefing cue for a fictional competitive game. 104 BPM feel, quiet frame drum pulse, muted plucked strings, brass swells, ceramic clicks, and calm ocean air. Intentional, tactical, and hopeful; it should support spoken team instructions. No vocals, no lyrics, no artist references, no recognizable melody, no excessive bass.'],
  ['controlpoint-neutral-tension', 26000, 'Original instrumental neutral control-point gameplay loop for a fictional sunlit coastal arena. 108 BPM feel, dry hand percussion, tense bowed strings, distant brass, stone mallet rhythm, and sparse ceramic chimes. Controlled pressure without panic, seamless-feeling cadence and clean ending. No vocals, no lyrics, no artist references, no existing melody.'],
  ['controlpoint-team0-push', 24000, 'Original instrumental allied push gameplay cue for a fictional coastal objective arena. 112 BPM feel, confident drum pulse, rising strings, warm brass answers, ceramic accents, and wind texture. Momentum with tactical clarity, moderate density, room for combat effects. No vocals, no lyrics, no artist references, no existing melody.'],
  ['controlpoint-team1-push', 24000, 'Original instrumental opposing push gameplay cue for a fictional coastal objective arena. 112 BPM feel, syncopated hand percussion, low strings, restrained brass stabs, ceramic textures, and sea wind. Urgent but readable, different original rhythmic identity from all other cues. No vocals, no lyrics, no artist references, no existing melody.'],
  ['flashpoint-transition', 18000, 'Original instrumental objective-rotation transition stinger for a fictional coastal stone city. 118 BPM feel, quick hand drum turn, ascending string figure, brass flare, ceramic sparkle, and a decisive but non-cinematic landing. It must leave room for UI confirmation. No vocals, no lyrics, no artist references, no existing melody.'],
  ['sudden-death', 20000, 'Original instrumental sudden-death gameplay cue for a fictional competitive arena. 122 BPM feel, tight dry percussion, pulsing low strings, distant brass breath, ceramic alarm motif, and wind against stone. High stakes without harsh noise or excessive sub-bass; clear combat mix. No vocals, no lyrics, no artist references, no existing melody.'],
  ['victory-team0', 16000, 'Original instrumental concise victory resolution for a fictional competitive coastal game. 100 BPM feel, warm brass, light drums, plucked strings, ceramic chimes, and sea air. Earned, bright, and dignified rather than bombastic. No vocals, no lyrics, no artist references, no existing melody.'],
  ['defeat-refocus', 16000, 'Original instrumental concise defeat-and-refocus resolution for a fictional competitive coastal game. 88 BPM feel, muted strings, low warm brass, quiet ceramic taps, and a final hopeful lift. Reflective but never bleak. No vocals, no lyrics, no artist references, no existing melody.'],
  ['north-lantern-rooftops', 24000, 'Original instrumental environmental gameplay cue for northern lantern rooftops in a fictional coastal stone city. 102 BPM feel, wooden clacks, hand drums, narrow brass phrases, ceramic bells, distant gull-free sea wind, and a unique climbing motif. No vocals, no lyrics, no artist references, no existing melody.'],
  ['central-plaza', 24000, 'Original instrumental environmental gameplay cue for a bright central plaza in a fictional coastal stone city. 106 BPM feel, open hand percussion, plucked strings, warm brass breaths, fountain-like ceramic rhythm, and spacious air. Focused, social, and combat-readable. No vocals, no lyrics, no artist references, no existing melody.'],
  ['south-docks', 24000, 'Original instrumental environmental gameplay cue for southern docks in a fictional coastal stone city. 98 BPM feel, rope-like percussion, low bowed strings, weathered brass, ceramic knocks, and maritime wind texture without gull calls. Steady, grounded, and tactical. No vocals, no lyrics, no artist references, no existing melody.'],
];

const japaneseLines = [
  ['match-start', '\u8a66\u5408\u3092\u958b\u59cb\u3057\u307e\u3059\u3002'],
  ['reach-objective', '\u6b21\u306e\u5730\u70b9\u3078\u5411\u304b\u3063\u3066\u304f\u3060\u3055\u3044\u3002'],
  ['capture-begin', '\u5730\u70b9\u306e\u5236\u5727\u3092\u958b\u59cb\u3057\u307e\u3059\u3002'],
  ['capture-progress', '\u5473\u65b9\u304c\u5730\u70b9\u3092\u5236\u5727\u4e2d\u3067\u3059\u3002'],
  ['capture-secured', '\u5730\u70b9\u3092\u78ba\u4fdd\u3057\u307e\u3057\u305f\u3002'],
  ['capture-contested', '\u6575\u304c\u5730\u70b9\u306b\u4fb5\u5165\u3057\u307e\u3057\u305f\u3002'],
  ['capture-lost', '\u5730\u70b9\u3092\u596a\u308f\u308c\u307e\u3057\u305f\u3002'],
  ['rotation-open', '\u6b21\u306e\u5730\u70b9\u304c\u958b\u653e\u3055\u308c\u307e\u3057\u305f\u3002'],
  ['rotation-warning', '\u79fb\u52d5\u7d4c\u8def\u3092\u78ba\u4fdd\u3057\u3066\u304f\u3060\u3055\u3044\u3002'],
  ['ally-down', '\u5473\u65b9\u304c\u5012\u308c\u307e\u3057\u305f\u3002\u7acb\u3066\u76f4\u3057\u307e\u3057\u3087\u3046\u3002'],
  ['team-advantage', '\u3053\u306e\u6d41\u308c\u3092\u7dad\u6301\u3057\u3066\u304f\u3060\u3055\u3044\u3002'],
  ['regroup', '\u5473\u65b9\u3068\u5408\u6d41\u3057\u3066\u3001\u6b21\u306e\u653b\u6483\u306b\u5099\u3048\u307e\u3059\u3002'],
  ['overtime', '\u5ef6\u9577\u6226\u3067\u3059\u3002\u5730\u70b9\u304b\u3089\u96e2\u308c\u306a\u3044\u3067\u304f\u3060\u3055\u3044\u3002'],
  ['sudden-death', '\u6c7a\u7740\u306e\u77ac\u9593\u3067\u3059\u3002\u96c6\u4e2d\u3057\u3066\u304f\u3060\u3055\u3044\u3002'],
  ['one-minute', '\u6b8b\u308a\u4e00\u5206\u3067\u3059\u3002'],
  ['thirty-seconds', '\u6b8b\u308a\u4e09\u5341\u79d2\u3067\u3059\u3002'],
  ['ten-seconds', '\u6b8b\u308a\u5341\u79d2\u3067\u3059\u3002'],
  ['victory', '\u52dd\u5229\u3067\u3059\u3002\u7d20\u6674\u3089\u3057\u3044\u9023\u643a\u3067\u3057\u305f\u3002'],
  ['defeat', '\u8a66\u5408\u7d42\u4e86\u3002\u6b21\u306e\u6226\u3044\u3078\u5099\u3048\u307e\u3057\u3087\u3046\u3002'],
  ['rematch-ready', '\u6e96\u5099\u304c\u3067\u304d\u305f\u3089\u3001\u6b21\u306e\u8a66\u5408\u3078\u9032\u307f\u307e\u3059\u3002'],
];

const assets = [
  ...musicBriefs.map(([slug, musicLengthMs, prompt]) => ({
    id: `aaa.wave001.music.${slug}.v001`,
    kind: 'music',
    endpoint: '/v1/music?output_format=mp3_48000_192',
    output: `generated/music/${slug}-v001.mp3`,
    request: { model_id: 'music_v2', prompt, music_length_ms: musicLengthMs, force_instrumental: true, sign_with_c2pa: true },
  })),
  ...japaneseLines.map(([slug, text]) => ({
    id: `aaa.wave001.voice.ja-ops-${slug}.v001`,
    kind: 'text_to_speech',
    providerVoice: voice,
    endpoint: `/v1/text-to-speech/${voice.voice_id}?output_format=mp3_44100_192`,
    output: `generated/voices/ja-ops-${slug}-v001.mp3`,
    request: { text, model_id: 'eleven_multilingual_v2', language_code: 'ja', apply_text_normalization: 'auto' },
  })),
];

const manifest = {
  schemaVersion: 1,
  purpose: 'AAA wave 001: original candidate music and Japanese operations voice. Candidate-only; never replaces the Local DSP contract before rights, gameplay, mix, and human quality approval.',
  rightsReview: 'pending_human_review',
  generationPolicy: {
    originalOnly: true,
    forbidden: ['artist references', 'existing melodies', 'real-person imitation', 'voice cloning', 'real weapon brands'],
    admission: 'candidate-only',
  },
  assets,
};

await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ output: outputPath, music: musicBriefs.length, voices: japaneseLines.length, total: assets.length }));
