// ヒーロー対応サーバーの信頼境界を、WebSocketから独立した純粋関数で検証する。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HERO_BY_ID, DEFAULT_HERO_ID } from '../shared/data/heroes.js';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { COMBAT, MODE } from './helpers.js';
import {
  ROLE_SLOTS, countRoles, validateRuntimeComposition, validateSustainComposition,
} from '../shared/rules/team_composition.js';
import {
  resolveHeroId, sanitizeInput, connectedTeamCounts, chooseJoinTeam, canSendSnapshot,
  canSelectHero, applyHeroSelectionTransaction, planRuntimeBotFill, planRuntimeHeroSelection,
  selectRuntimeClaimSlot,
} from '../server/runtime.js';

test('joinのheroIdは正典ロスターだけを許可し、不明値は既定heroへ戻す', () => {
  assert.equal(resolveHeroId('koyomi', HERO_BY_ID, DEFAULT_HERO_ID), 'koyomi');
  assert.equal(resolveHeroId('not-a-hero', HERO_BY_ID, DEFAULT_HERO_ID), DEFAULT_HERO_ID);
  assert.equal(resolveHeroId(null, HERO_BY_ID, DEFAULT_HERO_ID), DEFAULT_HERO_ID);
  assert.equal(resolveHeroId('toString', HERO_BY_ID, DEFAULT_HERO_ID), DEFAULT_HERO_ID);
});

test('input sanitizerは既知フィールドと能力4キーだけを安全な値として通す', () => {
  const result = sanitizeInput({
    f: true, b: false, l: false, r: true,
    jump: false, crouch: true, fire: false, reload: false,
    secondary: true, ability1: false, ability2: true, ultimate: false,
    yaw: Math.PI, pitch: -0.5, seq: 12, interpMs: 100,
    injected: 'discard me',
  }, 11);

  assert.deepEqual(result, {
    ok: true,
    input: {
      f: true, b: false, l: false, r: true,
      jump: false, crouch: true, fire: false, reload: false,
      secondary: true, ability1: false, ability2: true, ultimate: false,
      moveX: null, moveY: null,
      yaw: Math.PI, pitch: -0.5, seq: 12, interpMs: 100,
    },
  });
});

test('input sanitizerはoptional移動軸を[-1,1]で通し、未指定ならkeyboard互換にする', () => {
  const base = {
    yaw: 0, pitch: 0, seq: 2, interpMs: 100,
  };

  const analog = sanitizeInput({ ...base, moveX: 0.25, moveY: -1 }, 1);
  assert.equal(analog.ok, true);
  assert.equal(analog.input.moveX, 0.25);
  assert.equal(analog.input.moveY, -1);

  const keyboard = sanitizeInput(base, 1);
  assert.equal(keyboard.ok, true);
  assert.equal(keyboard.input.moveX, null);
  assert.equal(keyboard.input.moveY, null);

  for (const axes of [
    { moveX: Number.NaN },
    { moveX: 1.001 },
    { moveX: '0' },
    { moveY: Number.POSITIVE_INFINITY },
    { moveY: -1.001 },
  ]) {
    assert.deepEqual(sanitizeInput({ ...base, ...axes }, 1), { ok: false, code: 'invalid_input' });
  }
});

test('input sanitizerはshape・型・有限値・範囲違反を拒否する', () => {
  const valid = () => ({
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, fire: false, reload: false,
    secondary: false, ability1: false, ability2: false, ultimate: false,
    yaw: 0, pitch: 0, seq: 2, interpMs: 100,
  });
  const invalidPayloads = [
    null,
    [],
    { ...valid(), fire: 'false' },
    { ...valid(), yaw: Number.NaN },
    { ...valid(), yaw: Math.PI * 2 + 0.001 },
    { ...valid(), pitch: 1.551 },
    { ...valid(), seq: 0 },
    { ...valid(), seq: 2.5 },
    { ...valid(), interpMs: 221 },
    { ...valid(), interpMs: 301 },
    { ...valid(), interpMs: 99.5 },
  ];

  for (const payload of invalidPayloads) {
    assert.deepEqual(sanitizeInput(payload, 1), { ok: false, code: 'invalid_input' });
  }
});

test('input sanitizerは古いseqと重複seqを拒否する', () => {
  const payload = {
    yaw: 0, pitch: 0, seq: 7, interpMs: 100,
  };
  assert.deepEqual(sanitizeInput(payload, 7), { ok: false, code: 'stale_input' });
  assert.deepEqual(sanitizeInput({ ...payload, seq: 6 }, 7), { ok: false, code: 'stale_input' });
});

test('参加人数はWorld上のhuman印ではなくOPENなsocketだけを数える', () => {
  const players = new Map([
    ['p1', { id: 'p1', team: 0, isBot: false }],
    ['p2', { id: 'p2', team: 0, isBot: false }],
    ['p3', { id: 'p3', team: 1, isBot: true }],
  ]);
  const sockets = new Map([
    ['p1', { readyState: 1 }],
    ['p2', { readyState: 3 }],
    ['p3', { readyState: 1 }],
    ['missing', { readyState: 1 }],
  ]);

  assert.deepEqual(connectedTeamCounts(players, sockets), [1, 1]);
});

test('join先は各team 5人・全10人を超えず、実際に再利用可能な枠から選ぶ', () => {
  assert.equal(chooseJoinTeam([5, 5], [true, true], 5), -1);
  assert.equal(chooseJoinTeam([5, 4], [true, true], 5), 1);
  assert.equal(chooseJoinTeam([3, 2], [true, false], 5), 0);
  assert.equal(chooseJoinTeam([2, 2], [true, true], 5), 0);
  assert.equal(chooseJoinTeam([4, 4], [false, false], 5), -1);
});

test('snapshotはOPENかつ送信bufferが閾値以下のsocketだけへ送る', () => {
  assert.equal(canSendSnapshot({ readyState: 1, bufferedAmount: 0 }, 262144), true);
  assert.equal(canSendSnapshot({ readyState: 1, bufferedAmount: 262144 }, 262144), true);
  assert.equal(canSendSnapshot({ readyState: 1, bufferedAmount: 262145 }, 262144), false);
  assert.equal(canSendSnapshot({ readyState: 3, bufferedAmount: 0 }, 262144), false);
});

test('hero変更はSETUP中またはACTIVEのrespawn待機中だけ許可する', () => {
  assert.equal(canSelectHero('SETUP', true, false), true);
  assert.equal(canSelectHero('ACTIVE', false, true), true);
  assert.equal(canSelectHero('ACTIVE', false, false), false);
  assert.equal(canSelectHero('ACTIVE', true, true), false);
  assert.equal(canSelectHero('ROUND_END', false, true), false);
  assert.equal(canSelectHero('MATCH_END', false, true), false);
});

test('role swap applies the projected human and bot heroes atomically on the authoritative World', () => {
  const world = new World(buildMap(), MODE, COMBAT, 76);
  const human = world.addPlayer('human', false, 0, 'asagi');
  const frontlineBot = world.addPlayer('frontline bot', true, 0, 'zairu');
  world.addPlayer('damage bot', true, 0, 'shirasagi');
  world.addPlayer('sustain bot', true, 0, 'tsuzuri');
  world.addPlayer('utility bot', true, 0, 'karakasa');

  const result = applyHeroSelectionTransaction(world, human.id, 'baraga', frontlineBot.id);
  assert.deepEqual(result, { ok: true });
  assert.equal(human.heroId, 'baraga');
  assert.equal(frontlineBot.heroId, 'asagi');

  const roster = [...world.players.values()].map(player => ({
    id: player.id,
    team: player.team,
    heroId: player.heroId,
    role: HERO_BY_ID[player.heroId].role,
    teamFunctions: HERO_BY_ID[player.heroId].teamFunctions,
  }));
  assert.deepEqual(countRoles(roster), ROLE_SLOTS);
  assert.equal(validateSustainComposition(roster, [0]).ok, true);

  const beforeHuman = human.heroId;
  const beforeBot = frontlineBot.heroId;
  const selectHero = world.selectHero.bind(world);
  world.selectHero = (id, heroId) => id === human.id ? false : selectHero(id, heroId);
  const failed = applyHeroSelectionTransaction(world, human.id, 'zairu', frontlineBot.id);
  assert.deepEqual(failed, { ok: false, code: 'selection_locked' });
  assert.equal(human.heroId, beforeHuman);
  assert.equal(frontlineBot.heroId, beforeBot);
});

test('runtime cross-role selection projects a real bot swap and preserves 1/2/2', () => {
  const roster = ['zairu', 'asagi', 'shirasagi', 'tsuzuri', 'karakasa']
    .map((heroId, index) => ({
      id: `player-${index}`,
      heroId,
      team: 0,
      isBot: index !== 0,
    }));

  const result = planRuntimeHeroSelection(roster, 'player-0', 'botan');

  assert.equal(result.ok, true);
  assert.equal(result.swapPlayerId, 'player-1');
  assert.equal(result.projected.find(player => player.id === 'player-0').heroId, 'botan');
  assert.equal(result.projected.find(player => player.id === 'player-1').heroId, 'zairu');
  assert.deepEqual(countRoles(result.projected), ROLE_SLOTS);
  assert.equal(validateRuntimeComposition(result.projected).ok, true);
});

test('rematch bot fill restores the exact fixed slots around human selections', () => {
  const occupied = ['zairu', 'asagi', 'tsuzuri']
    .map((heroId, index) => ({ id: `human-${index}`, heroId, team: 0, isBot: false }));

  const result = planRuntimeBotFill(0, 0, occupied);

  assert.equal(result.ok, true);
  assert.equal(result.botSlots.length, 2);
  assert.equal(result.projected.length, 5);
  assert.deepEqual(countRoles(result.projected), ROLE_SLOTS);
  assert.equal(validateRuntimeComposition(result.projected).ok, true);
});

test('rematch bot fill fails closed when humans already violate a fixed role slot', () => {
  const occupied = ['hokuchi', 'shirasagi', 'botan', 'tsuzuri']
    .map((heroId, index) => ({ id: `human-${index}`, heroId, team: 0, isBot: false }));

  const result = planRuntimeBotFill(0, 0, occupied);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'role_slots_required');
});

test('join slot planning only claims a bot slot with the requested fixed role', () => {
  const roster = ['zairu', 'asagi', 'shirasagi', 'tsuzuri', 'karakasa']
    .map((heroId, index) => ({ id: `slot-${index}`, heroId, team: 0 }));

  const result = selectRuntimeClaimSlot(roster, ['slot-0'], 'hokuchi');
  assert.equal(result.ok, false);
  assert.equal(result.code, 'role_full');
  assert.equal(result.role, 'damage');
});
