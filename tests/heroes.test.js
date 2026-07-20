import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES, HERO_BY_ID } from '../shared/data/heroes.js';
import { World } from '../shared/sim/sim.js';
import {
  SUPPORTED_BEHAVIORS,
  tickAbilityState,
  tickWorldAbilityEffects,
  tryActivateAbility,
} from '../shared/sim/abilities.js';
import { Collider } from '../shared/sim/collision.js';
import { snapshotProjectile, spawnWeaponProjectile, tickProjectiles } from '../shared/sim/projectiles.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { MODE, COMBAT } from './helpers.js';

test('正典ロスターは3ロール各6人の18人で全員が固有武器・能力・必殺技を持つ', () => {
  assert.equal(HEROES.length, 18);
  assert.equal(new Set(HEROES.map(hero => hero.id)).size, 18);

  const roleCounts = Object.groupBy(HEROES, hero => hero.role);
  assert.deepEqual(
    Object.fromEntries(Object.entries(roleCounts).map(([role, heroes]) => [role, heroes.length])),
    { frontline: 6, damage: 6, support: 6 },
  );

  for (const hero of HEROES) {
    assert.equal(HERO_BY_ID[hero.id], hero);
    assert.ok(hero.name);
    assert.ok(hero.roleLabel);
    assert.ok(hero.maxHp >= 200);
    assert.ok(hero.weapon?.id);
    assert.ok(hero.weapon?.displayName);
    assert.ok(hero.passive?.name);
    assert.ok(hero.abilities?.secondary?.name);
    assert.ok(hero.abilities?.ability1?.name);
    assert.ok(hero.abilities?.ability2?.name);
    assert.ok(hero.abilities?.ultimate?.name);
    assert.equal(hero.abilities.ultimate.slot, 'ultimate');
  }
});

test('詳細仕様6人の正典値は概要用の仮値で上書きされない', () => {
  assert.equal(HERO_BY_ID.zairu.maxHp, 575);
  assert.equal(HERO_BY_ID.zairu.weapon.projectileRadiusM, 0.15);
  assert.equal(HERO_BY_ID.vesta.maxHp, 550);
  assert.equal(HERO_BY_ID.asagi.weapon.magSize, 21);
  assert.equal(HERO_BY_ID.asagi.weapon.reloadSec, 2.8);
  assert.equal(HERO_BY_ID.asagi.passive.resource.max, 5);
  assert.equal(HERO_BY_ID.tsubakuro.maxHp, 200);
  assert.equal(HERO_BY_ID.tsuzuri.weapon.allyHealStored, 60);
  assert.equal(HERO_BY_ID.koyomi.abilities.ability1.cooldownRateMult, 2);
});

test('ザイルの正典projectile半径は実弾snapshotへ伝播し未指定武器は0へfallbackする', () => {
  const world = new World(buildMap(), MODE, COMBAT, 400);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = new Collider([]);
  zairu.move.pos = [0, 0, 10];

  world.queueInput(zairu.id, { fire: true, yaw: 0, pitch: 0, interpMs: 0 });
  world.tick();

  assert.equal(world.projectiles[0]?.radiusM, 0.15);
  assert.equal(world.snapshot().projectiles[0]?.radiusM, 0.15);
  const legacy = spawnWeaponProjectile(
    world, zairu, { ...HERO_BY_ID.zairu.weapon, projectileRadiusM: undefined }, [0, 0, 1], [1, 0, 0],
  );
  assert.equal(snapshotProjectile(legacy).radiusM, 0);
});

test('18人の全アクションは能力システムが実行可能な振る舞いへ割り当てられている', () => {
  const unsupported = HEROES.flatMap(hero => Object.values(hero.abilities)
    .filter(ability => !SUPPORTED_BEHAVIORS.has(ability.behavior))
    .map(ability => `${hero.id}:${ability.id}:${ability.behavior}`));
  assert.deepEqual(unsupported, []);
});

test('18人72アクションは権威World上で発動し、例外や未処理分岐を残さない', () => {
  for (const [heroIndex, hero] of HEROES.entries()) {
    const world = new World(buildMap(), MODE, COMBAT, 100 + heroIndex);
    const actor = world.addPlayer(hero.name, false, 0, hero.id);
    const ally = world.addPlayer('味方', false, 0, 'asagi');
    const enemy = world.addPlayer('敵', false, 1, 'asagi');
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    actor.move.pos = [10, 0, 4];
    ally.move.pos = [14, 0, 4];
    enemy.move.pos = [18, 0, 4];
    actor.move.grounded = ally.move.grounded = enemy.move.grounded = true;
    actor.move.yaw = 0;
    ally.hp = 100;

    for (const slot of ['secondary', 'ability1', 'ability2', 'ultimate']) {
      actor.abilities.cast = null;
      actor.abilities.previous[slot] = false;
      if (slot !== 'ultimate') actor.abilities.cooldowns[slot] = 0;
      if (actor.resource) actor.resource.value = actor.resource.max;
      if (slot === 'ultimate') actor.ultGauge = 100;
      world.drainEvents();
      world.queueInput(actor.id, { [slot]: true, fire: false, yaw: 0, pitch: 0 });
      world.tick();
      world.queueInput(actor.id, { [slot]: false });
      const castSec = hero.abilities[slot].castSec || 0;
      for (let i = 0; i < Math.ceil((castSec + 0.05) / world.dt); i++) world.tick();
      const expectedType = slot === 'ultimate' ? 'ultimate_used' : 'ability_used';
      assert.equal(
        world.drainEvents().some(event => event.type === expectedType && event.abilityId === hero.abilities[slot].id),
        true,
        `${hero.id}:${slot}:${hero.abilities[slot].behavior}`,
      );
      enemy.alive = true;
      enemy.hp = enemy.maxHp;
    }
  }
});

test('半径ダメージ能力は solid の向こう側へダメージを通さない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 401);
  const botan = world.addPlayer('花火師', false, 0, 'botan');
  const enemy = world.addPlayer('遮蔽裏の敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  botan.move.pos = [0, 0, 10];
  enemy.move.pos = [2, 0, 10];
  world.collider = new Collider([{ min: [1, -2, 9], max: [1.2, 2, 13], tag: 'test-wall' }]);

  assert.equal(tryActivateAbility(world, botan, 'ability2'), true);
  assert.equal(enemy.hp, enemy.maxHp, '花火足の30ダメージが壁を越えない');
});

test('半径ダメージ能力は敵 barrier の向こう側へダメージを通さない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4011);
  const botan = world.addPlayer('花火師', false, 0, 'botan');
  const enemy = world.addPlayer('障壁裏の敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  botan.move.pos = [0, 0, 10];
  enemy.move.pos = [2, 0, 10];
  world.collider = new Collider([]);
  world.barriers.push({
    id: 'radius-cover', team: enemy.team, center: [1, 0, 10], radiusM: 0.2, heightM: 3,
    hp: 300, maxHp: 300, expiresAt: world.t + 10, friendlyPass: true,
  });

  assert.equal(tryActivateAbility(world, botan, 'ability2'), true);
  assert.equal(enemy.hp, enemy.maxHp, '花火足の30ダメージが敵障壁を越えない');
});

test('radius ability hit event carries its authoritative effect center and target-to-origin direction', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4012);
  const botan = world.addPlayer('radius-owner', false, 0, 'botan');
  const enemy = world.addPlayer('radius-target', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  botan.move.pos = [0, 0, 10];
  enemy.move.pos = [2, 0, 10];
  world.collider = new Collider([]);
  world.drainEvents();

  assert.equal(tryActivateAbility(world, botan, 'ability2'), true);

  const hit = world.drainEvents().find(event => event.type === 'hit' && event.abilityId === 'hanabiashi');
  assert.deepEqual(hit?.damageOrigin, [0, 0, 10]);
  assert.deepEqual(hit?.damageDirection, [-2, 0, 0]);
});

test('damage zone hit direction is based on the zone center rather than its current owner position', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4013);
  const owner = world.addPlayer('zone-owner', false, 0, 'botan');
  const enemy = world.addPlayer('zone-target', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  owner.move.pos = [10, 0, 10];
  enemy.move.pos = [2, 0, 10];
  world.collider = new Collider([]);
  world.zones.push({
    id: 'direction-zone', kind: 'damage', abilityId: 'direction-zone',
    ownerId: owner.id, team: owner.team, center: [0, 0, 10], radiusM: 4,
    expiresAt: world.t + 5, nextPulseAt: world.t, followOwner: false,
    damagePerSec: 8, healPerSec: 0, allyStatus: null, enemyStatus: null,
    projectileSpeedMult: null, allyProjectileSpeedMult: null, resourceDrainPerSec: 0,
  });
  world.drainEvents();

  tickWorldAbilityEffects(world);

  const hit = world.drainEvents().find(event => event.type === 'hit' && event.abilityId === 'direction-zone');
  assert.deepEqual(hit?.damageOrigin, [0, 0, 10]);
  assert.deepEqual(hit?.damageDirection, [-2, 0, 0]);
});

test('redirected damage recomputes target-to-origin direction for the redirect target', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4014);
  const source = world.addPlayer('source', false, 0, 'botan');
  const target = world.addPlayer('target', false, 1, 'asagi');
  const redirect = world.addPlayer('redirect', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  source.move.pos = [0, 0, 10];
  target.move.pos = [2, 0, 10];
  redirect.move.pos = [5, 0, 10];
  target.abilities.statuses.push({
    id: 'redirect-test', redirectTo: redirect.id, redirectPct: 0.5,
    expiresAt: world.t + 10,
  });
  world.drainEvents();

  world.applyDamage(target, 20, source, false, { damageOrigin: [0, 0, 10] });

  const hits = world.drainEvents().filter(event => event.type === 'hit');
  assert.deepEqual(hits.find(event => event.target === target.id)?.damageDirection, [-2, 0, 0]);
  assert.deepEqual(hits.find(event => event.target === redirect.id)?.damageDirection, [-5, 0, 0]);
});

test('zone pulse の回復と負のstatusは可視対象だけへ作用する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 402);
  const owner = world.addPlayer('設置者', false, 0, 'koyomi');
  const visibleAlly = world.addPlayer('手前の味方', false, 0, 'asagi');
  const blockedAlly = world.addPlayer('壁裏の味方', false, 0, 'asagi');
  const visibleEnemy = world.addPlayer('手前の敵', false, 1, 'asagi');
  const blockedEnemy = world.addPlayer('壁裏の敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  owner.move.pos = [0, 0, 10];
  visibleAlly.move.pos = [-2, -0.5, 10];
  blockedAlly.move.pos = [2, -0.5, 10];
  visibleEnemy.move.pos = [-2, 0.5, 10];
  blockedEnemy.move.pos = [2, 0.5, 10];
  visibleAlly.hp = blockedAlly.hp = 100;
  world.collider = new Collider([{ min: [1, -2, 9], max: [1.2, 2, 13], tag: 'test-wall' }]);
  world.zones.push({
    id: 'los-zone', kind: 'test', abilityId: 'los-zone', ownerId: owner.id, team: owner.team,
    center: [0, 0, 10], radiusM: 4, expiresAt: world.t + 5, nextPulseAt: world.t,
    followOwner: false, damagePerSec: 0, healPerSec: 12, allyStatus: null,
    enemyStatus: { kind: 'cast_delay', castTimeMult: 1.5, negative: true },
    projectileSpeedMult: null, allyProjectileSpeedMult: null, resourceDrainPerSec: 0,
  });

  tickWorldAbilityEffects(world);

  assert.equal(visibleAlly.hp, 103, '同じ側の味方は回復する');
  assert.equal(blockedAlly.hp, 100, '壁裏の味方は回復しない');
  assert.equal(visibleEnemy.abilities.statuses.some(status => status.id === 'los-zone:enemy'), true);
  assert.equal(blockedEnemy.abilities.statuses.some(status => status.id === 'los-zone:enemy'), false);

  const zone = world.zones[0];
  zone.ignoreLineOfSight = true;
  zone.nextPulseAt = world.t;
  tickWorldAbilityEffects(world);
  assert.equal(blockedAlly.hp, 103, '明示的なLOS除外定義は壁越し回復を許可する');
  assert.equal(blockedEnemy.abilities.statuses.some(status => status.id === 'los-zone:enemy'), true);
});

test('爆発投射物の直撃対象は同じ弾の splash damage を重ねて受けない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 403);
  const botan = world.addPlayer('花火師', false, 0, 'botan');
  const direct = world.addPlayer('直撃対象', false, 1, 'asagi');
  const bystander = world.addPlayer('爆風対象', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  botan.move.pos = [0, -10, 0];
  direct.move.pos = [3, 0, 0];
  bystander.move.pos = [3, 2, 0];
  world.collider = new Collider([]);

  spawnWeaponProjectile(world, botan, HERO_BY_ID.botan.weapon, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(world, 1);

  assert.equal(direct.hp, direct.maxHp - HERO_BY_ID.botan.weapon.damage, '直撃52だけを受ける');
  assert.equal(bystander.hp, bystander.maxHp - HERO_BY_ID.botan.weapon.splashDamage, '周囲には爆風38が入る');
  const firstImpact = world.events.find(event => event.type === 'projectile_impact');
  const directHit = world.events.find(event => event.type === 'hit' && event.target === direct.id);
  const splashHit = world.events.find(event => event.type === 'hit' && event.target === bystander.id);
  assert.deepEqual(directHit?.damageOrigin, firstImpact?.pos);
  assert.deepEqual(splashHit?.damageOrigin, firstImpact?.pos);
  assert.deepEqual(directHit?.damageDirection, [-0.4, 0, 1]);
  assert.deepEqual(splashHit?.damageDirection, [-0.4, -2, 1]);

  direct.hp = direct.maxHp;
  bystander.hp = bystander.maxHp;
  const authoredDoubleHit = { ...HERO_BY_ID.botan.weapon, directTargetReceivesSplash: true };
  spawnWeaponProjectile(world, botan, authoredDoubleHit, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(world, 1);
  assert.equal(
    direct.hp,
    direct.maxHp - authoredDoubleHit.damage - authoredDoubleHit.splashDamage,
    '明示的に authored された武器だけは直撃+splashを許可する',
  );
});

test('projectile splash は爆心から見て solid の裏にいる対象へ届かない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 404);
  const botan = world.addPlayer('花火師', false, 0, 'botan');
  const visible = world.addPlayer('見える対象', false, 1, 'asagi');
  const blocked = world.addPlayer('壁裏の対象', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  botan.move.pos = [0, -10, 0];
  visible.move.pos = [4, -2, 0];
  blocked.move.pos = [4, 2, 0];
  world.collider = new Collider([{ min: [3.5, 0.9, 0], max: [4.5, 1.1, 3], tag: 'test-wall' }]);
  const weapon = { ...HERO_BY_ID.botan.weapon, maxRangeM: 4 };

  spawnWeaponProjectile(world, botan, weapon, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(world, 1);

  assert.equal(visible.hp, visible.maxHp - weapon.splashDamage, '同じ側の対象には爆風が入る');
  assert.equal(blocked.hp, blocked.maxHp, '壁裏の対象には爆風が入らない');

  visible.hp = visible.maxHp;
  blocked.hp = blocked.maxHp;
  const authoredThroughWalls = { ...weapon, ignoreLineOfSight: true };
  spawnWeaponProjectile(world, botan, authoredThroughWalls, [0, 0, 1], [1, 0, 0]);
  tickProjectiles(world, 1);
  assert.equal(blocked.hp, blocked.maxHp - weapon.splashDamage, '明示的なLOS除外定義は壁越し爆風を許可する');
});

test('燕羽の跳弾後12mのimpactは同じ総dtを1tickと複数tickに分けても一致する', () => {
  const simulate = dts => {
    const world = new World(buildMap(), MODE, COMBAT, 405);
    const tsubakuro = world.addPlayer('燕羽使い', false, 0, 'tsubakuro');
    world.flow.state = 'ACTIVE';
    tsubakuro.move.pos = [-100, -100, -100];
    world.collider = new Collider([{ min: [2, -5, 0], max: [2.2, 5, 3], tag: 'test-wall' }]);
    const projectile = spawnWeaponProjectile(
      world, tsubakuro, HERO_BY_ID.tsubakuro.weapon, [0, 0, 1], [1, 0, 0],
    );
    for (const dt of dts) tickProjectiles(world, dt);
    return {
      projectile,
      ricochets: world.events.filter(event => event.type === 'projectile_ricochet'),
      impact: world.events.find(event => event.type === 'projectile_impact'),
    };
  };

  const singleTick = simulate([0.4]);
  const splitTicks = simulate(Array(16).fill(0.025));

  assert.equal(singleTick.projectile.alive, false);
  assert.equal(splitTicks.projectile.alive, false);
  assert.ok(Math.abs(singleTick.projectile.travelledM - 14) < 1e-6);
  assert.ok(Math.abs(splitTicks.projectile.travelledM - 14) < 1e-6);
  assert.equal(singleTick.ricochets.length, 1);
  assert.equal(splitTicks.ricochets.length, 1);
  assert.deepEqual(singleTick.impact?.pos, [-10, 0, 1]);
  assert.deepEqual(splitTicks.impact?.pos, singleTick.impact?.pos);
});

test('半径を持つprojectileはstateとsnapshotへ半径を保持し中心線外のworldにもsweep衝突する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 406);
  const owner = world.addPlayer('射手', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  owner.move.pos = [-100, -100, -100];
  world.collider = new Collider([{ min: [2, 0.15, 0], max: [2.2, 0.3, 3], tag: 'offset-wall' }]);
  const weapon = {
    ...HERO_BY_ID.zairu.weapon,
    id: 'radius-probe', type: 'projectile', projectileRadiusM: 0.2,
  };
  const projectile = spawnWeaponProjectile(world, owner, weapon, [0, 0, 1], [1, 0, 0]);

  assert.equal(projectile.radiusM, 0.2);
  assert.equal(snapshotProjectile(projectile).radiusM, 0.2);
  tickProjectiles(world, 0.1);

  assert.equal(projectile.alive, false);
  assert.deepEqual(world.events.find(event => event.type === 'projectile_impact')?.pos, [1.87, 0, 1]);
});

test('球形projectileはradius拡張AABBの角だけを通る経路へ偽衝突しない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4061);
  const owner = world.addPlayer('射手', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  owner.move.pos = [-100, -100, -100];
  world.collider = new Collider([{ min: [2, -0.1, -0.1], max: [2.2, 0.1, 0.1], tag: 'corner' }]);
  const weapon = {
    ...HERO_BY_ID.zairu.weapon,
    id: 'radius-corner-probe', type: 'projectile', projectileRadiusM: 0.2,
  };
  const projectile = spawnWeaponProjectile(world, owner, weapon, [0, 0.29, 0.29], [1, 0, 0]);

  tickProjectiles(world, 0.1);

  assert.equal(projectile.alive, true);
  assert.ok(Math.abs(projectile.pos[0] - weapon.projectileSpeedMps * 0.1) < 1e-9);
  assert.equal(world.events.some(event => event.type === 'projectile_impact'), false);
});

test('projectile radiusはbarrier・deployable・playerの各sweepへ同じように適用される', async t => {
  const setup = (seed, withTarget = false) => {
    const world = new World(buildMap(), MODE, COMBAT, seed);
    const owner = world.addPlayer('射手', false, 0, 'zairu');
    const target = withTarget ? world.addPlayer('標的', false, 1, 'asagi') : null;
    world.flow.state = 'ACTIVE';
    owner.move.pos = [-100, -100, -100];
    world.collider = new Collider([]);
    const weapon = {
      ...HERO_BY_ID.zairu.weapon,
      id: 'radius-probe', type: 'projectile', projectileRadiusM: 0.35,
    };
    return { world, owner, target, weapon };
  };

  await t.test('barrier', () => {
    const { world, owner, weapon } = setup(407);
    const barrier = {
      id: 'offset-barrier', team: 1, center: [3, 0.5, 0],
      radiusM: 0.2, heightM: 2, hp: 300, maxHp: 300,
      expiresAt: world.t + 10, friendlyPass: true,
    };
    world.barriers.push(barrier);
    const projectile = spawnWeaponProjectile(world, owner, weapon, [0, 0, 1], [1, 0, 0]);
    tickProjectiles(world, 0.1);
    assert.equal(projectile.alive, false);
    assert.equal(barrier.hp, 300 - weapon.damage);
  });

  await t.test('deployable', () => {
    const { world, owner, weapon } = setup(408);
    const deployable = {
      id: 'offset-deployable', team: 1, center: [3, 0.5, 0], radiusM: 2,
      hitRadiusM: 0.2, heightM: 2, hp: 100, maxHp: 100, expiresAt: world.t + 10,
    };
    world.zones.push(deployable);
    const projectile = spawnWeaponProjectile(world, owner, weapon, [0, 0, 1], [1, 0, 0]);
    tickProjectiles(world, 0.1);
    assert.equal(projectile.alive, false);
    assert.equal(deployable.hp, 100 - weapon.damage);
  });

  await t.test('player body', () => {
    const { world, owner, target, weapon } = setup(409, true);
    target.move.pos = [3, 0.7, 0];
    const projectile = spawnWeaponProjectile(world, owner, weapon, [0, 0, 1], [1, 0, 0]);
    tickProjectiles(world, 0.1);
    assert.equal(projectile.alive, false);
    assert.equal(target.hp, target.maxHp - weapon.damage);
  });
});

test('LOS必須の action kind は target・radius・global の各経路で壁を越えない', () => {
  const cases = [
    { kind: 'target_damage', heroId: 'ankou', slot: 'ability1', relation: 'enemy' },
    { kind: 'target_negative_status', heroId: 'ankou', slot: 'secondary', relation: 'enemy' },
    { kind: 'target_stored_heal', heroId: 'tsuzuri', slot: 'ability1', relation: 'ally' },
    { kind: 'target_support_status', heroId: 'kazura', slot: 'secondary', relation: 'ally' },
    { kind: 'radius_heal', heroId: 'hibari', slot: 'ability2', relation: 'ally' },
    { kind: 'radius_negative_status', heroId: 'hokuchi', slot: 'ability1', relation: 'enemy' },
    { kind: 'radius_stored_heal_release', heroId: 'tsuzuri', slot: 'ultimate', relation: 'ally' },
    { kind: 'global_negative_status', heroId: 'asagi', slot: 'ultimate', relation: 'enemy' },
    { kind: 'line_damage', heroId: 'sedora', slot: 'ability2', relation: 'enemy' },
  ];
  const blockedByKind = {};

  for (const [index, entry] of cases.entries()) {
    const world = new World(buildMap(), MODE, COMBAT, 410 + index);
    const actor = world.addPlayer('術者', false, 0, entry.heroId);
    const target = world.addPlayer('壁裏の対象', false, entry.relation === 'ally' ? 0 : 1, 'asagi');
    world.flow.state = 'ACTIVE';
    actor.move.pos = [0, 0, 10];
    actor.move.yaw = 0;
    actor.move.pitch = 0;
    target.move.pos = [2, 0, 10];
    target.hp = 100;
    world.collider = new Collider([{ min: [1, -2, 9], max: [1.2, 2, 13], tag: 'test-wall' }]);
    if (actor.resource) actor.resource.value = actor.resource.max;
    if (entry.slot === 'ultimate') actor.ultGauge = 100;
    if (entry.kind === 'radius_stored_heal_release') {
      target.abilities.statuses.push({
        id: 'stored-test', kind: 'stored_heal', sourceId: actor.id, abilityId: 'stored-test',
        amount: 40, convertAt: world.t + 10, expiresAt: world.t + 20,
      });
    }

    const hpBefore = target.hp;
    const statusesBefore = target.abilities.statuses.map(status => ({ ...status }));
    assert.equal(tryActivateAbility(world, actor, entry.slot), true, entry.kind);
    if (actor.abilities.cast) {
      world.t = actor.abilities.cast.readyAt;
      tickAbilityState(world, actor, 0);
    }

    if (entry.kind.includes('damage') || entry.kind.includes('heal')) {
      blockedByKind[entry.kind] = target.hp === hpBefore;
    } else {
      blockedByKind[entry.kind] = target.abilities.statuses.length === statusesBefore.length;
    }
  }

  assert.deepEqual(blockedByKind, Object.fromEntries(cases.map(entry => [entry.kind, true])));
});

test('homing barrage は射程内かつ可視の敵だけを標的にする', () => {
  const world = new World(buildMap(), MODE, COMBAT, 430);
  const ankou = world.addPlayer('提灯守', false, 0, 'ankou');
  const visible = world.addPlayer('可視対象', false, 1, 'vesta');
  const blocked = world.addPlayer('遮蔽対象', false, 1, 'vesta');
  const outOfRange = world.addPlayer('射程外対象', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  ankou.move.pos = [0, 0, 10];
  visible.move.pos = [10, -4, 10];
  blocked.move.pos = [10, 4, 10];
  outOfRange.move.pos = [46, -4, 10];
  for (const target of [visible, blocked, outOfRange]) target.maxHp = target.hp = 1000;
  world.collider = new Collider([{ min: [2, 0.9, 9], max: [8, 1.1, 13], tag: 'test-wall' }]);
  ankou.ultGauge = 100;

  assert.equal(tryActivateAbility(world, ankou, 'ultimate'), true);

  assert.equal(visible.hp, 1000 - HERO_BY_ID.ankou.abilities.ultimate.damage * HERO_BY_ID.ankou.abilities.ultimate.count);
  assert.equal(blocked.hp, 1000);
  assert.equal(outOfRange.hp, 1000);
});

test('guided projectile は遮蔽された最近敵ではなく可視の敵へ追尾する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 431);
  const ankou = world.addPlayer('提灯守', false, 0, 'ankou');
  const blocked = world.addPlayer('遮蔽された近敵', false, 1, 'asagi');
  const visible = world.addPlayer('可視の次点敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  ankou.move.pos = [0, -10, 10];
  blocked.move.pos = [10, 4, 10];
  visible.move.pos = [12, -5, 10];
  world.collider = new Collider([{ min: [2, 0.9, 9], max: [8, 1.1, 13], tag: 'test-wall' }]);

  const projectile = spawnWeaponProjectile(world, ankou, HERO_BY_ID.ankou.weapon, [0, 0, 11], [1, 0, 0]);
  tickProjectiles(world, 0.1);

  assert.ok(projectile.dir[1] < 0, `visible target direction expected, dir=${projectile.dir}`);
});

test('能力のpushは swept cylinder 経路を使い solid を通り抜けない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 432);
  const shiomaneki = world.addPlayer('潮招き', false, 0, 'shiomaneki');
  const enemy = world.addPlayer('押される敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  shiomaneki.move.pos = [0, 0, 10];
  enemy.move.pos = [0.5, 0, 10];
  world.collider = new Collider([{ min: [2, -2, 9], max: [2.2, 2, 13], tag: 'test-wall' }]);

  assert.equal(tryActivateAbility(world, shiomaneki, 'ability1'), true);

  assert.ok(enemy.move.pos[0] <= 2 - COMBAT.movement.capsuleRadiusM + 1e-4, `x=${enemy.move.pos[0]}`);
  assert.equal(
    world.collider.overlapsCylinder(
      enemy.move.pos[0], enemy.move.pos[1], enemy.move.pos[2],
      COMBAT.movement.capsuleRadiusM, COMBAT.movement.standHeightM,
    ),
    false,
    `forced movement must finish outside solid geometry, pos=${enemy.move.pos}`,
  );
});

test('セドラのline pullは中心rayが通る狭間でもplayer円柱を壁越しに引かない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4321);
  const sedora = world.addPlayer('杭打ち', false, 0, 'sedora');
  const enemy = world.addPlayer('引かれる敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  sedora.move.pos = [0, 0, 10];
  sedora.move.yaw = 0;
  sedora.move.pitch = 0;
  enemy.move.pos = [5, 0, 10];
  world.collider = new Collider([
    { min: [2, -2, 9], max: [2.2, -0.25, 13], tag: 'narrow-left' },
    { min: [2, 0.25, 9], max: [2.2, 2, 13], tag: 'narrow-right' },
  ]);

  assert.equal(tryActivateAbility(world, sedora, 'ability2'), true);

  assert.equal(enemy.hp, enemy.maxHp - HERO_BY_ID.sedora.abilities.ability2.damage);
  assert.ok(
    enemy.move.pos[0] >= 2.2 + COMBAT.movement.capsuleRadiusM,
    `pull crossed a player-width wall gap: pos=${enemy.move.pos}`,
  );
  assert.equal(
    world.collider.overlapsCylinder(
      enemy.move.pos[0], enemy.move.pos[1], enemy.move.pos[2],
      COMBAT.movement.capsuleRadiusM, COMBAT.movement.standHeightM,
    ),
    false,
  );
});

test('速度を付与するdash能力も通常移動の swept cylinder 経路を通る', () => {
  const world = new World(buildMap(), MODE, COMBAT, 433);
  const shiomaneki = world.addPlayer('潮招き', false, 0, 'shiomaneki');
  world.flow.state = 'ACTIVE';
  shiomaneki.move.pos = [0, 0, 10];
  shiomaneki.move.yaw = 0;
  shiomaneki.move.grounded = true;
  world.collider = new Collider([
    { min: [-20, -20, 9], max: [20, 20, 10], tag: 'test-floor' },
    { min: [1, -2, 10], max: [1.2, 2, 13], tag: 'test-wall' },
  ]);

  assert.equal(tryActivateAbility(world, shiomaneki, 'secondary'), true);
  for (let i = 0; i < 20; i++) world.tick();

  assert.ok(shiomaneki.move.pos[0] <= 1 - COMBAT.movement.capsuleRadiusM + 1e-4, `x=${shiomaneki.move.pos[0]}`);
  assert.ok(shiomaneki.move.pos[0] > 0.5, `dash did not reach the wall, x=${shiomaneki.move.pos[0]}`);
  assert.equal(
    world.collider.overlapsCylinder(
      shiomaneki.move.pos[0], shiomaneki.move.pos[1], shiomaneki.move.pos[2],
      COMBAT.movement.capsuleRadiusM, COMBAT.movement.standHeightM,
    ),
    false,
  );
});

test('zoneへの能力移動もXY→Zのsweepで壁手前に停止する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 434);
  const koyomi = world.addPlayer('暦売り', false, 0, 'koyomi');
  world.flow.state = 'ACTIVE';
  koyomi.move.pos = [0, 0, 10];
  world.collider = new Collider([{ min: [1, -2, 9], max: [1.2, 2, 13], tag: 'test-wall' }]);
  const zone = {
    id: 'dash-zone', ownerId: koyomi.id, team: koyomi.team, center: [3, 0, 10], hp: 60,
    expiresAt: world.t + 10,
  };
  world.zones.push(zone);
  world.drainEvents();

  assert.equal(tryActivateAbility(world, koyomi, 'secondary'), true);
  world.t = koyomi.abilities.cast.readyAt;
  tickAbilityState(world, koyomi, 0);

  assert.ok(koyomi.move.pos[0] <= 1 - COMBAT.movement.capsuleRadiusM + 1e-4, `x=${koyomi.move.pos[0]}`);
  assert.ok(zone.expiresAt > world.t);
  assert.equal(world.drainEvents().some(event => event.type === 'deployable_consumed'), false);
});

test('zone dash does not select an own deployable on another floor outside 3D range', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4341);
  const koyomi = world.addPlayer('zone-dasher', false, 0, 'koyomi');
  world.flow.state = 'ACTIVE';
  koyomi.move.pos = [0, 0, 0];
  world.collider = new Collider([]);
  const zone = {
    id: 'upper-zone', ownerId: koyomi.id, team: koyomi.team,
    center: [0, 0, 100], hp: 60, expiresAt: world.t + 10,
  };
  world.zones.push(zone);
  world.drainEvents();

  assert.equal(tryActivateAbility(world, koyomi, 'secondary'), true);
  world.t = koyomi.abilities.cast.readyAt;
  tickAbilityState(world, koyomi, 0);

  assert.deepEqual(koyomi.move.pos, [0, 0, 0]);
  assert.ok(zone.expiresAt > world.t);
  assert.equal(world.drainEvents().some(event => event.type === 'deployable_consumed'), false);
});

test('zone dash keeps the deployable when player clearance prevents arrival despite clear point LOS', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4342);
  const koyomi = world.addPlayer('zone-dasher', false, 0, 'koyomi');
  world.flow.state = 'ACTIVE';
  koyomi.move.pos = [0, 0, 10];
  world.collider = new Collider([
    { min: [1, -2, 9], max: [1.2, -0.25, 13], tag: 'narrow-left' },
    { min: [1, 0.25, 9], max: [1.2, 2, 13], tag: 'narrow-right' },
  ]);
  const zone = {
    id: 'narrow-zone', ownerId: koyomi.id, team: koyomi.team,
    center: [3, 0, 10], hp: 60, expiresAt: world.t + 10,
  };
  world.zones.push(zone);
  world.drainEvents();

  assert.equal(tryActivateAbility(world, koyomi, 'secondary'), true);
  world.t = koyomi.abilities.cast.readyAt;
  tickAbilityState(world, koyomi, 0);

  assert.ok(koyomi.move.pos[0] < 3, `x=${koyomi.move.pos[0]}`);
  assert.ok(zone.expiresAt > world.t);
  assert.equal(world.drainEvents().some(event => event.type === 'deployable_consumed'), false);
});

test('successful zone dash consumes once and reports the authoritative arrived position', () => {
  const world = new World(buildMap(), MODE, COMBAT, 4343);
  const koyomi = world.addPlayer('zone-dasher', false, 0, 'koyomi');
  world.flow.state = 'ACTIVE';
  koyomi.move.pos = [0, 0, 10];
  world.collider = new Collider([]);
  const zone = {
    id: 'reachable-zone', ownerId: koyomi.id, team: koyomi.team,
    center: [3, 0, 10], hp: 60, expiresAt: world.t + 10,
  };
  world.zones.push(zone);
  world.drainEvents();

  assert.equal(tryActivateAbility(world, koyomi, 'secondary'), true);
  world.t = koyomi.abilities.cast.readyAt;
  tickAbilityState(world, koyomi, 0);

  assert.deepEqual(koyomi.move.pos, [3, 0, 10]);
  assert.equal(zone.expiresAt, world.t);
  const consumed = world.drainEvents().filter(event => event.type === 'deployable_consumed');
  assert.equal(consumed.length, 1);
  assert.deepEqual(consumed[0].pos, koyomi.move.pos);
});

test('SETUP中のキャラクター選択は体力・武器・固有リソースを正典値へ切り替える', () => {
  const world = new World(buildMap(), MODE, COMBAT, 41);
  const player = world.addPlayer('灯匠', false, 0, 'zairu');

  assert.equal(player.heroId, 'zairu');
  assert.equal(player.maxHp, 575);
  assert.equal(player.hp, 575);
  assert.equal(player.weapon.ammo, 1);
  assert.deepEqual(player.resource, { id: 'chain', name: '鎖長', value: 45, max: 100 });

  assert.equal(world.selectHero(player.id, 'koyomi'), true);
  assert.equal(player.heroId, 'koyomi');
  assert.equal(player.maxHp, 200);
  assert.equal(player.hp, 200);
  assert.equal(player.weapon.ammo, 2);
  assert.deepEqual(player.resource, { id: 'koku', name: '刻', value: 70, max: 100 });
  assert.equal(world.selectHero(player.id, 'not-a-hero'), false);

  world.flow.state = 'ACTIVE';
  assert.equal(world.selectHero(player.id, 'asagi'), false, '生存中の試合内変更は拒否する');
});

test('能力入力は立ち上がりエッジで一度だけ発動しクールダウンを開始する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 42);
  const player = world.addPlayer('測量士', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.drainEvents();

  world.queueInput(player.id, { ability2: true, yaw: 0, pitch: 0 });
  world.tick();

  const first = world.drainEvents().filter(event => event.type === 'ability_used');
  assert.equal(first.length, 1);
  assert.equal(first[0].player, player.id);
  assert.equal(first[0].abilityId, 'tsugiashi');
  assert.ok(player.abilities.cooldowns.ability2 > 11.9);
  assert.ok(player.move.vel[0] > COMBAT.movement.baseSpeedMps, '継ぎ足の前進速度が付与される');

  world.tick();
  assert.equal(
    world.drainEvents().filter(event => event.type === 'ability_used').length,
    0,
    '押し続けても再発動しない',
  );
});

test('必殺技は100%未満では拒否し、予兆完了後に一度だけ発動してゲージを消費する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 43);
  const player = world.addPlayer('標定手', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();

  world.queueInput(player.id, { ultimate: true });
  world.tick();
  assert.equal(world.drainEvents().some(event => event.type === 'ultimate_used'), false);
  assert.equal(player.ultGauge, 0);

  world.queueInput(player.id, { ultimate: false });
  world.tick();
  world.drainEvents();
  player.ultGauge = 100;
  world.queueInput(player.id, { ultimate: true });
  world.tick();
  assert.equal(world.drainEvents().some(event => event.type === 'ability_windup' && event.abilityId === 'sarashibi'), true);
  assert.equal(player.ultGauge, 0);

  for (let i = 0; i < Math.ceil(1.2 / world.dt) + 1; i++) world.tick();
  const resolved = world.drainEvents().filter(event => event.type === 'ultimate_used');
  assert.equal(resolved.length, 1);
  assert.equal(resolved[0].abilityId, 'sarashibi');
});

test('ザイルの鎖杭は3m以内で70ダメージの刺突になりヘッドショット倍率を持たない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 44);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  zairu.move.pos = [0, 0, 10];
  target.move.pos = [2, 0, 10];

  world.queueInput(zairu.id, { fire: true, yaw: 0, pitch: 0, interpMs: 0 });
  world.tick();

  assert.equal(target.hp, 180);
  const hit = world.drainEvents().find(event => event.type === 'hit' && event.source === zairu.id);
  assert.equal(hit?.amount, 70);
  assert.equal(hit?.headshot, false);
  assert.deepEqual(hit?.damageOrigin, [0.8, 0, 11.45]);
  assert.deepEqual(hit?.damageDirection, [-1.2, 0, 1.45]);
});

test('ザイルの近接判定は手前の敵barrierを貫通してplayerへ当たらない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 441);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = new Collider([]);
  zairu.move.pos = [0, 0, 10];
  target.move.pos = [2, 0, 10];
  const barrier = {
    id: 'front-barrier', team: target.team, center: [1, 0, 10],
    radiusM: 0.2, heightM: 3, hp: 300, maxHp: 300,
    expiresAt: world.t + 10, friendlyPass: true,
  };
  world.barriers.push(barrier);

  world.queueInput(zairu.id, { fire: true, yaw: 0, pitch: 0, interpMs: 0 });
  world.tick();
  world.queueInput(zairu.id, { fire: false });
  for (let i = 0; i < 2; i++) world.tick();

  assert.equal(target.hp, target.maxHp);
  assert.equal(barrier.hp, 300 - HERO_BY_ID.zairu.weapon.damage);
  const events = world.drainEvents();
  assert.equal(events.some(event => event.type === 'hit' && event.target === target.id), false);
  assert.equal(events.some(event => event.type === 'barrier_hit' && event.barrier === barrier.id), true);
});

test('アサギの主武器は1入力で三点バーストを発射する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 45);
  const asagi = world.addPlayer('測量士', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  asagi.move.pos = [0, 0, 10];
  target.move.pos = [10, 0, 10];

  world.queueInput(asagi.id, { fire: true, yaw: 0, pitch: -0.08, interpMs: 1 });
  world.tick();

  assert.equal(target.hp, 184);
  assert.equal(world.drainEvents().filter(event => event.type === 'hit' && event.source === asagi.id).length, 3);
});

test('武器射線は視点のaim pointへ共有マズルから収束し被弾方向も実射点を使う', () => {
  const world = new World(buildMap(), MODE, COMBAT, 445);
  const shooter = world.addPlayer('射手', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = new Collider([]);
  shooter.move.pos = [0, 0, 10];
  shooter.move.yaw = 0;
  shooter.move.pitch = 0;
  target.move.pos = [5, 0, 10];
  const weapon = {
    ...HERO_BY_ID.asagi.weapon,
    id: 'muzzle-probe', type: 'hitscan', burstCount: undefined,
    damage: 20, spreadDeg: 0, maxRangeM: 20,
  };
  world.drainEvents();

  world.emitWeaponAttack(shooter, weapon);

  const events = world.drainEvents();
  const shot = events.find(event => event.type === 'shot');
  const hit = events.find(event => event.type === 'hit' && event.target === target.id);
  assert.deepEqual(shot?.origin, [0.8, 0, 11.45]);
  assert.equal(target.hp, target.maxHp - weapon.damage);
  assert.deepEqual(hit?.damageOrigin, shot?.origin);
  assert.deepEqual(hit?.damageDirection, [-4.2, 0, 1.45]);
});

test('視点rayが通る薄い遮蔽でもeyeからmuzzleへのbridgeを越えて射撃しない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 446);
  const shooter = world.addPlayer('射手', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  shooter.move.pos = [0, 0, 10];
  shooter.move.yaw = 0;
  shooter.move.pitch = 0;
  target.move.pos = [5, 0, 10];
  world.collider = new Collider([{
    min: [0.45, -0.25, 11.49], max: [0.5, 0.25, 11.55], tag: 'muzzle-cover',
  }]);
  const weapon = {
    ...HERO_BY_ID.asagi.weapon,
    id: 'muzzle-cover-probe', type: 'hitscan', burstCount: undefined,
    damage: 20, spreadDeg: 0, maxRangeM: 20,
  };
  world.drainEvents();

  world.emitWeaponAttack(shooter, weapon);

  const events = world.drainEvents();
  assert.equal(target.hp, target.maxHp, JSON.stringify(events));
  assert.equal(events.some(event => event.type === 'hit' && event.target === target.id), false);
  assert.ok(events.find(event => event.type === 'shot')?.dist < 0.8);
});

test('muzzleが壁面へ接していても外向き射撃は自己衝突せず通常照準へ進む', () => {
  const world = new World(buildMap(), MODE, COMBAT, 447);
  const shooter = world.addPlayer('射手', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  shooter.move.pos = [0, 0, 10];
  shooter.move.yaw = 0;
  shooter.move.pitch = 0;
  target.move.pos = [5, 0, 10];
  world.collider = new Collider([{
    min: [0.6, -1, 11.3], max: [1, 1, 11.45], tag: 'under-muzzle',
  }]);
  const weapon = {
    ...HERO_BY_ID.asagi.weapon,
    id: 'muzzle-contact-probe', type: 'hitscan', burstCount: undefined,
    damage: 20, spreadDeg: 0, maxRangeM: 20,
  };
  world.drainEvents();

  world.emitWeaponAttack(shooter, weapon);

  assert.equal(target.hp, target.maxHp - weapon.damage);
  assert.deepEqual(world.drainEvents().find(event => event.type === 'shot')?.origin, [0.8, 0, 11.45]);
});

test('三点バーストは残弾1/2/3だけを同じattackとして発射し弾数を負にしない', async t => {
  for (const ammo of [1, 2, 3]) {
    await t.test(`残弾${ammo}`, () => {
      const world = new World(buildMap(), MODE, COMBAT, 450 + ammo);
      const sedora = world.addPlayer('杭打ち', false, 0, 'sedora');
      world.flow.state = 'ACTIVE';
      world.objective.unseal();
      world.collider = new Collider([]);
      sedora.move.pos = [0, 0, 10];
      sedora.weapon.ammo = ammo;
      world.drainEvents();

      world.queueInput(sedora.id, { fire: true, yaw: 0, pitch: 0, interpMs: 0 });
      world.tick();

      const events = world.drainEvents();
      const shots = events.filter(event => event.type === 'shot' && event.source === sedora.id);
      const spawned = events.filter(event => event.type === 'projectile_spawned' && event.source === sedora.id);
      assert.equal(sedora.weapon.ammo, 0);
      assert.equal(world.projectiles.length, ammo);
      assert.equal(spawned.length, ammo);
      assert.equal(shots.length, ammo);
      assert.equal(new Set(shots.map(event => event.attackId)).size, 1);
      assert.deepEqual(shots.map(event => event.pelletIndex), Array.from({ length: ammo }, (_, index) => index));
      assert.deepEqual(shots.map(event => event.pelletCount), Array(ammo).fill(ammo));
    });
  }
});

test('ツヅリの灯針は味方へ縫い目を残し2秒後に回復へ変換する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 46);
  const tsuzuri = world.addPlayer('仕立て屋', false, 0, 'tsuzuri');
  const ally = world.addPlayer('味方', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  tsuzuri.move.pos = [0, 0, 10];
  ally.move.pos = [10, 0, 10];
  ally.hp = 100;

  world.queueInput(tsuzuri.id, { fire: true, yaw: 0, pitch: -0.08, interpMs: 1 });
  world.tick();
  world.queueInput(tsuzuri.id, { fire: false });
  for (let i = 0; i < Math.ceil(0.25 / world.dt); i++) world.tick();
  assert.equal(ally.hp, 100, '回復は即時ではない');
  assert.equal(ally.abilities.statuses.some(status => status.kind === 'stored_heal' && status.amount === 60), true);

  for (let i = 0; i < Math.ceil(2.4 / world.dt); i++) world.tick();
  assert.equal(ally.hp, 160);
});

test('設置障壁は敵弾を遮り、耐久値をサーバー権威で消費する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 47);
  const baraga = world.addPlayer('鋳造士', false, 0, 'baraga');
  const shooter = world.addPlayer('射手', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  baraga.move.pos = [0, 0, 10];
  shooter.move.pos = [20, 0, 10];
  baraga.resource.value = 100;

  world.queueInput(baraga.id, { ability1: true, yaw: 0, pitch: 0 });
  world.tick();
  assert.equal(world.barriers.length, 1);
  const placed = world.barriers[0];
  assert.equal(placed.center[2], baraga.move.pos[2], 'center.z は設置者の足元をbaseにする');
  assert.equal(placed.heightM, 3);
  const created = world.drainEvents().find(event => event.type === 'barrier_created');
  assert.deepEqual(created.pos, placed.center);
  assert.equal(created.barrier.heightM, 3);
  const before = placed.hp;

  world.queueInput(shooter.id, { fire: true, yaw: Math.PI, pitch: -0.08, interpMs: 1 });
  world.tick();
  assert.equal(baraga.hp, baraga.maxHp);
  assert.ok(placed.hp < before);
  assert.equal(world.drainEvents().some(event => event.type === 'barrier_hit'), true);
});

test('完全無敵と非実体は被弾候補にも体力減算にも入らない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 471);
  const source = world.addPlayer('攻撃者', false, 0, 'asagi');
  const target = world.addPlayer('対象', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  target.flags.invulnerable = true;
  world.applyDamage(target, 999, source, false);
  assert.equal(target.hp, target.maxHp);
  target.flags.invulnerable = false;
  target.flags.intangible = true;
  assert.equal(world.targetsAt(0).some(item => item.id === target.id), false);
});

test('遅延補償の1tick巻き戻しは直前履歴を選び、二重に戻らない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 472);
  const target = world.addPlayer('対象', false, 1, 'asagi');
  world.history = [
    new Map([[target.id, { pos: [1, 0, 4], crouch: false }]]),
    new Map([[target.id, { pos: [2, 0, 4], crouch: false }]]),
  ];
  target.move.pos = [3, 0, 4];
  assert.deepEqual(world.targetsAt(world.dt).find(item => item.id === target.id).pos, [2, 0, 4]);
  assert.deepEqual(world.targetsAt(world.dt * 2).find(item => item.id === target.id).pos, [1, 0, 4]);
});

test('早回しの香の中では味方のクールダウンが通常の2倍で回復する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 48);
  const koyomi = world.addPlayer('暦売り', false, 0, 'koyomi');
  const ally = world.addPlayer('味方', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  koyomi.move.pos = [0, 0, 0];
  ally.move.pos = [20, 0, 0];
  koyomi.move.grounded = ally.move.grounded = true;
  world.collider = new Collider([{ min: [-100, -100, -1], max: [100, 100, 0], tag: 'test-ground' }]);
  ally.abilities.cooldowns.ability1 = 10;

  world.queueInput(koyomi.id, { ability1: true, yaw: 0, pitch: 0 });
  for (let i = 0; i < Math.ceil(1.25 / world.dt); i++) world.tick();

  assert.equal(world.zones.some(zone => zone.kind === 'cooldown'), true);
  assert.ok(ally.abilities.cooldowns.ability1 < 8.3, `remaining=${ally.abilities.cooldowns.ability1}`);
});

test('投射武器は即着弾せずサーバー上の弾体として前方シミュレーションされる', () => {
  const world = new World(buildMap(), MODE, COMBAT, 49);
  const vesta = world.addPlayer('観測士', false, 0, 'vesta');
  const target = world.addPlayer('標的', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  vesta.move.pos = [10, 0, 4];
  target.move.pos = [18, 0, 4];
  vesta.move.grounded = true;
  target.move.grounded = true;
  world.collider = new Collider([{ min: [-100, -100, -1], max: [100, 100, 4], tag: 'test-ground' }]);

  world.queueInput(vesta.id, { fire: true, yaw: 0, pitch: 0, interpMs: 0 });
  for (let i = 0; i < Math.ceil(0.5 / world.dt); i++) world.tick();
  world.queueInput(vesta.id, { fire: false });
  world.tick();

  assert.equal(target.hp, target.maxHp, '発射tickではまだ着弾しない');
  assert.ok(world.projectiles.length > 0, '弾体が生成される');

  for (let i = 0; i < Math.ceil(0.5 / world.dt); i++) world.tick();
  assert.ok(target.hp < target.maxHp, '弾速に応じた後続tickで着弾する');
});

test('偏光野は敵投射物の前進速度を低下させる', () => {
  const world = new World(buildMap(), MODE, COMBAT, 50);
  const vesta = world.addPlayer('膜の主', false, 0, 'vesta');
  const enemy = world.addPlayer('射手', false, 1, 'ankou');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  vesta.move.pos = [10, 0, 10];
  enemy.move.pos = [0, 0, 10];
  vesta.resource.value = 100;

  world.queueInput(vesta.id, { secondary: true, yaw: Math.PI, pitch: 0 });
  for (let i = 0; i < Math.ceil(0.7 / world.dt); i++) world.tick();
  const field = world.zones.find(zone => zone.kind === 'projectile_field');
  assert.ok(field);
  enemy.move.pos = [field.center[0] - 1, field.center[1], field.center[2] - 1.6];

  world.queueInput(enemy.id, { fire: true, yaw: 0, pitch: -0.08 });
  world.tick();
  const projectile = world.projectiles[0];
  assert.ok(projectile);
  const beforeX = projectile.pos[0];
  world.tick();
  const moved = projectile.pos[0] - beforeX;
  assert.ok(moved < HERO_BY_ID.ankou.weapon.projectileSpeedMps * world.dt * 0.8, `moved=${moved}`);
});

test('SETUPの試射と能力消費は開戦時に初期化される', () => {
  const world = new World(buildMap(), MODE, COMBAT, 51);
  const player = world.addPlayer('測量士', false, 0, 'asagi');
  player.ultGauge = 100;
  world.queueInput(player.id, { fire: true });
  world.tick();
  assert.ok(player.weapon.ammo < HERO_BY_ID.asagi.weapon.magSize);
  world.queueInput(player.id, { fire: false, ability2: true, ultimate: true });
  world.tick();

  world.flow.stateT = world.mode.setupSec - world.dt / 2;
  world.tick();
  assert.equal(world.flow.state, 'ACTIVE');
  assert.equal(player.weapon.ammo, HERO_BY_ID.asagi.weapon.magSize);
  assert.deepEqual(player.abilities.cooldowns, { secondary: 0, ability1: 0, ability2: 0 });
  assert.equal(player.abilities.cast, null);
});

test('snapshotはヒーロー・4能力・固有資源・弾体をUI契約として公開する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 52);
  const player = world.addPlayer('暦売り', false, 0, 'koyomi');
  const snap = world.snapshot();
  const state = snap.players.find(item => item.id === player.id);
  assert.equal(state.heroId, 'koyomi');
  assert.equal(state.heroName, 'コヨミ');
  assert.equal(state.role, 'support');
  assert.deepEqual(Object.keys(state.abilities), ['secondary', 'ability1', 'ability2', 'ultimate']);
  assert.equal(state.abilities.ultimate.state, 'charging');
  assert.equal(state.resource.id, 'koku');
  assert.deepEqual(snap.projectiles, []);
});

test('ツバクロの武器性能は勢い0から100まで正典値へ線形補間される', () => {
  const world = new World(buildMap(), MODE, COMBAT, 53);
  const player = world.addPlayer('ツバクロ', false, 0, 'tsubakuro');

  player.resource.value = 0;
  assert.deepEqual(
    (({ damage, rps, reloadSec }) => ({ damage, rps, reloadSec }))(world.weaponDefinitionFor(player)),
    { damage: 28, rps: 1.2, reloadSec: 1.4 },
  );

  player.resource.value = 100;
  assert.deepEqual(
    (({ damage, rps, reloadSec }) => ({ damage, rps, reloadSec }))(world.weaponDefinitionFor(player)),
    { damage: 44, rps: 3, reloadSec: 0.9 },
  );
});

test('ヴェスタの灯圧は消費停止0.8秒後に毎秒12回復する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 54);
  const player = world.addPlayer('ヴェスタ', false, 0, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.resource.value = 0;
  player.lastResourceSpendT = world.t;

  for (let i = 0; i < Math.ceil(0.7 / world.dt); i++) world.tick();
  assert.equal(player.resource.value, 0);

  for (let i = 0; i < Math.ceil(1 / world.dt); i++) world.tick();
  assert.ok(player.resource.value >= 10 && player.resource.value <= 12, `灯圧=${player.resource.value}`);
});

test('死亡時にアンカー等の一時的heroStateを破棄し死亡前の位置効果を復帰後へ持ち越さない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 55);
  const player = world.addPlayer('ザイル', false, 0, 'zairu');
  const enemy = world.addPlayer('敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.abilities.heroState.anchor = { pos: [99, 99, 9], expiresAt: world.t + 100 };
  player.abilities.heroState.rewind = { pos: [88, 88, 8], expiresAt: world.t + 100 };
  player.abilities.cooldowns.ability1 = 7;

  world.applyDamage(player, player.maxHp + 100, enemy, false);

  assert.equal(player.alive, false);
  assert.deepEqual(player.abilities.heroState, {});
  assert.equal(player.abilities.cooldowns.ability1, 7, '死亡しても通常のCD会計は維持する');
});

test('ツヅリの針数は射撃消費と糸繰りの毎秒4本回復を弾倉と同じ値で示す', () => {
  const world = new World(buildMap(), MODE, COMBAT, 56);
  const tsuzuri = world.addPlayer('仕立て屋', false, 0, 'tsuzuri');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  tsuzuri.move.pos = [0, 0, 10];

  world.queueInput(tsuzuri.id, { fire: true, yaw: 0, pitch: 0 });
  world.tick();
  assert.equal(tsuzuri.weapon.ammo, 11);
  assert.equal(tsuzuri.resource.value, 11, 'HUDの針数も1本減る');

  world.queueInput(tsuzuri.id, { fire: false, secondary: true });
  for (let i = 0; i < Math.ceil(0.55 / world.dt); i++) world.tick();
  assert.equal(tsuzuri.weapon.ammo, 12, '糸繰りで2本以上戻り上限12になる');
  assert.equal(tsuzuri.resource.value, 12);
});

test('アサギの標定は命中でHUDへ蓄積し、1.5秒待機後に0.5秒ごと減衰する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 57);
  const asagi = world.addPlayer('測量士', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  asagi.move.pos = [0, 0, 10];
  target.move.pos = [10, 0, 10];

  world.queueInput(asagi.id, { fire: true, yaw: 0, pitch: -0.08, interpMs: 0 });
  world.tick();
  world.queueInput(asagi.id, { fire: false });
  assert.equal(asagi.resource.value, 3, '三点バースト3命中を標定3として表示する');

  for (let i = 0; i < Math.ceil(1.45 / world.dt); i++) world.tick();
  assert.equal(asagi.resource.value, 3, '最終命中から1.5秒は維持する');
  for (let i = 0; i < Math.ceil(0.3 / world.dt); i++) world.tick();
  assert.equal(asagi.resource.value, 2, '最初の0.5秒減衰で1つだけ失う');
});

test('アサギの点睛は頭部照準なら100ダメージと標定2を与える', () => {
  const world = new World(buildMap(), MODE, COMBAT, 58);
  const asagi = world.addPlayer('測量士', false, 0, 'asagi');
  const target = world.addPlayer('標的', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  asagi.move.pos = [0, 0, 10];
  target.move.pos = [10, 0, 10];
  asagi.move.yaw = 0;
  asagi.move.pitch = 0.022;

  world.queueInput(asagi.id, { secondary: true, yaw: 0, pitch: 0.022 });
  world.tick();

  assert.equal(target.hp, target.maxHp - 100);
  assert.equal(asagi.resource.value, 2);
  const hit = world.drainEvents().find(event => event.type === 'hit' && event.abilityId === 'tensei');
  assert.equal(hit?.headshot, true);
  assert.deepEqual(hit?.damageOrigin, [0.8, 0, 11.47]);
  assert.deepEqual(hit?.damageDirection, [-9.2, 0, 1.47]);
});

test('field detonate scatters only projectiles in 3D range with world and barrier LOS', () => {
  const world = new World(buildMap(), MODE, COMBAT, 590);
  const vesta = world.addPlayer('field-owner', false, 0, 'vesta');
  const enemy = world.addPlayer('projectile-owner', false, 1, 'ankou');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  vesta.move.pos = [-10, 0, 10];
  enemy.move.pos = [2, 0, 10];
  world.collider = new Collider([
    { min: [-100, -100, 9], max: [100, 100, 10], tag: 'floor' },
    { min: [0.8, -1.5, 9], max: [1.2, -0.5, 12], tag: 'world-cover' },
  ]);
  world.barriers.push({
    id: 'barrier-cover', team: enemy.team, center: [1, 0.5, 9], radiusM: 0.3,
    heightM: 3, hp: 300, friendlyPass: true, expiresAt: world.t + 5,
  });
  const field = {
    id: 'test-field', kind: 'projectile_field', abilityId: 'henkoya',
    ownerId: vesta.id, team: vesta.team, center: [0, 0, 11], radiusM: 4,
    expiresAt: world.t + 5, nextPulseAt: Infinity, followOwner: false,
    damagePerSec: 0, healPerSec: 0, allyStatus: null, enemyStatus: null,
    projectileSpeedMult: 0.45, allyProjectileSpeedMult: null,
  };
  world.zones.push(field);
  vesta.abilities.heroState.fieldId = field.id;
  const projectileAt = (id, pos) => ({
    id, ownerId: enemy.id, team: enemy.team, heroId: enemy.heroId,
    weaponId: HERO_BY_ID.ankou.weapon.id, weapon: HERO_BY_ID.ankou.weapon,
    type: 'projectile', pos: [...pos], dir: [1, 0, 0], speedMps: 0,
    baseSpeedMps: 0, travelledM: 0, maxRangeM: 100, damageScale: 1,
    bouncesRemaining: 0, postBounceRemainingM: null, alive: true,
  });
  world.projectiles.push(
    projectileAt('visible', [2, 0, 11]),
    projectileAt('upper-floor', [0, 0, 100]),
    projectileAt('world-blocked', [2, -1, 11]),
    projectileAt('barrier-blocked', [2, 1, 11]),
  );
  world.drainEvents();

  world.queueInput(vesta.id, { ability2: true });
  world.tick();
  for (let i = 0; i < Math.ceil(0.45 / world.dt); i++) world.tick();

  const events = world.drainEvents();
  assert.deepEqual(
    events
      .filter(event => event.type === 'projectile_scattered')
      .map(event => event.projectileId)
      .sort(),
    ['visible'],
    JSON.stringify(events),
  );
  const hit = events.find(event => event.type === 'hit' && event.abilityId === 'ranhansha');
  assert.deepEqual(hit?.damageOrigin, [0, 0, 11]);
  assert.deepEqual(hit?.damageDirection, [-2, 0, 1]);
});

test('ヴェスタの乱反射は0.4秒の予兆後に膜内の敵弾を散乱して膜を消費する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 59);
  const vesta = world.addPlayer('観測士', false, 0, 'vesta');
  const enemy = world.addPlayer('射手', false, 1, 'ankou');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  vesta.move.pos = [10, 0, 10];
  enemy.move.pos = [0, 0, 10];
  vesta.resource.value = 100;

  world.queueInput(vesta.id, { secondary: true, yaw: 0, pitch: 0 });
  for (let i = 0; i < Math.ceil(0.7 / world.dt); i++) world.tick();
  world.queueInput(vesta.id, { secondary: false });
  const field = world.zones.find(zone => zone.kind === 'projectile_field');
  assert.ok(field);
  world.projectiles.push({
    id: 'test-enemy-projectile', ownerId: enemy.id, team: enemy.team,
    heroId: enemy.heroId, weaponId: 'test', weapon: HERO_BY_ID.ankou.weapon,
    type: 'projectile', pos: [...field.center], dir: [1, 0, 0], speedMps: 10,
    baseSpeedMps: 10, travelledM: 0, maxRangeM: 100, damageScale: 1,
    bouncesRemaining: 0, postBounceRemainingM: null, alive: true,
  });

  world.queueInput(vesta.id, { ability2: true });
  world.tick();
  assert.ok(vesta.abilities.cast, '乱反射の0.4秒予兆が始まる');
  assert.equal(world.zones.includes(field), true, '予兆中は膜が残る');
  assert.deepEqual(world.projectiles[0].dir, [1, 0, 0], '予兆中はまだ散乱しない');

  for (let i = 0; i < Math.ceil(0.45 / world.dt); i++) world.tick();
  assert.equal(world.zones.some(zone => zone.id === field.id), false);
  assert.notDeepEqual(world.projectiles[0]?.dir, [1, 0, 0]);
  assert.equal(world.drainEvents().some(event => event.type === 'projectile_scattered'), true);
});

test('ツバクロの呼び羽は刺さった刃だけを戻し、戻り線は同一対象へ最大3枚当たる', () => {
  const world = new World(buildMap(), MODE, COMBAT, 60);
  const tsubakuro = world.addPlayer('灯便', false, 0, 'tsubakuro');
  const target = world.addPlayer('標的', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  tsubakuro.move.pos = [0, 0, 10];
  tsubakuro.lastResourcePos = [...tsubakuro.move.pos];
  target.move.pos = [5, 0, 10];
  tsubakuro.weapon.ammo = 2;
  tsubakuro.resource.value = 20;
  tsubakuro.abilities.heroState.blades = [
    { id: 'blade-1', pos: [10, 0, 10], expiresAt: world.t + 6 },
    { id: 'blade-2', pos: [10, 0.2, 10], expiresAt: world.t + 6 },
    { id: 'blade-3', pos: [10, -0.2, 10], expiresAt: world.t + 6 },
    { id: 'blade-4', pos: [10, 0.1, 10], expiresAt: world.t + 6 },
  ];

  world.queueInput(tsubakuro.id, { ability2: true });
  world.tick();
  assert.ok(tsubakuro.abilities.cast, '指笛の0.3秒予兆が始まる');
  assert.equal(target.hp, target.maxHp);
  for (let i = 0; i < Math.ceil(0.35 / world.dt); i++) world.tick();

  assert.equal(target.hp, target.maxHp - 66, '同一対象は22x3が上限');
  assert.equal(tsubakuro.weapon.ammo, 6, '戻った4枚を弾倉へ補充する');
  assert.equal(tsubakuro.resource.value, 40, '戻った1枚ごとに勢い+5');
  assert.deepEqual(tsubakuro.abilities.heroState.blades, []);
});

test('必殺技の予兆中に撃破されると不発になりゲージ50%を返還する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 61);
  const asagi = world.addPlayer('測量士', false, 0, 'asagi');
  const enemy = world.addPlayer('妨害者', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  asagi.ultGauge = 100;

  world.queueInput(asagi.id, { ultimate: true });
  world.tick();
  assert.ok(asagi.abilities.cast);
  assert.equal(asagi.ultGauge, 0);
  world.applyDamage(asagi, asagi.maxHp + 100, enemy, false);

  assert.equal(asagi.alive, false);
  assert.equal(asagi.ultGauge, 50);
  assert.equal(asagi.abilities.cast, null);
  assert.equal(world.drainEvents().some(event => event.type === 'ability_interrupted' && event.abilityId === 'sarashibi'), true);
});

test('ザイルの投錨transitは壁手前の非重複位置で終了し実座標を通知する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 611);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  zairu.move.pos = [0, 0, 10];
  zairu.move.grounded = false;
  zairu.lastResourcePos = [...zairu.move.pos];
  world.collider = new Collider([{
    min: [2, -2, 9], max: [2.2, 2, 13], tag: 'transit-wall',
  }]);
  zairu.abilities.heroState.anchor = {
    pos: [5, 0, 10], origin: [...zairu.move.pos], expiresAt: world.t + 6,
  };
  world.drainEvents();

  assert.equal(tryActivateAbility(world, zairu, 'ability1'), true);
  world.t = zairu.abilities.cast.readyAt;
  tickAbilityState(world, zairu, 0);
  while (zairu.abilities.heroState.transit) {
    world.t += world.dt;
    tickAbilityState(world, zairu, world.dt);
  }

  assert.ok(
    zairu.move.pos[0] <= 2 - COMBAT.movement.capsuleRadiusM,
    `wall crossing: pos=${zairu.move.pos}`,
  );
  assert.equal(
    world.collider.overlapsCylinder(
      zairu.move.pos[0], zairu.move.pos[1], zairu.move.pos[2],
      COMBAT.movement.capsuleRadiusM, COMBAT.movement.standHeightM,
    ),
    false,
    `transit ended in solid: pos=${zairu.move.pos}`,
  );
  assert.deepEqual(
    world.drainEvents().find(event => event.type === 'ability_transit_ended')?.pos,
    zairu.move.pos,
  );
});

test('ザイルの上向きtransitは天井へ重ならず上階へ抜けない', () => {
  const world = new World(buildMap(), MODE, COMBAT, 612);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  zairu.move.pos = [0, 0, -1];
  zairu.move.grounded = false;
  zairu.lastResourcePos = [...zairu.move.pos];
  const ceiling = {
    min: [-10, -10, 1.64], max: [10, 10, 1.84], tag: 'transit-ceiling',
  };
  world.collider = new Collider([ceiling]);
  zairu.abilities.heroState.anchor = {
    pos: [0, 0, 3.4], origin: [...zairu.move.pos], expiresAt: world.t + 6,
  };

  assert.equal(tryActivateAbility(world, zairu, 'ability1'), true);
  world.t = zairu.abilities.cast.readyAt;
  tickAbilityState(world, zairu, 0);
  let overlappedAt = null;
  while (zairu.abilities.heroState.transit) {
    world.t += world.dt;
    tickAbilityState(world, zairu, world.dt);
    if (world.collider.overlapsCylinder(
      zairu.move.pos[0], zairu.move.pos[1], zairu.move.pos[2],
      COMBAT.movement.capsuleRadiusM, COMBAT.movement.standHeightM,
    )) overlappedAt ??= [...zairu.move.pos];
  }

  assert.equal(overlappedAt, null, `transit entered ceiling at ${overlappedAt}`);
  assert.ok(
    zairu.move.pos[2] + COMBAT.movement.standHeightM <= ceiling.min[2],
    `ceiling tunneling: pos=${zairu.move.pos}`,
  );
});

test('ザイルの手繰り寄せは0.9秒かけて錨を戻し、戻り線の敵を引く', () => {
  const world = new World(buildMap(), MODE, COMBAT, 62);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  const target = world.addPlayer('標的', false, 1, 'vesta');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  zairu.move.pos = [0, 0, 0];
  target.move.pos = [5, 0, 0];
  zairu.move.grounded = target.move.grounded = true;
  world.collider = new Collider([{ min: [-20, -20, -1], max: [20, 20, 0], tag: 'test-ground' }]);
  zairu.lastResourcePos = [...zairu.move.pos];
  zairu.abilities.heroState.anchor = { pos: [10, 0, 0], expiresAt: world.t + 6 };

  world.queueInput(zairu.id, { secondary: true });
  world.tick();
  assert.ok(zairu.abilities.heroState.anchorRecall);
  assert.equal(target.hp, target.maxHp, '開始tickで即時ダメージにしない');

  for (let i = 0; i < Math.ceil(0.95 / world.dt); i++) world.tick();
  assert.equal(target.hp, target.maxHp - 40);
  assert.ok(target.move.pos[0] < 5, 'ザイル側へ2m引き寄せられる');
  assert.equal(zairu.abilities.heroState.anchor, null);
  assert.ok(zairu.abilities.cooldowns.ability1 > 4.9 && zairu.abilities.cooldowns.ability1 <= 5);
});

test('ザイルの巻き戻しは楔へ瞬間移動せず20m/sの帰還線を移動する', () => {
  const world = new World(buildMap(), MODE, COMBAT, 63);
  const zairu = world.addPlayer('錨守', false, 0, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  zairu.move.pos = [20, 0, 10];
  zairu.lastResourcePos = [...zairu.move.pos];
  zairu.abilities.heroState.rewind = { pos: [0, 0, 10], expiresAt: world.t + 5 };

  world.queueInput(zairu.id, { ability2: true });
  world.tick();
  assert.ok(zairu.abilities.heroState.transit);
  assert.ok(zairu.move.pos[0] > 19, '発動tickでは楔へ瞬間移動しない');

  for (let i = 0; i < Math.ceil(0.4 / world.dt); i++) world.tick();
  assert.ok(zairu.move.pos[0] > 0 && zairu.move.pos[0] < 20, `帰還中x=${zairu.move.pos[0]}`);
  for (let i = 0; i < Math.ceil(0.8 / world.dt); i++) world.tick();
  assert.equal(zairu.abilities.heroState.transit, null);
  assert.ok(Math.abs(zairu.move.pos[0]) < 0.2, `帰還後x=${zairu.move.pos[0]}`);
});

test('コヨミの香炉は耐久60を持ち、敵射撃で破壊すると煙も消える', () => {
  const world = new World(buildMap(), MODE, COMBAT, 64);
  const koyomi = world.addPlayer('暦売り', false, 0, 'koyomi');
  const shooter = world.addPlayer('射手', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  koyomi.move.pos = [30, 10, 10];
  shooter.move.pos = [0, 0, 10];
  shooter.lastResourcePos = [...shooter.move.pos];
  const incense = {
    id: 'incense-test', kind: 'damage', abilityId: 'koyomi_incense_burner',
    ownerId: koyomi.id, team: koyomi.team, center: [10, 0, 10], radiusM: 4,
    expiresAt: world.t + 12, nextPulseAt: world.t + 10, followOwner: false,
    damagePerSec: 50, healPerSec: 0, allyStatus: null, enemyStatus: null,
    projectileSpeedMult: null, allyProjectileSpeedMult: null,
    hp: 60, maxHp: 60, hitRadiusM: 0.65, heightM: 1.2,
  };
  world.zones.push(incense);

  world.queueInput(shooter.id, { fire: true, yaw: 0, pitch: -0.08, interpMs: 0 });
  world.tick();
  const events = world.drainEvents();
  assert.ok(incense.hp <= 0, `香炉HP=${incense.hp}`);
  assert.equal(events.some(event => event.type === 'deployable_destroyed' && event.zone === incense.id), true);

  world.queueInput(shooter.id, { fire: false });
  world.tick();
  assert.equal(world.zones.some(zone => zone.id === incense.id), false, '破壊済み香炉の煙を次tickで除去する');
});

test('カズラの代受苦の大蔓は終了時に蓄えた痛みを一度だけ衝撃波として放つ', () => {
  const world = new World(buildMap(), MODE, COMBAT, 65);
  const kazura = world.addPlayer('蔓守', false, 0, 'kazura');
  const ally = world.addPlayer('庇護対象', false, 0, 'asagi');
  const enemy = world.addPlayer('敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = new Collider([{ min: [-20, -20, 0], max: [20, 20, 1], tag: 'floor' }]);
  kazura.move.pos = [0, 0, 1];
  ally.move.pos = [1, 0, 1];
  enemy.move.pos = [3, 0, 1];
  kazura.ultGauge = 100;

  assert.equal(tryActivateAbility(world, kazura, 'ultimate'), true);
  while (!kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end')) world.tick();
  world.applyDamage(ally, 50, enemy, false);
  assert.equal(kazura.resource.value, 10, '50 damageの40%を肩代わりし、その半分を痛みとして蓄える');
  const enemyHpBefore = enemy.hp;
  world.drainEvents();
  while (kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end')) world.tick();

  assert.equal(enemy.hp, enemyHpBefore - 10);
  assert.equal(kazura.resource.value, 0);
  assert.equal(kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end'), false);
  const shockwaves = world.drainEvents().filter(event => (
    event.type === 'ability_shockwave' && event.player === kazura.id
  ));
  assert.deepEqual(shockwaves, [{
    type: 'ability_shockwave', player: kazura.id, abilityId: 'daiukenoootsuru',
    amount: 10, radiusM: 14, pos: [0, 0, 1], targets: [enemy.id],
  }]);

  world.tick();
  assert.equal(enemy.hp, enemyHpBefore - 10, '期限切れstatusを再処理しない');
  assert.equal(world.drainEvents().some(event => event.type === 'ability_shockwave'), false);
});

test('カズラが代受苦の大蔓中に倒れると痛みを失い衝撃波は不発になる', () => {
  const world = new World(buildMap(), MODE, COMBAT, 66);
  const kazura = world.addPlayer('蔓守', false, 0, 'kazura');
  const enemy = world.addPlayer('敵', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = new Collider([{ min: [-20, -20, 0], max: [20, 20, 1], tag: 'floor' }]);
  kazura.move.pos = [0, 0, 1];
  enemy.move.pos = [3, 0, 1];
  kazura.ultGauge = 100;

  assert.equal(tryActivateAbility(world, kazura, 'ultimate'), true);
  while (!kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end')) world.tick();
  kazura.resource.value = 25;
  world.applyDamage(kazura, kazura.hp + 100, enemy, false);

  assert.equal(kazura.alive, false);
  assert.equal(kazura.resource.value, 0, '倒れた時点で蓄積した痛みを失う');
  const enemyHpAfterKill = enemy.hp;
  world.drainEvents();
  for (let i = 0; i < Math.ceil(9 / world.dt); i++) world.tick();
  assert.equal(enemy.hp, enemyHpAfterKill);
  assert.equal(world.drainEvents().some(event => event.type === 'ability_shockwave'), false);
});

test('代受苦の大蔓の衝撃波は3D射程とworld・barrier・deployableの遮蔽を尊重する', async t => {
  const cases = [
    {
      name: '3D range',
      enemyPos: [13.99, 0, 1],
      configure() {},
    },
    {
      name: 'world',
      enemyPos: [3, 0, 1],
      configure(world) {
        world.collider = new Collider([
          { min: [-20, -20, 0], max: [20, 20, 1], tag: 'floor' },
          { min: [1.4, -1, 0.9], max: [1.6, 1, 3], tag: 'cover' },
        ]);
      },
    },
    {
      name: 'barrier',
      enemyPos: [3, 0, 1],
      configure(world) {
        world.barriers.push({
          id: 'shockwave-barrier', team: 1, center: [1.5, 0, 1],
          radiusM: 0.3, heightM: 3, hp: 300, friendlyPass: true,
          expiresAt: world.t + 20,
        });
      },
    },
    {
      name: 'deployable',
      enemyPos: [3, 0, 1],
      configure(world) {
        world.zones.push({
          id: 'shockwave-deployable', team: 1, center: [1.5, 0, 1],
          radiusM: 4, hitRadiusM: 0.65, heightM: 1.2, hp: 60,
          expiresAt: world.t + 20,
        });
      },
    },
  ];

  for (const [index, scenario] of cases.entries()) await t.test(scenario.name, () => {
    const world = new World(buildMap(), MODE, COMBAT, 70 + index);
    const kazura = world.addPlayer('蔓守', false, 0, 'kazura');
    const enemy = world.addPlayer('敵', false, 1, 'asagi');
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.collider = new Collider([{ min: [-20, -20, 0], max: [20, 20, 1], tag: 'floor' }]);
    kazura.move.pos = [0, 0, 1];
    enemy.move.pos = [...scenario.enemyPos];
    kazura.ultGauge = 100;

    assert.equal(tryActivateAbility(world, kazura, 'ultimate'), true);
    while (!kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end')) world.tick();
    kazura.resource.value = 12;
    scenario.configure(world);
    world.drainEvents();
    while (kazura.abilities.statuses.some(status => status.id === 'daiukenoootsuru:end')) world.tick();

    assert.equal(enemy.hp, enemy.maxHp, scenario.name);
    assert.equal(kazura.resource.value, 0, scenario.name);
    const shockwave = world.drainEvents().find(event => event.type === 'ability_shockwave');
    assert.deepEqual(shockwave?.targets, [], scenario.name);
  });
});
