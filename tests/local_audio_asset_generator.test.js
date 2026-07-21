import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { HEROES } from '../shared/data/heroes.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GENERATOR = path.join(ROOT, 'tools', 'generate_local_audio_assets.js');
const SLOTS = Object.freeze(['secondary', 'ability1', 'ability2', 'ultimate']);

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function runGenerator(outputRoot, ...args) {
  return spawnSync(process.execPath, [GENERATOR, '--root', outputRoot, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
  });
}

function inspectMonoPcm16Wav(bytes) {
  assert.equal(bytes.subarray(0, 4).toString('ascii'), 'RIFF');
  assert.equal(bytes.readUInt32LE(4), bytes.length - 8);
  assert.equal(bytes.subarray(8, 12).toString('ascii'), 'WAVE');
  assert.equal(bytes.subarray(12, 16).toString('ascii'), 'fmt ');
  assert.equal(bytes.readUInt32LE(16), 16);
  assert.equal(bytes.readUInt16LE(20), 1);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readUInt32LE(24), 44_100);
  assert.equal(bytes.readUInt32LE(28), 88_200);
  assert.equal(bytes.readUInt16LE(32), 2);
  assert.equal(bytes.readUInt16LE(34), 16);
  assert.equal(bytes.subarray(36, 40).toString('ascii'), 'data');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  assert.equal((bytes.length - 44) % 2, 0);

  const sampleCount = (bytes.length - 44) / 2;
  let peak = 0;
  let earlyPeak = 0;
  let squared = 0;
  let tailSquared = 0;
  let zeros = 0;
  let firstNonZero = -1;
  const earlySamples = Math.min(sampleCount, Math.round(0.12 * 44_100));
  const tailSamples = Math.min(sampleCount, Math.round(0.05 * 44_100));
  for (let index = 0; index < sampleCount; index += 1) {
    const value = bytes.readInt16LE(44 + index * 2);
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    if (index < earlySamples) earlyPeak = Math.max(earlyPeak, absolute);
    squared += value * value;
    if (index >= sampleCount - tailSamples) tailSquared += value * value;
    if (value === 0) zeros += 1;
    else if (firstNonZero < 0) firstNonZero = index;
  }
  return {
    sampleCount,
    durationSec: sampleCount / 44_100,
    peak: peak / 32_767,
    earlyPeak: earlyPeak / 32_767,
    rms: Math.sqrt(squared / sampleCount) / 32_767,
    tailRms: Math.sqrt(tailSquared / tailSamples) / 32_767,
    zeroFraction: zeros / sampleCount,
    firstNonZero,
    lastSample: bytes.readInt16LE(bytes.length - 2),
  };
}

async function manifestHashes(outputRoot, manifest) {
  const hashes = [];
  for (const asset of manifest.assets) {
    const bytes = await readFile(path.join(outputRoot, ...asset.sourcePath.split('/')));
    hashes.push([`${asset.kind}:${asset.id}`, asset.sha256, digest(bytes)]);
  }
  return hashes;
}

test('local DSP CLI check validates the canonical 18 weapon / 72 ability catalog without writing files', async () => {
  const outputRoot = path.join(ROOT, 'work', `local-audio-check-${process.pid}`);
  const result = spawnSync(process.execPath, [GENERATOR, '--check', '--root', outputRoot], {
    cwd: ROOT,
    encoding: 'utf8',
    windowsHide: true,
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    mode: 'check',
    assets: 90,
    weapons: 18,
    abilities: 72,
    sampleRateHz: 44_100,
    channels: 1,
    bitDepth: 16,
    provider: 'Kagariai Local DSP',
    generatorVersion: '1.0.0',
  });
  await assert.rejects(access(outputRoot), error => error?.code === 'ENOENT');
});

test('local DSP CLI generates one authoritative WAV record for every canonical weapon and ability', async t => {
  await mkdir(path.join(ROOT, 'work'), { recursive: true });
  const outputRoot = await mkdtemp(path.join(ROOT, 'work', 'local-audio-generate-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));

  const result = runGenerator(outputRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    mode: 'generate',
    assets: 90,
    weapons: 18,
    abilities: 72,
    sampleRateHz: 44_100,
    channels: 1,
    bitDepth: 16,
    provider: 'Kagariai Local DSP',
    generatorVersion: '1.0.0',
    manifest: 'assets-src/local-audio/manifest.json',
  });

  const manifestPath = path.join(outputRoot, 'assets-src', 'local-audio', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const expectedGeneratorSha256 = digest(await readFile(GENERATOR));
  assert.deepEqual({ ...manifest, assets: undefined }, {
    schemaVersion: '1.0.0',
    authoritative: true,
    provider: 'Kagariai Local DSP',
    generatorVersion: '1.0.0',
    generatorPath: 'tools/generate_local_audio_assets.js',
    generatorSha256: expectedGeneratorSha256,
    sampleRateHz: 44_100,
    channels: 1,
    bitDepth: 16,
    contentType: 'audio/wav',
    license: 'Project-authored; no third-party samples or model weights',
    generatedFor: 'kagariai-1.0.0-rc.5',
    assets: undefined,
  });
  assert.match(manifest.generatorSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.assets.length, 90);

  const expected = new Map();
  for (const hero of HEROES) {
    expected.set(`weapon:${hero.weapon.id}`, {
      heroId: hero.id, kind: 'weapon', slot: null, behavior: hero.weapon.type,
    });
    for (const slot of SLOTS) {
      const action = hero.abilities[slot];
      expected.set(`ability:${action.id}`, {
        heroId: hero.id, kind: 'ability', slot, behavior: action.behavior,
      });
    }
  }
  assert.equal(expected.size, 90);

  const actualKeys = new Set();
  const hashes = new Set();
  const profiles = new Set();
  for (const asset of manifest.assets) {
    const key = `${asset.kind}:${asset.id}`;
    assert.equal(actualKeys.has(key), false, key);
    actualKeys.add(key);
    assert.deepEqual(
      { heroId: asset.heroId, kind: asset.kind, slot: asset.slot, behavior: asset.behavior },
      expected.get(key),
      key,
    );
    assert.ok(Number.isInteger(asset.seed) && asset.seed >= 0 && asset.seed <= 0xffff_ffff, key);
    assert.match(asset.profile, /^[a-z0-9_.:-]+$/i, key);
    assert.ok(asset.durationSec > 0, key);
    assert.equal(asset.contentType, 'audio/wav', key);
    assert.match(asset.generatedAt, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/, key);
    assert.equal(asset.sourcePath, `assets-src/local-audio/raw/${asset.kind}/${asset.id}.wav`);
    assert.match(
      asset.runtimePath,
      new RegExp(`^client/assets/generated/audio/${asset.kind === 'weapon' ? 'weapons' : 'abilities'}/${asset.id}\\.[a-f0-9]{12}\\.wav$`),
      key,
    );
    assert.equal(asset.runtimeUrl, `/${asset.runtimePath}`, key);
    assert.match(asset.sha256, /^[a-f0-9]{64}$/, key);

    const source = await readFile(path.join(outputRoot, ...asset.sourcePath.split('/')));
    const runtime = await readFile(path.join(outputRoot, ...asset.runtimePath.split('/')));
    assert.deepEqual(runtime, source, key);
    assert.equal(digest(source), asset.sha256, key);
    assert.equal(asset.runtimePath.includes(`.${asset.sha256.slice(0, 12)}.wav`), true, key);
    assert.equal(asset.bytes, source.length, key);

    const wav = inspectMonoPcm16Wav(source);
    assert.ok(Math.abs(wav.durationSec - asset.durationSec) <= 1 / 44_100, key);
    if (asset.slot === 'ultimate') assert.ok(wav.durationSec >= 1.70 && wav.durationSec <= 1.81, key);
    else assert.ok(wav.durationSec >= 0.85 && wav.durationSec <= 1.21, key);
    assert.ok(wav.peak >= 0.88 && wav.peak <= 0.92, `${key} peak=${wav.peak}`);
    assert.ok(wav.earlyPeak >= 0.28, `${key} earlyPeak=${wav.earlyPeak}`);
    assert.ok(wav.rms >= 0.025 && wav.rms <= 0.40, `${key} rms=${wav.rms}`);
    assert.ok(wav.tailRms <= wav.rms * 0.30, `${key} tail=${wav.tailRms} rms=${wav.rms}`);
    assert.ok(wav.zeroFraction < 0.10, `${key} zeros=${wav.zeroFraction}`);
    assert.ok(wav.firstNonZero >= 0 && wav.firstNonZero < 32, `${key} firstNonZero=${wav.firstNonZero}`);
    assert.ok(Math.abs(wav.lastSample) <= 1, `${key} lastSample=${wav.lastSample}`);
    assert.equal(hashes.has(asset.sha256), false, `${key} duplicate SHA-256`);
    hashes.add(asset.sha256);
    assert.equal(profiles.has(asset.profile), false, `${key} duplicate profile`);
    profiles.add(asset.profile);
  }
  assert.deepEqual(actualKeys, new Set(expected.keys()));
  assert.equal(hashes.size, 90);
  assert.equal(profiles.size, 90);
});

test('repeating local DSP generation preserves every WAV hash and the manifest bytes', async t => {
  await mkdir(path.join(ROOT, 'work'), { recursive: true });
  const outputRoot = await mkdtemp(path.join(ROOT, 'work', 'local-audio-repeat-'));
  t.after(() => rm(outputRoot, { recursive: true, force: true }));
  const manifestPath = path.join(outputRoot, 'assets-src', 'local-audio', 'manifest.json');

  const first = runGenerator(outputRoot);
  assert.equal(first.status, 0, first.stderr);
  const firstManifestBytes = await readFile(manifestPath);
  const firstManifest = JSON.parse(firstManifestBytes);
  const firstHashes = await manifestHashes(outputRoot, firstManifest);

  const second = runGenerator(outputRoot, '--force');
  assert.equal(second.status, 0, second.stderr);
  const secondManifestBytes = await readFile(manifestPath);
  const secondManifest = JSON.parse(secondManifestBytes);
  const secondHashes = await manifestHashes(outputRoot, secondManifest);

  assert.deepEqual(secondManifestBytes, firstManifestBytes);
  assert.deepEqual(secondHashes, firstHashes);
  assert.deepEqual(JSON.parse(second.stdout.trim()), JSON.parse(first.stdout.trim()));
});
