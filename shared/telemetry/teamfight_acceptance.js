export const TEAMFIGHT_ACCEPTANCE_SEEDS = Object.freeze([
  20260713,
  20268632,
  20276551,
]);

const MIN_RECOVERY_AMOUNT = 100;
const MIN_RECOVERY_WINDOWS = 2;
const MIN_TEAMFIGHT_CONTACT_SEC = 7;
const MAX_TEAMFIGHT_CONTACT_SEC = 30;
const MIN_DPS_OFFENSIVE_EVENTS = 10;

export function acceptanceSeedForMatch(matchIndex) {
  if (!Number.isInteger(matchIndex) || matchIndex < 0) {
    throw new RangeError(`acceptance matchIndex must be a non-negative integer: ${matchIndex}`);
  }
  return TEAMFIGHT_ACCEPTANCE_SEEDS[matchIndex % TEAMFIGHT_ACCEPTANCE_SEEDS.length];
}

export function runAcceptanceViolations(result) {
  const violations = [];

  const healingRecords = Array.isArray(result?.pressureAnchorHealingByTeam)
    ? result.pressureAnchorHealingByTeam
    : [];
  const healingByTeam = new Map(healingRecords.map(record => [record?.team, record]));
  if (healingByTeam.size !== 2 || !healingByTeam.has(0) || !healingByTeam.has(1)) {
    violations.push('pressure-anchor recovery evidence must contain teams 0 and 1');
  }
  for (const team of [0, 1]) {
    const healing = healingByTeam.get(team);
    if (!healing) continue;
    if (!Number.isFinite(healing.atFrontAmount) || !Number.isFinite(healing.atFrontWindows)) {
      violations.push(`team ${team} pressure-anchor recovery evidence was invalid`);
    } else if (healing.atFrontAmount < MIN_RECOVERY_AMOUNT || (
      healing.atFrontWindows < MIN_RECOVERY_WINDOWS
      && (!Number.isFinite(healing.longestAtFrontWindowSec)
        || healing.longestAtFrontWindowSec < MIN_TEAMFIGHT_CONTACT_SEC)
    )) {
      violations.push(
        `team ${healing.team} pressure-anchor recovery at the front was ${healing.atFrontAmount} healing across ${healing.atFrontWindows} windows (longest ${healing.longestAtFrontWindowSec}s)`,
      );
    }
  }
  const twoSidedObjectiveSec = result?.objective?.twoSidedNearObjectiveSec;
  if (!Number.isFinite(twoSidedObjectiveSec)) {
    violations.push('two-sided pressure-anchor contest time was invalid');
  } else if (twoSidedObjectiveSec < 10) {
    violations.push(
      `two-sided pressure-anchor contest lasted only ${twoSidedObjectiveSec}s`,
    );
  }
  const objectiveByTeam = result?.objective?.pressureAnchorNearObjectiveSec;
  if (!Array.isArray(objectiveByTeam) || objectiveByTeam.length !== 2
    || !objectiveByTeam.every(Number.isFinite)) {
    violations.push('pressure-anchor objective time by team was invalid');
  }

  const engagementSummary = result?.engagementSummary || {};
  const resolvedTeamfightCount = engagementSummary.resolvedTeamfightCount;
  const medianFight = engagementSummary.medianResolvedTeamfightContactSpanSec;
  if (!Number.isInteger(resolvedTeamfightCount) || resolvedTeamfightCount < 1
    || !Number.isFinite(medianFight)
    || medianFight < MIN_TEAMFIGHT_CONTACT_SEC
    || medianFight > MAX_TEAMFIGHT_CONTACT_SEC) {
    violations.push(`median resolved fight contact span was ${medianFight}s`);
  }
  const medianFirstCasualty = engagementSummary
    .medianResolvedTeamfightTimeToFirstCasualtySec;
  if (!Number.isFinite(medianFirstCasualty)
    || medianFirstCasualty < 3 || medianFirstCasualty > 20) {
    violations.push(`median time to first casualty was ${medianFirstCasualty}s`);
  }
  if (!Number.isInteger(engagementSummary.fullRoleParticipationCount)
    || engagementSummary.fullRoleParticipationCount < 1) {
    violations.push('no resolved fight included frontline, damage, and support activity from both teams');
  }

  const dpsOffensiveEvents = [0, 0];
  let dpsEvidenceValid = !!result?.dps && typeof result.dps === 'object';
  for (const player of Object.values(result?.dps || {})) {
    const engaged = player?.offensiveEvents?.duringAnchorEngaged || {};
    if ((player.team !== 0 && player.team !== 1)
      || !Number.isFinite(engaged.total)) {
      dpsEvidenceValid = false;
      continue;
    }
    dpsOffensiveEvents[player.team] += engaged.total;
  }
  const dpsHigh = Math.max(...dpsOffensiveEvents);
  const dpsLow = Math.min(...dpsOffensiveEvents);
  if (!dpsEvidenceValid) {
    violations.push('DPS offensive activity during pressure-anchor engagement was invalid');
  } else if (dpsHigh < MIN_DPS_OFFENSIVE_EVENTS || dpsLow / dpsHigh < 1 / 3) {
    violations.push(
      `DPS offensive activity during pressure-anchor engagement was one-sided at ${dpsOffensiveEvents[0]}:${dpsOffensiveEvents[1]} events`,
    );
  }

  const kills = result?.combatTotals?.killsByTeam;
  if (!Array.isArray(kills) || kills.length !== 2
    || !kills.every(value => Number.isFinite(value) && value >= 0)) {
    violations.push('global combat kills by team were invalid');
  } else {
    const killHigh = Math.max(...kills);
    const killLow = Math.min(...kills);
    if (killHigh >= 4 && killLow / killHigh < 0.4) {
      violations.push(`global combat kills were one-sided at ${kills[0]}:${kills[1]}`);
    }
  }

  const staggeredExitRate = result?.regroup?.staggeredExitRate;
  if (!Number.isFinite(staggeredExitRate)) {
    violations.push('staggered regroup exit rate was invalid');
  } else if (staggeredExitRate > 0.25) {
    violations.push(`staggered regroup exit rate was ${staggeredExitRate}`);
  }
  const staggeredFightEntryRate = result?.regroup?.staggeredFightEntryRate;
  if (!Number.isFinite(staggeredFightEntryRate)) {
    violations.push('staggered fight entry rate was invalid');
  } else if (staggeredFightEntryRate > 0.25) {
    violations.push(`staggered fight entry rate was ${staggeredFightEntryRate}`);
  }

  return violations;
}

function round(value, digits = 6) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function killShares(kills) {
  if (!Array.isArray(kills) || kills.length !== 2
    || !kills.every(value => Number.isFinite(value) && value >= 0)) {
    return [null, null];
  }
  const total = kills[0] + kills[1];
  if (!(total > 0)) return [null, null];
  return kills.map(killsForTeam => round(killsForTeam / total));
}

function valuesByTeam(records, key) {
  const byTeam = new Map((Array.isArray(records) ? records : [])
    .map(record => [record?.team, record]));
  return [0, 1].map(team => {
    const value = byTeam.get(team)?.[key];
    return Number.isFinite(value) ? value : null;
  });
}

function finitePair(values) {
  return [0, 1].map(team => Number.isFinite(values?.[team]) ? values[team] : null);
}

function alignMirroredTeamValues(baseValues, mirrorValues) {
  return [
    [baseValues[0], mirrorValues[1]],
    [baseValues[1], mirrorValues[0]],
  ];
}

function absoluteDifference(left, right) {
  return Number.isFinite(left) && Number.isFinite(right)
    ? round(Math.abs(left - right))
    : null;
}

function maxAlignedDifference(values) {
  const differences = values.map(([left, right]) => absoluteDifference(left, right));
  return differences.every(Number.isFinite) ? Math.max(...differences) : null;
}

function assessRun(result) {
  const expectedSeed = acceptanceSeedForMatch(result.matchIndex);
  const violations = runAcceptanceViolations(result);
  if (result.seed !== expectedSeed) {
    violations.unshift(`seed was ${result.seed}; expected ${expectedSeed}`);
  }
  const killsByTeam = finitePair(result.combatTotals?.killsByTeam);
  const engagementSummary = result.engagementSummary || {};
  const resolvedTeamfightCount = Number.isInteger(engagementSummary.resolvedTeamfightCount)
    ? engagementSummary.resolvedTeamfightCount
    : null;
  const unilateralContactCount = (result.engagements || []).filter(engagement => (
    engagement?.resolved
    && engagement.contactSpanSec > 0
    && engagement.bilateralHostileContact === false
  )).length;
  return {
    matchIndex: result.matchIndex,
    matchupIndex: result.matchIndex % TEAMFIGHT_ACCEPTANCE_SEEDS.length,
    mirror: result.matchIndex >= TEAMFIGHT_ACCEPTANCE_SEEDS.length,
    seed: result.seed,
    expectedSeed,
    pass: violations.length === 0,
    violations,
    metrics: {
      killsByTeam,
      killSharesByTeam: killShares(killsByTeam),
      hasKillsByBothTeams: killsByTeam.every(kills => Number.isFinite(kills) && kills > 0),
      medianFirstCasualtySec: Number.isFinite(
        engagementSummary.medianResolvedTeamfightTimeToFirstCasualtySec,
      ) ? engagementSummary.medianResolvedTeamfightTimeToFirstCasualtySec : null,
      medianContactSpanSec: Number.isFinite(
        engagementSummary.medianResolvedTeamfightContactSpanSec,
      ) ? engagementSummary.medianResolvedTeamfightContactSpanSec : null,
      resolvedTeamfightCount,
      hasResolvedBilateralContact: resolvedTeamfightCount > 0,
      unilateralContactCount,
      twoSidedObjectiveSec: Number.isFinite(result.objective?.twoSidedNearObjectiveSec)
        ? result.objective.twoSidedNearObjectiveSec
        : null,
      objectiveSecByTeam: finitePair(result.objective?.pressureAnchorNearObjectiveSec),
      healingAtFrontByTeam: valuesByTeam(result.pressureAnchorHealingByTeam, 'atFrontAmount'),
      healingWindowsByTeam: valuesByTeam(result.pressureAnchorHealingByTeam, 'atFrontWindows'),
    },
  };
}

function missingRun(matchIndex) {
  return {
    matchIndex,
    matchupIndex: matchIndex % TEAMFIGHT_ACCEPTANCE_SEEDS.length,
    mirror: matchIndex >= TEAMFIGHT_ACCEPTANCE_SEEDS.length,
    seed: null,
    expectedSeed: acceptanceSeedForMatch(matchIndex),
    missing: true,
    pass: false,
    violations: ['result was missing'],
    metrics: {
      killsByTeam: [null, null],
      killSharesByTeam: [null, null],
      hasKillsByBothTeams: false,
      medianFirstCasualtySec: null,
      medianContactSpanSec: null,
      resolvedTeamfightCount: null,
      hasResolvedBilateralContact: false,
      unilateralContactCount: null,
      twoSidedObjectiveSec: null,
      objectiveSecByTeam: [null, null],
      healingAtFrontByTeam: [null, null],
      healingWindowsByTeam: [null, null],
    },
  };
}

function aggregatePair(base, mirror) {
  const killSharesByLineupAndDirection = alignMirroredTeamValues(
    base.metrics.killSharesByTeam,
    mirror.metrics.killSharesByTeam,
  );
  const objectiveSecByLineupAndDirection = alignMirroredTeamValues(
    base.metrics.objectiveSecByTeam,
    mirror.metrics.objectiveSecByTeam,
  );
  const healingAtFrontByLineupAndDirection = alignMirroredTeamValues(
    base.metrics.healingAtFrontByTeam,
    mirror.metrics.healingAtFrontByTeam,
  );
  const healingWindowsByLineupAndDirection = alignMirroredTeamValues(
    base.metrics.healingWindowsByTeam,
    mirror.metrics.healingWindowsByTeam,
  );
  const firstCasualtySecByDirection = [
    base.metrics.medianFirstCasualtySec,
    mirror.metrics.medianFirstCasualtySec,
  ];
  const contactSpanSecByDirection = [
    base.metrics.medianContactSpanSec,
    mirror.metrics.medianContactSpanSec,
  ];
  const twoSidedObjectiveSecByDirection = [
    base.metrics.twoSidedObjectiveSec,
    mirror.metrics.twoSidedObjectiveSec,
  ];
  const directions = [base, mirror];
  const killShareDifference = maxAlignedDifference(killSharesByLineupAndDirection);
  const firstCasualtyDifferenceSec = absoluteDifference(...firstCasualtySecByDirection);
  const contactSpanDifferenceSec = absoluteDifference(...contactSpanSecByDirection);
  const twoSidedObjectiveDifferenceSec = absoluteDifference(...twoSidedObjectiveSecByDirection);
  const objectiveDifferenceSec = maxAlignedDifference(objectiveSecByLineupAndDirection);
  const healingDifference = maxAlignedDifference(healingAtFrontByLineupAndDirection);
  const healingWindowDifference = maxAlignedDifference(healingWindowsByLineupAndDirection);
  const comparisonViolations = [
    ['kill share difference', killShareDifference],
    ['first casualty difference', firstCasualtyDifferenceSec],
    ['contact span difference', contactSpanDifferenceSec],
    ['two-sided objective difference', twoSidedObjectiveDifferenceSec],
    ['objective difference', objectiveDifferenceSec],
    ['healing difference', healingDifference],
    ['healing-window difference', healingWindowDifference],
  ].filter(([, value]) => !Number.isFinite(value))
    .map(([label]) => `${label} was undefined`);
  const runViolations = directions.flatMap(run => (
    run.violations.map(violation => `match ${run.matchIndex}: ${violation}`)
  ));

  return {
    matchupIndex: base.matchupIndex,
    seed: base.expectedSeed,
    matchIndices: directions.map(run => run.matchIndex),
    pass: directions.every(run => run.pass) && comparisonViolations.length === 0,
    violations: [...runViolations, ...comparisonViolations],
    comparisonViolations,
    directions,
    killSharesByLineupAndDirection,
    killShareDifference,
    unilateralKillMatchIndices: directions
      .filter(run => !run.missing && !run.metrics.hasKillsByBothTeams)
      .map(run => run.matchIndex),
    firstCasualtySecByDirection,
    firstCasualtyDifferenceSec,
    contactSpanSecByDirection,
    contactSpanDifferenceSec,
    unilateralContactMatchIndices: directions
      .filter(run => run.metrics.unilateralContactCount > 0)
      .map(run => run.matchIndex),
    missingBilateralContactMatchIndices: directions
      .filter(run => !run.missing && !run.metrics.hasResolvedBilateralContact)
      .map(run => run.matchIndex),
    twoSidedObjectiveSecByDirection,
    twoSidedObjectiveDifferenceSec,
    objectiveSecByLineupAndDirection,
    objectiveDifferenceSec,
    healingAtFrontByLineupAndDirection,
    healingDifference,
    healingWindowsByLineupAndDirection,
    healingWindowDifference,
  };
}

export function evaluateTeamfightAcceptance(results) {
  const inputViolations = [];
  const suppliedByMatch = new Map();
  if (!Array.isArray(results)) {
    inputViolations.push('results must be an array');
  } else {
    for (const result of results) {
      const matchIndex = result?.matchIndex;
      if (!Number.isInteger(matchIndex) || matchIndex < 0 || matchIndex >= 6) {
        inputViolations.push(`unexpected matchIndex ${matchIndex}`);
      } else if (suppliedByMatch.has(matchIndex)) {
        inputViolations.push(`duplicate result for match ${matchIndex}`);
      } else {
        suppliedByMatch.set(matchIndex, result);
      }
    }
  }
  const runs = Array.from({ length: 6 }, (_, matchIndex) => {
    const result = suppliedByMatch.get(matchIndex);
    return result ? assessRun(result) : missingRun(matchIndex);
  });
  const pairs = TEAMFIGHT_ACCEPTANCE_SEEDS.map((seed, matchupIndex) => (
    aggregatePair(runs[matchupIndex], runs[matchupIndex + TEAMFIGHT_ACCEPTANCE_SEEDS.length])
  ));
  const violations = [
    ...inputViolations,
    ...runs.flatMap(run => (
      run.violations.map(violation => `match ${run.matchIndex}: ${violation}`)
    )),
    ...pairs.flatMap(pair => (
      pair.comparisonViolations.map(violation => `matchup ${pair.matchupIndex}: ${violation}`)
    )),
  ];
  return {
    pass: violations.length === 0,
    violations,
    inputViolations,
    runs,
    pairs,
  };
}
