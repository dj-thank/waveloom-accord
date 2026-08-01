import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES, HERO_BY_ID } from '../shared/data/heroes.js';
import {
  ROLE_SLOTS,
  RUNTIME_COMPOSITION_POLICY,
  countRoles,
  planRoleChange,
  projectHeroSelection,
  projectRuntimeHeroSelection,
  roleAvailability,
  validateRuntimeComposition,
  validateRoleSelection,
  validateSustainComposition,
} from '../shared/rules/team_composition.js';

test('正典の5人編成は篝手1・焔手2・灯手2である', () => {
  assert.deepEqual(ROLE_SLOTS, { frontline: 1, damage: 2, support: 2 });
  assert.deepEqual(countRoles([
    { role: 'frontline' },
    { role: 'damage' }, { role: 'damage' },
    { role: 'support' }, { role: 'support' },
  ]), { frontline: 1, damage: 2, support: 2 });
});

test('別ロールへの変更は対象ロールのbotと枠を交換し、人間だけなら拒否する', () => {
  const team = [
    { id: 'human-front', role: 'frontline', isBot: false },
    { id: 'human-damage', role: 'damage', isBot: false },
    { id: 'bot-damage', role: 'damage', isBot: true },
    { id: 'human-support', role: 'support', isBot: false },
    { id: 'bot-support', role: 'support', isBot: true },
  ];
  assert.deepEqual(planRoleChange(team, 'human-front', 'damage'), {
    ok: true, role: 'damage', swapPlayerId: 'bot-damage', replacementRole: 'frontline',
  });
  assert.deepEqual(planRoleChange(team, 'human-front', 'support'), {
    ok: true, role: 'support', swapPlayerId: 'bot-support', replacementRole: 'frontline',
  });
  assert.deepEqual(planRoleChange(team, 'human-damage', 'frontline'), {
    ok: false, code: 'role_full', role: 'frontline',
  });
  assert.deepEqual(planRoleChange(team, 'human-front', 'frontline'), {
    ok: true, role: 'frontline', swapPlayerId: null, replacementRole: null,
  });
});

test('満員のロールだけを拒否し、現在の枠を再選択する場合は許可する', () => {
  const players = [
    { id: 'front', role: 'frontline' },
    { id: 'damage-1', role: 'damage' },
    { id: 'damage-2', role: 'damage' },
    { id: 'support-1', role: 'support' },
  ];

  assert.deepEqual(validateRoleSelection(players, 'support', null), {
    ok: true,
    role: 'support',
    remaining: 1,
  });
  assert.deepEqual(validateRoleSelection(players, 'damage', null), {
    ok: false,
    code: 'role_full',
    role: 'damage',
    remaining: 0,
  });
  assert.equal(validateRoleSelection(players, 'frontline', 'front').ok, true);
  assert.deepEqual(roleAvailability(players), {
    frontline: { used: 1, limit: 1, remaining: 0 },
    damage: { used: 2, limit: 2, remaining: 0 },
    support: { used: 1, limit: 2, remaining: 1 },
  });
});

test('各チームは少なくとも1人のsustain supportを含む', () => {
  const sustain = { role: 'support', teamFunctions: ['sustain', 'continuous_sustain'] };
  const cooldownOnlySustain = { role: 'support', teamFunctions: ['sustain', 'tempo'] };
  const mitigation = { role: 'support', teamFunctions: ['mitigation'] };
  assert.equal(validateSustainComposition([
    { team: 0, ...sustain }, { team: 0, ...mitigation },
    { team: 1, ...sustain }, { team: 1, ...mitigation },
  ]).ok, true);
  assert.equal(validateSustainComposition([
    { team: 0, ...mitigation }, { team: 0, ...mitigation },
    { team: 1, ...sustain }, { team: 1, ...mitigation },
  ]).ok, false);
  assert.equal(validateSustainComposition([
    { team: 0, ...cooldownOnlySustain }, { team: 0, ...mitigation },
    { team: 1, ...sustain }, { team: 1, ...mitigation },
  ]).ok, false);
});

test('team function tags are immutable SSOT for every canonical hero', () => {
  assert.equal(HEROES.length, 18);
  assert.ok(HEROES.every(hero => Object.isFrozen(hero.teamFunctions)));
  assert.deepEqual(HERO_BY_ID.tsuzuri.teamFunctions, ['sustain', 'continuous_sustain']);
  assert.deepEqual(HERO_BY_ID.koyomi.teamFunctions, ['sustain', 'tempo']);
  assert.deepEqual(HERO_BY_ID.karakasa.teamFunctions, ['mitigation']);
  assert.deepEqual(HERO_BY_ID.shirabe.teamFunctions, ['amplification']);
  assert.deepEqual(HERO_BY_ID.hibari.teamFunctions, ['sustain', 'continuous_sustain', 'mobility']);
  assert.deepEqual(HERO_BY_ID.kazura.teamFunctions, ['sustain', 'mitigation']);
});

test('hero selection projection moves the previous hero to a swapped bot before sustain validation', () => {
  const roster = [
    { id: 'human', heroId: 'tsuzuri', role: 'support', teamFunctions: ['sustain', 'continuous_sustain'], isBot: false, team: 0 },
    { id: 'front-bot', heroId: 'zairu', role: 'frontline', teamFunctions: ['space'], isBot: true, team: 0 },
    { id: 'damage-a', heroId: 'asagi', role: 'damage', teamFunctions: ['pressure'], isBot: true, team: 0 },
    { id: 'damage-b', heroId: 'ibuki', role: 'damage', teamFunctions: ['pressure'], isBot: true, team: 0 },
    { id: 'support-b', heroId: 'karakasa', role: 'support', teamFunctions: ['mitigation'], isBot: true, team: 0 },
  ];
  const projected = projectHeroSelection(roster, 'human', HERO_BY_ID.baraga, 'front-bot');
  assert.equal(projected.find(player => player.id === 'front-bot').heroId, 'tsuzuri');
  assert.equal(validateSustainComposition(projected, [0]).ok, true);
});

test('exact hero projection rejects a swap that removes the only sustain support', () => {
  const roster = [
    { id: 'human', heroId: 'zairu', role: 'frontline', teamFunctions: ['space'], isBot: false, team: 0 },
    { id: 'damage-a', heroId: 'asagi', role: 'damage', teamFunctions: ['pressure'], isBot: true, team: 0 },
    { id: 'damage-b', heroId: 'ibuki', role: 'damage', teamFunctions: ['pressure'], isBot: true, team: 0 },
    { id: 'sustain-bot', heroId: 'tsuzuri', role: 'support', teamFunctions: ['sustain', 'continuous_sustain'], isBot: true, team: 0 },
    { id: 'utility-bot', heroId: 'shirabe', role: 'support', teamFunctions: ['amplification'], isBot: true, team: 0 },
  ];
  const projected = projectHeroSelection(roster, 'human', HERO_BY_ID.karakasa, 'sustain-bot');
  assert.equal(validateSustainComposition(projected, [0]).ok, false);
});

test('runtime composition shares the exact 1/2/2 SSOT with canonical bots', () => {
  const valid = ['zairu', 'asagi', 'shirasagi', 'tsuzuri', 'karakasa']
    .map((heroId, index) => ({ id: `runtime-${index}`, ...HERO_BY_ID[heroId], team: 0 }));
  const roleDrift = ['botan', 'asagi', 'shirasagi', 'tsuzuri', 'karakasa']
    .map((heroId, index) => ({ id: `drift-${index}`, ...HERO_BY_ID[heroId], team: 0 }));

  assert.deepEqual(RUNTIME_COMPOSITION_POLICY, {
    teamSize: 5,
    roleSlots: ROLE_SLOTS,
    requireContinuousSustain: true,
  });
  assert.equal(Object.isFrozen(RUNTIME_COMPOSITION_POLICY), true);

  const accepted = validateRuntimeComposition(valid);
  assert.equal(accepted.ok, true);
  assert.deepEqual(accepted.roleCounts, ROLE_SLOTS);
  assert.deepEqual(accepted.missingRoles, []);
  assert.equal(accepted.hasContinuousSustain, true);

  const rejected = validateRuntimeComposition(roleDrift);
  assert.equal(rejected.ok, false);
  assert.equal(rejected.code, 'role_slots_required');
  assert.deepEqual(rejected.roleCounts, { frontline: 0, damage: 3, support: 2 });
});

test('runtime composition requires the fixed policy team size', () => {
  const roster = ['botan', 'asagi', 'karakasa', 'shirabe']
    .map(heroId => ({
      id: `slot-${heroId}`,
      heroId,
      role: HERO_BY_ID[heroId].role,
      teamFunctions: HERO_BY_ID[heroId].teamFunctions,
    }));

  const result = validateRuntimeComposition(roster);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'team_size_mismatch');
  assert.equal(result.teamSize, 4);
  assert.equal(result.requiredTeamSize, 5);
});

test('runtime hero projection rejects role drift and loss of the last continuous healer without mutation', () => {
  const roster = ['zairu', 'asagi', 'shirasagi', 'tsuzuri', 'karakasa']
    .map(heroId => ({
      id: `slot-${heroId}`,
      heroId,
      role: HERO_BY_ID[heroId].role,
      teamFunctions: HERO_BY_ID[heroId].teamFunctions,
    }));
  const original = structuredClone(roster);

  const roleDrift = projectRuntimeHeroSelection(
    roster,
    'slot-zairu',
    HERO_BY_ID.botan,
  );
  assert.notStrictEqual(roleDrift, roster);
  assert.equal(roleDrift.length, 5);
  assert.equal(roleDrift.find(player => player.id === 'slot-zairu').heroId, 'botan');
  assert.equal(validateRuntimeComposition(roleDrift).code, 'role_slots_required');

  const withoutContinuousSustain = projectRuntimeHeroSelection(
    roster,
    'slot-tsuzuri',
    HERO_BY_ID.karakasa,
  );
  assert.notStrictEqual(withoutContinuousSustain, roster);
  assert.equal(withoutContinuousSustain.length, 5);
  assert.equal(withoutContinuousSustain.find(player => player.id === 'slot-tsuzuri').heroId, 'karakasa');
  assert.equal(validateRuntimeComposition(withoutContinuousSustain).code, 'sustain_support_required');

  assert.deepEqual(roster, original);
});
