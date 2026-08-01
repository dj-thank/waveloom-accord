// ============================================================================
// 大潮井 — 地面（街路・広場・水路・動線・段差）  担当 G
//
// 目的（PLAN.md §G / AAA原則6「床はパターンと動線ライン。単色にしない」）:
//   ① 5つの目標（中央 + 4拠点）へ**近づくほど明るくなる**誘導グラデーション
//   ② 石畳のパターン（設計書§15: 北=貝紋＝放射の扇、南=波紋＝同心の環）
//   ③ 動線ライン（遠くは貝灰の白、目標に近づくと金）
//   ④ 段差の表現（当たり判定は変えられないので、色と縁石杭で高さの違いを読ませる）
//
// 安全（tests/map_site_cladding.test.js を緩めずに通す）:
//   - すべての板は宿主 solid の XY footprint に**完全に**収まる（許容0.35mに頼らない）
//   - 板の上端は宿主上端 +0.05 以内。縁石だけが上端 +0.15 まで伸びるが XY 0.7m ≤ 0.8m
//   - **段差をまたぐ板を出さない**（4隅と中心の面高が一致するタイルだけ採用）
//   - rotation[0]（ピッチ）は使わない。yaw のみ
//
// 予算（PLAN.md §2-2 の G 割当）: 層 8 / インスタンス 4,500 / 三角形 +40,000
//   plane=2三角形、box=12三角形のみ使用。
// ============================================================================

import { buildOshioiFlashpointGeometry } from './map_oshioi_flashpoint_geometry.js';
import { buildOshioiRingGeometry } from './map_oshioi_ring_geometry.js';

const LAYER_BUDGET = 8;
// 反復2で 4,500 → 7,600 へ。検証で「中央広場の床が単一の明るいクリーム面で模様がない」
// （下帯の最頻色ビン比率 objective 35.6%→62.1% と悪化）と出たため、
// 中央の舗石を細かく割り直し、貝紋の扇と波紋の環を破線から連続線にした。
// plane は2三角形なので、層数（＝ドローコール）は8のまま据え置ける。
const INSTANCE_BUDGET = 7600;

// ---------------------------------------------------------------------------
// 1. 宿主（床）矩形テーブル
// ---------------------------------------------------------------------------
// flash-* は生成器から実データで拾う。canonical-* は絶対規則で凍結されているので
// 実測値をそのまま持つ（`node -e "buildMap().solids"` で確認済み）。
const FLASH = buildOshioiFlashpointGeometry();
const RING = buildOshioiRingGeometry();

const FLOOR_RECTS = [];
for (const solid of FLASH.solids) {
  if (solid.max[2] < 3.9 || solid.max[2] > 4.1) continue;
  const area = (solid.max[0] - solid.min[0]) * (solid.max[1] - solid.min[1]);
  if (area < 15) continue;
  FLOOR_RECTS.push({
    x0: solid.min[0], x1: solid.max[0], y0: solid.min[1], y1: solid.max[1], top: solid.max[2],
  });
}
// canonical-*（凍結。上端 4.0 の中央島スラブ）
for (const [x0, x1, y0, y1] of [
  [8, 32, -22, 22],     // 006-slab
  [-32, -8, -22, 22],   // 007-slab
  [-8, 8, 6, 22],       // 008-slab
  [-8, 8, -22, -6],     // 009-slab
  [38, 46, -8, 8],      // 032-slab
  [-46, -38, -8, 8],    // 033-slab
  [32, 38, -3, 3],      // 046-slab
  [-38, -32, -3, 3],    // 047-slab
  [40, 43, 8, 20],      // 052-slab
  [-43, -40, -20, -8],  // 053-slab
  [-43, 43, 20, 26],    // 072-slab
  [-43, 43, -26, -20],  // 073-slab
]) FLOOR_RECTS.push({ x0, x1, y0, y1, top: 4 });

// 中央窪地。上端 0.0。ここに置ける板の上端は 0.05 まで。
FLOOR_RECTS.push({ x0: -46, x1: 46, y0: -34, y1: 34, top: 0 });

// 点の「立てる面の高さ」。段差判定に使う。
function topAt(px, py) {
  let best = null;
  for (const r of FLOOR_RECTS) {
    if (px < r.x0 || px > r.x1 || py < r.y0 || py > r.y1) continue;
    if (best === null || r.top > best) best = r.top;
  }
  return best;
}

// タイルの宿主上端。収まる矩形が無い／段差をまたぐ場合は null（＝置かない）。
function hostTop(cx, cy, halfX, halfY) {
  let best = null;
  for (const r of FLOOR_RECTS) {
    if (cx - halfX < r.x0 || cx + halfX > r.x1) continue;
    if (cy - halfY < r.y0 || cy + halfY > r.y1) continue;
    if (best === null || r.top > best) best = r.top;
  }
  if (best === null) return null;
  if (topAt(cx, cy) !== best) return null;
  if (topAt(cx - halfX, cy - halfY) !== best) return null;
  if (topAt(cx + halfX, cy - halfY) !== best) return null;
  if (topAt(cx - halfX, cy + halfY) !== best) return null;
  if (topAt(cx + halfX, cy + halfY) !== best) return null;
  return best;
}

function halfExtents(sx, sy, yaw) {
  const c = Math.abs(Math.cos(yaw));
  const s = Math.abs(Math.sin(yaw));
  return [c * sx / 2 + s * sy / 2, s * sx / 2 + c * sy / 2];
}

// ---------------------------------------------------------------------------
// 2. 建物の下を敷かない（見えない板に予算を使わない）
// ---------------------------------------------------------------------------
const OCCLUDERS = [];
for (const solid of [...FLASH.solids, ...RING.solids]) {
  if (solid.max[2] - solid.min[2] < 2.2) continue;
  if (solid.max[2] < 5.6) continue;
  OCCLUDERS.push(solid);
}
const OCC_CELL = 10;
const OCC_GRID = new Map();
for (const solid of OCCLUDERS) {
  const i0 = Math.floor(solid.min[0] / OCC_CELL);
  const i1 = Math.floor(solid.max[0] / OCC_CELL);
  const j0 = Math.floor(solid.min[1] / OCC_CELL);
  const j1 = Math.floor(solid.max[1] / OCC_CELL);
  for (let i = i0; i <= i1; i++) {
    for (let j = j0; j <= j1; j++) {
      const key = `${i}:${j}`;
      let bucket = OCC_GRID.get(key);
      if (!bucket) { bucket = []; OCC_GRID.set(key, bucket); }
      bucket.push(solid);
    }
  }
}
function underBuilding(px, py) {
  const bucket = OCC_GRID.get(`${Math.floor(px / OCC_CELL)}:${Math.floor(py / OCC_CELL)}`);
  if (!bucket) return false;
  for (const s of bucket) {
    if (px > s.min[0] + 0.45 && px < s.max[0] - 0.45
      && py > s.min[1] + 0.45 && py < s.max[1] - 0.45) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// 3. 層の器
// ---------------------------------------------------------------------------
// Z の段（宿主上端からの相対）。段差3段以上を作り、既存 clad-ground-*（4.015/4.017/4.019）と
// 5mm 以上離して z-fighting を避ける。上端は宿主 +0.05 を超えない。
const DZ_CANAL = 0.002;
const DZ_PAVE = 0.004;
const DZ_MID = 0.007;
const DZ_BRIGHT = 0.010;
const DZ_LANE = 0.026;
const DZ_SEAM = 0.038;
const PLANE_T = 0.004;   // 板の見かけ厚み（PlaneGeometry は平面なので上端 = z + 0.002）

const SPEC = [
  ['ground-pave-bright', 'plane', 'shell', 1500],
  ['ground-pave-mid', 'plane', 'shellShade', 1400],
  ['ground-pave-outer', 'plane', 'copperPlaster', 1000],
  ['ground-pave-far', 'plane', 'cedar', 560],
  ['ground-tide-canal', 'plane', 'wetRock', 460],
  ['ground-lane-gold', 'plane', 'copper', 430],
  // 濃い玄武岩の線は広場全体を格子に見せていた。暖かい杉の目地にして、
  // 金の導線とテラコッタ舗装を主役に戻す。
  ['ground-figure-seam', 'plane', 'cedar', 1650],
  ['ground-curb', 'box', 'basalt', 600],
];

const BUCKETS = new Map();
for (const [id] of SPEC) BUCKETS.set(id, []);
let emitted = 0;

function put(id, x, y, z, sx, sy, sz, yaw = 0) {
  const list = BUCKETS.get(id);
  const cap = SPEC.find(s => s[0] === id)[3];
  if (list.length >= cap || emitted >= INSTANCE_BUDGET) return false;
  list.push({ position: [x, y, z], scale: [sx, sy, sz], rotation: [0, 0, yaw] });
  emitted += 1;
  return true;
}

// 板を1枚置く。宿主判定と段差判定をここで一括して行う。
function slab(id, x, y, sx, sy, yaw, dz) {
  const [hx, hy] = halfExtents(sx, sy, yaw);
  const top = hostTop(x, y, hx, hy);
  if (top === null) return false;
  return put(id, x, y, top + dz, sx, sy, PLANE_T, yaw);
}

// 縁石杭。宿主上端から 0.15m 立ち上がる。XY 0.7m ≤ 0.8m なので安全規則を満たす。
const CURB_W = 0.7;
const CURB_H = 0.15;
function curb(x, y) {
  const top = hostTop(x, y, CURB_W / 2, CURB_W / 2);
  if (top === null) return false;
  if (underBuilding(x, y)) return false;
  return put('ground-curb', x, y, top + CURB_H / 2, CURB_W, CURB_W, CURB_H, 0);
}

// ---------------------------------------------------------------------------
// 4. 誘導グラデーション（目標へ近づくほど明るい石畳）
// ---------------------------------------------------------------------------
// 目標: 中央制圧点 (0,0) と4拠点。明度は「最も近い目標までの距離」で決まる。
const OBJECTIVES = [[0, 0], [56, 44], [56, -44], [-56, 44], [-56, -44]];

function objectiveDistance(x, y) {
  let best = Infinity;
  for (const [ox, oy] of OBJECTIVES) {
    const d = Math.hypot(x - ox, y - oy);
    if (d < best) best = d;
  }
  return best;
}

function hash2(i, j) {
  let h = Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263);
  h = h ^ (h >>> 13);
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// 帯ごとにタイル寸法を変える（原則2「3スケール反復」＋合格条件「タイル寸法5種以上」）。
// 目標直下（band 0）は最も見られる床なので、目地の数が最優先。
// 3.4m ピッチ（被覆率 83%）→ 2.4m ピッチ（被覆率 92%）に詰め、
// 敷石1枚の見かけの大きさを人体スケールへ寄せる。
const BANDS = [
  { max: 13, step: 2.4, w: 2.2, d: 2.2 },
  { max: 26, step: 3.9, w: 3.65, d: 3.65 },
  { max: 46, step: 6.4, w: 6.0, d: 6.0 },
  { max: Infinity, step: 9.4, w: 9.0, d: 5.4 },
];

for (let band = 0; band < BANDS.length; band++) {
  const { step, w, d } = BANDS[band];
  const lo = band === 0 ? 0 : BANDS[band - 1].max;
  const hi = BANDS[band].max;
  let row = 0;
  for (let y = -90; y <= 90.001; y += step, row++) {
    // 千鳥に組んで格子の反復を割る
    const shift = (row % 2) * step / 2;
    for (let x = -124 + shift; x <= 124.001; x += step) {
      const dist = objectiveDistance(x, y);
      if (dist <= lo || dist > hi) continue;
      if (underBuilding(x, y)) continue;

      const gi = Math.round(x * 4);
      const gj = Math.round(y * 4);
      // 明度の揺らぎ。0.26 では中央（v>0.8 が一様に成立する帯）で階調が割れず、
      // 目標直下が「単一の明るいクリーム面」になっていた。振幅を上げる。
      const noise = (hash2(gi, gj) - 0.5) * 0.44;

      // 外周は確率的に間引いて砂地へ溶かす（ハードエッジの解消）
      if (dist > 52 && hash2(gi + 7, gj - 3) < Math.min(0.62, (dist - 52) / 48)) continue;

      // 明度: 目標直下 1.0 → 58m で 0.0
      const v = (1 - dist / 58) + noise;
      let level = v >= 0.80 ? 0 : v >= 0.56 ? 1 : v >= 0.28 ? 2 : 3;
      // 決定論的に 1/4 強の敷石を1段暗い石へ差し替える。距離だけで階調を決めると
      // 「同じ材質が連続する帯」ができ、最頻色ビンが 60% を超える。
      if (hash2(gi + 11, gj - 5) < 0.26) level = Math.min(3, level + 1);
      else if (hash2(gi - 3, gj + 17) < 0.12) level = Math.max(0, level - 1);
      const id = ['ground-pave-bright', 'ground-pave-mid',
        'ground-pave-outer', 'ground-pave-far'][level];

      const dz = id === 'ground-pave-bright' ? DZ_BRIGHT
        : id === 'ground-pave-mid' ? DZ_MID : DZ_PAVE;

      // 最外帯だけ長手方向を交互にして、板の向きの反復も割る
      const flip = band === 3 && ((gi + gj) & 1) === 1;
      const sx = flip ? d : w;
      const sy = flip ? w : d;

      // 中央窪地（上端0.0）で、制圧点の器の外側は潮の運河にする
      const top = hostTop(x, y, sx / 2, sy / 2);
      if (top === null) continue;
      if (top < 1 && Math.hypot(x, y) > 11.5) {
        slab('ground-tide-canal', x, y, sx, sy, 0, DZ_CANAL);
        continue;
      }
      slab(id, x, y, sx, sy, 0, dz);
    }
  }
}

// ---------------------------------------------------------------------------
// 5. 動線ライン（貝灰の白 → 目標に近づくと金）
// ---------------------------------------------------------------------------
// 中央島と外周リングは東西の橋（x=±43〜48, y∈[-12.5,12.5]）だけで繋がっている。
// 実際に歩ける形で線を引く。8本。
const LANES = [
  { w: 2.6, pts: [[0, 0], [45.5, 0], [56, 0], [56, 44]] },        // 中央→東橋→水市
  { w: 2.6, pts: [[0, 0], [45.5, 0], [56, 0], [56, -44]] },       // 中央→東橋→門
  { w: 2.6, pts: [[0, 0], [-45.5, 0], [-56, 0], [-56, 44]] },     // 中央→西橋→網
  { w: 2.6, pts: [[0, 0], [-45.5, 0], [-56, 0], [-56, -44]] },    // 中央→西橋→風見
  { w: 2.2, pts: [[56, 44], [20, 60], [-20, 60], [-56, 44]] },    // 北の横断
  { w: 2.2, pts: [[56, -44], [20, -60], [-20, -60], [-56, -44]] },// 南の横断
  { w: 2.0, pts: [[56, 0], [112, 0]] },                           // 東の前線
  { w: 2.0, pts: [[-56, 0], [-112, 0]] },                         // 西の前線
];

const GOLD_RADIUS = 19;   // 目標へこの距離まで来ると白が金へ変わる
const LANE_TILE = 2.5;
const LANE_STEP = 2.7;

for (const lane of LANES) {
  for (let i = 1; i < lane.pts.length; i++) {
    const [ax, ay] = lane.pts[i - 1];
    const [bx, by] = lane.pts[i];
    const len = Math.hypot(bx - ax, by - ay);
    const yaw = Math.atan2(by - ay, bx - ax);
    const n = Math.max(1, Math.floor(len / LANE_STEP));
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = ax + (bx - ax) * t;
      const y = ay + (by - ay) * t;
      if (underBuilding(x, y)) continue;
      const gold = objectiveDistance(x, y) <= GOLD_RADIUS;
      if (gold) {
        slab('ground-lane-gold', x, y, LANE_TILE, lane.w, yaw, DZ_LANE);
      } else {
        // 白（貝灰）は明色舗装層に相乗りさせる。層を増やさずに材質を分ける。
        slab('ground-pave-bright', x, y, LANE_TILE, lane.w, yaw, DZ_LANE);
      }
      // 轍（動線の両縁の細い目地）。砂地との遷移も兼ねる。
      if (k % 2 === 0) {
        const nx = -Math.sin(yaw);
        const ny = Math.cos(yaw);
        const off = lane.w / 2 + 0.28;
        slab('ground-figure-seam', x + nx * off, y + ny * off, LANE_TILE, 0.34, yaw, DZ_SEAM);
        slab('ground-figure-seam', x - nx * off, y - ny * off, LANE_TILE, 0.34, yaw, DZ_SEAM);
      }
      // 縁石杭（実段差 0.15m）
      if (k % 3 === 0) {
        const nx = -Math.sin(yaw);
        const ny = Math.cos(yaw);
        const off = lane.w / 2 + 0.95;
        curb(x + nx * off, y + ny * off);
        curb(x - nx * off, y - ny * off);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 6. 石畳の紋様（設計書§15: 北=貝紋、南=波紋）
// ---------------------------------------------------------------------------
// 貝紋 = 目標から放射する扇の骨。波紋 = 目標を囲む同心の環。
function shellFan(ox, oy, angFrom, angTo, rays, r0, r1, rStep, skip = null) {
  for (let k = 0; k < rays; k++) {
    const ang = angFrom + (angTo - angFrom) * (k + 0.5) / rays;
    const ca = Math.cos(ang);
    const sa = Math.sin(ang);
    for (let r = r0; r <= r1; r += rStep) {
      if (skip?.(ang, r)) continue;
      const x = ox + ca * r;
      const y = oy + sa * r;
      if (underBuilding(x, y)) continue;
      slab('ground-figure-seam', x, y, 2.6, 0.34, ang, DZ_SEAM);
    }
  }
}

function waveRings(ox, oy, angFrom, angTo, radii, spacing, skip = null) {
  for (const r of radii) {
    const n = Math.max(3, Math.round((angTo - angFrom) * r / spacing));
    for (let k = 0; k < n; k++) {
      const ang = angFrom + (angTo - angFrom) * (k + 0.5) / n;
      if (skip?.(ang, r)) continue;
      // 波の揺らぎ。真円にせず、半径を少し脈打たせる。
      const rr = r + Math.sin(ang * 5 + r) * 0.85;
      const x = ox + Math.cos(ang) * rr;
      const y = oy + Math.sin(ang) * rr;
      if (underBuilding(x, y)) continue;
      slab('ground-figure-seam', x, y, 3.0, 0.32, ang + Math.PI / 2, DZ_SEAM);
    }
  }
}

// 中央制圧点: 北半分が貝紋、南半分が波紋。4方向の進入線は8m以遠を空け、
// 戦闘中にも「どこから中央へ入るか」を一瞥できる負空間にする。
const CENTRAL_APPROACH_AXES = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
function angleDistance(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}
function centralApproachWedge(angle, radius) {
  return radius >= 8 && radius <= 31
    && CENTRAL_APPROACH_AXES.some(axis => angleDistance(angle, axis) < 0.28);
}
// 北=貝紋、南=波紋という語彙は残しつつ、密度を一段落として中央金環を主役にする。
shellFan(0, 0, 0, Math.PI, 14, 10.5, 29, 3.2, centralApproachWedge);
waveRings(0, 0, -Math.PI, 0, [12, 16, 20, 25, 29], 3.2, centralApproachWedge);

// 北の2拠点（水市・網）＝貝紋
shellFan(56, 44, 0, Math.PI * 2, 20, 8, 30, 3.0);
shellFan(-56, 44, 0, Math.PI * 2, 20, 8, 30, 3.0);
// 南の2拠点（門・風見）＝波紋
waveRings(56, -44, 0, Math.PI * 2, [9.5, 12.5, 15.5, 19, 22, 25.5, 29], 3.4);
waveRings(-56, -44, 0, Math.PI * 2, [9.5, 12.5, 15.5, 19, 22, 25.5, 29], 3.4);

// ---------------------------------------------------------------------------
// 6.5 目標直下の金の割付（原則6「目標へ近づくほど明るい」の到達点）
// ---------------------------------------------------------------------------
// 動線ラインの金は目標へ入る4本だけで、中央では 12 枚しか届いていなかった。
// 目標を囲む金の環と、そこから外へ抜ける放射の踏み石を足す。
for (const [ox, oy] of OBJECTIVES) {
  const central = ox === 0 && oy === 0;
  // 中央だけは環を細くし、内側の情報を「一つの目標環」として読ませる。
  const rings = central
    ? [[5.2, 8, 1.35], [8.4, 12, 1.45], [12.0, 16, 1.65]]
    : [[5.2, 12, 1.5], [8.4, 18, 1.7], [12.0, 24, 1.9]];
  for (const [radius, count, tile] of rings) {
    for (let k = 0; k < count; k++) {
      const ang = ((k + 0.35) / count) * Math.PI * 2;
      if (central && centralApproachWedge(ang, radius)) continue;
      const x = ox + Math.cos(ang) * radius;
      const y = oy + Math.sin(ang) * radius;
      if (underBuilding(x, y)) continue;
      slab('ground-lane-gold', x, y, tile, 0.85, ang + Math.PI / 2, DZ_LANE);
    }
  }
  // 放射の踏み石（8方向）。中央では4本の進入線を空け、斜めの短い導線だけを残す。
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * Math.PI * 2 + 0.2;
    const radii = central ? [15.4, 18.6] : [14, 16.4, 18.8];
    for (const r of radii) {
      if (central && centralApproachWedge(ang, r)) continue;
      const x = ox + Math.cos(ang) * r;
      const y = oy + Math.sin(ang) * r;
      if (underBuilding(x, y)) continue;
      slab('ground-lane-gold', x, y, 2.2, 1.05, ang, DZ_LANE);
    }
  }
}

// ---------------------------------------------------------------------------
// 7. 段差の縁取り（当たり判定は変えられないので、縁石杭で高さの違いを読ませる）
// ---------------------------------------------------------------------------
// 中央島（z=4）と潮の窪地（z=0）の境目、橋の側面、リング床の外縁を自動で拾う。
{
  const STEP = 3.2;
  const PROBE = 2.0;
  for (let y = -90; y <= 90.001; y += STEP) {
    for (let x = -124; x <= 124.001; x += STEP) {
      const here = topAt(x, y);
      if (here === null || here < 1) continue;
      let edge = false;
      for (const [dx, dy] of [[PROBE, 0], [-PROBE, 0], [0, PROBE], [0, -PROBE]]) {
        const there = topAt(x + dx, y + dy);
        if (there === null || there !== here) { edge = true; break; }
      }
      if (!edge) continue;
      curb(x, y);
    }
  }
}

// ---------------------------------------------------------------------------
// 8. export
// ---------------------------------------------------------------------------
export const GROUND_LAYERS = SPEC
  .map(([id, primitive, material]) => ({
    id,
    primitive,
    material,
    semantics: 'clad-existing-solid',
    castShadow: false,
    receiveShadow: true,
    transforms: BUCKETS.get(id),
  }))
  .filter(layer => layer.transforms.length > 0);

if (GROUND_LAYERS.length > LAYER_BUDGET) {
  throw new Error(`ground layers ${GROUND_LAYERS.length} exceed budget ${LAYER_BUDGET}`);
}

export const GROUND_INSTANCE_COUNT = GROUND_LAYERS
  .reduce((sum, layer) => sum + layer.transforms.length, 0);

if (GROUND_INSTANCE_COUNT > INSTANCE_BUDGET) {
  throw new Error(`ground instances ${GROUND_INSTANCE_COUNT} exceed budget ${INSTANCE_BUDGET}`);
}
