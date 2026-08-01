#!/usr/bin/env node
/**
 * Secret-safe ElevenLabs execution preflight.
 *
 * This tool intentionally records only the minimum operational facts needed
 * to approve a bounded candidate wave.  It never writes an API key, account
 * identifiers, invoices, raw model descriptions, or raw provider responses.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_OUTPUT = 'outputs/audio-factory-20260730/elevenlabs-preflight.json';
const DEFAULT_TTS_MODELS = ['eleven_multilingual_v2'];

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonEmptyString = (value, label) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string`);
  return value.trim();
};

export function parseArgs(argv = process.argv.slice(2)) {
  const out = { output: DEFAULT_OUTPUT, timeoutMs: 15000, requiredTtsModels: [], requireSubscription: true };
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help' || flag === '-h') { out.help = true; continue; }
    if (flag === '--allow-no-subscription') { out.requireSubscription = false; continue; }
    const key = { '--out': 'output', '--timeout-ms': 'timeoutMs', '--required-tts-model': 'requiredTtsModels' }[flag];
    if (!key) throw new Error(`unknown argument: ${flag}`);
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${flag} requires a value`);
    if (key === 'requiredTtsModels') out.requiredTtsModels.push(nonEmptyString(value, flag));
    else out[key] = key === 'timeoutMs' ? Number(value) : value;
  }
  if (!Number.isInteger(out.timeoutMs) || out.timeoutMs < 1000 || out.timeoutMs > 60000) throw new Error('timeout-ms must be 1000..60000');
  if (!out.requiredTtsModels.length) out.requiredTtsModels = [...DEFAULT_TTS_MODELS];
  return out;
}

async function getJson(fetchImpl, url, apiKey, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
      signal: controller.signal,
    });
    if (!response?.ok) throw new Error(`provider preflight failed (${Number(response?.status) || 'network'})`);
    return response.json();
  } finally {
    clearTimeout(timer);
  }
}

function safeSubscription(value) {
  if (!isRecord(value)) throw new Error('subscription response must be an object');
  const used = Number(value.character_count);
  const limit = Number(value.character_limit);
  if (!Number.isFinite(used) || used < 0 || !Number.isFinite(limit) || limit < used) throw new Error('subscription credit counters are invalid');
  return {
    access: 'available',
    status: typeof value.status === 'string' ? value.status : 'unknown',
    creditsUsed: used,
    creditLimit: limit,
    creditsRemaining: limit - used,
    overageEnabled: value.max_credit_limit_extension !== 0,
  };
}

function safeModel(model) {
  return {
    modelId: model.model_id,
    name: typeof model.name === 'string' ? model.name : null,
    canDoTextToSpeech: model.can_do_text_to_speech === true,
    concurrencyGroup: typeof model.concurrency_group === 'string' ? model.concurrency_group : null,
  };
}

/**
 * Returns a deliberately redacted operational report. Music and sound-effect
 * access are endpoint capabilities rather than a promise made by /v1/models,
 * so this report names that limitation instead of manufacturing a false pass.
 */
export async function runPreflight(options = {}) {
  const args = { ...parseArgs([]), ...options };
  const apiKey = options.apiKey === undefined ? process.env.ELEVENLABS_API_KEY?.trim() : options.apiKey;
  if (typeof apiKey !== 'string' || !apiKey) throw new Error('ELEVENLABS_API_KEY required for provider preflight');
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation unavailable');
  const modelsPayload = await getJson(fetchImpl, 'https://api.elevenlabs.io/v1/models', apiKey, args.timeoutMs);
  if (!Array.isArray(modelsPayload)) throw new Error('models response must be an array');
  const models = modelsPayload.filter(isRecord).map(safeModel).filter(model => typeof model.modelId === 'string');
  const requiredTts = args.requiredTtsModels.map(modelId => {
    const model = models.find(candidate => candidate.modelId === modelId);
    return { modelId, listed: Boolean(model), canDoTextToSpeech: model?.canDoTextToSpeech ?? false, concurrencyGroup: model?.concurrencyGroup ?? null };
  });
  const unavailable = requiredTts.filter(model => !model.listed || !model.canDoTextToSpeech);
  if (unavailable.length) throw new Error(`required TTS model unavailable: ${unavailable.map(model => model.modelId).join(', ')}`);
  let subscription;
  try {
    subscription = safeSubscription(await getJson(fetchImpl, 'https://api.elevenlabs.io/v1/user/subscription', apiKey, args.timeoutMs));
  } catch (error) {
    if (args.requireSubscription !== false) throw error;
    subscription = { access: 'unavailable', status: 'unavailable', creditsUsed: null, creditLimit: null, creditsRemaining: null, overageEnabled: null };
  }
  return {
    schemaVersion: 1,
    checkedAt: (options.now || new Date()).toISOString(),
    apiKeyPresent: true,
    modelListing: { availableModels: models.length, requiredTts },
    endpointCapabilityBoundary: 'Music and sound-effect availability is not inferred from /v1/models; prove each with a bounded endpoint-specific candidate wave and record its response metadata.',
    subscription,
    admission: 'preflight-only; no candidate is admitted to runtime, distribution, or human approval by this record',
  };
}

async function atomicJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  if (args.help) {
    log('Usage: node tools/elevenlabs_preflight.js [--out FILE] [--timeout-ms 1000..60000] [--required-tts-model ID] [--allow-no-subscription]');
    return 0;
  }
  const report = await runPreflight(args);
  const output = path.resolve(args.output);
  await atomicJson(output, report);
  log(JSON.stringify({ output: path.relative(process.cwd(), output).replaceAll('\\', '/'), availableModels: report.modelListing.availableModels, creditsRemaining: report.subscription.creditsRemaining, subscriptionAccess: report.subscription.access }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`ElevenLabs preflight failed: ${error.message}`); process.exitCode = 1; });
}
