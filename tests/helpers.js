// テスト共通ヘルパー。dt=1/63 の離散駆動と凍結データの読み込み。
// 仕様の唯一の正: docs/mode_shioura_rules_v0.2_FROZEN.md
import { readFileSync } from 'node:fs';
import { ShiouraObjective } from '../shared/sim/objective.js';

export const DT = 1 / 63;
export const TICK_TOL = 2 * DT; // 離散化許容誤差（±2tick）

export const MODE = JSON.parse(readFileSync(new URL('../shared/data/mode_shioura.json', import.meta.url), 'utf8'));
export const COMBAT = JSON.parse(readFileSync(new URL('../shared/data/combat.json', import.meta.url), 'utf8'));

// 開放済み（unseal済み）のShiouraObjectiveを作る
export function makeObjective(mode = MODE) {
  const obj = new ShiouraObjective(mode);
  obj.unseal();
  return obj;
}

// seconds秒ぶん固定presenceでtickを回す
export function run(obj, seconds, presence, events = []) {
  const n = Math.round(seconds / DT);
  for (let i = 0; i < n; i++) obj.tick(DT, presence, events);
  return events;
}

// 条件成立までtickを回し、要したtick数を返す（不成立なら-1）
export function runUntil(obj, presence, pred, maxTicks, events = []) {
  for (let i = 1; i <= maxTicks; i++) {
    obj.tick(DT, presence, events);
    if (pred(obj)) return i;
  }
  return -1;
}

// §7 延長状態のセットアップ。
// 注意: 自然なtick駆動では「甕100%到達tickで敵有効関与≥1」は到達不能
// （§3の進行停止が同一tick・同一presenceで評価されるため甕が99.9%で凍結する）。
// ここでは「到達した」状態を直接注入して§7の力学を単体検証する。
export function makeOvertime() {
  const obj = makeObjective();
  const t = runUntil(obj, [1, 0], o => o.owner === 0, 63 * 8);
  if (t < 0) throw new Error('setup: capture failed');
  obj.pot[0] = 1000;
  obj.potFrac[0] = 0;
  const ev = [];
  obj.tick(DT, [0, 1], ev); // 敵有効関与≥1のtickで100%到達 → 延長開始
  if (!obj.ot.active) throw new Error('setup: overtime did not start');
  return obj;
}

// updateEffectivePresence用の簡易プレイヤー
export function mkPlayer(team, pos, flags = {}) {
  return {
    team,
    alive: flags.alive !== undefined ? flags.alive : true,
    flags: { invulnerable: !!flags.invulnerable, intangible: !!flags.intangible },
    move: { pos: [...pos] },
    insideObjective: false,
  };
}

export const OBJ_AREA = { center: [0, 0, 2.5] }; // map_oshioi.js の objective.center と同値
