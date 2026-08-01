#!/usr/bin/env node
/**
 * Applies a non-destructive sample-peak headroom pass to ElevenLabs SFX
 * candidates. Raw provider files stay immutable. This is deliberately not a
 * mix, rights approval, or runtime admission step.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { manifest: null, root: null, ffmpeg: 'ffmpeg', out: null, targetMaxDb: -1 };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    const key = { '--manifest': 'manifest', '--root': 'root', '--ffmpeg': 'ffmpeg', '--out': 'out', '--target-max-db': 'targetMaxDb' }[flag];
    if (!key) throw new Error(`unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    out[key] = key === 'targetMaxDb' ? Number(value) : value;
  }
  if (!Number.isFinite(out.targetMaxDb) || out.targetMaxDb > -0.1 || out.targetMaxDb < -12) throw new Error('target-max-db must be between -12 and -0.1 dB');
  if (!out.help && (!out.manifest || !out.root || !out.out)) throw new Error('--manifest, --root, and --out are required');
  return out;
}

function run(ffmpeg, argv) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-y', ...argv], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'ffmpeg failed').trim().slice(-1200));
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}

export function parseVolumeDetect(text) {
  const means = [...String(text).matchAll(/mean_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/gi)];
  const peaks = [...String(text).matchAll(/max_volume:\s*(-?(?:\d+(?:\.\d+)?|inf))\s*dB/gi)];
  const meanDb = Number(means.at(-1)?.[1]);
  const maxDb = Number(peaks.at(-1)?.[1]);
  if (!Number.isFinite(meanDb) || !Number.isFinite(maxDb)) throw new Error('ffmpeg volumedetect output is incomplete');
  return { meanDb, maxDb };
}

// Lossy MP3 encoding can raise the decoded sample peak by a few tenths of a
// dB. Keep a fixed margin while attenuating only; no source is ever boosted.
export function attenuationGainDb(sourceMaxDb, targetMaxDb, encodingMarginDb = 0.35) {
  if (!Number.isFinite(sourceMaxDb) || !Number.isFinite(targetMaxDb) || !Number.isFinite(encodingMarginDb) || encodingMarginDb < 0) throw new Error('sample-peak gain inputs must be finite');
  return Math.min(0, Number((targetMaxDb - sourceMaxDb - encodingMarginDb).toFixed(6)));
}

function requestedRelativeOutput(asset) {
  const requested = asset?.output || `${asset?.id || 'candidate'}.mp3`;
  const id = asset?.id || '<unknown>';
  if (typeof requested !== 'string' || !requested || path.isAbsolute(requested) || requested.includes('\0')) {
    throw new Error(`asset ${id} output must be a safe relative path`);
  }
  const normalized = path.normalize(requested);
  if (normalized === '..' || normalized.startsWith(`..${path.sep}`) || path.isAbsolute(normalized)) {
    throw new Error(`asset ${id} output must stay inside the declared root`);
  }
  return requested;
}

function resolveInside(root, requested, id) {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, requested);
  const relative = path.relative(resolvedRoot, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`asset ${id} output must stay inside the declared root`);
  }
  return resolved;
}

export function resolveCandidateInput(rawRoot, asset) {
  const requested = requestedRelativeOutput(asset);
  return resolveInside(rawRoot, requested, asset?.id || '<unknown>');
}

export function resolveMasteredOutput(outputRoot, asset) {
  const requested = requestedRelativeOutput(asset);
  return resolveInside(outputRoot, path.join('sfx', path.basename(requested)), asset?.id || '<unknown>');
}

function volumeMetrics(ffmpeg, input) {
  return parseVolumeDetect(run(ffmpeg, ['-i', input, '-map', '0:a:0', '-af', 'volumedetect', '-f', 'null', '-']));
}

async function main() {
  const options = parseArgs();
  if (options.help) { console.log('Usage: node tools/master_elevenlabs_sfx_candidates.js --manifest FILE --root DIR --ffmpeg PATH --out DIR [--target-max-db -1]'); return; }
  const manifestPath = path.resolve(options.manifest);
  const rawRoot = path.resolve(options.root);
  const outputRoot = path.resolve(options.out);
  const source = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assets = (source.assets || []).filter(asset => asset.kind === 'sound_effect');
  const planned = assets.map(asset => ({ asset, input: resolveCandidateInput(rawRoot, asset), output: resolveMasteredOutput(outputRoot, asset) }));
  const masteredOutputs = new Set();
  for (const plan of planned) {
    if (masteredOutputs.has(plan.output)) throw new Error(`duplicate mastered output: ${path.basename(plan.output)}`);
    masteredOutputs.add(plan.output);
  }
  const results = [];
  for (const { asset, input, output } of planned) {
    try {
      const raw = await readFile(input);
      if (!asset.sha256 || digest(raw) !== asset.sha256) throw new Error('raw sha256 mismatch');
      const sourceMetrics = volumeMetrics(options.ffmpeg, input);
      // Never boost a provider candidate. We only reduce sample peak when it
      // reaches the requested ceiling, preserving its relative dynamics for
      // later creative and in-engine mix review.
      let gainDb = attenuationGainDb(sourceMetrics.maxDb, options.targetMaxDb);
      await mkdir(path.dirname(output), { recursive: true });
      let mastered = null;
      let masteredMetrics = null;
      let encodingPasses = 0;
      // MP3 encode/decode can add more peak than a single fixed margin on a
      // sharp transient. Re-encode from the immutable raw input (never from a
      // derivative) with a bounded extra attenuation until it meets the cap.
      for (; encodingPasses < 3; encodingPasses++) {
        run(options.ffmpeg, ['-i', input, '-map', '0:a:0', '-af', `volume=${gainDb}dB`, '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '192k', output]);
        mastered = await readFile(output);
        masteredMetrics = volumeMetrics(options.ffmpeg, output);
        if (masteredMetrics.maxDb <= options.targetMaxDb + 0.15) break;
        gainDb += attenuationGainDb(masteredMetrics.maxDb, options.targetMaxDb);
      }
      if (masteredMetrics.meanDb < -70) throw new Error(`silent or near-silent output (${masteredMetrics.meanDb} dB)`);
      if (masteredMetrics.maxDb > options.targetMaxDb + 0.15) throw new Error(`sample peak ${masteredMetrics.maxDb} dB exceeds ${options.targetMaxDb} dB ceiling`);
      results.push({ id: asset.id, family: asset.family || null, input: path.relative(process.cwd(), input).replaceAll('\\', '/'), inputSha256: digest(raw), output: path.relative(process.cwd(), output).replaceAll('\\', '/'), outputSha256: digest(mastered), bytes: mastered.length, sourceMetrics, gainDb, encodingPasses: encodingPasses + 1, masteredMetrics, status: 'mastered' });
    } catch (error) {
      results.push({ id: asset.id, status: 'failed', error: error.message });
    }
  }
  const failed = results.filter(result => result.status !== 'mastered');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), manifestPath).replaceAll('\\', '/'),
    kind: 'sound_effect',
    targetSamplePeakDb: options.targetMaxDb,
    policy: 'attenuation-only candidate mastering; raw provider files are immutable; sample-peak headroom is technical evidence, not a substitute for true-peak, loudness, creative, rights, or in-engine mix approval',
    admission: 'candidate-only; mastered output is not part of the shipped Local DSP catalog',
    results,
    mastered: results.length - failed.length,
    failed: failed.length,
  };
  await mkdir(outputRoot, { recursive: true });
  const reportPath = path.join(outputRoot, 'master-manifest.json');
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ report: path.relative(process.cwd(), reportPath).replaceAll('\\', '/'), mastered: report.mastered, failed: report.failed }));
  if (failed.length) process.exitCode = 1;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]);
if (invoked === path.resolve(fileURLToPath(import.meta.url))) main().catch(error => { console.error(`SFX mastering failed: ${error.message}`); process.exitCode = 1; });
