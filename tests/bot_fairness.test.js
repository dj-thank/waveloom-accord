import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BOT_RNG_SCHEME,
  makeBotRng,
  scheduleBotThinkOrder,
} from '../server/bot_fairness.js';
import { competitiveBotRotation } from '../shared/rules/bot_roster.js';
import { makeRng } from '../shared/sim/rng.js';

function take(rng, count) {
  return Array.from({ length: count }, () => rng());
}

test('mirror-side bots reuse the same logical lineup stream regardless of team or insertion order', () => {
  const a = { id: 'p10', team: 0, heroId: 'asagi' };
  const b = { id: 'p20', team: 1, heroId: 'hibari' };
  const roster = [a, b];
  const logicalLineupSlot = 'lineup:0|side:b|slot:1';

  const isolatedA = take(makeBotRng(20260722, a, roster, { logicalLineupSlot }), 4);
  const isolatedB = take(makeBotRng(20260722, b, roster), 4);
  const interleavedA = makeBotRng(20260722, a, [...roster].reverse(), { logicalLineupSlot });
  const interleavedB = makeBotRng(20260722, b, [...roster].reverse());
  const actualA = [];
  const actualB = [];
  for (let index = 0; index < 4; index++) {
    actualA.push(interleavedA());
    actualB.push(interleavedB());
  }

  assert.deepEqual(actualA, isolatedA);
  assert.deepEqual(actualB, isolatedB);
  assert.notDeepEqual(isolatedA, isolatedB);

  const mirroredLogicalBot = { ...a, id: 'p999', team: 1 };
  assert.deepEqual(
    take(makeBotRng(20260722, mirroredLogicalBot, [mirroredLogicalBot], { logicalLineupSlot }), 4),
    take(makeBotRng(20260722, a, [a], { logicalLineupSlot }), 4),
  );
  assert.deepEqual(
    take(makeBotRng(20260722, mirroredLogicalBot, [mirroredLogicalBot]), 4),
    take(makeBotRng(20260722, a, [a]), 4),
    'legacy callers must not reintroduce physical team into RNG identity',
  );
});

test('different logical lineup slots and heroes never run in complete lockstep', () => {
  const first = { id: 'p2', team: 0, heroId: 'asagi' };
  const sameHeroOtherSlot = { id: 'p9', team: 1, heroId: 'asagi' };
  const otherHeroSameSlot = { id: 'p10', team: 1, heroId: 'hibari' };
  const roster = [first, sameHeroOtherSlot, otherHeroSameSlot];
  const firstSlot = 'lineup:1|side:a|slot:1';
  const secondSlot = 'lineup:1|side:b|slot:1';

  const firstSequence = take(makeBotRng(77, first, roster, {
    logicalLineupSlot: firstSlot,
  }), 4);
  const differentSlotSequence = take(makeBotRng(77, sameHeroOtherSlot, [...roster].reverse(), {
    logicalLineupSlot: secondSlot,
  }), 4);
  const differentHeroSequence = take(makeBotRng(77, otherHeroSameSlot, roster, {
    logicalLineupSlot: firstSlot,
  }), 4);

  assert.notDeepEqual(firstSequence, differentSlotSequence);
  assert.notDeepEqual(firstSequence, differentHeroSequence);
  assert.deepEqual(firstSequence, take(makeBotRng(77, first, [...roster].reverse(), {
    logicalLineupSlot: firstSlot,
  }), 4));
});

test('bot RNG isolates domain counters and records the world-seed/controller contract', () => {
  const player = { id: 'p2', team: 0, heroId: 'asagi' };
  const options = { logicalLineupSlot: 'lineup:2|side:a|slot:1' };
  const mixed = makeBotRng(20276551, player, [player], options);

  const controller0 = mixed();
  const sideDraw0 = mixed(BOT_RNG_SCHEME.sideDrawDomain);
  const controller1 = mixed();
  const isolatedController = makeBotRng(20276551, player, [player], options);
  const isolatedSideDraw = makeBotRng(20276551, player, [player], options);

  assert.deepEqual([controller0, controller1], [isolatedController(), isolatedController()]);
  assert.equal(sideDraw0, isolatedSideDraw(BOT_RNG_SCHEME.sideDrawDomain));
  assert.notEqual(controller0, sideDraw0);
  assert.notEqual(controller0, makeRng(20276551)(), 'controller RNG must not alias the World stream');
  assert.notEqual(
    controller0,
    makeBotRng(20276552, player, [player], options)(),
    'the authoritative match/world seed must remain an explicit RNG input',
  );
  assert.deepEqual(mixed.metadata, {
    schemeId: 'kagariai.bot-rng.counter-domain.v1',
    matchSeed: 20276551,
    logicalLineupSlot: options.logicalLineupSlot,
    heroId: 'asagi',
    identity: `${options.logicalLineupSlot}|hero:asagi`,
    defaultDomain: 'bot-controller',
    physicalTeamInIdentity: false,
  });
  assert.deepEqual(BOT_RNG_SCHEME, {
    id: 'kagariai.bot-rng.counter-domain.v1',
    defaultDomain: 'bot-controller',
    sideDrawDomain: 'match-side-draw',
    matchSeedDomain: 'match-world-seed',
    physicalTeamInIdentity: false,
  });
});

test('all three canonical mirror pairs preserve hero-slot streams without intra-lineup lockstep', () => {
  const streamsFor = rotation => {
    const records = rotation.teams.flatMap((team, physicalTeam) => team.map((slot, slotIndex) => ({
      player: { id: `${physicalTeam}-${slotIndex}`, team: physicalTeam, heroId: slot.heroId },
      logicalLineupSlot: rotation.rngSlots[physicalTeam][slotIndex].logicalLineupSlot,
    })));
    const roster = records.map(record => record.player).reverse();
    return new Map(records.map(({ player, logicalLineupSlot }) => [
      player.heroId,
      take(makeBotRng(rotation.acceptanceSeed, player, roster, { logicalLineupSlot }), 4),
    ]));
  };

  for (let lineup = 0; lineup < 3; lineup++) {
    const base = streamsFor(competitiveBotRotation(lineup));
    const mirrored = streamsFor(competitiveBotRotation(lineup + 3));
    assert.equal(base.size, 10);
    assert.equal(new Set([...base.values()].map(JSON.stringify)).size, 10);
    for (const [heroId, sequence] of base) assert.deepEqual(mirrored.get(heroId), sequence, heroId);
  }
});

test('bot think order ignores insertion order and rotates each team first mover every tick', () => {
  const controllers = [
    { pl: { id: 'p1', team: 0, heroId: 'alpha' } },
    { pl: { id: 'p2', team: 0, heroId: 'beta' } },
    { pl: { id: 'p3', team: 0, heroId: 'gamma' } },
    { pl: { id: 'p4', team: 1, heroId: 'alpha' } },
    { pl: { id: 'p5', team: 1, heroId: 'beta' } },
    { pl: { id: 'p6', team: 1, heroId: 'gamma' } },
  ];
  const expectedByTick = [
    ['p1', 'p4', 'p2', 'p5', 'p3', 'p6'],
    ['p5', 'p2', 'p6', 'p3', 'p4', 'p1'],
    ['p3', 'p6', 'p1', 'p4', 'p2', 'p5'],
  ];

  for (let tick = 0; tick < expectedByTick.length; tick++) {
    const scheduled = scheduleBotThinkOrder(controllers, tick).map(controller => controller.pl.id);
    const reversed = scheduleBotThinkOrder([...controllers].reverse(), tick)
      .map(controller => controller.pl.id);
    assert.deepEqual(scheduled, expectedByTick[tick]);
    assert.deepEqual(reversed, expectedByTick[tick]);
  }
});
