#!/usr/bin/env node
/**
 * Technical, candidate-only QC for batches produced by elevenlabs_audio_factory.
 * It verifies byte identity and decodable MP3 stream properties; it does not
 * grant rights, gameplay, mix, or human aesthetic approval.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function args(argv = process.argv.slice(2)) {
  const out = { manifest: null, root: null, ffprobe: 'ffprobe', out: null };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') { out.help = true; continue; }
    const target = { '--manifest': 'manifest', '--root': 'root', '--ffprobe': 'ffprobe', '--out': 'out' }[key];
    if (!target) throw new Error(`unknown argument: ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    out[target] = value;
  }
  if (!out.help && (!out.manifest || !out.root || !out.out)) throw new Error('--manifest, --root, and --out are required');
  return out;
}

export function resolveAssetOutput(root, asset) {
  const requested = asset?.output;
  const id = asset?.id || '<unknown>';
  if (typeof requested !== 'string' || !requested || path.isAbsolute(requested) || requested.includes('\0')) {
    throw new Error(`asset ${id} output must be a safe relative path`);
  }
  const resolvedRoot = path.resolve(root);
  const file = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, file);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`asset ${id} output must stay inside the declared root`);
  }
  return file;
}

function probe(ffprobe, file) {
  const result = spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,sample_rate,channels', '-of', 'json', file], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`ffprobe failed for ${file}: ${(result.stderr || result.stdout || '').trim()}`);
  const payload = JSON.parse(result.stdout);
  const audio = (payload.streams || []).find(stream => stream.codec_name);
  return { durationSec: Number(payload.format?.duration), codec: audio?.codec_name || null, sampleRate: Number(audio?.sample_rate), channels: Number(audio?.channels) };
}

function validate(asset, technical) {
  const failures = [];
  if (technical.codec !== 'mp3') failures.push(`codec=${technical.codec}`);
  if (!Number.isFinite(technical.durationSec) || technical.durationSec <= 0) failures.push(`duration=${technical.durationSec}`);
  if (asset.kind === 'music') {
    const requested = Number(asset.request?.music_length_ms) / 1000;
    if (technical.sampleRate !== 48000) failures.push(`music sampleRate=${technical.sampleRate}`);
    if (technical.channels !== 2) failures.push(`music channels=${technical.channels}`);
    if (!Number.isFinite(requested) || Math.abs(technical.durationSec - requested) > 3) failures.push(`music duration=${technical.durationSec} requested=${requested}`);
  } else if (asset.kind === 'text_to_speech') {
    if (technical.sampleRate !== 44100) failures.push(`voice sampleRate=${technical.sampleRate}`);
    if (technical.channels !== 1) failures.push(`voice channels=${technical.channels}`);
    if (technical.durationSec > 30) failures.push(`voice duration=${technical.durationSec}`);
  } else if (asset.kind === 'sound_effect') {
    const requested = Number(asset.request?.duration_seconds);
    const requestedRate = asset.endpoint?.includes('mp3_48000') ? 48000 : 44100;
    if (technical.sampleRate !== requestedRate) failures.push(`sound_effect sampleRate=${technical.sampleRate}`);
    if (![1, 2].includes(technical.channels)) failures.push(`sound_effect channels=${technical.channels}`);
    if (!Number.isFinite(requested) || requested < 0.5 || requested > 30) failures.push(`sound_effect requested duration=${requested}`);
    else if (Math.abs(technical.durationSec - requested) > Math.max(0.3, requested * 0.15)) failures.push(`sound_effect duration=${technical.durationSec} requested=${requested}`);
  } else {
    failures.push(`unexpected kind=${asset.kind}`);
  }
  return failures;
}

export async function main() {
  const options = args();
  if (options.help) { console.log('Usage: node tools/audit_elevenlabs_factory_batch.js --manifest FILE --root DIR --ffprobe PATH --out FILE'); return; }
  const manifestPath = path.resolve(options.manifest);
  const root = path.resolve(options.root);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const results = [];
  for (const asset of assets) {
    const file = resolveAssetOutput(root, asset);
    let bytes = null, technical = null, failures = [];
    try { bytes = await readFile(file); } catch { failures.push('missing output'); }
    if (bytes) {
      if (!asset.sha256 || hash(bytes) !== asset.sha256) failures.push('sha256 mismatch');
      try { technical = probe(options.ffprobe, file); failures.push(...validate(asset, technical)); } catch (error) { failures.push(error.message); }
    }
    results.push({ id: asset.id, kind: asset.kind, output: path.relative(process.cwd(), file).replaceAll('\\', '/'), bytes: bytes?.length || 0, technical, failures });
  }
  const failures = results.filter(result => result.failures.length);
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    manifest: path.relative(process.cwd(), manifestPath).replaceAll('\\', '/'),
    root: path.relative(process.cwd(), root).replaceAll('\\', '/'),
    assets: results.length,
    passed: results.length - failures.length,
    failed: failures.length,
    admission: 'candidate-only; technical QC does not grant rights, mixing, gameplay, or human visual/audio-quality approval',
    results,
  };
  const out = path.resolve(options.out);
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ out: path.relative(process.cwd(), out).replaceAll('\\', '/'), assets: report.assets, passed: report.passed, failed: report.failed }));
  if (failures.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`ElevenLabs batch audit failed: ${error.message}`); process.exitCode = 1; });
}
