// ヘッドレス検証: ボット10体でBO3フル試合を最速実行し、
// 「開始→争奪→（延長）→勝敗確定→試合終了」の完走と不変条件を検証する。
// 使い方: node tools/headless.js [--seed 12345] [--quiet] [--matches 1]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import { makeRng } from '../shared/sim/rng.js';
import { HEROES } from '../shared/data/heroes.js';
import { summarizeUltimateUses } from '../shared/sim/ult_economy.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const mode = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/mode_shioura.json'), 'utf8'));
const combat = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/combat.json'), 'utf8'));

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf('--' + n);
  if (i < 0) return d;
  const value = Number(args[i + 1]);
  return Number.isFinite(value) ? value : d;
};
const QUIET = args.includes('--quiet');
const JSON_OUTPUT = args.includes('--json');
const SOAK = args.includes('--soak');
const SEED = flag('seed', 20260713);
const ROSTER_SLOTS = mode.teamSize * 2;
const MIN_ROSTER_MATCHES = Math.ceil(HEROES.length / ROSTER_SLOTS);
const MATCHES = Math.max(1, Math.floor(flag('matches', SOAK ? 1000 : MIN_ROSTER_MATCHES)));

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
  return Array.from({ length: ROSTER_SLOTS }, (_, slot) =>
    HEROES[(matchIndex * ROSTER_SLOTS + slot) % HEROES.length].id);
}

function runMatch(seed, matchIndex) {
  const world = new World(buildMap(), mode, combat, seed);
  const rng = makeRng(seed ^ 0xb07);
  const bots = [];
  const roster = rosterForMatch(matchIndex);
  for (let i = 0; i < ROSTER_SLOTS; i++) {
    const heroId = roster[i];
    const pl = world.addPlayer('bot' + i, true, i % 2, heroId);
    suiteStats.roster.add(heroId);
    heroActionStats(heroId);
    bots.push(new BotController(world, pl, rng));
  }

  const maxTicks = combat.tickRateHz * 60 * 45; // 実ゲーム時間45分の保険
  const seq = [];
  let ticks = 0;
  while (world.flow.state !== 'MATCH_END' && ticks < maxTicks) {
    for (const bc of bots) bc.think(world.dt);
    world.tick();
    ticks++;
    for (const ev of world.drainEvents()) {
      recordEvent(ev, world);
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
  }

  const snap = world.snapshot();
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
  assert(kills > 0, '撃破が一度も発生していない（戦闘が機能していない）');
  assert(kills <= deaths, 'kills>deaths（会計の破綻）');
  assert(world.log.length > 0, '試合ログが空（§9違反）');
  const caps = seq.filter(s => s === 'obj_captured').length;
  assert(caps >= world.flow.round, '確保イベントがラウンド数より少ない');
  suiteStats.matchUltimates.push(ultimatesByPlayer);
  return { seq, world };
}

if (!JSON_OUTPUT) {
  console.log(`ヘッドレス全試合検証 seed=${SEED} matches=${MATCHES}${SOAK ? ' (soak)' : ''}`);
}
for (let m = 0; m < MATCHES; m++) {
  const seed = SEED + m * 7919;
  suiteStats.seeds.push(seed);
  if (!JSON_OUTPUT) console.log(`--- match ${m + 1} (seed=${seed}) roster=[${rosterForMatch(m)}] ---`);
  runMatch(seed, m);
}

const completeRosterRun = MATCHES >= MIN_ROSTER_MATCHES;
const ultimateEconomySummary = summarizeUltimateUses(suiteStats.matchUltimates);
if (completeRosterRun) {
  assert(suiteStats.roster.size === HEROES.length,
    `ロスター網羅が不足: ${suiteStats.roster.size}/${HEROES.length}`);
  assert(new Set(suiteStats.seeds).size >= 2, '複数seedで実行されていない');
  assert(suiteStats.actions.abilities > 0, '通常能力が一度も発動していない');
  assert(suiteStats.actions.ultimates > 0, '必殺技が一度も発動していない');
  assert(suiteStats.healing.events > 0 && suiteStats.healing.amount > 0, '回復が一度も発生していない');
}

if (completeRosterRun) {
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
