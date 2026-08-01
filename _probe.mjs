// 「立てる面の体高帯」で束ねた塊の幅を検査するプローブ
import { buildMap } from './shared/data/map_oshioi.js';

const map = buildMap();
const solids = map.solids;
const clad = map.presentation.layers.filter(l => l.semantics === 'clad-existing-solid');

const XY_GAP = 1.0;
const MIN_W = 0.8;
const BODY_LO = 0.15;
const BODY_HI = 1.65;
const NEAR = 2.0;
const TOL = 0.35;

function aabb(tr) {
  const [x, y, z] = tr.position;
  const [sx, sy, sz] = tr.scale;
  const yaw = tr.rotation?.[2] || 0;
  const hx = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sy / 2;
  const hy = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sy / 2;
  return { minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy, minZ: z - sz / 2, maxZ: z + sz / 2 };
}

function hostTopOf(b) {
  let host = null;
  for (const s of solids) {
    if (b.minX < s.min[0] - TOL || b.maxX > s.max[0] + TOL) continue;
    if (b.minY < s.min[1] - TOL || b.maxY > s.max[1] + TOL) continue;
    if (!host || s.max[2] > host.max[2]) host = s;
  }
  return host ? host.max[2] : null;
}

const items = [];
for (const layer of clad) {
  if (layer.primitive === 'plane') continue;
  for (const [i, tr] of layer.transforms.entries()) {
    const b = aabb(tr);
    const ht = hostTopOf(b);
    if (ht === null) continue;
    if (b.maxZ <= ht + 0.05) continue;
    items.push({ ...b, minZ: Math.max(b.minZ, ht), id: `${layer.id}[${i}]`, layer: layer.id });
  }
}

const tops = [...new Set(solids.map(s => Math.round(s.max[2] * 100) / 100))].sort((a, b) => a - b);
const bad = [];
for (const S of tops) {
  const lo = S + BODY_LO;
  const hi = S + BODY_HI;
  const band = items.filter(it => it.minZ < hi && it.maxZ > lo);
  if (!band.length) continue;
  const stands = solids.filter(s => Math.abs(s.max[2] - S) < 0.005);
  const parent = band.map((_, i) => i);
  const find = a => (parent[a] === a ? a : (parent[a] = find(parent[a])));
  for (let a = 0; a < band.length; a++) for (let b = a + 1; b < band.length; b++) {
    const A = band[a], B = band[b];
    if (Math.max(A.minX - B.maxX, B.minX - A.maxX) > XY_GAP) continue;
    if (Math.max(A.minY - B.maxY, B.minY - A.maxY) > XY_GAP) continue;
    const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb;
  }
  const groups = new Map();
  band.forEach((it, i) => {
    const r = find(i);
    let g = groups.get(r);
    if (!g) { g = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9, n: 0, layers: new Set(), spans: [] }; groups.set(r, g); }
    g.minX = Math.min(g.minX, it.minX); g.maxX = Math.max(g.maxX, it.maxX);
    g.minY = Math.min(g.minY, it.minY); g.maxY = Math.max(g.maxY, it.maxY);
    g.spans.push([Math.max(it.minZ, lo), Math.min(it.maxZ, hi)]);
    g.n++; g.layers.add(it.layer);
  });
  for (const g of groups.values()) {
    const w = Math.min(g.maxX - g.minX, g.maxY - g.minY);
    if (w <= MIN_W) continue;
    // 体高帯のうち実際に塞がれている高さ（区間の和）が 0.9m 未満なら体は隠せない
    g.spans.sort((a, b) => a[0] - b[0]);
    let covered = 0; let cur = null;
    for (const [a, b] of g.spans) {
      if (!cur) { cur = [a, b]; continue; }
      if (a <= cur[1]) cur[1] = Math.max(cur[1], b);
      else { covered += cur[1] - cur[0]; cur = [a, b]; }
    }
    if (cur) covered += cur[1] - cur[0];
    if (covered < 0.9) continue;
    const near = stands.some(s => s.max[0] >= g.minX - NEAR && s.min[0] <= g.maxX + NEAR
      && s.max[1] >= g.minY - NEAR && s.min[1] <= g.maxY + NEAR);
    if (!near) continue;
    bad.push({ S, w, ...g, layers: [...g.layers].join(',') });
  }
}
bad.sort((a, b) => b.w - a.w);
console.log(`items=${items.length} tops=${tops.length} BAD=${bad.length}`);
const byLayer = new Map();
for (const b of bad) for (const l of b.layers.split(',')) byLayer.set(l, (byLayer.get(l) || 0) + 1);
console.log('layers:', [...byLayer.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(' '));
for (const b of bad.slice(0, 45)) {
  console.log(`  w=${b.w.toFixed(2)} ext=${(b.maxX - b.minX).toFixed(2)}x${(b.maxY - b.minY).toFixed(2)} stand=${b.S} n=${b.n} @(${((b.minX + b.maxX) / 2).toFixed(1)},${((b.minY + b.maxY) / 2).toFixed(1)}) :: ${b.layers}`);
}
