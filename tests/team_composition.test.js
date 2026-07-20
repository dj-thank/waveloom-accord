import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ROLE_SLOTS,
  countRoles,
  planRoleChange,
  roleAvailability,
  validateRoleSelection,
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
