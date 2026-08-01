/**
 * site_skyline.js — 担当区画「遠景・境界・拠点間の街」
 *
 * 受け持ち: 境界（外周壁・欄干・核門）／境界外の遠景都市と地形（層3・層4）／
 *          そして 34,348 m²（マップの74%）を占めるのに構造物が30個しかない
 *          **拠点間の移動リング**（survey §2.2 / §8-4）。
 *
 * 設計上の絶対条件
 *  1. 当たり判定を1個も作らない・変えない。`buildOshioiFlashpointGeometry()` は**読むだけ**。
 *     生成物は全ノード `userData.collision === false`（arch_kit の markDecorative が付ける）。
 *  2. **当たり判定の箱が無い場所に「遮蔽に見える不透明な塊」を置かない。**
 *     プレイ領域 x[-126,126] y[-92,92] の内側に置けるのは次の4種だけで、
 *     どれも `auditSkylinePlacements()` が実ジオメトリの頂点で検算する:
 *       - collision-backed : 当たり判定 AABB の中に収まる（wrapSolid / 欄干 / 灯）
 *       - overhead         : 全頂点が 床 + 2.2 m より上（頭上装飾）
 *       - flat             : 全頂点が 設置面 + 0.35 m 以下（石畳・動線ライン）
 *       - thin             : 頭上高さ以下の実体が「最大 0.8 m 角」の宣言矩形に収まる
 *                            （灯柱・門の脚・辻標・並木の幹。遮蔽にならない太さ）
 *     境界外（outside）は上記の制限を受けないが、代わりに
 *     「頭上高さ以下の頂点がプレイ領域へ 1 mm も食い込まない」ことを検算する。
 *  3. 座標系: ゲームは Z-up。arch_kit の造形は Y-up ローカルで、`mountZUp()` が載せる。
 *     このモジュールが返すグループは **すでに Z-up**。`world` へそのまま add する。
 *
 * この区画にしかない構造物（他区画と共有しない語彙）
 *  - 潮防壁 tide-seawall      : 外周 876 m を 18 m モジュールで反復した貝灰漆喰の防壁。
 *                               開口は**必ず塞ぐ**（当たり判定があり通り抜けられないため）。
 *  - 望楼 seawall-turret      : 防壁 4 ベイごとの櫓。中ドーム。境界外へ張り出して立てる。
 *  - 核門 core-gate           : 移動リングから旧市街へ入る 4 枚の門壁。
 *  - 潮路門 tide-road-gate    : 移動路をまたぐ渡り門。桁下 4.6 m・脚は φ0.56 m。
 *  - 辻標 crossroads-mast     : 交差点の細い標柱。東=橙／西=藍で自陣側が分かる。
 *  - 潮上町 tide-city-terrace : 境界外の三重の街並み（近 8–22 m / 中 22–46 m / 遠 46–78 m）。
 *  - 沖ノ潮見灯 okino-beacon  : 北の沖に立つ 72 m の大灯台。区画の中ランドマーク。
 *  - 帰航灯 homing-beacon     : 東西の沖に 1 基ずつ。東=橙／西=藍。
 *  - 潮溜 tidal-flat          : 境界外の碧い浅瀬（唯一の寒色）。
 *
 * 反復は 3 スケール（ARCH_BRIEF §3.2）: 小ドーム=潮路門の頂華 / 中ドーム=望楼 /
 * 大ドーム=灯台。部品を増やさずに密度だけを上げる。
 */

import { OSHIOI_FLASHPOINT } from '../map_oshioi_flashpoint.js';
import { buildOshioiFlashpointGeometry } from '../map_oshioi_flashpoint_geometry.js';
import {
  createArchKit,
  markDecorative,
  ARCH_PLAY_CLEARANCE_M,
} from '../../client/img2threejs/runtime/arch_kit.js';

export const SKYLINE_ID = 'oshioi-skyline-and-ring-town-v1';

const PLAYABLE = OSHIOI_FLASHPOINT.layout.playableBoundsM;
const RING_FLOOR_Z = 4;

export const SKYLINE_CONSTRAINTS = Object.freeze({
  playableBoundsM: Object.freeze({ x: [...PLAYABLE.x], y: [...PLAYABLE.y] }),
  ringFloorZ: RING_FLOOR_Z,
  /** 頭上クリアランス。これより下では遮蔽になりうる（arch_kit と同じ 2.2 m）。 */
  playClearanceM: ARCH_PLAY_CLEARANCE_M,
  /** thin ポリシーで許す実体の最大水平寸法。これを超えると「遮蔽に見える塊」。 */
  maxPlayMassExtentM: 0.8,
  /** flat ポリシーで許す最大高さ。これ以下は射線を切れない。 */
  maxFlatHeightM: 0.35,
  /** 頂点判定の許容差。 */
  toleranceM: 0.01,
});

/** ARCH_BRIEF §3.1 の4層（高さ帯）。 */
export const SKYLINE_BANDS = Object.freeze({
  play: Object.freeze({ id: 'play', heightM: [0, 6] }),
  near: Object.freeze({ id: 'near', heightM: [6, 25] }),
  city: Object.freeze({ id: 'city', heightM: [25, 80] }),
  frame: Object.freeze({ id: 'frame', heightM: [80, Infinity] }),
});

export const SKYLINE_POLICIES = Object.freeze([
  'collision-backed', 'overhead', 'flat', 'thin', 'outside',
]);

function bandOf(heightM) {
  if (heightM >= 80) return 'frame';
  if (heightM >= 25) return 'city';
  if (heightM >= 6) return 'near';
  return 'play';
}

function insidePlayable(x, y) {
  const [x0, x1] = SKYLINE_CONSTRAINTS.playableBoundsM.x;
  const [y0, y1] = SKYLINE_CONSTRAINTS.playableBoundsM.y;
  return x > x0 && x < x1 && y > y0 && y < y1;
}

/* ------------------------------------------------------------------ *
 * 幾何の小道具（THREE 非依存。ここは純データ）
 * ------------------------------------------------------------------ */

function round(value, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

/** ローカル +Z を世界の (nx, ny) 方向へ向ける yaw。mountZUp の規約に一致。 */
function yawForNormal(nx, ny) {
  return Math.atan2(nx, -ny);
}

function polylineLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** 折れ線を等間隔にサンプルする。返り値は {x, y, headingRad, t}。 */
function sampleAlong(points, spacing, { inset = 0 } = {}) {
  const total = polylineLength(points);
  const usable = Math.max(0, total - inset * 2);
  const count = Math.max(1, Math.floor(usable / spacing));
  const out = [];
  for (let i = 0; i <= count; i++) {
    out.push(pointAtDistance(points, inset + (usable * i) / count));
  }
  return out;
}

function pointAtDistance(points, distance) {
  let remaining = Math.max(0, distance);
  for (let i = 1; i < points.length; i++) {
    const dx = points[i][0] - points[i - 1][0];
    const dy = points[i][1] - points[i - 1][1];
    const segment = Math.hypot(dx, dy);
    if (remaining <= segment || i === points.length - 1) {
      const t = segment > 0 ? Math.min(1, remaining / segment) : 0;
      return {
        x: round(points[i - 1][0] + dx * t),
        y: round(points[i - 1][1] + dy * t),
        headingRad: Math.atan2(dy, dx),
      };
    }
    remaining -= segment;
  }
  const last = points[points.length - 1];
  return { x: last[0], y: last[1], headingRad: 0 };
}

function pointAtFraction(points, fraction) {
  return pointAtDistance(points, polylineLength(points) * fraction);
}

function mirror(points, axis) {
  return points.map(([x, y]) => (axis === 'x' ? [-x, y] : [x, -y]));
}

/* ------------------------------------------------------------------ *
 * 移動リングの道路網
 *   実ランタイム経路（buildOuterRoute / buildCentralRoutes）が通る帯に一致させる。
 *   走っている 13〜27 秒を退屈にしないための骨格。
 * ------------------------------------------------------------------ */

const BASE_ROADS = [
  { id: 'east-grand-avenue', widthM: 16, points: [[110, 0], [88, 0], [66, 0], [49, 0]], gates: [0.3, 0.72] },
  { id: 'east-north-diagonal', widthM: 12, points: [[108, 10], [98, 20], [88, 31], [78, 42]], gates: [0.5] },
  { id: 'north-cross-east', widthM: 12, points: [[-8, 64], [8, 60], [22, 55], [36, 49]], gates: [0.34, 0.76] },
  { id: 'north-quay-east', widthM: 8, points: [[6, 87], [56, 86], [112, 84]], gates: [0.55] },
];

function buildRoads() {
  const roads = [];
  for (const road of BASE_ROADS) {
    roads.push({ ...road, points: road.points.map(p => [...p]) });
    roads.push({ ...road, id: road.id.replace('east', 'west'), points: mirror(road.points, 'x') });
    if (road.id !== 'east-grand-avenue' && road.id !== 'north-quay-east') {
      roads.push({ ...road, id: road.id.replace('north', 'south'), points: mirror(road.points, 'y') });
      roads.push({
        ...road,
        id: road.id.replace('north', 'south').replace('east', 'west'),
        points: mirror(mirror(road.points, 'y'), 'x'),
      });
    } else if (road.id === 'north-quay-east') {
      roads.push({ ...road, id: 'south-quay-east', points: mirror(road.points, 'y') });
      roads.push({ ...road, id: 'south-quay-west', points: mirror(mirror(road.points, 'y'), 'x') });
    }
  }
  return roads;
}

/** 東半分は橙、西半分は藍。走っている間ずっと自陣側が分かる（ARCH_BRIEF §3.4）。 */
function lampSideAt(x) {
  return x >= 0 ? 'east' : 'west';
}

/* ------------------------------------------------------------------ *
 * 当たり判定の箱を読む（読むだけ。書き換えない）
 * ------------------------------------------------------------------ */

/** 1本の長い当たり判定壁を、その内側に収まる複数の小 AABB へ割る。 */
function splitSolidAlong(solid, axis, targetLengthM) {
  const length = solid.max[axis] - solid.min[axis];
  const count = Math.max(1, Math.round(length / targetLengthM));
  const step = length / count;
  const bays = [];
  for (let i = 0; i < count; i++) {
    const lo = solid.min[axis] + step * i;
    const min = [...solid.min];
    const max = [...solid.max];
    min[axis] = round(lo);
    max[axis] = round(lo + step);
    bays.push({ id: `${solid.id}-bay-${String(i).padStart(2, '0')}`, tag: solid.tag, min, max });
  }
  return bays;
}

function longAxisOf(solid) {
  return (solid.max[0] - solid.min[0]) >= (solid.max[1] - solid.min[1]) ? 0 : 1;
}

/* ------------------------------------------------------------------ *
 * 配置データ（純データ。THREE を一切触らない）
 * ------------------------------------------------------------------ */

function placement(entry) {
  const heightM = entry.heightM ?? 0;
  return {
    band: bandOf(heightM),
    yawRad: 0,
    floorZ: RING_FLOOR_Z,
    softOcclusion: false,
    sourceSolid: null,
    playMass: [],
    ...entry,
    heightM,
    insidePlayable: insidePlayable(entry.position[0], entry.position[1]),
  };
}

/**
 * 区画の全配置を返す（決定論。同じ入力なら常に同じ配列）。
 * @returns {Array<object>} placement 記述子
 */
export function buildSkylinePlacements(options = {}) {
  const detail = options.detail || 'medium';
  const geometry = buildOshioiFlashpointGeometry();
  const solids = geometry.solids;
  const out = [];
  let seed = 1301;
  const nextSeed = () => (seed += 17);

  /* ---------- 1. 潮防壁: 外周 4 枚を 18 m ベイに割って包む ---------- */
  const perimeter = solids.filter(s => s.id.startsWith('flash-perimeter-'));
  for (const solid of perimeter) {
    const axis = longAxisOf(solid);
    const bays = splitSolidAlong(solid, axis, 18);
    const inwardNormal = axis === 0
      ? [0, solid.min[1] > 0 ? -1 : 1]
      : [solid.min[0] > 0 ? -1 : 1, 0];
    bays.forEach((bay, index) => {
      const cx = (bay.min[0] + bay.max[0]) / 2;
      const cy = (bay.min[1] + bay.max[1]) / 2;
      const bayLength = bay.max[axis] - bay.min[axis];
      out.push(placement({
        id: `seawall-bay-${bay.id}`,
        family: 'seawall-bay',
        cluster: 'boundary',
        vocabulary: 'wrapSolid',
        policy: 'collision-backed',
        position: [cx, cy, bay.min[2]],
        heightM: bay.max[2] - bay.min[2],
        sourceSolid: bay,
        params: {
          // 開口は必ず塞ぐ: 当たり判定壁なので「抜けられそうな穴」を作らない
          recipe: { roof: 'hip', openings: 0, eaves: false, lattice: false, parapet: false },
          fit: 'flush',
          wallThickness: 0.34,
          lampSide: lampSideAt(cx),
          detail: 'low',
          seed: nextSeed(),
        },
      }));

      // 内側の面に高い盲アーチ帯（頭上高さより上だけを使う）
      out.push(placement({
        id: `seawall-arcade-${bay.id}`,
        family: 'seawall-arcade-band',
        cluster: 'boundary',
        vocabulary: 'blindArcadeBand',
        policy: 'overhead',
        position: [
          cx + inwardNormal[0] * 0.52,
          cy + inwardNormal[1] * 0.52,
          bay.min[2],
        ],
        yawRad: yawForNormal(inwardNormal[0], inwardNormal[1]),
        heightM: bay.max[2] - bay.min[2],
        params: {
          count: 3,
          spanM: bayLength * 0.94,
          baseY: 6.9,
          openingWidth: 2.1,
          openingHeight: 3.5,
          style: 'segmental',
          lattice: index % 2 === 0,
          detail,
        },
      }));

      // 4 ベイごとに望楼。境界の外へ張り出して立てるのでプレイ空間を侵さない
      if (index % 4 === 1) {
        const outward = [-inwardNormal[0], -inwardNormal[1]];
        out.push(placement({
          id: `seawall-turret-${bay.id}`,
          family: 'seawall-turret',
          cluster: 'boundary',
          vocabulary: 'seawallTurret',
          policy: 'outside',
          position: [cx + outward[0] * 3.4, cy + outward[1] * 3.4, 0],
          yawRad: yawForNormal(inwardNormal[0], inwardNormal[1]),
          heightM: 21.5,
          params: {
            width: 5.6, wallHeight: 15, domeRadius: 3.1,
            lampSide: lampSideAt(cx), detail, seed: nextSeed(),
          },
        }));
      }
    });
  }

  /* ---------- 2. 核門: 旧市街への 4 枚の門壁 ---------- */
  const coreGates = solids.filter(s => s.id.startsWith('flash-core-gate-') && s.tag === 'wall');
  for (const solid of coreGates) {
    const axis = longAxisOf(solid);
    const bays = splitSolidAlong(solid, axis, 7);
    const ringNormal = [solid.min[0] > 0 ? 1 : -1, 0];
    bays.forEach((bay, index) => {
      const cx = (bay.min[0] + bay.max[0]) / 2;
      const cy = (bay.min[1] + bay.max[1]) / 2;
      out.push(placement({
        id: `core-gate-${bay.id}`,
        family: 'core-gate-bay',
        cluster: 'boundary',
        vocabulary: 'wrapSolid',
        policy: 'collision-backed',
        position: [cx, cy, bay.min[2]],
        heightM: bay.max[2] - bay.min[2],
        sourceSolid: bay,
        params: {
          recipe: { roof: 'hip', openings: 0, eaves: false, lattice: false, parapet: false },
          fit: 'flush',
          wallThickness: 0.34,
          lampSide: lampSideAt(cx),
          detail,
          seed: nextSeed(),
        },
      }));
      out.push(placement({
        id: `core-gate-arcade-${bay.id}`,
        family: 'core-gate-arcade',
        cluster: 'boundary',
        vocabulary: 'blindArcadeBand',
        policy: 'overhead',
        position: [cx + ringNormal[0] * 0.52, cy, bay.min[2]],
        yawRad: yawForNormal(ringNormal[0], ringNormal[1]),
        heightM: bay.max[2] - bay.min[2],
        params: {
          count: 2,
          spanM: (bay.max[axis] - bay.min[axis]) * 0.9,
          baseY: 6.6,
          openingWidth: 2.0,
          openingHeight: 2.6,
          style: 'round',
          lattice: true,
          detail,
        },
      }));
      // 門口（旧市街に一番近いベイ）にだけ頂華を載せて「入口」を示す
      if (index === 0) {
        out.push(placement({
          id: `core-gate-crown-${bay.id}`,
          family: 'core-gate-crown',
          cluster: 'boundary',
          vocabulary: 'gateCrown',
          policy: 'overhead',
          position: [cx, cy, bay.max[2]],
          heightM: bay.max[2] - bay.min[2] + 4.2,
          params: { domeRadius: 1.5, lampSide: lampSideAt(cx), detail },
        }));
      }
    });
  }

  /* ---------- 3. 外周欄干: 当たり判定レールの上に載せる ---------- */
  const rails = solids.filter(s => s.id.startsWith('flash-ring-rail-'));
  for (const solid of rails) {
    const axis = longAxisOf(solid);
    const bays = splitSolidAlong(solid, axis, 12);
    bays.forEach((bay, index) => {
      const cx = (bay.min[0] + bay.max[0]) / 2;
      const cy = (bay.min[1] + bay.max[1]) / 2;
      const length = bay.max[axis] - bay.min[axis];
      out.push(placement({
        id: `rail-parapet-${bay.id}`,
        family: 'ring-rail-parapet',
        cluster: 'boundary',
        vocabulary: 'parapet',
        policy: 'collision-backed',
        position: [cx, cy, bay.max[2] - 0.25],
        yawRad: axis === 0 ? 0 : Math.PI / 2,
        heightM: 1.05,
        sourceSolid: bay,
        params: { length: length * 0.96, height: 1.05, axis: 'x', balusters: true, detail },
      }));
      if (index % 3 === 0) {
        out.push(placement({
          id: `rail-lamp-${bay.id}`,
          family: 'ring-rail-lamp',
          cluster: 'boundary',
          vocabulary: 'lampPost',
          policy: 'collision-backed',
          position: [cx, cy, bay.max[2]],
          heightM: 2.9,
          sourceSolid: bay,
          params: { height: 2.2, side: lampSideAt(cx), radius: 0.1, globeRadius: 0.3, detail },
        }));
      }
    });
  }

  /* ---------- 4. 移動路: 石畳・動線ライン・灯・並木・渡り門 ---------- */
  const roads = buildRoads();
  for (const road of roads) {
    const side = lampSideAt(pointAtFraction(road.points, 0.5).x);

    // 4a. 石畳と金の動線ライン（ARCH_BRIEF §3.6。床を単色にしない）
    for (const station of sampleAlong(road.points, 21, { inset: 6 })) {
      out.push(placement({
        id: `road-paving-${road.id}-${out.length}`,
        family: 'road-paving',
        cluster: 'ring-road',
        vocabulary: 'pavingPatch',
        policy: 'flat',
        position: [station.x, station.y, RING_FLOOR_Z - 0.1],
        yawRad: station.headingRad,
        heightM: 0.14,
        params: {
          width: 20, depth: road.widthM, tileSizeM: 4.2, laneAxis: 'x',
          laneWidth: 0.7, seed: nextSeed(),
        },
      }));
    }

    // 4b. 灯列。走行方向を照らし、東西の識別色を持つ
    for (const station of sampleAlong(road.points, 19, { inset: 4 })) {
      const nx = -Math.sin(station.headingRad);
      const ny = Math.cos(station.headingRad);
      const offset = road.widthM / 2 - 0.9;
      for (const sign of [1, -1]) {
        out.push(placement({
          id: `road-lamp-${road.id}-${out.length}-${sign > 0 ? 'l' : 'r'}`,
          family: 'road-lamp',
          cluster: 'ring-road',
          vocabulary: 'lampPost',
          policy: 'thin',
          position: [
            round(station.x + nx * offset * sign),
            round(station.y + ny * offset * sign),
            RING_FLOOR_Z,
          ],
          heightM: 4.9,
          playMass: [{ x: 0, z: 0, w: 0.3, d: 0.3 }],
          params: { height: 4.2, side, radius: 0.12, globeRadius: 0.34, detail },
        }));
      }
    }

    // 4c. 並木。幹だけが目線に入り、樹冠は 2.6 m より上（柔らかい遮蔽 §3.5）
    for (const station of sampleAlong(road.points, 33, { inset: 12 })) {
      const nx = -Math.sin(station.headingRad);
      const ny = Math.cos(station.headingRad);
      const offset = road.widthM / 2 + 2.6;
      const sign = out.length % 2 === 0 ? 1 : -1;
      out.push(placement({
        id: `road-tree-${road.id}-${out.length}`,
        family: 'road-tree',
        cluster: 'greenery',
        vocabulary: 'tree',
        policy: 'thin',
        softOcclusion: true,
        position: [
          round(station.x + nx * offset * sign),
          round(station.y + ny * offset * sign),
          RING_FLOOR_Z,
        ],
        heightM: 7.2,
        playMass: [{ x: 0, z: 0, w: 0.6, d: 0.6 }],
        params: { height: 7.2, crownRadius: 1.5, trunkRadius: 0.22, kind: 'broadleaf', seed: nextSeed(), detail },
      }));
    }

    // 4d. 潮路門。桁下 4.6 m を空け、脚は φ0.56 m 以下
    for (const fraction of road.gates || []) {
      const station = pointAtFraction(road.points, fraction);
      const span = road.widthM + 3;
      out.push(placement({
        id: `road-gate-${road.id}-${round(fraction, 2)}`,
        family: 'road-gate',
        cluster: 'ring-road',
        vocabulary: 'roadGate',
        policy: 'thin',
        position: [station.x, station.y, RING_FLOOR_Z],
        yawRad: station.headingRad + Math.PI / 2,
        heightM: 8.4,
        playMass: [
          { x: -span / 2, z: 0, w: 0.78, d: 0.78 },
          { x: span / 2, z: 0, w: 0.78, d: 0.78 },
        ],
        params: { span, height: 5.4, side, detail, seed: nextSeed() },
      }));
    }
  }

  // 4e. 辻標。交差点に立つ細い標柱。どこを走っていても現在地が読める
  const MASTS = [
    [0, 60.5], [0, -60.5], [86, 10.5], [86, -10.5], [-86, 10.5], [-86, -10.5],
    [99, 24], [99, -24], [-99, 24], [-99, -24],
  ];
  for (const [x, y] of MASTS) {
    out.push(placement({
      id: `crossroads-mast-${x}-${y}`,
      family: 'crossroads-mast',
      cluster: 'ring-road',
      vocabulary: 'crossroadsMast',
      policy: 'thin',
      position: [x, y, RING_FLOOR_Z],
      heightM: 14.6,
      playMass: [{ x: 0, z: 0, w: 0.72, d: 0.72 }],
      params: { height: 13, side: lampSideAt(x), detail, seed: nextSeed() },
    }));
  }

  /* ---------- 5. 遠景都市（層3）: 三重の街並み ---------- */
  const cityRandom = mulberry(9173);
  const CITY_RINGS = [
    { id: 'near', inset: 10, spanX: 150, spanY: 116, count: 60, height: [8, 22], facade: true, cluster: 'city' },
    { id: 'mid', inset: 36, spanX: 178, spanY: 144, count: 46, height: [22, 46], facade: false, cluster: 'city' },
    { id: 'far', inset: 66, spanX: 212, spanY: 176, count: 32, height: [46, 78], facade: false, cluster: 'city' },
  ];
  for (const ring of CITY_RINGS) {
    for (let i = 0; i < ring.count; i++) {
      const t = (i + 0.5) / ring.count;
      const angle = t * Math.PI * 2;
      const jitter = cityRandom();
      const rx = ring.spanX + jitter * 14;
      const ry = ring.spanY + cityRandom() * 12;
      const x = round(Math.cos(angle) * rx);
      const y = round(Math.sin(angle) * ry);
      const height = round(ring.height[0] + cityRandom() * (ring.height[1] - ring.height[0]), 1);
      const width = round(9 + cityRandom() * 11, 1);
      const depth = round(9 + cityRandom() * 11, 1);
      out.push(placement({
        id: `city-${ring.id}-${i}`,
        family: `city-terrace-${ring.id}`,
        cluster: ring.cluster,
        vocabulary: ring.facade ? 'cityTerrace' : 'silhouetteMass',
        policy: 'outside',
        position: [x, y, 0],
        yawRad: yawForNormal(-Math.cos(angle), -Math.sin(angle)),
        heightM: height,
        params: ring.facade
          ? {
            width, depth, height,
            dome: i % 3 === 0,
            lampSide: lampSideAt(x),
            detail: 'low',
            seed: nextSeed(),
          }
          : {
            kind: i % 5 === 0 ? 'tower' : 'block',
            width, depth, height, seed: nextSeed(),
          },
      }));
    }
  }

  /* ---------- 6. 地形と水（層4） ---------- */
  const frameRandom = mulberry(4409);
  for (let i = 0; i < 22; i++) {
    const angle = ((i + 0.5) / 22) * Math.PI * 2;
    const rx = 246 + frameRandom() * 60;
    const ry = 206 + frameRandom() * 50;
    const height = round(78 + frameRandom() * 54, 1);
    out.push(placement({
      id: `offshore-crag-${i}`,
      family: 'offshore-crag',
      cluster: 'frame',
      vocabulary: 'silhouetteMass',
      policy: 'outside',
      position: [round(Math.cos(angle) * rx), round(Math.sin(angle) * ry), -6],
      heightM: height,
      params: {
        kind: i % 3 === 0 ? 'ridge' : 'crag',
        width: round(46 + frameRandom() * 44, 1),
        depth: round(40 + frameRandom() * 40, 1),
        height,
        seed: nextSeed(),
      },
    }));
  }
  for (let i = 0; i < 8; i++) {
    const angle = ((i + 0.5) / 8) * Math.PI * 2;
    out.push(placement({
      id: `tidal-flat-${i}`,
      family: 'tidal-flat',
      cluster: 'frame',
      vocabulary: 'tidalFlat',
      policy: 'outside',
      position: [round(Math.cos(angle) * 176), round(Math.sin(angle) * 150), 0.6],
      yawRad: angle,
      heightM: 0.8,
      params: { innerRadius: 26, outerRadius: 64, sweepRad: 0.78, detail: 'low' },
    }));
  }

  /* ---------- 7. 境界の密な防風林（§3.5「境界に密」） ---------- */
  const windRandom = mulberry(7717);
  for (let i = 0; i < 28; i++) {
    const angle = ((i + 0.5) / 28) * Math.PI * 2;
    const rx = 136 + windRandom() * 8;
    const ry = 102 + windRandom() * 8;
    out.push(placement({
      id: `boundary-windbreak-${i}`,
      family: 'boundary-windbreak',
      cluster: 'greenery',
      vocabulary: 'plantingBed',
      policy: 'outside',
      position: [round(Math.cos(angle) * rx), round(Math.sin(angle) * ry), 0],
      yawRad: angle,
      heightM: 11,
      softOcclusion: true,
      params: {
        width: 15, depth: 6.5, count: 8, kinds: ['pine', 'broadleaf'],
        treeHeightM: [6.5, 11], seed: nextSeed(), detail: 'low',
      },
    }));
  }

  /* ---------- 8. ランドマーク ---------- */
  out.push(placement({
    id: 'okino-tidewatch-beacon',
    family: 'okino-beacon',
    cluster: 'landmark',
    vocabulary: 'okinoBeacon',
    policy: 'outside',
    position: [0, 138, 0],
    heightM: 72,
    params: { detail, seed: 4801 },
  }));
  for (const [id, x, side] of [['east', 168, 'east'], ['west', -168, 'west']]) {
    out.push(placement({
      id: `homing-beacon-${id}`,
      family: 'homing-beacon',
      cluster: 'landmark',
      vocabulary: 'homingBeacon',
      policy: 'outside',
      position: [x, 0, 0],
      heightM: 48,
      params: { side, detail, seed: 5100 + (side === 'east' ? 0 : 37) },
    }));
  }

  return out;
}

/** 決定論的乱数（配置生成専用。arch_kit の archRandom と同系列）。 */
function mulberry(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function next() {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 複合語彙（arch_kit の語彙を組み合わせた、この区画固有の構造物）
 *   すべて Y-up ローカルで返す。mountZUp は buildSkylineArchitecture が掛ける。
 * ------------------------------------------------------------------ */

function composeGroup(THREE, name, children) {
  const group = new THREE.Group();
  group.name = name;
  for (const child of children) if (child) group.add(child);
  markDecorative(group);
  return group;
}

const COMPOSITES = {
  /** 盲アーチ帯。壁面より上に浮かせて置く（開口は開けない）。 */
  blindArcadeBand(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const pitch = p.spanM / p.count;
    for (let i = 0; i < p.count; i++) {
      const x = -p.spanM / 2 + pitch * (i + 0.5);
      const arch = kit.createArchOpening({
        width: p.openingWidth, height: p.openingHeight, style: p.style,
        depth: 0.4, reveal: 0.2, keystone: true, detail: p.detail,
        name: 'skyline-blind-arch',
      });
      arch.position.set(x, p.baseY, 0);
      children.push(arch);
      if (p.lattice) {
        const screen = kit.createLatticeScreen({
          width: p.openingWidth * 0.84, height: p.openingHeight * 0.6,
          pattern: 'kumiko', detail: p.detail, name: 'skyline-blind-lattice',
        });
        screen.position.set(x, p.baseY + p.openingHeight * 0.22, -0.14);
        children.push(screen);
      }
    }
    return composeGroup(THREE, 'skyline-blind-arcade', children);
  },

  /** 望楼。防壁 4 ベイごとの櫓。中スケールのドームを載せる。 */
  seawallTurret(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const half = p.width / 2;
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const wall = kit.createArchWall({
        width: p.width, height: p.wallHeight, thickness: 0.42,
        openings: 1, opening: { width: 1.5, height: 2.6 }, sill: p.wallHeight * 0.52,
        style: 'segmental', detail: p.detail, name: 'skyline-turret-wall',
      });
      wall.position.set(Math.sin(angle) * half, 0, Math.cos(angle) * half);
      wall.rotation.y = angle;
      children.push(wall);
    }
    for (const axis of ['x', 'z']) {
      for (const sign of [1, -1]) {
        const parapet = kit.createParapet({
          length: p.width, height: 0.9, axis: axis === 'x' ? 'x' : 'z',
          balusters: false, detail: p.detail, name: 'skyline-turret-parapet',
        });
        parapet.position.set(
          axis === 'z' ? sign * (half - 0.24) : 0,
          p.wallHeight,
          axis === 'x' ? sign * (half - 0.24) : 0,
        );
        children.push(parapet);
      }
    }
    const dome = kit.createDome({
      radius: p.domeRadius, height: p.domeRadius * 1.15, profile: 'onion',
      drumHeight: 1.1, detail: p.detail, name: 'skyline-turret-dome',
    });
    dome.position.y = p.wallHeight + 0.9;
    children.push(dome);
    const lamp = kit.createLampPost({
      height: 1.4, side: p.lampSide, globeRadius: 0.42, detail: p.detail,
      name: 'skyline-turret-lamp',
    });
    lamp.position.set(half - 0.5, p.wallHeight, half - 0.5);
    children.push(lamp);
    return composeGroup(THREE, 'skyline-seawall-turret', children);
  },

  /** 核門の頂華。入口に背の高い要素と灯を置く原則の実装。 */
  gateCrown(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const dome = kit.createDome({
      radius: p.domeRadius, height: p.domeRadius * 1.3, profile: 'onion',
      drumHeight: 0.8, detail: p.detail, name: 'skyline-gate-dome',
    });
    dome.position.y = 0.4;
    children.push(dome);
    for (const sign of [1, -1]) {
      const lamp = kit.createLampPost({
        height: 2.4, side: p.lampSide, globeRadius: 0.36, detail: p.detail,
        name: 'skyline-gate-lamp',
      });
      lamp.position.set(0, 0.1, sign * 2.4);
      children.push(lamp);
    }
    return composeGroup(THREE, 'skyline-gate-crown', children);
  },

  /** 潮路門。移動路をまたぐ。脚は細く、桁は頭上高さより十分上。 */
  roadGate(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const legs = kit.createColonnade({
      count: 2, spacing: p.span, radius: 0.28, height: p.height,
      axis: 'x', architrave: true, arcade: false, detail: p.detail,
      name: 'skyline-road-gate-legs',
    });
    children.push(legs);
    const eave = kit.createEave({
      width: p.span * 0.96, projection: 1.25, drop: 0.4, brackets: 3,
      name: 'skyline-road-gate-eave',
    });
    eave.position.set(0, p.height + 0.42, 0.3);
    children.push(eave);
    const banner = kit.createLatticeScreen({
      width: p.span * 0.5, height: 1.5, pattern: 'vertical',
      detail: p.detail, name: 'skyline-road-gate-banner',
    });
    banner.position.set(0, p.height + 0.5, 0);
    children.push(banner);
    const finial = kit.createDome({
      scale: 'small', radius: 0.75, height: 1.05, profile: 'onion',
      drumHeight: 0.35, detail: p.detail, name: 'skyline-road-gate-finial',
    });
    finial.position.y = p.height + 0.75;
    children.push(finial);
    for (const sign of [1, -1]) {
      const lamp = kit.createLampPost({
        height: 0.9, side: p.side, globeRadius: 0.34, detail: p.detail,
        name: 'skyline-road-gate-lamp',
      });
      lamp.position.set((sign * p.span) / 2, p.height + 0.32, 0);
      children.push(lamp);
    }
    return composeGroup(THREE, 'skyline-road-gate', children);
  },

  /** 辻標。交差点に立つ細い標柱。 */
  crossroadsMast(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const mast = kit.createColonnade({
      count: 1, radius: 0.26, height: p.height, architrave: false,
      detail: p.detail, name: 'skyline-mast',
    });
    children.push(mast);
    const collar = kit.createDome({
      radius: 0.72, height: 0.7, profile: 'shallow', drumHeight: 0.3,
      finial: false, detail: p.detail, name: 'skyline-mast-collar',
    });
    collar.position.y = p.height * 0.62;
    children.push(collar);
    const cap = kit.createDome({
      scale: 'small', radius: 0.62, height: 0.95, profile: 'onion',
      drumHeight: 0.25, detail: p.detail, name: 'skyline-mast-cap',
    });
    cap.position.y = p.height;
    children.push(cap);
    const lamp = kit.createLampPost({
      height: 0.5, side: p.side, globeRadius: 0.34, detail: p.detail,
      name: 'skyline-mast-lamp',
    });
    lamp.position.y = p.height - 1.5;
    children.push(lamp);
    return composeGroup(THREE, 'skyline-crossroads-mast', children);
  },

  /** 遠景都市の近リング。塊＋ファサード＋屋根で 6〜25 m のシルエット層を厚くする。 */
  cityTerrace(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const mass = kit.createSilhouetteMass({
      kind: 'block', width: p.width, depth: p.depth, height: p.height,
      seed: p.seed, name: 'skyline-city-mass',
    });
    children.push(mass);
    const facade = kit.createArchWall({
      width: p.width * 0.98, height: p.height * 0.9, thickness: 0.4,
      openings: Math.max(2, Math.round(p.width / 4.5)),
      style: 'segmental', sill: 1.2, detail: 'low', name: 'skyline-city-facade',
    });
    facade.position.set(0, 0, p.depth / 2 + 0.16);
    children.push(facade);
    const roof = kit.createRoof({
      width: p.width * 1.05, depth: p.depth * 1.05,
      height: Math.max(1.2, p.width * 0.22), kind: 'hip', overhang: 0.4,
      name: 'skyline-city-roof',
    });
    roof.position.y = p.height;
    children.push(roof);
    if (p.dome) {
      const dome = kit.createDome({
        radius: Math.min(p.width, p.depth) * 0.3, profile: 'shallow',
        drumHeight: 1.0, detail: 'low', name: 'skyline-city-dome',
      });
      dome.position.y = p.height + Math.max(1.2, p.width * 0.22);
      children.push(dome);
    }
    return composeGroup(THREE, 'skyline-city-terrace', children);
  },

  /** 潮溜。境界外の碧い浅瀬（寒色は藍の1色相だけ）。 */
  tidalFlat(kit, p) {
    const THREE = kit.THREE;
    const terrace = kit.createCurvedTerrace({
      innerRadius: p.innerRadius, outerRadius: p.outerRadius,
      startAngleRad: -p.sweepRad / 2, endAngleRad: p.sweepRad / 2,
      height: 0.7, nosing: 0.2, detail: p.detail,
      material: kit.materials.shallow, edgeMaterial: kit.materials.indigo,
      name: 'skyline-tidal-flat',
    });
    return composeGroup(THREE, 'skyline-tidal-flat', [terrace]);
  },

  /** 沖ノ潮見灯。区画の中ランドマーク。3スケールのドームがここで最大になる。 */
  okinoBeacon(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const base = kit.createCurvedTerrace({
      innerRadius: 0.6, outerRadius: 17, startAngleRad: 0, endAngleRad: Math.PI * 2,
      height: 2.4, nosing: 0.3, detail: p.detail, name: 'skyline-beacon-base',
    });
    children.push(base);
    const drumRadius = 9.5;
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const wall = kit.createArchWall({
        width: drumRadius * 0.78, height: 30, thickness: 0.6,
        openings: 2, opening: { width: 2.2, height: 4.6 }, sill: 18,
        style: 'pointed', detail: p.detail, name: 'skyline-beacon-drum',
      });
      wall.position.set(Math.sin(angle) * drumRadius, 2.4, Math.cos(angle) * drumRadius);
      wall.rotation.y = angle;
      children.push(wall);
    }
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2;
      const colonnade = kit.createColonnade({
        count: 5, spacing: 4.4, radius: 0.44, height: 7.4, axis: 'x',
        arcade: true, arcadeStyle: 'pointed', detail: p.detail,
        name: 'skyline-beacon-colonnade',
      });
      colonnade.position.set(Math.sin(angle) * 8.4, 32.4, Math.cos(angle) * 8.4);
      colonnade.rotation.y = angle;
      children.push(colonnade);
    }
    for (let i = 0; i < 4; i++) {
      const angle = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const wall = kit.createArchWall({
        width: 8.4, height: 15, thickness: 0.5,
        openings: 1, opening: { width: 2.6, height: 5.2 }, sill: 6,
        style: 'pointed', detail: p.detail, name: 'skyline-beacon-lantern',
      });
      wall.position.set(Math.sin(angle) * 5.6, 41.5, Math.cos(angle) * 5.6);
      wall.rotation.y = angle;
      children.push(wall);
    }
    const bigDome = kit.createDome({
      scale: 'large', radius: 7.2, height: 7.0, profile: 'onion',
      drumHeight: 1.8, detail: p.detail, name: 'skyline-beacon-dome-large',
    });
    bigDome.position.y = 56.5;
    children.push(bigDome);
    const midDome = kit.createDome({
      scale: 'medium', radius: 2.4, height: 2.7, profile: 'onion',
      drumHeight: 1.2, detail: p.detail, name: 'skyline-beacon-dome-medium',
    });
    midDome.position.y = 65.5;
    children.push(midDome);
    const smallDome = kit.createDome({
      scale: 'small', radius: 0.9, height: 1.3, profile: 'onion',
      drumHeight: 0.6, detail: p.detail, name: 'skyline-beacon-dome-small',
    });
    smallDome.position.y = 69.5;
    children.push(smallDome);
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const lamp = kit.createLampPost({
        height: 1.6, side: i % 2 === 0 ? 'east' : 'west', globeRadius: 0.5,
        detail: p.detail, name: 'skyline-beacon-lamp',
      });
      lamp.position.set(Math.sin(angle) * 10.6, 32.4, Math.cos(angle) * 10.6);
      children.push(lamp);
    }
    return composeGroup(THREE, 'skyline-okino-beacon', children);
  },

  /** 帰航灯。東西の沖に 1 基ずつ。灯の色だけで自陣側が読める。 */
  homingBeacon(kit, p) {
    const THREE = kit.THREE;
    const children = [];
    const base = kit.createCurvedTerrace({
      innerRadius: 0.5, outerRadius: 11, startAngleRad: 0, endAngleRad: Math.PI * 2,
      height: 1.8, nosing: 0.24, detail: p.detail, name: 'skyline-homing-base',
    });
    children.push(base);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const wall = kit.createArchWall({
        width: 6.2, height: 26, thickness: 0.55,
        openings: 2, opening: { width: 1.8, height: 3.6 }, sill: 15,
        style: 'round', detail: p.detail, name: 'skyline-homing-drum',
      });
      wall.position.set(Math.sin(angle) * 6.1, 1.8, Math.cos(angle) * 6.1);
      wall.rotation.y = angle;
      children.push(wall);
    }
    const gallery = kit.createParapet({
      length: 13, height: 1.2, axis: 'x', balusters: true,
      detail: p.detail, name: 'skyline-homing-gallery',
    });
    gallery.position.y = 27.8;
    children.push(gallery);
    const gallery2 = kit.createParapet({
      length: 13, height: 1.2, axis: 'z', balusters: true,
      detail: p.detail, name: 'skyline-homing-gallery',
    });
    gallery2.position.y = 27.8;
    children.push(gallery2);
    const dome = kit.createDome({
      radius: 5.0, height: 5.4, profile: 'hemisphere', drumHeight: 5.6,
      detail: p.detail, name: 'skyline-homing-dome',
    });
    dome.position.y = 29.5;
    children.push(dome);
    const cap = kit.createDome({
      scale: 'small', radius: 1.1, height: 1.6, profile: 'onion',
      drumHeight: 0.6, detail: p.detail, name: 'skyline-homing-cap',
    });
    cap.position.y = 41.5;
    children.push(cap);
    for (let i = 0; i < 6; i++) {
      const angle = (i / 6) * Math.PI * 2;
      const lamp = kit.createLampPost({
        height: 2.0, side: p.side, globeRadius: 0.66, detail: p.detail,
        name: 'skyline-homing-lamp',
      });
      lamp.position.set(Math.sin(angle) * 6.4, 28.0, Math.cos(angle) * 6.4);
      children.push(lamp);
    }
    return composeGroup(THREE, 'skyline-homing-beacon', children);
  },
};

/* ------------------------------------------------------------------ *
 * 構築
 * ------------------------------------------------------------------ */

const CLUSTER_IDS = Object.freeze(['boundary', 'ring-road', 'greenery', 'city', 'frame', 'landmark']);

function buildNode(kit, entry) {
  const p = entry.params || {};
  switch (entry.vocabulary) {
    case 'wrapSolid':
      return kit.wrapSolid(entry.sourceSolid, { ...p, merge: true });
    case 'parapet':
      return kit.createParapet(p);
    case 'lampPost':
      return kit.createLampPost(p);
    case 'pavingPatch':
      return kit.createPavingPatch(p);
    case 'tree':
      return kit.createTree(p);
    case 'plantingBed':
      return kit.createPlantingBed(p);
    case 'silhouetteMass':
      return kit.createSilhouetteMass(p);
    default: {
      const composite = COMPOSITES[entry.vocabulary];
      if (!composite) throw new TypeError(`SKYLINE_UNKNOWN_VOCABULARY:${entry.vocabulary}`);
      return composite(kit, p);
    }
  }
}

/**
 * 区画の建築を構築する。返り値は **Z-up の THREE.Group**。
 * `world`（`render.js` の `this.world`、あるいは `worldDressing`）へそのまま add する。
 *
 * @param {object} THREE
 * @param {object} [options]
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 * @param {boolean} [options.merge=true]  クラスタごとにマテリアル単位へ畳む
 * @param {object}  [options.kit]         既存の arch_kit を使い回す場合
 * @returns {object} THREE.Group
 */
export function buildSkylineArchitecture(THREE, options = {}) {
  const kit = options.kit || createArchKit(THREE, { detail: options.detail || 'medium' });
  const placements = options.placements || buildSkylinePlacements({ detail: options.detail });
  const merge = options.merge !== false;

  const root = new THREE.Group();
  root.name = 'site-skyline-architecture';
  markDecorative(root);

  const clusters = new Map();
  for (const id of CLUSTER_IDS) {
    const group = new THREE.Group();
    group.name = `skyline-${id}`;
    markDecorative(group);
    clusters.set(id, group);
    root.add(group);
  }

  const nodes = [];
  for (const entry of placements) {
    const node = buildNode(kit, entry);
    if (entry.vocabulary !== 'wrapSolid') {
      // wrapSolid はすでに mountZUp 済み。それ以外は Y-up なのでここで載せる。
      kit.mountZUp(node, entry.position, entry.yawRad || 0);
    }
    node.name = `skyline-${entry.id}`;
    node.userData.skylinePlacementId = entry.id;
    node.userData.skylineFamily = entry.family;
    node.userData.skylinePolicy = entry.policy;
    (clusters.get(entry.cluster) || root).add(node);
    nodes.push({ placement: entry, node });
  }

  const counts = {};
  for (const entry of placements) counts[entry.family] = (counts[entry.family] || 0) + 1;

  root.userData.skyline = {
    id: SKYLINE_ID,
    placementCount: placements.length,
    counts,
    clusters: CLUSTER_IDS,
    merged: merge,
  };
  root.userData.skylineNodes = nodes;

  if (merge) {
    for (const group of clusters.values()) {
      if (group.children.length) kit.mergeArchRoot(group);
    }
    root.userData.skylineNodes = [];
  }
  return root;
}

/* ------------------------------------------------------------------ *
 * 検査（「実装した」ではなく「実測がこうなった」を出すための計測）
 * ------------------------------------------------------------------ */

function localHorizontal(entry, wx, wy) {
  const yaw = entry.yawRad || 0;
  const dx = wx - entry.position[0];
  const dy = wy - entry.position[1];
  return {
    x: dx * Math.cos(yaw) + dy * Math.sin(yaw),
    z: dx * Math.sin(yaw) - dy * Math.cos(yaw),
  };
}

/**
 * 実ジオメトリの頂点で、区画のポリシーを検算する。
 * 「当たり判定の無い遮蔽を置いていない」ことを主張してよいのはこれが通ったときだけ。
 *
 * @returns {{ok:boolean, violations:Array, byPolicy:object, byBand:object, sampledVertices:number}}
 */
export function auditSkylinePlacements(THREE, options = {}) {
  const kit = options.kit || createArchKit(THREE, { detail: options.detail || 'medium' });
  const placements = options.placements || buildSkylinePlacements({ detail: options.detail });
  const root = options.root
    || buildSkylineArchitecture(THREE, { ...options, kit, placements, merge: false });
  const entries = root.userData.skylineNodes || [];

  const { toleranceM, playClearanceM, maxPlayMassExtentM, maxFlatHeightM } = SKYLINE_CONSTRAINTS;
  const [bx0, bx1] = SKYLINE_CONSTRAINTS.playableBoundsM.x;
  const [by0, by1] = SKYLINE_CONSTRAINTS.playableBoundsM.y;

  const violations = [];
  const byPolicy = {};
  const byBand = {};
  let sampledVertices = 0;
  const vertex = new THREE.Vector3();

  for (const { placement: entry, node } of entries) {
    byPolicy[entry.policy] = (byPolicy[entry.policy] || 0) + 1;
    byBand[entry.band] = (byBand[entry.band] || 0) + 1;

    if (entry.policy === 'collision-backed') {
      if (!entry.sourceSolid) {
        violations.push({ id: entry.id, reason: 'collision-backed without sourceSolid' });
        continue;
      }
      const audit = kit.auditFootprint(node, entry.sourceSolid);
      if (!audit.safe) {
        violations.push({
          id: entry.id, reason: 'protrudes outside its collider below head clearance',
          maxProtrusionM: audit.maxProtrusionM,
        });
      }
      continue;
    }

    // 実頂点を歩く
    const clearanceZ = entry.floorZ + playClearanceM;
    let worstOverhead = Infinity;
    let worstFlat = -Infinity;
    let worstThin = 0;
    let worstOutside = 0;
    node.updateMatrixWorld(true);
    node.traverse((child) => {
      if (!child.isMesh || !child.geometry?.attributes?.position) return;
      const position = child.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(child.matrixWorld);
        sampledVertices += 1;
        if (entry.policy === 'overhead') {
          if (vertex.z < worstOverhead) worstOverhead = vertex.z;
          continue;
        }
        if (entry.policy === 'flat') {
          if (vertex.z > worstFlat) worstFlat = vertex.z;
          continue;
        }
        if (vertex.z > clearanceZ) continue;   // 頭上より上は遮蔽にならない
        if (entry.policy === 'thin') {
          const local = localHorizontal(entry, vertex.x, vertex.y);
          let inside = false;
          for (const rect of entry.playMass) {
            if (Math.abs(local.x - rect.x) <= rect.w / 2 + toleranceM
              && Math.abs(local.z - rect.z) <= rect.d / 2 + toleranceM) { inside = true; break; }
          }
          if (!inside) {
            const escape = Math.min(...entry.playMass.map(rect => Math.max(
              Math.abs(local.x - rect.x) - rect.w / 2,
              Math.abs(local.z - rect.z) - rect.d / 2,
            )));
            if (escape > worstThin) worstThin = escape;
          }
        } else if (entry.policy === 'outside') {
          const intrusion = Math.min(
            vertex.x - bx0, bx1 - vertex.x, vertex.y - by0, by1 - vertex.y,
          );
          if (intrusion > worstOutside) worstOutside = intrusion;
        }
      }
    });

    if (entry.policy === 'overhead' && worstOverhead < clearanceZ - toleranceM) {
      violations.push({
        id: entry.id, reason: 'overhead decoration dips below head clearance',
        lowestZ: round(worstOverhead), requiredZ: clearanceZ,
      });
    }
    if (entry.policy === 'flat' && worstFlat > entry.position[2] + maxFlatHeightM + toleranceM) {
      violations.push({
        id: entry.id, reason: 'flat decoration is tall enough to break sightlines',
        highestZ: round(worstFlat),
      });
    }
    if (entry.policy === 'thin') {
      for (const rect of entry.playMass) {
        if (Math.max(rect.w, rect.d) > maxPlayMassExtentM + 1e-9) {
          violations.push({ id: entry.id, reason: 'declared play mass is wide enough to be cover', rect });
        }
      }
      if (worstThin > toleranceM) {
        violations.push({
          id: entry.id, reason: 'solid mass below head clearance escapes its declared footprint',
          escapeM: round(worstThin),
        });
      }
    }
    if (entry.policy === 'outside' && worstOutside > toleranceM) {
      violations.push({
        id: entry.id, reason: 'outside-boundary mass intrudes into the playable ring below head clearance',
        intrusionM: round(worstOutside),
      });
    }
  }

  return { ok: violations.length === 0, violations, byPolicy, byBand, sampledVertices, root };
}

/** 三角形数・ドローコール・collision 漏れの実測。 */
export function measureSkyline(THREE, options = {}) {
  const kit = options.kit || createArchKit(THREE, { detail: options.detail || 'medium' });
  const root = options.root || buildSkylineArchitecture(THREE, { ...options, kit });
  const measured = kit.measureArch(root);
  return { ...measured, placementCount: root.userData.skyline?.placementCount ?? 0, root };
}

/**
 * 区画の内容宣言。テストはこの表を唯一の出所として検査する。
 * **構造物を足したらここに1行足すこと。**
 */
export const SKYLINE_MANIFEST = Object.freeze([
  { family: 'seawall-bay', policy: 'collision-backed', band: 'near', minCount: 40, note: '潮防壁。外周当たり判定壁を18mベイに割って包む。開口は塞ぐ' },
  { family: 'seawall-arcade-band', policy: 'overhead', band: 'near', minCount: 40, note: '防壁内面の盲アーチ帯。頭上高さより上だけを使う' },
  { family: 'seawall-turret', policy: 'outside', band: 'near', minCount: 8, note: '望楼。境界の外へ張り出す中スケールのドーム' },
  { family: 'core-gate-bay', policy: 'collision-backed', band: 'near', minCount: 8, note: '核門。旧市街への門壁を包む' },
  { family: 'core-gate-arcade', policy: 'overhead', band: 'near', minCount: 8, note: '核門の盲アーチ帯' },
  { family: 'core-gate-crown', policy: 'overhead', band: 'near', minCount: 4, note: '核門の頂華と灯。入口を示す' },
  { family: 'ring-rail-parapet', policy: 'collision-backed', band: 'play', minCount: 40, note: '外周レールの欄干。当たり判定の中に収まる' },
  { family: 'ring-rail-lamp', policy: 'collision-backed', band: 'play', minCount: 12, note: '外周レールの灯' },
  { family: 'road-paving', policy: 'flat', band: 'play', minCount: 40, note: '移動路の石畳と金の動線ライン（§3.6）' },
  { family: 'road-lamp', policy: 'thin', band: 'play', minCount: 80, note: '移動路の灯列。東=橙／西=藍' },
  { family: 'road-tree', policy: 'thin', band: 'near', minCount: 20, note: '並木。幹だけが目線に入る柔らかい遮蔽' },
  { family: 'road-gate', policy: 'thin', band: 'near', minCount: 12, note: '潮路門。移動路をまたぐ渡り門' },
  { family: 'crossroads-mast', policy: 'thin', band: 'near', minCount: 8, note: '辻標。交差点の細い標柱' },
  { family: 'city-terrace-near', policy: 'outside', band: 'near', minCount: 50, note: '潮上町・近リング 8–22 m。近景シルエット層' },
  { family: 'city-terrace-mid', policy: 'outside', band: 'city', minCount: 40, note: '潮上町・中リング 22–46 m' },
  { family: 'city-terrace-far', policy: 'outside', band: 'city', minCount: 24, note: '潮上町・遠リング 46–78 m' },
  { family: 'offshore-crag', policy: 'outside', band: 'frame', minCount: 18, note: '沖ノ岩礁。層4の地形' },
  { family: 'tidal-flat', policy: 'outside', band: 'play', minCount: 6, note: '潮溜。碧い浅瀬（唯一の寒色）' },
  { family: 'boundary-windbreak', policy: 'outside', band: 'near', minCount: 24, note: '境界の密な防風林（§3.5）' },
  { family: 'okino-beacon', policy: 'outside', band: 'city', minCount: 1, note: '沖ノ潮見灯 72 m。区画の中ランドマーク' },
  { family: 'homing-beacon', policy: 'outside', band: 'city', minCount: 2, note: '帰航灯。東=橙／西=藍で自陣側が読める' },
]);

/** 性能予算（ARCH_BRIEF §6 の全体予算に対する、この区画1つ分の取り分）。 */
export const SKYLINE_BUDGET = Object.freeze({
  maxTriangles: 260000,
  maxDrawCalls: 42,
});

export default buildSkylineArchitecture;
