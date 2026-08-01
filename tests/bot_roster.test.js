import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HEROES } from '../shared/data/heroes.js';
import {
  MIN_COMPETITIVE_ROSTER_MATCHES,
  assertCompetitiveBotTeams,
  competitiveBotFillSlots,
  competitiveBotRotation,
  pairedBotSeedForMatch,
  competitiveBotTeams,
} from '../shared/rules/bot_roster.js';
import { ROLE_SLOTS, countRoles, validateSustainComposition } from '../shared/rules/team_composition.js';

test('competitive bot roster is exact 1/2/2 for both teams in every match', () => {
  assert.equal(MIN_COMPETITIVE_ROSTER_MATCHES, 6);
  for (let match = 0; match < 12; match++) {
    const teams = competitiveBotTeams(match);
    assert.equal(assertCompetitiveBotTeams(teams), true);
    for (const roster of teams) {
      assert.equal(roster.length, 5);
      assert.deepEqual(countRoles(roster), ROLE_SLOTS);
      assert.equal(new Set(roster.map(slot => slot.heroId)).size, 5);
    }
    const heroById = new Map(HEROES.map(hero => [hero.id, hero]));
    const projected = teams.flatMap((roster, team) => roster.map(slot => ({
      ...slot,
      team,
      teamFunctions: heroById.get(slot.heroId)?.teamFunctions,
    })));
    assert.equal(validateSustainComposition(projected).ok, true);
  }
});

test('minimum mirrored competitive rotation covers all canonical heroes', () => {
  const covered = new Set();
  for (let match = 0; match < MIN_COMPETITIVE_ROSTER_MATCHES; match++) {
    for (const roster of competitiveBotTeams(match)) {
      for (const slot of roster) covered.add(slot.heroId);
    }
  }
  assert.deepEqual([...covered].sort(), HEROES.map(hero => hero.id).sort());
});

test('competitive bot roster is deterministic and repeats only after its full cycle', () => {
  assert.deepEqual(competitiveBotTeams(0), competitiveBotTeams(0));
  assert.notDeepEqual(competitiveBotTeams(0), competitiveBotTeams(1));
  assert.notDeepEqual(competitiveBotTeams(1), competitiveBotTeams(2));
  assert.notDeepEqual(competitiveBotTeams(0), competitiveBotTeams(3));
  assert.deepEqual(competitiveBotTeams(0), competitiveBotTeams(6));
});

test('every authored matchup is replayed with exact team-side reversal', () => {
  for (let match = 0; match < 3; match++) {
    const base = competitiveBotTeams(match);
    const mirrored = competitiveBotTeams(match + 3);
    assert.deepEqual(mirrored, [base[1], base[0]]);
  }
});

test('mirror pairs reuse one acceptance seed and the same logical lineup slots', () => {
  const expectedSeeds = [20260713, 20268632, 20276551];
  for (let lineup = 0; lineup < expectedSeeds.length; lineup++) {
    const base = competitiveBotRotation(lineup);
    const mirrored = competitiveBotRotation(lineup + 3);

    assert.equal(base.acceptanceSeed, expectedSeeds[lineup]);
    assert.equal(mirrored.acceptanceSeed, expectedSeeds[lineup]);
    assert.equal(base.canonicalLineupIndex, lineup);
    assert.equal(mirrored.canonicalLineupIndex, lineup);
    assert.equal(base.mirrored, false);
    assert.equal(mirrored.mirrored, true);
    assert.equal(base.mirrorMatchIndex, lineup + 3);
    assert.equal(mirrored.mirrorMatchIndex, lineup);
    assert.deepEqual(mirrored.teams, [base.teams[1], base.teams[0]]);

    const baseSlots = new Map(base.rngSlots.flat().map(slot => [slot.heroId, slot]));
    const mirroredSlots = new Map(mirrored.rngSlots.flat().map(slot => [slot.heroId, slot]));
    assert.equal(baseSlots.size, 10);
    assert.deepEqual([...mirroredSlots.keys()].sort(), [...baseSlots.keys()].sort());
    for (const [heroId, slot] of baseSlots) {
      assert.equal(mirroredSlots.get(heroId).logicalLineupSlot, slot.logicalLineupSlot);
      assert.equal(mirroredSlots.get(heroId).lineupSide, slot.lineupSide);
      assert.equal(mirroredSlots.get(heroId).slotIndex, slot.slotIndex);
      assert.equal(Object.hasOwn(slot, 'team'), false);
    }
  }
});

test('paired seed planning preserves mirror pairs while adding new soak seed trios', () => {
  assert.deepEqual(
    Array.from({ length: 12 }, (_, matchIndex) => pairedBotSeedForMatch(20260713, matchIndex)),
    [
      20260713, 20268632, 20276551,
      20260713, 20268632, 20276551,
      20284470, 20292389, 20300308,
      20284470, 20292389, 20300308,
    ],
  );
});

test('every hero appears equally often on both team indices over the mirror cycle', () => {
  const appearances = new Map(HEROES.map(hero => [hero.id, [0, 0]]));
  for (let match = 0; match < MIN_COMPETITIVE_ROSTER_MATCHES; match++) {
    const teams = competitiveBotTeams(match);
    for (const team of [0, 1]) {
      for (const slot of teams[team]) appearances.get(slot.heroId)[team]++;
    }
  }
  for (const [heroId, sides] of appearances) {
    assert.equal(sides[0], sides[1], `${heroId} team-index appearances ${sides}`);
  }
});

test('the canonical three authored matchups fix whole-composition matchups as one SSOT', () => {
  const expected = [
    [
      ['zairu', 'shirasagi', 'hokuchi', 'tsuzuri', 'shirabe'],
      ['shiomaneki', 'asagi', 'ankou', 'hibari', 'karakasa'],
    ],
    [
      ['vesta', 'botan', 'ankou', 'tsuzuri', 'kazura'],
      ['nuedori', 'shirasagi', 'asagi', 'hibari', 'shirabe'],
    ],
    [
      ['baraga', 'tsubakuro', 'botan', 'tsuzuri', 'karakasa'],
      ['sedora', 'hokuchi', 'ankou', 'hibari', 'koyomi'],
    ],
  ];

  for (let match = 0; match < expected.length; match++) {
    assert.deepEqual(
      competitiveBotTeams(match).map(team => team.map(slot => slot.heroId)),
      expected[match],
    );
  }
});

test('frontline matchups pair comparable HP and mitigation archetypes', () => {
  const expectedFrontlines = [
    ['zairu', 'shiomaneki'],
    ['vesta', 'nuedori'],
    ['baraga', 'sedora'],
  ];
  const heroById = new Map(HEROES.map(hero => [hero.id, hero]));

  for (let match = 0; match < expectedFrontlines.length; match++) {
    const actual = competitiveBotTeams(match).map(team => (
      team.find(slot => slot.role === 'frontline').heroId
    ));
    assert.deepEqual(actual, expectedFrontlines[match]);
    const tanks = actual.map(id => heroById.get(id));
    assert.ok(Math.abs(tanks[0].maxHp - tanks[1].maxHp) <= 50);
    assert.equal(
      tanks[0].teamFunctions.includes('mitigation'),
      tanks[1].teamFunctions.includes('mitigation'),
    );
  }
});

test('each matchup contains exactly one mitigation utility instead of stacking defenses', () => {
  const heroById = new Map(HEROES.map(hero => [hero.id, hero]));
  for (let match = 0; match < MIN_COMPETITIVE_ROSTER_MATCHES; match++) {
    const teams = competitiveBotTeams(match);
    const mitigationUtilityTeams = teams.flatMap((team, index) => team
      .filter(slot => slot.role === 'support')
      .map(slot => heroById.get(slot.heroId))
      .filter(hero => !hero.teamFunctions.includes('continuous_sustain'))
      .filter(hero => hero.teamFunctions.includes('mitigation'))
      .map(() => index));

    assert.equal(mitigationUtilityTeams.length, 1);
  }
});

test('runtime bot fill projects the canonical roster around human-held slots without dropping sustain', () => {
  const heroById = new Map(HEROES.map(hero => [hero.id, hero]));
  for (let match = 0; match < MIN_COMPETITIVE_ROSTER_MATCHES; match++) {
    const allBot = competitiveBotTeams(match);
    for (const team of [0, 1]) {
      assert.deepEqual(competitiveBotFillSlots(match, team, []), allBot[team]);
    }
  }

  const human = HEROES.find(hero => hero.id === 'hibari');
  const occupied = [{
    id: 'human-support',
    team: 0,
    isBot: false,
    heroId: human.id,
    role: human.role,
    teamFunctions: human.teamFunctions,
  }];
  const fills = competitiveBotFillSlots(2, 0, occupied);
  const combined = [...occupied, ...fills.map(slot => ({
    ...slot,
    team: 0,
    isBot: true,
    teamFunctions: heroById.get(slot.heroId)?.teamFunctions,
  }))];

  assert.equal(fills.length, 4);
  assert.deepEqual(countRoles(combined), ROLE_SLOTS);
  assert.equal(validateSustainComposition(combined, [0]).ok, true);
});
