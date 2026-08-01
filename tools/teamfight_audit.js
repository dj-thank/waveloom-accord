#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import {
  BOT_RNG_SCHEME,
  makeBotRng,
  scheduleBotThinkOrder,
} from '../server/bot_fairness.js';
import {
  assertCompetitiveBotTeams,
  competitiveBotRotation,
  MIN_COMPETITIVE_ROSTER_MATCHES,
} from '../shared/rules/bot_roster.js';
import {
  captureTeamfightSnapshot,
  TeamfightMetrics,
} from '../shared/telemetry/teamfight_metrics.js';
import {
  acceptanceSeedForMatch,
  evaluateTeamfightAcceptance,
} from '../shared/telemetry/teamfight_acceptance.js';

const root = new URL('..', import.meta.url);
const TEAMFIGHT_AUDIT_SCHEMA_ID = 'kagariai.teamfight-audit';
// v3 binds the mirrored rotation and per-controller logical RNG identities.
const TEAMFIGHT_AUDIT_SCHEMA_VERSION = 3;
const CORE_SOURCE_PATHS = Object.freeze([
  'package.json',
  'server/bot_fairness.js',
  'server/bot_navigation.js',
  'server/bots.js',
  'shared/data/combat.json',
  'shared/data/heroes.js',
  'shared/data/map_oshioi.js',
  'shared/data/map_oshioi_authored_collision.js',
  'shared/data/mode_shioura.json',
  'shared/rules/bot_roster.js',
  'shared/rules/team_capabilities.js',
  'shared/sim/abilities.js',
  'shared/sim/collision.js',
  'shared/sim/combat.js',
  'shared/sim/match.js',
  'shared/sim/movement.js',
  'shared/sim/objective.js',
  'shared/sim/projectiles.js',
  'shared/sim/respawn.js',
  'shared/sim/rng.js',
  'shared/sim/sim.js',
  'shared/sim/spawn.js',
  'shared/telemetry/teamfight_acceptance.js',
  'shared/telemetry/teamfight_metrics.js',
  'tools/teamfight_audit.js',
]);

function cloneTeamCompositions(teamCompositions) {
  return teamCompositions.map(team => team.map(slot => ({ ...slot })));
}

function rotationEvidence(rotation) {
  return {
    rotationIndex: rotation.rotationIndex,
    canonicalLineupIndex: rotation.canonicalLineupIndex,
    mirrored: rotation.mirrored,
    mirrorMatchIndex: rotation.mirrorMatchIndex,
    acceptanceSeed: rotation.acceptanceSeed,
    logicalLineupSlots: rotation.rngSlots.map(team => (
      team.map(slot => slot.logicalLineupSlot)
    )),
  };
}

function captureCoreSources() {
  const bytesByPath = new Map();
  const sourceManifest = CORE_SOURCE_PATHS.map(relativePath => {
    const bytes = fs.readFileSync(new URL(relativePath, root));
    bytesByPath.set(relativePath, bytes);
    return {
      path: relativePath,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    };
  });
  const capturedJson = relativePath => JSON.parse(bytesByPath.get(relativePath).toString('utf8'));
  return {
    sourceManifest,
    packageVersion: capturedJson('package.json').version,
    mode: capturedJson('shared/data/mode_shioura.json'),
    combat: capturedJson('shared/data/combat.json'),
  };
}

export function runTeamfightAudit({
  seed,
  matchIndex = 0,
  durationSec = 180,
  teamCompositions: requestedTeamCompositions,
} = {}) {
  // Capture before simulation so a long audit cannot claim post-run revisions.
  const { sourceManifest, packageVersion, mode, combat } = captureCoreSources();
  const rotation = competitiveBotRotation(matchIndex);
  const resolvedSeed = seed === undefined ? rotation.acceptanceSeed : seed;
  const world = new World(buildMap(), mode, combat, resolvedSeed);
  const rosterSource = requestedTeamCompositions === undefined
    ? 'canonical'
    : 'counterfactual';
  const teamCompositions = cloneTeamCompositions(
    requestedTeamCompositions ?? rotation.teams,
  );
  assertCompetitiveBotTeams(teamCompositions);
  const botRecords = [];
  let botIndex = 0;

  for (let team = 0; team < teamCompositions.length; team++) {
    for (let slotIndex = 0; slotIndex < teamCompositions[team].length; slotIndex++) {
      const slot = teamCompositions[team][slotIndex];
      const player = world.addPlayer(`teamfight-bot-${botIndex++}`, true, team, slot.heroId);
      const rngSlot = rotation.rngSlots[team][slotIndex];
      player.logicalActionSlot = rngSlot.logicalLineupSlot;
      botRecords.push({ player, rngSlot });
    }
  }
  const botPlayers = botRecords.map(record => record.player);
  const botRngControllers = [];
  const controllers = botRecords.map(({ player, rngSlot }) => {
    const rng = makeBotRng(world.seed, player, botPlayers, {
      logicalLineupSlot: rngSlot.logicalLineupSlot,
    });
    botRngControllers.push({
      playerId: player.id,
      physicalTeam: player.team,
      ...rng.metadata,
    });
    return new BotController(world, player, rng);
  });
  const rotationMetadata = rotationEvidence(rotation);
  const botRng = {
    scheme: BOT_RNG_SCHEME,
    matchSeed: Number(world.seed) >>> 0,
    controllers: botRngControllers,
  };

  const metrics = new TeamfightMetrics();
  const maxTicks = Math.ceil(Math.max(1, durationSec) / world.dt);
  let ticks = 0;
  while (ticks < maxTicks && world.flow.state !== 'MATCH_END') {
    for (const controller of scheduleBotThinkOrder(controllers, world.tickCount)) controller.think(world.dt);
    const preTickSnapshot = captureTeamfightSnapshot(world);
    world.tick();
    metrics.observe({
      world,
      preTickSnapshot,
      controllers,
      events: world.drainEvents(),
      dt: world.dt,
    });
    ticks++;
  }

  const summary = metrics.summary({
    seed: resolvedSeed,
    matchIndex,
    requestedDurationSec: durationSec,
    simulatedDurationSec: world.t,
    ticks,
    teamCompositions: cloneTeamCompositions(teamCompositions),
    score: [...world.flow.score],
    finalFlow: world.flow.snapshot(),
    rotation: rotationMetadata,
    botRng,
  });
  return {
    ...summary,
    provenance: {
      schemaId: TEAMFIGHT_AUDIT_SCHEMA_ID,
      schemaVersion: TEAMFIGHT_AUDIT_SCHEMA_VERSION,
      packageVersion,
      seed: summary.seed,
      matchIndex: summary.matchIndex,
      requestedDurationSec: summary.requestedDurationSec,
      simulatedDurationSec: summary.simulatedDurationSec,
      ticks: summary.ticks,
      rosterSource,
      teamCompositions: cloneTeamCompositions(summary.teamCompositions),
      rotation: rotationMetadata,
      botRng,
      sourceManifest,
    },
  };
}

/**
 * Run the canonical six-run mirror gate and return one immutable evidence
 * capture. Keeping this beside the single-run audit ensures the evaluator,
 * raw summaries, and source manifest are captured from one code path.
 */
export function runTeamfightAcceptance({ durationSec = 180 } = {}) {
  const results = Array.from({ length: MIN_COMPETITIVE_ROSTER_MATCHES }, (_, matchIndex) => (
    runTeamfightAudit({
      seed: acceptanceSeedForMatch(matchIndex),
      matchIndex,
      durationSec,
    })
  ));
  const evaluation = evaluateTeamfightAcceptance(results);
  const sourceManifest = results[0]?.provenance?.sourceManifest ?? [];
  const evaluator = sourceManifest.find(entry => entry.path === 'shared/telemetry/teamfight_acceptance.js');
  return {
    schemaId: 'kagariai.teamfight-acceptance',
    schemaVersion: 1,
    durationSec,
    matchCount: results.length,
    evaluation,
    results,
    sourceManifest,
    evaluatorSha256: evaluator?.sha256 ?? null,
  };
}

function numericFlag(args, name, fallback) {
  const index = args.indexOf(`--${name}`);
  if (index < 0) return fallback;
  const value = Number(args[index + 1]);
  return Number.isFinite(value) ? value : fallback;
}

const isMain = process.argv[1]
  && pathToFileURL(process.argv[1]).href === import.meta.url;

if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes('--acceptance')) {
    const durationSec = Math.max(1, numericFlag(args, 'seconds', 180));
    const evidence = runTeamfightAcceptance({ durationSec });
    const outIndex = args.indexOf('--out');
    const requestedOut = outIndex >= 0 ? args[outIndex + 1] : undefined;
    const outPath = path.resolve(requestedOut || 'outputs/rc5-teamfight-evidence/teamfight-acceptance-2026-07-23.json');
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
    console.log(JSON.stringify({
      pass: evidence.evaluation.violations.length === 0,
      matchCount: evidence.matchCount,
      evaluatorSha256: evidence.evaluatorSha256,
      outPath,
    }));
    if (evidence.evaluation.violations.length > 0) process.exitCode = 1;
    process.exit(0);
  }
  const requestedSeed = numericFlag(args, 'seed', undefined);
  const result = runTeamfightAudit({
    seed: requestedSeed === undefined ? undefined : Math.floor(requestedSeed),
    matchIndex: Math.max(0, Math.floor(numericFlag(args, 'match', 0))),
    durationSec: Math.max(1, numericFlag(args, 'seconds', 180)),
  });
  if (args.includes('--json')) {
    console.log(JSON.stringify(result));
  } else {
    console.log(JSON.stringify({
      seed: result.seed,
      matchIndex: result.matchIndex,
      durationSec: result.durationSec,
      score: result.rounds.score,
      provenance: result.provenance,
      combatTotals: result.combatTotals,
      pressureAnchorHealingByTeam: result.pressureAnchorHealingByTeam,
      twoSidedNearObjectiveSec: result.objective.twoSidedNearObjectiveSec,
      engagementSummary: result.engagementSummary,
      regroup: {
        exits: result.regroup.exits.length,
        staggeredExitRate: result.regroup.staggeredExitRate,
        staggeredFightEntryRate: result.regroup.staggeredFightEntryRate,
      },
    }, null, 2));
  }
}
