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

test('回復機能を持つ焔手にはロールを越えて味方回復と接続の責務を示す', () => {
  const guidance = buildCombatGuidance({
    ...base,
    role: 'damage',
    teamFunctions: ['pressure', 'sustain'],
  });
  assert.match(guidance.rolePurpose, /回復|維持/);
  assert.match(guidance.instruction, /味方/);
  assert.match(guidance.instruction, /回復|接続/);
});

test('空間機能を持つ焔手には入口・遮蔽・注意を作る責務を示す', () => {
  const guidance = buildCombatGuidance({
    ...base,
    role: 'damage',
    teamFunctions: ['pressure', 'space'],
    contested: true,
    countAlly: 2,
    countEnemy: 2,
  });
  assert.match(guidance.rolePurpose, /空間/);
  assert.match(guidance.instruction, /入口|遮蔽/);
  assert.match(guidance.instruction, /注意/);
});

test('拮抗中も回復機能を持つ焔手は味方との接続を優先する', () => {
  const guidance = buildCombatGuidance({
    ...base,
    role: 'damage',
    teamFunctions: ['pressure', 'sustain'],
    contested: true,
    countAlly: 2,
    countEnemy: 2,
  });
  assert.match(guidance.instruction, /味方/);
  assert.match(guidance.instruction, /回復|接続/);
});

test('準備中も回復機能を持つ焔手は回復対象との接続を準備する', () => {
  const guidance = buildCombatGuidance({
    ...base,
    state: 'SETUP',
    role: 'damage',
    teamFunctions: ['pressure', 'sustain'],
  });
  assert.match(guidance.instruction, /味方/);
  assert.match(guidance.instruction, /回復|接続/);
});

test('人数有利でも回復機能を持つ焔手は味方との接続を切らない', () => {
  const guidance = buildCombatGuidance({
    ...base,
    role: 'damage',
    teamFunctions: ['pressure', 'sustain'],
    aliveAllies: 5,
    aliveEnemies: 4,
  });
  assert.equal(guidance.phase, '追い焚き');
  assert.match(guidance.instruction, /味方/);
  assert.match(guidance.instruction, /回復|接続/);
});
