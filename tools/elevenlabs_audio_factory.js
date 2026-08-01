#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}` : JSON.stringify(value);
export const requestHash = request => createHash('sha256').update(stable(request)).digest('hex');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const redacted = error => { const msg = error instanceof Error ? error.message : String(error); return msg.replace(/(xi-api-key|authorization|api[-_ ]?key)\s*[:=]\s*[^,\s]+/ig, '$1=[REDACTED]'); };
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function positiveInteger(value, label, { allowZero = false } = {}) {
  if (!Number.isInteger(value) || value < (allowZero ? 0 : 1)) throw new Error(`${label} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`);
  return value;
}

function nonNegativeNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new Error(`${label} must be a non-negative finite number`);
  return value;
}

function manifestBudget(manifest) {
  if (manifest.executionBudget === undefined || manifest.executionBudget === null) return { maxAssets: Infinity, maxEstimatedCredits: Infinity };
  if (!isRecord(manifest.executionBudget)) throw new Error('manifest.executionBudget must be an object');
  const budget = manifest.executionBudget;
  return {
    maxAssets: budget.maxAssets === undefined ? Infinity : positiveInteger(budget.maxAssets, 'manifest.executionBudget.maxAssets'),
    maxEstimatedCredits: budget.maxEstimatedCredits === undefined ? Infinity : nonNegativeNumber(budget.maxEstimatedCredits, 'manifest.executionBudget.maxEstimatedCredits'),
  };
}

function requestedOutput(asset) {
  if (typeof asset.output === 'string' && asset.output) return asset.output;
  return `${asset.id}.mp3`;
}

function resolveAssetOutput(outputRoot, asset) {
  const requested = requestedOutput(asset);
  if (typeof requested !== 'string' || !requested || path.isAbsolute(requested) || requested.includes('\0')) throw new Error(`asset ${asset.id || '<unknown>'} output must be a safe relative path`);
  const root = path.resolve(outputRoot);
  const output = path.resolve(root, requested);
  const relative = path.relative(root, output);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`asset ${asset.id || '<unknown>'} output must stay inside outputRoot`);
  return output;
}

function validateEndpoint(endpoint, id) {
  if (typeof endpoint !== 'string' || !endpoint.startsWith('/v1/') || endpoint.startsWith('//') || /[\\\r\n\t]/.test(endpoint) || endpoint.includes('/../') || endpoint.includes('/./')) {
    throw new Error(`asset ${id || '<unknown>'} endpoint must be a relative ElevenLabs /v1/ path`);
  }
  const url = new URL(endpoint, 'https://api.elevenlabs.io');
  if (url.origin !== 'https://api.elevenlabs.io' || !url.pathname.startsWith('/v1/')) throw new Error(`asset ${id || '<unknown>'} endpoint must be a relative ElevenLabs /v1/ path`);
  return url.pathname;
}

function validateProviderRequest(endpoint, request, id) {
  const pathname = validateEndpoint(endpoint, id);
  // Runtime evidence from the live Sound Generation endpoint confirms the
  // 450-character ceiling. Catch it before a billable wave can submit a 400.
  if (pathname === '/v1/sound-generation') {
    if (typeof request.text !== 'string' || request.text.length < 1 || request.text.length > 450) throw new Error(`asset ${id} sound-generation text must be 1..450 characters`);
    // Older test/dry-run manifests intentionally omit duration and let the
    // provider choose it. If a wave pins duration, validate the live API range.
    if (request.duration_seconds !== undefined && (!Number.isFinite(request.duration_seconds) || request.duration_seconds < 0.5 || request.duration_seconds > 30)) throw new Error(`asset ${id} sound-generation duration_seconds must be 0.5..30`);
  }
  if (pathname === '/v1/music') {
    if (request.prompt !== undefined && (typeof request.prompt !== 'string' || request.prompt.length > 4100)) throw new Error(`asset ${id} music prompt must be at most 4100 characters`);
    if (request.prompt !== undefined && request.composition_plan !== undefined) throw new Error(`asset ${id} music prompt and composition_plan are mutually exclusive`);
    if (request.music_length_ms !== undefined && (!Number.isInteger(request.music_length_ms) || request.music_length_ms < 3000 || request.music_length_ms > 600000)) throw new Error(`asset ${id} music_length_ms must be 3000..600000`);
  }
}

/**
 * Validate the billable request boundary before the factory makes a network
 * call.  In particular, a manifest cannot escape the staging root, point at a
 * foreign host, or submit a duplicate billable request by accident.
 */
export function validateManifest(manifest, { outputRoot = process.cwd(), maxAssets = null, maxEstimatedCredits = null } = {}) {
  if (!isRecord(manifest) || !Array.isArray(manifest.assets)) throw new Error('manifest.assets must be an array');
  if (maxAssets !== null) positiveInteger(maxAssets, 'max-assets');
  if (maxEstimatedCredits !== null) nonNegativeNumber(maxEstimatedCredits, 'max-estimated-credits');
  const budget = manifestBudget(manifest);
  const assetIds = new Set();
  const outputs = new Set();
  const requests = new Set();
  for (const asset of manifest.assets) {
    if (!isRecord(asset) || typeof asset.id !== 'string' || !asset.id.trim()) throw new Error('each asset requires a non-empty id');
    if (assetIds.has(asset.id)) throw new Error(`duplicate asset id: ${asset.id}`);
    assetIds.add(asset.id);
    if (!isRecord(asset.request)) throw new Error(`asset ${asset.id} request must be an object`);
    validateProviderRequest(asset.endpoint, asset.request, asset.id);
    const output = resolveAssetOutput(outputRoot, asset);
    if (outputs.has(output)) throw new Error(`duplicate asset output: ${requestedOutput(asset)}`);
    outputs.add(output);
    const hash = requestHash(asset.request);
    if (requests.has(hash)) throw new Error(`duplicate billable request: ${asset.id}`);
    requests.add(hash);
    if (asset.estimatedCredits !== undefined) nonNegativeNumber(asset.estimatedCredits, `asset ${asset.id} estimatedCredits`);
  }
  const effectiveMaxAssets = Math.min(budget.maxAssets, maxAssets ?? Infinity);
  const assets = manifest.assets.slice(0, effectiveMaxAssets);
  const effectiveCreditCap = Math.min(budget.maxEstimatedCredits, maxEstimatedCredits ?? Infinity);
  const estimatedCredits = assets.reduce((total, asset) => total + (asset.estimatedCredits ?? 0), 0);
  if (Number.isFinite(effectiveCreditCap)) {
    if (assets.some(asset => asset.estimatedCredits === undefined)) throw new Error('estimatedCredits is required when a credit ceiling is set');
    if (estimatedCredits > effectiveCreditCap) throw new Error(`estimated credits ${estimatedCredits} exceed ceiling ${effectiveCreditCap}`);
  }
  return { assets, planned: assets.length, estimatedCredits, maxAssets: effectiveMaxAssets, maxEstimatedCredits: effectiveCreditCap };
}

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { manifestPath: 'assets-src/elevenlabs/manifest.json', outputRoot: process.cwd(), dryRun: false, resume: true, concurrency: 3, maxRetries: 3, baseDelayMs: 800, maxAssets: null, maxEstimatedCredits: null };
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a === '--help' || a === '-h') { out.help = true; continue; } if (a === '--dry-run') { out.dryRun = true; continue; } if (a === '--no-resume') { out.resume = false; continue; } const key = { '--manifest': 'manifestPath', '--output': 'outputRoot', '--concurrency': 'concurrency', '--max-retries': 'maxRetries', '--base-delay-ms': 'baseDelayMs', '--max-assets': 'maxAssets', '--max-estimated-credits': 'maxEstimatedCredits' }[a]; if (!key) throw new Error(`unknown argument: ${a}`); const v = argv[++i]; if (!v || v.startsWith('--')) throw new Error(`${a} requires a value`); out[key] = ['concurrency', 'maxRetries', 'baseDelayMs', 'maxAssets', 'maxEstimatedCredits'].includes(key) ? Number(v) : v; }
  if (!Number.isInteger(out.concurrency) || out.concurrency < 1 || out.concurrency > 32) throw new Error('concurrency must be 1..32');
  if (!Number.isInteger(out.maxRetries) || out.maxRetries < 0 || out.maxRetries > 10) throw new Error('max-retries must be 0..10');
  if (!Number.isFinite(out.baseDelayMs) || out.baseDelayMs < 0 || out.baseDelayMs > 60000) throw new Error('base-delay-ms must be 0..60000');
  if (out.maxAssets !== null) positiveInteger(out.maxAssets, 'max-assets');
  if (out.maxEstimatedCredits !== null) nonNegativeNumber(out.maxEstimatedCredits, 'max-estimated-credits');
  return out;
}

let writeSerial = 0;
let manifestWrite = Promise.resolve();
async function atomicJson(file, data) { await mkdir(path.dirname(file), { recursive: true }); const tmp = `${file}.${process.pid}.${Date.now()}.${writeSerial++}.partial`; await writeFile(tmp, `${JSON.stringify(data, null, 2)}\n`); await rename(tmp, file); }
function persistManifest(file, data) {
  manifestWrite = manifestWrite.then(() => atomicJson(file, data));
  return manifestWrite;
}
const retryable = status => status === 429 || status >= 500;
const retryDelayMs = (args, attempt) => {
  const base = args.baseDelayMs * 2 ** attempt;
  if (base === 0) return 0;
  const random = typeof args.random === 'function' ? args.random() : Math.random();
  const jitter = 0.75 + Math.min(1, Math.max(0, Number.isFinite(random) ? random : 0.5)) * 0.5;
  return Math.round(base * jitter);
};

export async function runFactory(options = {}) {
  const args = { ...parseArgs([]), ...options };
  const manifestPath = path.resolve(args.manifestPath); const outputRoot = path.resolve(args.outputRoot);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const validation = validateManifest(manifest, { outputRoot, maxAssets: args.maxAssets, maxEstimatedCredits: args.maxEstimatedCredits });
  const assets = validation.assets;
  if (args.dryRun) return { planned: validation.planned, estimatedCredits: validation.estimatedCredits, skipped: 0, completed: 0, dryRun: true };
  // An explicit null makes tests independent from a real process environment.
  // The key remains in process memory only and is never written into a manifest.
  const apiKey = args.apiKey === undefined ? process.env.ELEVENLABS_API_KEY?.trim() : args.apiKey;
  if (args.hasApiKey !== true && (typeof apiKey !== 'string' || !apiKey)) throw new Error('ELEVENLABS_API_KEY required for actual execution');
  const fetchImpl = args.fetchImpl || globalThis.fetch; if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');
  let cursor = 0, completed = 0, skipped = 0, retries = 0, firstError = null;
  const worker = async () => { while (!firstError) { const index = cursor++; if (index >= assets.length) return; const asset = assets[index]; const hash = requestHash(asset.request || {}); const output = resolveAssetOutput(outputRoot, asset); if (args.resume !== false && asset.requestHash === hash && asset.sha256) { try { const bytes = await readFile(output); if (sha256(bytes) === asset.sha256) { skipped++; continue; } } catch {} }
      let response; for (let attempt = 0; ; attempt++) { try { response = await fetchImpl(`https://api.elevenlabs.io${asset.endpoint}`, { method: 'POST', headers: { 'content-type': 'application/json', 'xi-api-key': typeof apiKey === 'string' ? apiKey : '[injected-at-runtime]' }, body: JSON.stringify(asset.request || {}) }); } catch (e) { if (attempt >= args.maxRetries) throw e; retries++; await delay(retryDelayMs(args, attempt)); continue; } if (response.ok) break; const detail = typeof response.text === 'function' ? (await response.text()).slice(0, 240) : ''; if (!retryable(response.status) || attempt >= args.maxRetries) throw new Error(`provider request failed (${response.status}): ${detail}`); retries++; await delay(retryDelayMs(args, attempt)); }
      const bytes = Buffer.from(await response.arrayBuffer()); if (!bytes.length) throw new Error(`empty audio response for ${asset.id}`); const digest = sha256(bytes); const qc = args.qcHook || args.qc; if (qc) { const verdict = await qc({ asset, bytes, sha256: digest }); if (verdict === false) throw new Error(`QC rejected audio for ${asset.id}`); }
      await mkdir(path.dirname(output), { recursive: true }); const tmp = `${output}.${process.pid}.${Date.now()}.${writeSerial++}.partial`; await writeFile(tmp, bytes); await rename(tmp, output); asset.requestHash = hash; asset.sha256 = digest; asset.bytes = bytes.length; asset.contentType = response.headers?.get?.('content-type') || null; asset.requestId = response.headers?.get?.('request-id') || null; asset.traceId = response.headers?.get?.('x-trace-id') || response.headers?.get?.('trace-id') || null; asset.songId = response.headers?.get?.('song-id') || null; asset.characterCost = Number(response.headers?.get?.('character-cost')) || null; asset.httpStatus = Number(response.status) || 200; asset.generatedAt = new Date().toISOString(); await persistManifest(manifestPath, manifest); completed++; }
  };
  await Promise.all(Array.from({ length: Math.min(args.concurrency, assets.length) }, async () => { try { await worker(); } catch (e) { firstError ||= e; } }));
  await manifestWrite;
  if (firstError) throw firstError; return { planned: validation.planned, estimatedCredits: validation.estimatedCredits, completed, skipped, retries, dryRun: false, manifestPath };
}

export async function main(argv = process.argv.slice(2), log = console.log) { const args = parseArgs(argv); if (args.help) { log('Usage: node tools/elevenlabs_audio_factory.js --manifest FILE [--output DIR] [--dry-run] [--concurrency N] [--max-retries N] [--max-assets N] [--max-estimated-credits N]'); return 0; } log(JSON.stringify(await runFactory(args))); return 0; }
const invoked = process.argv[1] && path.resolve(process.argv[1]); if (invoked === path.resolve(fileURLToPath(import.meta.url))) { main().catch(e => { console.error(`ElevenLabs audio factory failed: ${redacted(e)}`); process.exitCode = 1; }); }
