#!/usr/bin/env node
/** Generates a spreadsheet-ready, candidate-only human listening review queue. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WAVES = [
  { wave: 'legacy-sfx-090', manifest: 'assets-src/elevenlabs/manifest.json', root: '.', master: () => '' },
  { wave: 'smoke-003', manifest: 'outputs/audio-factory-20260729/manifests/smoke-3.json', root: 'outputs/audio-factory-20260729', master: () => '' },
  { wave: 'aaa-wave-001', manifest: 'outputs/audio-factory-20260729/manifests/aaa-wave-001.json', root: 'outputs/audio-factory-20260729/aaa-wave-001', master: asset => asset.kind === 'music' ? `outputs/audio-factory-20260729/aaa-wave-001/mastered/music/${path.basename(asset.output)}` : `outputs/audio-factory-20260729/aaa-wave-001/mastered-voices/voices/${path.basename(asset.output)}` },
  { wave: 'aaa-pilot-002', manifest: 'outputs/audio-factory-20260730/manifests/aaa-pilot-002.json', root: 'outputs/audio-factory-20260730/aaa-pilot-002', master: asset => `outputs/audio-factory-20260730/aaa-pilot-002/mastered/sfx/${path.basename(asset.output)}` },
  { wave: 'aaa-pilot-002-remediation-001', manifest: 'outputs/audio-factory-20260730/manifests/aaa-pilot-002-remediation-001.json', root: 'outputs/audio-factory-20260730/aaa-pilot-002-remediation-001', master: asset => `outputs/audio-factory-20260730/aaa-pilot-002-remediation-001/mastered/sfx/${path.basename(asset.output)}` },
  { wave: 'aaa-batch-001', manifest: 'outputs/audio-factory-20260730/manifests/aaa-batch-001.json', root: 'outputs/audio-factory-20260730/aaa-batch-001', master: asset => `outputs/audio-factory-20260730/aaa-batch-001/mastered/sfx/${path.basename(asset.output)}` },
  { wave: 'aaa-wave-002', manifest: 'outputs/audio-factory-20260801/manifests/aaa-wave-002.json', root: 'outputs/audio-factory-20260801/aaa-wave-002', master: asset => `outputs/audio-factory-20260801/aaa-wave-002/mastered/sfx/${path.basename(asset.output)}` },
];

export const csvCell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
const priority = asset => ['weapon', 'ability', 'ui', 'objective', 'music', 'text_to_speech'].includes(asset.family || asset.kind) ? 'P1' : 'P2';
const assetPath = (definition, asset) => asset.sourcePath || path.posix.join(definition.root.replaceAll('\\', '/'), asset.output || '');
const flag = asset => asset.id === 'aaa.pilot002.sfx.ambient-market-canopy.v001' ? 'UNDER_AUDIBLE_REFERENCE; compare v002 before adoption' : asset.replacesCandidate ? `COMPARE_WITH:${asset.replacesCandidate}` : '';

export async function buildRows(root) {
  const rows = [];
  for (const definition of WAVES) {
    const manifest = JSON.parse(await readFile(path.join(root, definition.manifest), 'utf8'));
    for (const asset of manifest.assets || []) {
      rows.push({
        candidate_id: asset.id,
        wave: definition.wave,
        family: asset.family || asset.kind || '',
        kind: asset.kind || '',
        raw_candidate_file: assetPath(definition, asset),
        mastered_candidate_file: definition.master(asset),
        duration_target_s: asset.request?.duration_seconds || (asset.request?.music_length_ms ? asset.request.music_length_ms / 1000 : asset.requestedDurationSec || ''),
        loop: asset.request?.loop ?? '',
        provider_character_cost: asset.characterCost || '',
        technical_status: 'PASS (candidate-only)',
        automated_flag: flag(asset),
        review_priority: priority(asset),
        rights_review: 'pending',
        creative_fit: 'pending',
        competitive_readability: 'pending',
        in_engine_mix: 'pending',
        adoption: 'candidate-only',
        reviewer: '',
        notes: '',
      });
    }
  }
  return rows;
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  if (argv.length && !(argv.length === 2 && argv[0] === '--out')) throw new Error('Usage: node tools/build_elevenlabs_human_review_scorecard.js [--out FILE]');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = path.resolve(root, argv[1] || 'outputs/audio-factory-20260730/HUMAN_LISTENING_SCORECARD.csv');
  const rows = await buildRows(root);
  const fields = ['candidate_id', 'wave', 'family', 'kind', 'raw_candidate_file', 'mastered_candidate_file', 'duration_target_s', 'loop', 'provider_character_cost', 'technical_status', 'automated_flag', 'review_priority', 'rights_review', 'creative_fit', 'competitive_readability', 'in_engine_mix', 'adoption', 'reviewer', 'notes'];
  const csv = [fields.map(csvCell).join(','), ...rows.map(row => fields.map(field => csvCell(row[field])).join(','))].join('\n') + '\n';
  await mkdir(path.dirname(out), { recursive: true });
  const temp = `${out}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temp, csv, 'utf8');
  await rename(temp, out);
  log(JSON.stringify({ output: path.relative(root, out).replaceAll('\\', '/'), rows: rows.length, p1: rows.filter(row => row.review_priority === 'P1').length, flagged: rows.filter(row => row.automated_flag).length }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`Human review scorecard failed: ${error.message}`); process.exitCode = 1; });
}
