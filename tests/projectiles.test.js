import { test } from 'node:test';
import assert from 'node:assert/strict';
import { barrierHit, deployableHit, snapshotBarrier, snapshotZone } from '../shared/sim/abilities.js';
import { Collider } from '../shared/sim/collision.js';
import { spawnWeaponProjectile, tickProjectiles } from '../shared/sim/projectiles.js';
import { COMBAT } from './helpers.js';

function projectileWorld(solids) {
  const owner = {
    id: 'owner', team: 0, heroId: 'tsubakuro', alive: true,
    flags: { invulnerable: false, intangible: false },
    move: { pos: [-100, -100, -100], crouch: false },
    abilities: { heroState: { blades: [] }, statuses: [] },
  };
  return {
    nextEffectId: 1, t: 0,
    projectiles: [], barriers: [], zones: [], events: [],
    players: new Map([[owner.id, owner]]),
    collider: new Collider(solids), mv: COMBAT.movement, combat: COMBAT,
  };
}

const RICOCHET_WEAPON = {
  id: 'test-ricochet', type: 'ricochet_projectile', projectileSpeedMps: 40,
  maxRangeM: 30, damage: 28, headshotMult: 1, falloffStartM: 30, falloffEndM: 31,
};

test('projectile field speed effect uses 3D distance instead of the XY projection', () => {
  const world = projectileWorld([]);
  world.zones.push({
    id: 'field', team: 1, center: [0, 0, 0], radiusM: 4,
    projectileSpeedMult: 0.5, allyProjectileSpeedMult: null,
  });
  const projectile = spawnWeaponProjectile(
    world, world.players.get('owner'), RICOCHET_WEAPON, [0, 0, 100], [1, 0, 0],
  );

  tickProjectiles(world, 0.1);

  assert.ok(Math.abs(projectile.pos[0] - 4) < 1e-9, `${projectile.pos}`);
});

test('projectile field speed effect does not cross world solid LOS', () => {
  const world = projectileWorld([{ min: [0.8, -1, 0], max: [1.2, 1, 3], tag: 'cover' }]);
  world.zones.push({
    id: 'field', team: 1, center: [0, 0, 1], radiusM: 4,
    projectileSpeedMult: 0.5, allyProjectileSpeedMult: null,
  });
  const projectile = spawnWeaponProjectile(
    world, world.players.get('owner'), RICOCHET_WEAPON, [2, 0, 1], [1, 0, 0],
  );

  tickProjectiles(world, 0.05);

  assert.ok(Math.abs(projectile.pos[0] - 4) < 1e-9, `${projectile.pos}`);
});

test('projectile field speed effect does not cross enemy barrier LOS', () => {
  const world = projectileWorld([]);
  world.zones.push({
    id: 'field', team: 1, center: [0, 0, 1], radiusM: 4,
    projectileSpeedMult: 0.5, allyProjectileSpeedMult: null,
  });
  world.barriers.push({
    id: 'cover', team: 0, center: [1, 0, 0], radiusM: 0.3, heightM: 3,
    hp: 300, friendlyPass: true,
  });
  const projectile = spawnWeaponProjectile(
    world, world.players.get('owner'), RICOCHET_WEAPON, [2, 0, 1], [1, 0, 0],
  );

  tickProjectiles(world, 0.05);

  assert.ok(Math.abs(projectile.pos[0] - 4) < 1e-9, `${projectile.pos}`);
});

test('projectile field entry is invariant to dt partitioning', () => {
  const simulate = dts => {
    const world = projectileWorld([]);
    world.zones.push({
      id: 'field', team: 1, center: [5, 0, 1], radiusM: 2,
      projectileSpeedMult: 0.5, allyProjectileSpeedMult: null,
    });
    const projectile = spawnWeaponProjectile(
      world, world.players.get('owner'),
      { ...RICOCHET_WEAPON, type: 'projectile', projectileSpeedMps: 10, maxRangeM: 100 },
      [0, 0, 1], [1, 0, 0],
    );
    for (const dt of dts) tickProjectiles(world, dt);
    return projectile.pos;
  };

  const single = simulate([1]);
  const split = simulate(Array(10).fill(0.1));
  assert.ok(Math.abs(single[0] - 6.5) < 1e-8, `${single}`);
  assert.ok(Math.abs(split[0] - 6.5) < 1e-8, `${split}`);
  assert.deepEqual(single, split);

  const throughSingle = simulate([2]);
  const throughSplit = simulate(Array(20).fill(0.1));
  assert.ok(Math.abs(throughSingle[0] - 16) < 1e-8, `${throughSingle}`);
  assert.ok(Math.abs(throughSplit[0] - 16) < 1e-8, `${throughSplit}`);
  assert.ok(Math.abs(throughSingle[0] - throughSplit[0]) < 1e-8);
});

test('same-boundary projectile fields keep deterministic partition results with LOS filtering', () => {
  const simulate = (dts, reverse) => {
    const world = projectileWorld([{
      min: [-100, -100, 5], max: [100, 100, 5.2], tag: 'field-los-cover',
    }]);
    const fields = [
      { id: 'visible-a', center: [5, 0, 1], projectileSpeedMult: 0.5 },
      { id: 'visible-b', center: [5, 0, 1], projectileSpeedMult: 0.8 },
      { id: 'blocked', center: [5, 0, 10], projectileSpeedMult: 0.1 },
    ].map(field => ({
      ...field, team: 1, radiusM: field.id === 'blocked' ? Math.sqrt(85) : 2,
      allyProjectileSpeedMult: null,
    }));
    world.zones.push(...(reverse ? fields.reverse() : fields));
    const projectile = spawnWeaponProjectile(
      world, world.players.get('owner'),
      { ...RICOCHET_WEAPON, type: 'projectile', projectileSpeedMps: 10, maxRangeM: 100 },
      [0, 0, 1], [1, 0, 0],
    );
    for (const dt of dts) tickProjectiles(world, dt);
    return projectile.pos;
  };

  const single = simulate([1], false);
  const split = simulate(Array(10).fill(0.1), false);
  const reversed = simulate([1], true);
  assert.ok(Math.abs(single[0] - 5.8) < 1e-8, `${single}`);
  assert.ok(Math.abs(single[0] - split[0]) < 1e-8, `${single} != ${split}`);
  assert.ok(Math.abs(single[0] - reversed[0]) < 1e-8, `${single} != ${reversed}`);
});

test('barrier の有限高さより上を通る射線は遮られない', () => {
  const barrier = {
    id: 'barrier', team: 1, center: [5, 0, 0], radiusM: 2, heightM: 3,
    hp: 300, maxHp: 300, expiresAt: 10, friendlyPass: true,
  };
  const world = { barriers: [barrier] };

  assert.equal(barrierHit(world, [0, 0, 100], [1, 0, 0], 10, 0), null);
  assert.equal(barrierHit(world, [0, 0, -1], [1, 0, 0], 10, 0), null);
  assert.equal(barrierHit(world, [5, 0, 100], [0, 0, -1], 200, 0), null, '上方開放の面にはcapを作らない');
  assert.equal(barrierHit(world, [0, 0, 1], [1, 0, 0], 10, 0)?.barrier, barrier);
  barrier.team = 0;
  assert.equal(barrierHit(world, [0, 0, 1], [1, 0, 0], 10, 0), null, 'friendlyPassは味方弾を通す');
  barrier.friendlyPass = false;
  assert.equal(barrierHit(world, [0, 0, 1], [1, 0, 0], 10, 0)?.barrier, barrier);
  barrier.hp = 0;
  assert.equal(barrierHit(world, [0, 0, 1], [1, 0, 0], 10, 0), null, '破壊済み障壁は後続弾を吸わない');
  assert.equal(snapshotBarrier(barrier).heightM, 3);
});

test('deployable の有限高さより上を通る射線は遮られず snapshot に当たり判定寸法が残る', () => {
  const zone = {
    id: 'deployable', team: 1, center: [5, 0, 0], radiusM: 4,
    hitRadiusM: 0.65, heightM: 1.2, hp: 60, maxHp: 60, expiresAt: 10,
  };
  const world = { zones: [zone] };

  assert.equal(deployableHit(world, [0, 0, 100], [1, 0, 0], 10, 0), null);
  assert.equal(deployableHit(world, [0, 0, -1], [1, 0, 0], 10, 0), null);
  assert.equal(deployableHit(world, [0, 0, 0.6], [1, 0, 0], 10, 0)?.zone, zone);
  assert.equal(snapshotZone(zone).heightM, 1.2);
  assert.equal(snapshotZone(zone).hitRadiusM, 0.65);
});

test('sphere sweep uses rounded deployable rims instead of an expanded-cylinder corner', () => {
  const zone = {
    id: 'rounded-deployable', team: 1, center: [3, 0, 0], radiusM: 4,
    hitRadiusM: 0.4, heightM: 1.7, hp: 60,
  };
  const world = { zones: [zone] };
  assert.equal(
    deployableHit(world, [0, 0.55, 1.85], [1, 0, 0], 10, 0, 0.2),
    null,
  );
  const overlap = deployableHit(world, [3.5, 0, 1], [1, 0, 0], 10, 0, 0.2);
  assert.equal(overlap?.zone, zone);
  assert.equal(overlap?.dist, 0);
});

test('capless barrier sphere sweep hits the inner offset and rounded open rim exactly', () => {
  const barrier = {
    id: 'shell', team: 1, center: [0, 0, 0], radiusM: 1, heightM: 2,
    hp: 300, friendlyPass: true,
  };
  const world = { barriers: [barrier] };
  const inner = barrierHit(world, [0, 0, 1], [1, 0, 0], 10, 0, 0.2);
  assert.equal(inner?.barrier, barrier);
  assert.ok(Math.abs(inner.dist - 0.8) < 1e-8, `${inner?.dist}`);

  const rim = barrierHit(world, [1, 0, 3], [0, 0, -1], 10, 0, 0.2);
  assert.equal(rim?.barrier, barrier);
  assert.ok(Math.abs(rim.dist - 0.8) < 1e-8, `${rim?.dist}`);

  assert.equal(
    barrierHit(world, [0, 0, 3], [0, 0, -1], 10, 0, 0.2),
    null,
    'open top has no disk cap',
  );
});

test('ricochet は斜め壁で法線成分だけを反転し接線成分を保つ', () => {
  const world = projectileWorld([{ min: [2, -5, 0], max: [2.2, 5, 3], tag: 'wall' }]);
  const owner = world.players.get('owner');
  const projectile = spawnWeaponProjectile(world, owner, RICOCHET_WEAPON, [0, 0, 1], [1, 0.5, 0]);

  tickProjectiles(world, 0.1);

  assert.ok(Math.abs(projectile.dir[0] + 2 / Math.sqrt(5)) < 1e-9, `${projectile.dir}`);
  assert.ok(Math.abs(projectile.dir[1] - 1 / Math.sqrt(5)) < 1e-9, `${projectile.dir}`);
  assert.equal(projectile.dir[2], 0);
  assert.equal(projectile.damageScale, 1.5);
  assert.equal(projectile.bouncesRemaining, 0);
  assert.equal(world.events.filter(event => event.type === 'projectile_ricochet').length, 1);
});

test('ricochet は床と天井でも面法線に沿ってZ成分だけを反転する', () => {
  const floorWorld = projectileWorld([{ min: [-10, -10, -1], max: [10, 10, 0], tag: 'floor' }]);
  const floorProjectile = spawnWeaponProjectile(
    floorWorld, floorWorld.players.get('owner'), RICOCHET_WEAPON, [0, 0, 2], [1, 0, -1],
  );
  tickProjectiles(floorWorld, 0.1);
  assert.ok(Math.abs(floorProjectile.dir[0] - Math.SQRT1_2) < 1e-9, `${floorProjectile.dir}`);
  assert.ok(Math.abs(floorProjectile.dir[2] - Math.SQRT1_2) < 1e-9, `${floorProjectile.dir}`);

  const ceilingWorld = projectileWorld([{ min: [-10, -10, 3], max: [10, 10, 3.2], tag: 'ceiling' }]);
  const ceilingProjectile = spawnWeaponProjectile(
    ceilingWorld, ceilingWorld.players.get('owner'), RICOCHET_WEAPON, [0, 0, 1], [0.5, 0, 1],
  );
  tickProjectiles(ceilingWorld, 0.1);
  assert.ok(Math.abs(ceilingProjectile.dir[0] - 1 / Math.sqrt(5)) < 1e-9, `${ceilingProjectile.dir}`);
  assert.ok(Math.abs(ceilingProjectile.dir[2] + 2 / Math.sqrt(5)) < 1e-9, `${ceilingProjectile.dir}`);
});

test('projectile は barrier と world のうち実際に近い衝突だけを解決する', () => {
  const wallFirst = projectileWorld([{ min: [2, -2, 0], max: [2.2, 2, 3], tag: 'near-wall' }]);
  const rearBarrier = {
    id: 'rear', team: 1, center: [5, 0, 0], radiusM: 1, heightM: 3,
    hp: 300, maxHp: 300, friendlyPass: true,
  };
  wallFirst.barriers.push(rearBarrier);
  spawnWeaponProjectile(wallFirst, wallFirst.players.get('owner'), RICOCHET_WEAPON, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(wallFirst, 0.2);
  assert.equal(rearBarrier.hp, 300);
  assert.equal(wallFirst.events.some(event => event.type === 'projectile_ricochet'), true);

  const barrierFirst = projectileWorld([{ min: [5, -2, 0], max: [5.2, 2, 3], tag: 'rear-wall' }]);
  const frontBarrier = { ...rearBarrier, id: 'front', center: [2, 0, 0], radiusM: 0.5, hp: 300 };
  barrierFirst.barriers.push(frontBarrier);
  spawnWeaponProjectile(barrierFirst, barrierFirst.players.get('owner'), RICOCHET_WEAPON, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(barrierFirst, 0.2);
  assert.ok(frontBarrier.hp < 300);
  assert.equal(barrierFirst.events.some(event => event.type === 'projectile_ricochet'), false);
  const hitEvent = barrierFirst.events.find(event => event.type === 'barrier_hit');
  assert.equal(Array.isArray(hitEvent?.pos) && hitEvent.pos.length === 3, true);
});

test('deploy projectile は定義の有限高さを生成物とevent snapshotへ保存する', () => {
  const world = projectileWorld([{ min: [2, -2, 0], max: [2.2, 2, 3], tag: 'wall' }]);
  const weapon = {
    ...RICOCHET_WEAPON,
    id: 'test-deploy', type: 'deploy', deployableHp: 60, deployableHeightM: 1.75,
    zoneRadiusM: 4, zoneDurationSec: 12,
  };
  spawnWeaponProjectile(world, world.players.get('owner'), weapon, [0, 0, 0.6], [1, 0, 0]);

  tickProjectiles(world, 0.1);

  assert.equal(world.zones[0].heightM, 1.75);
  const created = world.events.find(event => event.type === 'zone_created');
  assert.equal(created.zone.heightM, 1.75);
  assert.deepEqual(created.pos, [2, 0, 0.6]);
});
