import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import {
  BotNavigationAudit,
  runBotNavigationAudit,
} from '../tools/bot_navigation_audit.js';
import { MODE, COMBAT } from './helpers.js';

test('navigation audit catches a combat-ineffective advancing bot', () => {
  const world = new World(buildMap(), MODE, COMBAT, 7);
  const player = world.addPlayer('pinned', true, 0, 'zairu');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  controller.mode = 'advance';
  player.inputCommandState.f = true;
  const audit = new BotNavigationAudit(world, [controller], {
    warmupSec: 0,
    inactivitySec: 1,
    stallSec: 0.5,
  });
  for (let step = 0; step < 12; step++) {
    world.t += 0.1;
    audit.observeTick(0.1);
  }
  const types = audit.summary().violations.map(violation => violation.type);
  assert.ok(types.includes('persistent_stall'));
  assert.ok(types.includes('combat_ineffective'));
});

test('movement alone cannot hide a tactically ineffective bot', () => {
  const world = new World(buildMap(), MODE, COMBAT, 8);
  const player = world.addPlayer('wandering', true, 0, 'asagi');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  controller.mode = 'fight';
  const audit = new BotNavigationAudit(world, [controller], {
    warmupSec: 0,
    inactivitySec: 10,
    tacticalInactivitySec: 0.5,
  });
  for (let step = 0; step < 8; step++) {
    player.move.pos[0] += 0.6;
    world.t += 0.1;
    audit.observeTick(0.1);
  }
  const types = audit.summary().violations.map(violation => violation.type);
  assert.ok(types.includes('tactically_ineffective'));
  assert.ok(!types.includes('combat_ineffective'));
});

test('a complete roster may hold its safe staging point while a casualty is regrouping', () => {
  const world = new World(buildMap(), MODE, COMBAT, 11);
  const player = world.addPlayer('staged tank', true, 0, 'zairu');
  world.addPlayer('damage a', true, 0, 'asagi');
  world.addPlayer('damage b', true, 0, 'ibuki');
  world.addPlayer('sustain', true, 0, 'tsuzuri');
  const casualty = world.addPlayer('casualty', true, 0, 'karakasa');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  casualty.alive = false;
  const stage = world.sideOf(0) === 'east'
    ? world.map.routes.front[2]
    : [-world.map.routes.front[2][0], -world.map.routes.front[2][1], world.map.routes.front[2][2]];
  player.move.pos = [...stage];
  player.move.grounded = true;
  controller.mode = 'regroup';
  const audit = new BotNavigationAudit(world, [controller], {
    warmupSec: 0,
    inactivitySec: 0.5,
    tacticalInactivitySec: 0.5,
  });

  for (let step = 0; step < 10; step++) {
    world.t += 0.1;
    audit.observeTick(0.1);
  }

  const result = audit.summary();
  assert.equal(result.violations.length, 0, JSON.stringify(result.violations));
  assert.ok(result.aggregate.coordinatedRegroupHoldSec >= 0.9);
});

test('authoritative void death remains a violation after the bot becomes ineligible', () => {
  const world = new World(buildMap(), MODE, COMBAT, 9);
  const player = world.addPlayer('falling', true, 0, 'zairu');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  const audit = new BotNavigationAudit(world, [controller], { warmupSec: 0 });
  player.move.pos[2] = world.map.killZ - 1;
  world.eliminatePlayer(player, { cause: 'environment', environment: 'void_fall' });
  audit.recordEvents(world.drainEvents());
  audit.observeTick(0.1);
  const result = audit.summary();
  assert.equal(result.aggregate.environmentalDeaths, 1);
  assert.equal(result.aggregate.voidDeaths, 1);
  assert.equal(result.aggregate.pass, false);
  assert.ok(result.violations.some(violation => violation.type === 'environmental_death'));
});

test('an in-progress recovery is explicit and fully accounted at capture end', () => {
  const world = new World(buildMap(), MODE, COMBAT, 10);
  const player = world.addPlayer('recovering', true, 0, 'zairu');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  const audit = new BotNavigationAudit(world, [controller], { warmupSec: 0 });
  controller.recoveryPath = [[player.move.pos[0] + 2, player.move.pos[1], player.move.pos[2]]];
  world.t += 0.1;
  audit.observeTick(0.1);
  const result = audit.summary();
  assert.equal(result.aggregate.recoveryStarts, 1);
  assert.equal(result.aggregate.recoveryCompletions, 0);
  assert.equal(result.aggregate.recoveryInterruptions, 0);
  assert.equal(result.aggregate.activeRecoveries, 1);
  assert.equal(result.aggregate.pass, true);
});

test('route evidence classifies by effective route while retaining the raw route', () => {
  const world = new World(buildMap(), MODE, COMBAT, 12);
  const player = world.addPlayer('route-evidence', true, 0, 'asagi');
  const controller = new BotController(world, player, () => 0.5);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 3;
  world.t = 3;
  controller.route = 'cloister';
  controller.activeRouteName = () => 'front';
  player.move.pos[0] = world.map.boundsM.x[1] + 2;
  const audit = new BotNavigationAudit(world, [controller], { warmupSec: 0 });

  world.t += 0.1;
  audit.observeTick(0.1);

  const result = audit.summary();
  const violation = result.violations.find(candidate => candidate.type === 'out_of_bounds');
  assert.equal(violation.route, 'front');
  assert.equal(violation.rawRoute, 'cloister');
  assert.equal(result.trajectory[0].route, 'front');
  assert.equal(result.trajectory[0].rawRoute, 'cloister');
});

test('role-valid live navigation audit has no stranded, falling, or out-of-bounds bot', { timeout: 20_000 }, async () => {
  const result = await runBotNavigationAudit({ seed: 20260713, durationSec: 90 });
  assert.equal(result.aggregate.pass, true, JSON.stringify(result.violations, null, 2));
  assert.equal(result.aggregate.players, 10);
  assert.equal(result.aggregate.falls, 0);
  assert.equal(result.aggregate.environmentalDeaths, 0);
  assert.equal(result.aggregate.voidDeaths, 0);
  assert.ok(result.trajectory.length >= 800);
  assert.deepEqual(
    result.teamCompositions.map(team => team.map(slot => slot.role)),
    [
      ['frontline', 'damage', 'damage', 'support', 'support'],
      ['frontline', 'damage', 'damage', 'support', 'support'],
    ],
  );
});

test('navigation audit mirror pair exposes the same seed and logical controller identities', {
  timeout: 20_000,
}, async () => {
  const base = await runBotNavigationAudit({ matchIndex: 1, durationSec: 1 });
  const mirrored = await runBotNavigationAudit({ matchIndex: 4, durationSec: 1 });
  const identities = result => new Map(result.botRng.controllers.map(controller => [
    controller.heroId,
    { identity: controller.identity, physicalTeam: controller.physicalTeam },
  ]));
  const baseIdentities = identities(base);
  const mirroredIdentities = identities(mirrored);

  assert.equal(base.seed, 20268632);
  assert.equal(mirrored.seed, 20268632);
  assert.equal(base.rotation.canonicalLineupIndex, 1);
  assert.equal(mirrored.rotation.canonicalLineupIndex, 1);
  assert.equal(base.rotation.mirrored, false);
  assert.equal(mirrored.rotation.mirrored, true);
  assert.equal(base.botRng.scheme.defaultDomain, 'bot-controller');
  assert.equal(base.botRng.scheme.sideDrawDomain, 'match-side-draw');
  assert.equal(base.botRng.scheme.matchSeedDomain, 'match-world-seed');
  for (const [heroId, original] of baseIdentities) {
    const reversed = mirroredIdentities.get(heroId);
    assert.equal(reversed.identity, original.identity, heroId);
    assert.equal(reversed.physicalTeam, 1 - original.physicalTeam, heroId);
  }
});

test('adverse roster seed keeps stair fights and flank rejoining on playable ground', { timeout: 20_000 }, async () => {
  const result = await runBotNavigationAudit({
    seed: 20268632,
    matchIndex: 1,
    durationSec: 160,
  });

  assert.equal(result.aggregate.pass, true, JSON.stringify(result.violations, null, 2));
});
