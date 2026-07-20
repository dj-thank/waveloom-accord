import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Collider } from '../shared/sim/collision.js';
import {
  DEFAULT_DEPLOYABLE_HEIGHT_M,
  LINE_OF_SIGHT_EPSILON_M,
  canAffectTarget,
  distanceToSegment3D,
  hasLineOfSight,
  playerTargetPoint,
} from '../shared/sim/spatial_query.js';
import { COMBAT } from './helpers.js';

test('line of sight は線分内部の solid だけを遮蔽として扱う', () => {
  const wall = { min: [4, -1, 0], max: [5, 1, 3], tag: 'cover' };
  const origin = [0, 0, 1];
  const target = [10, 0, 1];

  assert.equal(hasLineOfSight(new Collider([]), origin, target), true);
  assert.equal(hasLineOfSight(new Collider([wall]), origin, target), false);
});

test('line of sight の epsilon は始点・終点に接する面を自己遮蔽から除外する', () => {
  const epsilon = LINE_OF_SIGHT_EPSILON_M;
  const origin = [0, 0, 1];
  const target = [10, 0, 1];
  const touchingOrigin = { min: [-1, -1, 0], max: [epsilon / 2, 1, 2], tag: 'origin-surface' };
  const touchingTarget = { min: [10 - epsilon / 2, -1, 0], max: [11, 1, 2], tag: 'target-surface' };

  assert.equal(hasLineOfSight(new Collider([touchingOrigin]), origin, target), true);
  assert.equal(hasLineOfSight(new Collider([touchingTarget]), origin, target), true);
});

test('player target point は足元ではなく立ち・しゃがみ胴体中央の3D点になる', () => {
  const standing = { move: { pos: [3, 4, 8], crouch: false } };
  const crouching = { move: { pos: [3, 4, 8], crouch: true } };

  assert.deepEqual(playerTargetPoint(standing, COMBAT.movement), [3, 4, 8 + COMBAT.movement.standHeightM / 2]);
  assert.deepEqual(playerTargetPoint(crouching, COMBAT.movement), [3, 4, 8 + COMBAT.movement.crouchHeightM / 2]);
});

test('effect range measures to the same standing body-center point used by LOS', () => {
  const world = { collider: new Collider([]), mv: COMBAT.movement };
  const target = { id: 'target', move: { pos: [0, 0.8, 0], crouch: false } };

  assert.equal(canAffectTarget(world, [0, 0, 1.6], target, { rangeM: 1.5 }), true);
});

test('effect range follows the standing or crouching body-center height', () => {
  const world = { collider: new Collider([]), mv: COMBAT.movement };
  const target = { id: 'target', move: { pos: [0, 1.2, 0], crouch: false } };

  assert.equal(canAffectTarget(world, [0, 0, 1.6], target, { rangeM: 1.5 }), true);
  target.move.crouch = true;
  assert.equal(canAffectTarget(world, [0, 0, 1.6], target, { rangeM: 1.5 }), false);
});

test('effect range is symmetric across floors and includes the radius boundary', () => {
  const world = { collider: new Collider([]), mv: COMBAT.movement };
  const lower = { id: 'lower', move: { pos: [0, 0, 0], crouch: false } };
  const upper = { id: 'upper', move: { pos: [0, 0, 4], crouch: false } };
  const origin = [0, 0, 2.85];

  assert.equal(canAffectTarget(world, origin, lower, { rangeM: 2 }), true);
  assert.equal(canAffectTarget(world, origin, upper, { rangeM: 2 }), true);
  assert.equal(canAffectTarget(world, origin, lower, {
    rangeM: 2 - LINE_OF_SIGHT_EPSILON_M * 2,
  }), false);
  assert.equal(canAffectTarget(world, origin, upper, {
    rangeM: 2 - LINE_OF_SIGHT_EPSILON_M * 2,
  }), false);
});

test('effect range applies the shared epsilon only at the radius boundary', () => {
  const world = { collider: new Collider([]), mv: COMBAT.movement };
  const target = { id: 'target', move: { pos: [1.5, 0, 0], crouch: false } };
  const origin = [0, 0, COMBAT.movement.standHeightM / 2];

  assert.equal(canAffectTarget(world, origin, target, { rangeM: 1.5 }), true);
  target.move.pos[0] += LINE_OF_SIGHT_EPSILON_M / 2;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 1.5 }), true);
  target.move.pos[0] += LINE_OF_SIGHT_EPSILON_M * 2;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 1.5 }), false);
});

test('effect query は3D射程・LOS・明示的opt-outを同じ契約で評価する', () => {
  const wall = { min: [1, -1, 0], max: [1.2, 1, 3], tag: 'cover' };
  const world = { collider: new Collider([wall]), mv: COMBAT.movement };
  const blocked = { id: 'blocked', move: { pos: [2, 0, 0], crouch: false } };
  const upperFloor = { id: 'upper', move: { pos: [0, 0, 4], crouch: false } };

  assert.equal(canAffectTarget(world, [0, 0, 0], blocked, { rangeM: 3 }), false);
  assert.equal(canAffectTarget(world, [0, 0, 0], blocked, { rangeM: 3, ignoreLineOfSight: true }), true);
  assert.equal(canAffectTarget(world, [0, 0, 0], blocked, { rangeM: 3, sourceId: blocked.id }), true);
  assert.equal(canAffectTarget(world, [0, 0, 0], upperFloor, { rangeM: 3, ignoreLineOfSight: true }), false);
});

test('barrier は爆発・半径能力の共通LOSを遮り friendlyPass と opt-out を保つ', () => {
  const source = { id: 'source', team: 0, move: { pos: [0, 0, 0], crouch: false } };
  const target = { id: 'target', team: 1, move: { pos: [4, 0, 0], crouch: false } };
  const barrier = {
    id: 'cover', team: 1, center: [2, 0, 0], radiusM: 0.4, heightM: 3,
    hp: 300, friendlyPass: true,
  };
  const world = {
    collider: new Collider([]), mv: COMBAT.movement,
    players: new Map([[source.id, source], [target.id, target]]), barriers: [barrier],
  };
  const origin = playerTargetPoint(source, COMBAT.movement);

  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), false);
  barrier.team = source.team;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), true);
  barrier.friendlyPass = false;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), false);
  assert.equal(canAffectTarget(world, origin, target, {
    rangeM: 5, sourceId: source.id, ignoreLineOfSight: true,
  }), true);
});

test('barrier LOS は有限高さと線分両端epsilonを守り自己接触を遮蔽にしない', () => {
  const world = {
    collider: new Collider([]),
    barriers: [{
      id: 'cover', team: 1, center: [2, 0, 0], radiusM: 0.4, heightM: 3,
      hp: 300, friendlyPass: true,
    }],
  };

  assert.equal(hasLineOfSight(world, [0, 0, 100], [4, 0, 100]), true);
  world.barriers[0].center = [-0.4 + LINE_OF_SIGHT_EPSILON_M / 2, 0, 0];
  assert.equal(hasLineOfSight(world, [0, 0, 1], [4, 0, 1]), true);
  world.barriers[0].center = [4.4 - LINE_OF_SIGHT_EPSILON_M / 2, 0, 0];
  assert.equal(hasLineOfSight(world, [0, 0, 1], [4, 0, 1]), true);
});

test('enemy deployable with hp blocks the shared effect LOS', () => {
  const source = { id: 'source', team: 0, move: { pos: [0, 0, 0], crouch: false } };
  const target = { id: 'target', team: 1, move: { pos: [4, 0, 0], crouch: false } };
  const world = {
    collider: new Collider([]), mv: COMBAT.movement,
    players: new Map([[source.id, source], [target.id, target]]),
    barriers: [],
    zones: [{
      id: 'deployable-cover', team: target.team, center: [2, 0, 0],
      radiusM: 4, hp: 60,
    }],
  };

  assert.equal(canAffectTarget(
    world, playerTargetPoint(source, world.mv), target,
    { rangeM: 5, sourceId: source.id },
  ), false);
});

test('deployable LOS uses the default physical radius when effect radius is tiny', () => {
  const world = {
    collider: new Collider([]),
    zones: [{
      id: 'tiny-effect-deployable', team: 1, center: [2, 0.5, 0],
      radiusM: 0.2, hp: 60,
    }],
  };

  assert.equal(hasLineOfSight(
    world,
    [0, 0, 0.6],
    [4, 0, 0.6],
    LINE_OF_SIGHT_EPSILON_M,
    { sourceTeam: 0 },
  ), false);
});

test('deployable LOS passes friendly, destroyed, finite-height, and explicit opt-out cases', () => {
  const source = { id: 'source', team: 0, move: { pos: [0, 0, 0], crouch: false } };
  const target = { id: 'target', team: 1, move: { pos: [4, 0, 0], crouch: false } };
  const deployable = {
    id: 'deployable-cover', team: source.team, center: [2, 0, 0],
    radiusM: 4, hitRadiusM: 0.65, hp: 60,
  };
  const world = {
    collider: new Collider([]), mv: COMBAT.movement,
    players: new Map([[source.id, source], [target.id, target]]),
    barriers: [], zones: [deployable],
  };
  const origin = playerTargetPoint(source, world.mv);

  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), true);
  deployable.team = target.team;
  deployable.hp = 0;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), true);
  deployable.hp = 60;
  assert.equal(hasLineOfSight(
    world,
    [0, 0, DEFAULT_DEPLOYABLE_HEIGHT_M + 10],
    [4, 0, DEFAULT_DEPLOYABLE_HEIGHT_M + 10],
    LINE_OF_SIGHT_EPSILON_M,
    { sourceTeam: source.team },
  ), true);
  deployable.blocksLineOfSight = false;
  assert.equal(canAffectTarget(world, origin, target, { rangeM: 5, sourceId: source.id }), true);
});

test('segment query は上下階を混同しない3D最短距離を返す', () => {
  assert.equal(distanceToSegment3D([5, 0, 3], [0, 0, 0], [10, 0, 0]), 3);
});
