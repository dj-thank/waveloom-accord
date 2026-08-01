// 大潮井 移動リング — 港湾街区の当たり判定（競技構造の担当）。
//
// この版で解いた「不成立」（競技監査の指摘）:
//   ① 進入経路3本 … 既存30本の経路ポリラインを 1本も塞がない。判定は「中心＋固定余裕」ではなく
//      置く箱の実 AABB と経路線分の厳密距離で行う（中心判定だと大型棟が経路へ食い込み、実際に2度塞いだ）。
//   ② 高所への2方向登り … 桟橋台は東西南北4方向を試し、2方向以上が通る場所にしか置かない。
//      台上には頭上2.6mの立入禁止体積（phantom）を先に確保し、後から倉庫が頭上を塞げないようにする。
//   ③ 遮蔽間隔 6〜9m … 遮蔽は経路の「外」ではなく経路沿い 3.4〜5.8m の帯に 7.0m 間隔で置く。
//      CLEARANCE_M は質量（倉庫）にだけ適用し、遮蔽には適用しない。
//   ④ 意図せず登れる／飛べる … 遮蔽の高さは 1.30 / 1.70〜2.15 / 2.25〜2.90 の3段。
//      床(4.0)からジャンプ到達 1.1136m では 4+1.1136=5.1136 までしか届かず、最低の遮蔽上端は 5.30。
//      縁石(上端4.12)・排水溝(上端4.10)から半身遮蔽へは 1.18m / 1.20m で、いずれも到達不能。
//      さらに「上端が (新箱上端 − 1.1136) 〜 新箱上端 に入る既存面」が水平3.6m以内にあれば棄却する。
//   ⑤ 街路のグリッド … 街区を格子で置き、列ごとに半ピッチずらし（jog）、交差点に塞ぎ棟（gate）を
//      入れて 100m 級の直線射線を分割する。
//   ⑥ 貫入 … push は必ず重なり判定を通す。優先度は 灯柱＞踏み段＞桟橋台＞階段＞倉庫＞遮蔽＞縁石。
//      先に置いたものが勝つ（後から来たものを棄却する）ので結果は決定論的。
//
// 他担当への出力（PLAN.md §K-6 / §K-7）:
//   `ring-beacon-*`  … L（ランドマーク）の被覆宿主。上端 24m（中央）/ 15m（4拠点）。
//   `ring-curb-*` `ring-gutter-*` … G（地面）の被覆宿主。上端 4.12 / 4.10。
//   `ring-store-*` `ring-crate-*` `ring-deck-*` `ring-deckstair-*` … B の被覆宿主（id 前置を維持）。
//
// 寸法は combat.json 由来の不変量に従う:
//   ジャンプ到達 1.1136m / 最大水平飛距離 3.50m / 階段1段 0.55m 以下 /
//   半身遮蔽 1.20〜1.30m / 全身遮蔽 2.20m 以上 / 禁止帯 1.05〜1.20m・3.0〜4.0m

import { buildOshioiFlashpointGeometry } from './map_oshioi_flashpoint_geometry.js';

const RING_FLOOR_Z = 4;
const CLEARANCE_M = 4.2;       // 質量（倉庫・灯柱・目隠し）が経路線分から空ける距離
const COVER_CLEARANCE_M = 2.0; // 遮蔽が経路線分から空ける距離（判定円柱 0.4 + 余裕 1.6）
const TRIM_CLEARANCE_M = 1.1;  // 縁石が経路線分から空ける距離（低いので歩行は妨げない）
const SITE_KEEPOUT_M = 17;     // 拠点中心から空ける距離
const JUMP_REACH_M = 1.1136;   // combat.json 由来
const BOOST_RADIUS_M = 3.6;    // 助走して乗り移れる水平距離
const PROP_SPACING_M = 5.2;    // 遮蔽同士の中心間距離（3.6m 規則より厳しい側で固定）
const CORE_X = 48;             // legacy コア（canonical-*）には一切入らない
const CORE_Y = 36;

// リング床（拠点コアとスポーン室を除いた実際に空いている帯）
const RING_BANDS = [
  { id: 'east', x: [52, 118], y: [-86, 86], ox: 1, oy: 2, seed: 0x11 },
  { id: 'west', x: [-118, -52], y: [-86, 86], ox: 12, oy: 9, seed: 0x27 },
  { id: 'north', x: [-40, 40], y: [40, 86], ox: 6, oy: 3, seed: 0x3d },
  { id: 'south', x: [-40, 40], y: [-86, -40], ox: 17, oy: 12, seed: 0x53 },
];

const BLOCK_PITCH_X = 23;
const BLOCK_PITCH_Y = 21;
const BLOCK_W = 14;
const BLOCK_D = 13;

// 遮蔽の寸法表。30種すべて相異なる（原則2「3スケール反復」/ 寸法25種以上）。
// 高さは 3.0〜4.0m と 1.05〜1.20m の禁止帯を避ける。半身は 1.30 固定で
// 縁石(0.12)からのジャンプ到達 1.1136m を 0.066m 上回らせる。
const COVER_KINDS = [
  // 半身遮蔽（屈めば安全・立てば撃てる・登れない）
  { w: 1.25, d: 1.25, h: 1.30 }, { w: 1.50, d: 1.20, h: 1.30 },
  { w: 1.20, d: 1.70, h: 1.30 }, { w: 1.40, d: 1.40, h: 1.30 },
  { w: 1.80, d: 1.10, h: 1.30 }, { w: 1.10, d: 2.00, h: 1.30 },
  { w: 1.60, d: 1.35, h: 1.30 }, { w: 1.35, d: 1.60, h: 1.30 },
  { w: 2.10, d: 1.20, h: 1.30 }, { w: 1.20, d: 2.10, h: 1.30 },
  // 中（腰から胸。射線を割るが乗れない）
  { w: 2.20, d: 2.20, h: 1.80 }, { w: 2.60, d: 1.80, h: 1.95 },
  { w: 1.80, d: 2.60, h: 1.70 }, { w: 2.40, d: 2.40, h: 2.10 },
  { w: 3.00, d: 1.90, h: 1.85 }, { w: 1.90, d: 3.00, h: 2.05 },
  { w: 2.80, d: 2.20, h: 1.75 }, { w: 2.20, d: 2.80, h: 2.00 },
  { w: 2.00, d: 2.00, h: 2.15 }, { w: 3.20, d: 1.70, h: 1.90 },
  // 大（全身遮蔽。レーンの区切り）
  { w: 3.40, d: 2.20, h: 2.40 }, { w: 2.20, d: 3.40, h: 2.55 },
  { w: 4.00, d: 2.40, h: 2.30 }, { w: 2.40, d: 4.00, h: 2.70 },
  { w: 3.00, d: 3.00, h: 2.85 }, { w: 3.60, d: 2.00, h: 2.45 },
  { w: 2.00, d: 3.60, h: 2.60 }, { w: 4.40, d: 2.20, h: 2.25 },
  { w: 2.60, d: 2.60, h: 2.90 }, { w: 3.80, d: 2.80, h: 2.75 },
];
const HALF_KINDS = 10;
const MEDIUM_KINDS = 20;
// 経路沿いの並べ方。半身を主とし、中と大で区切る。
const COVER_PATTERN = [0, 0, 1, 0, 2, 1, 0, 0, 2, 1, 0, 1];

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq > 1e-9
    ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq))
    : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function pointRectDistance(px, py, x0, y0, x1, y1) {
  const dx = Math.max(x0 - px, 0, px - x1);
  const dy = Math.max(y0 - py, 0, py - y1);
  return Math.hypot(dx, dy);
}

// 線分と矩形の厳密な最短距離（XY）。交差していれば 0。
// 凸図形同士なので「一方の頂点と他方の辺」で最小が取れる。
function segmentRectDistance(ax, ay, bx, by, x0, y0, x1, y1) {
  let best = Math.min(
    pointRectDistance(ax, ay, x0, y0, x1, y1),
    pointRectDistance(bx, by, x0, y0, x1, y1),
  );
  if (best === 0) return 0;
  best = Math.min(best,
    distanceToSegment(x0, y0, ax, ay, bx, by),
    distanceToSegment(x1, y0, ax, ay, bx, by),
    distanceToSegment(x1, y1, ax, ay, bx, by),
    distanceToSegment(x0, y1, ax, ay, bx, by));
  return best;
}

// 決定論的な擬似乱数（Math.random は使わない。ビルドの再現性を壊すため）
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function hash2(a, b, salt) {
  let h = (Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x27d4, 0xc2b2ae35) ^ salt) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h, 0x2545f491) >>> 0;
  return (h ^ (h >>> 13)) >>> 0;
}

// ---------------------------------------------------------------------------
// 経路線分の空間格子。1候補あたり全線分を舐めると placement が O(候補×線分) になる。
// ---------------------------------------------------------------------------
const GRID_CELL = 14;

function buildSegmentIndex(segments) {
  const cells = new Map();
  segments.forEach((segment, index) => {
    const [ax, ay, bx, by] = segment;
    const cx0 = Math.floor(Math.min(ax, bx) / GRID_CELL);
    const cx1 = Math.floor(Math.max(ax, bx) / GRID_CELL);
    const cy0 = Math.floor(Math.min(ay, by) / GRID_CELL);
    const cy1 = Math.floor(Math.max(ay, by) / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const key = cx * 4096 + cy;
        let bucket = cells.get(key);
        if (!bucket) cells.set(key, (bucket = []));
        bucket.push(index);
      }
    }
  });
  return cells;
}

function collectRoutes(runtime) {
  const routes = [];
  // 通常経路だけでなく高台経路も避ける。ここを落とすと mizuichi-high-x のような
  // 高所への登り口を塞いでしまう（実際に一度塞いだ）。
  for (const source of [runtime.routesBySite, runtime.highGroundRoutesBySite]) {
    for (const sides of Object.values(source || {})) {
      for (const lanes of Object.values(sides || {})) {
        for (const route of Object.values(lanes || {})) {
          const points = Array.isArray(route) ? route : route?.points;
          if (Array.isArray(points) && points.length >= 2) {
            routes.push({ id: route?.id || 'route', points });
          }
        }
      }
    }
  }
  return routes;
}

export function buildOshioiRingGeometry() {
  const runtime = buildOshioiFlashpointGeometry();
  const routes = collectRoutes(runtime);
  const segments = [];
  for (const route of routes) {
    for (let i = 1; i < route.points.length; i++) {
      segments.push([
        route.points[i - 1][0], route.points[i - 1][1],
        route.points[i][0], route.points[i][1],
      ]);
    }
  }
  const segmentCells = buildSegmentIndex(segments);
  const siteCenters = (runtime.sites || []).map(site => site.center || [0, 0, 0]);
  const spawnRooms = Object.values(runtime.spawnRooms || {});
  const solids = [];

  // 重なり判定の母集団。flash-* を種として入れておくことで、
  // 街区が既存の拠点建築・スポーン室・桟橋へ食い込むことを構造的に防ぐ。
  const blockers = runtime.solids.map(solid => ({
    min: [...solid.min], max: [...solid.max], solid: true,
  }));
  // flash 側の高所（拠点 high-platform と階段）の頭上も確保する。
  for (const solid of runtime.solids) {
    if (!/-(high-platform|stair-[xy]-\d+)$/.test(solid.id)) continue;
    blockers.push({
      min: [solid.min[0], solid.min[1], solid.max[2]],
      max: [solid.max[0], solid.max[1], solid.max[2] + 2.6],
      solid: false,
    });
  }

  const routeClear = (x0, y0, x1, y1, need) => {
    const cx0 = Math.floor((x0 - need) / GRID_CELL);
    const cx1 = Math.floor((x1 + need) / GRID_CELL);
    const cy0 = Math.floor((y0 - need) / GRID_CELL);
    const cy1 = Math.floor((y1 + need) / GRID_CELL);
    for (let cx = cx0; cx <= cx1; cx++) {
      for (let cy = cy0; cy <= cy1; cy++) {
        const bucket = segmentCells.get(cx * 4096 + cy);
        if (!bucket) continue;
        for (const index of bucket) {
          const [ax, ay, bx, by] = segments[index];
          if (segmentRectDistance(ax, ay, bx, by, x0, y0, x1, y1) < need) return false;
        }
      }
    }
    return true;
  };

  const insideCore = (x0, y0, x1, y1) => x0 < CORE_X && x1 > -CORE_X && y0 < CORE_Y && y1 > -CORE_Y;

  const nearSite = (x0, y0, x1, y1, keepout = SITE_KEEPOUT_M) => siteCenters
    .some(([cx, cy]) => pointRectDistance(cx, cy, x0, y0, x1, y1) < keepout);

  const inSpawnRoom = (x0, y0, x1, y1) => spawnRooms.some(room => {
    const [rx0, rx1] = room.bounds.x;
    const [ry0, ry1] = room.bounds.y;
    return x0 < rx1 + 6 && x1 > rx0 - 6 && y0 < ry1 + 6 && y1 > ry0 - 6;
  });

  const overlaps = (min, max, pad) => blockers.some(other => (
    min[0] < other.max[0] + pad && max[0] > other.min[0] - pad
    && min[1] < other.max[1] + pad && max[1] > other.min[1] - pad
    && min[2] < other.max[2] && max[2] > other.min[2]
  ));

  // 「意図せず登れる」を構造的に禁止する。新しい箱の上端 T に対し、
  // 上端が (T − 1.1136, T) に入る既存の実体面が水平 3.6m 以内にあれば棄却する。
  const boostable = (min, max) => {
    const top = max[2];
    const low = top - JUMP_REACH_M;
    return blockers.some(other => {
      if (!other.solid) return false;
      if (other.max[2] <= low || other.max[2] >= top) return false;
      return pointRectDistance(0, 0,
        Math.max(min[0] - other.max[0], other.min[0] - max[0], 0) * 0 + 0, 0, 0, 0) === 0
        && Math.hypot(
          Math.max(min[0] - other.max[0], other.min[0] - max[0], 0),
          Math.max(min[1] - other.max[1], other.min[1] - max[1], 0),
        ) < BOOST_RADIUS_M;
    });
  };

  const push = (id, min, max, tag) => {
    solids.push({ id: `ring-${id}`, kind: 'box', min, max, tag });
    blockers.push({ min: [...min], max: [...max], solid: true });
  };

  const reserve = (min, max) => {
    blockers.push({ min: [...min], max: [...max], solid: false });
  };

  // -------------------------------------------------------------------------
  // 1. kado-west の +62% 迂回を解消する踏み段（K-3）
  //    直線 (20,-62)→(50,-62) が flash-site-kado-stair-y-01/02（上端 5.0/5.5）を貫通し、
  //    段差 1.0m > stepUpM 0.55 で通れなかった。経路の上に 0.5m 刻みの段を敷いて越えさせる。
  //    y 範囲は階段と同じ [-63.4,-61.0]。front レーン(y=-64)の判定円柱 y≥-64.4 とは 0.6m 空く。
  // -------------------------------------------------------------------------
  const KADO_TREADS = [
    ['w0', 38.4, 39.4, 4.5], ['w1', 39.4, 40.4, 5.0], ['w2', 40.4, 41.4, 5.5],
    ['e0', 43.2, 44.2, 5.5], ['e1', 44.2, 45.2, 5.0], ['e2', 45.2, 46.2, 4.5],
  ];
  for (const [name, x0, x1, top] of KADO_TREADS) {
    push(`tread-kado-${name}`, [x0, -63.4, RING_FLOOR_Z], [x1, -61.0, top], 'stair');
  }

  // -------------------------------------------------------------------------
  // 1.5 灯籠櫓の反対側の階段（設計不変条件「各高所に2方向以上の登り」）
  //
  //   canonical-144〜153-stair は北櫓が東側（x=+3〜7）、南櫓が西側だけで、
  //   幾何的な登り口が1方向しか無かった。にもかかわらず
  //   map_oshioi_flashpoint.js の highGrounds[].counterRoutes は
  //   ['east-stair','west-stair'] と2本を宣言しており、データと幾何が食い違っていた。
  //   canonical-* は変更禁止なので、ここで宣言どおりの2本目を足す。
  //
  //   北櫓の西面には欄干 canonical(-3〜-2.7, z8〜9) が立っているので、
  //   階段は天端 8.0 ではなく欄干天端 9.0 へ着け、内側に 1.4 x 2.4m の踊り場を作る。
  //   踊り場 9.0 と櫓天端 8.0 の段差は 1.00m＝ジャンプ到達 1.1136m の内側、
  //   かつ禁止寸法帯 1.05〜1.20m の外側なので「登れるか登れないか」が一意に読める。
  const KILN_STAIR_STEPS = 10;
  for (const mirror of [1, -1]) {
    for (let step = 0; step < KILN_STAIR_STEPS; step++) {
      const x0 = -8 + step * 0.5;
      const top = RING_FLOOR_Z + ((step + 1) / KILN_STAIR_STEPS) * 5.0;
      push(`kilnstair-${mirror > 0 ? 'north-west' : 'south-east'}-${step}`,
        [mirror > 0 ? x0 : -(x0 + 0.5), mirror > 0 ? 11.8 : -14.2, RING_FLOOR_Z],
        [mirror > 0 ? x0 + 0.5 : -x0, mirror > 0 ? 14.2 : -11.8, top],
        'stair');
    }
    push(`kilnlanding-${mirror > 0 ? 'north' : 'south'}`,
      [mirror > 0 ? -3.0 : 1.6, mirror > 0 ? 11.8 : -14.2, 8.0],
      [mirror > 0 ? -1.6 : 3.0, mirror > 0 ? 14.2 : -11.8, 9.0],
      'rim');
  }

  // -------------------------------------------------------------------------
  // 2. ランドマークの土台（K-6）。L がこの footprint の中だけを被覆できる。
  // -------------------------------------------------------------------------
  const BEACONS = [
    { id: 'core', x: 0, y: 62, half: 4.0, top: 24.0 },
    { id: 'mizuichi', x: 42, y: 58, half: 3.0, top: 15.0 },
    { id: 'kado', x: 70, y: -30, half: 3.0, top: 15.0 },
    { id: 'ami', x: -42, y: 58, half: 3.0, top: 15.0 },
    { id: 'kazami', x: -70, y: -58, half: 3.0, top: 15.0 },
  ];
  const beaconPlaced = [];
  for (const beacon of BEACONS) {
    // 指定位置が経路に掛かる場合は同心の候補環へ逃がす。座標は L へ報告する。
    let placed = false;
    for (let ring = 0; ring < 5 && !placed; ring++) {
      for (let step = 0; step < 12 && !placed; step++) {
        const angle = (step / 12) * Math.PI * 2;
        const radius = ring * 5;
        const cx = beacon.x + Math.cos(angle) * radius;
        const cy = beacon.y + Math.sin(angle) * radius;
        const min = [cx - beacon.half, cy - beacon.half, RING_FLOOR_Z];
        const max = [cx + beacon.half, cy + beacon.half, beacon.top];
        if (insideCore(min[0], min[1], max[0], max[1])) continue;
        if (nearSite(min[0], min[1], max[0], max[1])) continue;
        if (inSpawnRoom(min[0], min[1], max[0], max[1])) continue;
        if (!routeClear(min[0], min[1], max[0], max[1], CLEARANCE_M)) continue;
        if (overlaps(min, max, 1.0)) continue;
        push(`beacon-${beacon.id}`, min, max, 'tower');
        beaconPlaced.push({ id: beacon.id, center: [cx, cy], half: beacon.half, top: beacon.top });
        placed = true;
      }
    }
  }

  // -------------------------------------------------------------------------
  // 3. スポーン射線を切る目隠し（K-4）。拠点中心（眼高 5.6）から敵スポーン出口が
  //    見えている線の上に高さ 7〜9m の質量を置く。置いた後に同じ判定で再測する。
  // -------------------------------------------------------------------------
  const raycastBlocked = (ax, ay, az, bx, by, bz) => {
    const dx = bx - ax;
    const dy = by - ay;
    const dz = bz - az;
    for (const other of blockers) {
      if (!other.solid) continue;
      let t0 = 0;
      let t1 = 1;
      let hit = true;
      for (let axis = 0; axis < 3 && hit; axis++) {
        const origin = axis === 0 ? ax : axis === 1 ? ay : az;
        const delta = axis === 0 ? dx : axis === 1 ? dy : dz;
        const lo = other.min[axis];
        const hi = other.max[axis];
        if (Math.abs(delta) < 1e-9) {
          if (origin < lo || origin > hi) hit = false;
        } else {
          let n = (lo - origin) / delta;
          let f = (hi - origin) / delta;
          if (n > f) { const tmp = n; n = f; f = tmp; }
          if (n > t0) t0 = n;
          if (f < t1) t1 = f;
          if (t0 > t1) hit = false;
        }
      }
      if (hit) return true;
    }
    return false;
  };

  const spawnSightLines = () => {
    const lines = [];
    for (const site of runtime.sites || []) {
      if (site.id === 'shiogama') continue;
      const [cx, cy, cz] = site.center;
      for (const [side, spawn] of Object.entries(runtime.spawnsBySite?.[site.id] || {})) {
        // 敵側 = その拠点へ向かうもう一方の陣営の出口
        const enemy = runtime.spawnsBySite[site.id][side === 'east' ? 'west' : 'east'];
        void spawn;
        for (const exit of Object.values(enemy.exitsByLane || {})) {
          if (raycastBlocked(cx, cy, cz + 1.6, exit[0], exit[1], exit[2] + 1.6)) continue;
          lines.push({ site: site.id, from: [cx, cy, cz + 1.6], to: [exit[0], exit[1], exit[2] + 1.6] });
        }
      }
    }
    return lines;
  };

  let baffleIndex = 0;
  for (let pass = 0; pass < 4; pass++) {
    const open = spawnSightLines();
    if (!open.length) break;
    let placedAny = false;
    for (const line of open) {
      if (!raycastBlocked(...line.from, ...line.to)) continue;
      const dx = line.to[0] - line.from[0];
      const dy = line.to[1] - line.from[1];
      let done = false;
      for (let step = 0; step <= 16 && !done; step++) {
        const t = 0.28 + (step / 16) * 0.44;
        const cx = line.from[0] + dx * t;
        const cy = line.from[1] + dy * t;
        for (const [hw, hd] of [[6, 5], [5, 4], [4, 3.2]]) {
          const min = [cx - hw, cy - hd, RING_FLOOR_Z];
          const max = [cx + hw, cy + hd, RING_FLOOR_Z + 5.5];
          if (insideCore(min[0], min[1], max[0], max[1])) continue;
          if (nearSite(min[0], min[1], max[0], max[1])) continue;
          if (inSpawnRoom(min[0], min[1], max[0], max[1])) continue;
          if (!routeClear(min[0], min[1], max[0], max[1], CLEARANCE_M)) continue;
          if (overlaps(min, max, 0.8)) continue;
          baffleIndex += 1;
          push(`baffle-${line.site}-${baffleIndex}`, min, max, 'wall');
          done = true;
          break;
        }
      }
    }
    if (!placedAny && !open.length) break;
  }

  // -------------------------------------------------------------------------
  // 4. 拠点 high-platform の直交2階段。最上段どうしが水平 3.82m・高低差 0m で、
  //    禁止寸法帯 3.0〜4.0m にちょうど入っていた（跳べるか登れるか判別できない）。
  //    ring-* の橋で隙間 0 にし、「歩いて渡れる」へ一意化する。
  // -------------------------------------------------------------------------
  for (const site of runtime.sites || []) {
    if (site.id === 'shiogama') continue;
    const high = site.highGrounds?.[0];
    if (!high) continue;
    const [hx, hy, hz] = high.center;
    const signX = Math.sign(hx - site.center[0]) || 1;
    const signY = Math.sign(hy - site.center[1]) || 1;
    // 台の角（x階段側の外側 × y階段側の外側）を埋める
    const x0 = signX > 0 ? hx + 3 : hx - 3 - 2.4;
    const y0 = signY > 0 ? hy + 3 : hy - 3 - 2.4;
    const min = [x0, y0, RING_FLOOR_Z];
    const max = [x0 + 2.4, y0 + 2.4, hz];
    if (!routeClear(min[0], min[1], max[0], max[1], 1.0)) continue;
    if (overlaps(min, max, 0.0)) continue;
    push(`brace-${site.id}`, min, max, 'stair');
  }

  // -------------------------------------------------------------------------
  // 5. 桟橋台（高所）。頭上 2.6m を先に確保してから置く。
  //    登り口は東西南北の4方向を試し、2方向以上が段ごとに全段通る場所にだけ置く。
  // -------------------------------------------------------------------------
  const DECK_DIRS = [
    { id: 'e', vx: 1, vy: 0 }, { id: 'w', vx: -1, vy: 0 },
    { id: 'n', vx: 0, vy: 1 }, { id: 's', vx: 0, vy: -1 },
  ];
  let deckTotal = 0;
  for (const band of RING_BANDS) {
    let deckIndex = 0;
    for (let dx = band.x[0] + 16; dx <= band.x[1] - 16; dx += 33) {
      for (let dy = band.y[0] + 14; dy <= band.y[1] - 14; dy += 29) {
        const deckH = 4 + ((deckTotal + 1) % 3);       // 5 / 6 / 7 m（4.0 → 9/10/11）
        const stepCount = Math.round(deckH / 0.5);
        const halfW = 6.5;
        const halfD = 5.5;
        const deckMin = [dx - halfW, dy - halfD, RING_FLOOR_Z];
        const deckMax = [dx + halfW, dy + halfD, RING_FLOOR_Z + deckH];
        if (insideCore(deckMin[0], deckMin[1], deckMax[0], deckMax[1])) continue;
        if (nearSite(deckMin[0], deckMin[1], deckMax[0], deckMax[1])) continue;
        if (inSpawnRoom(deckMin[0], deckMin[1], deckMax[0], deckMax[1])) continue;
        if (!routeClear(deckMin[0], deckMin[1], deckMax[0], deckMax[1], CLEARANCE_M)) continue;
        if (overlaps(deckMin, deckMax, 1.2)) continue;

        // 各方向の階段を段単位で事前判定する。中心だけを見ると 14m 張り出す階段が
        // 経路を塞ぐ（実際に mizuichi-high-x を塞いだ）。
        const usable = [];
        for (const dir of DECK_DIRS) {
          const along = dir.vx !== 0 ? halfW : halfD;
          const lateral = dir.vx !== 0 ? 2.0 : 2.0;
          let clear = true;
          const treads = [];
          for (let step = 0; step < stepCount && clear; step++) {
            const base = along + step * 1.2;
            const near = base;
            const far = base + 1.2;
            const min = dir.vx !== 0
              ? [dx + (dir.vx > 0 ? near : -far), dy - lateral, RING_FLOOR_Z]
              : [dx - lateral, dy + (dir.vy > 0 ? near : -far), RING_FLOOR_Z];
            const max = dir.vx !== 0
              ? [dx + (dir.vx > 0 ? far : -near), dy + lateral, RING_FLOOR_Z + deckH - step * 0.5]
              : [dx + lateral, dy + (dir.vy > 0 ? far : -near), RING_FLOOR_Z + deckH - step * 0.5];
            if (insideCore(min[0], min[1], max[0], max[1])
              || nearSite(min[0], min[1], max[0], max[1])
              || inSpawnRoom(min[0], min[1], max[0], max[1])
              || !routeClear(min[0], min[1], max[0], max[1], 1.6)
              || overlaps(min, max, 0.4)) {
              clear = false;
              break;
            }
            treads.push([min, max]);
          }
          if (clear) usable.push({ dir, treads });
        }
        // 「取れるが居座れない」= 2方向以上から登れること。1方向しか無い台は置かない。
        if (usable.length < 2) continue;

        deckIndex += 1;
        deckTotal += 1;
        push(`deck-${band.id}-${deckIndex}`, deckMin, deckMax, 'tower');
        // 台上の頭上 2.6m を予約する（後から倉庫が頭上を塞ぐのを構造的に禁止）
        reserve([deckMin[0], deckMin[1], deckMax[2]], [deckMax[0], deckMax[1], deckMax[2] + 2.6]);
        for (const { dir, treads } of usable) {
          treads.forEach(([min, max], step) => {
            push(`deckstair-${band.id}-${deckIndex}-${dir.id}${step}`, min, max, 'stair');
            reserve([min[0], min[1], max[2]], [max[0], max[1], max[2] + 2.2]);
          });
        }
        // 台上の欄干（半身遮蔽 1.30m。登り口の側は開けておく）
        const railSides = [
          ['n', [deckMin[0], deckMax[1] - 0.45], [deckMax[0], deckMax[1]], 'n'],
          ['s', [deckMin[0], deckMin[1]], [deckMax[0], deckMin[1] + 0.45], 's'],
          ['e', [deckMax[0] - 0.45, deckMin[1] + 0.5], [deckMax[0], deckMax[1] - 0.5], 'e'],
          ['w', [deckMin[0], deckMin[1] + 0.5], [deckMin[0] + 0.45, deckMax[1] - 0.5], 'w'],
        ];
        for (const [name, lo, hi, dirId] of railSides) {
          if (usable.some(entry => entry.dir.id === dirId)) continue;
          push(`deckrail-${band.id}-${deckIndex}-${name}`,
            [lo[0], lo[1], deckMax[2]], [hi[0], hi[1], deckMax[2] + 1.30], 'cover');
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 6. 街区（倉庫）。街路のグリッドを通し、列ごとに半ピッチずらして東西の通りを折る。
  //    さらに交差点の 1/4 に塞ぎ棟を置き、100m 級の直線射線を分割する。
  // -------------------------------------------------------------------------
  const tryStore = (id, cx, cy, w, d, h) => {
    const min = [cx - w / 2, cy - d / 2, RING_FLOOR_Z];
    const max = [cx + w / 2, cy + d / 2, RING_FLOOR_Z + h];
    if (insideCore(min[0], min[1], max[0], max[1])) return false;
    if (nearSite(min[0], min[1], max[0], max[1])) return false;
    if (inSpawnRoom(min[0], min[1], max[0], max[1])) return false;
    // 離隔は建物の実 AABB で取る。中心＋固定余裕では大型棟が経路を塞ぐ。
    if (!routeClear(min[0], min[1], max[0], max[1], CLEARANCE_M)) return false;
    if (overlaps(min, max, 0.6)) return false;
    push(id, min, max, 'wall');
    return true;
  };

  let storeIndex = 0;
  const gateSpots = [];
  for (const band of RING_BANDS) {
    const random = makeRandom(0x5ea10000 + band.seed);
    const cols = [];
    for (let x = band.x[0] + band.ox; x + BLOCK_W <= band.x[1]; x += BLOCK_PITCH_X) cols.push(x);
    // 交差点の塞ぎ棟を先に置く（後の街区がこれを避ける）
    cols.forEach((x0, col) => {
      const jog = (col % 2) * (BLOCK_PITCH_Y / 2);
      let row = 0;
      for (let y = band.y[0] + band.oy + jog; y + BLOCK_D <= band.y[1]; y += BLOCK_PITCH_Y, row++) {
        if ((col * 3 + row) % 4 !== 0) continue;
        const h = 9 + (hash2(col, row, band.seed) % 700) / 100;
        storeIndex += 1;
        if (tryStore(`store-${band.id}-${storeIndex}`, x0 - 4.5, y - 4.0, 7, 6, h)) {
          gateSpots.push([x0 - 4.5, y - 4.0]);
        } else {
          storeIndex -= 1;
        }
      }
    });
    // 街区本体。大きさは4階層（小・中・大・ランドマーク）。
    cols.forEach((x0, col) => {
      const jog = (col % 2) * (BLOCK_PITCH_Y / 2);
      let row = 0;
      for (let y0 = band.y[0] + band.oy + jog; y0 + BLOCK_D <= band.y[1]; y0 += BLOCK_PITCH_Y, row++) {
        const tier = (hash2(col, row, band.seed ^ 0x77) % 1000) / 1000;
        const jitterX = (random() - 0.5) * 1.2;
        const jitterY = (random() - 0.5) * 1.2;
        const cx = x0 + BLOCK_W / 2 + jitterX;
        const cy = y0 + BLOCK_D / 2 + jitterY;
        const units = [];
        if (tier < 0.34) {
          // 小: 平屋の倉を4区画
          for (const [ux, uy] of [[-3.6, -3.4], [3.6, -3.4], [-3.6, 3.4], [3.6, 3.4]]) {
            units.push([cx + ux, cy + uy, 5.6 + random() * 1.2, 5.2 + random() * 1.0,
              4.5 + random() * 2.5]);
          }
        } else if (tier < 0.64) {
          // 中: 2階建ての店を2棟
          if ((col + row) % 2 === 0) {
            units.push([cx, cy - 3.4, BLOCK_W - 1.0, 5.6, 8 + random() * 3.5]);
            units.push([cx, cy + 3.4, BLOCK_W - 1.0, 5.6, 8 + random() * 3.5]);
          } else {
            units.push([cx - 3.6, cy, 6.2, BLOCK_D - 1.0, 8 + random() * 3.5]);
            units.push([cx + 3.6, cy, 6.2, BLOCK_D - 1.0, 8 + random() * 3.5]);
          }
        } else if (tier < 0.88) {
          // 大: 塔状の倉庫1棟
          units.push([cx, cy, BLOCK_W - 1.4, BLOCK_D - 1.6, 13 + random() * 5]);
        } else {
          // ランドマーク: 約8街区に1棟
          units.push([cx, cy, BLOCK_W - 0.4, BLOCK_D - 0.6, 19 + random() * 8]);
        }
        for (const [ux, uy, uw, ud, uh] of units) {
          storeIndex += 1;
          if (!tryStore(`store-${band.id}-${storeIndex}`, ux, uy, uw, ud, uh)) storeIndex -= 1;
        }
      }
    });
  }
  void gateSpots;

  // -------------------------------------------------------------------------
  // 6.5 並木（V の宿主）。
  //   検証で「プレイ領域内の樹木58本のうち33本が遮蔽箱と壁の天端に生えている」
  //   「宿主上端より上は XY 0.8m 以下という規則の帰結で樹冠が板になる」と出た。
  //   根本原因は「木に当たり判定が無いので既存ソリッドの上にしか置けない」こと。
  //   ここで**木そのものを当たり判定として作る**。V はこの footprint の中だけに
  //   幹と樹冠を描けばよく、樹冠を 2.7m まで太らせても偽の遮蔽にならない。
  //   寸法: 2.2 x 2.2 x 5.6〜7.6m（全身遮蔽 2.20m 以上／禁止帯 1.05〜1.20・3.0〜4.0 の外）。
  // -------------------------------------------------------------------------
  const TREE_HALF = 1.1;
  const TREE_CLEARANCE_M = 3.0;   // 質量(4.2)より近く、遮蔽(2.0)より遠い
  const treePlaced = [];
  const tryTree = (id, cx, cy, height) => {
    const min = [cx - TREE_HALF, cy - TREE_HALF, RING_FLOOR_Z];
    const max = [cx + TREE_HALF, cy + TREE_HALF, RING_FLOOR_Z + height];
    if (insideCore(min[0], min[1], max[0], max[1])) return false;
    if (nearSite(min[0], min[1], max[0], max[1], 13)) return false;
    if (inSpawnRoom(min[0], min[1], max[0], max[1])) return false;
    if (!routeClear(min[0], min[1], max[0], max[1], TREE_CLEARANCE_M)) return false;
    if (overlaps(min, max, 1.0)) return false;
    if (boostable(min, max)) return false;
    if (treePlaced.some(([px, py]) => Math.hypot(px - cx, py - cy) < 6.3)) return false;
    push(id, min, max, 'cover');
    treePlaced.push([cx, cy]);
    return true;
  };

  let treeIndex = 0;
  for (const band of RING_BANDS) {
    const random = makeRandom(0x7ee00000 + band.seed);
    for (let x = band.x[0] + 9; x <= band.x[1] - 9; x += 12.5) {
      for (let y = band.y[0] + 8; y <= band.y[1] - 8; y += 11.5) {
        // 3本1組の小さな林にして、単木の等間隔配置に見えないようにする
        const clump = 1 + (hash2(Math.round(x), Math.round(y), band.seed ^ 0x5a) % 3);
        for (let k = 0; k < clump; k++) {
          const angle = (k / clump) * Math.PI * 2 + random() * 1.4;
          const radius = k === 0 ? 0 : 6.6 + random() * 1.9;
          const height = 5.6 + ((treeIndex + k) % 3) * 1.0 + random() * 0.6;
          treeIndex += 1;
          if (!tryTree(`tree-${treeIndex}`,
            x + Math.cos(angle) * radius, y + Math.sin(angle) * radius, height)) treeIndex -= 1;
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // 7. 遮蔽。経路の「中」（側方 3.4〜5.8m の帯）へ 7.0m 間隔で並べる。
  //    CLEARANCE_M は質量にだけ適用し、遮蔽には COVER_CLEARANCE_M(2.0m) を使う。
  // -------------------------------------------------------------------------
  const props = [];
  let coverIndex = 0;

  const tryCover = (cx, cy, kind, swap) => {
    const w = swap ? kind.d : kind.w;
    const d = swap ? kind.w : kind.d;
    const min = [cx - w / 2, cy - d / 2, RING_FLOOR_Z];
    const max = [cx + w / 2, cy + d / 2, RING_FLOOR_Z + kind.h];
    if (insideCore(min[0], min[1], max[0], max[1])) return false;
    if (nearSite(min[0], min[1], max[0], max[1], 12)) return false;
    if (inSpawnRoom(min[0], min[1], max[0], max[1])) return false;
    if (!routeClear(min[0], min[1], max[0], max[1], COVER_CLEARANCE_M)) return false;
    if (overlaps(min, max, 0.5)) return false;
    if (props.some(([px, py]) => Math.hypot(px - cx, py - cy) < PROP_SPACING_M)) return false;
    if (boostable(min, max)) return false;
    coverIndex += 1;
    push(`crate-${coverIndex}`, min, max, 'cover');
    props.push([cx, cy]);
    return true;
  };

  let station = 0;
  for (const route of routes) {
    let carry = 6.0;   // スポーン出口の直前は空けておく
    for (let i = 1; i < route.points.length; i++) {
      const [ax, ay] = route.points[i - 1];
      const [bx, by] = route.points[i];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      for (let t = carry; t < length; t += 7.0) {
        const px = ax + ux * t;
        const py = ay + uy * t;
        station += 1;
        const kindBase = COVER_PATTERN[station % COVER_PATTERN.length];
        const pick = kindBase === 0
          ? hash2(station, 1, 0x5b) % HALF_KINDS
          : kindBase === 1
            ? HALF_KINDS + hash2(station, 2, 0x9c) % (MEDIUM_KINDS - HALF_KINDS)
            : MEDIUM_KINDS + hash2(station, 3, 0xa7) % (COVER_KINDS.length - MEDIUM_KINDS);
        const kind = COVER_KINDS[pick];
        // 長辺を経路に直交させると射線が良く割れる
        const swap = Math.abs(ux) > Math.abs(uy) ? kind.w > kind.d : kind.d > kind.w;
        const sideOrder = station % 2 === 0 ? [1, -1] : [-1, 1];
        let placed = false;
        for (const side of sideOrder) {
          for (const offset of [3.6, 4.6, 5.8]) {
            if (placed) break;
            placed = tryCover(px - uy * side * offset, py + ux * side * offset, kind, swap);
          }
          if (placed) break;
        }
      }
      carry = (carry - length) % 7.0;
      if (carry < 0) carry += 7.0;
    }
  }

  // 街区の角にも遮蔽を足して、街路そのものにも 6〜9m 間隔の遮蔽列を作る。
  const storeSolids = solids.filter(solid => solid.id.startsWith('ring-store-'));
  storeSolids.forEach((store, index) => {
    const cx = (store.min[0] + store.max[0]) / 2;
    const cy = (store.min[1] + store.max[1]) / 2;
    const hw = (store.max[0] - store.min[0]) / 2;
    const hd = (store.max[1] - store.min[1]) / 2;
    for (let corner = 0; corner < 4; corner++) {
      const sx = corner % 2 === 0 ? 1 : -1;
      const sy = corner < 2 ? 1 : -1;
      const kind = COVER_KINDS[hash2(index, corner, 0xc1) % COVER_KINDS.length];
      tryCover(cx + sx * (hw + 2.6), cy + sy * (hd + 2.4), kind, (index + corner) % 2 === 0);
    }
  });

  // -------------------------------------------------------------------------
  // 8. 縁石と排水溝（K-7）。G がこの footprint の中だけに板を敷ける。
  //    高さ 0.12 / 0.10 は stepUpM 0.55 未満で歩行を妨げず、
  //    かつ半身遮蔽(上端 5.30)へのジャンプ到達 1.1136m にも届かない。
  // -------------------------------------------------------------------------
  let curbIndex = 0;
  const curbs = [];
  const tryCurb = (prefix, cx, cy, w, d, h) => {
    const min = [cx - w / 2, cy - d / 2, RING_FLOOR_Z];
    const max = [cx + w / 2, cy + d / 2, RING_FLOOR_Z + h];
    if (insideCore(min[0], min[1], max[0], max[1])) return false;
    if (inSpawnRoom(min[0], min[1], max[0], max[1])) return false;
    if (!routeClear(min[0], min[1], max[0], max[1], TRIM_CLEARANCE_M)) return false;
    if (overlaps(min, max, 0.25)) return false;
    if (curbs.some(([px, py]) => Math.hypot(px - cx, py - cy) < 3.4)) return false;
    curbIndex += 1;
    push(`${prefix}-${curbIndex}`, min, max, 'rim');
    curbs.push([cx, cy]);
    return true;
  };

  let curbStation = 0;
  for (const route of routes) {
    let carry = 4.0;
    for (let i = 1; i < route.points.length; i++) {
      const [ax, ay] = route.points[i - 1];
      const [bx, by] = route.points[i];
      const length = Math.hypot(bx - ax, by - ay);
      if (length < 1e-6) continue;
      const ux = (bx - ax) / length;
      const uy = (by - ay) / length;
      for (let t = carry; t < length; t += 4.5) {
        const px = ax + ux * t;
        const py = ay + uy * t;
        curbStation += 1;
        const alongX = Math.abs(ux) > Math.abs(uy);
        for (const side of [1, -1]) {
          const gutter = curbStation % 3 === 0;
          const offset = gutter ? 3.0 : 2.2;
          const cx = px - uy * side * offset;
          const cy = py + ux * side * offset;
          tryCurb(gutter ? 'gutter' : 'curb', cx, cy,
            alongX ? 4.2 : (gutter ? 1.0 : 0.6),
            alongX ? (gutter ? 1.0 : 0.6) : 4.2,
            gutter ? 0.10 : 0.12);
        }
      }
      carry = (carry - length) % 4.5;
      if (carry < 0) carry += 4.5;
    }
  }

  return {
    solids,
    geometry: solids.map(solid => ({ ...solid })),
    // L と G が座標を引くための公開情報（PLAN.md §K-6 / §K-7）
    beacons: beaconPlaced,
  };
}
