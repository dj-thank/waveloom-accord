import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildMap } from '../shared/data/map_oshioi.js';
import { spawnWeaponProjectile } from '../shared/sim/projectiles.js';
import { World } from '../shared/sim/sim.js';
import { BotController } from '../server/bots.js';
import { COMBAT } from './helpers.js';

const FLASHPOINT_MODE = JSON.parse(readFileSync(
  new URL('../shared/data/mode_flashpoint.json', import.meta.url),
  'utf8',
));

function makeWorld(seed = 20260726, mode = structuredClone(FLASHPOINT_MODE)) {
  const world = new World(buildMap(), mode, COMBAT, seed);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 0;
  world.objective.unseal();
  world.collider.dynamic = [];
  world.drainEvents();
  return world;
}

function completeActiveSite(world, winnerTeam) {
  world.objective.win(winnerTeam, 'focused_test', world.events);
  world.tick();
}

function activatePendingSite(world, beforeTick = () => {}) {
  const pendingSiteId = world.flashpoint.pendingSiteId;
  let ticks = 0;
  while (world.flashpoint.lifecycle === 'transition' && ticks < 800) {
    beforeTick(world, pendingSiteId);
    world.tick();
    ticks++;
  }
  assert.ok(ticks > 0 && ticks < 800, 'twelve-second transition did not finish');
  assert.equal(world.flashpoint.activeSiteId, pendingSiteId);
  return { pendingSiteId, ticks };
}

test('Flashpoint World exposes five points, opens shiogama, and ignores inactive volumes', () => {
  const world = makeWorld();
  const player = world.addPlayer('site-probe', false, 0, 'asagi');
  const initial = world.snapshot();

  assert.equal(initial.activeObjectiveId, 'shiogama');
  assert.equal(initial.pendingObjectiveId, null);
  assert.deepEqual(
    initial.objectives.map(point => point.id),
    ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami'],
  );
  assert.equal(initial.objectives.filter(point => point.activation === 'active').length, 1);
  assert.equal(initial.flashpoint.lifecycle, 'active');

  const inactive = world.map.objectives.find(point => point.id === 'mizuichi');
  player.move.pos = [...inactive.center];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  world.tick();
  let snapshot = world.snapshot();
  let playerSnapshot = snapshot.players.find(candidate => candidate.id === player.id);
  assert.deepEqual(snapshot.objective.gauge, [0, 0]);
  assert.equal(player.insideObjective, false);
  assert.equal(playerSnapshot.onObjectiveId, null);
  assert.equal(playerSnapshot.onPoint, false);

  const opening = world.map.objectives.find(point => point.id === 'shiogama');
  player.move.pos = [...opening.center];
  player.move.vel = [0, 0, 0];
  player.move.grounded = true;
  world.tick();
  snapshot = world.snapshot();
  playerSnapshot = snapshot.players.find(candidate => candidate.id === player.id);
  assert.ok(snapshot.objective.gauge[0] > 0);
  assert.equal(playerSnapshot.onObjectiveId, 'shiogama');
  assert.equal(playerSnapshot.onPoint, true);

  const aliasMode = structuredClone(FLASHPOINT_MODE);
  delete aliasMode.id;
  aliasMode.areaPolicy = 'five_site_flashpoint';
  assert.equal(makeWorld(9, aliasMode).snapshot().activeObjectiveId, 'shiogama');
});

test('Flashpoint bots consume the exact side-authored route for the active and pending site', () => {
  const world = makeWorld(8128);
  const eastPlayer = world.addPlayer('east-route-probe', true, 0, 'zairu');
  const westPlayer = world.addPlayer('west-route-probe', true, 1, 'zairu');
  const eastBot = new BotController(world, eastPlayer, () => 0.5);
  const westBot = new BotController(world, westPlayer, () => 0.5);
  const routeTable = world.map.flashpoint.runtime.routesBySite;

  const assertSiteProjection = (siteId) => {
    const definition = world.map.objectives.find(point => point.id === siteId);
    assert.deepEqual(world.map.objective, definition, `objective projection did not select ${siteId}`);
    for (const [player, bot] of [[eastPlayer, eastBot], [westPlayer, westBot]]) {
      const side = world.sideOf(player.team);
      assert.deepEqual(
        bot.routePoints('front'),
        routeTable[siteId][side].front.points,
        `${side} bot mirrored or retained a stale ${siteId} route`,
      );
    }
  };

  assertSiteProjection('shiogama');
  completeActiveSite(world, 0);
  assert.equal(world.flashpoint.lifecycle, 'transition');
  assertSiteProjection(world.flashpoint.pendingSiteId);
});

test('site transition is capture-locked for 12s and preserves continuous world state', () => {
  const world = makeWorld(73);
  const holder = world.addPlayer('holder', false, 0, 'asagi');
  const casualty = world.addPlayer('casualty', false, 1, 'asagi');

  for (let tick = 0; tick < 70; tick++) world.tick();
  world.applyDamage(casualty, 9999, holder, false);
  const deathAt = world.respawn.pending.get(casualty.id);
  assert.ok(deathAt > 1, `death must be registered after world start: ${deathAt}`);

  holder.ultGauge = 73;
  holder.abilities.cooldowns.ability1 = 5;
  holder.lastCombatAt = Number.NEGATIVE_INFINITY;
  const positionBefore = [...holder.move.pos];
  const projectile = spawnWeaponProjectile(
    world,
    holder,
    {
      id: 'continuity_probe',
      type: 'projectile',
      damage: 0,
      maxRangeM: 1000,
      falloffStartM: 1000,
      falloffEndM: 1001,
      falloffMinMult: 1,
      projectileSpeedMps: 1,
      projectileRadiusM: 0,
    },
    [0, 0, 50],
    [0, 0, 1],
  );
  world.drainEvents();

  completeActiveSite(world, 0);

  assert.equal(world.flow.state, 'ACTIVE');
  assert.deepEqual(world.flow.score, [0, 0], 'one site point must not enter MatchFlow');
  assert.equal(world.flashpoint.lifecycle, 'transition');
  assert.equal(world.flashpoint.activeSiteId, null);
  assert.ok(world.flashpoint.pendingSiteId);
  assert.deepEqual(holder.move.pos, positionBefore, 'site completion teleported the player');
  assert.ok(holder.ultGauge >= 73, 'site completion reset ultimate charge');
  assert.ok(holder.abilities.cooldowns.ability1 > 4, 'site completion reset the cooldown');
  assert.equal(world.projectiles.some(candidate => candidate.id === projectile.id), true);
  assert.equal(world.respawn.pending.get(casualty.id), deathAt);
  assert.equal(holder.insideObjective, false);

  let snapshot = world.snapshot();
  assert.equal(snapshot.activeObjectiveId, null);
  assert.equal(snapshot.objective, null);
  assert.equal(snapshot.objectives.find(point => point.id === 'shiogama').result.winner, 0);
  assert.equal(
    snapshot.objectives.find(point => point.id === world.flashpoint.pendingSiteId).activation,
    'locked',
    'the pending site is selected by pendingObjectiveId, not exposed as a second active state',
  );
  assert.equal(snapshot.flashpoint.results.length, 1);

  const pending = world.map.objectives.find(
    point => point.id === world.flashpoint.pendingSiteId,
  );
  const keepAtPending = () => {
    holder.move.pos = [...pending.center];
    holder.move.vel = [0, 0, 0];
    holder.move.grounded = true;
  };
  while (world.flashpoint.transitionRemainingSec > world.dt + 1e-9) {
    keepAtPending();
    world.tick();
    assert.equal(world.flashpoint.activeSiteId, null);
    assert.equal(world.objective.time, 0);
    assert.deepEqual(world.objective.gauge, [0, 0]);
    assert.equal(holder.insideObjective, false);
  }

  assert.equal(casualty.alive, true, 'respawn clock stalled when the site clock reset');
  assert.equal(world.respawn.pending.has(casualty.id), false);
  assert.equal(world.projectiles.some(candidate => candidate.id === projectile.id), true);

  keepAtPending();
  world.tick();
  snapshot = world.snapshot();
  assert.equal(world.flashpoint.lifecycle, 'active');
  assert.equal(world.flashpoint.activeSiteId, pending.id);
  assert.equal(world.flashpoint.pendingSiteId, null);
  assert.equal(snapshot.activeObjectiveId, pending.id);
  assert.ok(snapshot.objective.gauge[0] > 0, 'new site did not begin capture when activated');
  assert.equal(
    snapshot.players.find(candidate => candidate.id === holder.id).onObjectiveId,
    pending.id,
  );
});

test('only the third Flashpoint site win produces the final MatchFlow round win', () => {
  const world = makeWorld('sweep-seed');

  completeActiveSite(world, 0);
  assert.equal(world.flow.state, 'ACTIVE');
  assert.deepEqual(world.flow.score, [0, 0]);
  activatePendingSite(world);

  completeActiveSite(world, 0);
  assert.equal(world.flow.state, 'ACTIVE');
  assert.deepEqual(world.flow.score, [0, 0]);
  activatePendingSite(world);

  completeActiveSite(world, 0);
  const snapshot = world.snapshot();
  assert.equal(world.flashpoint.lifecycle, 'complete');
  assert.deepEqual(world.flashpoint.siteScores, [3, 0]);
  assert.equal(world.flashpoint.winnerTeam, 0);
  assert.equal(world.flow.state, 'ROUND_END');
  assert.deepEqual(world.flow.score, [1, 0]);
  assert.equal(snapshot.activeObjectiveId, null);
  assert.equal(snapshot.pendingObjectiveId, null);
  assert.equal(snapshot.objective, null);
  assert.equal(snapshot.flashpoint.results.length, 3);
  assert.equal(snapshot.objectives.filter(point => point.activation === 'resolved').length, 3);
  assert.equal(new Set(world.flashpoint.completedSiteIds).size, 3);
});
