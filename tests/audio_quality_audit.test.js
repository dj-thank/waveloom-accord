import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { makeWav, parseWavBuffer, auditProject } from '../tools/audio_quality_audit.js';

test('rejects malformed and silent WAVs before audit', () => {
  assert.throws(() => parseWavBuffer(Buffer.from('not-a-wave')), /RIFF|WAV/);
  const silent = makeWav(new Int16Array(4410));
  assert.throws(() => parseWavBuffer(silent, { rejectSilent: true }), /silent/i);
  const tampered = Buffer.from(silent); tampered.write('NOPE', 0, 'ascii');
  assert.throws(() => parseWavBuffer(tampered), /RIFF/);
  const badRate = makeWav(new Int16Array([100, -100]), 48000);
  assert.throws(() => parseWavBuffer(badRate), /44100|format/i);
  const badLength = makeWav(new Int16Array([100])); badLength.writeUInt32LE(1, 4);
  assert.throws(() => parseWavBuffer(badLength), /length/i);
});

test('audit covers manifest-linked files deterministically', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const result = await auditProject(root, { writeOutput: false });
  assert.equal(result.aggregate.manifestAssets, 90);
  assert.equal(result.aggregate.sourceFiles, 90);
  assert.equal(result.aggregate.runtimeFiles, 90);
  assert.equal(result.aggregate.structuralFailures, 0);
  assert.equal(result.assets.length, 90);
});

test('audit fails closed when manifest-linked runtime bytes are tampered', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'kagariai-audio-audit-'));
  try {
    const manifestDir = path.join(root, 'assets-src', 'local-audio');
    await mkdir(manifestDir, { recursive: true });
    const assets = [];
    for (let index = 0; index < 90; index++) {
      const id = `fixture_${index}`;
      const relativeSource = `assets-src/local-audio/raw/${id}.wav`;
      const relativeRuntime = `client/assets/generated/audio/${id}.wav`;
      const wav = makeWav(new Int16Array([index + 1, -(index + 1)]));
      await mkdir(path.dirname(path.join(root, relativeSource)), { recursive: true });
      await mkdir(path.dirname(path.join(root, relativeRuntime)), { recursive: true });
      await Promise.all([writeFile(path.join(root, relativeSource), wav), writeFile(path.join(root, relativeRuntime), wav)]);
      assets.push({ kind: index < 18 ? 'weapon' : 'ability', id, sourcePath: relativeSource, runtimePath: relativeRuntime, sha256: createHash('sha256').update(wav).digest('hex'), bytes: wav.length, durationSec: 2 / 44_100 });
    }
    await writeFile(path.join(manifestDir, 'manifest.json'), JSON.stringify({ assets }));
    const tampered = makeWav(new Int16Array([32_000, -32_000]));
    await writeFile(path.join(root, assets[0].runtimePath), tampered);
    const result = await auditProject(root, { writeOutput: false });
    assert.equal(result.aggregate.structuralFailures, 1);
    assert.match(result.aggregate.structuralFailureDetails[0], /runtime sha256 mismatch|source\/runtime bytes differ/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
