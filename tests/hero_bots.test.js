import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { Collider } from '../shared/sim/collision.js';
import { eyePosition } from '../shared/sim/combat.js';
import { canAffectPoint } from '../shared/sim/spatial_query.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import {
  BotController, botAimFloorDeg, deriveFrontlineAnchor, deriveTeamTacticalIntent,
} from '../server/bots.js';
import { makeBotRng } from '../server/bot_fairness.js';
import { canTraverseGroundSegment } from '../server/bot_navigation.js';
import { HEROES } from '../shared/data/heroes.js';
import { competitiveBotRotation } from '../shared/rules/bot_roster.js';
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

test('bot angular error preserves a fair body-scale aim envelope at long range', () => {
  assert.equal(botAimFloorDeg(10), 0.8);
  assert.ok(botAimFloorDeg(50) < 0.3, `floor=${botAimFloorDeg(50)}`);
  const lateralErrorM = Math.tan(botAimFloorDeg(50) * Math.PI / 180) * 50;
  assert.ok(lateralErrorM >= 0.19 && lateralErrorM <= 0.21, `lateral=${lateralErrorM}`);
});

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

test('owned-objective hold posts mirror by logical hero despite physical player ID reallocation', () => {
  const holdMovement = (sides, heroOrder) => {
    const world = new World(buildMap(), MODE, COMBAT, 20260723);
    world.flow.sides = [...sides];
    const roster = heroOrder.map(heroId => (
      world.addPlayer(`logical-${heroId}`, true, 0, heroId)
    ));
    const player = roster.find(candidate => candidate.heroId === 'shirasagi');
    const bot = new BotController(world, player, makeBotRng(world.seed, player, roster));
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.objective.owner = player.team;
    world.collider.dynamic = [];
    for (const teammate of roster) teammate.move.pos = [0, 0, 4];
    bot.mode = 'hold';

    bot.think(world.dt);

    return worldMoveVector(player.input);
  };

  const east = holdMovement(['east', 'west'], ['asagi', 'hokuchi', 'shirasagi']);
  const west = holdMovement(['west', 'east'], ['shirasagi', 'hokuchi', 'asagi']);
  assert.ok(Math.hypot(east[0] + west[0], east[1] + west[1]) < 1e-9,
    JSON.stringify({ east, west }));
});

test('combat-context ally ties mirror by logical hero instead of player insertion order', () => {
  const selectedAllies = (sides, heroOrder) => {
    const world = new World(buildMap(), MODE, COMBAT, 20260723);
    world.flow.sides = [...sides];
    const player = world.addPlayer('logical-utility', true, 0, 'karakasa');
    const allies = heroOrder.map(heroId => (
      world.addPlayer(`logical-${heroId}`, true, 0, heroId)
    ));
    const bot = new BotController(world, player, makeBotRng(world.seed, player, [player, ...allies]));
    world.collider = { raycast: () => Infinity };
    const rotation = world.sideOf(player.team) === 'east' ? 1 : -1;
    player.move.pos = [0, 0, 4];
    allies[0].move.pos = [rotation * 4, rotation * 3, 4];
    allies[1].move.pos = [rotation * 4, rotation * -3, 4];

    const context = bot.combatContext();
    return {
      nearestAlly: context.nearestAlly?.heroId,
      sustain: context.sustain?.heroId,
    };
  };

  const east = selectedAllies(['east', 'west'], ['hibari', 'tsuzuri']);
  const west = selectedAllies(['west', 'east'], ['tsuzuri', 'hibari']);
  assert.deepEqual(east, { nearestAlly: 'hibari', sustain: 'hibari' });
  assert.deepEqual(west, east);
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

test('regroup does not release with only one nearby ally when frontline and sustain are absent', () => {
  const { world, player, bot } = makeBot('asagi');
  const ally = world.addPlayer('lonely-ally', true, 0, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  player.move.pos = [0, 0, 10]; ally.move.pos = [2, 0, 10];
  bot.mode = 'regroup'; bot.regroupT = 0;
  bot.think(world.dt);
  assert.equal(bot.mode, 'regroup');
});

test('side-route DPS does not flank while its own tank is dead or team is outnumbered', () => {
  const { world, player, bot } = makeBot('asagi');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  bot.route = 'cloister'; player.move.pos = [0, 8, 10]; enemy.move.pos = [8, 8, 10];
  bot.think(world.dt);
  assert.equal(bot.mode, 'regroup');
});

test('a casualty makes a complete bot team disengage and move toward its regroup staging point', () => {
  const { world, player, bot } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'ibuki');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'asagi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const [forwardX] = teamForward(world, 0);
  const x = -forwardX * 8;
  for (const [index, ally] of [player, damageA, damageB, sustain, utility].entries()) {
    ally.move.pos = [x - forwardX * index * 0.4, index - 2, 4];
  }
  utility.alive = false;
  enemy.move.pos = [x + forwardX * 6, 0, 4];
  bot.mode = 'fight';

  bot.think(world.dt);

  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  const towardStaging = [staging[0] - player.move.pos[0], staging[1] - player.move.pos[1]];
  const move = worldMoveVector(player.input);
  assert.equal(bot.mode, 'regroup');
  assert.equal(player.input.fire, false);
  assert.ok(move[0] * towardStaging[0] + move[1] * towardStaging[1] > 0);
});

test('a fresh non-core casualty opens one bounded trade window before regroup', () => {
  const { world, player: tank } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const ally of [tank, damageA, damageB, sustain, utility]) ally.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  for (const [index, ally] of [tank, damageA, damageB, sustain, utility].entries()) {
    ally.move.pos = [frontX - forwardX * index * 0.3, index - 2, 4];
  }
  enemy.move.pos = [frontX + forwardX * 6, 0, 4];
  world.t += world.dt; world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');

  world.eliminatePlayer(damageA, { source: enemy });
  world.t += world.dt; world.objective.time += world.dt;
  const trading = deriveTeamTacticalIntent(world, 0);
  assert.equal(trading.tradeWindowActive, true);
  assert.equal(trading.phase, 'pressure');

  world.t += 2.6; world.objective.time += 2.6;
  const expired = deriveTeamTacticalIntent(world, 0);
  assert.equal(expired.tradeWindowActive, false);
  assert.equal(expired.phase, 'regroup');
});

test('a primary support casualty keeps a bounded trade window while a damage recovery provider remains', () => {
  const { world, player: tank } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const ally of [tank, damageA, damageB, sustain, utility]) ally.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  for (const [index, ally] of [tank, damageA, damageB, sustain, utility].entries()) {
    ally.move.pos = [frontX - forwardX * index * 0.3, index - 2, 4];
  }
  enemy.move.pos = [frontX + forwardX * 6, 0, 4];
  world.t += world.dt; world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');

  world.eliminatePlayer(sustain, { source: enemy });
  world.t += world.dt; world.objective.time += world.dt;
  const trading = deriveTeamTacticalIntent(world, 0);
  assert.equal(trading.coreAlive, true);
  assert.equal(trading.recoveryProviderId, damageA.id);
  assert.equal(trading.tradeWindowActive, true);
  assert.equal(trading.phase, 'pressure');

  world.t += 2.6; world.objective.time += 2.6;
  const expired = deriveTeamTacticalIntent(world, 0);
  assert.equal(expired.tradeWindowActive, false);
  assert.equal(expired.phase, 'regroup');
});

test('the winning team does not resume spawn pressure until the regrouping enemy is released', () => {
  const { world, player: attacker, bot } = makeBot('zairu');
  const ownTeam = [
    attacker,
    world.addPlayer('own damage a', true, 0, 'asagi'),
    world.addPlayer('own damage b', true, 0, 'shirasagi'),
    world.addPlayer('own sustain', true, 0, 'tsuzuri'),
    world.addPlayer('own utility', true, 0, 'karakasa'),
  ];
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const isolatedEnemy = world.addPlayer('isolated enemy', true, 1, 'ankou');
  const enemyDamage = world.addPlayer('enemy damage', true, 1, 'botan');
  const enemySustain = world.addPlayer('enemy sustain', true, 1, 'hibari');
  const enemyUtility = world.addPlayer('enemy utility', true, 1, 'shirabe');
  const enemyTeam = [enemyTank, isolatedEnemy, enemyDamage, enemySustain, enemyUtility];
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const stagingFor = team => world.sideOf(team) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const member of ownTeam) member.move.pos = [...stagingFor(0)];
  for (const member of enemyTeam) member.move.pos = [...stagingFor(1)];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');
  assert.equal(deriveTeamTacticalIntent(world, 1).phase, 'approach');

  for (const [index, member] of ownTeam.entries()) member.move.pos = [8, index - 2, 4];
  for (const [index, member] of enemyTeam.entries()) member.move.pos = [-8, index - 2, 4];
  world.t += world.dt; world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');
  assert.equal(deriveTeamTacticalIntent(world, 1).phase, 'pressure');

  world.eliminatePlayer(isolatedEnemy, { source: attacker });
  world.t += 2.6; world.objective.time += 2.6;
  assert.equal(deriveTeamTacticalIntent(world, 1).phase, 'regroup');

  isolatedEnemy.alive = true;
  isolatedEnemy.hp = isolatedEnemy.maxHp;
  isolatedEnemy.move.pos = [-6, 0, 4];
  for (const member of [enemyTank, enemySustain, enemyUtility]) {
    member.move.pos = [...stagingFor(1)];
  }
  enemyDamage.move.pos = [-30, 20, 4];
  world.respawn?.pending?.delete(isolatedEnemy.id);
  world.t += world.dt; world.objective.time += world.dt;
  const regroupingEnemy = deriveTeamTacticalIntent(world, 1);
  assert.equal(regroupingEnemy.fullTeamAlive, true);
  assert.equal(regroupingEnemy.retreating, true);
  assert.equal(regroupingEnemy.phase, 'regroup');

  bot.route = 'front';
  bot.mode = 'fight';
  bot.targetId = isolatedEnemy.id;
  bot.aimErr = 0;
  bot.think(world.dt);

  assert.equal(bot.targetId, null);
  assert.equal(attacker.input.fire, false);
  assert.equal(bot.targetClaimCount(isolatedEnemy.id), 0);
});

test('a nearby space damage hero anchors pressure when the living frontline is too far away', () => {
  const { world, player: frontline } = makeBot('zairu');
  const pressureAnchor = world.addPlayer('space damage', true, 0, 'botan');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const recoveryProvider = world.addPlayer('recovery provider', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const ally of [frontline, pressureAnchor, damage, recoveryProvider, utility]) {
    ally.move.pos = [...staging];
  }
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  frontline.move.pos = [30, 0, 4];
  pressureAnchor.move.pos = [0, 0, 4];
  damage.move.pos = [2, -2, 4];
  recoveryProvider.move.pos = [0, 2, 4];
  utility.move.pos = [8, 8, 4];
  enemy.move.pos = [6, 0, 4];
  world.t += world.dt;

  const intent = deriveTeamTacticalIntent(world, 0);
  assert.equal(intent.pressureAnchorId, pressureAnchor.id);
  assert.equal(intent.recoveryProviderId, recoveryProvider.id);
  assert.equal(intent.coreAlive, true);
  assert.equal(intent.phase, 'pressure');
});

test('a living space damage hero preserves the trade window when the frontline dies', () => {
  const { world, player: frontline } = makeBot('zairu');
  const pressureAnchor = world.addPlayer('space damage', true, 0, 'botan');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const recoveryProvider = world.addPlayer('recovery provider', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const ally of [frontline, pressureAnchor, damage, recoveryProvider, utility]) {
    ally.move.pos = [...staging];
  }
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  frontline.move.pos = [0, 0, 4];
  pressureAnchor.move.pos = [3, 0, 4];
  damage.move.pos = [2, -2, 4];
  recoveryProvider.move.pos = [0, 2, 4];
  utility.move.pos = [8, 8, 4];
  enemy.move.pos = [6, 0, 4];
  world.t += world.dt; world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');

  world.eliminatePlayer(frontline, { source: enemy });
  world.t += world.dt; world.objective.time += world.dt;
  const intent = deriveTeamTacticalIntent(world, 0);
  assert.equal(intent.pressureAnchorId, pressureAnchor.id);
  assert.equal(intent.recoveryProviderId, recoveryProvider.id);
  assert.equal(intent.coreAlive, true);
  assert.equal(intent.tradeWindowActive, true);
  assert.equal(intent.phase, 'pressure');
});

test('Asagi becomes recovery provider when the primary support dies', () => {
  const { world, player: pressureAnchor } = makeBot('zairu');
  const damageProvider = world.addPlayer('damage provider', true, 0, 'asagi');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const primaryProvider = world.addPlayer('primary provider', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  pressureAnchor.move.pos = [...staging];
  primaryProvider.move.pos = [staging[0], staging[1] + 1, staging[2]];
  damageProvider.move.pos = [staging[0], staging[1] + 4, staging[2]];
  damage.move.pos = [staging[0], staging[1] - 2, staging[2]];
  utility.move.pos = [staging[0] + 2, staging[1], staging[2]];
  const approach = deriveTeamTacticalIntent(world, 0);
  assert.equal(approach.recoveryProviderId, primaryProvider.id);
  assert.equal(approach.phase, 'approach');

  pressureAnchor.move.pos = [0, 0, 4];
  primaryProvider.move.pos = [0, 2, 4];
  damageProvider.move.pos = [3, 0, 4];
  damage.move.pos = [2, -2, 4];
  utility.move.pos = [2, 2, 4];
  enemy.move.pos = [6, 0, 4];
  world.t += world.dt; world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');

  world.eliminatePlayer(primaryProvider, { source: enemy });
  world.t += world.dt; world.objective.time += world.dt;
  const intent = deriveTeamTacticalIntent(world, 0);
  assert.equal(intent.pressureAnchorId, pressureAnchor.id);
  assert.equal(intent.recoveryProviderId, damageProvider.id);
  assert.equal(intent.coreAlive, true);
  assert.equal(intent.tradeWindowActive, true);
  assert.equal(intent.phase, 'pressure');
});

test('a damage recovery provider gives up its flank assignment while covering the team', () => {
  const { world, player: damageProvider, bot } = makeBot('asagi');
  const pressureAnchor = world.addPlayer('pressure anchor', true, 0, 'zairu');
  world.addPlayer('other damage', true, 0, 'shirasagi');
  const primaryProvider = world.addPlayer('primary provider', true, 0, 'tsuzuri');
  world.addPlayer('utility', true, 0, 'karakasa');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  damageProvider.move.pos = [2, 2, 4];
  pressureAnchor.move.pos = [0, 0, 4];
  primaryProvider.alive = false;
  bot.route = 'cloister';
  bot.teamTacticalPhase = 'pressure';

  assert.equal(bot.teamRecoveryProvider()?.id, damageProvider.id);
  assert.equal(bot.isDesignatedSideFlanker(), true);
  assert.equal(bot.activeRouteName(), 'front');
});

test('Asagi deploys its healing field for a meaningfully wounded nearby pressure anchor', () => {
  const { world, player, bot } = makeBot('asagi');
  const pressureAnchor = world.addPlayer('pressure anchor', true, 0, 'zairu');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 10];
  pressureAnchor.move.pos = [0, 3, 10];
  pressureAnchor.hp = pressureAnchor.maxHp * 0.65;

  const input = {
    secondary: false, ability1: false, ability2: false, ultimate: false,
    yaw: 0, pitch: 0,
  };
  const context = bot.combatContext();
  assert.equal(context.pressureAnchor?.id, pressureAnchor.id);
  assert.equal(bot.applyHeroAction(input, context), 'ability2');
  assert.equal(input.ability2, true);
  bot.aimForAction(input, 'ability2', context);
  assert.ok(Math.abs(input.yaw - Math.PI / 2) < 0.08, `healing dash yaw=${input.yaw}`);
});

test('a complete team stops pursuing a wounded enemy roster instead of farming staggered respawns', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', true, 0, 'zairu');
  const damage = world.addPlayer('damage', true, 0, 'ibuki');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemies = Array.from({ length: 5 }, (_, index) => world.addPlayer(`enemy-${index}`, true, 1,
    index === 0 ? 'baraga' : 'asagi'));
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const ally of [tank, player, damage, sustain, utility]) ally.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');
  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  for (const [index, ally] of [tank, player, damage, sustain, utility].entries()) {
    ally.move.pos = [frontX - forwardX * index, index - 2, 4];
  }
  for (const [index, enemy] of enemies.entries()) enemy.move.pos = [frontX + forwardX * 5, index - 2, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');
  enemies[4].alive = false;
  world.respawn.onDeath(enemies[4].id, world.objective.time);
  world.t += 2.6; world.objective.time += 2.6;
  bot.mode = 'pursue';
  bot.targetId = enemies[0].id;

  bot.think(world.dt);

  assert.equal(bot.targetId, null);
  assert.notEqual(bot.mode, 'pursue');
  assert.equal(player.input.fire, false);
});

test('a separated regroup bot follows its collision-checked staging path instead of waiting indefinitely', () => {
  const { world, player, bot } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'ibuki');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [-18, -2, 4];
  damageA.move.pos = [-40, 0, 4];
  damageB.move.pos = [-40, 5, 4];
  sustain.move.pos = [-40, -5, 4];
  utility.alive = false;
  bot.mode = 'fight';

  // The planner deliberately consumes the zero-distance start node first;
  // assert the next decision rather than treating that bookkeeping tick as a stall.
  bot.think(world.dt);
  bot.think(world.dt);

  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  const towardStaging = [staging[0] - player.move.pos[0], staging[1] - player.move.pos[1]];
  const move = worldMoveVector(player.input);
  assert.equal(bot.mode, 'regroup');
  assert.ok(bot.recoveryPath.length > 0, 'regroup must retain a checked path to staging');
  assert.equal(player.input.fire, false);
  assert.ok(
    move[0] * towardStaging[0] + move[1] * towardStaging[1] > 0,
    `regroup movement did not head to staging: ${JSON.stringify({ move, towardStaging })}`,
  );
});

test('a failed regroup route is rate-limited but retried after its short recovery window', () => {
  const { world, bot } = makeBot('asagi');
  let attempts = 0;
  bot.planRegroupPath = () => {
    attempts++;
    return false;
  };

  for (let tick = 0; tick < 10; tick++) {
    bot.enterRegroup();
    world.t += world.dt;
  }
  assert.equal(attempts, 1);

  world.t += 1;
  bot.enterRegroup();
  assert.equal(attempts, 2);
});

test('a regroup bot holds the staging point until its tank, sustain, and nearby squad are ready', () => {
  const { world, player, bot } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'ibuki');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  player.move.pos = [...staging];
  damageA.move.pos = [-40, 0, 4];
  damageB.move.pos = [-40, 5, 4];
  sustain.move.pos = [-40, -5, 4];
  utility.alive = false;
  bot.mode = 'regroup';

  bot.think(world.dt);

  assert.equal(bot.mode, 'regroup');
  assert.equal(bot.recoveryPath.length, 0);
  assert.deepEqual(worldMoveVector(player.input), [0, 0]);
  assert.equal(player.input.fire, false);
});

test('a shared team intent keeps every bot regrouping while its selected pressure anchor is outside staging', () => {
  const { world, player: tank } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'ibuki');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'shirabe');
  const supportBot = new BotController(world, sustain, () => 0.5);
  const enemy = world.addPlayer('enemy', true, 1, 'asagi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  tank.move.pos = [44, 0, 4];
  damageA.move.pos = [staging[0], staging[1] + 2, staging[2]];
  damageB.move.pos = [staging[0], staging[1] - 2, staging[2]];
  sustain.move.pos = [staging[0], staging[1], staging[2]];
  utility.move.pos = [staging[0] + 2, staging[1], staging[2]];
  enemy.move.pos = [staging[0] - 4, staging[1], staging[2]];
  supportBot.mode = 'fight';

  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'regroup');
  supportBot.think(world.dt);

  assert.equal(supportBot.mode, 'regroup');
  assert.equal(sustain.input.fire, false);
});

test('team pressure waits for four allies to reach the front before releasing combat', () => {
  const { world, player: tank } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'asagi');
  const damageB = world.addPlayer('damage-b', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'asagi');
  const damageABot = new BotController(world, damageA, () => 0.5);
  const damageBBot = new BotController(world, damageB, () => 0.5);
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const player of [tank, damageA, damageB, sustain, utility]) {
    player.move.pos = [...staging];
  }
  damageABot.route = 'cloister';
  damageBBot.route = 'shallows';
  const approach = deriveTeamTacticalIntent(world, 0);
  assert.equal(approach.phase, 'approach');
  damageABot.syncTeamTacticalPhase(approach, true);
  damageBBot.syncTeamTacticalPhase(approach, true);
  assert.equal(damageABot.activeRouteName(), 'cloister',
    'the designated flanker pre-stages its side angle during approach');
  assert.equal(damageBBot.activeRouteName(), 'front',
    'the second DPS approaches with the tank');

  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  tank.move.pos = [frontX, 0, 4];
  sustain.move.pos = [frontX - forwardX, 2, 4];
  damageA.move.pos = [staging[0], staging[1] + 2, staging[2]];
  damageB.move.pos = [staging[0], staging[1] - 2, staging[2]];
  utility.move.pos = [...staging];
  enemy.move.pos = [frontX + forwardX * 6, 0, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  damageA.move.pos = [frontX - forwardX * 2, -2, 4];
  damageB.move.pos = [frontX - forwardX * 3, 2, 4];
  world.t += world.dt;
  const pressure = deriveTeamTacticalIntent(world, 0);
  assert.equal(pressure.phase, 'pressure');
  damageABot.syncTeamTacticalPhase(pressure, true);
  damageBBot.syncTeamTacticalPhase(pressure, true);
  assert.equal(damageABot.activeRouteName(), 'cloister');
  assert.equal(damageBBot.activeRouteName(), 'front');

  damageA.move.pos = [frontX, 19, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure',
    'an established fight stays latched while the flanker takes a bounded off-angle');
});

test('a regrouped approach commits defensively when the enemy opens fire on its connected front', () => {
  const { world, player: anchor } = makeBot('zairu');
  const frontDamage = world.addPlayer('front damage', true, 0, 'hokuchi');
  const sideDamage = world.addPlayer('side damage', true, 0, 'shirasagi');
  const recoveryProvider = world.addPlayer('recovery provider', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'shirabe');
  const attacker = world.addPlayer('enemy attacker', true, 1, 'asagi');
  for (const heroId of ['shiomaneki', 'ankou', 'hibari', 'karakasa']) {
    world.addPlayer(`enemy ${heroId}`, true, 1, heroId);
  }
  const attackerBot = new BotController(world, attacker, () => 0.5);

  world.flow.state = 'ACTIVE';
  world.collider.dynamic = [];
  world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const member of [anchor, frontDamage, sideDamage, recoveryProvider, utility]) {
    member.move.pos = [...staging];
  }
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  anchor.move.pos = [8, 0, 4];
  frontDamage.move.pos = [10, 2, 4];
  recoveryProvider.move.pos = [11, -2, 4];
  sideDamage.move.pos = [25, 7, 4];
  utility.move.pos = [28, -7, 4];
  attacker.move.pos = [-8, 0, 4];
  world.t += world.dt;
  world.objective.time += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach',
    'three connected front members alone do not start an attack');

  attackerBot.claimTarget(frontDamage);
  world.t += world.dt;
  world.objective.time += world.dt;
  const defending = deriveTeamTacticalIntent(world, 0);
  assert.equal(defending.incomingHostilePressure, true);
  assert.equal(defending.phase, 'pressure',
    'a formed front must return fire instead of walking unarmed into existing pressure');
});

test('a front-route first damage keeps one stable side-route designation through respawn', () => {
  const world = new World(buildMap(), MODE, COMBAT, 74);
  const firstDamage = world.addPlayer('damage-a', true, 0, 'asagi');
  const secondDamage = world.addPlayer('damage-b', true, 0, 'shirasagi');
  world.addPlayer('tank', true, 0, 'zairu');
  world.addPlayer('sustain', true, 0, 'tsuzuri');
  world.addPlayer('utility', true, 0, 'karakasa');
  const firstBot = new BotController(world, firstDamage, () => 0.999);
  const secondBot = new BotController(world, secondDamage, () => 0.34);
  const bots = [firstBot, secondBot];
  const projectedSideIds = () => bots
    .filter(bot => bot.activeRouteName() !== 'front')
    .map(bot => bot.pl.id);

  assert.equal(firstBot.route, 'front', 'the deterministic roll exercises the missing-flanker case');
  assert.equal(secondBot.route, 'shallows');
  for (const bot of bots) bot.syncTeamTacticalPhase({ phase: 'approach' }, true);

  assert.deepEqual(projectedSideIds(), [firstDamage.id]);
  assert.equal(firstBot.activeRouteName(), 'cloister');
  assert.equal(secondBot.activeRouteName(), 'front');

  world.eliminatePlayer(firstDamage);
  firstBot.think(world.dt);
  assert.deepEqual(projectedSideIds(), [firstDamage.id],
    'the living damage mate must not inherit the designation');

  assert.equal(world.spawnAtBase(firstDamage), true);
  for (const bot of bots) bot.syncTeamTacticalPhase({ phase: 'approach' }, true);
  assert.deepEqual(projectedSideIds(), [firstDamage.id]);
  assert.equal(secondBot.activeRouteName(), 'front');

  const shallows = firstBot.routePoints('shallows');
  const forwardIndex = Math.floor(shallows.length / 2);
  firstDamage.move.pos = [...shallows[forwardIndex]];
  firstBot.route = 'shallows';
  firstBot.wpIndex = 0;
  firstBot.syncTeamTacticalPhase({ phase: 'approach' }, true);
  assert.ok(firstBot.wpIndex >= forwardIndex,
    `same-phase route change projected to stale waypoint ${firstBot.wpIndex}`);
});

test('side-flanker designation survives a 180-degree mirror and physical player ID reallocation', () => {
  const designatedHero = (sides, heroOrder) => {
    const world = new World(buildMap(), MODE, COMBAT, 20260723);
    world.flow.sides = [...sides];
    const damage = heroOrder.map(heroId => (
      world.addPlayer(`logical-${heroId}`, true, 0, heroId)
    ));
    const bots = damage.map(player => (
      new BotController(world, player, makeBotRng(world.seed, player, damage))
    ));
    return bots.find(bot => bot.isDesignatedSideFlanker())?.pl.heroId;
  };

  const east = designatedHero(['east', 'west'], ['asagi', 'shirasagi']);
  const west = designatedHero(['west', 'east'], ['shirasagi', 'asagi']);
  assert.equal(east, 'asagi');
  assert.equal(west, east);
});

test('approach route projection never sends either designated flanker backward', () => {
  const { world, player: eastFlanker, bot: eastBot } = makeBot('asagi');
  world.addPlayer('east damage mate', true, 0, 'shirasagi');
  const westFlanker = world.addPlayer('west flanker', true, 1, 'asagi');
  world.addPlayer('west damage mate', true, 1, 'shirasagi');
  const westBot = new BotController(world, westFlanker, () => 0.5);

  for (const [team, player, bot, route] of [
    [0, eastFlanker, eastBot, 'shallows'],
    [1, westFlanker, westBot, 'cloister'],
  ]) {
    const staging = world.sideOf(team) === 'east'
      ? world.map.routes.front[2]
      : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
    player.move.pos = [...staging];
    bot.route = route;
    bot.teamTacticalPhase = 'regroup';
    bot.syncTeamTacticalPhase({ phase: 'approach' }, true);

    const waypoint = bot.routePoints()[bot.wpIndex];
    const [forwardX] = teamForward(world, team);
    const progress = (waypoint[0] - player.move.pos[0]) * forwardX;
    assert.ok(progress >= 0,
      `team ${team} rejoined ${route} ${Math.abs(progress).toFixed(3)}m behind staging`);
  }
});

test('team pressure requires its selected recovery provider within 18m to enter but holds through 20m during memory', () => {
  const { world, player: tank } = makeBot('zairu');
  const damageA = world.addPlayer('damage-a', true, 0, 'hokuchi');
  const damageB = world.addPlayer('damage-b', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const player of [tank, damageA, damageB, sustain, utility]) player.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  tank.move.pos = [0, 0, 4];
  damageA.move.pos = [2, -2, 4];
  damageB.move.pos = [2, 2, 4];
  utility.move.pos = [3, 0, 4];
  enemy.move.pos = [6, 0, 4];

  sustain.move.pos = [0, 18.5, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach', '18.5m must not enter pressure');

  sustain.move.pos = [0, 18, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure', '18m may enter pressure');

  sustain.move.pos = [0, 20, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure', '20m remains covered by pressure memory');

  sustain.move.pos = [0, 20.1, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach', 'above 20m drops to approach');

  sustain.move.pos = [0, 18, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');
  sustain.move.pos = [0, 20, 4];
  world.t += 1.6;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach', 'expired memory drops to approach');
});

test('side-route DPS keeps its target while the shared tactical phase remains pressure', () => {
  const { world, player: flanker, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', true, 0, 'zairu');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const player of [tank, flanker, damage, sustain, utility]) player.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  tank.move.pos = [0, 0, 4];
  const [forwardX] = teamForward(world, 0);
  flanker.move.pos = [forwardX * 6, -8, 4];
  damage.move.pos = [forwardX * 2, 2, 4];
  sustain.move.pos = [0, 18, 4];
  utility.move.pos = [forwardX * 3, 0, 4];
  enemy.move.pos = [forwardX * 8, -8, 4];
  bot.route = 'cloister';
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure');

  enemy.move.pos = [forwardX * 24, -8, 4];
  world.t += world.dt;
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'pressure', 'shared pressure memory is active');
  bot.mode = 'fight';
  bot.targetId = enemy.id;

  bot.think(world.dt);

  assert.equal(bot.teamTacticalPhase, 'pressure');
  assert.equal(bot.targetId, enemy.id);
  assert.equal(bot.mode, 'fight');
});

test('the pressure-synchronised side flanker can select a visible continuous healer', () => {
  const { world, player: flanker, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', true, 0, 'zairu');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemySustain = world.addPlayer('enemy sustain', true, 1, 'hibari');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();

  const staging = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  for (const player of [tank, flanker, damage, sustain, utility]) player.move.pos = [...staging];
  assert.equal(deriveTeamTacticalIntent(world, 0).phase, 'approach');

  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  tank.move.pos = [frontX, 0, 4];
  flanker.move.pos = [frontX - forwardX * 2, -2, 4];
  damage.move.pos = [frontX - forwardX * 3, 2, 4];
  sustain.move.pos = [frontX - forwardX, 2, 4];
  utility.move.pos = [frontX - forwardX, -3, 4];
  enemyTank.move.pos = [frontX + forwardX * 6, 0, 4];
  enemySustain.move.pos = [frontX + forwardX * 15, 7, 4];
  bot.route = 'cloister';
  world.t += world.dt;

  const pressure = deriveTeamTacticalIntent(world, 0);
  assert.equal(pressure.phase, 'pressure');
  bot.syncTeamTacticalPhase(pressure, true);
  assert.equal(bot.activeRouteName(), 'cloister');
  assert.equal(bot.visibleEnemy()?.id, enemySustain.id);
});

test('a long-range specialist can acquire a visible target beyond the generic 40m scan', () => {
  const { world, player, bot } = makeBot('shirasagi');
  const enemy = world.addPlayer('distant enemy', false, 1, 'shiomaneki');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = { raycast: () => Infinity };
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [48, 0, 10];

  assert.equal(bot.visibleEnemy()?.id, enemy.id);
});

test('a charge-weapon bot keeps its visible target until the charged shot resolves', () => {
  const { world, player, bot } = makeBot('shirasagi');
  const currentTarget = world.addPlayer('current target', false, 1, 'shiomaneki');
  const exposedSustain = world.addPlayer('exposed sustain', false, 1, 'hibari');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  world.collider = { raycast: () => Infinity };
  player.move.pos = [0, 0, 10];
  currentTarget.move.pos = [32, 0, 10];
  exposedSustain.move.pos = [30, 8, 10];
  bot.route = 'cloister';
  bot.teamTacticalPhase = 'pressure';
  bot.isDesignatedSideFlanker = () => true;
  bot.targetId = currentTarget.id;
  player.weapon.chargeStartedAt = world.t;

  assert.equal(bot.visibleEnemy()?.id, currentTarget.id);
});

test('a flanker pressuring sustain does not pull the whole frontline off the enemy tank', () => {
  const { world, player: flanker, bot: flankerBot } = makeBot('asagi');
  const tank = world.addPlayer('tank', true, 0, 'zairu');
  const damage = world.addPlayer('damage', true, 0, 'shirasagi');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const utility = world.addPlayer('utility', true, 0, 'karakasa');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemySustain = world.addPlayer('enemy sustain', true, 1, 'hibari');
  const tankBot = new BotController(world, tank, () => 0.5);
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  const [forwardX] = teamForward(world, 0);
  const frontX = -forwardX * 12;
  tank.move.pos = [frontX, 0, 4];
  flanker.move.pos = [frontX - forwardX * 2, -2, 4];
  damage.move.pos = [frontX - forwardX * 3, 2, 4];
  sustain.move.pos = [frontX - forwardX, 2, 4];
  utility.move.pos = [frontX - forwardX, -3, 4];
  enemyTank.move.pos = [frontX + forwardX * 6, 0, 4];
  enemySustain.move.pos = [frontX + forwardX * 15, 7, 4];
  flankerBot.route = 'cloister';
  flankerBot.teamTacticalPhase = 'pressure';
  tankBot.teamTacticalPhase = 'pressure';

  assert.equal(flankerBot.visibleEnemy()?.id, enemySustain.id);
  flankerBot.rememberVisibleEnemy(enemySustain);

  assert.equal(tankBot.visibleEnemy()?.id, enemyTank.id);
});

test('a side flanker pressures the frontline instead of tunnelling a protected full-health healer', () => {
  const { world, player: flanker, bot } = makeBot('asagi');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemySustain = world.addPlayer('enemy sustain', true, 1, 'hibari');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  flanker.move.pos = [0, 0, 4];
  enemyTank.move.pos = [8, 0, 4];
  enemySustain.move.pos = [10, 2, 4];
  bot.route = 'cloister';
  bot.teamTacticalPhase = 'pressure';
  bot.isDesignatedSideFlanker = () => true;

  assert.equal(bot.visibleEnemy()?.id, enemyTank.id);
});

test('a side flanker treats a healthy support inside the authored formation as protected', () => {
  const { world, player: flanker, bot } = makeBot('asagi');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemySustain = world.addPlayer('enemy sustain', true, 1, 'hibari');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  flanker.move.pos = [0, 0, 4];
  enemyTank.move.pos = [8, 0, 4];
  enemySustain.move.pos = [20, 2, 4];
  bot.route = 'cloister';
  bot.teamTacticalPhase = 'pressure';
  bot.isDesignatedSideFlanker = () => true;

  assert.equal(bot.visibleEnemy()?.id, enemyTank.id);

  enemySustain.hp = enemySustain.maxHp * 0.75;
  assert.equal(bot.visibleEnemy()?.id, enemySustain.id);
});

test('the frontal group shoots through the enemy tank before selecting an exposed support', () => {
  const { world, player: tank, bot } = makeBot('zairu');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemySupport = world.addPlayer('enemy support', true, 1, 'hibari');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  tank.move.pos = [0, 0, 4];
  enemySupport.move.pos = [4, 0, 4];
  enemyTank.move.pos = [8, 2, 4];
  bot.teamTacticalPhase = 'pressure';
  bot.route = 'front';

  assert.equal(bot.visibleEnemy()?.id, enemyTank.id);
});

test('a third frontal attacker takes a second visible target instead of overstacking one tank', () => {
  const { world, player, bot } = makeBot('asagi');
  const allies = [
    world.addPlayer('ally tank', true, 0, 'zairu'),
    world.addPlayer('ally damage', true, 0, 'shirasagi'),
  ];
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemyDamage = world.addPlayer('enemy damage', true, 1, 'hokuchi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  allies.forEach((ally, index) => { ally.move.pos = [0, index + 1, 4]; });
  enemyTank.move.pos = [8, 0, 4];
  enemyDamage.move.pos = [9, 3, 4];
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';
  for (const ally of allies) {
    const allyBot = new BotController(world, ally, () => 0.5);
    allyBot.claimTarget(enemyTank);
  }

  assert.equal(bot.visibleEnemy()?.id, enemyDamage.id);
});

test('equal-distance alternative targets keep the same logical hero through a 180-degree mirror', () => {
  const selectedHero = (sides, alternativeOrder) => {
    const world = new World(buildMap(), MODE, COMBAT, 20260723);
    world.flow.sides = [...sides];
    const player = world.addPlayer('logical-attacker', true, 0, 'asagi');
    const claimers = [
      world.addPlayer('logical-frontline', true, 0, 'zairu'),
      world.addPlayer('logical-damage', true, 0, 'shirasagi'),
    ];
    const preferred = world.addPlayer('logical-enemy-frontline', true, 1, 'baraga');
    const alternatives = alternativeOrder.map(heroId => (
      world.addPlayer(`logical-enemy-${heroId}`, true, 1, heroId)
    ));
    const bot = new BotController(world, player, makeBotRng(world.seed, player, [player, ...claimers]));
    world.flow.state = 'ACTIVE';
    world.objective.unseal();
    world.collider = { raycast: () => Infinity };
    const rotation = world.sideOf(player.team) === 'east' ? 1 : -1;
    player.move.pos = [0, 0, 4];
    preferred.move.pos = [rotation * 8, 0, 4];
    alternatives[0].move.pos = [rotation * 9, rotation * 3, 4];
    alternatives[1].move.pos = [rotation * 9, rotation * -3, 4];
    bot.teamTacticalPhase = 'pressure';
    bot.route = 'front';
    for (const claimer of claimers) {
      new BotController(world, claimer, () => 0.5).claimTarget(preferred);
    }

    return bot.visibleEnemy()?.heroId;
  };

  const east = selectedHero(['east', 'west'], ['ankou', 'hokuchi']);
  const west = selectedHero(['west', 'east'], ['hokuchi', 'ankou']);
  assert.equal(east, 'ankou');
  assert.equal(west, east);
});

test('a third attacker holds fire when the only healthy target already has two claims', () => {
  const { world, player, bot } = makeBot('asagi');
  const allies = [
    world.addPlayer('ally tank', true, 0, 'zairu'),
    world.addPlayer('ally damage', true, 0, 'shirasagi'),
  ];
  const healthyTank = world.addPlayer('healthy enemy tank', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  healthyTank.move.pos = [8, 0, 4];
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';
  for (const ally of allies) {
    new BotController(world, ally, () => 0.5).claimTarget(healthyTank);
  }

  assert.equal(bot.visibleEnemy(), null);
});

test('a third attacker joins a wounded visible target to create a bounded finish window', () => {
  const { world, player, bot } = makeBot('asagi');
  const allies = [
    world.addPlayer('ally tank', true, 0, 'zairu'),
    world.addPlayer('ally damage', true, 0, 'shirasagi'),
  ];
  const woundedTank = world.addPlayer('wounded enemy tank', true, 1, 'baraga');
  const healthyDamage = world.addPlayer('healthy enemy damage', true, 1, 'hokuchi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  allies.forEach((ally, index) => { ally.move.pos = [0, index + 1, 4]; });
  woundedTank.move.pos = [8, 0, 4];
  woundedTank.hp = woundedTank.maxHp * 0.65;
  healthyDamage.move.pos = [9, 3, 4];
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';
  for (const ally of allies) {
    new BotController(world, ally, () => 0.5).claimTarget(woundedTank);
  }

  assert.equal(bot.visibleEnemy()?.id, woundedTank.id);
});

test('a fourth attacker diverts even when the shared target is wounded', () => {
  const { world, player, bot } = makeBot('asagi');
  const allies = [
    world.addPlayer('ally tank', true, 0, 'zairu'),
    world.addPlayer('ally damage', true, 0, 'shirasagi'),
    world.addPlayer('ally support', true, 0, 'shirabe'),
  ];
  const woundedTank = world.addPlayer('wounded enemy tank', true, 1, 'baraga');
  const healthyDamage = world.addPlayer('healthy enemy damage', true, 1, 'hokuchi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  allies.forEach((ally, index) => { ally.move.pos = [0, index + 1, 4]; });
  woundedTank.move.pos = [8, 0, 4];
  woundedTank.hp = woundedTank.maxHp * 0.65;
  healthyDamage.move.pos = [9, 3, 4];
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';
  for (const ally of allies) {
    new BotController(world, ally, () => 0.5).claimTarget(woundedTank);
  }

  assert.equal(bot.visibleEnemy()?.id, healthyDamage.id);
});

test('a fourth attacker holds fire when the only finish target already has three claims', () => {
  const { world, player, bot } = makeBot('asagi');
  const allies = [
    world.addPlayer('ally tank', true, 0, 'zairu'),
    world.addPlayer('ally damage', true, 0, 'shirasagi'),
    world.addPlayer('ally support', true, 0, 'shirabe'),
  ];
  const woundedTank = world.addPlayer('wounded enemy tank', true, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  woundedTank.move.pos = [8, 0, 4];
  woundedTank.hp = woundedTank.maxHp * 0.65;
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';
  for (const ally of allies) {
    new BotController(world, ally, () => 0.5).claimTarget(woundedTank);
  }

  assert.equal(bot.visibleEnemy(), null);
});

test('a frontal attacker converts pressure onto a wounded visible non-frontline target', () => {
  const { world, player, bot } = makeBot('asagi');
  const enemyTank = world.addPlayer('healthy enemy tank', true, 1, 'baraga');
  const woundedDamage = world.addPlayer('wounded enemy damage', true, 1, 'hokuchi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  player.move.pos = [0, 0, 4];
  enemyTank.move.pos = [8, 0, 4];
  woundedDamage.move.pos = [9, 2, 4];
  woundedDamage.hp = woundedDamage.maxHp * 0.45;
  bot.teamTacticalPhase = 'pressure'; bot.route = 'front';

  assert.equal(bot.visibleEnemy()?.id, woundedDamage.id);
});

test('switching combat targets requires aim reacquisition before firing', () => {
  const { world, player, bot } = makeBot('asagi');
  const defeated = world.addPlayer('defeated target', false, 1, 'zairu');
  const replacement = world.addPlayer('replacement target', false, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  bot.route = 'front';
  bot.mode = 'fight';
  bot.targetId = defeated.id;
  bot.aimErr = 0.8;
  player.move.pos = [0, 0, 4];
  defeated.move.pos = [8, 0, 4];
  defeated.alive = false;
  replacement.move.pos = [12, 0, 4];

  bot.think(world.dt);

  assert.equal(bot.targetId, replacement.id);
  assert.equal(player.input.fire, false);
  assert.ok(bot.aimErr > 5.8, `aimErr=${bot.aimErr}`);
});

test('a utility support peels an enemy DPS that reaches its continuous healer', () => {
  const { world, player: utility, bot } = makeBot('karakasa');
  const sustain = world.addPlayer('sustain', true, 0, 'tsuzuri');
  const enemyTank = world.addPlayer('enemy tank', true, 1, 'baraga');
  const enemyFlanker = world.addPlayer('enemy flanker', true, 1, 'tsubakuro');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  utility.move.pos = [0, 0, 4];
  sustain.move.pos = [5, 2, 4];
  enemyTank.move.pos = [4, 0, 4];
  enemyFlanker.move.pos = [7, 2, 4];
  bot.teamTacticalPhase = 'pressure';
  bot.route = 'front';

  assert.equal(bot.visibleEnemy()?.id, enemyFlanker.id);
});

test('peel follows the actual ranged claimant instead of attacker role or proximity', () => {
  for (const attackerHeroId of ['asagi', 'zairu', 'tsuzuri']) {
    const { world, player: utility, bot } = makeBot('karakasa');
    const recoveryProvider = world.addPlayer('recovery provider', true, 0, 'tsuzuri');
    const decoy = world.addPlayer('near decoy', true, 1, 'baraga');
    const claimant = world.addPlayer(`ranged ${attackerHeroId}`, true, 1, attackerHeroId);
    world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
    utility.move.pos = [0, 0, 4];
    recoveryProvider.move.pos = [5, 2, 4];
    decoy.move.pos = [4, 0, 4];
    claimant.move.pos = [24, 2, 4];
    bot.teamTacticalPhase = 'pressure';
    bot.route = 'front';
    new BotController(world, claimant, () => 0.5).claimTarget(recoveryProvider);

    assert.equal(
      bot.visibleEnemy()?.id,
      claimant.id,
      `${attackerHeroId} claimant was ignored in favour of the decoy`,
    );

    world.t += 0.4;
    assert.equal(
      bot.visibleEnemy()?.id,
      decoy.id,
      `${attackerHeroId} remained a peel target after its claim expired`,
    );
  }
});

test('side-route DPS stages instead of taking a duel before its tank applies pressure', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', true, 0, 'baraga');
  world.addPlayer('damage-b', true, 0, 'ibuki');
  world.addPlayer('sustain', true, 0, 'tsuzuri');
  world.addPlayer('utility', true, 0, 'karakasa');
  const enemy = world.addPlayer('enemy', true, 1, 'asagi');
  world.flow.state = 'ACTIVE'; world.collider.dynamic = []; world.objective.unseal();
  bot.route = 'cloister'; bot.mode = 'advance';
  const points = bot.routePoints();
  player.move.pos = [...points[Math.max(1, points.length - 5)]];
  tank.move.pos = [...bot.routePoints.call({
    world,
    pl: tank,
    route: 'front',
    activeRouteName() { return this.route; },
  })[0]];
  enemy.move.pos = [
    player.move.pos[0] + teamForward(world, 0)[0] * 4,
    player.move.pos[1],
    player.move.pos[2],
  ];

  bot.think(world.dt);

  assert.equal(player.input.fire, false);
  assert.deepEqual(worldMoveVector(player.input), [0, 0]);
});

test('frontline advances into the space between its team and a nearby enemy with support', () => {
  const { world, player, bot } = makeBot('zairu');
  const ally = world.addPlayer('ally', false, 0, 'asagi');
  const support = world.addPlayer('support', false, 0, 'tsuzuri');
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
  const support = world.addPlayer('support', false, 0, 'tsuzuri');
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
  const support = world.addPlayer('support', false, 0, 'tsuzuri');
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
  const support = world.addPlayer('support', false, 0, 'tsuzuri');
  const damage = world.addPlayer('damage', false, 0, 'hokuchi');
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
  const support = world.addPlayer('support', false, 0, 'tsuzuri');
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
  // This isolates close-range DPS movement.  Side-route duel admission is
  // covered separately and correctly requires tank pressure.
  bot.route = 'front';
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

test('damage flank exits direct combat after exceeding its bounded lead past the tank', () => {
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

  // A direct line back crosses unproven geometry in this fixture.  The bot
  // must not keep duelling or cut through it; it hands movement to the
  // collision-checked regroup planner instead.
  assert.equal(bot.mode, 'regroup');
  assert.equal(bot.targetId, null);
  assert.deepEqual([player.input.f, player.input.b, player.input.l, player.input.r], [false, false, false, false]);
});

test('damage on a side route exits direct combat when its angle is too wide for the frontline', () => {
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

  assert.equal(bot.mode, 'regroup');
  assert.equal(bot.targetId, null);
  assert.deepEqual([player.input.f, player.input.b, player.input.l, player.input.r], [false, false, false, false]);
});

test('an exposed side DPS uses a local checked detour instead of replanning to distant staging', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('pressure anchor', false, 0, 'baraga');
  const solids = [
    { min: [-46, -34, 0], max: [46, 34, 4], tag: 'ground' },
    { min: [2, 6, 4], max: [3, 10, 10], tag: 'test-wall' },
  ];
  world.map.solids = solids;
  world.collider = new Collider(solids);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'cloister';
  bot.mode = 'fight';
  tank.move.pos = [0, 0, 4];
  tank.move.grounded = true;
  player.move.pos = [8, 8, 4];
  player.move.grounded = true;
  let distantRegroupPlans = 0;
  const originalPlanRegroupPath = bot.planRegroupPath.bind(bot);
  bot.planRegroupPath = () => {
    distantRegroupPlans++;
    return originalPlanRegroupPath();
  };
  const input = {
    f: false, b: false, l: false, r: false, yaw: player.move.yaw,
  };

  bot.holdDpsAtSafeAngle(input);

  assert.equal(distantRegroupPlans, 0);
  assert.equal(bot.mode, 'advance');
  assert.equal(bot.regroupGoal, null);
  assert.ok(bot.recoveryPath.length > 0, 'the DPS keeps a short collision-checked return path');
  assert.deepEqual(bot.recoveryPath.at(-1), [-2, 8, 4]);
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

test('damage lane transit is not reversed just because the frontline is delayed', () => {
  const { world, player, bot } = makeBot('asagi');
  const tank = world.addPlayer('tank', false, 0, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'shallows';
  bot.mode = 'advance';
  const points = bot.routePoints();
  const targetIndex = Math.max(1, Math.floor(points.length * 0.65));
  bot.wpIndex = targetIndex;
  player.move.pos = [...points[targetIndex - 1]];
  tank.move.pos = [40, 0, 4];
  const targetDelta = [
    points[targetIndex][0] - player.move.pos[0],
    points[targetIndex][1] - player.move.pos[1],
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

test('support formation follows the selected pressure anchor instead of a distant frontline', () => {
  const { world, player, bot } = makeBot('koyomi');
  const frontline = world.addPlayer('distant frontline', false, 0, 'zairu');
  const pressureAnchor = world.addPlayer('space damage', false, 0, 'botan');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  pressureAnchor.move.pos = [0, 0, 10];
  frontline.move.pos = [forwardX * 30, 0, 10];
  player.move.pos = [forwardX * 20, 0, 10];
  bot.mode = 'fight';
  const input = { f: false, b: false, l: false, r: false, yaw: 0, pitch: 0 };
  const context = bot.combatContext();

  assert.equal(context.pressureAnchor?.id, pressureAnchor.id);
  bot.applyFormationMovement(input, context);

  const [moveX] = worldMoveVector(input);
  assert.ok(moveX * -forwardX > 0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('a focused support kites a distant flanker instead of formation-steering toward that threat', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('tank', false, 0, 'zairu');
  const flanker = world.addPlayer('flanker', true, 1, 'asagi');
  const flankerBot = new BotController(world, flanker, () => 0.5);
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  world.collider = new Collider([{ min: [-50, -50, 3], max: [50, 50, 4], tag: 'test-ground' }]);
  player.move.pos = [0, 0, 4];
  tank.move.pos = [-12, 0, 4];
  flanker.move.pos = [-30, 0, 4];
  flankerBot.claimTarget(player);
  player.hp -= 40;

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX > 0.6, `moveX=${moveX}`);
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

test('continuous support avoids exact body-stacking while retaining close tank cover in combat', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('tank', false, 0, 'zairu');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  const [forwardX] = teamForward(world, player.team);
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  bot.route = 'front';
  tank.move.pos = [0, 0, 10];
  player.move.pos = [-forwardX, 0, 10];
  enemy.move.pos = [forwardX * 17, 0, 10];

  bot.think(world.dt);

  const [moveX] = worldMoveVector(player.input);
  assert.ok(moveX * forwardX < -0.6, `moveX=${moveX}, forwardX=${forwardX}`);
});

test('Tsuzuri ammo restore stays held without repeating ability events', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();
  player.weapon.ammo = 0;

  const uses = [];
  const held = [];
  for (let tick = 0; tick < 3; tick++) {
    bot.think(world.dt);
    held.push(player.input.secondary);
    world.tick();
    uses.push(world.drainEvents().filter(event => event.type === 'ability_used' && event.slot === 'secondary').length);
  }

  assert.deepEqual(held, [true, true, true]);
  assert.deepEqual(uses, [1, 0, 0]);
  assert.equal(player.lastAckSeq, 3);
});

test('all 18 heroes make an eligible combat-action decision in a dense team fight', () => {
  const missing = [];
  for (const hero of HEROES) {
    const { world, player, bot } = makeBot(hero.id);
    bot.route = 'front'; // Hero-action unit test: tactical flank gating is covered separately.
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
    bot.route = 'front'; // Hero-ultimate unit test: do not model an isolated flanker here.
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
    // A frontline may deliberately open with one defensive cast, then spend
    // the ready ultimate on the following decision. Include both windups.
    for (let tick = 0; tick < Math.ceil(3 / world.dt) &&
      !events.some(event => event.type === 'ultimate_used' && event.player === player.id); tick++) {
      bot.think(world.dt);
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
  // This is a single-hero ultimate liveness fixture, not a side-lane duel.
  bot.route = 'front';
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
    // Ultimate-policy coverage is independent from side-lane admission.
    // Keep each isolated DPS fixture on the front route; full-team tests
    // cover the tank-pressure gate for flank combat.
    bot.route = 'front';
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
    // This is an isolated hero-policy fixture, not a flank-coordination
    // scenario.  Keep damage heroes on the safe front route so the live
    // "no solo side duel without tank pressure" rule cannot suppress the
    // action under test.
    bot.route = 'front';
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

test('continuous healing does not spend ammunition on a full-health frontline', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('healthy tank', false, 0, 'zairu');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  tank.move.pos = [0, 8, 4];

  assert.equal(bot.woundedAlly(), null);
});

test('Tsuzuri preloads a full-health ally only while two hostile target claims are active', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('exposed damage', false, 0, 'asagi');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  const enemyBotA = new BotController(world, enemyA, () => 0.5);
  const enemyBotB = new BotController(world, enemyB, () => 0.5);
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  ally.move.pos = [0, 8, 4];
  enemyA.move.pos = [12, 0, 4];
  enemyB.move.pos = [12, 2, 4];

  enemyBotA.claimTarget(ally);
  assert.equal(bot.woundedAlly(), null, 'one attacker does not justify a stored-heal preload');

  enemyBotB.claimTarget(ally);
  assert.equal(bot.woundedAlly()?.id, ally.id);
  bot.think(world.dt);
  assert.equal(player.input.fire, true);
  assert.ok(Math.abs(player.input.yaw - Math.PI / 2) < 0.08, `yaw=${player.input.yaw}`);

  world.t += 0.4;
  assert.equal(bot.woundedAlly(), null, 'expired claims no longer predict incoming damage');
});

test('Tsuzuri under coordinated focus grapples to safer frontline cover instead of a wounded ally', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('frontline cover', false, 0, 'zairu');
  const wounded = world.addPlayer('wounded damage', false, 0, 'asagi');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  player.move.pos = [-40, -25, 4];
  player.move.grounded = true;
  tank.move.pos = [-20, -25, 4];
  wounded.move.pos = [-40, -17, 4];
  wounded.hp = wounded.maxHp * 0.4;
  enemyA.move.pos = [-44, -25, 4];
  enemyB.move.pos = [-44, -23, 4];
  new BotController(world, enemyA, () => 0.5).claimTarget(player);
  new BotController(world, enemyB, () => 0.5).claimTarget(player);

  const context = bot.combatContext(enemyA);
  assert.equal(context.ally?.id, wounded.id, 'ordinary healing priority remains the wounded ally');
  assert.equal(context.selfHostileClaims, 2);
  assert.equal(context.supportEscapeAlly?.id, tank.id);

  const input = {
    fire: false, primary: false, secondary: false, ability1: false, ability2: false,
    ultimate: false, yaw: 0, pitch: 0,
  };
  const slot = bot.applyHeroAction(input, context);
  bot.aimForAction(input, slot, context);

  assert.equal(slot, 'ability1');
  assert.equal(input.ability1, true);
  assert.ok(Math.abs(input.yaw) < 0.08, `yaw=${input.yaw}`);
});

test('Tsuzuri does not grapple forward into a frontline ally with less enemy clearance', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('unsafe frontline', false, 0, 'zairu');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  world.collider = new Collider([{ min: [-50, -50, 0], max: [50, 50, 4], tag: 'test-floor' }]);
  player.move.pos = [0, 0, 4];
  player.move.grounded = true;
  tank.move.pos = [8, 0, 4];
  enemyA.move.pos = [10, 0, 4];
  enemyB.move.pos = [10, 2, 4];
  new BotController(world, enemyA, () => 0.5).claimTarget(player);
  new BotController(world, enemyB, () => 0.5).claimTarget(player);

  const context = bot.combatContext(enemyA);
  assert.equal(context.supportEscapeAlly, null);
  const input = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.equal(bot.applyHeroAction(input, context), null);
  assert.equal(input.ability1, false);
});

test('Tsuzuri refuses a safer ally grapple when the authoritative ground path crosses a gap', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('frontline across gap', false, 0, 'zairu');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  world.collider = new Collider([
    { min: [-10, -10, 0], max: [2, 10, 4], tag: 'near-platform' },
    { min: [6, -10, 0], max: [14, 10, 4], tag: 'far-platform' },
  ]);
  player.move.pos = [0, 0, 4];
  player.move.grounded = true;
  tank.move.pos = [8, 0, 4];
  enemyA.move.pos = [-4, 0, 4];
  enemyB.move.pos = [-4, 2, 4];
  new BotController(world, enemyA, () => 0.5).claimTarget(player);
  new BotController(world, enemyB, () => 0.5).claimTarget(player);

  const context = bot.combatContext(enemyA);
  assert.equal(context.supportEscapeAlly, null);
  const input = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.equal(bot.applyHeroAction(input, context), null);
});

test('a focused support routes into the nearest collision-checked hard-cover shadow', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const threat = world.addPlayer('long sightline threat', true, 1, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  player.move.pos = [17.48, -4.74, 4];
  player.move.grounded = true;
  player.hp = player.maxHp * 0.5;
  threat.move.pos = [-9.88, -7.45, 4];
  new BotController(world, threat, () => 0.5).claimTarget(player);

  const context = bot.combatContext(threat);
  assert.equal(context.supportUnderPressure, true);
  const input = {
    f: false, b: false, l: false, r: false, yaw: player.move.yaw,
  };
  bot.applyRoleMovement(input, context);

  assert.ok(bot.supportCoverPath.length > 0, 'a nearby occluding cover path is planned');
  const goal = bot.supportCoverPath.at(-1);
  assert.equal(canAffectPoint(
    world,
    eyePosition(threat, world.mv),
    [goal[0], goal[1], goal[2] + 1.1],
    { sourceTeam: threat.team, rangeM: 100 },
  ), false, `goal remains exposed: ${goal}`);
  let previous = [...player.move.pos];
  for (const waypoint of bot.supportCoverPath) {
    assert.equal(canTraverseGroundSegment(world, previous, waypoint), true, `unsafe segment ${previous} -> ${waypoint}`);
    previous = waypoint;
  }
  assert.equal(input.f || input.b || input.l || input.r, true);
});

test('a focused support keeps its committed cover route through a temporary line-of-sight break', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const threat = world.addPlayer('long sightline threat', true, 1, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  player.move.pos = [17.48, -4.74, 4];
  player.move.grounded = true;
  player.hp = player.maxHp * 0.5;
  threat.move.pos = [-9.88, -7.45, 4];
  new BotController(world, threat, () => 0.5).claimTarget(player);

  const input = { f: false, b: false, l: false, r: false, yaw: player.move.yaw };
  bot.applyRoleMovement(input, bot.combatContext(threat));
  const committedPath = bot.supportCoverPath.map(point => [...point]);
  const committedUntil = bot.supportCoverCommitUntil;
  assert.ok(committedPath.length > 0);
  assert.ok(committedUntil > world.t);

  // Reaching cover can briefly hide the attacker and switch fight to pursue.
  // That successful LOS break must not erase the route before the support has
  // actually completed its bounded commitment.
  bot.mode = 'pursue';
  bot.applyCombatDetour(input, null, world.dt);

  assert.deepEqual(bot.supportCoverPath, committedPath);
  assert.equal(bot.supportCoverCommitUntil, committedUntil);
});

test('Hibari does not direct-heal a full-health ally under hostile target pressure', () => {
  const { world, player, bot } = makeBot('hibari');
  const ally = world.addPlayer('exposed damage', false, 0, 'asagi');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  ally.move.pos = [0, 8, 4];
  enemyA.move.pos = [40, 0, 4];
  enemyB.move.pos = [40, 2, 4];
  new BotController(world, enemyA, () => 0.5).claimTarget(ally);
  new BotController(world, enemyB, () => 0.5).claimTarget(ally);

  const context = bot.combatContext();
  const input = { fire: false, yaw: 0, pitch: 0 };
  bot.applySupportPrimary(input, context);

  assert.equal(context.ally, null);
  assert.equal(input.fire, false);
});

test('bounded hostile pressure promotes an exposed wounded ally over a slightly weaker deficit', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const exposed = world.addPlayer('exposed damage', false, 0, 'asagi');
  const unpressured = world.addPlayer('unpressured damage', false, 0, 'botan');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  exposed.move.pos = [6, 0, 4];
  unpressured.move.pos = [6, 3, 4];
  exposed.hp = exposed.maxHp * 0.7;
  unpressured.hp = unpressured.maxHp * 0.6;
  new BotController(world, enemyA, () => 0.5).claimTarget(exposed);
  new BotController(world, enemyB, () => 0.5).claimTarget(exposed);

  assert.equal(bot.woundedAlly()?.id, exposed.id);
});

test('a third hostile claim promotes a finish-window ally over a mildly wounded frontline', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('mildly wounded tank', false, 0, 'zairu');
  const finishTarget = world.addPlayer('focused damage', false, 0, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  tank.move.pos = [6, 0, 4];
  finishTarget.move.pos = [6, 3, 4];
  tank.hp = tank.maxHp * 0.75;
  finishTarget.hp = finishTarget.maxHp * 0.7;
  for (const [index, heroId] of ['baraga', 'nuedori', 'sedora'].entries()) {
    const enemy = world.addPlayer(`enemy ${index}`, true, 1, heroId);
    new BotController(world, enemy, () => 0.5).claimTarget(finishTarget);
  }

  assert.equal(bot.woundedAlly()?.id, finishTarget.id);
});

test('hostile pressure priority stays capped when four enemies claim one ally', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const pressured = world.addPlayer('pressured damage', false, 0, 'asagi');
  const critical = world.addPlayer('critical damage', false, 0, 'botan');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  pressured.move.pos = [6, 0, 4];
  critical.move.pos = [6, 3, 4];
  pressured.hp = pressured.maxHp * 0.7;
  critical.hp = critical.maxHp * 0.45;
  for (const [index, heroId] of ['baraga', 'nuedori', 'sedora', 'shiomaneki'].entries()) {
    const enemy = world.addPlayer(`enemy ${index}`, true, 1, heroId);
    new BotController(world, enemy, () => 0.5).claimTarget(pressured);
  }

  assert.equal(bot.woundedAlly()?.id, critical.id);
});

test('Tsuzuri holds ammo restore and leaves the channel once an injured team needs a reserve', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('injured ally', false, 0, 'zairu');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  ally.move.pos = [0, 8, 4];
  ally.hp = ally.maxHp * 0.5;
  player.weapon.ammo = 0;
  player.abilities.cooldowns.ability1 = 10;
  player.abilities.cooldowns.ability2 = 10;

  for (let attempt = 0; attempt < 2; attempt++) {
    const input = { secondary: false, ability1: false, ability2: false, ultimate: false };
    assert.equal(bot.applyHeroAction(input, bot.combatContext()), 'secondary');
    assert.equal(input.secondary, true);
  }

  player.weapon.ammo = 3;
  const release = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.notEqual(bot.applyHeroAction(release, bot.combatContext()), 'secondary');
  assert.equal(release.secondary, false);
});

test('support healing selection skips a critically wounded tank behind a wall for a visible ally', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('blocked tank', false, 0, 'zairu');
  const damage = world.addPlayer('visible damage', false, 0, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  world.collider.dynamic = [{ min: [2, -2, 0], max: [2.4, 2, 8], tag: 'test-wall' }];
  player.move.pos = [0, 0, 4];
  tank.move.pos = [5, 0, 4];
  damage.move.pos = [0, 6, 4];
  tank.hp = tank.maxHp * 0.1;
  damage.hp = damage.maxHp * 0.3;

  assert.equal(bot.woundedAlly()?.id, damage.id);
});

test('a recovery-capable bot paths toward a blocked critical ally without healing through the wall', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const ally = world.addPlayer('blocked critical ally', false, 0, 'hokuchi');
  world.flow.state = 'ACTIVE'; world.objective.unseal();
  const floor = { min: [-10, -10, 0], max: [10, 10, 2.5], tag: 'ground' };
  const wall = { min: [2, -2, 2.5], max: [2.4, 2, 8], tag: 'test-wall' };
  world.map.solids = [floor, wall];
  world.map.boundsM = { x: [-10, 10], y: [-10, 10] };
  world.collider = new Collider([floor, wall]);
  player.move.pos = [0, 0, 2.5];
  player.move.grounded = true;
  player.hp = player.maxHp;
  ally.move.pos = [5, 0, 2.5];
  ally.hp = ally.maxHp * 0.1;

  const context = bot.combatContext();
  assert.equal(context.ally, null, 'the direct heal target remains line-of-sight gated');
  assert.equal(context.blockedRescueAlly?.id, ally.id);
  const input = {
    f: false, b: false, l: false, r: false,
    fire: false, yaw: player.move.yaw, pitch: 0,
  };
  bot.applySupportPrimary(input, context);
  bot.applyRoleMovement(input, context);

  assert.equal(input.fire, false, 'no healing projectile is fired through geometry');
  assert.ok(bot.supportRescuePath.length > 0, 'a checked route is planned to recover line of sight');
  let previous = [...player.move.pos];
  for (const waypoint of bot.supportRescuePath) {
    assert.equal(
      canTraverseGroundSegment(world, previous, waypoint),
      true,
      `unsafe rescue segment ${previous} -> ${waypoint}`,
    );
    previous = waypoint;
  }
  assert.equal(input.f || input.b || input.l || input.r, true);
});

test('continuous healing prioritizes a pressured tank until another ally is critical', () => {
  const { world, player, bot } = makeBot('tsuzuri');
  const tank = world.addPlayer('tank', false, 0, 'zairu');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  const enemyA = world.addPlayer('enemy a', true, 1, 'baraga');
  const enemyB = world.addPlayer('enemy b', true, 1, 'nuedori');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  tank.move.pos = [6, 0, 4];
  damage.move.pos = [6, 3, 4];
  tank.hp = tank.maxHp * 0.6;
  damage.hp = damage.maxHp * 0.45;
  new BotController(world, enemyA, () => 0.5).claimTarget(tank);
  new BotController(world, enemyB, () => 0.5).claimTarget(tank);

  assert.equal(bot.woundedAlly()?.id, tank.id);

  damage.hp = damage.maxHp * 0.1;
  assert.equal(bot.woundedAlly()?.id, damage.id);
});

test('Shirabe links a visible damage ally and refreshes the link only near expiry', () => {
  const { world, player, bot } = makeBot('shirabe');
  const woundedTank = world.addPlayer('wounded tank', false, 0, 'zairu');
  const damage = world.addPlayer('damage', false, 0, 'asagi');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  woundedTank.move.pos = [6, 0, 4];
  woundedTank.hp = woundedTank.maxHp * 0.2;
  damage.move.pos = [0, 8, 4];
  player.abilities.cooldowns.ability1 = 99;
  player.abilities.cooldowns.ability2 = 99;

  let context = bot.combatContext();
  assert.equal(context.ally?.id, woundedTank.id, 'generic support target remains the wounded tank');
  assert.equal(context.damageAlly?.id, damage.id);
  let input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, context), 'secondary');
  bot.aimForAction(input, 'secondary', context);
  assert.ok(Math.abs(input.yaw - Math.PI / 2) < 0.08, `link yaw=${input.yaw}`);

  player.abilities.heroState.linkedId = damage.id;
  player.abilities.heroState.linkExpiresAt = world.t + 10;
  context = bot.combatContext();
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, context), null, 'healthy link is not needlessly replaced');

  player.abilities.heroState.linkExpiresAt = world.t + 1;
  context = bot.combatContext();
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, context), 'secondary');
});

test('Shirabe harmony release requires resource, an enemy, and a valid damage link', () => {
  const { world, player, bot } = makeBot('shirabe');
  const woundedTank = world.addPlayer('wounded tank', false, 0, 'zairu');
  const damage = world.addPlayer('linked damage', false, 0, 'asagi');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  woundedTank.move.pos = [6, 0, 4];
  woundedTank.hp = woundedTank.maxHp * 0.2;
  damage.move.pos = [0, 8, 4];
  damage.hp = damage.maxHp * 0.5;
  enemy.move.pos = [12, 0, 4];
  player.resource.value = player.resource.max;
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability2 = 99;

  let input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, bot.combatContext(enemy)), null, 'missing link blocks release');

  player.abilities.heroState.linkedId = damage.id;
  player.abilities.heroState.linkExpiresAt = world.t + 10;
  player.resource.value = 39;
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, bot.combatContext(enemy)), null, 'insufficient harmony blocks release');

  player.resource.value = 40;
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, bot.combatContext()), null, 'release waits for an enemy');

  const context = bot.combatContext(enemy);
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, context), 'ability1');
  bot.aimForAction(input, 'ability1', context);
  assert.ok(Math.abs(input.yaw - Math.PI / 2) < 0.08, `buff yaw=${input.yaw}`);

  player.abilities.heroState.linkExpiresAt = world.t;
  input = { secondary: false, ability1: false, ability2: false, ultimate: false, yaw: 0, pitch: 0 };
  assert.equal(bot.applyHeroAction(input, bot.combatContext(enemy)), null, 'expired link blocks release');
});

test('every hero policy can choose each of its four actions when that action alone is ready', () => {
  const slots = ['secondary', 'ability1', 'ability2', 'ultimate'];
  const overrides = {
    'zairu:secondary': { anchor: true },
    'zairu:ability2': { selfHp: 0.5, rewind: true },
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
    'shirabe:ability1': { link: true },
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
      // This table exercises action eligibility one slot at a time.  It must
      // not accidentally become a side-lane solo-engagement test.
      bot.route = 'front';
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
      if (setup.rewind) player.abilities.heroState.rewind = {
        pos: [0, 0, 10], expiresAt: world.t + 5,
      };
      if (setup.ownZone) world.zones.push({ ownerId: player.id });
      if (setup.storedHeal) ally.abilities.statuses.push({
        id: 'stored', kind: 'stored_heal', sourceId: player.id, amount: setup.storedHeal,
        convertAt: world.t + 5, expiresAt: world.t + 8,
      });
      if (setup.link) {
        player.abilities.heroState.linkedId = ally.id;
        player.abilities.heroState.linkExpiresAt = world.t + 10;
      }

      bot.think(world.dt);
      if (!player.input[slot]) missing.push(`${hero.id}:${slot}`);
    }
  }

  assert.deepEqual(missing, []);
});

test('Zairu commits to its placed anchor before considering anchor recall', () => {
  const { world, player, bot } = makeBot('zairu');
  const enemy = world.addPlayer('enemy', false, 1, 'baraga');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 10];
  enemy.move.pos = [10, 0, 10];
  player.abilities.heroState.anchor = { pos: [8, 0, 10], expiresAt: world.t + 5 };

  const input = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.equal(bot.applyHeroAction(input, bot.combatContext(enemy)), 'ability1');
  assert.equal(input.ability1, true);
  assert.equal(input.secondary, false);
});

test('Zairu places its opening anchor on a controlled frontline step instead of beyond the enemy', () => {
  const { world, player, bot } = makeBot('zairu');
  const enemy = world.addPlayer('enemy', false, 1, 'shiomaneki');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  bot.route = 'front';
  player.move.pos = [0, 0, 4];
  player.resource.value = player.resource.max;
  enemy.move.pos = [22, 0, 4];
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability2 = 99;

  const context = bot.combatContext(enemy);
  const input = {
    fire: false, secondary: false, ability1: false, ability2: false, ultimate: false,
    f: false, b: false, l: false, r: false, yaw: 0, pitch: 0,
  };
  assert.equal(bot.applyHeroAction(input, context), 'ability1');
  bot.aimForAction(input, 'ability1', context);
  world.queueInput(player.id, input);
  for (let tick = 0; tick < Math.ceil(0.5 / world.dt); tick++) world.tick();

  const anchor = world.drainEvents().find(event => (
    event.type === 'deployable_created' && event.abilityId === 'toubyou'
  ));
  assert.ok(anchor, 'expected Zairu to place an anchor');
  const advanceM = anchor.pos[0] - player.move.pos[0];
  assert.ok(advanceM >= 5.5, `anchor advance=${advanceM}`);
  assert.ok(advanceM <= 9.5, `anchor advance=${advanceM}`);
  assert.ok(anchor.pos[0] < enemy.move.pos[0] - 2, `anchor x=${anchor.pos[0]}`);
});

test('a pressured frontline opens with mitigation and does not stack another defense immediately', () => {
  const { world, player, bot } = makeBot('baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  world.objective.owner = enemy.team;
  player.move.pos = [0, 0, 4];
  player.hp = player.maxHp * 0.5;
  player.resource.value = player.resource.max;
  enemy.move.pos = [4, 0, 4];

  const first = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.equal(bot.applyHeroAction(first, bot.combatContext(enemy)), 'secondary');
  assert.equal(first.secondary, true);

  world.t += 0.5;
  const overlap = { secondary: false, ability1: false, ability2: false, ultimate: false };
  assert.notEqual(bot.applyHeroAction(overlap, bot.combatContext(enemy)), 'ability1');
  assert.equal(overlap.ability1, false);
});

test('a critical frontline mobility action aims away from the threat', () => {
  const { world, player, bot } = makeBot('nuedori');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  player.move.pos = [0, 0, 4];
  player.hp = player.maxHp * 0.4;
  enemy.move.pos = [4, 0, 4];
  player.abilities.cooldowns.ability1 = 99;
  player.abilities.cooldowns.ability2 = 99;

  bot.think(world.dt);

  assert.equal(player.input.secondary, true);
  assert.ok(Math.cos(player.input.yaw) < -0.7, `yaw=${player.input.yaw}`);
});

test('a cast-time frontline retreat preserves its escape direction through windup', () => {
  const { world, player, bot } = makeBot('vesta');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  world.objective.owner = enemy.team;
  bot.route = 'front';
  player.move.pos = [0, 0, 10];
  player.hp = player.maxHp * 0.4;
  player.resource.value = player.resource.max;
  enemy.move.pos = [4, 0, 10];
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability2 = 99;

  bot.think(world.dt);
  assert.equal(player.input.ability1, true);
  assert.ok(Math.cos(player.input.yaw) < -0.9, `activation yaw=${player.input.yaw}`);
  world.tick();
  assert.ok(player.abilities.cast, 'expected retreat dash windup');

  for (let tick = 0; tick < 30 && player.abilities.cast; tick++) {
    enemy.move.pos = [4, 0, 10];
    bot.think(world.dt);
    world.tick();
  }

  assert.equal(player.abilities.cast, null, 'retreat dash should complete');
  const towardEnemy = enemy.move.pos[0] - player.move.pos[0];
  assert.ok(player.move.vel[0] * towardEnemy < 0,
    `retreat velocity=${player.move.vel[0]}, playerX=${player.move.pos[0]}`);
});

test('damage backsteps face the threat while propelling away from it', () => {
  for (const heroId of ['shirasagi', 'botan']) {
    const { world, player, bot } = makeBot(heroId);
    const enemy = world.addPlayer('enemy', false, 1, 'zairu');
    world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
    bot.route = 'front';
    player.move.pos = [0, 0, 4];
    enemy.move.pos = [6, 0, 4];
    player.abilities.cooldowns.secondary = 99;
    player.abilities.cooldowns.ability1 = 99;

    bot.think(world.dt);
    assert.equal(player.input.ability2, true, heroId);
    assert.ok(Math.cos(player.input.yaw) > 0.9, `${heroId} yaw=${player.input.yaw}`);

    world.tick();
    const away = [
      player.move.pos[0] - enemy.move.pos[0],
      player.move.pos[1] - enemy.move.pos[1],
    ];
    const velocityAway = player.move.vel[0] * away[0] + player.move.vel[1] * away[1];
    assert.ok(velocityAway > 0, `${heroId} velocity=${player.move.vel}`);
  }
});

test('frontline barrier placement lands between the tank and a close enemy', () => {
  const { world, player, bot } = makeBot('baraga');
  const enemy = world.addPlayer('enemy', false, 1, 'sedora');
  world.flow.state = 'ACTIVE'; world.objective.unseal(); world.collider.dynamic = [];
  world.objective.owner = enemy.team;
  player.move.pos = [0, 0, 4];
  player.resource.value = player.resource.max;
  enemy.move.pos = [7, 0, 4];
  player.abilities.cooldowns.secondary = 99;
  player.abilities.cooldowns.ability2 = 99;

  bot.think(world.dt);
  world.tick();

  const barrier = world.drainEvents().find(event => event.type === 'barrier_created')?.barrier;
  assert.ok(barrier, 'expected a barrier creation event');
  assert.ok(barrier.center[0] > player.move.pos[0] + 1, `barrier x=${barrier.center[0]}`);
  assert.ok(barrier.center[0] < enemy.move.pos[0] - 0.5, `barrier x=${barrier.center[0]}`);
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

test('headless smoke runs role-valid teams through a bounded terminal lifecycle', {
  skip: process.env.KAGARIAI_SKIP_HEADLESS_TEST === '1',
  timeout: 240_000,
}, () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, [
    'tools/headless.js', '--matches', '3', '--seed', '20260719',
    '--smoke', '--round-cap-sec', '10', '--max-sim-sec', '60', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024 });
  const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1));

  assert.equal(summary.failures, 0);
  assert.deepEqual(summary.simulation, {
    profile: 'smoke',
    maxSimSec: 60,
    roundCapSec: 10,
    authoredRoundCapSec: 480,
    overrideRoundCapSec: 10,
    roundsToWin: 1,
    maxRounds: 1,
    setupSec: 0,
    resultSec: 0,
  });
  assert.equal(summary.roster.uniqueHeroes, 18);
  assert.equal(summary.seeds.length, 3);
  assert.equal(summary.teamCompositions.length, 3);
  for (const teams of summary.teamCompositions) {
    for (const roster of teams) {
      assert.deepEqual(
        roster.reduce((counts, slot) => ({ ...counts, [slot.role]: counts[slot.role] + 1 }), {
          frontline: 0, damage: 0, support: 0,
        }),
        { frontline: 1, damage: 2, support: 2 },
      );
    }
  }
  assert.equal(summary.completedMatches.length, 3);
  for (const match of summary.completedMatches) {
    assert.equal(match.finalState, 'MATCH_END', JSON.stringify(match));
    assert.equal(match.terminationReason, 'match_end', JSON.stringify(match));
    assert.ok(match.matchWinner === 0 || match.matchWinner === 1, JSON.stringify(match));
    assert.equal(Math.max(...match.score), 1, JSON.stringify(match));
    assert.ok(match.simulatedDurationSec <= summary.simulation.maxSimSec, JSON.stringify(match));
    assert.equal(match.finalObjective.state, 'complete', JSON.stringify(match));
    assert.ok(match.liveness, JSON.stringify(match));
    assert.ok(Number.isFinite(match.liveness.maxNoEffectiveObjectiveEntrySec), JSON.stringify(match));
    assert.ok(match.liveness.activeOnPointTicks.some(ticks => ticks > 0), JSON.stringify(match));
  }
  assert.ok(summary.actions.primary > 0);
  assert.ok(summary.actions.abilities > 0);
  assert.ok(summary.healing.events > 0);
  assert.ok(summary.healing.amount > 0);
  assert.deepEqual(summary.sideBalance, {
    evaluated: false,
    reason: 'smoke_single_round_matches',
  });
});

test('headless CLI isolates an authored roster rotation by its real match index', {
  skip: process.env.KAGARIAI_SKIP_HEADLESS_TEST === '1',
  timeout: 120_000,
}, () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, [
    'tools/headless.js', '--matches', '1', '--match-index', '1', '--seed', '20260719',
    '--smoke', '--round-cap-sec', '10', '--max-sim-sec', '60', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 90_000, maxBuffer: 16 * 1024 * 1024 });
  const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1));

  assert.equal(summary.failures, 0, JSON.stringify(summary));
  assert.equal(summary.startMatchIndex, 1);
  assert.deepEqual(summary.seeds, [20268638]);
  assert.deepEqual(summary.teamCompositions, [competitiveBotRotation(1).teams]);
  assert.equal(summary.completedMatches.length, 1);
  assert.equal(summary.completedMatches[0].matchIndex, 1);
  assert.equal(summary.completedMatches[0].seed, 20268638);
  assert.equal(summary.completedMatches[0].terminationReason, 'match_end');
});

test('headless CLI rejects an invalid match index before simulation begins', () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const result = spawnSync(process.execPath, [
    'tools/headless.js', '--match-index', '-1', '--matches', '1',
    '--smoke', '--round-cap-sec', '10', '--max-sim-sec', '60', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 10_000 });

  assert.notEqual(result.status, 0, JSON.stringify(result));
  assert.match(result.stderr, /--match-index must be a non-negative safe integer/);
});

test('headless profile reports bounded wall-clock diagnostic data', {
  skip: process.env.KAGARIAI_SKIP_HEADLESS_TEST === '1',
  timeout: 120_000,
}, () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, [
    'tools/headless.js', '--matches', '1', '--match-index', '1', '--seed', '20260719',
    '--smoke', '--round-cap-sec', '10', '--max-sim-sec', '60',
    '--profile', '--max-wall-sec', '90', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 100_000, maxBuffer: 16 * 1024 * 1024 });
  const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const profile = summary.completedMatches[0].performance;

  assert.equal(summary.failures, 0, JSON.stringify(summary));
  assert.equal(profile.enabled, true);
  assert.equal(profile.wallBudgetSec, 90);
  for (const value of [
    profile.wallElapsedMs,
    profile.botThinkMs,
    profile.worldTickMs,
    profile.maxBotThinkMs,
    profile.maxWorldTickMs,
    profile.maxLoopMs,
  ]) {
    assert.ok(Number.isFinite(value) && value >= 0, JSON.stringify(profile));
  }
  assert.ok(profile.slowestBotThink, JSON.stringify(profile));
  assert.ok(Number.isInteger(profile.slowestBotThink.tick), JSON.stringify(profile));
  assert.ok(Number.isFinite(profile.slowestBotThink.botThinkMs), JSON.stringify(profile));
});

test('headless acceptance completes the historically stalled roster seam', {
  skip: process.env.KAGARIAI_SKIP_HEADLESS_TEST === '1',
  timeout: 120_000,
}, () => {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const output = execFileSync(process.execPath, [
    'tools/headless.js', '--matches', '1', '--match-index', '1', '--seed', '20260719',
    '--max-sim-sec', '2700', '--profile', '--max-wall-sec', '90', '--quiet', '--json',
  ], { cwd: root, encoding: 'utf8', timeout: 110_000, maxBuffer: 16 * 1024 * 1024 });
  const summary = JSON.parse(output.trim().split(/\r?\n/).at(-1));
  const match = summary.completedMatches[0];

  assert.equal(summary.failures, 0, JSON.stringify(summary));
  assert.equal(match.matchIndex, 1);
  assert.equal(match.finalState, 'MATCH_END');
  assert.equal(match.terminationReason, 'match_end');
  assert.equal(match.performance.wallBudgetExceeded, false);
});
