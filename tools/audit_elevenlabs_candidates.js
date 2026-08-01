#!/usr/bin/env node

/**
 * Read-only technical audit for the separate ElevenLabs candidate catalogue.
 * It deliberately does not admit assets into the Local DSP runtime contract.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const manifestPath = arg('manifest', 'assets-src/elevenlabs/manifest.json');
const outputPath = arg('out', 'outputs/elevenlabs-candidate-audit.json');
const ffprobe = arg('ffprobe', process.env.FFPROBE_PATH || 'ffprobe');

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const relative = (absolute) => path.relative(ROOT, absolute).replaceAll(path.sep, '/');

function probe(file) {
  const result = spawnSync(ffprobe, [
    '-v', 'error',
    '-show_entries', 'format=duration,bit_rate:stream=codec_name,sample_rate,channels',
    '-of', 'json',
    file,
  ], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return { ok: false, error: (result.stderr || result.error?.message || 'ffprobe failed').trim() };
  try {
    const parsed = JSON.parse(result.stdout);
    const stream = parsed.streams?.[0] || {};
    return {
      ok: true,
      codec: stream.codec_name || null,
      sampleRateHz: Number(stream.sample_rate) || null,
      channels: Number(stream.channels) || null,
      durationSec: Number(parsed.format?.duration) || null,
      bitRate: Number(parsed.format?.bit_rate) || null,
    };
  } catch (error) {
    return { ok: false, error: `ffprobe JSON parse: ${error.message}` };
  }
}

function technicalFailure(record, metadata) {
  if (!metadata.ok) return metadata.error || 'probe failed';
  if (metadata.codec !== 'mp3') return `codec=${metadata.codec}`;
  if (metadata.sampleRateHz !== 44100) return `sampleRate=${metadata.sampleRateHz}`;
  if (![1, 2].includes(metadata.channels)) return `channels=${metadata.channels}`;
  if (!(metadata.durationSec > 0.15 && metadata.durationSec <= 8)) return `duration=${metadata.durationSec}`;
  const requested = Number(record.requestedDurationSec);
  if (Number.isFinite(requested) && Math.abs(metadata.durationSec - requested) > 0.16) {
    return `duration differs from request (${metadata.durationSec} vs ${requested})`;
  }
  return null;
}

const manifest = JSON.parse(await readFile(path.resolve(ROOT, manifestPath), 'utf8'));
const records = Array.isArray(manifest.assets) ? manifest.assets : [];
const audited = [];
for (const record of records) {
  const source = path.resolve(ROOT, record.sourcePath || '');
  const runtime = path.resolve(ROOT, record.runtimePath || '');
  let sourceHash = null;
  let runtimeHash = null;
  let readError = null;
  try {
    [sourceHash, runtimeHash] = await Promise.all([readFile(source).then(hash), readFile(runtime).then(hash)]);
  } catch (error) {
    readError = error.message;
  }
  const metadata = readError ? { ok: false, error: readError } : probe(runtime);
  const hashMatches = !readError && sourceHash === record.sha256 && runtimeHash === record.sha256;
  const technicalError = technicalFailure(record, metadata);
  audited.push({
    id: record.id,
    heroId: record.heroId,
    kind: record.kind,
    slot: record.slot,
    sourcePath: record.sourcePath,
    runtimePath: record.runtimePath,
    hashMatches,
    sourceHash,
    runtimeHash,
    metadata,
    technicalStatus: technicalError ? 'fail' : 'pass',
    technicalError,
  });
}

const durationValues = audited.map((item) => item.metadata.durationSec).filter(Number.isFinite);
const summary = {
  assets: audited.length,
  hashFailures: audited.filter((item) => !item.hashMatches).length,
  technicalFailures: audited.filter((item) => item.technicalStatus !== 'pass').length,
  durationSec: durationValues.length ? {
    min: Math.min(...durationValues),
    max: Math.max(...durationValues),
    mean: durationValues.reduce((sum, value) => sum + value, 0) / durationValues.length,
  } : null,
  kinds: Object.fromEntries(['weapon', 'ability'].map((kind) => [kind, audited.filter((item) => item.kind === kind).length])),
  channelCounts: Object.fromEntries([1, 2].map((channels) => [channels, audited.filter((item) => item.metadata.channels === channels).length])),
  admission: 'candidate-only; not part of the Local DSP runtime contract or distribution catalog',
};
const output = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  manifest: relative(path.resolve(ROOT, manifestPath)),
  provider: manifest.provider || null,
  modelId: manifest.modelId || null,
  summary,
  assets: audited,
};
const absoluteOutput = path.resolve(ROOT, outputPath);
await mkdir(path.dirname(absoluteOutput), { recursive: true });
const temporary = `${absoluteOutput}.${process.pid}.tmp`;
await writeFile(temporary, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
await rename(temporary, absoluteOutput);
console.log(JSON.stringify({ output: relative(absoluteOutput), ...summary }));
process.exitCode = summary.hashFailures || summary.technicalFailures ? 1 : 0;
