// RespawnSystem 単体テスト（§6 リスポーン規則、§7 延長補正）
// 仕様: docs/mode_shioura_rules_v0.2_FROZEN.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RespawnSystem } from '../shared/sim/respawn.js';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { DT, TICK_TOL, MODE, COMBAT } from './helpers.js';

// dt=1/63でtRoundを進め、指定プレイヤーの出撃時刻を返す（出なければ-1）
function spawnTimeOf(rs, playerId, penaltySec = 0, maxSec = 40) {
  const n = Math.round(maxSec / DT);
  for (let i = 1; i <= n; i++) {
    const t = i * DT;
    if (rs.tick(t, penaltySec).includes(playerId)) return t;
  }
  return -1;
}

// ---------------------------------------------------------------- 16. §6 基本＋ウェーブ境界
test('§6 t=0死亡 → 実効10.0秒（10.0はウェーブ境界に一致）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 0);
  const t = spawnTimeOf(rs, 'a');
  assert.notEqual(t, -1);
  assert.ok(Math.abs(t - 10.0) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待10.0）`);
});

test('respawn selects a clear, farther, non-visible spawn in deterministic map order', () => {
  const map = buildMap();
  map.spawns.west = [
    { pos: [-44, 0, 4], yaw: 0 },
    { pos: [-42, -3, 4], yaw: 0 },
    { pos: [-42, 3, 4], yaw: 0 },
  ];
  const world = new World(map, MODE, COMBAT, 71);
  const respawning = world.addPlayer('respawning', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'asagi');
  enemy.move.pos = [-43, 0, 4];

  world.spawnAtBase(respawning, { safe: true, protect: true });

  assert.deepEqual(respawning.move.pos, [-42, -3, 4], 'equal far safe candidates retain fixed map order');
  assert.equal(respawning.spawnProtected, true);
});

test('respawn protection blocks damage, clears on attack, expires on simulation time, and generations reject pre-death history', () => {
  const world = new World(buildMap(), MODE, COMBAT, 72);
  const target = world.addPlayer('target', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.spawnAtBase(target, { safe: true, protect: true });
  const oldGeneration = target.historyGeneration - 1;
  world.history.push(new Map([[target.id, { pos: [99, 99, 4], crouch: false, generation: oldGeneration }]]));

  world.applyDamage(target, 10, enemy, false);
  assert.equal(target.hp, target.maxHp);
  world.clearSpawnProtection(target, 'test');
  assert.notDeepEqual(world.targetsAt(0.2).find(candidate => candidate.id === target.id).pos, [99, 99, 4]);

  world.spawnAtBase(target, { safe: true, protect: true });
  target.move.pos = [0, 0, 10];
  enemy.move.pos = [10, 0, 10];
  target.move.yaw = 0;
  world.queueInput(target.id, { fire: true, yaw: 0, pitch: 0 });
  world.tick();
  assert.equal(target.spawnProtected, false, 'an actual weapon attack removes protection immediately');

  world.spawnAtBase(target, { safe: true, protect: true });
  world.queueInput(target.id, { fire: false, ability1: true, yaw: target.move.yaw, pitch: 0 });
  world.tick();
  assert.equal(target.spawnProtected, false, 'an accepted ability activation removes protection immediately');

  world.spawnAtBase(target, { safe: true, protect: true });
  for (let i = 0; i < Math.ceil(1.3 / world.dt); i++) world.tick();
  assert.equal(target.spawnProtected, false, 'expiry follows simulation time, not wall clock');
});

test('§6 t=0.1死亡 → 準備完了10.1、次ウェーブ12.5で出撃（実効12.4秒）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 0.1);
  const t = spawnTimeOf(rs, 'a');
  assert.ok(Math.abs(t - 12.5) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待12.5）`);
});

test('§6 ウェーブ境界ちょうどの死亡（t=2.5）→ 実効ちょうど10.0秒（t=12.5出撃）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 2.5);
  const t = spawnTimeOf(rs, 'a');
  assert.ok(Math.abs(t - 12.5) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待12.5）`);
});

test('§6 境界直後の死亡（t=2.6）→ 準備完了12.6、ウェーブ15.0で出撃（実効12.4秒）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 2.6);
  const t = spawnTimeOf(rs, 'a');
  assert.ok(Math.abs(t - 15.0) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待15.0）`);
  // 実効リスポーンは常に10.0〜12.5秒の範囲
  assert.ok(t - 2.6 >= 10.0 - TICK_TOL && t - 2.6 <= 12.5 + TICK_TOL);
});

// ---------------------------------------------------------------- 17. §6 同ウェーブ同時出撃・§7 補正加算
test('§6 同ウェーブの味方は同tickで同時出撃', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 0.2); // 準備完了10.2 → ウェーブ12.5
  rs.onDeath('b', 2.4); // 準備完了12.4 → ウェーブ12.5
  const n = Math.round(20 / DT);
  let spawnedAt = null;
  for (let i = 1; i <= n; i++) {
    const t = i * DT;
    const out = rs.tick(t, 0);
    if (out.length > 0) { spawnedAt = { t, out }; break; }
  }
  assert.ok(spawnedAt, '誰も出撃しない');
  assert.deepEqual([...spawnedAt.out].sort(), ['a', 'b'], '同ウェーブで同時に出撃していない');
  assert.ok(Math.abs(spawnedAt.t - 12.5) <= TICK_TOL, `出撃t=${spawnedAt.t.toFixed(4)}`);
});

test('§7 延長補正+3.0が加算される（t=0死亡 → 13.0準備完了 → 15.0出撃）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 0);
  const t = spawnTimeOf(rs, 'a', 3.0);
  assert.ok(Math.abs(t - 15.0) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待15.0）`);
});

test('§7 延長補正+6.0が加算される（t=0死亡 → 16.0準備完了 → 17.5出撃）', () => {
  const rs = new RespawnSystem(MODE.respawn);
  rs.onDeath('a', 0);
  const t = spawnTimeOf(rs, 'a', 6.0);
  assert.ok(Math.abs(t - 17.5) <= TICK_TOL, `出撃t=${t.toFixed(4)}（期待17.5）`);
});
