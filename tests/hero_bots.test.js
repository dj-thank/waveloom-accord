import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController, deriveFrontlineAnchor } from '../server/bots.js';
import { HEROES } from '../shared/data/heroes.js';
import { MODE, COMBAT } from './helpers.js';

function makeBot(heroId = 'asagi') {
  const world = new World(buildMap(), MODE, COMBAT, 73);
  const player = world.addPlayer('bot', true, 0, heroId);
  const bot = new BotController(world, player, () => 0.5);
  return { world, player, bot };
}

function worldMoveVector(input) {
  const cos = Math.cos(input.yaw);
  const sin = Math.sin(input.yaw);
  return [
    (input.f ? cos : 0) - (input.b ? cos : 0) +
      (input.l ? -sin : 0) + (input.r ? sin : 0),
    (input.f ? sin : 0) - (input.b ? sin : 0) +
      (input.l ? cos : 0) - (input.r ? cos : 0),
  ];
}

function teamForward(world, team) {
  return world.sideOf(team) === 'east' ? [-1, 0] : [1, 0];
}

test('frontline anchor has mirrored objective-facing progress for both team sides', () => {
  assert.deepEqual(deriveFrontlineAnchor([0, 0, 2.5], 'east', [8, 3, 10]), {
    position: [8, 3],
    forward: [-1, 0],
    progress: -8,
  });
  assert.deepEqual(deriveFrontlineAnchor([0, 0, 2.5], 'west', [-8, -3, 10]), {
    position: [-8, -3],
    forward: [1, 0],
    progress: -8,
  });
});

test('bot input travels through queueInput with a monotonically increasing sequence', () => {
  const { player, bot } = makeBot();

  bot.think(1 / COMBAT.tickRateHz);
  assert.equal(player.lastAckSeq, 1);
  assert.equal(player.input.seq, 1);

  bot.think(1 / COMBAT.tickRateHz);
  assert.equal(player.lastAckSeq, 2);
  assert.equal(player.input.seq, 2);
});

test('frontline advances into the space between its team and a nearby enemy with support', () => {
  const { world, player, bot } = makeBot('zairu');
  const ally = world.addPlayer('ally', false, 0, 'asagi');
  const support = world.addPlayer('support', false, 0, 'koyomi');
  const enemy = world.addPlayer('enemy', false, 1, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  ally.move.pos = [-6, 0, 10];
  support.move.pos = [-4, 3, 10];
  enemy.move.pos = [12, 0, 10];

  bot.think(world.dt);

  assert.equal(player.input.f, true);
  assert.equal(player.input.b, false);
});

test('healthy tank contests an occupied objective when allies and support are nearby', () => {
  const { world, player, bot } = makeBot('zairu');
  const support = world.addPlayer('support', false, 0, 'koyomi');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  const [forwardX] = teamForward(world, player.team);
  const center = world.map.objective.center;
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [center[0] - forwardX * 6, center[1], 10];
  support.move.pos = [player.move.pos[0] - forwardX * 3, center[1], 10];
  damage.move.pos = [player.move.pos[0] - forwardX * 2, center[1] + 3, 10];
  enemy.move.pos = [center[0], center[1], 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX > 0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('wounded tank retreats from an occupied objective toward nearby support', () => {
  const { world, player, bot } = makeBot('zairu');
  const support = world.addPlayer('support', false, 0, 'koyomi');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  const [forwardX] = teamForward(world, player.team);
  const center = world.map.objective.center;
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [center[0] - forwardX * 6, center[1], 10];
  player.hp = player.maxHp * 0.4;
  support.move.pos = [player.move.pos[0] - forwardX * 5, center[1], 10];
  damage.move.pos = [player.move.pos[0] - forwardX * 2, center[1] + 3, 10];
  enemy.move.pos = [center[0], center[1], 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('healthy tank retreats when its support and team are out of engagement reach', () => {
  const { world, player, bot } = makeBot('zairu');
  const support = world.addPlayer('support', false, 0, 'koyomi');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  const [forwardX] = teamForward(world, player.team);
  const center = world.map.objective.center;
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [center[0] - forwardX * 6, center[1], 10];
  damage.move.pos = [player.move.pos[0] - forwardX * 2, center[1] + 3, 10];
  support.move.pos = [player.move.pos[0] - forwardX * 24, center[1], 10];
  enemy.move.pos = [center[0], center[1], 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('critical tank close-range retreat is not redirected toward an offset support', () => {
  const { world, player, bot } = makeBot('zairu');
  const support = world.addPlayer('support', false, 0, 'koyomi');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  player.hp = player.maxHp * 0.2;
  support.move.pos = [-forwardX, 5, 10];
  damage.move.pos = [-forwardX * 2, 0, 10];
  enemy.move.pos = [forwardX, 0, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('damage hero backs out of close range while keeping a lateral flank', () => {
  const { world, player, bot } = makeBot('asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [4, 0, 10];

  bot.think(world.dt);

  assert.equal(player.input.b, true);
  assert.equal(player.input.f, false);
  assert.equal(player.input.l || player.input.r, true);
});

test('damage on the front route falls behind its tank instead of outrunning the frontline', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'front';
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [forwardX * 15, 0, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('damage flank is pulled back after exceeding its bounded lead past the tank', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [tank.move.pos[0] + forwardX * 10, 8, 10];
  enemy.move.pos = [player.move.pos[0] + forwardX * 15, 8, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('damage on a side route collapses an angle that is too wide for the frontline', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  bot.strafeDir = -forwardX;
  bot.strafeT = 1;
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [tank.move.pos[0] + forwardX, 20, 10];
  enemy.move.pos = [player.move.pos[0] + forwardX * 15, 20, 10];

  bot.think(world.dt);

  const [, moveY] = worldMoveVector(player.input);
  assert.ok(moveY < -0.6, `moveY=${moveY}`);
});

test('damage on a side route takes its deterministic flank angle during engagement', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  const routeSide = world.sideOf(player.team) === 'east' ? 1 : -1;
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  bot.strafeDir = -1;
  bot.strafeT = 1;
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [tank.move.pos[0] - forwardX * 2, 0, 10];
  enemy.move.pos = [player.move.pos[0] + forwardX * 18, 0, 10];

  bot.think(world.dt);

  const [, moveY] = worldMoveVector(player.input);
  assert.ok(moveY * routeSide > 0.6, `moveY=${moveY}, routeSide=${routeSide}`);
});

test('damage keeps its authored side route before engagement', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  bot.mode = 'advance';
  const points = bot.routePoints();
  bot.wpIndex = 4;
  player.move.pos = [...points[3]];
  tank.move.pos = [player.move.pos[0], 0, player.move.pos[2]];
  const targetDelta = [
    points[4][0] - player.move.pos[0],
    points[4][1] - player.move.pos[1],
  ];
  const targetLength = Math.hypot(...targetDelta);

  bot.think(world.dt);

  const [moveX, moveY] = worldMoveVector(player.input);
  const routeProgress = (moveX * targetDelta[0] + moveY * targetDelta[1]) / targetLength;
  assert.ok(routeProgress > 0.6, `routeProgress=${routeProgress}`);
});

test('an isolated damage bot waits instead of steering straight through walls to a distant tank', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [tank.move.pos[0] + forwardX * 10, 30, 10];
  enemy.move.pos = [player.move.pos[0] + forwardX * 15, 30, 10];

  bot.think(world.dt);

  assert.deepEqual(
    [player.input.f, player.input.b, player.input.l, player.input.r],
    [false, false, false, false],
  );
});

test('damage close-range escape takes priority over forming a flank angle', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  player.move.pos = [0, 0, 10];
  tank.move.pos = [-forwardX * 2, 0, 10];
  enemy.move.pos = [forwardX * 4, 0, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('support aims at a wounded ally and retreats from a nearby enemy', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  ally.move.pos = [0, 8, 10];
  ally.hp = ally.maxHp * 0.35;
  enemy.move.pos = [6, 0, 10];

  bot.think(world.dt);

  assert.ok(Math.abs(player.input.yaw - Math.PI / 2) < 0.08, `yaw=${player.input.yaw}`);
  const cos = Math.cos(player.input.yaw);
  const sin = Math.sin(player.input.yaw);
  const moveX = (player.input.f ? cos : 0) - (player.input.b ? cos : 0) +
    (player.input.l ? -sin : 0) + (player.input.r ? sin : 0);
  const moveY = (player.input.f ? sin : 0) - (player.input.b ? sin : 0) +
    (player.input.l ? cos : 0) - (player.input.r ? cos : 0);
  assert.ok(moveX < -0.6 && Math.abs(moveY) < 0.2, `move=[${moveX},${moveY}]`);
});

test('support outside useful reach moves back toward its tank', () => {
  const { world, player, bot } = makeBot('koyomi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.strafeDir = -forwardX;
  bot.strafeT = 1;
  player.move.pos = [0, 20, 10];
  tank.move.pos = [0, 0, 10];
  enemy.move.pos = [forwardX * 18, 20, 10];

  bot.think(world.dt);

  const [, moveY] = worldMoveVector(player.input);
  assert.ok(moveY < -0.6, `moveY=${moveY}`);
});

test('support inside ability reach still falls behind the tank frontline', () => {
  const { world, player, bot } = makeBot('koyomi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  tank.move.pos = [-forwardX * 8, 0, 10];
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [forwardX * 18, 0, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('ability decisions are emitted as press-release pulses', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.weapon.ammo = 0;

  const uses = [];
  for (let tick = 0; tick < 3; tick++) {
    bot.think(world.dt);
    world.tick();
    uses.push(world.drainEvents().filter(event => event.type === 'ability_used' && event.slot === 'secondary').length);
  }

  assert.deepEqual(uses, [1, 0, 1]);
  assert.equal(player.lastAckSeq, 3);
});

test('all 18 heroes make an eligible combat-action decision in a dense team fight', () => {
  const missing = [];
  for (const hero of HEROES) {
    const { world, player, bot } = makeBot(hero.id);
    const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
    const enemyA = world.addPlayer('enemy a', false, 1, 'zairu');
    const enemyB = world.addPlayer('enemy b', false, 1, 'baraga');
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.objective.owner = 1;
    player.move.pos = [0, 0, 10];
    ally.move.pos = [0, 6, 10];
    ally.hp = ally.maxHp * 0.35;
    ally.abilities.cooldowns.ability1 = 9;
    enemyA.move.pos = [14, 0, 10];
    enemyB.move.pos = [15, 2, 10];
    if (player.resource) player.resource.value = player.resource.max;
    player.weapon.ammo = Math.min(player.weapon.ammo, Math.floor(hero.weapon.magSize / 2));

    bot.think(world.dt);
    world.tick();
    const events = world.drainEvents();
    if (!events.some(event => event.player === player.id &&
      (event.type === 'ability_used' || event.type === 'ability_windup'))) {
      missing.push(hero.id);
    }
  }

  assert.deepEqual(missing, []);
});

test('all 18 heroes spend a ready ultimate in a favorable team fight', () => {
  const distanceByHero = { shirasagi: 24, hokuchi: 5 };
  const missing = [];
  for (const hero of HEROES) {
    const { world, player, bot } = makeBot(hero.id);
    const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
    const enemyA = world.addPlayer('enemy a', false, 1, 'zairu');
    const enemyB = world.addPlayer('enemy b', false, 1, 'baraga');
    const distance = distanceByHero[hero.id] || 14;
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.objective.owner = 1;
    player.move.pos = [0, 0, 10];
    player.hp = player.maxHp * 0.6;
    player.ultGauge = 100;
    ally.move.pos = [0, 6, 10];
    ally.hp = ally.maxHp * 0.35;
    ally.abilities.cooldowns.ability1 = 20;
    enemyA.move.pos = [distance, 0, 10];
    enemyB.move.pos = [distance, 2, 10];
    if (player.resource) player.resource.value = player.resource.max;

    bot.think(world.dt);
    world.tick();
    let events = world.drainEvents();
    for (let tick = 0; tick < Math.ceil(1.3 / world.dt) &&
      !events.some(event => event.type === 'ultimate_used' && event.player === player.id); tick++) {
      world.tick();
      events = events.concat(world.drainEvents());
    }
    if (!events.some(event => event.type === 'ultimate_used' && event.player === player.id)) missing.push(hero.id);
  }

  assert.deepEqual(missing, []);
});

test('a bot does not hoard a full ultimate during an otherwise valid duel', () => {
  const { world, player, bot } = makeBot('nuedori');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.move.pos = [0, 0, 10];
  player.ultGauge = 100;
  enemy.move.pos = [14, 0, 10];

  bot.think(world.dt);

  assert.equal(player.input.ultimate, true);
});

test('Nuedori keeps its self-centered ultimate when enemies are outside its radius', () => {
  const { world, player, bot } = makeBot('nuedori');
  const enemyA = world.addPlayer('enemy a', false, 1, 'sedora');
  const enemyB = world.addPlayer('enemy b', false, 1, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.move.pos = [0, 0, 10];
  player.ultGauge = 100;
  enemyA.move.pos = [30, 0, 10];
  enemyB.move.pos = [30, 2, 10];

  bot.think(world.dt);

  assert.equal(player.input.ultimate, false);
});

test('a full gauge does not bypass Hokuchi ultimate range', () => {
  const { world, player, bot } = makeBot('hokuchi');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.move.pos = [0, 0, 10];
  player.ultGauge = 100;
  enemy.move.pos = [14, 0, 10];

  bot.think(world.dt);

  assert.equal(player.input.ultimate, false);
});

test('a full gauge does not bypass Koyomi cooldown benefit', () => {
  const { world, player, bot } = makeBot('koyomi');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.move.pos = [0, 0, 10];
  player.ultGauge = 100;
  enemy.move.pos = [14, 0, 10];

  bot.think(world.dt);

  assert.equal(player.input.ultimate, false);
});

test('a long-held full gauge uses Hokuchi ultimate only once its aura can hit', () => {
  const { world, player, bot } = makeBot('hokuchi');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.ultGauge = 100;
  enemy.maxHp = 100_000;
  enemy.hp = enemy.maxHp;
  for (const slot of ['secondary', 'ability1', 'ability2']) player.abilities.cooldowns[slot] = 99;

  let castOutOfRange = false;
  for (let tick = 0; tick < Math.ceil(9 / world.dt); tick++) {
    player.move.pos = [0, 0, 10];
    enemy.move.pos = [14, 0, 10];
    bot.think(world.dt);
    castOutOfRange ||= player.input.ultimate;
    world.tick();
    world.drainEvents();
  }
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [8, 0, 10];
  bot.think(world.dt);
  const castOutsideAura = player.input.ultimate;
  world.tick();
  world.drainEvents();

  player.move.pos = [0, 0, 10];
  enemy.move.pos = [5, 0, 10];
  bot.think(world.dt);
  const events = [];
  for (let tick = 0; tick < Math.ceil(0.4 / world.dt); tick++) {
    player.move.pos = [0, 0, 10];
    enemy.move.pos = [5, 0, 10];
    world.tick();
    events.push(...world.drainEvents());
  }

  assert.equal(castOutOfRange, false);
  assert.equal(castOutsideAura, false);
  assert.equal(events.some(event => event.type === 'ultimate_used' && event.abilityId === 'oohimatsuri'), true);
  assert.equal(events.some(event => event.type === 'hit' && event.abilityId === 'oohimatsuri'), true);
});

test('a long-held full gauge uses Koyomi ultimate only when cooldown recovery has value', () => {
  const { world, player, bot } = makeBot('koyomi');
  const ally = world.addPlayer('ally', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.ultGauge = 100;
  player.resource.value = 0;
  ally.move.pos = [0, 6, 10];
  enemy.maxHp = 100_000;
  enemy.hp = enemy.maxHp;

  let castWithoutBenefit = false;
  for (let tick = 0; tick < Math.ceil(9 / world.dt); tick++) {
    player.move.pos = [0, 0, 10];
    enemy.move.pos = [15, 0, 10];
    bot.think(world.dt);
    castWithoutBenefit ||= player.input.ultimate;
    world.tick();
    world.drainEvents();
  }
  ally.abilities.cooldowns.ability1 = 8;
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [15, 0, 10];
  bot.think(world.dt);

  assert.equal(castWithoutBenefit, false);
  assert.equal(player.input.ultimate, true);
});

test('a long-held full gauge does not make Baraga fortify outside combat', () => {
  const { world, player, bot } = makeBot('baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = player.team;
  player.hp = player.maxHp * 0.5;
  player.ultGauge = 100;
  for (const slot of ['secondary', 'ability1', 'ability2']) player.abilities.cooldowns[slot] = 99;

  bot.think(world.dt);
  world.t = 9;
  bot.think(world.dt);

  assert.equal(player.input.ultimate, false);
});

test('a long-held full gauge does not make Hibari trail without a wounded ally', () => {
  const { world, player, bot } = makeBot('hibari');
  const ally = world.addPlayer('ally', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.objective.owner = enemy.team;
  player.move.pos = [0, 0, 10];
  player.ultGauge = 100;
  ally.move.pos = [0, 6, 10];
  enemy.move.pos = [14, 0, 10];
  for (const slot of ['secondary', 'ability1', 'ability2']) player.abilities.cooldowns[slot] = 99;

  bot.think(world.dt);
  world.t = 9;
  bot.think(world.dt);

  assert.equal(player.input.ultimate, false);
});

test('every remaining hero has a conservative one-target opportunity after holding a full gauge', () => {
  const cases = [
    ['zairu', {}],
    ['baraga', { distance: 6 }],
    ['vesta', {}],
    ['sedora', {}],
    ['shiomaneki', {}],
    ['asagi', {}],
    ['tsubakuro', { resource: 0 }],
    ['botan', {}],
    ['ankou', {}],
    ['tsuzuri', { allyHp: 0.8, storedHeal: 40 }],
    ['karakasa', {}],
    ['shirabe', {}],
    ['hibari', { allyHp: 0.7, allyDistance: 3 }],
    ['kazura', { allyHp: 0.7 }],
  ];
  const castImmediately = [];
  const stillHoarding = [];

  for (const [heroId, setup] of cases) {
    const { world, player, bot } = makeBot(heroId);
    const ally = world.addPlayer('ally', false, 0, 'asagi');
    const enemy = world.addPlayer('enemy', false, 1, 'sedora');
    const distance = setup.distance || 14;
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.objective.owner = player.team;
    player.move.pos = [0, 0, 10];
    player.ultGauge = 100;
    if (player.resource) player.resource.value = setup.resource ?? player.resource.max;
    for (const slot of ['secondary', 'ability1', 'ability2']) player.abilities.cooldowns[slot] = 99;
    ally.move.pos = [0, setup.allyDistance || 6, 10];
    ally.hp = ally.maxHp * (setup.allyHp || 1);
    enemy.move.pos = [distance, 0, 10];
    if (setup.storedHeal) ally.abilities.statuses.push({
      id: 'stored', kind: 'stored_heal', sourceId: player.id, amount: setup.storedHeal,
      convertAt: 30, expiresAt: 60,
    });

    bot.think(world.dt);
    if (player.input.ultimate) castImmediately.push(heroId);
    world.t = 9;
    bot.think(world.dt);
    if (!player.input.ultimate) stillHoarding.push(heroId);
  }

  assert.deepEqual(castImmediately, []);
  assert.deepEqual(stillHoarding, []);
});

test('the six frozen hero identities drive their signature decisions', () => {
  const cases = [
    ['zairu', 'toubyou', { resource: 100, enemies: 1 }],
    ['vesta', 'henkoya', { resource: 100, enemies: 2 }],
    ['asagi', 'shirubeya', { resource: 0, enemies: 1 }],
    ['tsubakuro', 'tsubamegaeshi', { resource: 100, enemies: 1 }],
    ['tsuzuri', 'tsuzuriwatari', { resource: 12, enemies: 1 }],
    ['koyomi', 'hayamawashi', { resource: 100, enemies: 1 }],
  ];
  const decisions = {};

  for (const [heroId, expected, setup] of cases) {
    const { world, player, bot } = makeBot(heroId);
    const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    player.move.pos = [0, 0, 10];
    ally.move.pos = [0, 6, 10];
    ally.hp = ally.maxHp * 0.35;
    ally.abilities.cooldowns.ability1 = 9;
    for (let index = 0; index < setup.enemies; index++) {
      const enemy = world.addPlayer(`enemy ${index}`, false, 1, 'baraga');
      enemy.move.pos = [14, index * 2, 10];
    }
    if (player.resource) player.resource.value = setup.resource;
    player.weapon.ammo = HEROES.find(hero => hero.id === heroId).weapon.magSize;

    bot.think(world.dt);
    world.tick();
    decisions[heroId] = world.drainEvents().find(event => event.player === player.id &&
      (event.type === 'ability_used' || event.type === 'ability_windup'))?.abilityId;
    assert.equal(decisions[heroId], expected);
  }
});

test('Tsuzuri primary fire stores healing on the wounded ally it prioritizes', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'zairu');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  ally.move.pos = [0, 8, 10];
  ally.hp = ally.maxHp * 0.35;
  enemy.move.pos = [18, 0, 10];

  bot.think(world.dt);
  world.tick();
  for (let tick = 0; tick < Math.ceil(0.3 / world.dt); tick++) world.tick();

  assert.equal(
    ally.abilities.statuses.some(status => status.kind === 'stored_heal' && status.sourceId === player.id),
    true,
  );
});

test('support healing does not wait for an enemy to appear', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  ally.move.pos = [0, 8, 10];
  ally.hp = ally.maxHp * 0.35;

  bot.think(world.dt);

  assert.equal(player.input.primary, true);
  assert.equal(player.input.fire, true);
  assert.ok(Math.abs(player.input.yaw - Math.PI / 2) < 0.08, `yaw=${player.input.yaw}`);
});

test('every hero policy can choose each of its four actions when that action alone is ready', () => {
  const slots = ['secondary', 'ability1', 'ability2', 'ultimate'];
  const overrides = {
    'zairu:secondary': { anchor: true },
    'zairu:ability2': { selfHp: 0.5 },
    'vesta:ability1': { distance: 4 },
    'vesta:ability2': { distance: 4, ownZone: true },
    'nuedori:secondary': { distance: 4 },
    'shiomaneki:secondary': { distance: 18 },
    'shiomaneki:ability2': { distance: 4 },
    'asagi:ability1': { resource: 0 },
    'asagi:ability2': { distance: 4 },
    'shirasagi:secondary': { distance: 4 },
    'shirasagi:ability2': { distance: 4 },
    'shirasagi:ultimate': { distance: 24 },
    'tsubakuro:ability1': { resource: 0 },
    'tsubakuro:ability2': { ammo: 0 },
    'hokuchi:ultimate': { distance: 4 },
    'botan:ability2': { distance: 4 },
    'ankou:ability2': { distance: 4 },
    'tsuzuri:secondary': { ammo: 0 },
    'tsuzuri:ability2': { storedHeal: 80 },
    'baraga:ability2': { distance: 4 },
    'karakasa:ability2': { distance: 4 },
    'shirabe:ability2': { allyDistance: 10 },
    'hibari:secondary': { distance: 4 },
    'hibari:ability2': { allyDistance: 4 },
    'kazura:ability2': { distance: 4 },
  };
  const missing = [];

  for (const hero of HEROES) {
    for (const slot of slots) {
      const setup = overrides[`${hero.id}:${slot}`] || {};
      const { world, player, bot } = makeBot(hero.id);
      const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
      const distance = setup.distance || 14;
      world.flow.state = 'ACTIVE';
      world.objective.unseal();
      world.objective.owner = 1;
      player.move.pos = [0, 0, 10];
      player.hp = player.maxHp * (setup.selfHp || 0.6);
      ally.move.pos = [0, setup.allyDistance || 6, 10];
      ally.hp = ally.maxHp * 0.35;
      ally.abilities.cooldowns.ability1 = 20;
      for (let index = 0; index < 2; index++) {
        const enemy = world.addPlayer(`enemy ${index}`, false, 1, 'baraga');
        enemy.move.pos = [distance, index * 2, 10];
      }
      if (player.resource) {
        player.resource.value = setup.resource === undefined ? player.resource.max : setup.resource;
      }
      player.weapon.ammo = setup.ammo === undefined ? hero.weapon.magSize : setup.ammo;
      for (const actionSlot of ['secondary', 'ability1', 'ability2']) {
        player.abilities.cooldowns[actionSlot] = actionSlot === slot ? 0 : 99;
      }
      player.ultGauge = slot === 'ultimate' ? 100 : 0;
      if (setup.anchor) player.abilities.heroState.anchor = { pos: [distance, 0, 10] };
      if (setup.ownZone) world.zones.push({ ownerId: player.id });
      if (setup.storedHeal) ally.abilities.statuses.push({
        id: 'stored', kind: 'stored_heal', sourceId: player.id, amount: setup.storedHeal,
        convertAt: world.t + 5, expiresAt: world.t + 8,
      });

      bot.think(world.dt);
      if (!player.input[slot]) missing.push(`${hero.id}:${slot}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('enemy-targeted support abilities keep enemy aim even while an ally needs help', () => {
  const { world, player, bot } = makeBot('koyomi');
  const ally = world.addPlayer('wounded ally', false, 0, 'asagi');
  const enemyA = world.addPlayer('enemy a', false, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', false, 1, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.move.pos = [0, 0, 10];
  ally.move.pos = [0, 6, 10];
  ally.hp = ally.maxHp * 0.35;
  enemyA.move.pos = [14, 0, 10];
  enemyB.move.pos = [14, 2, 10];
  player.resource.value = player.resource.max;
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability1 = 99;
  player.abilities.cooldowns.ability2 = 0;

  bot.think(world.dt);

  assert.equal(player.input.ability2, true);
  assert.ok(Math.abs(player.input.yaw) < 0.08, `yaw=${player.input.yaw}`);
});

test('headless rotates all heroes across seeds and reports action and healing statistics', { timeout: 30_000 }, () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, [
    'tools/headless.js', '--matches', '2', '--seed', '20260719', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8' });
  const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1));

  assert.equal(summary.roster.uniqueHeroes, 18);
  assert.equal(summary.seeds.length, 2);
  assert.ok(summary.actions.abilities > 0);
  assert.ok(summary.actions.ultimates > 0);
  assert.ok(summary.ultimateEconomy.averageUses >= 2 && summary.ultimateEconomy.averageUses <= 4.5);
  assert.ok(summary.ultimateEconomy.zeroUseRate <= 0.15);
  assert.ok(summary.ultimateEconomy.maxUses <= 8);
  assert.ok(summary.healing.events > 0);
  assert.ok(summary.healing.amount > 0);
});
