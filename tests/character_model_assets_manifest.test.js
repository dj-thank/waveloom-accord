import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HEROES } from '../shared/data/heroes.js';
import {
  CHARACTER_MODEL_ASSETS,
  CHARACTER_MODEL_PIPELINE,
  getCharacterModelAsset,
  getRuntimeEligibleCharacterModelAsset,
  isCharacterModelQualityAccepted,
} from '../shared/data/character_model_assets.js';

test('character model manifest covers exactly the canonical heroes and cohorts', () => {
  assert.equal(CHARACTER_MODEL_ASSETS.heroes.length, 18);
  assert.deepEqual(CHARACTER_MODEL_ASSETS.heroes.map((x) => x.heroId), HEROES.map((x) => x.id));
  for (const item of CHARACTER_MODEL_ASSETS.heroes) assert.ok(['frontline', 'damage', 'support'].includes(item.cohort));
  assert.deepEqual(CHARACTER_MODEL_PIPELINE.rolloutOrder, ['shiomaneki', 'frontline', 'damage', 'support']);
});

test('only accepted entries are runtime eligible and unknown lookup fails closed', () => {
  assert.equal(CHARACTER_MODEL_ASSETS.heroes.filter((x) => x.status === 'candidate').length, 18);
  assert.equal(CHARACTER_MODEL_ASSETS.heroes.filter((x) => x.runtimeEligible).length, 0);
  assert.equal(CHARACTER_MODEL_ASSETS.heroes.filter((x) => x.runtime?.moduleUrl && x.runtime?.factoryExport).length, 18);
  for (const item of CHARACTER_MODEL_ASSETS.heroes) {
    assert.equal(item.status, 'candidate');
    assert.equal(item.quality.gates.runtimeContract, true);
    assert.equal(getRuntimeEligibleCharacterModelAsset(item.heroId), null);
  }
  assert.equal(getCharacterModelAsset('unknown'), null);
  assert.equal(getRuntimeEligibleCharacterModelAsset('unknown'), null);
  assert.equal(isCharacterModelQualityAccepted(getCharacterModelAsset('shiomaneki')), false);
});

test('candidate module, profile identity, portable references, and runtime contract are pinned', () => {
  const item = getCharacterModelAsset('shiomaneki');
  assert.equal(item.status, 'candidate');
  assert.equal(item.runtime.factoryExport, 'createShiomanekiPlayableHeroModel');
  assert.match(item.runtime.moduleUrl, /^\/client\//);
  assert.equal(item.quality.gates.strictSpec, true);
  assert.equal(item.quality.gates.material, true);
  assert.equal(item.quality.gates.silhouette, false);
  assert.equal(item.quality.gates.performance, false);
  for (const hero of CHARACTER_MODEL_ASSETS.heroes) {
    assert.match(hero.concept.sourceGreenPath, /^assets-src\//);
    assert.match(hero.concept.sourceAlphaPath, /^assets-src\//);
    assert.doesNotMatch(hero.concept.sourceGreenPath, /^[A-Za-z]:[\\/]/);
    assert.match(hero.profile.sourcePath, /^assets-src\/img2threejs\/heroes\/[a-z0-9-]+\.json$/);
    const bytes = readFileSync(new URL(`../${hero.profile.sourcePath}`, import.meta.url));
    assert.equal(hero.profile.bytes, bytes.byteLength);
    assert.equal(hero.profile.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(hero.contract.requiredSockets,
      ['weapon_primary', 'hand_off', 'back_accessory', 'vfx_origin']);
    assert.ok(hero.contract.requiredPivots.includes('leftShoulder'));
    assert.equal(hero.runtimeEligible, false);
  }
});
