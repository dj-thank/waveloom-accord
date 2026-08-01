#!/usr/bin/env node
/**
 * Two-pass loudness mastering for ElevenLabs music or voice candidates.
 * Raw provider files remain immutable.  Mastered derivatives stay candidate-only
 * until an audio owner approves rights, editorial fit, and in-engine mix.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export function parseArgs(argv = process.argv.slice(2)) {
  const out = { manifest: null, root: null, ffmpeg: 'ffmpeg', out: null, kind: 'music', targetI: undefined, targetTp: undefined, targetLra: undefined };
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--help') { out.help = true; continue; }
    const name = { '--manifest': 'manifest', '--root': 'root', '--ffmpeg': 'ffmpeg', '--out': 'out', '--kind': 'kind', '--target-i': 'targetI', '--target-tp': 'targetTp', '--target-lra': 'targetLra' }[key];
    if (!name) throw new Error(`unknown argument: ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
    out[name] = ['targetI', 'targetTp', 'targetLra'].includes(name) ? Number(value) : value;
  }
  const profiles = {
    music: { targetI: -18, targetTp: -1.5, targetLra: 11, sampleRate: 48000, channels: 2, bitrate: '192k', folder: 'music' },
    // Short operations lines are peak-limited speech, not programme-length music.
    // Their integrated loudness is retained as evidence rather than forced to a
    // musically inappropriate exact target.
    text_to_speech: { targetI: -18, targetTp: -1, targetLra: 7, sampleRate: 48000, channels: 1, bitrate: '160k', folder: 'voices' },
  };
  if (!profiles[out.kind]) throw new Error('--kind must be music or text_to_speech');
  Object.assign(out, profiles[out.kind], {
    targetI: out.targetI ?? profiles[out.kind].targetI,
    targetTp: out.targetTp ?? profiles[out.kind].targetTp,
    targetLra: out.targetLra ?? profiles[out.kind].targetLra,
  });
  if (!out.help && (!out.manifest || !out.root || !out.out)) throw new Error('--manifest, --root, and --out are required');
  return out;
}
function run(ffmpeg, argv) {
  const result = spawnSync(ffmpeg, ['-hide_banner', '-y', ...argv], { encoding: 'utf8' });
  if (result.status !== 0) throw new Error((result.stderr || result.stdout || 'ffmpeg failed').trim().slice(-1200));
  return `${result.stdout || ''}\n${result.stderr || ''}`;
}
export function parseLoudnorm(text) {
  const match = text.match(/\{\s*"input_i"[\s\S]*?\}/);
  if (!match) throw new Error('loudnorm measurement JSON missing');
  const measurement = JSON.parse(match[0]);
  for (const field of ['input_i', 'input_lra', 'input_tp', 'input_thresh', 'target_offset']) if (!Number.isFinite(Number(measurement[field]))) throw new Error(`invalid loudnorm ${field}`);
  return measurement;
}
function measurementFilter(options, measured) {
  return [
    `I=${options.targetI}`, `TP=${options.targetTp}`, `LRA=${options.targetLra}`,
    `measured_I=${measured.input_i}`, `measured_LRA=${measured.input_lra}`,
    `measured_TP=${measured.input_tp}`, `measured_thresh=${measured.input_thresh}`,
    `offset=${measured.target_offset}`, 'linear=true', 'print_format=summary',
  ].join(':');
}
async function main() {
  const options = parseArgs();
  if (options.help) { console.log('Usage: node tools/master_elevenlabs_music_candidates.js --manifest FILE --root DIR --ffmpeg PATH --out DIR [--kind music|text_to_speech]'); return; }
  const manifestPath = path.resolve(options.manifest);
  const rawRoot = path.resolve(options.root);
  const outputRoot = path.resolve(options.out);
  const source = JSON.parse(await readFile(manifestPath, 'utf8'));
  const assets = (source.assets || []).filter(asset => asset.kind === options.kind);
  const results = [];
  for (const asset of assets) {
    const input = path.resolve(rawRoot, asset.output);
    const output = path.resolve(outputRoot, options.folder, path.basename(asset.output));
    try {
      const raw = await readFile(input);
      if (digest(raw) !== asset.sha256) throw new Error('raw sha256 mismatch');
      const base = `loudnorm=I=${options.targetI}:TP=${options.targetTp}:LRA=${options.targetLra}:print_format=json`;
      const measure = parseLoudnorm(run(options.ffmpeg, ['-i', input, '-map', '0:a:0', '-af', base, '-f', 'null', '-']));
      await mkdir(path.dirname(output), { recursive: true });
      run(options.ffmpeg, ['-i', input, '-map', '0:a:0', '-af', `loudnorm=${measurementFilter(options, measure)}`, '-ar', String(options.sampleRate), '-ac', String(options.channels), '-c:a', 'libmp3lame', '-b:a', options.bitrate, output]);
      const mastered = await readFile(output);
      const postMeasurement = parseLoudnorm(run(options.ffmpeg, ['-i', output, '-map', '0:a:0', '-af', base, '-f', 'null', '-']));
      const postIntegrated = Number(postMeasurement.input_i);
      if (options.kind === 'music' && Math.abs(postIntegrated - options.targetI) > 1) throw new Error(`post-master integrated loudness=${postMeasurement.input_i}`);
      if (options.kind === 'text_to_speech' && postIntegrated < -23) throw new Error(`short-form voice below minimum loudness=${postMeasurement.input_i}`);
      const peakToleranceDb = 0.3; // MP3 encode/decode measurement rounding; preserves a deliberate headroom cap for each profile.
      if (Number(postMeasurement.input_tp) > options.targetTp + peakToleranceDb) throw new Error(`post-master true peak=${postMeasurement.input_tp}`);
      const loudnessGate = options.kind === 'music' ? `target ${options.targetI} LUFS +/- 1 LU` : 'short-form VO minimum -23 LUFS; integrated value retained for mix review';
      results.push({ id: asset.id, kind: options.kind, input: path.relative(process.cwd(), input).replaceAll('\\', '/'), inputSha256: digest(raw), output: path.relative(process.cwd(), output).replaceAll('\\', '/'), outputSha256: digest(mastered), bytes: mastered.length, measurement: measure, postMeasurement, target: { integratedLufs: options.targetI, loudnessGate, truePeakDbtp: options.targetTp, loudnessRangeLu: options.targetLra, allowedMaxTruePeakDbtp: options.targetTp + peakToleranceDb, sampleRate: options.sampleRate, channels: options.channels, bitrate: options.bitrate }, status: 'mastered' });
    } catch (error) { results.push({ id: asset.id, input: path.relative(process.cwd(), input).replaceAll('\\', '/'), status: 'failed', error: error.message }); }
  }
  const failed = results.filter(result => result.status !== 'mastered');
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    sourceManifest: path.relative(process.cwd(), manifestPath).replaceAll('\\', '/'),
    kind: options.kind,
    admission: 'candidate-only; raw provider audio is retained, and this derivative is not in the shipped Local DSP catalog',
    policy: 'technical mastering only; rights, editorial fit, in-engine mix, and human acceptance remain required',
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
if (invoked === path.resolve(fileURLToPath(import.meta.url))) main().catch(error => { console.error(`Music mastering failed: ${error.message}`); process.exitCode = 1; });
