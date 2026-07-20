// 戦闘系 単体テスト（combat.json 凍結値: 訓練灯銃）
// damageAtRange / tryBeginFire / hitscan
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  damageAtRange, tryBeginFire, tickWeaponState, hitscan, makeWeaponState,
  weaponMuzzlePosition,
} from '../shared/sim/combat.js';
import { Collider } from '../shared/sim/collision.js';
import { COMBAT } from './helpers.js';

const W = COMBAT.trainingWeapon; // damage 11, HS×1.5, rps 10, mag 25, reload 1.6s, falloff 20→40m ×0.6
const MV = COMBAT.movement;
const HEAD = COMBAT.headHitbox;
const EPS = 1e-9;

function closeTo(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, `${msg}: actual=${actual} expected=${expected}`);
}

test('weapon muzzle offset has a shared default and supports per-weapon overrides', () => {
  assert.deepEqual(weaponMuzzlePosition([1, 2, 3], 0, 0), [1.8, 2, 2.85]);
  assert.deepEqual(
    weaponMuzzlePosition([1, 2, 3], Math.PI / 2, 0, { muzzleForwardM: 0.5, muzzleDropM: 0.1 }),
    [1, 2.5, 2.9],
  );
});

// ---------------------------------------------------------------- 18. 距離減衰
test('距離減衰: 20m以内は11フル、40mで6.6（×0.6）、中間は線形', () => {
  closeTo(damageAtRange(W, 5, false), 11, EPS, '5m');
  closeTo(damageAtRange(W, 20, false), 11, EPS, '20m（減衰開始点はフル）');
  closeTo(damageAtRange(W, 30, false), 8.8, EPS, '30m（中間: ×0.8）');
  closeTo(damageAtRange(W, 40, false), 6.6, EPS, '40m（×0.6）');
  closeTo(damageAtRange(W, 60, false), 6.6, EPS, '40m超は下限×0.6で頭打ち');
});

test('ヘッドショットは1.5倍（減衰後に乗算）', () => {
  closeTo(damageAtRange(W, 10, true), 16.5, EPS, '10m HS');
  closeTo(damageAtRange(W, 40, true), 9.9, EPS, '40m HS（6.6×1.5）');
  closeTo(damageAtRange(W, 30, true), 13.2, EPS, '30m HS（8.8×1.5）');
});

// ---------------------------------------------------------------- 19. 連射・マガジン・リロード
test('連射間隔: rps=10 → 0.1秒間隔でのみ発射可', () => {
  const pl = { weapon: makeWeaponState(W) };
  assert.equal(tryBeginFire(pl, W, 0, false), true, '初弾');
  assert.equal(pl.weapon.ammo, 24);
  assert.equal(tryBeginFire(pl, W, 0.05, false), false, '間隔未満は不可');
  assert.equal(tryBeginFire(pl, W, 0.099, false), false);
  assert.equal(tryBeginFire(pl, W, 0.1, false), true, '0.1秒後は可');
  assert.equal(pl.weapon.ammo, 23);
});

test('マガジン25発 → 撃ち切りで自動リロード1.6秒', () => {
  const pl = { weapon: makeWeaponState(W) };
  let t = 0;
  let fired = 0;
  for (let i = 0; i < 25; i++) {
    assert.equal(tryBeginFire(pl, W, t, false), true, `${i + 1}発目`);
    fired++;
    t += 0.1;
  }
  assert.equal(fired, 25);
  assert.equal(pl.weapon.ammo, 0);
  // 26発目の試行 → リロード開始、発射不可
  const tEmpty = t;
  assert.equal(tryBeginFire(pl, W, tEmpty, false), false, '弾切れ時は発射不可（リロード開始）');
  assert.equal(tryBeginFire(pl, W, tEmpty + 1.59, false), false, 'リロード中は発射不可');
  assert.equal(tryBeginFire(pl, W, tEmpty + 1.6, false), true, 'リロード1.6秒完了後は発射可');
  assert.equal(pl.weapon.ammo, W.magSize - 1, 'リロードで満タン→1発消費');
});

test('手動リロード: 残弾ありでも1.6秒で満タン', () => {
  const pl = { weapon: makeWeaponState(W) };
  tryBeginFire(pl, W, 0, false); // 1発消費 → 24
  assert.equal(tryBeginFire(pl, W, 0.2, true), false, 'リロード要求時は発射しない');
  assert.equal(tryBeginFire(pl, W, 1.7, false), false, 'リロード完了（0.2+1.6=1.8）前は不可');
  assert.equal(tryBeginFire(pl, W, 1.8, false), true);
  assert.equal(pl.weapon.ammo, W.magSize - 1);
});

test('reload retains ammo until the deterministic completion tick, then refills exactly once', () => {
  const pl = { weapon: makeWeaponState(W) };
  tryBeginFire(pl, W, 0, false);
  assert.equal(pl.weapon.ammo, W.magSize - 1);
  assert.equal(tryBeginFire(pl, W, 0.2, true), false);
  assert.equal(pl.weapon.ammo, W.magSize - 1, 'manual reload must not refill early');
  tickWeaponState(pl, W, 1.799999);
  assert.equal(pl.weapon.ammo, W.magSize - 1);
  tickWeaponState(pl, W, 1.8);
  assert.equal(pl.weapon.ammo, W.magSize);
  assert.equal(pl.weapon.reloadUntil, 0);
  tickWeaponState(pl, W, 2.0);
  assert.equal(pl.weapon.ammo, W.magSize, 'completion is idempotent');
});

// ---------------------------------------------------------------- 20. ヒットスキャン
const targetAt10 = { id: 't1', team: 1, pos: [10, 0, 0], crouch: false };

test('hitscan: 遮蔽AABBの背後のターゲットには当たらない', () => {
  // x=4〜5に全高の壁。射手(0,0,眼1.6)→+x方向のターゲット(10,0)
  const wall = { min: [4, -2, 0], max: [5, 2, 3], tag: 'cover' };
  const collider = new Collider([wall]);
  const hit = hitscan(collider, MV, HEAD, [0, 0, 1.6], [1, 0, 0], W.maxRangeM, [targetAt10], 's1', 0);
  assert.equal(hit.type, 'world', '壁の背後に当たっている');
  closeTo(hit.dist, 4, 1e-6, '壁までの距離');
});

test('hitscan: 遮蔽がなければ胴体円柱にヒット（headshot=false）', () => {
  const collider = new Collider([]);
  // z=1.0の水平レイ: 頭部球(中心z=1.65, r=0.25)は外れ、胴体(r=0.4, z0〜1.7)に当たる
  const hit = hitscan(collider, MV, HEAD, [0, 0, 1.0], [1, 0, 0], W.maxRangeM, [targetAt10], 's1', 0);
  assert.equal(hit.type, 'player');
  assert.equal(hit.target.id, 't1');
  assert.equal(hit.headshot, false);
  closeTo(hit.dist, 10 - MV.capsuleRadiusM, 1e-6, '胴体表面まで');
});

test('hitscan: 頭部球が最初のヒットなら headshot=true', () => {
  const collider = new Collider([]);
  // 胴体上端(1.7m)より高い水平レイは頭部球だけへ入る。
  const hit = hitscan(collider, MV, HEAD, [0, 0, 1.82], [1, 0, 0], W.maxRangeM, [targetAt10], 's1', 0);
  assert.equal(hit.type, 'player');
  assert.equal(hit.headshot, true);
});

test('hitscan: 頭部球より先に胴体へ入るレイは body hit になる', () => {
  const collider = new Collider([]);
  // z=1.65 は頭部球と胴体円柱が重なる。半径0.4の胴体が半径0.25の頭より先に当たる。
  const hit = hitscan(collider, MV, HEAD, [0, 0, 1.65], [1, 0, 0], W.maxRangeM, [targetAt10], 's1', 0);
  assert.equal(hit.type, 'player');
  assert.equal(hit.headshot, false);
  closeTo(hit.dist, 10 - MV.capsuleRadiusM, 1e-6, '先に交差する胴体表面まで');
});

test('projectile半径はplayerの胴体と頭部のTOIを半径分膨張する', () => {
  const collider = new Collider([]);
  const offsetTarget = { id: 't-radius', team: 1, pos: [3, 0.7, 0], crouch: false };
  const body = hitscan(
    collider, MV, HEAD, [0, 0, 1], [1, 0, 0], 10,
    [offsetTarget], 's1', 0, 'enemy', 0.35,
  );
  assert.equal(body.type, 'player');
  assert.equal(body.headshot, false);

  const headOnlyTarget = { id: 't-head-radius', team: 1, pos: [3, 0.15, 0], crouch: false };
  const head = hitscan(
    collider, MV, HEAD, [0, 0, 2.05], [1, 0, 0], 10,
    [headOnlyTarget], 's1', 0, 'enemy', 0.2,
  );
  assert.equal(head.type, 'player');
  assert.equal(head.headshot, true);
});

test('projectile sphere misses the rounded body rim outside the true radius', () => {
  const collider = new Collider([]);
  const target = { id: 'rounded-rim', team: 1, pos: [3, 0, 0], crouch: false };
  const hit = hitscan(
    collider, MV, HEAD, [0, 0.55, 1.85], [1, 0, 0], 10,
    [target], 's1', 0, 'enemy', 0.2,
  );
  assert.equal(hit.type, 'none');
});

test('positive-radius player sweeps report initial body and head overlap at TOI zero', () => {
  const collider = new Collider([]);
  const bodyTarget = { id: 'body-overlap', team: 1, pos: [0, 0, 0], crouch: false };
  const body = hitscan(
    collider, MV, HEAD, [0.5, 0, 1], [1, 0, 0], 10,
    [bodyTarget], 's1', 0, 'enemy', 0.2,
  );
  assert.equal(body.type, 'player');
  assert.equal(body.headshot, false);
  assert.equal(body.dist, 0);

  const headTarget = { id: 'head-overlap', team: 1, pos: [0, 0, 0], crouch: false };
  const head = hitscan(
    collider, MV, HEAD, [0, 0.3, 1.95], [0, 0, 1], 10,
    [headTarget], 's1', 0, 'enemy', 0.2,
  );
  assert.equal(head.type, 'player');
  assert.equal(head.headshot, true);
  assert.equal(head.dist, 0);
});

test('hitscan: 味方と自分自身には当たらない', () => {
  const collider = new Collider([]);
  const ally = { id: 't2', team: 0, pos: [10, 0, 0], crouch: false };
  const self = { id: 's1', team: 0, pos: [5, 0, 0], crouch: false };
  const hit = hitscan(collider, MV, HEAD, [0, 0, 1.0], [1, 0, 0], W.maxRangeM, [ally, self], 's1', 0);
  assert.equal(hit.type, 'none');
});
