// 矛盾修正v0.2.1の検証: §7 延長が「自然なtick駆動」で到達可能であること。
// （修正前は §4 の進行停止と §7 の発生条件が同一tick評価で排他となり、
//   延長がデッドコードになっていた——テストエージェントの発見）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ShiouraObjective } from '../shared/sim/objective.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/mode_shioura.json'), 'utf8'));
const DT = 1 / 63;

function run(obj, presence, seconds, events = []) {
  const ticks = Math.round(seconds / DT);
  for (let i = 0; i < ticks; i++) obj.tick(DT, presence, events);
  return events;
}

test('§7到達性: 敵が終盤に関与し続けると仮想満了で延長が自然発生する', () => {
  const obj = new ShiouraObjective(mode);
  obj.unseal();
  const events = [];
  // チーム0が確保（6秒）
  run(obj, [1, 0], 6.1, events);
  assert.equal(obj.owner, 0);
  // 無妨害で80秒進行（96%）
  run(obj, [0, 0], 80, events);
  assert.ok(obj.pot[0] >= 950 && obj.pot[0] < 1000, `pot=${obj.pot[0]}`);
  // 敵が触り続ける（拮抗: 双方在圏で敵ゲージも凍結）→ 実甕は停止、仮想甕が満了→延長
  run(obj, [1, 1], 10, events);
  assert.equal(obj.ot.active, true, '延長が発生していない');
  assert.equal(obj.pot[0], 1000, '延長発生時に甕は100%固定');
  assert.equal(obj.roundWinner, -1, '延長中はラウンド継続');
  assert.ok(events.some(e => e.type === 'obj_overtime_start'), 'obj_overtime_startイベント');
  // 敵が離れると猶予2.5秒（5.0/2.0）で終了
  run(obj, [1, 0], 2.6, events);
  assert.equal(obj.roundWinner, 0, '猶予枯渇でラウンド勝利');
});

test('§7到達性の境界: 妨害エピソードが切れると仮想甕はリセットされ早期延長は起きない', () => {
  const obj = new ShiouraObjective(mode);
  obj.unseal();
  run(obj, [1, 0], 6.1);
  assert.equal(obj.owner, 0);
  // 序盤に40秒の拮抗（双方在圏＝ゲージ凍結・甕停止。仮想甕は+480先行）
  run(obj, [1, 1], 40);
  assert.ok(obj.pot[0] <= 2, `拮抗中に甕が進行: pot=${obj.pot[0]}`);
  assert.equal(obj.ot.active, false);
  // 妨害が解けて30秒進行（約36%）。仮想甕は実甕に再同期される
  run(obj, [0, 0], 30);
  assert.ok(obj.pot[0] > 300 && obj.pot[0] < 400, `pot=${obj.pot[0]}`);
  // 再び20秒の拮抗。エピソードがリセットされていれば仮想甕は 36%+24%=60% 止まりで延長なし
  // （リセットされていなければ 48%+36%+24%>100% となり誤って延長が発生する）
  run(obj, [1, 1], 20);
  assert.equal(obj.ot.active, false, '妨害エピソードを跨いで仮想甕が持ち越されている');
  assert.equal(obj.roundWinner, -1);
});

test('§3/§7: 敵の関与なしで満了した場合は延長なしの即勝利（従来どおり）', () => {
  const obj = new ShiouraObjective(mode);
  obj.unseal();
  run(obj, [1, 0], 6.1);
  const events = run(obj, [0, 0], 84, []);
  assert.equal(obj.roundWinner, 0);
  assert.equal(obj.ot.active, false);
  assert.ok(!events.some(e => e.type === 'obj_overtime_start'));
});
