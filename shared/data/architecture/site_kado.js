/**
 * 角（南東拠点） — 乾ドックと船体
 * =============================================================================
 * ARCH_BRIEF §3 / §4 に沿った、この区画にしか存在しない建築の配置データと生成器。
 *
 * 【この区画の建築語彙】
 *   乾ドック（段状の側壁・盤木列・注水溝）／ 巨大な船腹の曲面（藍の船底・金の喫水線）
 *   ／ 船体を支える支柱（ビルジシャー）／ 整備足場 ／ 整備ガントリー（中ランドマーク）
 *   ／ 3スケールで反復する「肋材（フレーム）」モジュール。
 *
 * 【絶対規則の遵守】
 *   - `map_oshioi_flashpoint_geometry.js` は **読むだけ**。solids は 1 バイトも変更しない。
 *   - 生成物はすべて描画専用（`userData.collision === false`）。
 *   - 当たり判定が無い場所に「遮蔽に見える不透明な塊」を置かない。
 *     そのために全ピースへ `occlusionClass` を宣言し、tests/architecture_kado.test.js が
 *     実頂点から検算する（宣言と実物が食い違えばテストが落ちる）。
 *
 * 【座標系】
 *   ゲーム世界は Z-up（`client/render.js:245` の `world.rotation.x = -Math.PI/2` の内側）。
 *   本モジュールは各ピースを **Y-up ローカル**で作り、`mountZUp()`（= `rotation.x = +PI/2`）で載せる。
 *   ローカル (lx, ly, lz) ↔ ゲーム相対 (dx, dy, dz) の対応は `local()` を参照。
 *   **返り値のルートに追加の回転を掛けてはならない**（`world` の -PI/2 と打ち消して横倒しになる）。
 *
 * 【使い方】
 *   import * as THREE from 'three';
 *   import { buildKadoArchitecture } from './shared/data/architecture/site_kado.js';
 *   const kado = buildKadoArchitecture(THREE);        // Z-up。world / worldDressing へ直接 add
 *   worldDressing.add(kado);
 */

import {
  createArchKit,
  mountZUp,
  markDecorative,
  archRandom,
} from '../../client/img2threejs/runtime/arch_kit.js';
import { buildOshioiFlashpointGeometry } from '../map_oshioi_flashpoint_geometry.js';

/* ------------------------------------------------------------------ *
 * 0. 定数（SSOT からの写しではなく、SSOT を参照するための座標）
 * ------------------------------------------------------------------ */

/** 拠点の素性。中心・半径は `map_oshioi_flashpoint.js` の 5拠点SSOT に一致させる。 */
export const KADO_SITE = Object.freeze({
  id: 'kado',
  centerM: Object.freeze([56, -44, 4]),
  radiusM: 7,
  floorZ: 4,
  /** 中ランドマーク（SSOT の高台 = `flash-site-kado-high-platform` の中心） */
  landmarkM: Object.freeze([44, -52, 8]),
  vocabulary: 'drydock-and-hull',
  vocabularyJa: '乾ドックと船体',
  /** 拠点固有であることの根拠。他区画と共有してよいのは汎用の壁体・階段・欄干まで。 */
  uniqueStructures: Object.freeze([
    'dry-dock-floor', 'dry-dock-copings', 'keel-blocks',
    'ship-hull', 'bilge-shores', 'staging-scaffold',
    'gantry-crane', 'frame-ribs(3-scale)', 'dock-gate-masts',
  ]),
});

/** 遮蔽判定のしきい値。テストはこの値で実頂点を検算する。 */
export const KADO_OCCLUSION_RULES = Object.freeze({
  /** `ground`: 全頂点がこの高さ（床からの相対 m）以下 */
  groundMaxM: 0.5,
  /** `thin`: プレイ帯にある頂点の水平フットプリントがこの寸法以下（m） */
  thinFootprintM: 0.9,
  /** `overhead`: 全頂点がこの高さ（床からの相対 m）以上 */
  overheadMinM: 3.2,
  /** プレイ帯の上限（頭・肩の高さ）。ARCH_PLAY_CLEARANCE_M と同値 */
  playBandM: 2.2,
});

/** 競技境界（`map.boundsM`）。backdrop はこの外側にしか置かない。 */
export const KADO_PLAYABLE_BOUNDS = Object.freeze({
  x: Object.freeze([-126, 126]),
  y: Object.freeze([-92, 92]),
});

/** 乾ドック本体の寸法（プレイ空間の 18×18 の一枚板を分節する主構造）。 */
export const KADO_DRY_DOCK = Object.freeze({
  centerY: -44,
  xFrom: 46,
  xTo: 74,
  halfWidth: 9.2,      // 側壁（コーピング）の中心までの距離
  copingSteps: 3,
  copingRiseM: 0.14,   // 3 段 × 0.14 = 0.42 m（ground 級）
  keelBlockCount: 9,
});

/** 船体。ドック中心線の上に浮く。船底は必ずプレイ帯の遥か上に置く。 */
export const KADO_HULL = Object.freeze({
  centerM: Object.freeze([58, -44]),
  lengthM: 32,
  beamM: 10.4,
  keelZ: 8.6,          // 床 4 m から 4.6 m 上。overheadMinM(3.2) を大きく上回る
  depthM: 9.2,         // 竜骨 → 甲板 = 8.6 … 17.8 m
  stations: 18,
  waterlineRatio: 0.44, // 船底（藍）と船腹（白）の境。金の喫水線帯
});

/** 整備ガントリー（中ランドマーク）。高台 solid を跨いで立つ。 */
export const KADO_GANTRY = Object.freeze({
  centerM: Object.freeze([44, -52]),
  legSpanX: 8.8,       // 高台 solid（x 41..47）を跨ぐ
  legSpanY: 8.4,       // 同（y -55..-49）
  legRadiusM: 0.3,
  portalZ: 14.4,       // 高台天面 8 m + クリアランス 2.2 m を上回る
  mastTopZ: 27.2,      // どこからでも見える垂直ランドマーク
  jibZ: 20.6,          // 船体天端 17.8 m の上を通す
  jibToX: 72,
  counterJibToX: 34,
});

/** 3スケールで反復する「肋材（フレーム）」。部品を増やさず密度を上げる（§3.2）。 */
export const KADO_RIB_SCALES = Object.freeze({
  small: Object.freeze({ spanM: 1.4, heightM: 0.36, thicknessM: 0.14, count: 14 }),
  medium: Object.freeze({ spanM: 4.6, heightM: 3.2, thicknessM: 0.2, count: 8 }),
  large: Object.freeze({ spanM: 16.0, heightM: 15.6, thicknessM: 0.46, count: 2 }),
});

const FLOOR = KADO_SITE.floorZ;

/* ------------------------------------------------------------------ *
 * 1. 配置データ（宣言。THREE 非依存。テストとドキュメントの単一の出所）
 * ------------------------------------------------------------------ */

const seq = (n, fn) => Array.from({ length: n }, (_, i) => fn(i, n));

/** 船体を支える支柱（ビルジシャー）。細い＝プレイ帯で遮蔽にならない。 */
const BILGE_SHORE_X = [46.5, 51.4, 56.3, 61.2, 66.1, 71.0];
const bilgeShores = BILGE_SHORE_X.flatMap((x, i) => [-1, 1].map(sign => ({
  id: `kado-bilge-shore-${sign > 0 ? 'n' : 's'}-${String(i).padStart(2, '0')}`,
  kind: 'bilgeShore',
  occlusionClass: 'thin',
  depthLayer: 'play',
  at: [x, KADO_DRY_DOCK.centerY + sign * 5.75, FLOOR],
  toward: [x, KADO_DRY_DOCK.centerY + sign * 4.6, 9.9],
  radiusM: 0.17,
})));

/** 整備足場の支柱（スタンダード）。5 スパン × 両舷。 */
const STAGING_X = [46.4, 51.6, 56.8, 62.0, 67.2];
const stagingStandards = STAGING_X.flatMap((x, i) => [-1, 1].map(sign => ({
  id: `kado-staging-standard-${sign > 0 ? 'n' : 's'}-${String(i).padStart(2, '0')}`,
  kind: 'standard',
  occlusionClass: 'thin',
  depthLayer: 'play',
  at: [x, KADO_DRY_DOCK.centerY + sign * 6.8, FLOOR],
  heightM: 12.4,
  radiusM: 0.14,
})));

/** ガントリーの脚。高台 solid を跨ぐ 4 本。 */
const gantryLegs = seq(4, (i) => {
  const sx = i % 2 === 0 ? -1 : 1;
  const sy = i < 2 ? -1 : 1;
  return {
    id: `kado-gantry-leg-${i}`,
    kind: 'gantryLeg',
    occlusionClass: 'thin',
    depthLayer: 'play',
    at: [
      KADO_GANTRY.centerM[0] + sx * KADO_GANTRY.legSpanX / 2,
      KADO_GANTRY.centerM[1] + sy * KADO_GANTRY.legSpanY / 2,
      FLOOR,
    ],
    heightM: KADO_GANTRY.portalZ - FLOOR,
    radiusM: KADO_GANTRY.legRadiusM,
  };
});

/**
 * 入口の門柱（船台マスト）。前進スポーンからの導線が最優先（§3 / 入口に背の高い要素と照明）。
 * 西＝階段 x の足元、南＝階段 y の足元、東＝移動リング側からの進入口。
 */
const ENTRANCES = Object.freeze([
  { id: 'west', gate: [30.4, -50.3], spread: [0, 2.3], mastH: 11.2, yaw: 0 },
  { id: 'south', gate: [42.3, -66.2], spread: [2.4, 0], mastH: 9.6, yaw: Math.PI / 2 },
  { id: 'east', gate: [72.4, -44.0], spread: [0, 2.6], mastH: 10.4, yaw: 0 },
]);
const entranceMasts = ENTRANCES.flatMap(entrance => [-1, 1].map(sign => ({
  id: `kado-gate-mast-${entrance.id}-${sign > 0 ? 'a' : 'b'}`,
  kind: 'gateMast',
  occlusionClass: 'thin',
  depthLayer: 'play',
  at: [
    entrance.gate[0] + sign * entrance.spread[0],
    entrance.gate[1] + sign * entrance.spread[1],
    FLOOR,
  ],
  heightM: entrance.mastH,
  radiusM: 0.24,
  entranceId: entrance.id,
})));
const entranceYards = ENTRANCES.map(entrance => ({
  id: `kado-gate-yard-${entrance.id}`,
  kind: 'gateYard',
  occlusionClass: 'overhead',
  depthLayer: 'near',
  at: [entrance.gate[0], entrance.gate[1], FLOOR],
  heightM: entrance.mastH,
  spread: entrance.spread,
  yawRad: entrance.yaw,
  entranceId: entrance.id,
}));
/** 入口の灯。門柱の少し内側（拠点側）へ 2 基ずつ。灯モチーフの中スケール。 */
const LAMP_INSET = Object.freeze({ west: [2.6, 0], south: [0, 2.8], east: [-2.6, 0] });
const entranceLamps = ENTRANCES.flatMap(entrance => [-1, 1].map(sign => ({
  id: `kado-gate-lamp-${entrance.id}-${sign > 0 ? 'a' : 'b'}`,
  kind: 'lamp',
  occlusionClass: 'thin',
  depthLayer: 'play',
  at: [
    entrance.gate[0] + LAMP_INSET[entrance.id][0] + sign * entrance.spread[0] * 1.35,
    entrance.gate[1] + LAMP_INSET[entrance.id][1] + sign * entrance.spread[1] * 1.35,
    FLOOR,
  ],
  heightM: 4.4,
})));

/** 大スケールの肋材（建造中の船を跨ぐ 2 本）。足は細く、迫り上がりは頭上。 */
const largeRibs = [52.0, 66.4].map((x, i) => ({
  id: `kado-frame-rib-large-${i}`,
  kind: 'frameRibLarge',
  occlusionClass: 'split',      // 足=thin / 迫り=overhead に分割して生成する
  depthLayer: 'near',
  at: [x, KADO_DRY_DOCK.centerY, FLOOR],
  spanM: KADO_RIB_SCALES.large.spanM,
  heightM: KADO_RIB_SCALES.large.heightM,
}));

/** 植生。プレイ空間には疎、境界には密（§3.5）。当たり判定なしの柔らかい遮蔽。 */
const vegetation = [
  { id: 'kado-tree-play-0', kind: 'tree', occlusionClass: 'soft', depthLayer: 'play', at: [69.5, -57.5, FLOOR], heightM: 6.2, seed: 41 },
  { id: 'kado-tree-play-1', kind: 'tree', occlusionClass: 'soft', depthLayer: 'play', at: [49.5, -63.5, FLOOR], heightM: 5.4, seed: 47 },
  { id: 'kado-tree-play-2', kind: 'tree', occlusionClass: 'soft', depthLayer: 'play', at: [67.0, -31.5, FLOOR], heightM: 5.8, seed: 53 },
  { id: 'kado-planting-edge-0', kind: 'plantingBed', occlusionClass: 'soft', depthLayer: 'play', at: [58, -71.5, FLOOR], width: 16, depth: 4, count: 7, seed: 59 },
  { id: 'kado-planting-edge-1', kind: 'plantingBed', occlusionClass: 'soft', depthLayer: 'play', at: [78.5, -50, FLOOR], width: 4, depth: 16, count: 7, seed: 61 },
  { id: 'kado-planting-edge-2', kind: 'plantingBed', occlusionClass: 'soft', depthLayer: 'play', at: [78.5, -30, FLOOR], width: 4, depth: 14, count: 6, seed: 67 },
  { id: 'kado-planting-edge-3', kind: 'plantingBed', occlusionClass: 'soft', depthLayer: 'play', at: [34, -71.5, FLOOR], width: 14, depth: 4, count: 6, seed: 71 },
];

/**
 * 遠景（層3・4）。**競技境界の外側にしか置かない**ので遮蔽制限の対象外。
 * 角の地平線は「乾ドックのガントリー列」であり、他区画とシルエットが被らない。
 */
const backdrop = [
  ...seq(6, (i) => ({
    id: `kado-backdrop-gantry-${i}`,
    kind: 'backdropGantry',
    occlusionClass: 'backdrop',
    depthLayer: 'city',
    at: [26 + i * 19, -101 - (i % 3) * 6, 0],
    spanM: 17 + (i % 3) * 5,
    heightM: 27 + (i % 4) * 7,
    seed: 80 + i,
  })),
  ...seq(5, (i) => ({
    id: `kado-backdrop-mass-${i}`,
    kind: 'backdropMass',
    occlusionClass: 'backdrop',
    depthLayer: 'city',
    at: [138 + (i % 2) * 14, -34 - i * 17, 0],
    massKind: ['tower', 'block', 'ridge', 'crag', 'block'][i],
    width: 13 + i * 2,
    depth: 12 + i,
    height: 22 + i * 6,
    seed: 90 + i,
  })),
];

/** 配置データの全体。`buildKadoArchitecture` はこの配列だけを見て生成する。 */
export const KADO_PLACEMENTS = Object.freeze([
  // --- 当たり判定の箱を建築で包む（汎用の壁体・階段・欄干。共有してよい部分） ---
  { id: 'kado-wrapped-solids', kind: 'wrappedSolids', occlusionClass: 'wrapped', depthLayer: 'play' },

  // --- 乾ドック（床・側壁・盤木）。すべて ground 級 ---
  { id: 'kado-dock-floor', kind: 'dockFloor', occlusionClass: 'ground', depthLayer: 'play', at: [56, -44, FLOOR] },
  { id: 'kado-dock-coping-north', kind: 'dockCoping', occlusionClass: 'ground', depthLayer: 'play', at: [60, KADO_DRY_DOCK.centerY + KADO_DRY_DOCK.halfWidth, FLOOR], lengthM: 28, side: 1 },
  { id: 'kado-dock-coping-south', kind: 'dockCoping', occlusionClass: 'ground', depthLayer: 'play', at: [60, KADO_DRY_DOCK.centerY - KADO_DRY_DOCK.halfWidth, FLOOR], lengthM: 28, side: -1 },
  { id: 'kado-keel-blocks', kind: 'keelBlocks', occlusionClass: 'ground', depthLayer: 'play', at: [58, KADO_DRY_DOCK.centerY, FLOOR] },
  { id: 'kado-approach-lanes', kind: 'approachLanes', occlusionClass: 'ground', depthLayer: 'play', at: [56, -44, FLOOR] },

  // --- 船体（この区画の主役。巨大な船腹の曲面） ---
  { id: 'kado-hull', kind: 'hull', occlusionClass: 'overhead', depthLayer: 'near', at: [KADO_HULL.centerM[0], KADO_HULL.centerM[1], 0] },
  ...bilgeShores,

  // --- 整備足場 ---
  ...stagingStandards,
  { id: 'kado-staging-north', kind: 'staging', occlusionClass: 'overhead', depthLayer: 'near', at: [56.8, KADO_DRY_DOCK.centerY + 6.8, 0], side: 1 },
  { id: 'kado-staging-south', kind: 'staging', occlusionClass: 'overhead', depthLayer: 'near', at: [56.8, KADO_DRY_DOCK.centerY - 6.8, 0], side: -1 },

  // --- 整備ガントリー（中ランドマーク） ---
  ...gantryLegs,
  { id: 'kado-gantry-portal', kind: 'gantryPortal', occlusionClass: 'overhead', depthLayer: 'near', at: [KADO_GANTRY.centerM[0], KADO_GANTRY.centerM[1], 0] },

  // --- 3スケールの肋材 ---
  ...largeRibs,
  { id: 'kado-frame-rib-small-row', kind: 'frameRibSmallRow', occlusionClass: 'ground', depthLayer: 'play', at: [60, KADO_DRY_DOCK.centerY, FLOOR] },

  // --- 入口（背の高い要素＋照明で進む方向を示す） ---
  ...entranceMasts,
  ...entranceYards,
  ...entranceLamps,

  // --- 機械室の上に載る送水管（プレイ帯より上。壁体の輪郭を破る） ---
  { id: 'kado-pump-pipes-north', kind: 'pumpPipes', occlusionClass: 'overhead', depthLayer: 'near', at: [52.5, -30, 0], solidTopZ: 11, lengthM: 8.4 },
  { id: 'kado-pump-pipes-south', kind: 'pumpPipes', occlusionClass: 'overhead', depthLayer: 'near', at: [59.5, -58, 0], solidTopZ: 12, lengthM: 8.4 },

  // --- 植生と遠景 ---
  ...vegetation,
  ...backdrop,
]);

/* ------------------------------------------------------------------ *
 * 2. solids の読み出し（読むだけ。1 バイトも変更しない）
 * ------------------------------------------------------------------ */

/** 角拠点に属する当たり判定 AABB を返す。入力側は変更しない。 */
export function kadoCollisionSolids() {
  return buildOshioiFlashpointGeometry().solids
    .filter(solid => typeof solid.id === 'string' && solid.id.includes('-kado-'));
}

/** ドック床として自前で作り込む pad（汎用 paving で上書きしないため wrap から外す）。 */
export const KADO_SELF_PAVED_SOLID_ID = 'flash-site-kado-objective-pad';

/* ------------------------------------------------------------------ *
 * 3. 生成ヘルパ（Y-up ローカル。arch_kit の bakeParts と同じ規約）
 * ------------------------------------------------------------------ */

/** ゲーム相対 (dx, dy, dz) → ローカル (lx, ly, lz)。lx=+x / ly=+z / lz=-y。 */
const local = (dx, dy, dz) => [dx, dz, -dy];

function createSink(THREE) {
  const parts = [];
  const add = (geometry, material, {
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    tint = [1, 1, 1],
    shade = [0.68, 1.0],
  } = {}) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
      new THREE.Vector3().fromArray(Array.isArray(scale) ? scale : [scale, scale, scale]),
    );
    parts.push({ geometry, material, matrix, tint, shade });
  };
  return { parts, add };
}

/** マテリアル別に 1 メッシュへ畳み、縦グラデーションの頂点色を焼く。 */
function bake(THREE, parts, name) {
  const group = new THREE.Group();
  group.name = name;
  const prepared = [];
  let minY = Infinity; let maxY = -Infinity;
  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (!source.attributes.normal) source.computeVertexNormals();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position.clone());
    geometry.setAttribute('normal', source.attributes.normal.clone());
    geometry.applyMatrix4(part.matrix);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const y = position.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    prepared.push({ geometry, part });
  }
  const span = Math.max(1e-6, maxY - minY);
  const buckets = new Map();
  for (const { geometry, part } of prepared) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const [low, high] = part.shade;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) - minY) / span;
      const k = low + (high - low) * t;
      colors[i * 3 + 0] = part.tint[0] * k;
      colors[i * 3 + 1] = part.tint[1] * k;
      colors[i * 3 + 2] = part.tint[2] * k;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const key = part.material?.uuid || 'none';
    const bucket = buckets.get(key) || { material: part.material, geometries: [] };
    bucket.geometries.push(geometry);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const mesh = new THREE.Mesh(concat(THREE, bucket.geometries), bucket.material);
    mesh.name = `${name}-${bucket.material?.userData?.archMaterial || 'part'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    markDecorative(mesh);
    group.add(mesh);
  }
  markDecorative(group);
  return group;
}

function concat(THREE, geometries) {
  if (geometries.length === 1) return geometries[0];
  let total = 0;
  for (const geometry of geometries) total += geometry.attributes.position.count;
  const position = new Float32Array(total * 3);
  const normal = new Float32Array(total * 3);
  const color = new Float32Array(total * 3);
  let offset = 0;
  for (const geometry of geometries) {
    position.set(geometry.attributes.position.array, offset * 3);
    normal.set(geometry.attributes.normal.array, offset * 3);
    color.set(geometry.attributes.color.array, offset * 3);
    offset += geometry.attributes.position.count;
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
  return merged;
}

/**
 * 2D 折れ線に沿って角材を通す（ローカル XY 平面。肋材・ガントリー・マストの共通部品）。
 * これ 1 つを 3 スケールで反復するのが §3.2 の「部品を増やさず密度を上げる」の実装。
 */
function polyBeam(THREE, sink, points, { width = 0.3, thickness = 0.3, material, shade = [0.55, 1.0], z = 0 }) {
  for (let i = 0; i < points.length - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const dx = x1 - x0; const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length < 1e-4) continue;
    sink.add(new THREE.BoxGeometry(length + width * 0.6, width, thickness), material, {
      position: [(x0 + x1) / 2, (y0 + y1) / 2, z],
      rotation: [0, 0, Math.atan2(dy, dx)],
      shade,
    });
  }
}

/** 船の肋材（フレーム）断面: 直線の側面＋曲面の湾曲部（§3.7 壁は直線・開口は曲線）。 */
function ribProfilePoints(span, height, segments = 7) {
  const half = span / 2;
  const shoulder = height * 0.52;
  const points = [[-half, 0], [-half, shoulder * 0.55], [-half * 0.985, shoulder]];
  for (let i = 1; i <= segments * 2 - 1; i++) {
    const t = i / (segments * 2);
    const angle = Math.PI * t;
    points.push([
      -Math.cos(angle) * half * 0.985,
      shoulder + Math.sin(angle * 0.5) ** 1.35 * (height - shoulder) * (1 - (Math.cos(angle) + 1) * 0.0),
    ]);
  }
  // 上式は左右非対称になりうるので、明示的に頂点と右側を作り直す
  points.length = 3;
  for (let i = 1; i < segments * 2; i++) {
    const t = i / (segments * 2);
    const angle = Math.PI * t;
    points.push([-Math.cos(angle) * half * 0.985, shoulder + Math.sin(angle) ** 0.78 * (height - shoulder)]);
  }
  points.push([half * 0.985, shoulder], [half, shoulder * 0.55], [half, 0]);
  return points;
}

/* ------------------------------------------------------------------ *
 * 4. 固有の造形
 * ------------------------------------------------------------------ */

/**
 * 船体。ステーション（横断面）を長さ方向に補間したロフト。
 * 断面は「平らな船底 → 湾曲したビルジ → ほぼ垂直の船腹 → 甲板のタンブルホーム」。
 * 船底=藍（唯一の寒色）／船腹=貝灰漆喰の白／喫水線=金の細帯。
 */
function buildHull(THREE, materials, {
  lengthM, beamM, depthM, stations, waterlineRatio,
}) {
  const sink = createSink(THREE);
  // 断面の輪郭（半舷）: [半幅比, 深さ比]
  const section = [
    [0.00, 0.000], [0.30, 0.010], [0.56, 0.048], [0.78, 0.148],
    [0.92, 0.310], [0.995, 0.520], [1.000, 0.760], [0.965, 0.920], [0.905, 1.000],
  ];
  const halfBeam = beamM / 2;
  const plan = (t) => Math.max(0.001, Math.sin(Math.PI * Math.min(1, Math.max(0, t))) ** 0.52) * (0.62 + 0.38 * (1 - Math.abs(t - 0.42) * 1.2));
  const keelRise = (t) => (t > 0.74 ? ((t - 0.74) / 0.26) ** 2 * depthM * 0.34 : 0)
    + (t < 0.14 ? ((0.14 - t) / 0.14) ** 2 * depthM * 0.16 : 0);
  const sheer = (t) => depthM * (0.055 * (2 * t - 1) ** 2 + 0.05 * Math.max(0, t - 0.6));

  const ring = [];
  for (let s = 0; s <= stations; s++) {
    const t = s / stations;
    const x = -lengthM / 2 + t * lengthM;
    const beamScale = Math.min(1, plan(t));
    const rise = keelRise(t);
    const top = depthM + sheer(t);
    const pts = [];
    for (let i = section.length - 1; i >= 0; i--) {
      pts.push([x, rise + section[i][1] * (top - rise), -section[i][0] * halfBeam * beamScale]);
    }
    for (let i = 1; i < section.length; i++) {
      pts.push([x, rise + section[i][1] * (top - rise), section[i][0] * halfBeam * beamScale]);
    }
    ring.push(pts);
  }

  const wl = waterlineRatio;
  const hullTris = [];
  const bottomTris = [];
  const push = (target, a, b, c) => { target.push(...a, ...b, ...c); };
  for (let s = 0; s < stations; s++) {
    const a = ring[s]; const b = ring[s + 1];
    for (let i = 0; i < a.length - 1; i++) {
      const ratio = i / (a.length - 1);
      const isBottom = section[Math.min(section.length - 1, Math.abs(i - (section.length - 1)))][1] < wl;
      const target = isBottom ? bottomTris : hullTris;
      push(target, a[i], b[i], b[i + 1]);
      push(target, a[i], b[i + 1], a[i + 1]);
      void ratio;
    }
  }
  // 甲板（平面。上から見たときのシルエットを閉じる）
  const deckTris = [];
  for (let s = 0; s < stations; s++) {
    const a = ring[s]; const b = ring[s + 1];
    const last = a.length - 1;
    push(deckTris, a[0], b[0], b[last]);
    push(deckTris, a[0], b[last], a[last]);
  }

  const mesh = (tris, material, shade) => {
    if (!tris.length) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tris), 3));
    geometry.computeVertexNormals();
    sink.add(geometry, material, { shade });
  };
  mesh(bottomTris, materials.indigo, [0.5, 0.95]);
  mesh(hullTris, materials.plaster, [0.62, 1.02]);
  mesh(deckTris, materials.timber, [0.9, 1.0]);

  // 喫水線（金の細帯）— 差し色は面積を絞る
  const wlY = depthM * wl;
  for (const sign of [-1, 1]) {
    for (let s = 0; s < stations; s++) {
      const t0 = s / stations; const t1 = (s + 1) / stations;
      const x0 = -lengthM / 2 + t0 * lengthM; const x1 = -lengthM / 2 + t1 * lengthM;
      const z0 = sign * halfBeam * Math.min(1, plan(t0)) * 0.99;
      const z1 = sign * halfBeam * Math.min(1, plan(t1)) * 0.99;
      const dx = x1 - x0; const dz = z1 - z0;
      sink.add(new THREE.BoxGeometry(Math.hypot(dx, dz) * 1.02, 0.22, 0.14), materials.gold, {
        position: [(x0 + x1) / 2, wlY + keelRise((t0 + t1) / 2) * 0.6, (z0 + z1) / 2],
        rotation: [0, -Math.atan2(dz, dx), 0],
        shade: [1.0, 1.12],
      });
    }
  }
  // 外板の継ぎ目（小スケールの反復）と肋材の通り（中スケール）
  for (const sign of [-1, 1]) {
    for (let k = 0; k < 3; k++) {
      const y = depthM * (0.6 + k * 0.13);
      for (let s = 0; s < stations; s += 1) {
        const t0 = s / stations; const t1 = (s + 1) / stations;
        const x0 = -lengthM / 2 + t0 * lengthM; const x1 = -lengthM / 2 + t1 * lengthM;
        const z0 = sign * halfBeam * Math.min(1, plan(t0)) * 0.985;
        const z1 = sign * halfBeam * Math.min(1, plan(t1)) * 0.985;
        sink.add(new THREE.BoxGeometry(Math.hypot(x1 - x0, z1 - z0) * 1.02, 0.1, 0.08), materials.plasterShade, {
          position: [(x0 + x1) / 2, y, (z0 + z1) / 2],
          rotation: [0, -Math.atan2(z1 - z0, x1 - x0), 0],
          shade: [0.75, 0.9],
        });
      }
    }
    for (let s = 2; s < stations - 1; s += 2) {
      const t = s / stations;
      const x = -lengthM / 2 + t * lengthM;
      const z = sign * halfBeam * Math.min(1, plan(t)) * 0.99;
      sink.add(new THREE.BoxGeometry(0.16, depthM * 0.42, 0.12), materials.timber, {
        position: [x, depthM * 0.72, z],
        shade: [0.6, 1.0],
      });
    }
  }
  // 船尾の舵と軸（角にしか無いシルエット）
  sink.add(new THREE.BoxGeometry(2.2, 3.4, 0.34), materials.indigo, {
    position: [-lengthM / 2 + 1.2, depthM * 0.16, 0], shade: [0.5, 0.85],
  });
  sink.add(new THREE.CylinderGeometry(0.9, 0.9, 1.4, 10), materials.gold, {
    position: [-lengthM / 2 + 2.6, depthM * 0.2, 0], rotation: [0, 0, Math.PI / 2], shade: [0.9, 1.1],
  });
  // 船首の錨鎖孔
  for (const sign of [-1, 1]) {
    sink.add(new THREE.CylinderGeometry(0.34, 0.34, 0.5, 8), materials.gold, {
      position: [lengthM / 2 - 2.4, depthM * 0.86, sign * halfBeam * 0.28],
      rotation: [0, 0, Math.PI / 2], shade: [0.95, 1.1],
    });
  }
  return bake(THREE, sink.parts, 'kado-hull-body');
}

/** 乾ドックの床。大判の石畳＋動線ライン＋注水溝（§3.6 床は必ずパターンを入れる）。 */
function buildDockFloor(THREE, kit, materials) {
  const group = new THREE.Group();
  group.name = 'kado-dock-floor-body';
  const paving = kit.createPavingPatch({
    width: 18, depth: 18, tileSizeM: 3.0, joint: 0.12, seed: 31,
    lanes: [
      { from: [-9, 3.6], to: [9, 3.6], width: 0.42 },     // 西→東の主動線
      { from: [-9, -3.6], to: [9, -3.6], width: 0.42 },
      { from: [-1.4, -9], to: [-1.4, 9], width: 0.34 },   // 南口からの導線
      { from: [0, -0.2], to: [0, 0.2], width: 8.6 },      // 竜骨線（金）
    ],
    name: 'kado-dock-paving',
  });
  paving.position.y = 0.0;
  group.add(paving);

  const sink = createSink(THREE);
  // 注水溝（両舷の暗い溝）。床を単色にしない
  for (const sign of [-1, 1]) {
    sink.add(new THREE.BoxGeometry(18, 0.1, 0.7), materials.stoneJoint, {
      position: [0, 0.1, sign * 7.4], shade: [0.55, 0.7],
    });
    for (let i = 0; i < 7; i++) {
      sink.add(new THREE.BoxGeometry(0.5, 0.14, 0.78), materials.gold, {
        position: [-7.6 + i * 2.55, 0.14, sign * 7.4], shade: [0.95, 1.1],
      });
    }
  }
  // 排水口（中心の集水枡）
  sink.add(new THREE.CylinderGeometry(0.85, 0.85, 0.16, 12), materials.stoneJoint, {
    position: [0, 0.11, 0], shade: [0.5, 0.7],
  });
  group.add(bake(THREE, sink.parts, 'kado-dock-drains'));
  markDecorative(group);
  return group;
}

/** ドックの段状側壁（コーピング）。3 段で 0.42 m。遮蔽にならない高さに留める。 */
function buildDockCoping(THREE, materials, { lengthM, side }) {
  const sink = createSink(THREE);
  const { copingSteps, copingRiseM } = KADO_DRY_DOCK;
  for (let i = 0; i < copingSteps; i++) {
    const width = 1.5 - i * 0.42;
    const y = copingRiseM * (i + 0.5);
    sink.add(new THREE.BoxGeometry(lengthM, copingRiseM, width), materials.stone, {
      position: [0, y, side * (i * 0.42) * -1],
      shade: [0.6 + i * 0.1, 0.95 + i * 0.05],
    });
  }
  // 縁の金線（動線を示す）
  sink.add(new THREE.BoxGeometry(lengthM, 0.05, 0.16), materials.gold, {
    position: [0, copingSteps * copingRiseM + 0.02, side * 0.6], shade: [1.0, 1.1],
  });
  // 係船柱（低い。0.42 m 以下に抑える）
  for (let i = 0; i < 8; i++) {
    sink.add(new THREE.CylinderGeometry(0.2, 0.26, 0.4, 8), materials.timber, {
      position: [-lengthM / 2 + 1.8 + i * (lengthM - 3.6) / 7, 0.2, side * 1.15],
      shade: [0.6, 0.95],
    });
  }
  return bake(THREE, sink.parts, 'kado-dock-coping-body');
}

/** 盤木（キールブロック）列。船体の真下に並び、竜骨線を地面へ写す。 */
function buildKeelBlocks(THREE, materials) {
  const sink = createSink(THREE);
  const { keelBlockCount } = KADO_DRY_DOCK;
  for (let i = 0; i < keelBlockCount; i++) {
    const x = -14 + i * (28 / (keelBlockCount - 1));
    for (let layer = 0; layer < 3; layer++) {
      const w = 1.7 - layer * 0.22;
      const d = 1.15 - layer * 0.18;
      sink.add(new THREE.BoxGeometry(layer % 2 ? d : w, 0.14, layer % 2 ? w : d), materials.timber, {
        position: [x, 0.07 + layer * 0.14, 0],
        rotation: [0, 0, 0],
        shade: [0.55 + layer * 0.12, 0.85 + layer * 0.08],
      });
    }
  }
  return bake(THREE, sink.parts, 'kado-keel-blocks-body');
}

/** 拠点へ向かう動線ライン（床の金帯）。入口 → ドックの向きを示す。 */
function buildApproachLanes(THREE, materials) {
  const sink = createSink(THREE);
  const lanes = [
    { from: [-25, -6.2], to: [-9.5, -6.2], width: 0.4 },   // 西の階段から
    { from: [-14.2, -22], to: [-14.2, -9.5], width: 0.4 }, // 南の階段から
    { from: [9.5, 0], to: [17.5, 0], width: 0.4 },         // 東の移動リングから
  ];
  for (const lane of lanes) {
    const dx = lane.to[0] - lane.from[0];
    const dy = lane.to[1] - lane.from[1];
    const length = Math.hypot(dx, dy);
    sink.add(new THREE.BoxGeometry(length, 0.06, lane.width), materials.gold, {
      position: [(lane.from[0] + lane.to[0]) / 2, 0.05, -(lane.from[1] + lane.to[1]) / 2],
      rotation: [0, -Math.atan2(dy, dx), 0],
      shade: [1.0, 1.1],
    });
    // 破線の刻み（大判の石畳に載る目地。単色を避ける）
    const ticks = Math.max(2, Math.round(length / 2.4));
    for (let i = 0; i <= ticks; i++) {
      const t = i / ticks;
      sink.add(new THREE.BoxGeometry(0.34, 0.05, lane.width * 2.6), materials.stoneJoint, {
        position: [lane.from[0] + dx * t, 0.045, -(lane.from[1] + dy * t)],
        rotation: [0, -Math.atan2(dy, dx), 0],
        shade: [0.6, 0.75],
      });
    }
  }
  return bake(THREE, sink.parts, 'kado-approach-lanes-body');
}

/** 船体を支える支柱（ビルジシャー）。細い斜材。 */
function buildBilgeShore(THREE, materials, { at, toward, radiusM }) {
  const sink = createSink(THREE);
  const dx = toward[0] - at[0];
  const dy = toward[1] - at[1];
  const dz = toward[2] - at[2];
  const length = Math.hypot(dx, dy, dz);
  const dir = local(dx, dy, dz);
  const axis = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
  const quaternion = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  sink.add(new THREE.CylinderGeometry(radiusM * 0.82, radiusM, length, 7), materials.timber, {
    position: [dir[0] / 2, dir[1] / 2, dir[2] / 2],
    rotation: [euler.x, euler.y, euler.z],
    shade: [0.45, 0.95],
  });
  // 根元の楔（盤木と同じモチーフの小スケール反復）
  sink.add(new THREE.BoxGeometry(0.62, 0.24, 0.62), materials.stone, {
    position: [0, 0.12, 0], shade: [0.6, 0.9],
  });
  return bake(THREE, sink.parts, 'kado-bilge-shore-body');
}

/** 細い垂直材（足場のスタンダード／ガントリーの脚／門柱の共通実装）。 */
function buildMast(THREE, materials, { heightM, radiusM, capMaterial = null, ringsFrom = 3.4 }) {
  const sink = createSink(THREE);
  sink.add(new THREE.CylinderGeometry(radiusM * 0.78, radiusM, heightM, 8), materials.timber, {
    position: [0, heightM / 2, 0], shade: [0.42, 0.95],
  });
  sink.add(new THREE.BoxGeometry(radiusM * 3.0, 0.26, radiusM * 3.0), materials.stone, {
    position: [0, 0.13, 0], shade: [0.6, 0.9],
  });
  // 継手の環（小スケールの反復）。プレイ帯に太い形を作らないよう半径を抑える
  for (let y = ringsFrom; y < heightM - 0.4; y += 2.6) {
    sink.add(new THREE.CylinderGeometry(radiusM * 1.25, radiusM * 1.25, 0.16, 8), materials.gold, {
      position: [0, y, 0], shade: [0.95, 1.1],
    });
  }
  if (capMaterial) {
    sink.add(new THREE.ConeGeometry(radiusM * 1.5, radiusM * 3.2, 8), capMaterial, {
      position: [0, heightM + radiusM * 1.6, 0], shade: [1.0, 1.12],
    });
  }
  return bake(THREE, sink.parts, 'kado-mast-body');
}

/** 整備足場（多層のデッキ＋中スケールの肋材）。頭上のみ。 */
function buildStaging(THREE, materials, { side }) {
  const sink = createSink(THREE);
  const levels = [9.6, 12.8, 16.0];
  const lengthM = 24;
  for (const z of levels) {
    const y = z - 0;
    sink.add(new THREE.BoxGeometry(lengthM, 0.16, 1.9), materials.timber, {
      position: [0, y, 0], shade: [0.7, 1.0],
    });
    // 手すり（汎用の欄干相当。細い）
    sink.add(new THREE.BoxGeometry(lengthM, 0.09, 0.09), materials.plasterShade, {
      position: [0, y + 1.0, side * -0.9], shade: [0.9, 1.05],
    });
    sink.add(new THREE.BoxGeometry(lengthM, 0.07, 0.07), materials.plasterShade, {
      position: [0, y + 0.55, side * -0.9], shade: [0.85, 1.0],
    });
    for (let i = 0; i <= 12; i++) {
      sink.add(new THREE.BoxGeometry(0.08, 1.0, 0.08), materials.plasterShade, {
        position: [-lengthM / 2 + i * (lengthM / 12), y + 0.5, side * -0.9], shade: [0.8, 1.0],
      });
    }
  }
  // 中スケールの肋材（足場のベイ枠）— 大肋材と同じ断面を 4.6 m で反復
  const { spanM, heightM, thicknessM } = KADO_RIB_SCALES.medium;
  for (let i = 0; i < KADO_RIB_SCALES.medium.count; i++) {
    const x = -lengthM / 2 + 1.6 + i * ((lengthM - 3.2) / (KADO_RIB_SCALES.medium.count - 1));
    const points = ribProfilePoints(spanM, heightM, 5).map(([px, py]) => [px * 0.36, py]);
    polyBeam(THREE, sink, points, {
      width: thicknessM, thickness: thicknessM, material: materials.timber, shade: [0.55, 0.95], z: 0,
    });
    // ローカル X は船首尾方向なので、肋材は 90 度振って舷側に立てる必要がある。
    // polyBeam は XY 平面に作るため、ここでは x 方向のオフセットだけ与える
    sink.parts.slice(-points.length + 1).forEach((part) => {
      part.matrix.premultiply(new THREE.Matrix4().makeTranslation(x, 9.6, 0));
    });
  }
  // 斜路（ラダー）。プレイ帯には入れない
  for (let i = 0; i < 2; i++) {
    const from = [-6 + i * 12, 9.6];
    const to = [-2.4 + i * 12, 12.8];
    polyBeam(THREE, sink, [from, to], {
      width: 0.22, thickness: 0.7, material: materials.timber, shade: [0.6, 0.95],
    });
  }
  return bake(THREE, sink.parts, 'kado-staging-body');
}

/** 整備ガントリー上部（門形＋マスト＋ジブ）。中ランドマーク。 */
function buildGantryPortal(THREE, materials) {
  const sink = createSink(THREE);
  const { legSpanX, legSpanY, portalZ, mastTopZ, jibZ, jibToX, counterJibToX, centerM } = KADO_GANTRY;
  const hx = legSpanX / 2;
  const hz = legSpanY / 2;   // ローカル Z（= -ゲーム y）方向の半間隔
  const braceFrom = FLOOR + 2.6;

  // 脚の間の斜材（プレイ帯より上でだけ結ぶ）
  for (const sz of [-1, 1]) {
    polyBeam(THREE, sink, [[-hx, braceFrom], [hx, portalZ - 2.2]], {
      width: 0.2, thickness: 0.2, material: materials.timber, shade: [0.5, 0.9], z: sz * hz,
    });
    polyBeam(THREE, sink, [[hx, braceFrom], [-hx, portalZ - 2.2]], {
      width: 0.2, thickness: 0.2, material: materials.timber, shade: [0.5, 0.9], z: sz * hz,
    });
    // 水平の繋ぎ
    for (const y of [portalZ - 2.2, portalZ]) {
      sink.add(new THREE.BoxGeometry(legSpanX, 0.3, 0.3), materials.plasterShade, {
        position: [0, y, sz * hz], shade: [0.8, 1.0],
      });
    }
  }
  for (const sx of [-1, 1]) {
    sink.add(new THREE.BoxGeometry(0.34, 0.34, legSpanY), materials.plasterShade, {
      position: [sx * hx, portalZ, 0], shade: [0.85, 1.0],
    });
  }
  // 門形の頂部トラス（大スケールの肋材と同じ断面）
  const portalPoints = ribProfilePoints(legSpanX + 1.2, 3.4, 5)
    .map(([px, py]) => [px, portalZ + py]);
  for (const sz of [-1, 1]) {
    polyBeam(THREE, sink, portalPoints, {
      width: 0.28, thickness: 0.28, material: materials.plaster, shade: [0.75, 1.05], z: sz * hz,
    });
  }

  // 中央マスト（ランドマーク本体）
  const mastBase = portalZ + 3.0;
  for (const [ox, oz] of [[-0.9, -0.9], [0.9, -0.9], [-0.9, 0.9], [0.9, 0.9]]) {
    sink.add(new THREE.CylinderGeometry(0.16, 0.2, mastTopZ - mastBase, 7), materials.plaster, {
      position: [ox, (mastBase + mastTopZ) / 2, oz], shade: [0.7, 1.05],
    });
  }
  for (let y = mastBase + 1.2; y < mastTopZ; y += 2.4) {
    sink.add(new THREE.BoxGeometry(2.1, 0.16, 0.16), materials.timber, { position: [0, y, -0.9], shade: [0.7, 1.0] });
    sink.add(new THREE.BoxGeometry(2.1, 0.16, 0.16), materials.timber, { position: [0, y, 0.9], shade: [0.7, 1.0] });
    sink.add(new THREE.BoxGeometry(0.16, 0.16, 2.1), materials.timber, { position: [-0.9, y, 0], shade: [0.7, 1.0] });
    sink.add(new THREE.BoxGeometry(0.16, 0.16, 2.1), materials.timber, { position: [0.9, y, 0], shade: [0.7, 1.0] });
  }
  // 頂部の灯（東=橙）と金の頂華 — 3スケールの「灯」モチーフの最大
  sink.add(new THREE.SphereGeometry(0.86, 12, 8), materials.lampEast, {
    position: [0, mastTopZ + 0.6, 0], shade: [1, 1],
  });
  sink.add(new THREE.ConeGeometry(1.15, 2.1, 10), materials.gold, {
    position: [0, mastTopZ + 2.1, 0], shade: [1.0, 1.15],
  });

  // ジブ（船体の上を東へ渡る腕）と、釣り合いの後方腕
  const jibLocalTo = jibToX - centerM[0];
  const jibLocalBack = counterJibToX - centerM[0];
  for (const sz of [-1, 1]) {
    sink.add(new THREE.BoxGeometry(jibLocalTo - jibLocalBack, 0.36, 0.36), materials.plaster, {
      position: [(jibLocalTo + jibLocalBack) / 2, jibZ, sz * 0.95], shade: [0.85, 1.05],
    });
    sink.add(new THREE.BoxGeometry(jibLocalTo - jibLocalBack, 0.22, 0.22), materials.plasterShade, {
      position: [(jibLocalTo + jibLocalBack) / 2, jibZ - 1.5, sz * 0.95], shade: [0.7, 0.95],
    });
  }
  const bays = 14;
  for (let i = 0; i < bays; i++) {
    const x0 = jibLocalBack + (jibLocalTo - jibLocalBack) * (i / bays);
    const x1 = jibLocalBack + (jibLocalTo - jibLocalBack) * ((i + 1) / bays);
    for (const sz of [-1, 1]) {
      polyBeam(THREE, sink, [[x0, jibZ - 1.5], [x1, jibZ]], {
        width: 0.14, thickness: 0.14, material: materials.timber, shade: [0.6, 0.95], z: sz * 0.95,
      });
    }
  }
  // マストからジブを吊る索（藍。唯一の寒色を線で使う）
  polyBeam(THREE, sink, [[0, mastTopZ - 1.2], [jibLocalTo, jibZ]], {
    width: 0.1, thickness: 0.1, material: materials.indigo, shade: [0.8, 1.0],
  });
  polyBeam(THREE, sink, [[0, mastTopZ - 1.2], [jibLocalBack, jibZ]], {
    width: 0.1, thickness: 0.1, material: materials.indigo, shade: [0.8, 1.0],
  });
  // トロリーとフックブロック（頭上に留める）
  sink.add(new THREE.BoxGeometry(1.8, 0.8, 2.2), materials.plasterShade, {
    position: [jibLocalTo * 0.55, jibZ + 0.6, 0], shade: [0.85, 1.0],
  });
  sink.add(new THREE.BoxGeometry(0.09, 2.6, 0.09), materials.timber, {
    position: [jibLocalTo * 0.55, jibZ - 1.1, 0], shade: [0.7, 0.9],
  });
  sink.add(new THREE.BoxGeometry(0.9, 0.9, 0.9), materials.gold, {
    position: [jibLocalTo * 0.55, jibZ - 2.6, 0], shade: [0.95, 1.1],
  });
  return bake(THREE, sink.parts, 'kado-gantry-portal-body');
}

/**
 * 大スケールの肋材。足（プレイ帯）と迫り（頭上）を別ピースとして返す。
 * これにより「細い＝遮蔽にならない」ことを頂点で保証できる。
 */
function buildLargeRib(THREE, materials, { spanM, heightM }) {
  const split = FLOOR + KADO_OCCLUSION_RULES.overheadMinM;   // 7.2 m
  const { thicknessM } = KADO_RIB_SCALES.large;
  const points = ribProfilePoints(spanM, heightM, 6);
  const feet = [];
  for (const sign of [-1, 1]) {
    const sink = createSink(THREE);
    sink.add(new THREE.CylinderGeometry(thicknessM * 0.62, thicknessM * 0.78, split - FLOOR, 8), materials.plaster, {
      position: [0, (split - FLOOR) / 2, 0], shade: [0.5, 0.95],
    });
    sink.add(new THREE.BoxGeometry(0.86, 0.28, 0.86), materials.stone, {
      position: [0, 0.14, 0], shade: [0.6, 0.9],
    });
    const foot = bake(THREE, sink.parts, 'kado-frame-rib-foot');
    foot.userData.ribSign = sign;
    feet.push(foot);
  }
  const sink = createSink(THREE);
  const upper = points
    .map(([px, py]) => [px, py + FLOOR])
    .filter(([, py]) => py >= split - 0.01);
  // 足の頂点と迫りを繋ぐ短い立ち上がり
  const half = spanM / 2;
  const arch = [[-half, split], ...upper, [half, split]];
  polyBeam(THREE, sink, arch.map(([px, py]) => [px, py - FLOOR]), {
    width: thicknessM, thickness: thicknessM * 1.5, material: materials.plaster, shade: [0.7, 1.05],
  });
  // 肋材に渡る繋ぎ材（小スケールの反復）
  for (let i = 1; i < 5; i++) {
    const y = split - FLOOR + (heightM - (split - FLOOR)) * (i / 5);
    const w = half * 2 * (1 - (i / 5) ** 2.1) * 0.94;
    if (w < 0.6) continue;
    sink.add(new THREE.BoxGeometry(w, 0.14, 0.14), materials.timber, {
      position: [0, y, 0], shade: [0.65, 0.95],
    });
  }
  const archGroup = bake(THREE, sink.parts, 'kado-frame-rib-arch');
  return { feet, arch: archGroup, footOffset: half * 0.985 };
}

/** 小スケールの肋材（盤木受けの金物）。ドック縁に沿って反復。 */
function buildSmallRibRow(THREE, materials) {
  const sink = createSink(THREE);
  const { spanM, heightM, thicknessM, count } = KADO_RIB_SCALES.small;
  for (let i = 0; i < count; i++) {
    const x = -13.5 + i * (27 / (count - 1));
    for (const sign of [-1, 1]) {
      const points = ribProfilePoints(spanM, heightM, 3);
      const before = sink.parts.length;
      polyBeam(THREE, sink, points, {
        width: thicknessM, thickness: thicknessM, material: materials.stone, shade: [0.6, 0.95],
      });
      for (let k = before; k < sink.parts.length; k++) {
        sink.parts[k].matrix.premultiply(new THREE.Matrix4().makeTranslation(x, 0, sign * 5.4));
      }
    }
  }
  return bake(THREE, sink.parts, 'kado-frame-rib-small-body');
}

/** 入口の横桁（門）。マストの間に渡り、藍の旗と灯を吊る。 */
function buildGateYard(THREE, materials, { heightM, spread }) {
  const sink = createSink(THREE);
  const span = Math.hypot(spread[0], spread[1]) * 2;
  const y = heightM - 1.4;
  sink.add(new THREE.BoxGeometry(0.24, 0.24, span + 0.9), materials.plaster, {
    position: [0, y, 0], shade: [0.85, 1.05],
  });
  sink.add(new THREE.BoxGeometry(0.16, 0.16, span * 0.7), materials.gold, {
    position: [0, y + 0.9, 0], shade: [1.0, 1.12],
  });
  for (const sign of [-1, 1]) {
    polyBeam(THREE, sink, [[0, y], [0, y - 1.6]], {
      width: 0.12, thickness: 0.12, material: materials.timber, shade: [0.7, 0.95], z: sign * span * 0.42,
    });
    // 藍の幟（唯一の寒色）
    sink.add(new THREE.BoxGeometry(0.06, 2.6, 0.85), materials.indigo, {
      position: [0, y - 1.5, sign * span * 0.42], shade: [0.7, 1.0],
    });
    // 軒灯（灯モチーフの中スケール）
    sink.add(new THREE.SphereGeometry(0.3, 8, 6), materials.lampEast, {
      position: [0, y - 0.55, sign * span * 0.2], shade: [1, 1],
    });
  }
  return bake(THREE, sink.parts, 'kado-gate-yard-body');
}

/** 機械室の屋上を渡る送水管。壁体の輪郭を破り、近景シルエットを厚くする。 */
function buildPumpPipes(THREE, materials, { solidTopZ, lengthM }) {
  const sink = createSink(THREE);
  const base = solidTopZ + 0.6;
  for (const oz of [-1, 0, 1]) {
    sink.add(new THREE.CylinderGeometry(0.34, 0.34, lengthM, 9), materials.plasterShade, {
      position: [0, base + 0.9, oz * 1.1], rotation: [0, 0, Math.PI / 2], shade: [0.8, 1.02],
    });
    for (let i = -1; i <= 1; i += 2) {
      sink.add(new THREE.CylinderGeometry(0.42, 0.42, 0.3, 9), materials.gold, {
        position: [i * lengthM * 0.3, base + 0.9, oz * 1.1], rotation: [0, 0, Math.PI / 2], shade: [0.95, 1.1],
      });
    }
    // 立ち上がりの曲がり（屋根と開口は曲線 §3.7）
    const bend = [];
    for (let i = 0; i <= 6; i++) {
      const a = (i / 6) * (Math.PI / 2);
      bend.push([lengthM / 2 - 0.1 + Math.sin(a) * 1.3, base + 0.9 - (1 - Math.cos(a)) * 1.3]);
    }
    polyBeam(THREE, sink, bend, {
      width: 0.5, thickness: 0.5, material: materials.plasterShade, shade: [0.75, 1.0], z: oz * 1.1,
    });
  }
  // 支持架台
  for (let i = -1; i <= 1; i++) {
    sink.add(new THREE.BoxGeometry(0.3, 1.2, 3.6), materials.timber, {
      position: [i * lengthM * 0.34, base + 0.3, 0], shade: [0.6, 0.9],
    });
  }
  return bake(THREE, sink.parts, 'kado-pump-pipes-body');
}

/** 遠景の乾ドックガントリー列（境界外）。角の地平線を他区画と別物にする。 */
function buildBackdropGantry(THREE, materials, { spanM, heightM, seed }) {
  const random = archRandom(seed);
  const sink = createSink(THREE);
  const half = spanM / 2;
  for (const sx of [-1, 1]) {
    sink.add(new THREE.BoxGeometry(1.5, heightM, 1.5), materials.silhouette, {
      position: [sx * half, heightM / 2, 0], shade: [0.45, 0.9],
    });
  }
  sink.add(new THREE.BoxGeometry(spanM + 3, 1.8, 1.8), materials.silhouette, {
    position: [0, heightM, 0], shade: [0.8, 1.0],
  });
  sink.add(new THREE.BoxGeometry(spanM * 0.9, 1.1, 1.1), materials.silhouette, {
    position: [half * 0.5, heightM + 4.2 + random() * 2, 0], shade: [0.85, 1.0],
  });
  sink.add(new THREE.BoxGeometry(1.0, 5.4, 1.0), materials.silhouette, {
    position: [0, heightM + 2.4, 0], shade: [0.8, 1.0],
  });
  return bake(THREE, sink.parts, 'kado-backdrop-gantry-body');
}

/* ------------------------------------------------------------------ *
 * 5. 生成本体
 * ------------------------------------------------------------------ */

/**
 * 角（南東拠点）の建築を作る。
 * @param {object} THREE three モジュール（注入式）
 * @param {object} [options]
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 * @param {boolean} [options.merge=true]  マテリアル単位に畳んでドローコールを減らす
 * @param {boolean} [options.includeBackdrop=true]  境界外の遠景を含める
 * @param {object}  [options.kit]  既存の arch_kit を使い回す場合
 * @returns {THREE.Group} Z-up。`world` / `worldDressing` へそのまま add できる
 */
export function buildKadoArchitecture(THREE, options = {}) {
  const detail = options.detail || 'medium';
  const kit = options.kit || createArchKit(THREE, { detail });
  const materials = kit.materials;
  const includeBackdrop = options.includeBackdrop !== false;

  const root = new THREE.Group();
  root.name = 'kado-architecture';
  const manifest = [];

  const register = (node, placement) => {
    node.userData.kadoPieceId = placement.id;
    node.userData.occlusionClass = placement.occlusionClass;
    node.userData.depthLayer = placement.depthLayer;
    node.userData.siteId = 'kado';
    markDecorative(node);
    root.add(node);
    manifest.push({
      id: placement.id, kind: placement.kind,
      occlusionClass: placement.occlusionClass, depthLayer: placement.depthLayer,
    });
    return node;
  };

  for (const placement of KADO_PLACEMENTS) {
    if (placement.occlusionClass === 'backdrop' && !includeBackdrop) continue;
    switch (placement.kind) {
      case 'wrappedSolids': {
        const solids = kadoCollisionSolids()
          .filter(solid => solid.id !== KADO_SELF_PAVED_SOLID_ID);
        const wrapped = kit.wrapSolids(solids, {
          siteId: 'kado', seed: 61, detail, skipTags: ['ground', 'slab'], merge: false,
          name: 'kado-wrapped-solids',
        });
        register(wrapped, placement);
        break;
      }
      case 'dockFloor': {
        const node = buildDockFloor(THREE, kit, materials);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'dockCoping': {
        const node = buildDockCoping(THREE, materials, placement);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'keelBlocks': {
        const node = buildKeelBlocks(THREE, materials);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'approachLanes': {
        const node = buildApproachLanes(THREE, materials);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'hull': {
        const node = buildHull(THREE, materials, KADO_HULL);
        mountZUp(node, [placement.at[0], placement.at[1], KADO_HULL.keelZ]);
        register(node, placement);
        break;
      }
      case 'bilgeShore': {
        const node = buildBilgeShore(THREE, materials, placement);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'standard': {
        const node = buildMast(THREE, materials, {
          heightM: placement.heightM, radiusM: placement.radiusM, ringsFrom: 6.6,
        });
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'staging': {
        const node = buildStaging(THREE, materials, placement);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'gantryLeg': {
        const node = buildMast(THREE, materials, {
          heightM: placement.heightM, radiusM: placement.radiusM, ringsFrom: 6.6,
        });
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'gantryPortal': {
        const node = buildGantryPortal(THREE, materials);
        mountZUp(node, [placement.at[0], placement.at[1], 0]);
        register(node, placement);
        break;
      }
      case 'frameRibLarge': {
        const { feet, arch, footOffset } = buildLargeRib(THREE, materials, placement);
        feet.forEach((foot, index) => {
          const sign = foot.userData.ribSign;
          mountZUp(foot, [placement.at[0], placement.at[1] + sign * footOffset, FLOOR]);
          register(foot, {
            ...placement,
            id: `${placement.id}-foot-${index}`,
            kind: 'frameRibLargeFoot',
            occlusionClass: 'thin',
          });
        });
        // 迫り（頭上）。ローカル X は肋材の span 方向なので 90 度振ってゲーム y へ向ける
        mountZUp(arch, [placement.at[0], placement.at[1], FLOOR], Math.PI / 2);
        register(arch, { ...placement, id: `${placement.id}-arch`, occlusionClass: 'overhead' });
        break;
      }
      case 'frameRibSmallRow': {
        const node = buildSmallRibRow(THREE, materials);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'gateMast': {
        const node = buildMast(THREE, materials, {
          heightM: placement.heightM, radiusM: placement.radiusM,
          capMaterial: materials.gold, ringsFrom: 3.2,
        });
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'gateYard': {
        const node = buildGateYard(THREE, materials, placement);
        mountZUp(node, placement.at, placement.yawRad || 0);
        register(node, placement);
        break;
      }
      case 'lamp': {
        const node = kit.createLampPost({
          height: placement.heightM, side: 'east', detail, name: `${placement.id}-body`,
        });
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'pumpPipes': {
        const node = buildPumpPipes(THREE, materials, placement);
        mountZUp(node, [placement.at[0], placement.at[1], 0]);
        register(node, placement);
        break;
      }
      case 'tree': {
        const node = kit.createTree({
          height: placement.heightM, crownRadius: placement.heightM * 0.31,
          kind: 'pine', seed: placement.seed, detail, name: `${placement.id}-body`,
        });
        node.userData.softOcclusion = true;
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'plantingBed': {
        const node = kit.createPlantingBed({
          width: placement.width, depth: placement.depth, count: placement.count,
          kinds: ['pine', 'broadleaf'], seed: placement.seed, detail, name: `${placement.id}-body`,
        });
        node.userData.softOcclusion = true;
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'backdropGantry': {
        const node = buildBackdropGantry(THREE, materials, placement);
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      case 'backdropMass': {
        const node = kit.createSilhouetteMass({
          kind: placement.massKind, width: placement.width, depth: placement.depth,
          height: placement.height, seed: placement.seed, name: `${placement.id}-body`,
        });
        mountZUp(node, placement.at);
        register(node, placement);
        break;
      }
      default:
        throw new TypeError(`KADO_UNKNOWN_PLACEMENT_KIND:${placement.kind}`);
    }
  }

  markDecorative(root);
  root.userData.siteId = 'kado';
  root.userData.kadoPieces = manifest;
  root.userData.kadoVocabulary = KADO_SITE.vocabulary;
  if (options.merge !== false) {
    root.userData.kadoMerge = kit.mergeArchRoot(root);
  }
  return root;
}

export default buildKadoArchitecture;
