// 潮汲み環礁ウルハ・大潮井 — 植生層（担当 V）
//
// 設計の中核: **当たり判定を持たない木は偽の遮蔽になる。**
//
// 反復2でここを作り直した。旧版は「宿主上端より上は XY 0.8m 以下」という安全規則を
// 守るために樹冠を 0.61〜0.78m の板にし、しかも遮蔽箱(cover)と壁(wall)の天端に
// 33本を生やしていた。検証で「4.5倍拡大では交差する2枚の薄板にしか見えない」
// 「高さ2.2mの箱の蓋から4mの木が出ている」と出た通り、原則5（植生は柔らかい遮蔽）は
// 幅0.8mの制約の下では原理的に満たせない。
//
// 解いた方法: **木そのものに当たり判定を持たせた。**
// `map_oshioi_ring_geometry.js` に `ring-tree-*`（2.2 x 2.2 x 5.6〜8.1m, tag:'cover'）を
// 79本追加し、幹と樹冠はその footprint と上端の内側だけに描く。
// 樹冠は 2.7m まで太らせても当たり判定の中なので偽の遮蔽にならない。
//
// したがって置ける場所は4種類。
//   ① プレイ領域内の既存ソリッド天端 = 植栽枡・下草・屋上緑化の板（宿主上端 +0.05 まで）
//      **木は生やさない。** 遮蔽箱の上の木は遮蔽シルエットも壊す。
//   ② `ring-tree-*` の中 = 本物の樹木（幹 0.9m・樹冠 2.4〜2.7m）
//   ③ 境界外（semantics:'outside-playable-bounds'）は太さ自由。防風林を密にする。
//
// ①の宿主は `canonical-*` と `flash-*` だけを使う（座標が動かない）。
//
// primitive の三角形コスト: cylinder 40 / dodecaLow 36 / box 12 / plane 2。
// sphere(140) と dodeca(144) は使わない。
// rotation[0]（ピッチ）は使わない。yaw のみ。

import { buildOshioiFlashpointGeometry } from './map_oshioi_flashpoint_geometry.js';
import { buildOshioiRingGeometry } from './map_oshioi_ring_geometry.js';

const t = (position, scale, rotation = [0, 0, 0]) => ({ position, scale, rotation });

// 決定論的な擬似乱数（同じ入力から必ず同じ配置を作る）
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

const LIP = 0.05;           // 宿主上端に対して許される持ち上げ

const planters = [];   // box   / shellShade  — 植栽枡の縁
const shrubs = [];     // box   / foliage     — 枡の中身・下草・つる
const trunksIn = [];   // cylinder / cedar    — プレイ領域内の幹
const crownsIn = [];   // dodecaLow / foliageLight
const mats = [];       // plane / foliage     — 屋上の苔・下草の板
const trunksOut = [];  // cylinder / cedar    — 境界の防風林
const crownsOut = [];  // dodecaLow / foliageLight

// ---------------------------------------------------------------------------
// 宿主テーブル（すべて map.solids の実測値。canonical-* と flash-* のみ）
// kind: 'block' 小さな遮蔽塊 / 'roof' 屋上 / 'deck' 広い床
// ---------------------------------------------------------------------------
const HOSTS = [
  // --- 中央帯 r<60 : 高い塊の上（屋上緑化に見える） ---
  { id: 'canonical-130-tower', x0: -3, x1: 3, y0: 10, y1: 16, top: 8.0, kind: 'roof', trees: 2 },
  { id: 'canonical-131-tower', x0: -3, x1: 3, y0: -16, y1: -10, top: 8.0, kind: 'roof', trees: 2 },
  { id: 'canonical-154-cover', x0: 19.2, x1: 20.8, y0: -0.8, y1: 0.8, top: 9.0, kind: 'block', trees: 1 },
  { id: 'canonical-155-cover', x0: -20.8, x1: -19.2, y0: -0.8, y1: 0.8, top: 9.0, kind: 'block', trees: 1 },
  { id: 'canonical-164-cover', x0: 27, x1: 29, y0: 2.5, y1: 4.5, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-165-cover', x0: -29, x1: -27, y0: -4.5, y1: -2.5, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-168-cover', x0: 35.5, x1: 37.5, y0: 21.8, y1: 23.8, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-169-cover', x0: -37.5, x1: -35.5, y0: -23.8, y1: -21.8, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-170-cover', x0: 21, x1: 23, y0: 11.5, y1: 13.5, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-171-cover', x0: -23, x1: -21, y0: -13.5, y1: -11.5, top: 6.4, kind: 'block', trees: 1 },
  { id: 'canonical-166-cover', x0: 12.2, x1: 14.2, y0: -0.6, y1: 0.8, top: 6.4, kind: 'block', trees: 0 },
  { id: 'canonical-167-cover', x0: -14.2, x1: -12.2, y0: -0.8, y1: 0.6, top: 6.4, kind: 'block', trees: 0 },
  { id: 'canonical-158-cover', x0: 25.4, x1: 26.9, y0: -12.6, y1: -11.1, top: 5.5, kind: 'block', trees: 1 },
  { id: 'canonical-159-cover', x0: -26.9, x1: -25.4, y0: 11.1, y1: 12.6, top: 5.5, kind: 'block', trees: 1 },
  { id: 'canonical-162-cover', x0: 28, x1: 29.5, y0: 10, y1: 11.5, top: 5.5, kind: 'block', trees: 1 },
  { id: 'canonical-163-cover', x0: -29.5, x1: -28, y0: -11.5, y1: -10, top: 5.5, kind: 'block', trees: 1 },
  { id: 'canonical-156-cover', x0: 13.4, x1: 14.9, y0: 7.4, y1: 8.9, top: 5.5, kind: 'block', trees: 0 },
  { id: 'canonical-157-cover', x0: -14.9, x1: -13.4, y0: -8.9, y1: -7.4, top: 5.5, kind: 'block', trees: 0 },
  { id: 'canonical-160-cover', x0: 11.0, x1: 12.5, y0: -14.8, y1: -13.3, top: 5.5, kind: 'block', trees: 0 },
  { id: 'canonical-161-cover', x0: -12.5, x1: -11.0, y0: 13.3, y1: 14.8, top: 5.5, kind: 'block', trees: 0 },

  // --- 中央帯 r<60 : 床スラブ（並木と縁の植え込み） ---
  { id: 'canonical-072-slab', x0: -43, x1: 43, y0: 20, y1: 26, top: 4.0, kind: 'deck', trees: 2 },
  { id: 'canonical-073-slab', x0: -43, x1: 43, y0: -26, y1: -20, top: 4.0, kind: 'deck', trees: 2 },
  { id: 'canonical-032-slab', x0: 38, x1: 46, y0: -8, y1: 8, top: 4.0, kind: 'deck', trees: 1 },
  { id: 'canonical-033-slab', x0: -46, x1: -38, y0: -8, y1: 8, top: 4.0, kind: 'deck', trees: 1 },
  { id: 'canonical-052-slab', x0: 40, x1: 43, y0: 8, y1: 20, top: 4.0, kind: 'deck', trees: 0 },
  { id: 'canonical-053-slab', x0: -43, x1: -40, y0: -20, y1: -8, top: 4.0, kind: 'deck', trees: 0 },
  { id: 'canonical-046-slab', x0: 32, x1: 38, y0: -3, y1: 3, top: 4.0, kind: 'deck', trees: 0 },
  { id: 'canonical-047-slab', x0: -38, x1: -32, y0: -3, y1: 3, top: 4.0, kind: 'deck', trees: 0 },
];

// --- 4拠点 r 60〜96 : 大質量の屋上・高台・制圧パッド ---
const SITES = [
  {
    name: 'mizuichi',
    pad: [47, 65, 35, 53, 4.0],
    massN: [48, 57, 56, 60, 12.0], massS: [55, 64, 28, 32, 11.0],
    plat: [65, 71, 47, 53, 9.0],
    covers: [[48, 51, 51.5, 53, 6.5], [61, 64, 51.5, 53, 6.5], [54, 58, 35, 36.5, 6.5]],
  },
  {
    name: 'kado',
    pad: [47, 65, -53, -35, 4.0],
    massN: [48, 57, -32, -28, 11.0], massS: [55, 64, -60, -56, 12.0],
    plat: [41, 47, -55, -49, 8.0],
    covers: [[48, 51, -36.5, -35, 6.5], [61, 64, -36.5, -35, 6.5], [54, 58, -53, -51.5, 6.5]],
  },
  {
    name: 'ami',
    pad: [-65, -47, 35, 53, 4.0],
    massN: [-64, -55, 56, 60, 12.0], massS: [-57, -48, 28, 32, 10.0],
    plat: [-47, -41, 47, 53, 8.0],
    covers: [[-64, -61, 51.5, 53, 6.5], [-51, -48, 51.5, 53, 6.5], [-58, -54, 35, 36.5, 6.5]],
  },
  {
    name: 'kazami',
    pad: [-65, -47, -53, -35, 4.0],
    massN: [-64, -55, -32, -28, 11.0], massS: [-57, -48, -60, -56, 11.0],
    plat: [-71, -65, -53, -47, 9.0],
    covers: [[-64, -61, -36.5, -35, 6.5], [-51, -48, -36.5, -35, 6.5], [-58, -54, -53, -51.5, 6.5]],
  },
];

for (const site of SITES) {
  const [ax0, ax1, ay0, ay1, atop] = site.pad;
  HOSTS.push({ id: `flash-site-${site.name}-objective-pad`, x0: ax0, x1: ax1, y0: ay0, y1: ay1, top: atop, kind: 'deck', trees: 2 });
  for (const [key, trees] of [['massN', 2], ['massS', 2], ['plat', 2]]) {
    const [x0, x1, y0, y1, top] = site[key];
    HOSTS.push({ id: `flash-site-${site.name}-${key}`, x0, x1, y0, y1, top, kind: 'roof', trees });
  }
  site.covers.forEach(([x0, x1, y0, y1, top], index) => {
    HOSTS.push({
      id: `flash-site-${site.name}-cover-${index}`,
      x0, x1, y0, y1, top, kind: 'block', trees: index === 0 ? 1 : 0,
    });
  });
}

// ---------------------------------------------------------------------------
// プレイ領域内の配置
// ---------------------------------------------------------------------------
HOSTS.forEach((host, hostIndex) => {
  const random = rng(0x5eed01 + hostIndex * 7919);
  const w = host.x1 - host.x0;
  const d = host.y1 - host.y0;
  const cx = (host.x0 + host.x1) / 2;
  const cy = (host.y0 + host.y1) / 2;
  const top = host.top;

  if (host.kind === 'block') {
    // 塊まるごとを植栽枡にする。縁は宿主上端 +0.05m まで、中身はその 0.01m 下。
    const rimW = Math.max(0.6, w - 0.14);
    const rimD = Math.max(0.6, d - 0.14);
    planters.push(t([cx, cy, top + LIP - 0.28], [rimW, rimD, 0.56]));
    shrubs.push(t([cx, cy, top + 0.04 - 0.25], [Math.max(0.4, rimW - 0.42), Math.max(0.4, rimD - 0.42), 0.5]));
    mats.push(t([cx, cy, top + 0.03], [rimW - 0.1, rimD - 0.1, 0.02]));
  } else {
    // 屋上・床: 帯状の植え込みを 2〜4 本、寸法を散らして置く（原則2の3スケール反復）
    const beds = host.kind === 'roof' ? 3 : 4;
    for (let index = 0; index < beds; index++) {
      const along = w >= d;
      const span = along ? w : d;
      const bedLong = Math.min(span - 1.2, 2.4 + (index % 3) * 2.6 + random() * 2.2);
      const bedShort = Math.min((along ? d : w) - 0.9, 1.1 + (index % 2) * 0.9 + random() * 0.5);
      if (bedLong < 1.0 || bedShort < 0.7) continue;
      const slot = (index + 0.5) / beds;
      const px = along ? host.x0 + 0.6 + slot * (w - 1.2) : cx + (random() - 0.5) * Math.max(0, w - bedShort - 0.8);
      const py = along ? cy + (random() - 0.5) * Math.max(0, d - bedShort - 0.8) : host.y0 + 0.6 + slot * (d - 1.2);
      const sx = along ? bedLong : bedShort;
      const sy = along ? bedShort : bedLong;
      // footprint から出ないよう最後に切り詰める
      const fx = Math.min(sx, 2 * Math.min(px - host.x0, host.x1 - px));
      const fy = Math.min(sy, 2 * Math.min(py - host.y0, host.y1 - py));
      if (fx < 0.9 || fy < 0.7) continue;
      planters.push(t([px, py, top + LIP - 0.26], [fx, fy, 0.52]));
      shrubs.push(t([px, py, top + 0.04 - 0.24], [Math.max(0.4, fx - 0.4), Math.max(0.35, fy - 0.4), 0.48]));
      // 下草の板は枡より広げてよいが、宿主 footprint を絶対に越えない
      // （越えると「より大きく・より低い」ソリッドが宿主に化けて 4m 浮いて見える）
      if (index % 2 === 0) {
        const matX = Math.min(fx + 2.6, 2 * Math.min(px - host.x0, host.x1 - px));
        const matY = Math.min(fy + 2.2, 2 * Math.min(py - host.y0, host.y1 - py));
        if (matX >= 1.0 && matY >= 0.8) mats.push(t([px, py, top + 0.03], [matX, matY, 0.02]));
      }
    }
  }

  // **木は生やさない。** 宿主上端より上へ出せるのは XY 0.8m 以下だけで、
  // その寸法では樹冠が板になり、しかも遮蔽箱のシルエットを壊す（検証の blocker）。
  // プレイ領域内の樹木は ring-tree-* の中だけに立てる（下を参照）。
});

// ---------------------------------------------------------------------------
// プレイ領域内の樹木 — ring-tree-*（2.2 x 2.2 x 5.6〜8.1m）の内側だけに描く。
// 当たり判定そのものなので、樹冠を 2.7m まで太らせても偽の遮蔽にならない。
// ---------------------------------------------------------------------------
const TREE_HOSTS = buildOshioiRingGeometry().solids
  .filter(solid => /^ring-tree-\d+$/.test(solid.id));

TREE_HOSTS.forEach((host, index) => {
  const random = rng(0x7a3e01 + index * 6151);
  const tx = (host.min[0] + host.max[0]) / 2;
  const ty = (host.min[1] + host.max[1]) / 2;
  const base = host.min[2];
  const top = host.max[2];
  const height = top - base;
  const foot = Math.min(host.max[0] - host.min[0], host.max[1] - host.min[1]);  // 2.2

  // 根方の植え枡（宿主内なので太さ自由）
  planters.push(t([tx, ty, base + 0.24], [foot - 0.1, foot - 0.1, 0.48]));
  mats.push(t([tx, ty, base + 0.5], [foot + 0.3, foot + 0.3, 0.02]));

  // 幹。宿主上端を超えないので 0.8m 制限は掛からない。
  const trunkXY = 0.82 + random() * 0.16;
  const trunkTop = base + height * (0.5 + random() * 0.08);
  trunksIn.push(t([tx, ty, (base + 0.4 + trunkTop) / 2], [trunkXY, trunkXY, trunkTop - base - 0.4]));

  // 樹冠3段。上端は宿主上端に揃え、XY は footprint + 0.30m まで（テスト許容0.35の内側）。
  // **yaw は掛けない。** 正方 XY に yaw を掛けると投影半幅が最大 √2 倍になり、
  // 2.7m の樹冠が 3.8m まで膨らんで footprint を突き破る（旧版で実際に起きた）。
  const HALF_LIMIT = foot / 2 + 0.30;
  for (let k = 0; k < 3; k++) {
    const ox = (random() - 0.5) * 0.3;
    const oy = (random() - 0.5) * 0.3;
    const cw = Math.min((foot + 0.5) - k * 0.36 + random() * 0.14, 2 * (HALF_LIMIT - Math.abs(ox)));
    const cd = Math.min((foot + 0.42) - k * 0.32 + random() * 0.14, 2 * (HALF_LIMIT - Math.abs(oy)));
    const ch = height * (0.30 - k * 0.05) + 0.5;
    const zTop = top - k * height * 0.14 - 0.02;
    if (cw < 0.4 || cd < 0.4) continue;
    crownsIn.push(t([tx + ox, ty + oy, zTop - ch / 2], [cw, cd, ch]));
  }
});

// ---------------------------------------------------------------------------
// 境界外の防風林（太さ自由。map.boundsM x[-126,126] y[-92,92] の完全外側）
// ---------------------------------------------------------------------------
const OUT_MARGIN = 8.0;  // yaw 込みの樹冠最大半幅(4.5m)＋ジッタ＋房のずれより大きく取る

function boundaryTree(x, y, seedIndex) {
  const random = rng(0xf0a11a + seedIndex * 2654435761);
  const height = 5.4 + random() * 5.2;
  const trunkXY = 0.6 + random() * 0.34;
  trunksOut.push(t([x, y, height / 2], [trunkXY, trunkXY, height]));
  // 3段の樹冠。境界外は太さ自由なので、本数ではなく体積で緑を稼ぐ。
  // ただし yaw 込みの半幅が OUT_MARGIN(5.0m) を越えないよう cw+cd <= 9.0 に収める。
  for (let k = 0; k < 3; k++) {
    const cw = 4.2 + random() * 0.6 - k * 0.9;
    const cd = 3.6 + random() * 0.6 - k * 0.8;
    const ch = 3.2 + random() * 1.6 - k * 0.6;
    crownsOut.push(t(
      [x + (random() - 0.5) * 0.6, y + (random() - 0.5) * 0.6, height * (0.72 + k * 0.28) + ch / 2 - 1.0],
      [cw, cd, ch],
      [0, 0, random() * Math.PI],
    ));
  }
}

let outSeed = 0;
// 北・南の帯（内側の列が半径 60〜120m 帯を埋め、外側が 120m 超の密林になる）
for (const sign of [1, -1]) {
  for (let row = 0; row < 4; row++) {
    const y = sign * (92 + OUT_MARGIN + row * 11.5);
    for (let column = 0; column < 11; column++) {
      const jitter = rng(0xbeef + outSeed)();
      const x = -134 + column * 26.8 + (jitter - 0.5) * 9 + row * 5.5;
      boundaryTree(x, y + (jitter - 0.5) * 4.5, outSeed++);
    }
  }
}
// 東・西の帯（すべて半径 120m 超）
for (const sign of [1, -1]) {
  for (let column = 0; column < 3; column++) {
    const x = sign * (126 + OUT_MARGIN + column * 13.5);
    for (let row = 0; row < 9; row++) {
      const jitter = rng(0xcafe + outSeed)();
      const y = -84 + row * 21 + (jitter - 0.5) * 8;
      boundaryTree(x + (jitter - 0.5) * 3.0, y, outSeed++);
    }
  }
}

// ---------------------------------------------------------------------------
export const VEGETATION_LAYERS = [
  {
    id: 'veg-planter-rim',
    primitive: 'box',
    material: 'shellShade',
    semantics: 'clad-existing-solid',
    castShadow: true,
    receiveShadow: true,
    transforms: planters,
  },
  {
    id: 'veg-shrub',
    primitive: 'box',
    material: 'foliage',
    semantics: 'clad-existing-solid',
    castShadow: true,
    receiveShadow: true,
    transforms: shrubs,
  },
  {
    id: 'veg-undergrowth-mat',
    primitive: 'plane',
    material: 'foliage',
    semantics: 'clad-existing-solid',
    castShadow: false,
    receiveShadow: true,
    transforms: mats,
  },
  {
    id: 'veg-trunk-inner',
    primitive: 'cylinder',
    material: 'cedar',
    semantics: 'clad-existing-solid',
    castShadow: true,
    receiveShadow: true,
    transforms: trunksIn,
  },
  {
    id: 'veg-crown-inner',
    primitive: 'dodecaLow',
    material: 'foliageLight',
    semantics: 'clad-existing-solid',
    castShadow: true,
    receiveShadow: true,
    transforms: crownsIn,
  },
  {
    id: 'veg-boundary-trunk',
    primitive: 'cylinder',
    material: 'cedar',
    semantics: 'outside-playable-bounds',
    castShadow: true,
    receiveShadow: true,
    transforms: trunksOut,
  },
  {
    id: 'veg-boundary-crown',
    primitive: 'dodecaLow',
    material: 'foliageLight',
    semantics: 'outside-playable-bounds',
    castShadow: true,
    receiveShadow: true,
    transforms: crownsOut,
  },
];

export const VEGETATION_INSTANCE_COUNT = VEGETATION_LAYERS.reduce(
  (sum, layer) => sum + layer.transforms.length, 0,
);
