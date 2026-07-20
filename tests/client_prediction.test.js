import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePredictionMovementConfig,
  resolveSnapshotGrounded,
  resolveSnapshotMoveSpeedMultiplier,
  retirePendingInputs,
} from '../client/prediction.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { World } from '../shared/sim/sim.js';
import { COMBAT, MODE } from './helpers.js';

test('prediction drops both applied ACKs and explicitly retired input', () => {
  const pending = [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }];
  assert.deepEqual(retirePendingInputs(pending, { ack: 1, retired: 3 }), [{ seq: 4 }]);
  assert.deepEqual(retirePendingInputs(pending, { ack: 2 }), [{ seq: 3 }, { seq: 4 }]);
  assert.deepEqual(pending, [{ seq: 1 }, { seq: 2 }, { seq: 3 }, { seq: 4 }]);
});

test('snapshotのgrounded booleanは位置推定より優先する', () => {
  let fallbackCalls = 0;
  const infer = () => {
    fallbackCalls++;
    return true;
  };

  assert.equal(resolveSnapshotGrounded({ grounded: false }, infer), false);
  assert.equal(resolveSnapshotGrounded({ grounded: true }, infer), true);
  assert.equal(fallbackCalls, 0);
});

test('古いsnapshotにgroundedが無い場合は既存推定へfallbackする', () => {
  const player = { pos: [1, 2, 3], vel: [4, 5, 6] };
  let received = null;
  const grounded = resolveSnapshotGrounded(player, (pos, vel) => {
    received = { pos, vel };
    return true;
  });

  assert.equal(grounded, true);
  assert.deepEqual(received, { pos: player.pos, vel: player.vel });
});

test('snapshotの移動倍率は有限値だけを採用し、サーバーと同じ範囲へclampする', () => {
  assert.equal(resolveSnapshotMoveSpeedMultiplier({ moveSpeedMultiplier: 0.8 }), 0.8);
  assert.equal(resolveSnapshotMoveSpeedMultiplier({ moveSpeedMultiplier: 0.1 }), 0.35);
  assert.equal(resolveSnapshotMoveSpeedMultiplier({ moveSpeedMultiplier: 2 }), 1.75);

  for (const value of [undefined, null, Number.NaN, Infinity, -Infinity, '0.8']) {
    assert.equal(resolveSnapshotMoveSpeedMultiplier({ moveSpeedMultiplier: value }), 1);
  }
});

test('予測用movement設定は基準値を変更せずsnapshot倍率を一度だけ反映する', () => {
  const movement = { baseSpeedMps: 6, groundAccel: 30 };
  const scaled = resolvePredictionMovementConfig(movement, { moveSpeedMultiplier: 0.75 });

  assert.deepEqual(scaled, { baseSpeedMps: 4.5, groundAccel: 30 });
  assert.notStrictEqual(scaled, movement);
  assert.equal(movement.baseSpeedMps, 6);
  assert.strictEqual(resolvePredictionMovementConfig(movement, {}), movement);
});

test('World snapshotはheroとstatusを合成した権威移動倍率を公開する', () => {
  const world = new World(buildMap(), structuredClone(MODE), structuredClone(COMBAT), 17);
  const player = world.addPlayer('slow frontline', false, 0, 'baraga');
  player.abilities.statuses.push({ id: 'test-slow', moveSpeedMult: 0.5, expiresAt: 10 });

  const snapshotPlayer = world.snapshot().players.find(candidate => candidate.id === player.id);
  assert.equal(snapshotPlayer.moveSpeedMultiplier, 0.47);
});
