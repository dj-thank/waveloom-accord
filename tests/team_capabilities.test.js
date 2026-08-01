import test from 'node:test';
import assert from 'node:assert/strict';
import { HERO_BY_ID } from '../shared/data/heroes.js';
import {
  TEAM_CAPABILITY_BUDGET,
  heroCanAnchorPressure,
  heroCanRecoverAllies,
  selectPressureAnchor,
  selectRecoveryProvider,
  summarizeTeamCapabilities,
  validateTeamCapabilities,
} from '../shared/rules/team_capabilities.js';

function player(id, heroId, pos, values = {}) {
  const hero = HERO_BY_ID[heroId];
  return {
    id,
    heroId,
    role: hero.role,
    alive: true,
    hp: hero.maxHp,
    maxHp: hero.maxHp,
    pos,
    ...values,
  };
}

test('runtime team capability budget is an immutable public contract', () => {
  assert.deepEqual(TEAM_CAPABILITY_BUDGET, { space: 1, recovery: 1 });
  assert.equal(Object.isFrozen(TEAM_CAPABILITY_BUDGET), true);
});

test('a no-frontline team passes when its heroes provide space and recovery', () => {
  const heroes = ['botan', 'asagi', 'shirasagi', 'karakasa', 'shirabe']
    .map(heroId => HERO_BY_ID[heroId]);

  assert.deepEqual(validateTeamCapabilities(heroes), {
    ok: true,
    missingCapabilities: [],
    summary: { space: 1, recovery: 1 },
  });
});

test('removing Botan reports space as the precise missing capability', () => {
  const heroes = ['asagi', 'shirasagi', 'karakasa', 'shirabe']
    .map(heroId => HERO_BY_ID[heroId]);

  assert.deepEqual(validateTeamCapabilities(heroes), {
    ok: false,
    missingCapabilities: ['space'],
    summary: { space: 0, recovery: 1 },
  });
});

test('removing every recovery provider reports recovery as the precise missing capability', () => {
  const heroes = ['botan', 'shirasagi', 'karakasa', 'shirabe']
    .map(heroId => HERO_BY_ID[heroId]);

  assert.deepEqual(validateTeamCapabilities(heroes), {
    ok: false,
    missingCapabilities: ['recovery'],
    summary: { space: 1, recovery: 0 },
  });
});

test('static space summary rejects mitigation-only and role-only heroes', () => {
  assert.deepEqual(summarizeTeamCapabilities([HERO_BY_ID.karakasa]), {
    space: 0,
    recovery: 0,
  });
  assert.deepEqual(summarizeTeamCapabilities([{
    role: 'frontline',
    teamFunctions: [],
  }]), {
    space: 0,
    recovery: 0,
  });
});

test('dynamic selectors retain frontline and mitigation pressure fallbacks', () => {
  assert.equal(heroCanAnchorPressure(HERO_BY_ID.zairu), true);
  assert.equal(heroCanAnchorPressure(HERO_BY_ID.botan), true);
  assert.equal(heroCanAnchorPressure(HERO_BY_ID.karakasa), true);
  assert.equal(heroCanAnchorPressure(HERO_BY_ID.tsuzuri), false);

  assert.equal(heroCanRecoverAllies(HERO_BY_ID.tsuzuri), true);
  assert.equal(heroCanRecoverAllies(HERO_BY_ID.koyomi), true);
  assert.equal(heroCanRecoverAllies(HERO_BY_ID.karakasa), false);
});

test('a living space-making damage hero can become the pressure anchor when the frontline is down', () => {
  const frontline = player('tank', 'zairu', [9, 0, 0], { alive: false });
  const spaceDamage = player('damage', 'botan', [3, 0, 0]);
  const support = player('support', 'tsuzuri', [2, 0, 0]);

  assert.equal(
    selectPressureAnchor([frontline, spaceDamage, support], [0, 0, 0])?.id,
    'damage',
  );
});

test('frontline remains preferred while connected, but an overextended tank does not erase a closer valid anchor', () => {
  const frontline = player('tank', 'zairu', [9, 0, 0]);
  const spaceDamage = player('damage', 'botan', [3, 0, 0]);

  assert.equal(
    selectPressureAnchor([frontline, spaceDamage], [0, 0, 0], { frontlinePreferenceM: 6 })?.id,
    'damage',
  );
  frontline.pos = [6, 0, 0];
  assert.equal(
    selectPressureAnchor([frontline, spaceDamage], [0, 0, 0], { frontlinePreferenceM: 6 })?.id,
    'tank',
  );
});

test('recovery provider selection follows the current anchor and does not require support role', () => {
  const anchor = player('anchor', 'botan', [0, 0, 0]);
  const support = player('far-support', 'tsuzuri', [12, 0, 0]);
  const damageMedic = player('damage-medic', 'asagi', [3, 0, 0]);

  assert.equal(
    selectRecoveryProvider([anchor, support, damageMedic], anchor)?.id,
    'damage-medic',
  );
});

test('a connected continuous provider keeps recovery duty ahead of an equally close damage medic', () => {
  const anchor = player('anchor', 'zairu', [0, 0, 0]);
  const primaryProvider = player('primary-provider', 'tsuzuri', [4, 0, 0]);
  const damageMedic = player('damage-medic', 'asagi', [3, 0, 0]);

  assert.equal(
    selectRecoveryProvider([anchor, primaryProvider, damageMedic], anchor)?.id,
    'primary-provider',
  );
});

test('equal-distance capability duty is stable when mirrored players receive different physical ids', () => {
  const anchorFor = (botanId, tsubakuroId) => selectPressureAnchor([
    player(botanId, 'botan', [4, 0, 0]),
    player(tsubakuroId, 'tsubakuro', [-4, 0, 0]),
  ], [0, 0, 0])?.heroId;
  const providerFor = (asagiId, koyomiId) => {
    const anchor = player('anchor', 'zairu', [0, 0, 0]);
    return selectRecoveryProvider([
      anchor,
      player(asagiId, 'asagi', [0, 4, 0]),
      player(koyomiId, 'koyomi', [0, -4, 0]),
    ], anchor)?.heroId;
  };

  assert.equal(anchorFor('p9', 'p1'), anchorFor('p1', 'p9'));
  assert.equal(providerFor('p9', 'p1'), providerFor('p1', 'p9'));
});

test('duplicate-hero duty follows logical identity instead of physical id or insertion order', () => {
  const choose = (entries) => selectPressureAnchor(entries.map(({ id, name, x }) => (
    player(id, 'botan', [x, 0, 0], { name })
  )), [0, 0, 0])?.name;

  assert.equal(choose([
    { id: 'p9', name: 'bravo', x: 4 },
    { id: 'p1', name: 'alpha', x: -4 },
  ]), 'alpha');
  assert.equal(choose([
    { id: 'p1', name: 'bravo', x: -4 },
    { id: 'p9', name: 'alpha', x: 4 },
  ]), 'alpha');
});
