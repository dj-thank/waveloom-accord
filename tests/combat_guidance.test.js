import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCombatGuidance } from '../client/combat_guidance.js';

const base = {
  state: 'ACTIVE', alive: true, hp: 250, maxHp: 250,
  role: 'damage', owner: 'none', contested: false,
  countAlly: 0, countEnemy: 0, aliveAllies: 5, aliveEnemies: 5,
  ultGauge: 0, abilities: {},
};

test('準備中の篝手には前線の入口と味方を待つ責務を示す', () => {
  const guidance = buildCombatGuidance({ ...base, state: 'SETUP', role: 'frontline' });
  assert.equal(guidance.phase, '結い直し');
  assert.match(guidance.rolePurpose, /空間/);
  assert.match(guidance.instruction, /入口|前線/);
  assert.ok(guidance.checklist.some(item => /味方/.test(item)));
});

test('人数不利の焔手には撃ち合い継続ではなく退き火を示す', () => {
  const guidance = buildCombatGuidance({ ...base, aliveAllies: 3, aliveEnemies: 5 });
  assert.equal(guidance.phase, '退き火');
  assert.equal(guidance.urgency, 'danger');
  assert.match(guidance.instruction, /合流|遮蔽/);
});

test('低体力の灯手には生存と遮蔽を最優先で示す', () => {
  const guidance = buildCombatGuidance({ ...base, role: 'support', hp: 42, maxHp: 225 });
  assert.equal(guidance.phase, '退き火');
  assert.match(guidance.instruction, /生存|遮蔽/);
  assert.match(guidance.rolePurpose, /テンポ|味方/);
});

test('拮抗中はロール別の目標行動と準備済み必殺技を示す', () => {
  const guidance = buildCombatGuidance({
    ...base, role: 'frontline', contested: true, countAlly: 2, countEnemy: 2, ultGauge: 100,
  });
  assert.equal(guidance.phase, '帳簿交換');
  assert.match(guidance.instruction, /目標|射線|注意/);
  assert.ok(guidance.checklist.some(item => /必殺技/.test(item)));
});
