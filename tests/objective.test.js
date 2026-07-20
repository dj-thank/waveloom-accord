// ShiouraObjective 単体テスト（§3〜§8）
// 仕様: docs/mode_shioura_rules_v0.2_FROZEN.md
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { updateEffectivePresence } from '../shared/sim/objective.js';
import {
  DT, TICK_TOL, MODE, makeObjective, makeOvertime, run, runUntil, mkPlayer, OBJ_AREA,
} from './helpers.js';

// ---------------------------------------------------------------- 1. §4 確保時間
for (const [count, expectSec] of [[1, 6.0], [2, 4.5], [3, 3.6]]) {
  test(`§4 中立→確保: ${count}人で${expectSec}秒（±1tick）`, () => {
    const obj = makeObjective();
    const ticks = runUntil(obj, [count, 0], o => o.owner === 0, 63 * 10);
    assert.notEqual(ticks, -1, '確保が成立しない');
    assert.ok(Math.abs(ticks * DT - expectSec) <= 1.5 * DT,
      `確保まで${(ticks * DT).toFixed(4)}s（期待${expectSec}s）`);
  });
}

test('§4 中立→確保: 4人でも3人と同一（4人目以降の加速なし）', () => {
  const obj3 = makeObjective();
  const t3 = runUntil(obj3, [3, 0], o => o.owner === 0, 63 * 10);
  const obj4 = makeObjective();
  const t4 = runUntil(obj4, [4, 0], o => o.owner === 0, 63 * 10);
  assert.equal(t4, t3, `3人=${t3}tick / 4人=${t4}tick`);
});

// ---------------------------------------------------------------- 2. §3 拮抗
test('§3 拮抗: 両陣在圏で両ゲージ凍結', () => {
  const obj = makeObjective();
  run(obj, 2.0, [0, 1]); // gauge1 ≈ 33
  run(obj, 1.0, [1, 0]); // gauge0 ≈ 16.7（gauge1は不在1.0s<2.0sで減衰なし）
  const before = [...obj.gauge];
  assert.ok(before[0] > 10 && before[1] > 25, `前提: gauge=${before}`);
  run(obj, 3.0, [2, 3]); // 両陣在圏 → 拮抗
  assert.deepEqual(obj.gauge, before, '拮抗中に争奪ゲージが変動した');
  assert.equal(obj.owner, -1);
});

// ---------------------------------------------------------------- 3. §4 減衰
test('§4 減衰: 関与断絶2.0秒後から10pt/s、0で下げ止まり', () => {
  const obj = makeObjective();
  run(obj, 3.0, [1, 0]); // gauge0 ≈ 50
  const g0 = obj.gauge[0];
  assert.ok(Math.abs(g0 - 50) < 0.5, `前提: gauge0=${g0}`);
  run(obj, 1.9, [0, 0]); // 2.0秒未満: 減衰しない
  assert.equal(obj.gauge[0], g0, '減衰開始が2.0秒より早い');
  run(obj, 2.1, [0, 0]); // 不在通算4.0秒 → 減衰は2.0秒経過後の約2.0秒ぶん=約20pt
  assert.ok(Math.abs(obj.gauge[0] - (g0 - 20)) <= 10 * (3 * DT) + 0.01,
    `減衰量が10pt/sでない: gauge0=${obj.gauge[0]}`);
  run(obj, 10, [0, 0]); // 0で下げ止まる
  assert.equal(obj.gauge[0], 0);
  run(obj, 1, [0, 0]);
  assert.equal(obj.gauge[0], 0);
});

test('§4 減衰: 確保済みの占有ステータス自体は減衰しない', () => {
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  run(obj, 30, [0, 0]); // 30秒間 誰も関与しない
  assert.equal(obj.owner, 0, '占有ステータスが失われた');
  assert.ok(obj.pot[0] > 0, '進行が継続していない');
});

// ---------------------------------------------------------------- 4. §3 確保時の処理
test('§3 確保時: 相手の争奪ゲージは0にリセット', () => {
  const obj = makeObjective();
  run(obj, 3.0, [0, 1]); // gauge1 ≈ 50
  run(obj, 5.5, [1, 0]); // 確保直前（6.0s未満）。gauge1は減衰で約15
  assert.equal(obj.owner, -1, '前提: まだ確保前');
  assert.ok(obj.gauge[1] > 5, `前提: 相手ゲージが残存 gauge1=${obj.gauge[1]}`);
  const ticks = runUntil(obj, [1, 0], o => o.owner === 0, 63 * 2);
  assert.notEqual(ticks, -1);
  assert.equal(obj.gauge[1], 0, '確保時に相手争奪ゲージが0にリセットされていない');
  assert.equal(obj.gauge[0], MODE.capture.gaugeMax);
});

test('§3 占有交代（奪還）時に旧占有陣の甕は保持される', () => {
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  run(obj, 10, [0, 0]); // pot0 ≈ 120（12.0%）
  const pot0 = obj.pot[0];
  assert.ok(pot0 >= 115, `前提: pot0=${pot0}`);
  const ticks = runUntil(obj, [0, 1], o => o.owner === 1, 63 * 8);
  assert.notEqual(ticks, -1, '奪還が成立しない');
  assert.equal(obj.pot[0], pot0, '占有交代で旧占有陣の甕が変動した');
  assert.equal(obj.gauge[0], 0);
});

// ---------------------------------------------------------------- 5. §3 進行
test('§3 進行: 1.2%/s。占有側が離圏しても継続、敵の有効関与で即停止', () => {
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  const p0 = obj.pot[0];
  run(obj, 2, [1, 0]); // 占有側在圏でも進行
  assert.ok(obj.pot[0] - p0 >= 22 && obj.pot[0] - p0 <= 26, `2秒で${obj.pot[0] - p0}(0.1%)`);
  const p1 = obj.pot[0];
  run(obj, 10, [0, 0]); // 離圏しても進行継続
  const gained = obj.pot[0] - p1;
  assert.ok(Math.abs(gained - 120) <= 2, `10秒の進行=${gained}(0.1%)（期待120±2）`);
  const p2 = obj.pot[0];
  run(obj, 2, [0, 1]); // 敵の有効関与 → 即停止（最初のtickから加算なし）
  assert.equal(obj.pot[0], p2, '敵関与中に甕が進行した');
  run(obj, 1, [1, 1]); // 拮抗（敵関与あり）でも停止
  assert.equal(obj.pot[0], p2);
});

// ---------------------------------------------------------------- 6. §7 延長の発生
test('§7 延長開始: 甕100%到達tickで敵有効関与≥1なら延長へ', () => {
  // 注: 実装の自然フローではこの状態に到達できない（最終回答で報告するバグ）。
  // ここでは「100%到達＋敵関与」の状態を注入し、§7の開始処理そのものを検証する。
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  obj.pot[0] = 1000;
  obj.potFrac[0] = 0;
  const ev = [];
  obj.tick(DT, [0, 1], ev);
  assert.equal(obj.ot.active, true, '延長が開始されない');
  assert.equal(obj.roundWinner, -1);
  assert.equal(obj.ot.grace, MODE.overtime.graceInitialSec); // 初期値=5.0
  assert.equal(obj.ot.cap, MODE.overtime.graceInitialSec);   // 上限=5.0
  assert.ok(ev.some(e => e.type === 'obj_overtime_start'));
});

test('§7 甕100%到達tickで敵有効関与0なら即ラウンド勝利', () => {
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  const ev = [];
  const ticks = runUntil(obj, [0, 0], o => o.roundWinner >= 0, 63 * 90, ev);
  assert.notEqual(ticks, -1);
  assert.equal(obj.roundWinner, 0);
  assert.equal(obj.ot.active, false, '敵不在なのに延長が発生した');
  assert.equal(obj.pot[0], 1000, '甕100%と同tickで勝利していない');
  const win = ev.find(e => e.type === 'obj_round_win');
  assert.equal(win.reason, 'pot_full_no_contest');
});

// ---------------------------------------------------------------- 7. §7 猶予ゲージ
test('§7 猶予: 敵関与0で2.0/s減少、0.0到達で即ラウンド終了', () => {
  const obj = makeOvertime(); // grace=5.0
  const ev = [];
  const ticks = runUntil(obj, [0, 0], o => o.roundWinner >= 0, 63 * 5, ev);
  assert.notEqual(ticks, -1, '急速終了しない');
  // 5.0 / 2.0 = 2.5秒（±2tick）
  assert.ok(Math.abs(ticks * DT - 2.5) <= TICK_TOL, `終了まで${(ticks * DT).toFixed(4)}s`);
  assert.equal(obj.roundWinner, 0);
  const win = ev.find(e => e.type === 'obj_round_win');
  assert.equal(win.reason, 'overtime_expired');
});

test('§7 猶予: 敵関与1以上で1.0/s回復（上限まで）', () => {
  const obj = makeOvertime(); // grace=5.0, cap=5.0
  run(obj, 1.0, [0, 0]); // 減少 → ≈3.0
  assert.ok(Math.abs(obj.ot.grace - 3.0) <= 2.0 * TICK_TOL + 1e-9, `grace=${obj.ot.grace}`);
  run(obj, 1.0, [0, 1]); // 回復 1.0/s → ≈4.0
  assert.ok(Math.abs(obj.ot.grace - 4.0) <= 3.0 * TICK_TOL + 1e-9, `grace=${obj.ot.grace}`);
  run(obj, 3.0, [0, 1]); // 上限5.0で頭打ち（延長開始から計5秒<10秒なので上限縮小前）
  assert.ok(Math.abs(obj.ot.grace - 5.0) <= 1e-9, `grace=${obj.ot.grace}`);
  assert.equal(obj.roundWinner, -1);
});

// ---------------------------------------------------------------- 8. §7 上限縮小
test('§7 上限縮小: 10秒毎に5.0→4.0→3.0→2.0（下限2.0）、現在値も切り下げ', () => {
  const obj = makeOvertime();
  // 敵関与を維持して延長を継続。占有側も在圏させ拮抗にして、
  // 敵の争奪ゲージによる奪還（延長解除）を防ぐ（§3拮抗＝ゲージ凍結）。
  run(obj, 10.1, [1, 1]);
  assert.equal(obj.ot.cap, 4.0, `10秒後 cap=${obj.ot.cap}`);
  assert.ok(obj.ot.grace <= 4.0 + 1e-9 && obj.ot.grace > 3.9, `切り下げ: grace=${obj.ot.grace}`);
  run(obj, 10.0, [1, 1]);
  assert.equal(obj.ot.cap, 3.0, `20秒後 cap=${obj.ot.cap}`);
  assert.ok(obj.ot.grace <= 3.0 + 1e-9, `grace=${obj.ot.grace}`);
  run(obj, 10.0, [1, 1]);
  assert.equal(obj.ot.cap, 2.0, `30秒後 cap=${obj.ot.cap}`);
  run(obj, 10.0, [1, 1]);
  assert.equal(obj.ot.cap, 2.0, `40秒後も下限2.0を維持 cap=${obj.ot.cap}`);
  assert.ok(obj.ot.grace <= 2.0 + 1e-9 && obj.ot.grace > 1.9, `grace=${obj.ot.grace}`);
  assert.equal(obj.roundWinner, -1, '敵関与継続中に延長が終了した');
});

// ---------------------------------------------------------------- 9. §7 リスポーン補正
test('§7 延長リスポーン補正: +3.0、延長開始30秒後から+6.0', () => {
  const normal = makeObjective();
  assert.equal(normal.respawnPenaltySec(), 0, '通常時は補正なし');
  const obj = makeOvertime();
  assert.equal(obj.respawnPenaltySec(), 3.0, '延長開始直後は+3.0');
  // 拮抗[1,1]で延長を維持（[0,1]だと敵ゲージが溜まり奪還→延長解除になるため）
  run(obj, 29.5, [1, 1]);
  assert.equal(obj.respawnPenaltySec(), 3.0, '30秒未満は+3.0');
  run(obj, 1.0, [1, 1]); // 延長開始から約30.5秒
  assert.equal(obj.respawnPenaltySec(), 6.0, '30秒経過後は+6.0');
});

// ---------------------------------------------------------------- 10. §7 奪還
test('§7 奪還: 敵ゲージ100→占有交代・延長解除・旧陣甕100%保持', () => {
  const obj = makeOvertime(); // owner=0, pot0=1000, 延長中
  const ev = [];
  const ticks = runUntil(obj, [0, 2], o => o.owner === 1, 63 * 8, ev);
  assert.notEqual(ticks, -1, '奪還が成立しない');
  assert.equal(obj.ot.active, false, '延長が解除されていない');
  assert.equal(obj.pot[0], 1000, '旧占有陣の甕100%が保持されていない');
  assert.equal(obj.roundWinner, -1);
  assert.ok(ev.some(e => e.type === 'obj_retake'));
  // 新占有陣は「進行」状態: 敵不在なら甕が上昇する
  run(obj, 2, [0, 1]);
  assert.ok(obj.pot[1] > 0, '奪還後の新占有陣が進行していない');
});

test('§7 奪還後: 旧陣が再確保し敵関与0になった瞬間に即ラウンド勝利', () => {
  const obj = makeOvertime();
  runUntil(obj, [0, 2], o => o.owner === 1, 63 * 8); // チーム1が奪還
  run(obj, 2, [0, 1]); // チーム1の進行を少し進める（pot1 < 1000）
  // 旧陣（チーム0）が単独で再確保 → 確保成立tickで敵関与0なので即勝利
  const ev = [];
  const ticks = runUntil(obj, [1, 0], o => o.roundWinner >= 0, 63 * 10, ev);
  assert.notEqual(ticks, -1);
  assert.equal(obj.roundWinner, 0);
  assert.equal(obj.owner, 0);
  const cap = ev.find(e => e.type === 'obj_captured');
  const win = ev.find(e => e.type === 'obj_round_win');
  assert.ok(cap && win, `events=${ev.map(e => e.type)}`);
  assert.equal(cap.t, win.t, '再確保と同tickで即勝利していない');
});

// ---------------------------------------------------------------- 11. §8 同時確保
test('§8 同時確保: 同tick両陣100pt→両方99ptへ差し戻し・拮抗継続', () => {
  const obj = makeObjective();
  // ラグ補償等の外部要因で同tickに両陣100ptへ到達した状態（仕様の想定どおり注入で再現）
  obj.gauge[0] = 100;
  obj.gauge[1] = 100;
  const ev = [];
  obj.tick(DT, [1, 1], ev);
  assert.deepEqual(obj.gauge, [99, 99], `gauge=${obj.gauge}`);
  assert.equal(obj.owner, -1, '同時確保でどちらかが占有した');
  assert.ok(ev.some(e => e.type === 'obj_simultaneous_setback'));
  assert.ok(!ev.some(e => e.type === 'obj_captured'));
  run(obj, 1.0, [1, 1]); // 拮抗継続（両99で凍結）
  assert.deepEqual(obj.gauge, [99, 99]);
  assert.equal(obj.owner, -1);
});

// ---------------------------------------------------------------- 12. §5/§8 有効関与
test('§5 無敵・非実体・死亡は人数に数えない（updateEffectivePresence）', () => {
  const players = [
    mkPlayer(0, [1, 0, 2.5]),                          // 通常 → 数える
    mkPlayer(0, [0, 2, 2.5], { invulnerable: true }),  // 完全無敵 → 数えない
    mkPlayer(1, [0, -2, 2.5], { intangible: true }),   // 非実体 → 数えない
    mkPlayer(1, [2, 2, 2.5], { alive: false }),        // 死亡 → 数えない
    mkPlayer(1, [-2, 0, 2.5]),                         // 通常 → 数える
    mkPlayer(1, [20, 0, 2.5]),                         // 圏外 → 数えない
  ];
  const presence = updateEffectivePresence(players, OBJ_AREA, MODE);
  assert.deepEqual(presence, [1, 1]);
  // 無敵はエリア在圏フラグ自体は維持（§5 UI: 「関与無効」表示のため）。死亡は在圏解除。
  assert.equal(players[1].insideObjective, true);
  assert.equal(players[3].insideObjective, false);
});

test('§8 QA必須: 延長中に敵全員が無敵化→猶予2.0/sで減少し終了', () => {
  const obj = makeOvertime(); // owner=0, 延長中
  const enemies = [
    mkPlayer(1, [1, 1, 2.5]),
    mkPlayer(1, [-1, 1, 2.5]),
  ];
  // まず実体の敵在圏で延長が維持されることを確認
  for (let i = 0; i < 63; i++) {
    obj.tick(DT, updateEffectivePresence(enemies, OBJ_AREA, MODE), []);
  }
  assert.equal(obj.ot.active, true);
  assert.ok(obj.ot.grace > 4.9, `grace=${obj.ot.grace}`);
  // 全員無敵化 → 有効関与0扱い → 猶予減少 → 終了
  for (const e of enemies) e.flags.invulnerable = true;
  let ticks = 0;
  while (obj.roundWinner < 0 && ticks < 63 * 5) {
    obj.tick(DT, updateEffectivePresence(enemies, OBJ_AREA, MODE), []);
    ticks++;
  }
  assert.equal(obj.roundWinner, 0, '無敵だけで延長を維持できてしまう');
  assert.ok(Math.abs(ticks * DT - 2.5) <= TICK_TOL, `終了まで${(ticks * DT).toFixed(4)}s（期待2.5s）`);
});

// ---------------------------------------------------------------- 13. §8 ヒステリシス
test('§8 ヒステリシス: 半径7.0で進入、7.2まで出た扱いにならない', () => {
  const pl = mkPlayer(0, [6.99, 0, 2.5]);
  assert.deepEqual(updateEffectivePresence([pl], OBJ_AREA, MODE), [1, 0], '7.0以内で進入');
  pl.move.pos[0] = 7.15; // 7.0超だが7.2以内 → まだ在圏
  assert.deepEqual(updateEffectivePresence([pl], OBJ_AREA, MODE), [1, 0], '7.2までは出た扱いにならない');
  pl.move.pos[0] = 7.21; // 7.2超 → 退出
  assert.deepEqual(updateEffectivePresence([pl], OBJ_AREA, MODE), [0, 0], '7.2超で退出');
  pl.move.pos[0] = 7.05; // 一度出たら7.0以内に戻るまで進入しない
  assert.deepEqual(updateEffectivePresence([pl], OBJ_AREA, MODE), [0, 0], '再進入には7.0以内が必要');
  pl.move.pos[0] = 6.95;
  assert.deepEqual(updateEffectivePresence([pl], OBJ_AREA, MODE), [1, 0], '7.0以内で再進入');
});

// ---------------------------------------------------------------- 14. §4/§8 480秒上限
test('§4 480秒上限: resolveByCap()で甕が高い側の勝利（0.1%差でも）', () => {
  const a = makeObjective();
  a.pot = [501, 500]; // 0.1%差
  a.resolveByCap();
  assert.equal(a.roundWinner, 0);
  assert.equal(a.suddenDeath, false);
  const b = makeObjective();
  b.pot = [500, 501];
  b.resolveByCap();
  assert.equal(b.roundWinner, 1);
});

test('§4/§8 完全同値→サドンデス→次の確保で勝利（復帰補正を開始から適用）', () => {
  const obj = makeObjective();
  obj.pot = [500, 500];
  obj.resolveByCap();
  assert.equal(obj.roundWinner, -1, '同値なのに勝敗が付いた');
  assert.equal(obj.suddenDeath, true);
  assert.equal(obj.respawnPenaltySec(), 3.0, 'サドンデス開始から延長リスポーン補正を適用');
  const ev = [];
  const ticks = runUntil(obj, [0, 1], o => o.roundWinner >= 0, 63 * 8, ev);
  assert.notEqual(ticks, -1, 'サドンデスが決着しない');
  assert.equal(obj.roundWinner, 1, '確保を成立させた陣が取得していない');
  const win = ev.find(e => e.type === 'obj_round_win');
  assert.equal(win.reason, 'sudden_death_capture');
});

test('§9 主要な目標状態遷移をイベント列だけから復元できる', () => {
  const obj = makeObjective();
  const events = [];

  obj.tick(DT, [1, 0], events);
  obj.tick(DT, [1, 1], events);
  obj.tick(DT, [1, 0], events);

  const transitions = events
    .filter(e => e.type === 'obj_state_transition')
    .map(e => [e.from, e.to]);
  assert.deepEqual(transitions, [
    ['neutral', 'capturing'],
    ['capturing', 'contested'],
    ['contested', 'capturing'],
  ]);
  for (const e of events.filter(e => e.type === 'obj_state_transition')) {
    assert.equal(typeof e.t, 'number');
    assert.deepEqual(e.presence.length, 2);
    assert.deepEqual(e.gauge.length, 2);
    assert.deepEqual(e.pot.length, 2);
  }
});

test('§9 480秒上限の決着も理由付きobj_round_winとして記録する', () => {
  const obj = makeObjective();
  obj.pot = [501, 500];
  const events = [];
  obj.resolveByCap(events);
  assert.equal(obj.roundWinner, 0);
  assert.deepEqual(events.find(e => e.type === 'obj_round_win'),
    { type: 'obj_round_win', t: 0, winner: 0, reason: 'time_cap' });
  assert.equal(events.some(e => e.type === 'obj_state_transition' && e.to === 'complete'), true);
});

test('§7 途中参加用スナップショットに復帰補正の起点と現在値を含む', () => {
  const obj = makeOvertime();
  const snap = obj.snapshot();
  assert.ok(snap.otPenaltyStartT >= 0);
  assert.equal(snap.respawnPenaltySec, MODE.overtime.respawnPenaltySec[0]);
});

test('§7 延長開始から30.0秒ちょうどで復帰補正は+6秒へ切り替わる', () => {
  const obj = makeOvertime();
  obj.otPenaltyStartT = 0;
  obj.time = 30;
  assert.equal(obj.respawnPenaltySec(), 6);
});

test('§8 サドンデスは既存占有者の甕進行では終わらず次の確保を待つ', () => {
  const obj = makeObjective();
  obj.owner = 0;
  obj.pot = [999, 999];
  obj.resolveByCap([]);
  assert.equal(obj.suddenDeath, true);
  const events = [];
  run(obj, 2, [0, 0], events);
  assert.equal(obj.roundWinner, -1);
  assert.equal(obj.pot[0], 999);
  assert.equal(events.some(event => event.type === 'obj_round_win'), false);
});

test('§7 奪還後に再び延長へ入ると復帰補正の30秒起点を更新する', () => {
  const obj = makeOvertime();
  const firstStart = obj.otPenaltyStartT;
  obj.gauge[1] = 100;
  obj.tick(DT, [0, 1], []);
  assert.equal(obj.ot.active, false);
  obj.time = firstStart + 40;
  obj.owner = 1;
  obj.pot[1] = 1000;
  obj.tick(DT, [1, 0], []);
  assert.equal(obj.ot.active, true);
  assert.ok(obj.otPenaltyStartT > firstStart + 30);
  assert.equal(obj.respawnPenaltySec(), 3);
});

// ---------------------------------------------------------------- 15. §8 甕の整数管理
test('§8 甕は0.1%刻み整数・単調増加・端数が失われない（83.33秒で1000）', () => {
  const obj = makeObjective();
  runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  const start = obj.pot[0]; // 確保tickでの進行ぶん（0または1）
  let prev = start;
  let ticks = 0;
  while (obj.pot[0] < 1000 && ticks < 63 * 90) {
    obj.tick(DT, [0, 0], []);
    ticks++;
    assert.ok(Number.isInteger(obj.pot[0]), `potが整数でない: ${obj.pot[0]}`);
    assert.ok(obj.pot[0] >= prev, `potが単調増加でない: ${prev}→${obj.pot[0]}`);
    prev = obj.pot[0];
  }
  assert.equal(obj.pot[0], 1000);
  // 1000(0.1%)/12(0.1%/s) × 63tick/s = 5250tick = 83.333...秒。端数ロスがあればずれる。
  const expected = Math.ceil(((1000 - start) / 12) * 63);
  assert.ok(Math.abs(ticks - expected) <= 2, `満了まで${ticks}tick（期待${expected}±2）`);
});
