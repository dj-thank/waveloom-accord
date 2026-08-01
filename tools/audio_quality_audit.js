#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function makeWav(samples, sampleRate = 44100) {
  const data = Buffer.alloc(samples.length * 2); for (let i = 0; i < samples.length; i++) data.writeInt16LE(samples[i], i * 2);
  const b = Buffer.alloc(44 + data.length); b.write('RIFF', 0); b.writeUInt32LE(36 + data.length, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sampleRate, 24); b.writeUInt32LE(sampleRate * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(data.length, 40); data.copy(b, 44); return b;
}

export function parseWavBuffer(buffer, options = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Invalid RIFF/WAV');
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) throw new Error('RIFF length mismatch');
  let pos = 12, fmt, data;
  while (pos + 8 <= buffer.length) {
    const id = buffer.toString('ascii', pos, pos + 4);
    const n = buffer.readUInt32LE(pos + 4);
    const start = pos + 8;
    const paddedEnd = start + n + (n & 1);
    if (start + n > buffer.length || paddedEnd > buffer.length) throw new Error('Truncated WAV chunk or padding');
    if (id === 'fmt ') {
      if (fmt) throw new Error('Duplicate WAV fmt chunk');
      fmt = buffer.subarray(start, start + n);
    }
    if (id === 'data') {
      if (data) throw new Error('Duplicate WAV data chunk');
      data = buffer.subarray(start, start + n);
    }
    pos = paddedEnd;
  }
  if (pos !== buffer.length) throw new Error('Trailing or truncated WAV chunk header');
  if (!fmt || !data || fmt.length !== 16 || data.length === 0) throw new Error('Missing or non-canonical WAV fmt/data');
  const audioFormat = fmt.readUInt16LE(0), channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14);
  const byteRate = fmt.readUInt32LE(8), blockAlign = fmt.readUInt16LE(12);
  if (audioFormat !== 1 || channels !== 1 || bits !== 16 || sampleRate !== (options.sampleRate ?? 44100) || byteRate !== sampleRate * 2 || blockAlign !== 2 || !sampleRate || data.length % 2) throw new Error('Unsupported WAV format (expected PCM16 mono 44100Hz)');
  const samples = new Int16Array(data.length / 2); for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s / 32768)), 0), mean = samples.reduce((a, s) => a + s / 32768, 0) / samples.length;
  const rms = Math.sqrt(samples.reduce((a, s) => a + (s / 32768) ** 2, 0) / samples.length), clipped = samples.filter(s => Math.abs(s) >= 32767).length;
  let zc = 0; for (let i = 1; i < samples.length; i++) if ((samples[i] < 0) !== (samples[i - 1] < 0)) zc++;
  const frame = Math.max(1, Math.floor(samples.length / 128)); let centroidSum = 0;
  for (let j = 0; j < 128; j++) { let crossings = 0; const a = j * frame, z = Math.min(samples.length, a + frame); for (let i = a + 1; i < z; i++) if ((samples[i] < 0) !== (samples[i - 1] < 0)) crossings++; centroidSum += crossings / Math.max(1, z - a); }
  const edge = Math.max(1, Math.floor(samples.length * 0.05)); const edgeRms = (from, to) => Math.sqrt(samples.slice(from, to).reduce((a, s) => a + (s / 32768) ** 2, 0) / Math.max(1, to - from));
  const firstRms = edgeRms(0, edge), lastRms = edgeRms(samples.length - edge, samples.length);
  if (options.rejectSilent && rms < 1e-4) throw new Error('silent WAV');
  return { sampleRate, channels, bitDepth: bits, frames: samples.length, durationSec: samples.length / sampleRate, peak, rms, dcOffset: mean, clippingSamples: clipped, zeroCrossingRate: zc / Math.max(1, samples.length - 1), spectralProxyZcr: centroidSum / 128, fadeInRatio: firstRms / Math.max(rms, 1e-9), fadeOutRatio: lastRms / Math.max(rms, 1e-9), sha256: createHash('sha256').update(buffer).digest('hex') };
}

function resolvedProjectFile(projectRoot, relativePath, label) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) throw new Error(`invalid ${label} path`);
  const root = path.resolve(projectRoot);
  const candidate = path.resolve(root, ...relativePath.split('/'));
  if (candidate === root || !candidate.startsWith(`${root}${path.sep}`)) throw new Error(`invalid ${label} path`);
  return candidate;
}

export async function auditProject(projectRoot, { outputPath, writeOutput = true } = {}) {
  const manifestPath = path.join(projectRoot, 'assets-src', 'local-audio', 'manifest.json'); const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); const assets = [];
  const structuralFailures = [];
  const identities = new Set(); const paths = new Set(); const hashes = new Set();
  if (!Array.isArray(manifest.assets) || manifest.assets.length !== 90) throw new Error('manifest must contain exactly 90 assets');
  for (const entry of manifest.assets) {
    const identity = `${entry.kind}:${entry.id}`;
    if (!['weapon', 'ability'].includes(entry.kind) || typeof entry.id !== 'string' || !/^[a-z0-9_]+$/.test(entry.id) || identities.has(identity)) structuralFailures.push(`manifest invalid/duplicate identity: ${identity}`);
    identities.add(identity);
    if (typeof entry.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(entry.sha256) || hashes.has(entry.sha256)) structuralFailures.push(`manifest invalid/duplicate sha256: ${identity}`);
    hashes.add(entry.sha256);
    if (!Number.isInteger(entry.bytes) || entry.bytes < 44 || !Number.isFinite(entry.durationSec) || entry.durationSec <= 0) structuralFailures.push(`manifest invalid size/duration: ${identity}`);
    for (const [label, relativePath] of [['source', entry.sourcePath], ['runtime', entry.runtimePath]]) {
      try { resolvedProjectFile(projectRoot, relativePath, label); } catch (error) { structuralFailures.push(`${identity}: ${error.message}`); }
      if (paths.has(relativePath)) structuralFailures.push(`manifest duplicate path: ${relativePath}`);
      paths.add(relativePath);
    }
  }
  for (const entry of manifest.assets) {
    const row = { id: entry.id, sourcePath: entry.sourcePath, runtimePath: entry.runtimePath, warnings: [], structuralErrors: [] };
    for (const [label, relativePath] of [['source', entry.sourcePath], ['runtime', entry.runtimePath]]) {
      try {
        const bytes = await readFile(resolvedProjectFile(projectRoot, relativePath, label));
        const metrics = parseWavBuffer(bytes);
        row[label] = metrics;
        if (metrics.sha256 !== entry.sha256) row.structuralErrors.push(`${label} sha256 mismatch`);
        if (bytes.length !== entry.bytes) row.structuralErrors.push(`${label} byte length mismatch`);
        if (Math.abs(metrics.durationSec - entry.durationSec) > (0.5 / metrics.sampleRate)) row.structuralErrors.push(`${label} duration mismatch`);
        if (metrics.rms < 1e-4) row.warnings.push(`${label} silent`);
        if (metrics.clippingSamples > 0) row.warnings.push(`${label} clipping`);
        if (Math.abs(metrics.dcOffset) > 0.02) row.warnings.push(`${label} dc offset`);
      } catch (error) { row.structuralErrors.push(`${label}: ${error.message}`); }
    }
    if (row.source?.sha256 && row.runtime?.sha256 && row.source.sha256 !== row.runtime.sha256) row.structuralErrors.push('source/runtime bytes differ');
    if (row.structuralErrors.length) structuralFailures.push(`${entry.kind}:${entry.id}: ${row.structuralErrors.join('; ')}`);
    assets.push(row);
  }
  const humanScorecard = manifest.assets.map(a => ({ id: a.id, identity: null, loudness: null, fatigue: null, spatialRoleClarity: null, headphones: null, browser: null, volume: null, notes: '' }));
  const result = { schemaVersion: '1.0.0', generatedAt: new Date().toISOString(), humanVerified: false, humanScorecardStatus: 'NOT HUMAN-VERIFIED', manifest: manifestPath, aggregate: { manifestAssets: manifest.assets.length, sourceFiles: assets.filter(a => a.source).length, runtimeFiles: assets.filter(a => a.runtime).length, structuralFailures: structuralFailures.length, structuralFailureDetails: structuralFailures, acousticWarnings: assets.reduce((n, a) => n + a.warnings.length, 0), warningAssetIds: assets.filter(a => a.warnings.length).map(a => a.id) }, humanScorecard, assets };
  if (writeOutput) { const out = outputPath || path.join(projectRoot, 'outputs', 'rc5-audio-evidence', 'audio-quality-audit.json'); await mkdir(path.dirname(out), { recursive: true }); await writeFile(out, JSON.stringify(result, null, 2) + '\n'); }
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) { const projectRoot = process.argv.includes('--project-root') ? path.resolve(process.argv[process.argv.indexOf('--project-root') + 1]) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'); const out = process.argv.includes('--output') ? path.resolve(process.argv[process.argv.indexOf('--output') + 1]) : undefined; auditProject(projectRoot, { outputPath: out }).then(r => { console.log(JSON.stringify(r.aggregate)); if (r.aggregate.structuralFailures) process.exitCode = 1; }).catch(e => { console.error(e.stack); process.exitCode = 1; }); }
