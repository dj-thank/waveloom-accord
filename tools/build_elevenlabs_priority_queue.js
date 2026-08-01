#!/usr/bin/env node
/**
 * Build a deterministic, candidate-only human listening queue from the
 * automated ElevenLabs acoustic triage report and its companion scorecard.
 *
 * This tool deliberately does not generate, modify, or admit audio.  It makes
 * the remaining human decisions explicit so that a large batch can be reviewed
 * in a safe order without confusing decoder health with creative acceptance.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_TRIAGE = 'outputs/audio-factory-20260801/auto-triage-20260801.json';
const DEFAULT_SCORECARD = 'outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_SCORECARD.csv';
const DEFAULT_JSON = 'outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.json';
const DEFAULT_CSV = 'outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv';

const DISPOSITION_ORDER = new Map([
  ['REJECT_OR_REGENERATE_REVIEW', 0],
  ['LISTEN_FIRST', 1],
  ['NORMAL_LISTENING_QUEUE', 2],
]);

const HUMAN_FIELDS = [
  'identity_score',
  'distance_score',
  'mask_resistance_score',
  'loop_seam_score',
  'duplication_score',
  'noise_clipping_score',
  'rights_review',
  'creative_fit',
  'competitive_readability',
  'in_engine_mix',
  'human_decision',
  'human_notes',
];

export function csvCell(value) {
  return `"${String(value ?? '').replaceAll('"', '""')}"`;
}

/** Minimal RFC4180 row parser; scorecard fields are quoted by our writer. */
export function parseCsvRow(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(cell);
      cell = '';
    } else {
      cell += char;
    }
  }
  if (quoted) throw new Error('unterminated CSV quote');
  cells.push(cell);
  return cells;
}

export function parseScorecardCsv(csv) {
  const lines = String(csv).split(/\r?\n/).filter(line => line.length > 0);
  if (!lines.length) return [];
  const headers = parseCsvRow(lines[0]);
  return lines.slice(1).map(line => {
    const values = parseCsvRow(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

function numeric(value) {
  return value == null || value === '' || !Number.isFinite(Number(value)) ? '' : Number(value);
}

function reason(result) {
  if (result.decode !== 'pass') return 'decode_failed';
  if (result.flags?.length) return result.flags.join(';');
  return 'automated_qc_clear;human_review_required';
}

function priorityNumber(priority) {
  return priority === 'P1' ? 0 : priority === 'P2' ? 1 : 2;
}

export function buildPriorityQueue(triage, scorecardRows = []) {
  if (!triage || !Array.isArray(triage.results)) throw new Error('triage report results are required');
  if (triage.candidateOnly !== true) throw new Error('triage report must be candidate-only');
  const scorecard = new Map(scorecardRows.map(row => [row.candidate_id, row]));
  const rows = triage.results.map(result => {
    const card = scorecard.get(result.candidateId) || {};
    const metrics = result.metrics || {};
    const row = {
      candidate_id: result.candidateId,
      wave: result.wave || card.wave || '',
      family: result.family || card.family || '',
      kind: result.kind || card.kind || '',
      review_bucket: result.disposition || 'LISTEN_FIRST',
      review_priority: result.reviewPriority || card.review_priority || 'P2',
      review_reason: reason(result),
      decode: result.decode || 'unknown',
      raw_candidate_file: result.rawCandidateFile || card.raw_candidate_file || '',
      mastered_candidate_file: card.mastered_candidate_file || '',
      duration_target_s: numeric(card.duration_target_s),
      duration_s: numeric(metrics.durationSec),
      duration_delta_s: numeric(metrics.durationDeltaSec),
      rms: numeric(metrics.rms),
      peak: numeric(metrics.peak),
      clipping_ratio: numeric(metrics.clippingRatio),
      dc_offset: numeric(metrics.dcOffset),
      zero_crossing_rate: numeric(metrics.zeroCrossingRate),
      automated_flag: card.automated_flag || '',
      decode_sha256: result.decodeSha256 || '',
      candidate_only: true,
      admission: 'NOT_RUNTIME_ADMITTED',
    };
    for (const field of HUMAN_FIELDS) row[field] = '';
    return row;
  });
  rows.sort((left, right) => {
    const bucket = (DISPOSITION_ORDER.get(left.review_bucket) ?? 9) - (DISPOSITION_ORDER.get(right.review_bucket) ?? 9);
    if (bucket) return bucket;
    const priority = priorityNumber(left.review_priority) - priorityNumber(right.review_priority);
    if (priority) return priority;
    return left.candidate_id.localeCompare(right.candidate_id);
  });
  rows.forEach((row, index) => { row.review_order = index + 1; });
  const counts = rows.reduce((acc, row) => {
    acc.total += 1;
    acc[row.review_bucket] = (acc[row.review_bucket] || 0) + 1;
    return acc;
  }, { total: 0 });
  return { schemaVersion: '1.0.0', candidateOnly: true, admission: 'NOT_RUNTIME_ADMITTED', counts, rows, humanFields: HUMAN_FIELDS };
}

function parseArgs(argv) {
  const values = { triage: DEFAULT_TRIAGE, scorecard: DEFAULT_SCORECARD, json: DEFAULT_JSON, csv: DEFAULT_CSV };
  const names = { '--triage': 'triage', '--scorecard': 'scorecard', '--out-json': 'json', '--out-csv': 'csv' };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!(key in names) || !argv[index + 1] || argv[index + 1].startsWith('--')) throw new Error(`unknown or incomplete option: ${key}`);
    values[names[key]] = argv[index + 1];
    index += 1;
  }
  return values;
}

async function writeAtomic(filePath, content) {
  const resolved = path.resolve(ROOT, filePath.replaceAll('\\', '/'));
  if (resolved !== ROOT && !resolved.startsWith(`${ROOT}${path.sep}`)) throw new Error(`output escapes project root: ${filePath}`);
  await mkdir(path.dirname(resolved), { recursive: true });
  const temp = `${resolved}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temp, content, 'utf8');
  await rename(temp, resolved);
  return resolved;
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const args = parseArgs(argv);
  const triage = JSON.parse(await readFile(path.resolve(ROOT, args.triage), 'utf8'));
  const scorecard = parseScorecardCsv(await readFile(path.resolve(ROOT, args.scorecard), 'utf8'));
  const queue = buildPriorityQueue(triage, scorecard);
  await writeAtomic(args.json, JSON.stringify({ ...queue, generatedAt: new Date().toISOString(), source: { triage: args.triage, scorecard: args.scorecard } }, null, 2) + '\n');
  const fields = ['review_order', 'review_bucket', 'review_priority', 'review_reason', 'candidate_id', 'wave', 'family', 'kind', 'decode', 'raw_candidate_file', 'mastered_candidate_file', 'duration_target_s', 'duration_s', 'duration_delta_s', 'rms', 'peak', 'clipping_ratio', 'dc_offset', 'zero_crossing_rate', 'automated_flag', 'decode_sha256', 'candidate_only', 'admission', ...HUMAN_FIELDS];
  const csv = [fields.map(csvCell).join(','), ...queue.rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\n') + '\n';
  await writeAtomic(args.csv, csv);
  log(JSON.stringify({ json: args.json, csv: args.csv, counts: queue.counts, humanFields: HUMAN_FIELDS }));
  return queue;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`ElevenLabs priority queue failed: ${error.message}`); process.exitCode = 1; });
}
