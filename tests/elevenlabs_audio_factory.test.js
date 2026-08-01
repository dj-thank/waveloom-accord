import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { runFactory, parseArgs, requestHash, validateManifest } from '../tools/elevenlabs_audio_factory.js';
import { parseLoudnorm, parseArgs as parseMasterArgs } from '../tools/master_elevenlabs_music_candidates.js';
import { attenuationGainDb, parseVolumeDetect, parseArgs as parseSfxMasterArgs } from '../tools/master_elevenlabs_sfx_candidates.js';

const manifest = { schemaVersion: 1, assets: [{ id: 'a', kind: 'sfx', endpoint: '/v1/sound-generation', request: { text: 'test' }, output: 'a.mp3' }, { id: 'b', kind: 'tts', endpoint: '/v1/text-to-speech/v', request: { text: 'hello' }, output: 'b.mp3' }] };

test('dry-run is manifest driven and does not require a key or fetch', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-factory-'));
  const file = path.join(root, 'manifest.json');
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify(manifest));
  let called = false;
  const result = await runFactory({ manifestPath: file, outputRoot: root, dryRun: true, fetchImpl: async () => { called = true; } });
  assert.equal(result.planned, 2); assert.equal(called, false);
});

test('mocked fetch writes atomically, records hash, and resume dedupes', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-factory-'));
  const file = path.join(root, 'manifest.json');
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify(manifest));
  let calls = 0;
  const fetchImpl = async () => { calls++; return { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg', 'request-id': 'r1' }), arrayBuffer: async () => Buffer.from('audio') }; };
  const first = await runFactory({ manifestPath: file, outputRoot: root, fetchImpl, hasApiKey: true, concurrency: 2 });
  assert.equal(first.completed, 2); assert.equal(calls, 2);
  const second = await runFactory({ manifestPath: file, outputRoot: root, fetchImpl, hasApiKey: true });
  assert.equal(second.skipped, 2); assert.equal(calls, 2);
  const saved = JSON.parse(await readFile(file, 'utf8')); assert.equal(saved.assets[0].sha256.length, 64); assert.equal(saved.assets[0].httpStatus, 200); assert.ok(saved.assets[0].generatedAt);
});

test('429 and 5xx retry with bounded metadata; actual mode fails closed without key', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-factory-')); const file = path.join(root, 'manifest.json');
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify({ schemaVersion: 1, assets: [manifest.assets[0]] }));
  await assert.rejects(runFactory({ manifestPath: file, outputRoot: root, apiKey: null, fetchImpl: async () => { throw new Error('must not call'); } }), /ELEVENLABS_API_KEY required/);
  let n = 0; const result = await runFactory({ manifestPath: file, outputRoot: root, fetchImpl: async () => { n++; return n < 3 ? { ok: false, status: 503, headers: new Headers(), text: async () => 'busy' } : { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }), arrayBuffer: async () => Buffer.from('x') }; }, hasApiKey: true, maxRetries: 3, baseDelayMs: 0 });
  assert.equal(result.completed, 1); assert.equal(result.retries, 2);
});

test('argument parser supports safe operational controls', () => { const args = parseArgs(['--manifest', 'm.json', '--dry-run', '--concurrency', '4', '--max-retries', '2']); assert.equal(args.concurrency, 4); assert.equal(args.maxRetries, 2); });

test('request hash is stable', () => { assert.equal(requestHash({ b: 2, a: 1 }), requestHash({ a: 1, b: 2 })); });

test('factory rejects manifest traversal, duplicate work, and malformed provider endpoints before any request', () => {
  const root = path.join(os.tmpdir(), 'audio-factory-root');
  const valid = { id: 'safe', kind: 'sound_effect', endpoint: '/v1/sound-generation', request: { text: 'original test sound' }, output: 'generated/safe.mp3' };
  assert.throws(() => validateManifest({ assets: [{ ...valid, output: '../escape.mp3' }] }, { outputRoot: root }), /output must stay inside outputRoot/);
  assert.throws(() => validateManifest({ assets: [valid, { ...valid, output: 'generated/other.mp3' }] }, { outputRoot: root }), /duplicate asset id/);
  assert.throws(() => validateManifest({ assets: [{ ...valid, endpoint: 'https://example.invalid/steal' }] }, { outputRoot: root }), /endpoint must be a relative ElevenLabs \/v1\//);
  assert.throws(() => validateManifest({ assets: [{ ...valid, request: { text: 'x'.repeat(451) } }] }, { outputRoot: root }), /sound-generation text must be 1\.\.450 characters/);
});

test('factory applies the stricter manifest batch ceiling and records a bounded plan', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'audio-factory-'));
  const file = path.join(root, 'manifest.json');
  const assets = [
    { id: 'one', kind: 'sound_effect', endpoint: '/v1/sound-generation', request: { text: 'one' }, output: 'generated/one.mp3', estimatedCredits: 4 },
    { id: 'two', kind: 'sound_effect', endpoint: '/v1/sound-generation', request: { text: 'two' }, output: 'generated/two.mp3', estimatedCredits: 4 },
  ];
  await (await import('node:fs/promises')).writeFile(file, JSON.stringify({ schemaVersion: 1, executionBudget: { maxAssets: 1, maxEstimatedCredits: 5 }, assets }));
  let calls = 0;
  const result = await runFactory({ manifestPath: file, outputRoot: root, hasApiKey: true, fetchImpl: async () => {
    calls++;
    return { ok: true, status: 200, headers: new Headers({ 'content-type': 'audio/mpeg' }), arrayBuffer: async () => Buffer.from('one') };
  } });
  assert.deepEqual({ planned: result.planned, completed: result.completed, estimatedCredits: result.estimatedCredits }, { planned: 1, completed: 1, estimatedCredits: 4 });
  assert.equal(calls, 1);
});

test('loudnorm parser rejects incomplete measurements and accepts a complete first pass', () => {
  assert.throws(() => parseLoudnorm('no JSON here'), /measurement JSON missing/);
  const parsed = parseLoudnorm('{\n  "input_i" : "-27.20",\n  "input_tp" : "-4.10",\n  "input_lra" : "8.10",\n  "input_thresh" : "-37.80",\n  "target_offset" : "0.20"\n}');
  assert.equal(parsed.input_i, '-27.20');
});

test('mastering profiles keep music and operations voice targets distinct', () => {
  const music = parseMasterArgs(['--manifest', 'm', '--root', 'r', '--out', 'o']);
  const voice = parseMasterArgs(['--manifest', 'm', '--root', 'r', '--out', 'o', '--kind', 'text_to_speech']);
  assert.deepEqual([music.targetI, music.targetTp, music.channels], [-18, -1.5, 2]);
  assert.deepEqual([voice.targetI, voice.targetTp, voice.channels], [-18, -1, 1]);
});

test('SFX sample-peak mastering parses complete volume evidence and rejects incomplete output', () => {
  assert.deepEqual(parseVolumeDetect('mean_volume: -21.6 dB\nmax_volume: -1.0 dB'), { meanDb: -21.6, maxDb: -1 });
  assert.throws(() => parseVolumeDetect('mean_volume: -21.6 dB'), /incomplete/);
  assert.equal(attenuationGainDb(0, -1), -1.35, 'lossy MP3 re-encoding needs a small safety margin');
  assert.equal(attenuationGainDb(-2, -1), 0, 'the candidate pass must never boost a quiet source');
  const args = parseSfxMasterArgs(['--manifest', 'm', '--root', 'r', '--out', 'o', '--target-max-db', '-1']);
  assert.equal(args.targetMaxDb, -1);
});
