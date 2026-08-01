// 偽の遮蔽クラスタ検出プローブ（tests/map_site_cladding.test.js の新規則の下敷き）
//
// インスタンス単位の 0.8m 制限は「0.74m の柱を 0.7m 間隔で4本」を素通しにする。
// ここでは「立てる床の胴体帯（床上 1.8m）に入っている、当たり判定の無い部分」だけを
// 集めて束ね、その塊が体を隠せる幅（最小辺 > 0.8m）かつ実際に詰まっている
// （占有率 >= 0.40）かどうかを見る。
import { buildMap } from '../shared/data/map_oshioi.js';

export const CLUSTER_GAP_M = 1.0;
export const CLUSTER_THIN_M = 0.8;
export const BODY_BAND_M = 2.2;
export const STAND_NEAR_M = 6.0;
export const CLUSTER_FILL = 0.40;

function xyBounds(tr) {
  const [x, y] = tr.position;
  const [sx, sy] = tr.scale;
  const yaw = tr.rotation?.[2] || 0;
  const hx = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sy / 2;
  const hy = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sy / 2;
  return { minX: x - hx, maxX: x + hx, minY: y - hy, maxY: y + hy };
}

// 束ねた塊の実占有率。単純な面積和は重なりを二重計上するのでラスタで測る。
function fillRatio(parts, minX, maxX, minY, maxY) {
  const w = maxX - minX;
  const d = maxY - minY;
  const nx = Math.min(96, Math.max(4, Math.round(w / 0.1)));
  const ny = Math.min(96, Math.max(4, Math.round(d / 0.1)));
  let hit = 0;
  for (let i = 0; i < nx; i++) {
    const px = minX + (i + 0.5) * (w / nx);
    for (let j = 0; j < ny; j++) {
      const py = minY + (j + 0.5) * (d / ny);
      for (const p of parts) {
        if (px >= p.minX && px <= p.maxX && py >= p.minY && py <= p.maxY) { hit += 1; break; }
      }
    }
  }
  return hit / (nx * ny);
}

export function findUnsafeClusters(map) {
  const solids = map.solids;
  const clad = map.presentation.layers.filter(l => l.semantics === 'clad-existing-solid');

  // 1) 当たり判定の外側（宿主上端より上）に出ている部分だけを集める
  const parts = [];
  for (const layer of clad) {
    for (const [index, tr] of layer.transforms.entries()) {
      const b = xyBounds(tr);
      let host = null;
      for (const s of solids) {
        if (b.minX < s.min[0] - 0.35 || b.maxX > s.max[0] + 0.35) continue;
        if (b.minY < s.min[1] - 0.35 || b.maxY > s.max[1] + 0.35) continue;
        if (!host || s.max[2] > host.max[2]) host = s;
      }
      if (!host) continue;
      const top = tr.position[2] + tr.scale[2] / 2;
      if (top <= host.max[2] + 0.05) continue;
      const z0 = Math.max(host.max[2], tr.position[2] - tr.scale[2] / 2);
      if (top - z0 < 0.2) continue;
      parts.push({
        id: `${layer.id}[${index}]`,
        minX: b.minX, maxX: b.maxX, minY: b.minY, maxY: b.maxY, z0, z1: top,
      });
    }
  }

  // 1.5) 「実際に立てる天面」だけを残す。床(z<=4.05)から出発して、
  //      水平 3.5m 以内・高低差 1.1136m 以内で登れる天面を伝播させる。
  //      これを入れないと、5m 上の大灯柱の頭のような到達不能な天面まで
  //      「傍らに立てる床」に数えてしまう。
  const REACH_UP = 1.1136;
  const REACH_XY = 3.5;
  const reachable = solids.map(s => s.max[2] <= 4.05);
  for (let pass = 0; pass < 12; pass++) {
    let grew = false;
    for (let i = 0; i < solids.length; i++) {
      if (reachable[i]) continue;
      const a = solids[i];
      for (let j = 0; j < solids.length; j++) {
        if (!reachable[j]) continue;
        const b = solids[j];
        if (a.max[2] - b.max[2] > REACH_UP || b.max[2] - a.max[2] > 6) continue;
        const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0);
        const dy = Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1], 0);
        if (Math.hypot(dx, dy) > REACH_XY) continue;
        reachable[i] = true;
        grew = true;
        break;
      }
    }
    if (!grew) break;
  }
  const standable = solids.filter((_, i) => reachable[i]);

  // 2) 「立てる床」の候補（solid の天面）を格子で引ける形にする
  const CELL = 8;
  const solidGrid = new Map();
  for (const s of standable) {
    for (let gx = Math.floor((s.min[0] - STAND_NEAR_M) / CELL); gx <= Math.floor((s.max[0] + STAND_NEAR_M) / CELL); gx++) {
      for (let gy = Math.floor((s.min[1] - STAND_NEAR_M) / CELL); gy <= Math.floor((s.max[1] + STAND_NEAR_M) / CELL); gy++) {
        const k = `${gx}:${gy}`;
        let bucket = solidGrid.get(k);
        if (!bucket) solidGrid.set(k, (bucket = []));
        bucket.push(s);
      }
    }
  }
  const nearbySolids = (minX, maxX, minY, maxY) => {
    const seen = new Set();
    const out = [];
    for (let gx = Math.floor(minX / CELL); gx <= Math.floor(maxX / CELL); gx++) {
      for (let gy = Math.floor(minY / CELL); gy <= Math.floor(maxY / CELL); gy++) {
        for (const s of solidGrid.get(`${gx}:${gy}`) || []) {
          if (seen.has(s)) continue;
          seen.add(s);
          const dx = Math.max(minX - s.max[0], s.min[0] - maxX, 0);
          const dy = Math.max(minY - s.max[1], s.min[1] - maxY, 0);
          if (Math.hypot(dx, dy) <= STAND_NEAR_M) out.push(s);
        }
      }
    }
    return out;
  };

  // 3) 立てる床ごとに、その胴体帯 [S, S+1.8] に入る部分だけを束ねる
  const PCELL = 4;
  const partGrid = new Map();
  parts.forEach((p, i) => {
    for (let gx = Math.floor(p.minX / PCELL); gx <= Math.floor(p.maxX / PCELL); gx++) {
      for (let gy = Math.floor(p.minY / PCELL); gy <= Math.floor(p.maxY / PCELL); gy++) {
        const k = `${gx}:${gy}`;
        let bucket = partGrid.get(k);
        if (!bucket) partGrid.set(k, (bucket = []));
        bucket.push(i);
      }
    }
  });

  const bands = new Map();   // 「立てる床の高さ」ごとに1回だけ評価する
  for (const p of parts) {
    for (const s of nearbySolids(p.minX, p.maxX, p.minY, p.maxY)) {
      const stand = s.max[2];
      if (!(p.z0 < stand + BODY_BAND_M && p.z1 > stand + 0.2)) continue;
      const key = `${Math.round(p.minX / 6)}:${Math.round(p.minY / 6)}:${stand.toFixed(2)}`;
      if (!bands.has(key)) bands.set(key, { stand, seed: p, id: s.id });
    }
  }

  const unsafe = [];
  const reported = new Set();
  for (const { stand, seed, id: standId } of bands.values()) {
    // seed から胴体帯内の部分だけを連結成長させる
    const lo = stand;
    const hi = stand + BODY_BAND_M;
    const inBand = p => p.z0 < hi && p.z1 > lo + 0.2;
    if (!inBand(seed)) continue;
    const group = [seed];
    const set = new Set([seed]);
    const queue = [seed];
    while (queue.length) {
      const cur = queue.pop();
      for (let gx = Math.floor((cur.minX - CLUSTER_GAP_M) / PCELL); gx <= Math.floor((cur.maxX + CLUSTER_GAP_M) / PCELL); gx++) {
        for (let gy = Math.floor((cur.minY - CLUSTER_GAP_M) / PCELL); gy <= Math.floor((cur.maxY + CLUSTER_GAP_M) / PCELL); gy++) {
          for (const idx of partGrid.get(`${gx}:${gy}`) || []) {
            const p = parts[idx];
            if (set.has(p) || !inBand(p)) continue;
            const dx = Math.max(cur.minX - p.maxX, p.minX - cur.maxX, 0);
            const dy = Math.max(cur.minY - p.maxY, p.minY - cur.maxY, 0);
            if (dx > CLUSTER_GAP_M || dy > CLUSTER_GAP_M) continue;
            set.add(p);
            group.push(p);
            queue.push(p);
          }
        }
      }
    }
    const minX = Math.min(...group.map(p => p.minX));
    const maxX = Math.max(...group.map(p => p.maxX));
    const minY = Math.min(...group.map(p => p.minY));
    const maxY = Math.max(...group.map(p => p.maxY));
    const w = maxX - minX;
    const d = maxY - minY;
    if (Math.min(w, d) <= CLUSTER_THIN_M) continue;
    const fill = fillRatio(group, minX, maxX, minY, maxY);
    if (fill < CLUSTER_FILL) continue;
    const key = `${minX.toFixed(1)}:${minY.toFixed(1)}:${stand.toFixed(2)}`;
    if (reported.has(key)) continue;
    reported.add(key);
    unsafe.push({
      at: [(minX + maxX) / 2, (minY + maxY) / 2], w, d, stand, standId, fill,
      count: group.length, ids: group.slice(0, 5).map(p => p.id),
    });
  }
  unsafe.sort((a, b) => Math.min(b.w, b.d) - Math.min(a.w, a.d));
  return unsafe;
}

if (process.argv[1] && process.argv[1].endsWith('audit_fake_cover_clusters.mjs')) {
  const unsafe = findUnsafeClusters(buildMap());
  console.log(`unsafe clusters: ${unsafe.length}`);
  for (const u of unsafe.slice(0, 50)) {
    console.log(`(${u.at[0].toFixed(1)},${u.at[1].toFixed(1)}) ${u.w.toFixed(2)}x${u.d.toFixed(2)} `
      + `stand=${u.stand.toFixed(2)}@${u.standId} fill=${u.fill.toFixed(2)} n=${u.count} :: ${u.ids.join(', ')}`);
  }
}
