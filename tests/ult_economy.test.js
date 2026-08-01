import test from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import {
  addGauge,
  gainFromDamage,
  gainFromHealing,
  gainFromPassive,
  spendGauge,
  refundGauge,
  carryoverGauge,
  summarizeUltimateUses,
} from '../shared/sim/ult_economy.js';
import { COMBAT, MODE } from './helpers.js';

const cfg = { gaugeMax: 100, damagePerGauge: 50, healingPerGauge: 40, passiveGaugePerSec: 2, carryoverMult: 0.5 };
test('ultimate economy converts active damage and healing deterministically', () => {
  assert.equal(gainFromDamage(500, cfg), 10);
  assert.equal(gainFromHealing(400, cfg), 10);
  assert.equal(gainFromPassive(10, cfg), 20);
  assert.equal(gainFromPassive(-10, cfg), 0);
  assert.equal(addGauge(95, 20, cfg), 100);
  assert.equal(addGauge(5, -2, cfg), 5);
});
test('ultimate economy spend, refund and round carryover are capped', () => {
  assert.deepEqual(spendGauge(100, 100, cfg), { ok: true, gauge: 0, paid: 100 });
  assert.equal(spendGauge(99, 100, cfg).ok, false);
  assert.equal(refundGauge(0, 100, 0.5, cfg), 50);
  assert.equal(carryoverGauge(100, cfg), 50);
});

test('the production economy cannot fund an ultimate from ninety seconds of idle regroup time', () => {
  // A coordinated reset must not turn wait time alone into the decisive
  // comeback tool. Damage and healing still supply the active charge path.
  const world = new World(buildMap(), MODE, COMBAT, 91);
  const regrouping = world.addPlayer('regrouping', false, 0, 'zairu');
  world.addPlayer('distant enemy', false, 1, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();

  for (let tick = 0; tick < Math.ceil(90 / world.dt); tick++) world.tick();

  assert.ok(
    regrouping.ultGauge < COMBAT.ultimateEconomy.gaugeMax,
    `idle gauge=${regrouping.ultGauge}`,
  );
});

test('the production economy grants passive charge only after a real combat contribution', () => {
  const world = new World(buildMap(), MODE, COMBAT, 92);
  const attacker = world.addPlayer('attacker', false, 0, 'asagi');
  const target = world.addPlayer('target', false, 1, 'baraga');
  world.flow.state = 'ACTIVE';
  world.objective.unseal();

  world.applyDamage(target, 10, attacker, false);
  const afterDamage = attacker.ultGauge;
  world.tick();

  assert.equal(
    attacker.ultGauge,
    afterDamage + gainFromPassive(world.dt, COMBAT.ultimateEconomy),
  );
});

test('ultimate match summaries expose average, median, outliers and zero-use rate', () => {
  assert.deepEqual(summarizeUltimateUses([
    { p1: { uses: 2 }, p2: { uses: 3 } },
    { p1: { uses: 4 }, p2: { uses: 3 } },
  ]), {
    playerMatches: 4,
    averageUses: 3,
    medianUses: 3,
    minUses: 2,
    maxUses: 4,
    zeroUseRate: 0,
  });
});
