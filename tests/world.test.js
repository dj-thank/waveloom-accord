// World統合テスト（MatchFlow + ShiouraObjective + RespawnSystem + Collider）
// 仕様: docs/mode_shioura_rules_v0.2_FROZEN.md §1/§6、mode_shioura.json
// setupSecのみ短縮したmodeコピーを使用（指示により許可。他の凍結値は変更しない）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World, EMPTY_INPUT } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { DT, TICK_TOL, MODE, COMBAT } from './helpers.js';

function makeWorld(seed = 1) {
  const mode = structuredClone(MODE);
  mode.setupSec = 0.5; // 短縮（テスト実行時間のため）
  return new World(buildMap(), mode, COMBAT, seed);
}

function runWorld(world, pred, maxTicks) {
  for (let i = 1; i <= maxTicks; i++) {
    world.tick();
    if (pred(world)) return i;
  }
  return -1;
}

function command(seq, overrides = {}) {
  return { ...EMPTY_INPUT, seq, ...overrides };
}

function simulateOneSecondHold(inputRateHz) {
  const world = makeWorld(123);
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  const start = [...player.move.pos];
  let seq = 0;
  let inputIndex = 0;
  for (let tick = 1; tick <= 63; tick++) {
    const tickAtMs = tick * (1_000 / 63);
    while (inputIndex < inputRateHz && inputIndex * (1_000 / inputRateHz) <= tickAtMs + 1e-9) {
      const receivedAtMs = inputIndex * (1_000 / inputRateHz);
      assert.equal(world.queueInputResult(
        player.id,
        command(++seq, { moveX: 0, moveY: 1 }),
        receivedAtMs,
      ).ok, true);
      inputIndex++;
    }
    world.tick(tickAtMs);
  }
  return {
    distance: Math.hypot(player.move.pos[0] - start[0], player.move.pos[1] - start[1]),
    seq,
    ack: player.lastAckSeq,
    health: world.inputCommandHealth(),
  };
}

test('30Hz, 60Hz, and 120Hz hold streams resample to the same 63Hz movement', () => {
  const rates = [30, 60, 120];
  const results = rates.map(simulateOneSecondHold);
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    assert.equal(result.seq, rates[index]);
    assert.equal(result.health.rejected.overflow, 0);
    assert.equal(result.health.queued, 0);
    assert.equal(result.ack, result.seq);
  }
  assert.ok(Math.abs(results[0].distance - results[1].distance) < 0.01);
  assert.ok(Math.abs(results[1].distance - results[2].distance) < 0.01);
});

test('coalescing preserves press-release edges and acknowledges the maximum applied seq', () => {
  const world = makeWorld(124);
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  assert.equal(world.queueInputResult(player.id, command(1, {
    fire: true, jump: true, ability2: true,
  }), 1).ok, true);
  assert.equal(world.queueInputResult(player.id, command(2, {
    fire: false, jump: false, ability2: false,
  }), 2).ok, true);

  world.tick(16);

  assert.equal(player.lastAckSeq, 2);
  assert.equal(player.inputQueue.length, 0);
  assert.equal(player.move.grounded, false, 'jump press is applied');
  const events = world.drainEvents();
  assert.equal(new Set(events.filter(event => (
    event.type === 'shot' && event.source === player.id
  )).map(event => event.attackId)).size, 1);
  assert.equal(events.filter(event => (
    event.player === player.id && (event.type === 'ability_windup' || event.type === 'ability_used')
  )).length, 1);

  world.tick(32);
  assert.equal(player.input.fire, false);
  assert.equal(player.input.jump, false);
  assert.equal(player.input.ability2, false);
  assert.equal(player.abilities.previous.ability2, false);
});

test('coalesced fire uses the press frame aim instead of the later release aim', () => {
  const makeShooter = () => {
    const world = makeWorld(126);
    const player = world.addPlayer('human', false, 0, 'asagi');
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    return { world, player };
  };
  const batched = makeShooter();
  batched.world.queueInputResult(batched.player.id, command(1, { fire: true, yaw: 0 }), 1);
  batched.world.queueInputResult(batched.player.id, command(2, { fire: false, yaw: Math.PI / 2 }), 2);
  batched.world.tick(16);
  const batchedShot = batched.world.drainEvents().find(event => event.type === 'shot');

  const paced = makeShooter();
  paced.world.queueInputResult(paced.player.id, command(1, { fire: true, yaw: 0 }), 1);
  paced.world.tick(16);
  const pacedShot = paced.world.drainEvents().find(event => event.type === 'shot');
  paced.world.queueInputResult(paced.player.id, command(2, { fire: false, yaw: Math.PI / 2 }), 17);
  paced.world.tick(32);

  assert.ok(batchedShot);
  assert.ok(pacedShot);
  assert.deepEqual(batchedShot.dir, pacedShot.dir);
  assert.equal(batched.player.lastAckSeq, 2);
  assert.equal(paced.player.lastAckSeq, 2);
});

test('a bounded reorder window recovers reversed input and skips a lost seq after its wait', () => {
  const world = makeWorld(125);
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();

  assert.equal(world.queueInputResult(player.id, command(2, { ability2: false }), 1).ok, true);
  assert.equal(world.queueInputResult(player.id, command(1, { ability2: true }), 2).ok, true);
  assert.deepEqual(world.queueInputResult(player.id, command(2), 3), {
    ok: false, code: 'stale_input',
  });
  world.tick(16);
  assert.equal(player.lastAckSeq, 2);
  assert.equal(world.drainEvents().filter(event => (
    event.player === player.id && (event.type === 'ability_windup' || event.type === 'ability_used')
  )).length, 1);

  assert.equal(world.queueInputResult(player.id, command(4, { r: true }), 20).ok, true);
  world.tick(40);
  assert.equal(player.lastAckSeq, 2, 'gap remains inside the bounded reorder wait');
  world.tick(53);
  assert.equal(player.lastAckSeq, 4, 'missing seq is declared lost after the bounded wait');
  assert.equal(player.input.r, true);
  assert.equal(world.inputCommandHealth().reorder.gapsSkipped, 1);
  assert.equal(world.inputCommandHealth().reorder.missingSequences, 1);
});

test('human input ACK advances only when one queued command is applied by a tick', () => {
  const world = makeWorld();
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  const start = [...player.move.pos];

  assert.equal(world.queueInput(player.id, command(1, { f: true })), true);
  assert.equal(player.lastAckSeq, 0);
  assert.equal(player.input.f, false);
  assert.equal(world.snapshot().players.find(candidate => candidate.id === player.id).ack, 0);

  world.tick();

  assert.equal(player.lastAckSeq, 1);
  assert.equal(player.input.f, true);
  assert.equal(world.snapshot().players.find(candidate => candidate.id === player.id).ack, 1);
  assert.ok(Math.hypot(player.move.pos[0] - start[0], player.move.pos[1] - start[1]) > 0);
});

test('a four-command burst coalesces movement and preserves a fire press-release', () => {
  const world = makeWorld(9);
  const player = world.addPlayer('human', false, 0, 'shirasagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();

  const control = makeWorld(9);
  const controlPlayer = control.addPlayer('control', false, 0, 'shirasagi');
  control.flow.state = 'ACTIVE';
  control.objective.unseal();

  const commands = [
    command(1, { f: true, fire: true }),
    command(2, { f: false, fire: false }),
    command(3, { r: true }),
    command(4, { r: false }),
  ];
  for (const input of commands) assert.equal(world.queueInput(player.id, input), true);
  assert.equal(control.queueInput(controlPlayer.id, command(1)), true);
  assert.equal(player.lastAckSeq, 0);

  world.tick();
  control.tick();

  assert.equal(player.lastAckSeq, 4);
  assert.deepEqual(player.move.pos, controlPlayer.move.pos);
  const firstTickEvents = world.drainEvents();
  assert.equal(firstTickEvents.filter(event => event.type === 'weapon_charge').length, 1);
  assert.equal(firstTickEvents.filter(event => event.type === 'shot').length, 1);

  world.tick();
  assert.equal(player.lastAckSeq, 4);
  assert.equal(world.drainEvents().filter(event => event.type === 'shot').length, 0);
  assert.equal(player.input.r, false);
});

test('human input queue rejects duplicate, reordered, and overflow commands without future ACKs', () => {
  const world = makeWorld();
  const player = world.addPlayer('human', false, 0, 'asagi');

  for (let seq = 1; seq <= 32; seq++) {
    assert.equal(world.queueInput(player.id, command(seq)), true);
  }
  assert.equal(world.queueInput(player.id, command(32)), false, 'duplicate');
  assert.equal(world.queueInput(player.id, command(31)), false, 'reordered');
  assert.equal(world.queueInput(player.id, command(33)), false, 'overflow');
  assert.equal(player.lastAckSeq, 0, 'accepted future commands are not yet acknowledged');
  assert.equal(world.snapshot().players.find(candidate => candidate.id === player.id).ack, 0);
  assert.deepEqual(world.inputCommandHealth(), {
    capacityPerPlayer: 32,
    leaseMs: 250,
    queued: 32,
    accepted: 32,
    applied: 0,
    rejected: { invalid: 0, stale: 2, overflow: 1, outOfWindow: 0 },
    leaseExpirations: 0,
    discardedOnLease: 0,
    discardedOnNeutralize: 0,
    reorder: {
      window: 32, waitMs: 32, bufferedOutOfOrder: 0,
      gapsSkipped: 0, missingSequences: 0,
    },
    highWatermark: 32,
  });

  world.tick();
  assert.equal(player.lastAckSeq, 32);
  assert.equal(world.queueInput(player.id, command(33)), true);
});

test('a 250ms server lease clears queued and held human input after a blackhole', () => {
  const world = makeWorld();
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  const held = {
    f: true, jump: true, crouch: true, fire: true, reload: true,
    secondary: true, ability1: true, ability2: true, ultimate: true,
  };
  for (let seq = 1; seq <= 20; seq++) {
    assert.equal(world.queueInput(player.id, command(seq, held)), true);
  }

  for (let tick = 0; tick < 15; tick++) world.tick();
  assert.equal(player.lastAckSeq, 20);
  assert.equal(player.input.f, true);

  world.tick();

  assert.equal(player.lastAckSeq, 20, 'lease expiry preserves the maximum applied ACK');
  for (const field of [
    'f', 'b', 'l', 'r', 'jump', 'crouch', 'fire', 'reload',
    'secondary', 'ability1', 'ability2', 'ultimate',
  ]) assert.equal(player.input[field], false, field);
  assert.deepEqual(player.abilities.previous, {
    secondary: false, ability1: false, ability2: false, ultimate: false,
  });
  assert.equal(world.inputCommandHealth().queued, 0);
  assert.equal(world.inputCommandHealth().leaseExpirations, 1);
  assert.equal(world.inputCommandHealth().discardedOnLease, 0);

  assert.equal(world.queueInput(player.id, command(21, { r: true })), true);
  world.tick();
  assert.equal(player.lastAckSeq, 21);
  assert.equal(player.input.r, true);
});

test('lease-retired input cannot be replayed and a later seq resumes safely', () => {
  const world = makeWorld(127);
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  assert.equal(world.queueInputResult(player.id, command(2, { ability2: true }), 1_000).ok, true);

  world.tick(1_250);

  let snapshot = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(snapshot.ack, 0);
  assert.equal(snapshot.retired, 2);
  assert.equal(world.inputCommandHealth().discardedOnLease, 1);
  assert.deepEqual(world.queueInputResult(player.id, command(2, { ability2: true }), 1_251), {
    ok: false, code: 'stale_input',
  });
  assert.equal(world.queueInputResult(player.id, command(3, { r: true }), 1_251).ok, true);
  world.tick(1_252);
  snapshot = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(snapshot.ack, 3);
  assert.equal(snapshot.retired, 3);
  assert.equal(player.input.r, true);
});

test('reload and ability press-release commands remain ordered across ticks', () => {
  const world = makeWorld();
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.weapon.ammo--;
  const partialAmmo = player.weapon.ammo;
  for (const input of [
    command(1, { reload: true }),
    command(2, { reload: false }),
    command(3, { ability2: true }),
    command(4, { ability2: false }),
  ]) assert.equal(world.queueInput(player.id, input), true);

  world.tick();
  assert.equal(world.snapshot().players.find(candidate => candidate.id === player.id).reloading, true);
  assert.equal(player.lastAckSeq, 4);
  assert.equal(world.drainEvents().filter(event => (
    event.type === 'ability_used' && event.player === player.id && event.slot === 'ability2'
  )).length, 1);
  world.tick();
  assert.equal(player.lastAckSeq, 4);
  assert.equal(player.abilities.previous.ability2, false);
});

test('reload snapshot reports remaining time and progress while ammo refills only at completion', () => {
  const world = makeWorld(75);
  const player = world.addPlayer('human', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.weapon.ammo--;
  const partialAmmo = player.weapon.ammo;
  world.queueInput(player.id, { reload: true });
  world.tick();
  let state = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(state.ammo, player.weapon.ammo);
  assert.equal(state.reloading, true);
  assert.ok(state.reloadRemainingSec > 1.5);
  assert.equal(state.reloadProgress, 0);

  while (world.t + world.dt + 1e-9 < player.weapon.reloadUntil) world.tick();
  assert.equal(player.weapon.ammo, partialAmmo, 'test setup retains partial magazine before final tick');
  world.tick();
  state = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(state.ammo, state.maxAmmo);
  assert.equal(state.reloading, false);
  assert.equal(state.reloadRemainingSec, 0);
  assert.equal(state.reloadProgress, 0);

  player.weapon.ammo = 0;
  player.weapon.reloadStartedAt = world.t;
  player.weapon.reloadUntil = world.t + 1.6;
  world.spawnAtBase(player);
  state = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(state.ammo, state.maxAmmo);
  assert.equal(state.reloading, false);
  assert.equal(state.reloadProgress, 0);
});

test('disconnect neutralization clears pending input and lets bot takeover continue from applied ACK', () => {
  const world = makeWorld();
  const player = world.addPlayer('human', false, 0, 'asagi');
  assert.equal(world.queueInput(player.id, command(1, { f: true })), true);
  assert.equal(world.queueInput(player.id, command(2, { fire: true })), true);
  world.tick();
  assert.equal(player.lastAckSeq, 2);
  assert.equal(world.queueInputResult(player.id, command(4, { fire: true }), 20).ok, true);

  assert.equal(world.neutralizeInput(player.id, { acceptedToApplied: true }), true);
  assert.equal(world.inputCommandHealth().queued, 0);
  assert.equal(world.inputCommandHealth().discardedOnNeutralize, 1);
  assert.equal(world.inputCommandHealth().discardedOnLease, 0);
  assert.equal(player.input.f, false);
  assert.equal(player.input.fire, false);

  world.tick(10_000);
  assert.equal(world.inputCommandHealth().leaseExpirations, 0);
  assert.equal(world.inputCommandHealth().discardedOnLease, 0,
    'commands discarded by neutralization are not counted again by the lease');
  assert.equal(world.neutralizeInput(player.id, { acceptedToApplied: true }), true);
  assert.equal(world.inputCommandHealth().discardedOnNeutralize, 1,
    'neutralizing an empty queue does not increment the counter');

  player.isBot = true;
  assert.equal(world.queueInput(player.id, command(3, { r: true })), true);
  assert.equal(player.lastAckSeq, 3);
  assert.equal(player.input.r, true);
});

test('§1/§9 試合ログ先頭にseedとラウンド1サイド割当を記録する', () => {
  const world = makeWorld(424242);
  assert.deepEqual(world.log[0], {
    tick: 0,
    t: 0,
    type: 'match_start',
    seed: 424242,
    round: 1,
    sides: [...world.flow.sides],
  });
});

test('§9 目標状態遷移ログにエリア内在圏者のIDと有効関与判定を記録する', () => {
  const world = makeWorld();
  const player = world.addPlayer('observer', true, 0);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [...world.map.objective.center];

  world.tick();

  const transition = world.log.find(e =>
    e.type === 'obj_state_transition' && e.from === 'neutral' && e.to === 'capturing');
  assert.ok(transition, '中立→争奪中の遷移ログがない');
  assert.deepEqual(transition.occupants, [
    { id: player.id, team: 0, effective: true },
  ]);
});

test('§9 封灯解除と480秒capのflow経由目標イベントにも在圏者リストを記録する', () => {
  const setupWorld = makeWorld();
  setupWorld.addPlayer('setup', true, 0);
  runWorld(setupWorld, w => w.flow.state === 'ACTIVE', 63 * 2);
  const unsealed = setupWorld.log.find(e =>
    e.type === 'obj_state_transition' && e.from === 'sealed' && e.to === 'neutral');
  assert.ok(unsealed, '封灯解除の遷移ログがない');
  assert.deepEqual(unsealed.occupants, []);

  const capWorld = makeWorld();
  const player = capWorld.addPlayer('cap', true, 0);
  capWorld.flow.state = 'ACTIVE';
  capWorld.objective.unseal();
  capWorld.objective.pot = [501, 500];
  capWorld.objective.time = MODE.roundCapSec;
  player.move.pos = [...capWorld.map.objective.center];
  capWorld.tick();
  const capWin = capWorld.log.find(e => e.type === 'obj_round_win' && e.reason === 'time_cap');
  assert.ok(capWin, 'time_cap勝利ログがない');
  assert.deepEqual(capWin.occupants, [{ id: player.id, team: 0, effective: true }]);
});

test('§7 480秒を越えた延長で奪還しても旧占有陣のcap勝利にならない', () => {
  const world = makeWorld();
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 0;
  world.objective.unseal();
  world.objective.owner = 0;
  world.objective.pot = [1000, 0];
  world.objective.virtPot = [1000, 0];
  world.objective.time = MODE.roundCapSec + 1;
  world.objective.ot = { active: true, grace: 5, cap: 5, elapsed: 10 };
  world.objective.capture(1, world.events);

  world.tick();

  assert.equal(world.objective.owner, 1);
  assert.equal(world.objective.roundWinner, -1, '奪還直後は試合を継続する');
  assert.equal(world.flow.state, 'ACTIVE');
});

// チーム0のプレイヤーを灯着点内に置いてラウンドを取り切る
function winRoundWithTeam0(world, pl) {
  assert.equal(world.flow.state, 'ACTIVE');
  pl.move.pos = [3, 0, 2.5]; // ボウル床（遮蔽物と重ならない位置）
  pl.move.vel = [0, 0, 0];
  pl.move.grounded = true;
  // 確保≈6秒 + 甕1.2%/s≈83.3秒 → 余裕を見て120秒
  const t = runWorld(world, w => w.flow.state === 'ROUND_END', 63 * 120);
  assert.notEqual(t, -1, 'ラウンドが決着しない');
}

// ---------------------------------------------------------------- 21. SETUP/ACTIVE
test('§1 SETUP中は目標sealed・スポーン扉ソリッド有効、ACTIVEで解放', () => {
  const world = makeWorld();
  world.addPlayer('a', true, 0);
  world.addPlayer('b', true, 1);
  world.tick();
  assert.equal(world.flow.state, 'SETUP');
  assert.equal(world.objective.sealed, true, 'SETUP中は封灯');
  assert.equal(world.collider.dynamic.length, 6, '扉6枚（東西×3口）がソリッド');
  // 東正面ゲート（x=38.6）を扉が塞ぐ: スポーン内側からのレイが扉に当たる
  const dSetup = world.collider.raycast(42, 0, 5.6, -1, 0, 0, 60);
  assert.ok(Math.abs(dSetup - 3.4) < 1e-6, `SETUP中のレイ距離=${dSetup}（期待3.4=扉面）`);
  // SETUP中は目標tickが進まない（time=0のまま）
  assert.equal(world.objective.time, 0);
  // ACTIVEへ
  const t = runWorld(world, w => w.flow.state === 'ACTIVE', 63 * 2);
  assert.notEqual(t, -1);
  world.tick(); // 扉状態はtick先頭で反映
  assert.equal(world.objective.sealed, false, 'ACTIVEで解放（封灯解除）');
  assert.equal(world.collider.dynamic.length, 0, 'ACTIVEで扉が消える');
  const dActive = world.collider.raycast(42, 0, 5.6, -1, 0, 0, 60);
  assert.ok(Math.abs(dActive - 21.2) < 1e-6, `ACTIVE中のレイ距離=${dActive}（期待21.2=大灯柱）`);
});

// ---------------------------------------------------------------- 22. ラウンド勝利→サイド入替
test('§1 ラウンド勝利→score加算→ROUND_END(5秒)→次ラウンドでサイド入替', () => {
  const world = makeWorld();
  const a = world.addPlayer('a', true, 0);
  world.addPlayer('b', true, 1);
  runWorld(world, w => w.flow.state === 'ACTIVE', 63 * 2);
  const sidesR1 = [...world.flow.sides];
  winRoundWithTeam0(world, a);
  assert.deepEqual(world.flow.score, [1, 0], 'score加算');
  assert.equal(world.flow.round, 1);
  // ROUND_END → resultSec(5.0秒) → 次ラウンドSETUP
  const ticksInResult = runWorld(world, w => w.flow.state !== 'ROUND_END', 63 * 10);
  assert.notEqual(ticksInResult, -1);
  assert.ok(Math.abs(ticksInResult * DT - MODE.resultSec) <= 3 * DT,
    `リザルト${(ticksInResult * DT).toFixed(3)}s（期待${MODE.resultSec}s）`);
  assert.equal(world.flow.state, 'SETUP');
  assert.equal(world.flow.round, 2);
  assert.deepEqual(world.flow.sides, [sidesR1[1], sidesR1[0]], 'ラウンド2で左右入替（sides反転）');
  // 次ラウンドに向けて目標がリセットされ、プレイヤーは新サイドのスポーンへ戻る
  assert.equal(world.objective.owner, -1);
  assert.deepEqual(world.objective.pot, [0, 0]);
  assert.ok(Math.hypot(a.move.pos[0] - 3, a.move.pos[1] - 0) > 10, 'スポーンへ再配置');
});

// ---------------------------------------------------------------- 23. 2本先取でMATCH_END
test('§1 2本先取でMATCH_END・matchWinner確定', () => {
  const world = makeWorld();
  const a = world.addPlayer('a', true, 0);
  world.addPlayer('b', true, 1);
  // ラウンド1
  runWorld(world, w => w.flow.state === 'ACTIVE', 63 * 2);
  winRoundWithTeam0(world, a);
  // ラウンド2
  const t2 = runWorld(world, w => w.flow.state === 'ACTIVE' && w.flow.round === 2, 63 * 10);
  assert.notEqual(t2, -1, 'ラウンド2が開始しない');
  winRoundWithTeam0(world, a);
  assert.deepEqual(world.flow.score, [2, 0]);
  // リザルト後にMATCH_END
  const t3 = runWorld(world, w => w.flow.state === 'MATCH_END', 63 * 10);
  assert.notEqual(t3, -1, 'MATCH_ENDに到達しない');
  assert.equal(world.flow.matchWinner, 0, 'matchWinner確定');
  assert.equal(world.flow.round, 2, '3ラウンド目は行われない（2本先取）');
});

// ---------------------------------------------------------------- 24. 死亡→ウェーブ復帰
test('§6 applyDamageで死亡→pending→ウェーブで復帰し体力全快・スポーン位置', () => {
  const world = makeWorld();
  const a = world.addPlayer('a', true, 0);
  const b = world.addPlayer('b', true, 1);
  runWorld(world, w => w.flow.state === 'ACTIVE', 63 * 2);
  world.tick();
  const tDeath = world.objective.time;
  world.applyDamage(b, 9999, a, false);
  assert.equal(b.alive, false, '死亡');
  assert.equal(b.hp, 0);
  assert.ok(world.respawn.pending.has(b.id), 'respawn.pendingに入る');
  assert.equal(b.stats.deaths, 1);
  assert.equal(a.stats.kills, 1);
  // ウェーブ復帰（実効10.0〜12.5秒）
  const ticks = runWorld(world, w => w.players.get(b.id).alive, 63 * 20);
  assert.notEqual(ticks, -1, '復帰しない');
  const tSpawn = world.objective.time;
  const wait = tSpawn - tDeath;
  assert.ok(wait >= 10.0 - TICK_TOL && wait <= 12.5 + TICK_TOL, `実効リスポーン=${wait.toFixed(3)}s`);
  // 出撃はウェーブ境界（2.5秒周期）に一致
  const rem = tSpawn % MODE.respawn.waveIntervalSec;
  assert.ok(rem <= TICK_TOL || MODE.respawn.waveIntervalSec - rem <= TICK_TOL,
    `ウェーブ境界に一致しない: t=${tSpawn.toFixed(3)}`);
  assert.ok(!world.respawn.pending.has(b.id), 'pendingから除去');
  // 体力全快・弾薬満タン
  assert.equal(b.hp, COMBAT.health.trainingBodyHp, '体力全快');
  assert.equal(b.weapon.ammo, COMBAT.trainingWeapon.magSize);
  // 自陣サイドのスポーン位置に出撃
  const pts = world.map.spawns[world.sideOf(b.team)];
  const atSpawn = pts.some(sp =>
    Math.hypot(sp.pos[0] - b.move.pos[0], sp.pos[1] - b.move.pos[1]) < 0.5);
  assert.ok(atSpawn, `スポーン位置でない: pos=${b.move.pos}`);
});

test('falling below map.killZ enters the authoritative environmental respawn path', () => {
  const world = makeWorld(806);
  assert.ok(Number.isFinite(world.map.killZ) && world.map.killZ <= -8);
  const player = world.addPlayer('faller', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos[2] = world.map.killZ - 0.25;
  player.move.vel[2] = -2;
  player.move.grounded = false;

  world.tick();

  assert.equal(player.alive, false);
  assert.equal(player.hp, 0);
  assert.equal(player.stats.deaths, 1);
  assert.equal(world.respawn.pending.has(player.id), true);
  assert.ok(player.move.pos[2] < world.map.killZ, `fall was teleported to ${player.move.pos[2]}`);
  assert.equal(world.snapshot().players.find(candidate => (
    candidate.id === player.id
  )).grounded, false);
  const death = world.drainEvents().find(event => (
    event.type === 'kill' && event.target === player.id
  ));
  assert.ok(death);
  assert.equal(death.source, undefined);
  assert.equal(death.cause, 'environment');
  assert.equal(death.environment, 'void_fall');

  const ticks = runWorld(world, current => current.players.get(player.id).alive, 63 * 20);
  assert.notEqual(ticks, -1, 'environmental death never respawned');
  assert.equal(player.move.grounded, true);
  assert.ok(player.move.pos[2] > world.map.killZ);
  assert.equal(world.drainEvents().some(event => (
    event.type === 'respawn' && event.player === player.id
  )), true);
});

test('snapshot publishes the simulation grounded flag without inferring contact', () => {
  const world = makeWorld(807);
  const player = world.addPlayer('snapshot-grounding', false, 0, 'asagi');
  assert.equal(player.move.grounded, true, 'validated spawn starts grounded');

  player.move.grounded = false;
  player.move.vel[2] = 0;
  let state = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(state.grounded, false, 'zero vertical velocity does not imply grounded');

  player.move.grounded = true;
  state = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(state.grounded, true);
});

test('§4/§7 480秒同点でサドンデスへ入るtickから復帰+3秒を適用する', () => {
  const world = makeWorld();
  const player = world.addPlayer('待機者', true, 0);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.time = MODE.roundCapSec - world.dt / 2;
  world.objective.pot = [500, 500];
  world.objective.virtPot = [500, 500];
  player.alive = false;
  player.hp = 0;
  world.respawn.onDeath(player.id, MODE.roundCapSec - 10);
  world.respawn.prevT = MODE.roundCapSec - world.dt / 2;

  world.tick();

  assert.equal(world.objective.suddenDeath, true);
  assert.equal(player.alive, false, '補正なしなら480秒ウェーブで出てしまうため、開始tickから+3秒が必要');
  assert.ok(world.respawn.pending.has(player.id));
});
