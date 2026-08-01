// ヘッドレス検証: ボット10体でBO3フル試合を最速実行し、
// 「開始→争奪→（延長）→勝敗確定→試合終了」の完走と不変条件を検証する。
// 使い方: node tools/headless.js [--seed 12345] [--quiet] [--matches 1]

import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import {
  BOT_RNG_SCHEME,
  makeBotRng,
  scheduleBotThinkOrder,
} from '../server/bot_fairness.js';
import { HEROES } from '../shared/data/heroes.js';
import { summarizeUltimateUses } from '../shared/sim/ult_economy.js';
import {
  MIN_COMPETITIVE_ROSTER_MATCHES,
  competitiveBotRotation,
  pairedBotSeedForMatch,
} from '../shared/rules/bot_roster.js';
import { summarizeSideBalance } from '../shared/telemetry/side_balance.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const authoredMode = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/mode_shioura.json'), 'utf8'));
const combat = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/combat.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  if (i < 0) return d;
  const value = Number(args[i + 1]);
  return Number.isFinite(value) ? value : d;
};
const optionalFlag = n => {
  const i = args.indexOf('--' + n);
  if (i < 0) return null;
  const value = Number(args[i + 1]);
  return Number.isFinite(value) ? value : null;
};
const optionalNonNegativeSafeIntegerFlag = n => {
  const i = args.indexOf('--' + n);
  if (i < 0) return null;
  const value = Number(args[i + 1]);
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`--${n} must be a non-negative safe integer`);
  }
  return value;
};
const QUIET = args.includes('--quiet');
const JSON_OUTPUT = args.includes('--json');
const SOAK = args.includes('--soak');
const SMOKE = args.includes('--smoke');
const PROGRESS = args.includes('--progress');
const PROFILE = args.includes('--profile');
const SEED = Math.floor(flag('seed', 20260713));
const requestedRoundCapSec = optionalFlag('round-cap-sec');
const requestedRoundsToWin = optionalFlag('rounds-to-win');
const requestedMaxRounds = optionalFlag('max-rounds');
const requestedSetupSec = optionalFlag('setup-sec');
const requestedResultSec = optionalFlag('result-sec');
const requestedMatchIndex = optionalNonNegativeSafeIntegerFlag('match-index');
const requestedMaxWallSec = optionalFlag('max-wall-sec');
const smokeMode = SMOKE ? {
  roundsToWin: 1,
  maxRounds: 1,
  setupSec: 0,
  resultSec: 0,
  roundCapSec: 10,
} : {};
const mode = {
  ...authoredMode,
  ...smokeMode,
  ...(requestedRoundCapSec === null ? {} : { roundCapSec: Math.max(1, requestedRoundCapSec) }),
  ...(requestedRoundsToWin === null ? {} : { roundsToWin: Math.max(1, Math.floor(requestedRoundsToWin)) }),
  ...(requestedMaxRounds === null ? {} : { maxRounds: Math.max(1, Math.floor(requestedMaxRounds)) }),
  ...(requestedSetupSec === null ? {} : { setupSec: Math.max(0, requestedSetupSec) }),
  ...(requestedResultSec === null ? {} : { resultSec: Math.max(0, requestedResultSec) }),
};
const MAX_SIM_SEC = Math.max(1, flag('max-sim-sec', 60 * 45));
const PROGRESS_EVERY_SEC = Math.max(1, flag('progress-every-sec', 30));
const MAX_WALL_MS = requestedMaxWallSec === null ? null : Math.max(0.001, requestedMaxWallSec) * 1000;
const PROFILE_ENABLED = PROFILE || MAX_WALL_MS !== null;
const ROSTER_SLOTS = mode.teamSize * 2;
const MIN_ROSTER_MATCHES = MIN_COMPETITIVE_ROSTER_MATCHES;
const MATCHES = Math.max(1, Math.floor(flag('matches', SOAK ? 1000 : MIN_ROSTER_MATCHES)));
const START_MATCH_INDEX = requestedMatchIndex === null ? 0 : requestedMatchIndex;

const INTERESTING = new Set(['round_active', 'obj_captured', 'obj_retake', 'obj_overtime_start', 'obj_round_win', 'round_end', 'sudden_death', 'obj_simultaneous_setback', 'match_end', 'round_setup']);

let failures = 0;
const suiteStats = {
  roster: new Set(),
  seeds: [],
  actions: {
    primary: 0,
    abilities: 0,
    ultimates: 0,
    slots: { secondary: 0, ability1: 0, ability2: 0, ultimate: 0 },
    byHero: {},
  },
  healing: { events: 0, amount: 0 },
  matchUltimates: [],
  teamCompositions: [],
  completedMatches: [],
};

function assert(cond, msg) {
  if (!cond) {
    failures++;
    console.error('  [FAIL] ' + msg);
  }
}

function heroActionStats(heroId) {
  if (!suiteStats.actions.byHero[heroId]) {
    suiteStats.actions.byHero[heroId] = {
      primary: 0, secondary: 0, ability1: 0, ability2: 0, ultimate: 0, healing: 0,
    };
  }
  return suiteStats.actions.byHero[heroId];
}

function roundedMs(value) {
  return Math.round(value * 1000) / 1000;
}

function snapshotPerformance(metrics) {
  if (!metrics) return null;
  return {
    enabled: true,
    wallBudgetSec: metrics.wallBudgetSec,
    wallElapsedMs: roundedMs(performance.now() - metrics.startedAt),
    botThinkMs: roundedMs(metrics.botThinkMs),
    worldTickMs: roundedMs(metrics.worldTickMs),
    maxBotThinkMs: roundedMs(metrics.maxBotThinkMs),
    maxWorldTickMs: roundedMs(metrics.maxWorldTickMs),
    maxLoopMs: roundedMs(metrics.maxLoopMs),
    slowestLoop: metrics.slowestLoop && { ...metrics.slowestLoop },
    slowestBotThink: metrics.slowestBotThink && { ...metrics.slowestBotThink },
    wallBudgetExceeded: metrics.wallBudgetExceeded,
  };
}

function recordEvent(event, world) {
  if (event.type === 'shot') {
    suiteStats.actions.primary++;
    const source = event.source && world.players.get(event.source);
    if (source?.heroId) heroActionStats(source.heroId).primary++;
  } else if (event.type === 'ability_used') {
    suiteStats.actions.abilities++;
    if (suiteStats.actions.slots[event.slot] !== undefined) suiteStats.actions.slots[event.slot]++;
    if (event.heroId) heroActionStats(event.heroId)[event.slot]++;
  } else if (event.type === 'ultimate_used') {
    suiteStats.actions.ultimates++;
    suiteStats.actions.slots.ultimate++;
    if (event.heroId) heroActionStats(event.heroId).ultimate++;
    world.players.get(event.player)?.stats && (world.players.get(event.player).stats.ultimates = (world.players.get(event.player).stats.ultimates || 0) + 1);
  } else if (event.type === 'heal') {
    suiteStats.healing.events++;
    suiteStats.healing.amount += event.amount || 0;
    const source = event.source && world.players.get(event.source);
    if (source?.heroId) heroActionStats(source.heroId).healing += event.amount || 0;
  }
}

function rosterForMatch(matchIndex) {
  return competitiveBotRotation(matchIndex).teams;
}

function runMatch(seed, matchIndex) {
  const world = new World(buildMap(), mode, combat, seed);
  const rotation = competitiveBotRotation(matchIndex);
  const teams = rotation.teams;
  const botRecords = [];
  suiteStats.teamCompositions.push(teams.map(team => team.map(slot => ({ ...slot }))));
  let botIndex = 0;
  for (let team = 0; team < teams.length; team++) {
    for (let slotIndex = 0; slotIndex < teams[team].length; slotIndex++) {
      const slot = teams[team][slotIndex];
      const pl = world.addPlayer('bot' + botIndex++, true, team, slot.heroId);
      suiteStats.roster.add(slot.heroId);
      heroActionStats(slot.heroId);
      const rngSlot = rotation.rngSlots[team][slotIndex];
      pl.logicalActionSlot = rngSlot.logicalLineupSlot;
      botRecords.push({ player: pl, rngSlot });
    }
  }
  const botPlayers = botRecords.map(record => record.player);
  const botRngControllers = [];
  const bots = botRecords.map(({ player, rngSlot }) => {
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
  assert(bots.length === ROSTER_SLOTS, `bot roster size mismatch: ${bots.length}/${ROSTER_SLOTS}`);

  const maxTicks = Math.ceil(MAX_SIM_SEC / world.dt);
  const seq = [];
  const completedRounds = [];
  const objectiveCenter = world.map.objective.center;
  const liveness = {
    noEffectiveObjectiveEntrySec: 0,
    maxNoEffectiveObjectiveEntrySec: 0,
    regroupDurationSec: 0,
    recoveryRetries: 0,
    activeOnPointTicks: [0, 0],
    timeSinceLastEliminationSec: 0,
    _deaths: 0,
  };
  const performanceMetrics = PROFILE_ENABLED ? {
    startedAt: performance.now(),
    wallBudgetSec: MAX_WALL_MS === null ? null : MAX_WALL_MS / 1000,
    botThinkMs: 0,
    worldTickMs: 0,
    maxBotThinkMs: 0,
    maxWorldTickMs: 0,
    maxLoopMs: 0,
    slowestLoop: null,
    slowestBotThink: null,
    wallBudgetExceeded: false,
  } : null;
  let lastEliminationAt = 0;
  const retrySeen = new Map();
  let ticks = 0;
  let nextProgressAt = 0;
  while (world.flow.state !== 'MATCH_END' && ticks < maxTicks) {
    const loopStartedAt = performanceMetrics ? performance.now() : 0;
    if (performanceMetrics && MAX_WALL_MS !== null &&
      loopStartedAt - performanceMetrics.startedAt >= MAX_WALL_MS) {
      performanceMetrics.wallBudgetExceeded = true;
      break;
    }
    const scheduledBots = scheduleBotThinkOrder(bots, world.tickCount);
    let botThinkMs = 0;
    if (performanceMetrics) {
      for (const bc of scheduledBots) {
        const botThinkStartedAt = performance.now();
        bc.think(world.dt);
        const elapsedMs = performance.now() - botThinkStartedAt;
        botThinkMs += elapsedMs;
        if (!performanceMetrics.slowestBotThink || elapsedMs > performanceMetrics.slowestBotThink.botThinkMs) {
          performanceMetrics.slowestBotThink = {
            tick: world.tickCount,
            simulatedDurationSec: Math.round(world.t * 1000) / 1000,
            playerId: bc.pl.id,
            heroId: bc.pl.heroId,
            team: bc.pl.team,
            alive: bc.pl.alive,
            mode: bc.mode,
            route: bc.route,
            waypoint: bc.wpIndex,
            botThinkMs: roundedMs(elapsedMs),
          };
        }
      }
    } else {
      for (const bc of scheduledBots) bc.think(world.dt);
    }
    const tickStartedAt = performanceMetrics ? performance.now() : 0;
    world.tick();
    const worldTickMs = performanceMetrics ? performance.now() - tickStartedAt : 0;
    if (performanceMetrics) {
      const loopMs = performance.now() - loopStartedAt;
      performanceMetrics.botThinkMs += botThinkMs;
      performanceMetrics.worldTickMs += worldTickMs;
      performanceMetrics.maxBotThinkMs = Math.max(performanceMetrics.maxBotThinkMs, botThinkMs);
      performanceMetrics.maxWorldTickMs = Math.max(performanceMetrics.maxWorldTickMs, worldTickMs);
      performanceMetrics.maxLoopMs = Math.max(performanceMetrics.maxLoopMs, loopMs);
      if (!performanceMetrics.slowestLoop || loopMs > performanceMetrics.slowestLoop.loopMs) {
        performanceMetrics.slowestLoop = {
          tick: world.tickCount,
          simulatedDurationSec: Math.round(world.t * 1000) / 1000,
          botThinkMs: roundedMs(botThinkMs),
          worldTickMs: roundedMs(worldTickMs),
          loopMs: roundedMs(loopMs),
        };
      }
    }
    ticks++;
    let onPoint = [0, 0];
    for (const bot of bots) {
      if (bot.mode === 'regroup') liveness.regroupDurationSec += world.dt;
      const retryAt = Number(bot.regroupPlanRetryAt || 0);
      const previousRetryAt = retrySeen.get(bot.pl.id);
      if (retryAt > world.t && retryAt !== previousRetryAt) {
        liveness.recoveryRetries++;
        retrySeen.set(bot.pl.id, retryAt);
      }
      if (bot.pl.alive && Math.hypot(bot.pl.move.pos[0] - objectiveCenter[0], bot.pl.move.pos[1] - objectiveCenter[1]) <= world.map.objective.radiusM) {
        onPoint[bot.pl.team]++;
      }
    }
    onPoint.forEach((count, team) => { if (count > 0) liveness.activeOnPointTicks[team]++; });
    const totalDeaths = [...world.players.values()].reduce((sum, player) => sum + (player.stats.deaths || 0), 0);
    if (totalDeaths > liveness._deaths) {
      liveness._deaths = totalDeaths;
      lastEliminationAt = world.t;
    }
    if (world.flow.state === 'ACTIVE' && onPoint.every(count => count === 0)) {
      liveness.noEffectiveObjectiveEntrySec += world.dt;
    } else {
      liveness.noEffectiveObjectiveEntrySec = 0;
    }
    liveness.maxNoEffectiveObjectiveEntrySec = Math.max(liveness.maxNoEffectiveObjectiveEntrySec, liveness.noEffectiveObjectiveEntrySec);
    liveness.timeSinceLastEliminationSec = Math.max(0, world.t - lastEliminationAt);
    for (const ev of world.drainEvents()) {
      recordEvent(ev, world);
      if (ev.type === 'round_end') {
        completedRounds.push({
          round: ev.round,
          winner: ev.winner,
          sides: [...world.flow.sides],
        });
      }
      if (INTERESTING.has(ev.type)) {
        seq.push(ev.type);
        if (!QUIET) {
          const o = world.objective.snapshot();
          console.log(`  [${world.t.toFixed(1).padStart(7)}s] R${world.flow.round} ${ev.type}` +
            (ev.winner !== undefined ? ` winner=${ev.winner}` : '') +
            (ev.owner !== undefined ? ` owner=${ev.owner}` : '') +
            ` | gauge=[${o.gauge}] pot=[${(o.pot[0] / 10).toFixed(1)}%,${(o.pot[1] / 10).toFixed(1)}%]`);
        }
      }
    }
    if (PROGRESS && world.t + 1e-9 >= nextProgressAt) {
      const snapshot = world.snapshot();
      console.error(JSON.stringify({
        type: 'headless_progress',
        matchIndex,
        seed,
        ticks,
        maxTicks,
        simulatedDurationSec: Math.round(world.t * 1000) / 1000,
        state: snapshot.match.state,
        score: snapshot.match.score,
        objective: snapshot.objective,
        liveness: {
          maxNoEffectiveObjectiveEntrySec: liveness.maxNoEffectiveObjectiveEntrySec,
          regroupDurationSec: liveness.regroupDurationSec,
          recoveryRetries: liveness.recoveryRetries,
          activeOnPointTicks: liveness.activeOnPointTicks,
          timeSinceLastEliminationSec: liveness.timeSinceLastEliminationSec,
        },
        ...(performanceMetrics ? { performance: snapshotPerformance(performanceMetrics) } : {}),
        bots: bots.map(bot => ({
          id: bot.pl.id,
          alive: bot.pl.alive,
          mode: bot.mode,
          route: bot.route,
          waypoint: bot.wpIndex,
        })),
      }));
      nextProgressAt += PROGRESS_EVERY_SEC;
    }
  }

  const snap = world.snapshot();
  delete liveness._deaths;
  const terminationReason = world.flow.state === 'MATCH_END'
    ? 'match_end'
    : performanceMetrics?.wallBudgetExceeded
      ? 'wall_clock_budget_exhausted'
    : 'simulation_budget_exhausted';
  if (PROGRESS) {
    console.error(JSON.stringify({
      type: 'headless_match_complete',
      matchIndex,
      seed,
      ticks,
      maxTicks,
      simulatedDurationSec: Math.round(world.t * 1000) / 1000,
      finalState: world.flow.state,
      score: [...world.flow.score],
      objective: snap.objective,
      terminationReason,
      ...(performanceMetrics ? { performance: snapshotPerformance(performanceMetrics) } : {}),
    }));
  }
  assert(terminationReason === 'match_end',
    `match did not terminate before ${MAX_SIM_SEC}s: ${JSON.stringify({
      state: world.flow.state,
      score: world.flow.score,
      objective: snap.objective,
      ticks,
      maxTicks,
    })}`);
  const ultimatesByPlayer = Object.fromEntries([...world.players.values()].map(pl => [pl.id, { heroId: pl.heroId, uses: pl.stats.ultimates || 0 }]));
  if (!JSON_OUTPUT) {
    console.log(`  終了: state=${snap.match.state} score=[${snap.match.score}] winner=${snap.match.matchWinner} 実ゲーム時間=${(world.t / 60).toFixed(1)}分 tick=${ticks}`);
  }

  // ---- 不変条件 ----
  assert(world.flow.state === 'MATCH_END', '試合がMATCH_ENDに到達しなかった（' + world.flow.state + '）');
  assert(world.flow.matchWinner === 0 || world.flow.matchWinner === 1, '勝者が確定していない');
  assert(Math.max(...world.flow.score) === mode.roundsToWin, '勝利チームのラウンド取得数がroundsToWinと一致しない');
  assert(world.flow.round <= mode.maxRounds, 'ラウンド数がmaxRoundsを超過');
  assert(seq.filter(s => s === 'round_active').length === world.flow.round, 'round_active回数がラウンド数と不一致');
  assert(seq.filter(s => s === 'obj_round_win').length === world.flow.round, 'obj_round_win回数がラウンド数と不一致');
  for (const pl of world.players.values()) {
    assert(pl.move.pos.every(Number.isFinite), `位置がNaN/Inf: ${pl.id}`);
    assert(pl.hp >= 0 && pl.hp <= pl.maxHp, `HP範囲外: ${pl.id}=${pl.hp}/${pl.maxHp}`);
  }
  let kills = 0, deaths = 0;
  for (const pl of world.players.values()) { kills += pl.stats.kills; deaths += pl.stats.deaths; }
  // Smoke is intentionally a ten-second, one-round lifecycle probe. It proves
  // terminal objective flow, actions, and healing, but it is too short to make
  // a kill a deterministic requirement for every authored roster rotation.
  // Full acceptance runs retain the combat-elimination assertion.
  if (!SMOKE) assert(kills > 0, '撃破が一度も発生していない（戦闘が機能していない）');
  assert(kills <= deaths, 'kills>deaths（会計の破綻）');
  assert(world.log.length > 0, '試合ログが空（§9違反）');
  const caps = seq.filter(s => s === 'obj_captured').length;
  assert(caps >= world.flow.round, '確保イベントがラウンド数より少ない');
  suiteStats.matchUltimates.push(ultimatesByPlayer);
  return {
    seq,
    world,
    completedRounds,
    rotation,
    botRngControllers,
    ticks,
    maxTicks,
    terminationReason,
    snap,
    liveness,
    performance: snapshotPerformance(performanceMetrics),
  };
}

if (!JSON_OUTPUT) {
  console.log(`ヘッドレス全試合検証 seed=${SEED} matches=${MATCHES}${SOAK ? ' (soak)' : ''}`);
}
for (let offset = 0; offset < MATCHES; offset++) {
  const m = START_MATCH_INDEX + offset;
  const seed = pairedBotSeedForMatch(SEED, m);
  suiteStats.seeds.push(seed);
  if (!JSON_OUTPUT) {
    const roster = rosterForMatch(m).map(team => team.map(slot => slot.heroId).join(',')).join(' | ');
    console.log(`--- match ${m + 1} (seed=${seed}) roster=[${roster}] ---`);
  }
  const result = runMatch(seed, m);
  suiteStats.completedMatches.push({
    seed,
    matchIndex: m,
    matchWinner: result.world.flow.matchWinner,
    score: [...result.world.flow.score],
    simulatedDurationSec: Math.round(result.world.t * 1000) / 1000,
    ticks: result.ticks,
    maxTicks: result.maxTicks,
    finalState: result.world.flow.state,
    terminationReason: result.terminationReason,
    finalObjective: result.snap.objective,
    liveness: result.liveness,
    performance: result.performance,
    rounds: result.completedRounds,
    rotation: {
      rotationIndex: result.rotation.rotationIndex,
      canonicalLineupIndex: result.rotation.canonicalLineupIndex,
      mirrored: result.rotation.mirrored,
      mirrorMatchIndex: result.rotation.mirrorMatchIndex,
      acceptanceSeed: result.rotation.acceptanceSeed,
      logicalLineupSlots: result.rotation.rngSlots.map(team => (
        team.map(slot => slot.logicalLineupSlot)
      )),
    },
    botRng: {
      scheme: BOT_RNG_SCHEME,
      matchSeed: Number(result.world.seed) >>> 0,
      controllers: result.botRngControllers,
    },
  });
}

// The baseline acceptance run is deliberately the first complete paired
// rotation.  An isolated --match-index diagnostic must never be promoted to a
// complete roster or balance acceptance result merely because it happens to
// request enough matches.
const isBaselineAcceptanceRun = START_MATCH_INDEX === 0 && MATCHES >= MIN_ROSTER_MATCHES;
const ultimateEconomySummary = summarizeUltimateUses(suiteStats.matchUltimates);
const sideBalance = SMOKE
  ? { evaluated: false, reason: 'smoke_single_round_matches' }
  : summarizeSideBalance(suiteStats.completedMatches);
if (isBaselineAcceptanceRun && !SMOKE) {
  assert(suiteStats.roster.size === HEROES.length,
    `ロスター網羅が不足: ${suiteStats.roster.size}/${HEROES.length}`);
  assert(new Set(suiteStats.seeds).size >= 2, '複数seedで実行されていない');
  assert(suiteStats.actions.abilities > 0, '通常能力が一度も発動していない');
  assert(suiteStats.actions.ultimates > 0, '必殺技が一度も発動していない');
  assert(suiteStats.healing.events > 0 && suiteStats.healing.amount > 0, '回復が一度も発生していない');
}

if (isBaselineAcceptanceRun && !SMOKE) {
  assert(sideBalance.completedBo3 === MATCHES,
    `BO3 completion mismatch: ${sideBalance.completedBo3}/${MATCHES}`);
  assert(sideBalance.roundTwoSwap.expected === MATCHES &&
    sideBalance.roundTwoSwap.observed === MATCHES,
  `round-two side swaps missing: ${JSON.stringify(sideBalance.roundTwoSwap)}`);
  assert(ultimateEconomySummary.averageUses >= 2 && ultimateEconomySummary.averageUses <= 4.5,
    `ultimate average outside about-three target: ${ultimateEconomySummary.averageUses}`);
  assert(ultimateEconomySummary.medianUses >= 2 && ultimateEconomySummary.medianUses <= 5,
    `ultimate median outside about-three target: ${ultimateEconomySummary.medianUses}`);
  assert(ultimateEconomySummary.zeroUseRate <= 0.15,
    `ultimate zero-use rate too high: ${ultimateEconomySummary.zeroUseRate}`);
  assert(ultimateEconomySummary.maxUses <= 8,
    `ultimate outlier too high: ${ultimateEconomySummary.maxUses}`);
}

const summary = {
  seed: SEED,
  matches: MATCHES,
  startMatchIndex: START_MATCH_INDEX,
  acceptance: {
    baselinePairedRotation: isBaselineAcceptanceRun,
    requiredMatches: MIN_ROSTER_MATCHES,
  },
  seeds: suiteStats.seeds,
  roster: {
    uniqueHeroes: suiteStats.roster.size,
    totalHeroes: HEROES.length,
    heroes: [...suiteStats.roster],
    complete: suiteStats.roster.size === HEROES.length,
  },
  actions: suiteStats.actions,
  healing: {
    events: suiteStats.healing.events,
    amount: Math.round(suiteStats.healing.amount * 10) / 10,
  },
  ultimateDistribution: suiteStats.matchUltimates,
  ultimateEconomy: ultimateEconomySummary,
  teamCompositions: suiteStats.teamCompositions,
  completedMatches: suiteStats.completedMatches,
  rngScheme: BOT_RNG_SCHEME,
  sideBalance,
  simulation: {
    profile: SMOKE ? 'smoke' : SOAK ? 'soak' : 'acceptance',
    maxSimSec: MAX_SIM_SEC,
    roundCapSec: mode.roundCapSec,
    authoredRoundCapSec: authoredMode.roundCapSec,
    overrideRoundCapSec: requestedRoundCapSec,
    roundsToWin: mode.roundsToWin,
    maxRounds: mode.maxRounds,
    setupSec: mode.setupSec,
    resultSec: mode.resultSec,
  },
  failures,
};

if (JSON_OUTPUT) {
  console.log(JSON.stringify(summary));
} else {
  console.log(`\n検証統計: roster=${summary.roster.uniqueHeroes}/${summary.roster.totalHeroes}` +
    ` seeds=${summary.seeds.length} primary=${summary.actions.primary}` +
    ` abilities=${summary.actions.abilities} ultimates=${summary.actions.ultimates}` +
    ` heals=${summary.healing.events}/${summary.healing.amount}`);
  console.log(`  action slots=${JSON.stringify(summary.actions.slots)}`);
  console.log(`  ultimate economy=${JSON.stringify(summary.ultimateEconomy)}`);
}

if (failures > 0) {
  console.error(`\n検証失敗: ${failures}件`);
  process.exit(1);
}
if (!JSON_OUTPUT) {
  console.log('\n全検証パス: 18ヒーロー循環→複数seed→能力/必殺/回復→試合完走を確認');
  console.log('1000試合soak: node tools/headless.js --soak --quiet');
}
