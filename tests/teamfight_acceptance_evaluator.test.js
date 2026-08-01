import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptanceSeedForMatch,
  evaluateTeamfightAcceptance,
  runAcceptanceViolations,
} from '../shared/telemetry/teamfight_acceptance.js';

function passingRun(matchIndex, overrides = {}) {
  const seed = acceptanceSeedForMatch(matchIndex);
  return {
    matchIndex,
    seed,
    pressureAnchorHealingByTeam: [
      { team: 0, atFrontAmount: 200, atFrontWindows: 3, longestAtFrontWindowSec: 4 },
      { team: 1, atFrontAmount: 180, atFrontWindows: 2, longestAtFrontWindowSec: 4 },
    ],
    objective: {
      twoSidedNearObjectiveSec: 15,
      pressureAnchorNearObjectiveSec: [31, 29],
    },
    engagementSummary: {
      resolvedTeamfightCount: 2,
      medianResolvedTeamfightContactSpanSec: 12,
      medianResolvedTeamfightTimeToFirstCasualtySec: 8,
      fullRoleParticipationCount: 1,
    },
    engagements: [{
      resolved: true,
      bilateralHostileContact: true,
      contactSpanSec: 12,
    }],
    dps: {
      team0: { team: 0, offensiveEvents: { duringAnchorEngaged: { total: 12 } } },
      team1: { team: 1, offensiveEvents: { duringAnchorEngaged: { total: 12 } } },
    },
    combatTotals: { killsByTeam: [6, 4] },
    regroup: {
      staggeredExitRate: 0.25,
      staggeredFightEntryRate: 0.25,
    },
    ...overrides,
  };
}

test('acceptance seeds repeat for each authored matchup and side-mirror cycle', () => {
  assert.deepEqual(
    Array.from({ length: 9 }, (_, matchIndex) => acceptanceSeedForMatch(matchIndex)),
    [
      20260713, 20268632, 20276551,
      20260713, 20268632, 20276551,
      20260713, 20268632, 20276551,
    ],
  );
  assert.throws(() => acceptanceSeedForMatch(-1), /non-negative integer/);
});

test('a run exactly preserves the established teamfight acceptance gates', () => {
  assert.deepEqual(runAcceptanceViolations(passingRun(0)), []);
});

test('established acceptance thresholds remain inclusive without relaxation', () => {
  const lowerBounds = passingRun(0, {
    pressureAnchorHealingByTeam: [
      { team: 0, atFrontAmount: 100, atFrontWindows: 2, longestAtFrontWindowSec: 0 },
      { team: 1, atFrontAmount: 100, atFrontWindows: 2, longestAtFrontWindowSec: 0 },
    ],
    objective: {
      twoSidedNearObjectiveSec: 10,
      pressureAnchorNearObjectiveSec: [10, 10],
    },
    engagementSummary: {
      resolvedTeamfightCount: 1,
      medianResolvedTeamfightContactSpanSec: 7,
      medianResolvedTeamfightTimeToFirstCasualtySec: 3,
      fullRoleParticipationCount: 1,
    },
    dps: {
      team0: { team: 0, offensiveEvents: { duringAnchorEngaged: { total: 12 } } },
      team1: { team: 1, offensiveEvents: { duringAnchorEngaged: { total: 4 } } },
    },
    combatTotals: { killsByTeam: [5, 2] },
  });
  const upperBounds = passingRun(0, {
    engagementSummary: {
      resolvedTeamfightCount: 1,
      medianResolvedTeamfightContactSpanSec: 30,
      medianResolvedTeamfightTimeToFirstCasualtySec: 20,
      fullRoleParticipationCount: 1,
    },
  });

  assert.deepEqual(runAcceptanceViolations(lowerBounds), []);
  assert.deepEqual(runAcceptanceViolations(upperBounds), []);
});

test('one sustained recovery window and real DPS attacks pass without using movement as a proxy', () => {
  const sustained = passingRun(0, {
    pressureAnchorHealingByTeam: [
      { team: 0, atFrontAmount: 795, atFrontWindows: 1, longestAtFrontWindowSec: 14.444 },
      { team: 1, atFrontAmount: 132.2, atFrontWindows: 2, longestAtFrontWindowSec: 2.412 },
    ],
    dps: {
      team0: { team: 0, offensiveEvents: { duringAnchorEngaged: { total: 20 } } },
      team1: { team: 1, offensiveEvents: { duringAnchorEngaged: { total: 39 } } },
    },
  });

  assert.deepEqual(runAcceptanceViolations(sustained), []);
});

test('paired aggregate reports mirror-aligned differences without gating on new thresholds', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs[3] = passingRun(3, {
    pressureAnchorHealingByTeam: [
      { team: 0, atFrontAmount: 120, atFrontWindows: 2 },
      { team: 1, atFrontAmount: 230, atFrontWindows: 4 },
    ],
    objective: {
      twoSidedNearObjectiveSec: 23,
      pressureAnchorNearObjectiveSec: [19, 28],
    },
    engagementSummary: {
      resolvedTeamfightCount: 2,
      medianResolvedTeamfightContactSpanSec: 18,
      medianResolvedTeamfightTimeToFirstCasualtySec: 11,
      fullRoleParticipationCount: 1,
    },
    engagements: [{
      resolved: true,
      bilateralHostileContact: true,
      contactSpanSec: 18,
    }],
    combatTotals: { killsByTeam: [3, 7] },
  });

  const evaluation = evaluateTeamfightAcceptance(runs);
  const pair = evaluation.pairs[0];

  assert.equal(evaluation.pass, true);
  assert.equal(pair.pass, true);
  assert.deepEqual(pair.matchIndices, [0, 3]);
  assert.equal(pair.seed, 20260713);
  assert.deepEqual(pair.killSharesByLineupAndDirection, [
    [0.6, 0.7],
    [0.4, 0.3],
  ]);
  assert.equal(pair.killShareDifference, 0.1);
  assert.deepEqual(pair.firstCasualtySecByDirection, [8, 11]);
  assert.equal(pair.firstCasualtyDifferenceSec, 3);
  assert.deepEqual(pair.contactSpanSecByDirection, [12, 18]);
  assert.equal(pair.contactSpanDifferenceSec, 6);
  assert.deepEqual(pair.twoSidedObjectiveSecByDirection, [15, 23]);
  assert.equal(pair.twoSidedObjectiveDifferenceSec, 8);
  assert.deepEqual(pair.objectiveSecByLineupAndDirection, [
    [31, 28],
    [29, 19],
  ]);
  assert.equal(pair.objectiveDifferenceSec, 10);
  assert.deepEqual(pair.healingAtFrontByLineupAndDirection, [
    [200, 230],
    [180, 120],
  ]);
  assert.equal(pair.healingDifference, 60);
  assert.deepEqual(pair.healingWindowsByLineupAndDirection, [
    [3, 4],
    [2, 2],
  ]);
  assert.equal(pair.healingWindowDifference, 1);
});

test('a zero pair difference cannot hide unilateral kills or contact in either run', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs[0] = passingRun(0, {
    combatTotals: { killsByTeam: [4, 0] },
    engagementSummary: {
      resolvedTeamfightCount: 0,
      medianResolvedTeamfightContactSpanSec: 12,
      medianResolvedTeamfightTimeToFirstCasualtySec: 8,
      fullRoleParticipationCount: 1,
    },
    engagements: [{
      resolved: true,
      bilateralHostileContact: false,
      contactSpanSec: 12,
    }],
  });
  runs[3] = passingRun(3, { combatTotals: { killsByTeam: [0, 4] } });

  const evaluation = evaluateTeamfightAcceptance(runs);
  const pair = evaluation.pairs[0];

  assert.equal(pair.killShareDifference, 0);
  assert.deepEqual(pair.unilateralKillMatchIndices, [0, 3]);
  assert.deepEqual(pair.unilateralContactMatchIndices, [0]);
  assert.deepEqual(pair.missingBilateralContactMatchIndices, [0]);
  assert.equal(evaluation.runs[0].pass, false);
  assert.equal(evaluation.runs[3].pass, false);
  assert.equal(pair.pass, false);
  assert.equal(evaluation.pass, false);
  assert.ok(pair.violations.some(violation => /match 0: median resolved fight contact span/.test(violation)));
  assert.ok(pair.violations.some(violation => /match 0: global combat kills were one-sided/.test(violation)));
  assert.ok(pair.violations.some(violation => /match 3: global combat kills were one-sided/.test(violation)));
});

test('a missing mirror run fails closed and leaves pair differences unknown', () => {
  const runs = Array.from({ length: 5 }, (_, matchIndex) => passingRun(matchIndex));

  const evaluation = evaluateTeamfightAcceptance(runs);

  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.runs.length, 6);
  assert.equal(evaluation.runs[5].matchIndex, 5);
  assert.equal(evaluation.runs[5].pass, false);
  assert.deepEqual(evaluation.runs[5].violations, ['result was missing']);
  assert.equal(evaluation.pairs[2].pass, false);
  assert.equal(evaluation.pairs[2].killShareDifference, null);
  assert.equal(evaluation.pairs[2].firstCasualtyDifferenceSec, null);
  assert.equal(evaluation.pairs[2].contactSpanDifferenceSec, null);
  assert.equal(evaluation.pairs[2].objectiveDifferenceSec, null);
  assert.equal(evaluation.pairs[2].healingDifference, null);
  assert.ok(evaluation.violations.includes('match 5: result was missing'));
});

test('missing and non-finite directional evidence fails closed instead of becoming zero', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs[0] = passingRun(0, {
    pressureAnchorHealingByTeam: [
      { team: 0, atFrontAmount: 200, atFrontWindows: 3 },
    ],
    objective: {
      twoSidedNearObjectiveSec: 15,
      pressureAnchorNearObjectiveSec: [31, Number.NaN],
    },
    combatTotals: { killsByTeam: [6, Number.NaN] },
    regroup: {
      staggeredExitRate: Number.NaN,
      staggeredFightEntryRate: 0.25,
    },
  });

  const evaluation = evaluateTeamfightAcceptance(runs);
  const run = evaluation.runs[0];
  const pair = evaluation.pairs[0];

  assert.equal(evaluation.pass, false);
  assert.equal(run.pass, false);
  assert.ok(run.violations.includes('pressure-anchor recovery evidence must contain teams 0 and 1'));
  assert.ok(run.violations.includes('pressure-anchor objective time by team was invalid'));
  assert.ok(run.violations.includes('global combat kills by team were invalid'));
  assert.ok(run.violations.includes('staggered regroup exit rate was invalid'));
  assert.deepEqual(run.metrics.healingAtFrontByTeam, [200, null]);
  assert.deepEqual(run.metrics.objectiveSecByTeam, [31, null]);
  assert.deepEqual(run.metrics.killsByTeam, [6, null]);
  assert.equal(pair.killShareDifference, null);
  assert.equal(pair.objectiveDifferenceSec, null);
  assert.equal(pair.healingDifference, null);
});

test('duplicate and out-of-cycle results are rejected instead of silently overwritten or ignored', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs.push(passingRun(0), passingRun(6));

  const evaluation = evaluateTeamfightAcceptance(runs);

  assert.equal(evaluation.pass, false);
  assert.deepEqual(evaluation.inputViolations, [
    'duplicate result for match 0',
    'unexpected matchIndex 6',
  ]);
  assert.ok(evaluation.violations.includes('duplicate result for match 0'));
  assert.ok(evaluation.violations.includes('unexpected matchIndex 6'));
});

test('an undefined kill share makes the pair fail closed without inventing a numeric value', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs[0] = passingRun(0, { combatTotals: { killsByTeam: [0, 0] } });
  runs[3] = passingRun(3, { combatTotals: { killsByTeam: [0, 0] } });

  const evaluation = evaluateTeamfightAcceptance(runs);
  const pair = evaluation.pairs[0];

  assert.deepEqual(evaluation.runs[0].violations, []);
  assert.deepEqual(evaluation.runs[3].violations, []);
  assert.equal(pair.killShareDifference, null);
  assert.equal(pair.pass, false);
  assert.ok(pair.violations.includes('kill share difference was undefined'));
  assert.ok(evaluation.violations.includes('matchup 0: kill share difference was undefined'));
  assert.equal(evaluation.pass, false);
});

test('a present run with missing metric sections returns violations instead of throwing', () => {
  const runs = Array.from({ length: 6 }, (_, matchIndex) => passingRun(matchIndex));
  runs[0] = { matchIndex: 0, seed: acceptanceSeedForMatch(0) };

  const evaluation = evaluateTeamfightAcceptance(runs);

  assert.equal(evaluation.pass, false);
  assert.equal(evaluation.runs[0].pass, false);
  assert.ok(evaluation.runs[0].violations.length >= 8);
  assert.deepEqual(evaluation.runs[0].metrics.killsByTeam, [null, null]);
  assert.deepEqual(evaluation.runs[0].metrics.objectiveSecByTeam, [null, null]);
  assert.deepEqual(evaluation.runs[0].metrics.healingAtFrontByTeam, [null, null]);
  assert.equal(evaluation.pairs[0].killShareDifference, null);
});
