#!/usr/bin/env node
/**
 * Candidate-only acoustic triage for the ElevenLabs review queue.
 *
 * This never changes raw/mastered audio and never admits anything to runtime.
 * It decodes each MP3 through the locally installed ffmpeg binary, computes
 * conservative PCM diagnostics, and writes a deterministic human-listening
 * queue. A flag is a review hint, not a creative or rights decision.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRows } from './build_elevenlabs_human_review_scorecard.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = 'outputs/audio-factory-20260730/auto-triage-20260801.json';
const PCM_SAMPLE_RATE = 44100;
const PCM_BYTES_PER_SAMPLE = 2;

export function resolveCandidatePath(root, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || path.isAbsolute(relativePath) || relativePath.includes('\\')) {
    throw new Error('candidate path must be a non-empty project-relative POSIX path');
  }
  const base = path.resolve(root);
  const candidate = path.resolve(base, ...relativePath.split('/'));
  if (candidate === base || !candidate.startsWith(`${base}${path.sep}`)) throw new Error('candidate path escapes project root');
  return candidate;
}

function runFfmpeg(filePath, ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg') {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegBin, ['-v', 'error', '-nostdin', '-i', filePath, '-f', 's16le', '-ac', '1', '-ar', String(PCM_SAMPLE_RATE), 'pipe:1'], { windowsHide: true });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', chunk => stdout.push(chunk));
    child.stderr.on('data', chunk => stderr.push(chunk));
    child.on('error', error => reject(new Error(`ffmpeg start failed: ${error.message}`)));
    child.on('close', code => {
      if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${Buffer.concat(stderr).toString('utf8').trim().slice(0, 500)}`));
      else resolve(Buffer.concat(stdout));
    });
  });
}

export function analyzePcm16Mono(buffer, expectedDurationSec = null) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PCM_BYTES_PER_SAMPLE || buffer.length % PCM_BYTES_PER_SAMPLE !== 0) throw new Error('ffmpeg returned empty or non-PCM16 output');
  const samples = new Int16Array(buffer.length / PCM_BYTES_PER_SAMPLE);
  let sum = 0;
  let sumSquares = 0;
  let peak = 0;
  let clipped = 0;
  let zeroCrossings = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const sample = buffer.readInt16LE(i * PCM_BYTES_PER_SAMPLE);
    samples[i] = sample;
    const normalized = sample / 32768;
    sum += normalized;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
    if (Math.abs(sample) >= 32767) clipped += 1;
    if (i > 0 && ((sample < 0) !== (samples[i - 1] < 0))) zeroCrossings += 1;
  }
  const frames = samples.length;
  const durationSec = frames / PCM_SAMPLE_RATE;
  const rms = Math.sqrt(sumSquares / frames);
  const dcOffset = sum / frames;
  const edgeFrames = Math.max(1, Math.floor(frames * 0.05));
  const edgeRms = (from, to) => {
    let energy = 0;
    for (let i = from; i < to; i += 1) {
      const value = samples[i] / 32768;
      energy += value * value;
    }
    return Math.sqrt(energy / Math.max(1, to - from));
  };
  const firstRms = edgeRms(0, edgeFrames);
  const lastRms = edgeRms(frames - edgeFrames, frames);
  const durationDeltaSec = Number.isFinite(expectedDurationSec) ? durationSec - expectedDurationSec : null;
  return {
    sampleRate: PCM_SAMPLE_RATE,
    channels: 1,
    frames,
    durationSec: Number(durationSec.toFixed(6)),
    durationDeltaSec: durationDeltaSec == null ? null : Number(durationDeltaSec.toFixed(6)),
    peak: Number(peak.toFixed(6)),
    rms: Number(rms.toFixed(6)),
    dcOffset: Number(dcOffset.toFixed(6)),
    clippingSamples: clipped,
    clippingRatio: Number((clipped / frames).toFixed(8)),
    zeroCrossingRate: Number((zeroCrossings / Math.max(1, frames - 1)).toFixed(6)),
    fadeInRatio: Number((firstRms / Math.max(rms, 1e-9)).toFixed(6)),
    fadeOutRatio: Number((lastRms / Math.max(rms, 1e-9)).toFixed(6)),
  };
}

export function classifyMetrics(metrics) {
  const flags = [];
  if (metrics.rms < 0.01) flags.push('near_silent');
  else if (metrics.rms < 0.025) flags.push('under_audible');
  if (metrics.clippingRatio > 0.0005 || metrics.peak >= 0.9999) flags.push('clipping_risk');
  if (Math.abs(metrics.dcOffset) > 0.02) flags.push('dc_offset');
  if (metrics.durationDeltaSec != null && Math.abs(metrics.durationDeltaSec) > Math.max(0.15, metrics.durationSec * 0.1)) flags.push('duration_outlier');
  if (metrics.fadeInRatio > 3) flags.push('attack_dominant');
  if (metrics.fadeOutRatio > 1) flags.push('tail_dominant');
  const disposition = flags.includes('near_silent') || flags.includes('clipping_risk') || flags.includes('duration_outlier') ? 'REJECT_OR_REGENERATE_REVIEW' : flags.length ? 'LISTEN_FIRST' : 'NORMAL_LISTENING_QUEUE';
  return { flags, disposition };
}

async function mapLimit(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function consume() {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, () => consume()));
  return results;
}

function parseArgs(argv) {
  const outIndex = argv.indexOf('--out');
  const concurrencyIndex = argv.indexOf('--concurrency');
  if (outIndex !== -1 && (!argv[outIndex + 1] || argv[outIndex + 1].startsWith('--'))) throw new Error('--out requires a path');
  const out = outIndex === -1 ? DEFAULT_OUT : argv[outIndex + 1];
  const concurrency = concurrencyIndex === -1 ? 1 : Number(argv[concurrencyIndex + 1]);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('--concurrency must be an integer from 1 to 4');
  const unknown = argv.filter((value, index) => value.startsWith('--') && !['--out', '--concurrency'].includes(value) || (index > 0 && argv[index - 1] === '--out') || (index > 0 && argv[index - 1] === '--concurrency'));
  if (unknown.some(value => value.startsWith('--'))) throw new Error(`unknown option: ${unknown.find(value => value.startsWith('--'))}`);
  return { out, concurrency };
}

export async function triageCandidates({ root = ROOT, out = DEFAULT_OUT, concurrency = 1, ffmpegBin = process.env.FFMPEG_BIN || 'ffmpeg' } = {}) {
  const projectRoot = path.resolve(root);
  const rows = await buildRows(projectRoot);
  const candidates = rows.map(row => ({ ...row, absolutePath: resolveCandidatePath(projectRoot, row.raw_candidate_file) }));
  const results = await mapLimit(candidates, concurrency, async candidate => {
    const startedAt = Date.now();
    const base = { candidateId: candidate.candidate_id, wave: candidate.wave, family: candidate.family, kind: candidate.kind, rawCandidateFile: candidate.raw_candidate_file, reviewPriority: candidate.review_priority, candidateOnly: true };
    try {
      const pcm = await runFfmpeg(candidate.absolutePath, ffmpegBin);
      const metrics = analyzePcm16Mono(pcm, Number(candidate.duration_target_s) || null);
      const classification = classifyMetrics(metrics);
      const digest = createHash('sha256').update(pcm).digest('hex');
      return { ...base, decode: 'pass', decodeSha256: digest, metrics, ...classification, elapsedMs: Date.now() - startedAt };
    } catch (error) {
      return { ...base, decode: 'fail', flags: ['decode_failed'], disposition: 'REJECT_OR_REGENERATE_REVIEW', error: error.message, elapsedMs: Date.now() - startedAt };
    }
  });
  const counts = results.reduce((acc, result) => {
    acc.total += 1;
    acc[result.decode === 'pass' ? 'decoded' : 'decodeFailed'] += 1;
    acc[result.disposition] = (acc[result.disposition] || 0) + 1;
    for (const flag of result.flags || []) acc.flags[flag] = (acc.flags[flag] || 0) + 1;
    return acc;
  }, { total: 0, decoded: 0, decodeFailed: 0, REJECT_OR_REGENERATE_REVIEW: 0, LISTEN_FIRST: 0, NORMAL_LISTENING_QUEUE: 0, flags: {} });
  const report = {
    schemaVersion: '1.0.0',
    generatedAt: new Date().toISOString(),
    candidateOnly: true,
    admission: 'NOT_RUNTIME_ADMITTED',
    method: { decoder: ffmpegBin, sampleRate: PCM_SAMPLE_RATE, channels: 1, thresholds: { nearSilentRms: 0.01, underAudibleRms: 0.025, clippingRatio: 0.0005, dcOffsetAbs: 0.02, durationToleranceSec: 0.15, durationToleranceRatio: 0.1, attackDominantRatio: 3, tailDominantRatio: 1 } },
    counts,
    results,
    humanReviewStillRequired: ['rights_review', 'creative_fit', 'competitive_readability', 'in_engine_mix', 'voice consent/usage where applicable', 'final adoption decision'],
  };
  const outPath = resolveCandidatePath(projectRoot, out.replaceAll('\\', '/'));
  await mkdir(path.dirname(outPath), { recursive: true });
  const tempPath = `${outPath}.${process.pid}.${Date.now()}.partial`;
  await writeFile(tempPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
  await rename(tempPath, outPath);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const report = await triageCandidates(args);
    console.log(JSON.stringify({ output: args.out, counts: report.counts }));
  } catch (error) {
    console.error(`ElevenLabs candidate triage failed: ${error.message}`);
    process.exitCode = 1;
  }
}
