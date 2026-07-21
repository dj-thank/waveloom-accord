import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const ROOT = new URL('../client/assets/materials/polyhaven/', import.meta.url);
const REPOSITORY_ROOT = new URL('../', import.meta.url);
const EXPECTED = Object.freeze({
  'concrete_floor_01/concrete_floor_01_diff_1k.jpg': 'DB7C800F1464359B5F359FC743E82AC51B34E014FDFD53844F4AF34BB1949229',
  'concrete_floor_01/concrete_floor_01_nor_gl_1k.jpg': '28BE1F6FA82EEAB137C84954BF7EA0F5D8A4434352D01C29F15E20926EB7227E',
  'concrete_floor_01/concrete_floor_01_rough_1k.jpg': 'F5239E1C6DB5F0DDB4C2397E881A5938AB511386AAB19A23C20D40F4AB2C181B',
  'concrete/concrete_diff_1k.jpg': '046C0E2AEBE31E6043A6BC074E779F6A345F1D823D0CA1C69446C5CABADEFA8A',
  'concrete/concrete_nor_gl_1k.jpg': '298A0E93040C9D76D239A894BDF28A9787755EA5F22BAA068FFA8075369EE428',
  'concrete/concrete_rough_1k.jpg': '0DC74E17295160CF2FC214BF22A57FDDC68F261E2CBACEBB706F5B3FA5D07458',
});

test('bundled Poly Haven material bytes match the reviewed CC0 ledger', async () => {
  for (const [relativePath, expected] of Object.entries(EXPECTED)) {
    const bytes = await readFile(new URL(relativePath, ROOT));
    const actual = createHash('sha256').update(bytes).digest('hex').toUpperCase();
    assert.equal(actual, expected, relativePath);
  }
  const license = await readFile(new URL('LICENSE.txt', ROOT), 'utf8');
  assert.match(license, /Creative Commons Zero 1\.0 Universal/);
  assert.match(license, /https:\/\/polyhaven\.com\/license/);
  assert.match(license, /concrete_floor_01/);
});

test('all admitted audio is project-authored local DSP with reproducible provenance', async () => {
  const manifest = JSON.parse(await readFile(new URL('assets-src/local-audio/manifest.json', REPOSITORY_ROOT), 'utf8'));
  assert.equal(manifest.provider, 'Kagariai Local DSP');
  assert.equal(manifest.authoritative, true);
  assert.equal(manifest.sampleRateHz, 44_100);
  assert.equal(manifest.channels, 1);
  assert.equal(manifest.bitDepth, 16);
  assert.equal(manifest.contentType, 'audio/wav');
  assert.match(manifest.license, /no third-party samples or model weights/i);
  assert.equal(manifest.generatorPath, 'tools/generate_local_audio_assets.js');
  const generatorBytes = await readFile(new URL(manifest.generatorPath, REPOSITORY_ROOT));
  assert.equal(createHash('sha256').update(generatorBytes).digest('hex'), manifest.generatorSha256);
  assert.equal(manifest.assets.length, 90);

  const identities = new Set();
  const hashes = new Set();
  for (const asset of manifest.assets) {
    const identity = `${asset.kind}:${asset.id}`;
    assert.equal(identities.has(identity), false, identity);
    identities.add(identity);
    assert.equal(hashes.has(asset.sha256), false, `duplicate admitted audio bytes: ${identity}`);
    hashes.add(asset.sha256);

    const [source, runtime] = await Promise.all([
      readFile(new URL(asset.sourcePath, REPOSITORY_ROOT)),
      readFile(new URL(asset.runtimePath, REPOSITORY_ROOT)),
    ]);
    assert.deepEqual(source, runtime, identity);
    assert.equal(createHash('sha256').update(source).digest('hex'), asset.sha256, identity);
    assert.equal(source.subarray(0, 4).toString('ascii'), 'RIFF', identity);
    assert.equal(source.subarray(8, 12).toString('ascii'), 'WAVE', identity);
  }
});

test('third-party notices preserve admitted attribution and dependency licenses', async () => {
  const notice = await readFile(new URL('THIRD_PARTY_NOTICES.md', REPOSITORY_ROOT), 'utf8');
  assert.match(notice, /chicken gun fruzer mine/);
  assert.match(notice, /amogusstrikesback2/);
  assert.match(notice, /Creative Commons Attribution 4\.0 International/);
  assert.match(notice, /imported as GLB/);
  assert.match(notice, /three\.js authors/);
  assert.match(notice, /Einar Otto Stangvik/);
  assert.equal((notice.match(/Permission is hereby granted, free of charge/g) ?? []).length, 2);

  const [threeLicense, wsLicense] = await Promise.all([
    readFile(new URL('node_modules/three/LICENSE', REPOSITORY_ROOT), 'utf8'),
    readFile(new URL('node_modules/ws/LICENSE', REPOSITORY_ROOT), 'utf8'),
  ]);
  const normalizeLicense = text => text.replace(/\s+/g, ' ').trim();
  const normalizedNotice = normalizeLicense(notice);
  assert.equal(normalizedNotice.includes(normalizeLicense(threeLicense)), true, 'three.js MIT text drifted');
  assert.equal(normalizedNotice.includes(normalizeLicense(wsLicense)), true, 'ws MIT text drifted');

  const packageTool = await readFile(new URL('tools/package_rc5_candidate.py', REPOSITORY_ROOT), 'utf8');
  assert.match(packageTool, /"THIRD_PARTY_NOTICES\.md"/);
});
