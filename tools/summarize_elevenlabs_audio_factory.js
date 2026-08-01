#!/usr/bin/env node
/** Produces a secret-free durable ledger for all currently generated candidates. */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WAVES = [
  { id: 'legacy-sfx-090', manifest: 'assets-src/elevenlabs/manifest.json', audit: 'outputs/elevenlabs-candidate-audit-20260730-refresh.json', mastering: [] },
  { id: 'smoke-003', manifest: 'outputs/audio-factory-20260729/manifests/smoke-3.json', audit: 'outputs/audio-factory-20260729/smoke-technical-audit-20260730.json', mastering: [] },
  { id: 'aaa-wave-001', manifest: 'outputs/audio-factory-20260729/manifests/aaa-wave-001.json', audit: 'outputs/audio-factory-20260729/aaa-wave-001/technical-audit-20260730-refresh.json', mastering: ['outputs/audio-factory-20260729/aaa-wave-001/mastered/master-manifest.json', 'outputs/audio-factory-20260729/aaa-wave-001/mastered-voices/master-manifest.json'] },
  { id: 'aaa-pilot-002', manifest: 'outputs/audio-factory-20260730/manifests/aaa-pilot-002.json', audit: 'outputs/audio-factory-20260730/aaa-pilot-002/technical-audit-20260730.json', mastering: ['outputs/audio-factory-20260730/aaa-pilot-002/mastered/master-manifest.json'] },
  { id: 'aaa-pilot-002-remediation-001', manifest: 'outputs/audio-factory-20260730/manifests/aaa-pilot-002-remediation-001.json', audit: 'outputs/audio-factory-20260730/aaa-pilot-002-remediation-001/technical-audit-20260730.json', mastering: ['outputs/audio-factory-20260730/aaa-pilot-002-remediation-001/mastered/master-manifest.json'] },
  { id: 'aaa-batch-001', manifest: 'outputs/audio-factory-20260730/manifests/aaa-batch-001.json', audit: 'outputs/audio-factory-20260730/aaa-batch-001/technical-audit-20260730.json', mastering: ['outputs/audio-factory-20260730/aaa-batch-001/mastered/master-manifest.json'] },
  { id: 'aaa-wave-002', manifest: 'outputs/audio-factory-20260801/manifests/aaa-wave-002.json', audit: 'outputs/audio-factory-20260801/aaa-wave-002/technical-audit.json', mastering: ['outputs/audio-factory-20260801/aaa-wave-002/mastered/master-manifest.json'] },
];

const relative = (root, value) => path.relative(root, value).replaceAll('\\', '/');
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));

export function waveSummary(id, manifest, audit, mastering = []) {
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  const generated = assets.filter(asset => asset.sha256 || asset.sourcePath).length;
  const providerCharacterCost = assets.reduce((sum, asset) => sum + (Number.isFinite(asset.characterCost) ? asset.characterCost : 0), 0);
  return {
    id,
    assets: assets.length,
    generated,
    providerCharacterCost,
    technical: audit?.summary
      ? { passed: audit.summary.assets - audit.summary.hashFailures - audit.summary.technicalFailures, failed: audit.summary.hashFailures + audit.summary.technicalFailures }
      : { passed: audit?.passed ?? null, failed: audit?.failed ?? null },
    mastering: mastering.length ? { passed: mastering.reduce((sum, report) => sum + report.mastered, 0), failed: mastering.reduce((sum, report) => sum + report.failed, 0) } : null,
  };
}

export async function buildSummary(projectRoot = process.cwd()) {
  const root = path.resolve(projectRoot);
  const waves = [];
  for (const definition of WAVES) {
    const [manifest, audit, mastering] = await Promise.all([
      readJson(path.join(root, definition.manifest)),
      readJson(path.join(root, definition.audit)),
      Promise.all(definition.mastering.map(report => readJson(path.join(root, report)))),
    ]);
    waves.push({ ...waveSummary(definition.id, manifest, audit, mastering), manifest: definition.manifest, audit: definition.audit, masteringReports: definition.mastering });
  }
  const before = await readJson(path.join(root, 'outputs/audio-factory-20260730/elevenlabs-preflight.json'));
  const postWave = path.join(root, 'outputs/audio-factory-20260801/elevenlabs-preflight-post-wave002.json');
  const after = await readJson(postWave).catch(() => readJson(path.join(root, 'outputs/audio-factory-20260730/elevenlabs-preflight-post-batch001.json')));
  const candidates = waves.reduce((sum, wave) => sum + wave.assets, 0);
  const technicalPassed = waves.reduce((sum, wave) => sum + (wave.technical.passed || 0), 0);
  const technicalFailed = waves.reduce((sum, wave) => sum + (wave.technical.failed || 0), 0);
  const mastered = waves.reduce((sum, wave) => sum + (wave.mastering?.passed || 0), 0);
  const masteringFailed = waves.reduce((sum, wave) => sum + (wave.mastering?.failed || 0), 0);
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    admission: 'candidate-only; no item is admitted to the Local DSP runtime, distribution catalog, or a rights/creative/in-engine approval state by this summary',
    totals: { candidates, technicalPassed, technicalFailed, mastered, masteringFailed },
    currentTurnProviderUsage: {
      creditsUsedBefore: before.subscription.creditsUsed,
      creditsUsedAfter: after.subscription.creditsUsed,
      creditsDelta: after.subscription.creditsUsed - before.subscription.creditsUsed,
      creditsRemainingAfter: after.subscription.creditsRemaining,
      overageEnabled: after.subscription.overageEnabled,
    },
    observedRuntimeContract: {
      soundGenerationPromptMaxCharacters: 450,
      rejectedFirstRemediationAttempt: 'HTTP 400 text_too_long; no audio file was written; v002 was shortened to 415 characters before the successful retry',
      modelListingBoundary: 'Music and sound-effect access is not inferred from /v1/models; each is evidenced by its own successful candidate response metadata.',
    },
    waves,
  };
}

export async function main(argv = process.argv.slice(2), log = console.log) {
  const index = argv.indexOf('--out');
  if (argv.includes('--help') || argv.includes('-h')) { log('Usage: node tools/summarize_elevenlabs_audio_factory.js [--out FILE]'); return 0; }
  if (index >= 0 && (!argv[index + 1] || argv.length !== 2)) throw new Error('--out requires exactly one value');
  if (index < 0 && argv.length) throw new Error(`unknown argument: ${argv[0]}`);
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const output = path.resolve(root, index >= 0 ? argv[index + 1] : 'outputs/audio-factory-20260801/execution-summary-wave002.json');
  const summary = await buildSummary(root);
  await mkdir(path.dirname(output), { recursive: true });
  const temp = `${output}.${process.pid}.${Date.now()}.partial`;
  await writeFile(temp, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await rename(temp, output);
  log(JSON.stringify({ output: relative(root, output), totals: summary.totals, creditsDelta: summary.currentTurnProviderUsage.creditsDelta, creditsRemainingAfter: summary.currentTurnProviderUsage.creditsRemainingAfter }));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  main().catch(error => { console.error(`ElevenLabs summary failed: ${error.message}`); process.exitCode = 1; });
}
