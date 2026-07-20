// 移動・衝突・マップ配置の回帰テスト。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collider, rayCylinder } from '../shared/sim/collision.js';
import { makeMoveState, step } from '../shared/sim/movement.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { COMBAT, DT } from './helpers.js';

const MV = COMBAT.movement;

test('makeMoveState leaves grounding unvalidated until collision confirms a floor', () => {
  const st = makeMoveState([0, 0, 4], 0);

  assert.equal(st.grounded, false);
});

test('falling below the playfield stays airborne instead of inventing a floor at z=0', () => {
  const st = makeMoveState([0, 0, -4.9], 0);
  st.grounded = false;
  st.vel[2] = -20;

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, 0.1, new Collider([]), { ...MV, gravityMps2: 0 });

  assert.equal(st.pos[2], -6.9);
  assert.equal(st.vel[2], -20);
  assert.equal(st.grounded, false);
});

test('raycast の数値APIを保ったまま trace が最近接面の交点と法線を返す', () => {
  const collider = new Collider([
    { min: [4, -5, -5], max: [4.2, 5, 5], tag: 'far-wall' },
    { min: [2, -5, -5], max: [2.2, 5, 5], tag: 'near-wall' },
  ]);
  const direction = [Math.SQRT1_2, Math.SQRT1_2, 0];

  const distance = collider.raycast(0, -2, 1, ...direction, 20);
  const hit = collider.trace(0, -2, 1, ...direction, 20);

  assert.equal(typeof distance, 'number');
  assert.equal(distance, 2 / Math.SQRT1_2);
  assert.equal(hit.hit, true);
  assert.equal(hit.dist, distance);
  assert.deepEqual(hit.point, [2, 0, 1]);
  assert.deepEqual(hit.normal, [-1, 0, 0]);
  assert.equal(hit.solid.tag, 'near-wall');
  assert.equal(new Collider([]).raycast(0, 0, 0, 1, 0, 0, 5), Infinity);
});

test('raycast は極小距離差でも真の最近接面を選び maxDist 端点を従来どおり除外する', () => {
  const collider = new Collider([
    { min: [7, -1, -1], max: [8, 1, 1], tag: 'farther' },
    { min: [7.5, -1, -1], max: [8.0000000005, 1, 1], tag: 'nearer' },
  ]);

  assert.equal(collider.raycast(10, 0, 0, -1, 0, 0, 10), 1.9999999995);
  assert.equal(new Collider([{ min: [5, -1, -1], max: [6, 1, 1] }]).raycast(0, 0, 0, 1, 0, 0, 5), Infinity);
});

test('trace は床上面の交点と上向き法線を返す', () => {
  const collider = new Collider([{ min: [-5, -5, -1], max: [5, 5, 0], tag: 'floor' }]);

  const hit = collider.trace(0, 0, 2, 0, 0, -1, 10);

  assert.equal(hit.dist, 2);
  assert.deepEqual(hit.point, [0, 0, 0]);
  assert.deepEqual(hit.normal, [0, 0, 1]);
});

test('高速移動でも薄い壁を貫通せず手前で停止する', () => {
  const collider = new Collider([{ min: [1, -1, 0], max: [1.1, 1, 3] }]);

  const moved = collider.resolveAxis(0, 0, 0.4, 0, 1.7, 0, 2);

  assert.equal(moved, 0.6);
});

test('負方向の高速移動でも薄い壁を貫通せず手前で停止する', () => {
  const collider = new Collider([{ min: [-1.1, -1, 0], max: [-1, 1, 3] }]);

  const moved = collider.resolveAxis(0, 0, 0.4, 0, 1.7, 0, -2);

  assert.equal(moved, -0.6);
});

test('斜め高速移動はAABBの角をすり抜けず円柱の接触点で止まる', () => {
  const collider = new Collider([{ min: [1, 1, 0], max: [2, 2, 3] }]);

  const hit = collider.sweepCylinder(0, 0, 0.4, 0, 1.7, 2, 2);
  const contact = 1 - 0.4 / Math.sqrt(2);

  assert.equal(hit.hit, true);
  assert.ok(Math.abs(hit.position[0] - contact) < 1e-9, `${hit.position}`);
  assert.ok(Math.abs(hit.position[1] - contact) < 1e-9, `${hit.position}`);
});

test('斜め移動は壁に当たった軸だけを止めて壁沿いにスライドする', () => {
  const collider = new Collider([{ min: [1, -10, 0], max: [1.1, 10, 3] }]);

  const motion = collider.moveCylinder(0, 0, 0.4, 0, 1.7, 2, 2);

  assert.deepEqual(motion.position, [0.6, 2]);
  assert.deepEqual(motion.blocked, [true, false]);
  assert.ok(motion.iterations <= 4, `iterations=${motion.iterations}`);
});

test('CharacterControllerの斜め移動も単一AABBの角をすり抜けない', () => {
  const collider = new Collider([{ min: [1, 1, -1], max: [2, 2, 3] }]);
  const st = makeMoveState([0, 0, 0], 0);
  st.grounded = false;
  st.vel = [2, 2, 0];

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, 1, collider, { ...MV, gravityMps2: 0 });

  const contact = 1 - MV.capsuleRadiusM / Math.sqrt(2);
  assert.ok(Math.abs(st.pos[0] - contact) < 1e-9, `${st.pos}`);
  assert.ok(Math.abs(st.pos[1] - contact) < 1e-9, `${st.pos}`);
});

test('L字内角ではsolid配列順に依存せず両軸を停止する', () => {
  const walls = [
    { min: [1, -10, 0], max: [1.1, 10, 3] },
    { min: [-10, 1, 0], max: [10, 1.1, 3] },
  ];

  const hitNormals = [];
  for (const solids of [walls, [...walls].reverse()]) {
    const collider = new Collider(solids);
    hitNormals.push(collider.sweepCylinder(0, 0, 0.4, 0, 1.7, 2, 2).normal);
    const motion = collider.moveCylinder(0, 0, 0.4, 0, 1.7, 2, 2);
    assert.deepEqual(motion.position, [0.6, 0.6]);
    assert.deepEqual(motion.blocked, [true, true]);
    assert.ok(motion.iterations <= 4, `iterations=${motion.iterations}`);
  }
  assert.deepEqual(hitNormals[0], hitNormals[1]);
});

test('極端に大きい移動でも配列順ではなく最初の薄壁で停止する', () => {
  const collider = new Collider([
    { min: [1000, -1, 0], max: [1000.1, 1, 3] },
    { min: [1, -1, 0], max: [1.1, 1, 3] },
  ]);

  const motion = collider.moveCylinder(0, 0, 0.4, 0, 1.7, 1_000_000, 0);

  assert.deepEqual(motion.position, [0.6, 0]);
  assert.equal(motion.truncated, false);
});

test('初期めり込みは外向きに脱出できるが内向きには悪化させない', () => {
  const collider = new Collider([{ min: [1, -1, 0], max: [2, 1, 3] }]);

  const escape = collider.moveCylinder(0.8, 0, 0.4, 0, 1.7, -0.3, 0);
  const inward = collider.moveCylinder(0.8, 0, 0.4, 0, 1.7, 0.2, 0);

  assert.deepEqual(escape.position, [0.5, 0]);
  assert.deepEqual(inward.position, [0.8, 0]);
  assert.deepEqual(inward.blocked, [true, false]);
  assert.equal(collider.resolveAxis(0.8, 0, 0.4, 0, 1.7, 0, 1), 0.6);
});

test('上昇中に薄い天井へ当たると頭頂で停止して上向き速度を失う', () => {
  const collider = new Collider([{ min: [-1, -1, 2], max: [1, 1, 2.05] }]);
  const st = makeMoveState([0, 0, 0.25], 0);
  st.grounded = false;
  st.vel[2] = 7;

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, DT, collider, MV);

  assert.ok(Math.abs(st.pos[2] - 0.3) < 1e-9, `${st.pos}`);
  assert.equal(st.vel[2], 0);
  assert.equal(st.grounded, false);
  assert.equal(collider.overlapsCylinder(
    st.pos[0], st.pos[1], st.pos[2], MV.capsuleRadiusM, MV.standHeightM,
  ), false);
});

test('Z初期重複は1回で完全脱出できない微小移動を許可しない', () => {
  const collider = new Collider([{ min: [-1, -1, 1], max: [1, 1, 2] }]);

  const partial = collider.sweepVerticalCylinder(0, 0, 0.4, 0.8, 1.7, 0.1);
  const escape = collider.sweepVerticalCylinder(0, 0, 0.4, 0.8, 1.7, 1.2);

  assert.equal(partial.hit, true);
  assert.equal(partial.fraction, 0);
  assert.equal(partial.z, 0.8);
  assert.equal(escape.hit, false);
  assert.equal(escape.z, 2);
});

test('巨大な下降変位でも最初に横切る薄い床へ着地する', () => {
  const collider = new Collider([
    { min: [-1, -1, -0.1], max: [1, 1, 0] },
    { min: [-1, -1, 4.9], max: [1, 1, 5] },
  ]);
  const st = makeMoveState([0, 0, 10], 0);
  st.grounded = false;
  st.vel[2] = -100;

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, 1, collider, { ...MV, gravityMps2: 0 });

  assert.equal(st.pos[2], 5);
  assert.equal(st.vel[2], 0);
  assert.equal(st.grounded, true);
});

test('低い天井の下では立ち上がれず空間が空けば立てて再びしゃがめる', () => {
  const floor = { min: [-2, -2, -0.1], max: [2, 2, 0] };
  const ceiling = { min: [-2, -2, 1.3], max: [2, 2, 2] };
  const collider = new Collider([floor, ceiling]);
  const st = makeMoveState([0, 0, 0], 0);
  st.crouch = true;
  const input = {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  };

  step(st, input, DT, collider, MV);
  assert.equal(st.crouch, true);

  collider.solids = [floor];
  step(st, input, DT, collider, MV);
  assert.equal(st.crouch, false);

  step(st, { ...input, crouch: true }, DT, collider, MV);
  assert.equal(st.crouch, true);
});

test('接地中の下り段差スナップはstepDownM設定に従う', () => {
  const collider = new Collider([{ min: [-2, -2, -1], max: [2, 2, 0] }]);
  const st = makeMoveState([0, 0, 0.4], 0);
  st.grounded = true;

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, DT, collider, { ...MV, stepDownM: 0.5 });

  assert.equal(st.pos[2], 0);
  assert.equal(st.vel[2], 0);
  assert.equal(st.grounded, true);
});

test('有限のデッドゾーン適用済みアナログ移動を優先し斜め最大速度を正規化する', () => {
  const collider = new Collider([]);
  const config = { ...MV, gravityMps2: 0, airControlMult: 1 };
  const baseInput = {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  };

  const partial = makeMoveState([0, 0, 0], 0);
  partial.grounded = false;
  step(partial, { ...baseInput, f: true, moveX: 0.1, moveY: 0 }, 1, collider, config);
  assert.ok(Math.abs(partial.vel[0]) < 1e-9, `${partial.vel}`);
  assert.ok(Math.abs(partial.vel[1] + MV.baseSpeedMps * 0.1) < 1e-9, `${partial.vel}`);

  const analog = makeMoveState([0, 0, 0], 0);
  analog.grounded = false;
  step(analog, { ...baseInput, moveX: 1, moveY: 1 }, 1, collider, config);
  const component = MV.baseSpeedMps / Math.sqrt(2);
  assert.ok(Math.abs(analog.vel[0] - component) < 1e-9, `${analog.vel}`);
  assert.ok(Math.abs(analog.vel[1] + component) < 1e-9, `${analog.vel}`);

  const digital = makeMoveState([0, 0, 0], 0);
  digital.grounded = false;
  step(digital, { ...baseInput, f: true }, 1, collider, config);
  assert.deepEqual(digital.vel.slice(0, 2), [MV.baseSpeedMps, 0]);
});

test('立位の頭上空間がない段差には上らず手前で停止する', () => {
  const collider = new Collider([
    { min: [-4, -2, -1], max: [4, 2, 0] },
    { min: [1, -1, 0], max: [3, 1, 0.5] },
    { min: [1, -1, 1.8], max: [3, 1, 2] },
  ]);
  const st = makeMoveState([0, 0, 0], 0);
  st.vel[0] = 2;

  step(st, {
    f: false, b: false, l: false, r: false,
    jump: false, crouch: false, yaw: 0, pitch: 0,
  }, 1, collider, { ...MV, frictionMps2: 0, gravityMps2: 0 });

  assert.deepEqual(st.pos, [0.6, 0, 0]);
  assert.equal(st.vel[0], 0);
  assert.equal(st.grounded, true);
});

test('急角度レイは円柱の上面から入射して胴体へ命中する', () => {
  const n = Math.hypot(1, 3);
  const hit = rayCylinder(-1, 0, 4, 1 / n, 0, -3 / n, 0, 0, 0, 1.7, 0.4, 20);
  assert.ok(hit >= 0 && hit < 20, `上面ヒットが失われた: ${hit}`);
  assert.ok(Math.abs(hit - ((4 - 1.7) / (3 / n))) < 1e-9);
});

test('ソリッド内部から脱出方向へ水平移動できる', () => {
  const collider = new Collider([{ min: [-1, -1, 0], max: [1, 1, 2] }]);
  const moved = collider.resolveAxis(0, 0, 0.4, 0, 1.7, 0, -0.1);
  assert.equal(moved, -0.1);
});

test('降下中に橋の縁石内部へ着地して歩行不能にならない', () => {
  const collider = new Collider(buildMap().solids);
  const yaw = Math.PI / 2;
  const st = makeMoveState([35, -2.6, 4], yaw);
  for (let tick = 0; tick < 63 * 4; tick++) {
    step(st, {
      f: true, b: false, l: false, r: false,
      jump: tick === 26, crouch: false, yaw, pitch: 0,
    }, DT, collider, MV);
  }
  const embedded = st.grounded && Math.abs(st.pos[2] - 4) < 1e-9 && st.pos[1] > 2.7 && st.pos[1] < 3;
  assert.equal(embedded, false, `縁石内部へ着地した: ${st.pos}`);

  const before = [...st.pos];
  for (let tick = 0; tick < 63; tick++) {
    step(st, { f: false, b: true, l: false, r: false, jump: false, crouch: false, yaw, pitch: 0 }, DT, collider, MV);
  }
  assert.ok(Math.hypot(st.pos[0] - before[0], st.pos[1] - before[1]) > 0.5, '後退でも脱出できない');
});

test('回復灯珠は立ち位置を塞ぐソリッドの内部に配置しない', () => {
  const map = buildMap();
  const collider = new Collider(map.solids);
  for (const pickup of map.pickups) {
    assert.equal(
      collider.overlapsCylinder(pickup.pos[0], pickup.pos[1], pickup.pos[2], MV.capsuleRadiusM, MV.standHeightM),
      false,
      `${pickup.id} がソリッド内部にある: ${pickup.pos}`,
    );
  }
});
