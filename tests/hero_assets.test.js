import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../shared/data/heroes.js';
import {
  HERO_ASSET_MANIFEST,
  HERO_ASSET_BY_ID,
  ACTION_ASSET_BY_ID,
  WEAPON_ASSET_BY_ID,
  getActionAsset,
  getHeroAsset,
  getWeaponAsset,
} from '../shared/data/hero_assets.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLOTS = Object.freeze(['secondary', 'ability1', 'ability2', 'ultimate']);

function runtimeFile(url) {
  assert.match(url, /^\/client\/assets\/generated\//);
  return path.join(ROOT, ...url.slice(1).split('/'));
}

async function assertRuntimeHash(asset, extension) {
  assert.match(asset.runtimeUrl, new RegExp(`\\.[a-f0-9]{12}\\.${extension}$`));
  assert.match(asset.sha256, /^[a-f0-9]{64}$/);
  const bytes = await readFile(runtimeFile(asset.runtimeUrl));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256, asset.runtimeUrl);
  assert.equal(bytes.length, asset.bytes, asset.runtimeUrl);
}

test('hero asset manifest is the authoritative 18-hero / 72-action visual SSOT', () => {
  assert.equal(HERO_ASSET_MANIFEST.schemaVersion, '1.0.0');
  assert.equal(HERO_ASSET_MANIFEST.authoritative, true);
  assert.equal(HERO_ASSET_MANIFEST.heroes.length, 18);
  assert.equal(HERO_ASSET_BY_ID.size, 18);
  assert.equal(ACTION_ASSET_BY_ID.size, 72);
  assert.equal(WEAPON_ASSET_BY_ID.size, 18);

  const actionIds = new Set();
  for (const hero of HEROES) {
    const assets = getHeroAsset(hero.id);
    assert.equal(assets, HERO_ASSET_BY_ID.get(hero.id));
    assert.equal(assets.heroId, hero.id);
    assert.equal(assets.weapon.id, hero.weapon.id);
    assert.equal(getWeaponAsset(hero.weapon.id), assets.weapon);
    assert.equal(assets.concept.visual.provider, 'openai-built-in-imagegen');
    assert.equal(assets.concept.visual.grid.rows, 2);
    assert.equal(assets.concept.visual.grid.cols, 2);
    assert.equal(assets.concept.visual.sourceFrames.length, 4);
    assert.ok(assets.concept.visual.prompt.length >= 80);

    assert.deepEqual(Object.keys(assets.abilities), SLOTS);
    for (const slot of SLOTS) {
      const definition = hero.abilities[slot];
      const action = assets.abilities[slot];
      assert.equal(action.id, definition.id);
      assert.equal(action.behavior, definition.behavior);
      assert.equal(action.slot, slot);
      assert.equal(getActionAsset(action.id), action);
      assert.equal(action.visual.provider, 'openai-built-in-imagegen');
      assert.equal(action.visual.grid.rows, 4);
      assert.equal(action.visual.grid.cols, 4);
      assert.equal(action.visual.sourceFrames.length, 16);
      assert.ok(action.visual.prompt.length >= 80);
      assert.equal(actionIds.has(action.id), false, action.id);
      actionIds.add(action.id);
    }
  }
  assert.equal(actionIds.size, 72);
});

test('project-authored local DSP audio SSOT is complete for all 18 weapons and 72 actions', () => {
  assert.equal(
    HERO_ASSET_MANIFEST.complete,
    true,
    `missing ${HERO_ASSET_MANIFEST.missingAudio.length} audio assets: ${HERO_ASSET_MANIFEST.missingAudio.join(', ')}`,
  );
  assert.deepEqual(HERO_ASSET_MANIFEST.missingAudio, []);
  for (const hero of HERO_ASSET_MANIFEST.heroes) {
    for (const audio of [hero.weapon.audio, ...SLOTS.map(slot => hero.abilities[slot].audio)]) {
      assert.equal(audio.provider, 'Kagariai Local DSP');
      assert.match(audio.generatorVersion, /^\d+\.\d+\.\d+$/);
      assert.equal(audio.generatorPath, 'tools/generate_local_audio_assets.js');
      assert.match(audio.generatorSha256, /^[a-f0-9]{64}$/);
      assert.equal(audio.contentType, 'audio/wav');
      assert.equal(audio.sampleRateHz, 44_100);
      assert.equal(audio.channels, 1);
      assert.equal(audio.bitDepth, 16);
      assert.match(audio.license, /no third-party samples or model weights/i);
      assert.ok(Number.isInteger(audio.seed));
      assert.ok(audio.profile.length > 0);
    }
  }
});

test('every SSOT runtime image and audio reference matches the admitted bytes', async () => {
  const runtimeUrls = new Set();
  for (const hero of HERO_ASSET_MANIFEST.heroes) {
    for (const visual of [hero.concept.visual, ...SLOTS.map(slot => hero.abilities[slot].visual)]) {
      await assertRuntimeHash(visual, 'webp');
      assert.ok(visual.transparentPixelFraction >= 0.2, visual.runtimeUrl);
      assert.ok(visual.opaquePixelFraction >= 0.01, visual.runtimeUrl);
      assert.equal(runtimeUrls.has(visual.runtimeUrl), false, visual.runtimeUrl);
      runtimeUrls.add(visual.runtimeUrl);
    }
    for (const audio of [hero.weapon.audio, ...SLOTS.map(slot => hero.abilities[slot].audio)].filter(Boolean)) {
      await assertRuntimeHash(audio, 'wav');
      assert.equal(runtimeUrls.has(audio.runtimeUrl), false, audio.runtimeUrl);
      runtimeUrls.add(audio.runtimeUrl);
    }
  }
  assert.equal(runtimeUrls.size, 180 - HERO_ASSET_MANIFEST.missingAudio.length);
});

test('unknown content IDs fail closed instead of borrowing another hero asset', () => {
  assert.equal(getHeroAsset('not-a-hero'), null);
  assert.equal(getActionAsset('not-an-action'), null);
  assert.equal(getWeaponAsset('not-a-weapon'), null);
});
