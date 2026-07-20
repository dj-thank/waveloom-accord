// 診断: 各チームの目標までの平均距離・キル数・目標内人数を定期出力
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { BotController } from '../server/bots.js';
import { makeRng } from '../shared/sim/rng.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const mode = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/mode_shioura.json'), 'utf8'));
const combat = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/combat.json'), 'utf8'));

const world = new World(buildMap(), mode, combat, 20260713);
const rng = makeRng(99);
const bots = [];
for (let i = 0; i < 10; i++) {
  const pl = world.addPlayer('bot' + i, true, i % 2);
  bots.push(new BotController(world, pl, rng));
}
console.log('sides:', world.flow.sides);

let nextReport = 0;
while (world.flow.state !== 'MATCH_END' && world.t < 200) {
  for (const bc of bots) bc.think(world.dt);
  world.tick();
  world.drainEvents();
  if (world.t >= nextReport) {
    nextReport += 10;
    const info = [[], []];
    for (const pl of world.players.values()) {
      const d = Math.hypot(pl.move.pos[0], pl.move.pos[1]);
      info[pl.team].push(`${d.toFixed(0)}m${pl.alive ? '' : '†'}${pl.insideObjective ? '*' : ''}`);
    }
    const k = [0, 0];
    for (const pl of world.players.values()) k[pl.team] += pl.stats.kills;
    const o = world.objective.snapshot();
    console.log(`t=${world.t.toFixed(0).padStart(4)} ${world.flow.state} own=${o.owner} g=[${o.gauge.map(x => x.toFixed(0))}] pot=[${o.pot}] K=[${k}] T0(${world.flow.sides[0]}): ${info[0].join(' ')} | T1: ${info[1].join(' ')}`);
    if (world.flow.state === 'ACTIVE') {
      for (const bc of bots) {
        const pl = bc.pl;
        const d = Math.hypot(pl.move.pos[0], pl.move.pos[1]);
        if (!pl.alive || d < 30) continue;
        const pts = bc.routePoints();
        const wp = pts[Math.min(bc.wpIndex, pts.length - 1)];
        console.log(`    T${pl.team} ${pl.id} ${bc.mode}/${bc.route}/wp${bc.wpIndex} pos=(${pl.move.pos.map(v => v.toFixed(1))}) v=${Math.hypot(pl.move.vel[0], pl.move.vel[1]).toFixed(1)} wp=(${wp.map(v => v.toFixed(0))})`);
      }
    }
  }
}
// スタック中のボットの詳細
console.log('--- スタック診断 ---');
for (const bc of bots) {
  const pl = bc.pl;
  const speed = Math.hypot(pl.move.vel[0], pl.move.vel[1]);
  if (!pl.alive || speed > 0.8) continue;
  const pts = bc.routePoints();
  const wp = pts[Math.min(bc.wpIndex, pts.length - 1)];
  console.log(`T${pl.team} ${pl.id} mode=${bc.mode} route=${bc.route} wp${bc.wpIndex} pos=(${pl.move.pos.map(v => v.toFixed(1))}) grounded=${pl.move.grounded} → wp=(${wp}) speed=${speed.toFixed(2)}`);
}
