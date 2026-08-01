/**
 * 風見（南西拠点）の建築 — `site_kazami.js`
 * =====================================================================
 *
 * 拠点ID: `kazami` / 中心 `[-56, -44, 4]` / 中ランドマーク 竜骨ガントリー `[-68, -50, 9]`
 * SSOT: `shared/data/map_oshioi_flashpoint.js`
 *   identity.landmark      = 「三本帆柱と船殻肋骨」
 *   identity.silhouette    = 'three-masts-and-keel'
 *   identity.coverLanguage = 'keel-ribs-and-timber-stacks'
 *   identity.materialPair  = ['cedar', 'roofCopper']
 *
 * ここは造船所である。**箱を並べるのではなく、造船台の上に組みかけの船を建てる。**
 * 建築語彙は「竜骨・肋骨・帆柱・架構・盤木・材木積み・風見」。
 * 他の4拠点と共有するのは汎用の壁体・階段・欄干（= arch_kit の `wrapSolid`）までで、
 * 象徴的な構造物（竜骨ガントリー / 組みかけの船殻 / 三本帆柱 / 風見）は
 * **この区画にしか存在しない**。
 *
 * ---------------------------------------------------------------------
 * 絶対規則（守っていることをテストで実証する。`tests/architecture_kazami.test.js`）
 * ---------------------------------------------------------------------
 * 1. **当たり判定を一切作らない・変えない。** 本モジュールは
 *    `map_oshioi_flashpoint_geometry.js` の `solids` を **読むだけ**で、
 *    返すのは `userData.collision === false` の描画専用グループのみ。
 * 2. **当たり判定の無い場所に「遮蔽に見える不透明な塊」を置かない。**
 *    すべての配置に `occlusion` クラスを宣言し、テストがクラスごとの規則で実測検査する
 *    （`KAZAMI_OCCLUSION_CLASSES` を参照）。
 * 3. 座標系: `client/render.js:245` で `world.rotation.x = -Math.PI/2` が既に掛かっており、
 *    `world` の中では **ゲーム座標 Z-up をそのまま書ける**。
 *    本モジュールは各構造物を **ローカル Y-up** で作り、`mountKazami()` で
 *    `rotation.set(PI/2, yaw, 0, 'XYZ')` により Z-up へ載せる。
 *    ※ `arch_kit` の `mountZUp(obj, pos, yaw)` は yaw≠0 のとき euler order が `YXZ` になり
 *      **構造物が横倒しになる**（実測: local +Y → [1,0,0]）。共有ファイルは書き換えない方針なので
 *      本モジュール側で回避している。要望は `request_kazami.md` に記載。
 *
 * ---------------------------------------------------------------------
 * 奥行き4層（ARCH_BRIEF §3.1）でのこの区画の担当
 * ---------------------------------------------------------------------
 *   層1 プレイ層 (0–6 m)   : 造船台の盤木・枕木・風見盤の床象嵌・材木積み・門・灯
 *   層2 近景建築 (6–25 m)  : **竜骨ガントリー・三本帆柱・船殻肋骨・架構・空中歩廊・船架小屋の小屋組**
 *                            ← ここが最大の欠落だったので最も厚く作る
 *   層3 遠景都市 (25–80 m) : 競技境界の外に造船所の借景（船台小屋列とクレーン塔）
 *   層4 地形と空           : 南西の丘（`crag`）
 */

import {
  createArchKit,
  archRandom,
  markDecorative,
  ARCH_PLAY_CLEARANCE_M,
  ARCH_WALKABLE_TAGS,
} from '../../../client/img2threejs/runtime/arch_kit.js';
import { buildOshioiFlashpointGeometry } from '../map_oshioi_flashpoint_geometry.js';

/* ================================================================== *
 * 0. 区画の定数（SSOT から転記。SSOT を書き換えないための読み取り専用コピー）
 * ================================================================== */

export const KAZAMI_SITE_ID = 'kazami';
export const KAZAMI_CENTER_M = Object.freeze([-56, -44, 4]);
export const KAZAMI_FLOOR_Z_M = 4;
export const KAZAMI_RADIUS_M = 7;
/** SSOT `playBoundsM`。ここが「この区画」。 */
export const KAZAMI_PLAY_BOUNDS_M = Object.freeze({ x: [-76, -36], y: [-61, -27] });
/** 中ランドマーク（高台 `keel-gantry` の天面中心）。 */
export const KAZAMI_LANDMARK_M = Object.freeze([-68, -50, 9]);
/** 競技境界（`map.boundsM`）。この外は「遠景」で遮蔽規則の対象外。 */
export const KAZAMI_PLAYABLE_BOUNDS_M = Object.freeze({ x: [-126, 126], y: [-92, 92] });
/** 頭上クリアランス。arch_kit と同じ値を使う。 */
export const KAZAMI_CLEARANCE_M = ARCH_PLAY_CLEARANCE_M;

/** 造船台（スリップウェイ）の軸。船首は北（+y）を向き、艫は南のガントリー側。 */
export const KAZAMI_SLIPWAY = Object.freeze({
  axisX: -68.5,          // 竜骨の通り
  sternY: -50.5,         // 艫（ガントリーの真下側）
  bowY: -35.5,           // 船首
  gaugeM: 5.8,           // 盤木の心々（ガントリーの軌間）
});

/**
 * 遮蔽クラス。**テストはこの表そのものを規則として実行する。**
 * 「当たり判定が無い場所に不透明な塊を置いていないこと」を、説明ではなく実測で示すための語彙。
 */
export const KAZAMI_OCCLUSION_CLASSES = Object.freeze({
  /** arch_kit の `wrapSolid` 生成物。当たり判定 AABB の水平フットプリント内に収まる。 */
  wrapped: {
    id: 'wrapped',
    rule: 'auditFootprint(root, sourceAabb).safe === true',
    note: '当たり判定そのものを包んだ建築。頭上クリアランスより下では 1mm も外へ出ない',
  },
  /** 当たり判定の箱の**天面より上**に、その箱のフットプリント内で載る（小屋組・棟飾り）。 */
  roofborne: {
    id: 'roofborne',
    rule: 'minZ >= sourceAabb.max[2] かつ 水平投影 ⊆ sourceAabb のフットプリント',
    note: '壁体の屋根の上。壁タグは ARCH_WALKABLE_TAGS に無く人が立たない',
  },
  /** 支持面から 0.45 m 以下。踏めるが遮蔽にならない（床・盤木・枕木・象嵌）。 */
  flat: { id: 'flat', rule: 'maxZ <= support + 0.45', note: '床のパターンと動線ライン' },
  /** 支持面 + 頭上クリアランス より上にしか存在しない（空中歩廊・桁・吊り荷）。 */
  aerial: { id: 'aerial', rule: 'minZ >= support + 2.2', note: '近景シルエット層。頭上を通る' },
  /** 細い部材だけで構成され、プレイ帯の水平断面が「柱・肋骨」の太さを超えない。 */
  permeable: {
    id: 'permeable',
    rule: 'プレイ帯の水平投影の連結成分ごとに 面積 <= 1.6 m^2 かつ 短辺 <= 0.45 m',
    note: '柱・帆柱・肋骨・格子。射線を切らないので偽の遮蔽にならない',
  },
  /** 植生。ARCH_BRIEF §3.5「柔らかい遮蔽」。幹だけがプレイ帯にあり、枝葉は透ける想定。 */
  soft: {
    id: 'soft',
    rule: '幹のプレイ帯断面 <= 0.7 m かつ 拠点中心から半径 9 m の外',
    note: 'プレイ空間に疎、境界に密',
  },
  /** 競技境界の外。遮蔽規則の対象外（層3・層4）。 */
  distant: { id: 'distant', rule: '中心が playableBounds の外', note: '借景。当たり判定なし' },
});

/* ================================================================== *
 * 1. 内部小道具（arch_kit の bakeParts 相当。共有ファイルを書き換えないため自前で持つ）
 * ================================================================== */

/** ローカル Y-up の部品置き場。arch_kit の `createPartSink` と同じ規約。 */
function sink() {
  const parts = [];
  return {
    parts,
    add(geometry, material, {
      position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1],
      tint = [1, 1, 1], shade = [0.62, 1.0],
    } = {}) {
      parts.push({ geometry, material, position, rotation, scale, tint, shade });
    },
  };
}

/** parts を「マテリアル別に1メッシュ」へ畳む。Y の高さで頂点色に縦グラデーションを焼く。 */
function bake(THREE, parts, name) {
  const group = new THREE.Group();
  group.name = name;
  const prepared = [];
  let minY = Infinity; let maxY = -Infinity;
  for (const part of parts) {
    const src = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (!src.attributes.normal) src.computeVertexNormals();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', src.attributes.position.clone());
    geometry.setAttribute('normal', src.attributes.normal.clone());
    geometry.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(part.position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(...part.rotation)),
      new THREE.Vector3().fromArray(part.scale),
    ));
    const pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    prepared.push({ geometry, part });
  }
  const span = Math.max(1e-6, maxY - minY);
  const buckets = new Map();
  for (const { geometry, part } of prepared) {
    const pos = geometry.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const [lo, hi] = part.shade;
    for (let i = 0; i < pos.count; i++) {
      const k = lo + (hi - lo) * ((pos.getY(i) - minY) / span);
      colors[i * 3 + 0] = part.tint[0] * k;
      colors[i * 3 + 1] = part.tint[1] * k;
      colors[i * 3 + 2] = part.tint[2] * k;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const key = part.material?.uuid || 'none';
    const list = buckets.get(key) || { material: part.material, geometries: [] };
    list.geometries.push(geometry);
    buckets.set(key, list);
  }
  for (const bucket of buckets.values()) {
    let total = 0;
    for (const g of bucket.geometries) total += g.attributes.position.count;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    let offset = 0;
    for (const g of bucket.geometries) {
      position.set(g.attributes.position.array, offset * 3);
      normal.set(g.attributes.normal.array, offset * 3);
      color.set(g.attributes.color.array, offset * 3);
      offset += g.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(position, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
    merged.setAttribute('color', new THREE.BufferAttribute(color, 3));
    const mesh = new THREE.Mesh(merged, bucket.material);
    mesh.name = `${name}-${bucket.material?.userData?.archMaterial || 'part'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    markDecorative(mesh);
    group.add(mesh);
  }
  markDecorative(group);
  return group;
}

/**
 * ローカル Y-up の構造物を、ゲーム座標 Z-up の `world` 空間へ載せる。
 * `arch_kit.mountZUp` の yaw が euler order `YXZ` になり横倒しになるため、
 * ここでは必ず order `XYZ`（R = Rx(π/2)·Ry(yaw)）を使う。
 */
export function mountKazami(object3D, position = [0, 0, 0], yawRad = 0) {
  object3D.position.fromArray(position);
  object3D.rotation.set(Math.PI / 2, yawRad, 0, 'XYZ');
  markDecorative(object3D);
  return object3D;
}

/** 2点間に伸びる部材（索・筋交い・斜材）。ローカル Y-up。 */
function strut(THREE, s, material, a, b, radius, { shade = [0.5, 0.95], seg = 6 } = {}) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  const geometry = new THREE.CylinderGeometry(radius, radius, len, seg, 1, true);
  const quaternion = new THREE.Quaternion().setFromUnitVectors(
    new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize(),
  );
  const euler = new THREE.Euler().setFromQuaternion(quaternion);
  s.add(geometry, material, {
    position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
    rotation: [euler.x, euler.y, euler.z],
    shade,
  });
}

/* ================================================================== *
 * 2. 風見固有の建築語彙（この区画にしか存在しない造形）
 * ================================================================== */

/**
 * 語彙の一覧。テストはこの配列を単一の出所として全項目を生成・実測する。
 * **語彙を足したらここに1行足すこと。**（arch_kit の ARCH_VOCABULARY と同じ規約）
 */
export const KAZAMI_VOCABULARY = Object.freeze([
  { id: 'windVane', factory: 'createWindVane', triangleBudget: 400, note: '風見。小/中/大の3スケールで反復する単位モチーフ' },
  { id: 'timberBent', factory: 'createTimberBent', triangleBudget: 900, note: '木の架構（真束小屋組）。小=肋骨/中=小屋組/大=門' },
  { id: 'keelHull', factory: 'createKeelHull', triangleBudget: 4200, note: '組みかけの竜骨と船殻肋骨。この区画の核' },
  { id: 'shipMast', factory: 'createShipMast', triangleBudget: 900, note: '帆柱。檣楼・帆桁・頂部の風見つき' },
  { id: 'keelGantry', factory: 'createKeelGantry', triangleBudget: 3600, note: '竜骨ガントリー。中ランドマーク。吊り荷と大風見' },
  { id: 'gantryCatwalk', factory: 'createGantryCatwalk', triangleBudget: 1200, note: '軌道上の空中歩廊。近景シルエット層' },
  { id: 'slipwayWays', factory: 'createSlipwayWays', triangleBudget: 1400, note: '造船台の盤木と枕木。床のパターン' },
  { id: 'timberStack', factory: 'createTimberStack', triangleBudget: 900, note: '材木積み。当たり判定の箱を丸太で満たす' },
  { id: 'shipyardGate', factory: 'createShipyardGate', triangleBudget: 900, note: '入口の門。背の高い要素＋灯＋小風見' },
  { id: 'compassInlay', factory: 'createCompassInlay', triangleBudget: 700, note: '風見盤の床象嵌。動線ラインの起点' },
]);

/* --- 語彙1: 風見（単位モチーフ。ARCH_BRIEF §3.2 の3スケール反復） -------- */

export const KAZAMI_VANE_SCALES = Object.freeze({
  small: { lengthM: 0.72, poleM: 0.55 },   // 軒先・門・灯の頭
  medium: { lengthM: 1.65, poleM: 1.5 },   // 帆柱頭・棟
  large: { lengthM: 3.4, poleM: 3.2 },     // ガントリー頂部（大ランドマークの目印）
});

/**
 * 風見（かざみ）。矢羽と魚形の吹き流し板＋方位十字。**この拠点の名前そのもの。**
 * @returns {THREE.Group} ローカル Y-up。原点は取付面。
 */
export function createWindVane(THREE, materials, {
  scale = 'medium',
  length = null,
  poleHeight = null,
  headingRad = 0.6,
  name = 'kazami-vane',
} = {}) {
  const preset = KAZAMI_VANE_SCALES[scale] || KAZAMI_VANE_SCALES.medium;
  const L = Number.isFinite(length) ? length : preset.lengthM;
  const P = Number.isFinite(poleHeight) ? poleHeight : preset.poleM;
  const t = L * 0.05;
  const s = sink();
  // 支柱
  s.add(new THREE.CylinderGeometry(t * 0.9, t * 1.3, P, 6, 1, true), materials.timber,
    { position: [0, P / 2, 0], shade: [0.42, 0.9] });
  // 方位十字（銅＝差し色）
  for (const rot of [0, Math.PI / 2]) {
    s.add(new THREE.BoxGeometry(L * 0.52, t * 0.7, t * 0.7), materials.gold,
      { position: [0, P + L * 0.06, 0], rotation: [0, rot, 0], shade: [1.0, 1.1] });
  }
  // 回転体（矢羽 + 尾板）。headingRad で向きを変えて個体差を出す
  const yaw = headingRad;
  // 軸
  s.add(new THREE.BoxGeometry(L, t * 0.9, t * 0.9), materials.gold,
    { position: [0, P + L * 0.3, 0], rotation: [0, yaw, 0], shade: [1.02, 1.12] });
  // 尾の板（風を受ける側）
  s.add(new THREE.BoxGeometry(L * 0.42, L * 0.36, t * 0.5), materials.roof, {
    position: [Math.cos(yaw) * -L * 0.34, P + L * 0.42, Math.sin(yaw) * L * 0.34],
    rotation: [0, yaw, 0], shade: [0.9, 1.15],
  });
  // 鏃（進行方向）
  s.add(new THREE.ConeGeometry(L * 0.11, L * 0.28, 5, 1), materials.gold, {
    position: [Math.cos(yaw) * L * 0.46, P + L * 0.3, Math.sin(yaw) * -L * 0.46],
    rotation: [0, yaw, -Math.PI / 2], shade: [1.05, 1.15],
  });
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'windVane';
  group.userData.vaneScale = scale;
  group.userData.heightM = P + L * 0.6;
  return group;
}

/* --- 語彙2: 木の架構（真束小屋組）。3スケールで反復 -------------------- */

/**
 * 木の架構。柱2本＋陸梁＋合掌＋真束＋方杖。造船所の小屋組そのもの。
 * @param {number} span 柱心々（m） / @param {number} postHeight 柱の高さ（m）
 */
export function createTimberBent(THREE, materials, {
  span = 9,
  postHeight = 4.6,
  riseM = 2.4,
  postSection = 0.34,
  braces = true,
  kingPost = true,
  name = 'kazami-bent',
} = {}) {
  const s = sink();
  const half = span / 2;
  const ps = postSection;
  for (const sign of [-1, 1]) {
    s.add(new THREE.BoxGeometry(ps, postHeight, ps), materials.timber,
      { position: [sign * half, postHeight / 2, 0], shade: [0.4, 0.92] });
  }
  // 陸梁（水平の梁）
  s.add(new THREE.BoxGeometry(span + ps * 2.4, ps * 0.9, ps * 1.1), materials.timber,
    { position: [0, postHeight + ps * 0.45, 0], shade: [0.9, 1.0] });
  // 合掌（斜材）
  const beamY = postHeight + ps * 0.9;
  const rafter = Math.hypot(half, riseM);
  for (const sign of [-1, 1]) {
    s.add(new THREE.BoxGeometry(rafter, ps * 0.72, ps * 0.86), materials.timber, {
      position: [sign * half * 0.5, beamY + riseM * 0.5, 0],
      rotation: [0, 0, sign * -Math.atan2(riseM, half)],
      shade: [0.72, 1.05],
    });
  }
  if (kingPost) {
    s.add(new THREE.BoxGeometry(ps * 0.7, riseM, ps * 0.7), materials.timber,
      { position: [0, beamY + riseM * 0.5, 0], shade: [0.8, 1.0] });
    // 棟の銅キャップ（差し色）
    s.add(new THREE.BoxGeometry(ps * 1.5, ps * 0.4, ps * 1.2), materials.gold,
      { position: [0, beamY + riseM + ps * 0.2, 0], shade: [1.05, 1.15] });
  }
  if (braces) {
    for (const sign of [-1, 1]) {
      const b = Math.min(1.5, postHeight * 0.34);
      strut(THREE, s, materials.timber,
        [sign * (half - ps * 0.4), postHeight - b, 0],
        [sign * (half - b - ps * 0.4), postHeight + ps * 0.4, 0],
        ps * 0.3, { shade: [0.55, 0.9] });
    }
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'timberBent';
  group.userData.spanM = span;
  group.userData.heightM = postHeight + ps * 0.9 + riseM;
  group.userData.postSectionM = postSection;
  return group;
}

/* --- 語彙3: 組みかけの竜骨と船殻肋骨（この区画の核） -------------------- */

/**
 * 組みかけの船殻。竜骨（キール）＋船首材＋船尾材＋肋骨（フレーム）＋縦通材。
 * **組みかけである**ことを表すため、いくつかの station は上半分を欠かす。
 *
 * ローカル: +Z が船首方向、+Y が上、原点は竜骨の下端中央。
 */
export function createKeelHull(THREE, materials, {
  lengthM = 15,
  stations = 13,
  maxHalfBeamM = 2.25,
  maxRiseM = 5.0,
  ribSection = 0.26,
  missingStations = [4, 9],
  planked = 4,
  seed = 41,
  name = 'kazami-keel-hull',
} = {}) {
  const random = archRandom(seed);
  const s = sink();
  const L = lengthM;
  const halfL = L / 2;
  // --- 竜骨（わずかにシアを付ける） ---
  const keelH = 0.72; const keelW = 0.52;
  s.add(new THREE.BoxGeometry(keelW, keelH, L), materials.timber,
    { position: [0, keelH / 2, 0], shade: [0.36, 0.66] });
  // 竜骨の上に添える内竜骨（キールソン）
  s.add(new THREE.BoxGeometry(keelW * 0.7, 0.26, L * 0.92), materials.timber,
    { position: [0, keelH + 0.13, 0], shade: [0.5, 0.72] });
  // --- 船首材（ステム）: 前方へ反り上がる曲材 ---
  const stemSeg = 6; const stemRise = maxRiseM * 1.35;
  for (let i = 0; i < stemSeg; i++) {
    const t0 = i / stemSeg; const t1 = (i + 1) / stemSeg;
    const p = (t) => [0, keelH * 0.5 + stemRise * t, halfL + Math.sin(t * Math.PI * 0.5) * 1.9];
    strut(THREE, s, materials.timber, p(t0), p(t1), ribSection * 0.72, { shade: [0.42, 0.92], seg: 5 });
  }
  // --- 船尾材（スターンポスト） ---
  const sternRise = maxRiseM * 0.78;
  for (let i = 0; i < 4; i++) {
    const t0 = i / 4; const t1 = (i + 1) / 4;
    const p = (t) => [0, keelH * 0.5 + sternRise * t, -halfL - t * 0.85];
    strut(THREE, s, materials.timber, p(t0), p(t1), ribSection * 0.68, { shade: [0.4, 0.85], seg: 5 });
  }
  // --- 肋骨（フレーム）: 竜骨から外へ立ち上がる曲材を左右対称に ---
  const missing = new Set(missingStations);
  const ribSeg = 6;
  const ribTops = [];
  for (let n = 0; n < stations; n++) {
    const u = stations === 1 ? 0.5 : n / (stations - 1);
    const z = -halfL + u * L;
    // 中央でいちばん太く、両端で細るシンプルな船型
    const fullness = Math.sin(Math.PI * (0.14 + 0.72 * u));
    const halfBeam = maxHalfBeamM * (0.34 + 0.66 * fullness);
    const rise = maxRiseM * (0.5 + 0.5 * fullness);
    const cut = missing.has(n) ? 0.5 : (n < planked ? 1 : 0.82 + random() * 0.18);
    for (const side of [-1, 1]) {
      // 二次曲線: 下は狭く立ち上がり、上で外へ張り出す
      const at = (t) => [
        side * halfBeam * Math.pow(t, 0.72),
        keelH * 0.4 + rise * t * (1.02 - 0.02 * t),
        z,
      ];
      const top = Math.max(2, Math.round(ribSeg * cut));
      for (let i = 0; i < top; i++) {
        strut(THREE, s, materials.timber, at(i / ribSeg), at((i + 1) / ribSeg),
          ribSection * 0.5, { shade: [0.44, 1.0], seg: 4 });
      }
      if (top === ribSeg) ribTops.push([side * halfBeam, keelH * 0.4 + rise, z]);
    }
  }
  // --- 縦通材（ウェール）: 肋骨を貫く2本の帯。船殻のシルエットを決める ---
  for (const side of [-1, 1]) {
    for (const level of [0.52, 0.86]) {
      const pts = [];
      for (let n = 0; n < stations; n++) {
        const u = stations === 1 ? 0.5 : n / (stations - 1);
        const z = -halfL + u * L;
        const fullness = Math.sin(Math.PI * (0.14 + 0.72 * u));
        const halfBeam = maxHalfBeamM * (0.34 + 0.66 * fullness);
        const rise = maxRiseM * (0.5 + 0.5 * fullness);
        pts.push([side * halfBeam * Math.pow(level, 0.72), keelH * 0.4 + rise * level, z]);
      }
      for (let i = 0; i < pts.length - 1; i++) {
        strut(THREE, s, materials.timber, pts[i], pts[i + 1], ribSection * 0.34,
          { shade: [0.55, 1.0], seg: 4 });
      }
    }
  }
  // --- 張り終わった外板（艫側だけ数枚）。「組みかけ」を読ませる ---
  for (let n = 0; n < planked - 1; n++) {
    const u = n / (stations - 1);
    const u2 = (n + 1) / (stations - 1);
    const z0 = -halfL + u * L; const z1 = -halfL + u2 * L;
    const f0 = Math.sin(Math.PI * (0.14 + 0.72 * u));
    const hb = maxHalfBeamM * (0.34 + 0.66 * f0);
    const rs = maxRiseM * (0.5 + 0.5 * f0);
    for (const side of [-1, 1]) {
      s.add(new THREE.BoxGeometry(0.1, rs * 0.5, z1 - z0), materials.timber, {
        position: [side * hb * 0.72, keelH * 0.4 + rs * 0.3, (z0 + z1) / 2],
        rotation: [0, 0, side * 0.34],
        shade: [0.5, 0.86],
      });
    }
  }
  // --- 盤木（船台のブロック。竜骨を支える低い塊） ---
  for (let n = 0; n < 5; n++) {
    const z = -halfL + (n + 0.5) * (L / 5);
    s.add(new THREE.BoxGeometry(1.5, 0.34, 0.66), materials.timber,
      { position: [0, 0.17, z], shade: [0.3, 0.5] });
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'keelHull';
  group.userData.lengthM = L;
  group.userData.maxHalfBeamM = maxHalfBeamM;
  group.userData.memberSectionM = ribSection;
  group.userData.heightM = keelH * 0.4 + maxRiseM * 1.35;
  group.userData.ribTops = ribTops;
  return group;
}

/* --- 語彙4: 帆柱（三本帆柱。SSOT identity そのもの） -------------------- */

export function createShipMast(THREE, materials, {
  height = 20,
  baseRadius = 0.34,
  topRadius = 0.17,
  yards = [
    { at: 0.52, lengthM: 6.4 },
    { at: 0.74, lengthM: 4.6 },
  ],
  topPlatform = true,
  vaneScale = 'medium',
  headingRad = 0.5,
  name = 'kazami-mast',
} = {}) {
  const s = sink();
  // 柱（テーパー）
  s.add(new THREE.CylinderGeometry(topRadius, baseRadius, height, 8, 1, true), materials.timber,
    { position: [0, height / 2, 0], shade: [0.42, 1.0] });
  // 柱の根元を締める銅バンド（差し色）
  for (const y of [0.6, 1.5]) {
    s.add(new THREE.CylinderGeometry(baseRadius * 1.12, baseRadius * 1.12, 0.16, 8, 1, true), materials.gold,
      { position: [0, y, 0], shade: [0.9, 1.0] });
  }
  // 帆桁
  for (const yard of yards) {
    const y = height * yard.at;
    s.add(new THREE.CylinderGeometry(0.09, 0.13, yard.lengthM, 6, 1, true), materials.timber,
      { position: [0, y, 0], rotation: [0, 0, Math.PI / 2], shade: [0.72, 1.0] });
    // 帆桁を吊る索（この拠点の索具は寒色を使わない。すべて杉と銅）
    strut(THREE, s, materials.timber, [-yard.lengthM * 0.46, y, 0], [0, y + 1.9, 0], 0.045, { seg: 4 });
    strut(THREE, s, materials.timber, [yard.lengthM * 0.46, y, 0], [0, y + 1.9, 0], 0.045, { seg: 4 });
  }
  if (topPlatform) {
    const ty = height * 0.86;
    s.add(new THREE.BoxGeometry(1.5, 0.12, 1.5), materials.timber,
      { position: [0, ty, 0], shade: [0.85, 1.0] });
    for (const [dx, dz] of [[-0.7, -0.7], [0.7, -0.7], [-0.7, 0.7], [0.7, 0.7]]) {
      strut(THREE, s, materials.timber, [dx * 0.34, ty - 1.6, dz * 0.34], [dx, ty, dz], 0.05, { seg: 4 });
      s.add(new THREE.BoxGeometry(0.07, 0.62, 0.07), materials.timber,
        { position: [dx, ty + 0.31, dz], shade: [0.9, 1.0] });
    }
  }
  const group = bake(THREE, s.parts, name);
  const vane = createWindVane(THREE, materials, {
    scale: vaneScale, headingRad, name: `${name}-vane`,
  });
  vane.position.set(0, height, 0);
  group.add(vane);
  markDecorative(group);
  group.userData.kazamiVocabulary = 'shipMast';
  group.userData.heightM = height + (vane.userData.heightM || 0);
  group.userData.baseRadiusM = baseRadius;
  return group;
}

/* --- 語彙5: 竜骨ガントリー（中ランドマーク） ---------------------------- */

/**
 * 竜骨ガントリー。格子柱4本の門型＋2段の桁＋北へ張り出すジブ＋吊り下げた竜骨材＋大風見。
 * ローカル: 原点は軌道面（= 支持する当たり判定箱の底面）。+Z が船首方向（ジブの張り出し方向）。
 */
export function createKeelGantry(THREE, materials, {
  gaugeM = 5.8,          // 柱の心々（x方向）
  baseM = 5.2,           // 柱の心々（z方向）
  legHeight = 15.0,      // 軌道面から下弦桁まで
  headHeight = 18.6,     // 上弦桁
  legLattice = 0.86,     // 格子柱の外形（一辺）
  jibM = 9.0,            // 北へのジブ
  hoistDropM = 6.0,      // 吊り荷の落とし
  vane = true,
  name = 'kazami-keel-gantry',
} = {}) {
  const s = sink();
  const hx = gaugeM / 2; const hz = baseM / 2;
  const post = 0.17; const q = legLattice / 2 - post / 2;
  // --- 格子柱4本（4本の細柱＋ジグザグの筋交いで1本の塔に見せる） ---
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const cx = sx * hx; const cz = sz * hz;
      const corners = [[-q, -q], [q, -q], [q, q], [-q, q]];
      for (const [ox, oz] of corners) {
        s.add(new THREE.BoxGeometry(post, headHeight, post), materials.timber,
          { position: [cx + ox, headHeight / 2, cz + oz], shade: [0.36, 1.0] });
      }
      const panels = 7;
      for (let i = 0; i < panels; i++) {
        const y0 = (i / panels) * headHeight;
        const y1 = ((i + 1) / panels) * headHeight;
        for (let f = 0; f < 4; f++) {
          const a = corners[f]; const b = corners[(f + 1) % 4];
          const flip = (i + f) % 2 === 0;
          strut(THREE, s, materials.timber,
            [cx + (flip ? a[0] : b[0]), y0, cz + (flip ? a[1] : b[1])],
            [cx + (flip ? b[0] : a[0]), y1, cz + (flip ? b[1] : a[1])],
            post * 0.42, { shade: [0.4, 0.95], seg: 4 });
          if (i % 2 === 0) {
            s.add(new THREE.BoxGeometry(
              Math.max(post, Math.abs(a[0] - b[0]) + post), post * 0.7,
              Math.max(post, Math.abs(a[1] - b[1]) + post),
            ), materials.timber, {
              position: [cx + (a[0] + b[0]) / 2, y0, cz + (a[1] + b[1]) / 2], shade: [0.4, 0.95],
            });
          }
        }
      }
      // 柱脚の銅沓
      s.add(new THREE.BoxGeometry(legLattice + 0.28, 0.4, legLattice + 0.28), materials.gold,
        { position: [cx, 0.2, cz], shade: [0.5, 0.7] });
    }
  }
  // --- 桁（下弦・上弦。頭上をまたぐ） ---
  for (const y of [legHeight, headHeight]) {
    for (const sz of [-1, 1]) {
      s.add(new THREE.BoxGeometry(gaugeM + legLattice, 0.54, 0.44), materials.timber,
        { position: [0, y, sz * hz], shade: [0.86, 1.05] });
    }
    for (const sx of [-1, 1]) {
      s.add(new THREE.BoxGeometry(0.44, 0.48, baseM + legLattice), materials.timber,
        { position: [sx * hx, y, 0], shade: [0.86, 1.05] });
    }
  }
  // 門型の斜材（下弦のすぐ下。頭上クリアランスより遥か上）
  for (const sz of [-1, 1]) {
    for (const sx of [-1, 1]) {
      strut(THREE, s, materials.timber,
        [sx * hx, legHeight - 2.0, sz * hz], [sx * (hx - 2.0), legHeight, sz * hz],
        0.14, { shade: [0.7, 0.95] });
    }
  }
  // --- ジブ（北へ張り出す腕）＋斜め控え ---
  const jibY = headHeight;
  for (const sx of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.34, 0.42, jibM), materials.timber,
      { position: [sx * hx * 0.62, jibY, hz + jibM / 2], shade: [0.95, 1.06] });
    strut(THREE, s, materials.timber,
      [sx * hx * 0.62, jibY + 3.0, hz - 0.4], [sx * hx * 0.62, jibY, hz + jibM * 0.92],
      0.11, { shade: [0.9, 1.0] });
    s.add(new THREE.BoxGeometry(0.24, 3.2, 0.24), materials.timber,
      { position: [sx * hx * 0.62, jibY + 1.6, hz - 0.4], shade: [0.95, 1.05] });
  }
  s.add(new THREE.BoxGeometry(hx * 1.24 + 0.4, 0.3, 0.34), materials.timber,
    { position: [0, jibY, hz + jibM], shade: [1.0, 1.08] });
  // --- 巻き上げ機と吊り荷（組み上げ中の竜骨材）。頭上クリアランスの遥か上 ---
  const hookZ = hz + jibM * 0.62;
  const loadY = jibY - hoistDropM;
  for (const sx of [-1, 1]) {
    strut(THREE, s, materials.timber, [sx * 0.34, jibY - 0.3, hookZ], [sx * 0.2, loadY + 0.5, hookZ],
      0.05, { shade: [0.8, 0.95], seg: 4 });
  }
  s.add(new THREE.BoxGeometry(0.9, 0.62, 0.62), materials.gold,
    { position: [0, jibY - 0.6, hookZ], shade: [0.95, 1.05] });
  s.add(new THREE.BoxGeometry(0.46, 0.56, 5.6), materials.timber,
    { position: [0, loadY, hookZ], rotation: [0.06, 0, 0], shade: [0.75, 0.95] });
  s.add(new THREE.BoxGeometry(0.7, 0.3, 0.7), materials.gold,
    { position: [0, loadY + 0.42, hookZ], shade: [0.9, 1.0] });
  // --- 頂部の大風見（どこからでも「風見」と分かる目印） ---
  const group = bake(THREE, s.parts, name);
  if (vane) {
    const big = createWindVane(THREE, materials, { scale: 'large', headingRad: 0.85, name: `${name}-vane` });
    big.position.set(0, headHeight + 0.3, 0);
    group.add(big);
    markDecorative(group);
  }
  group.userData.kazamiVocabulary = 'keelGantry';
  group.userData.gaugeM = gaugeM;
  group.userData.legLatticeM = legLattice;
  group.userData.heightM = headHeight + (vane ? 4.4 : 0);
  return group;
}

/* --- 語彙6: 空中歩廊（軌道の上を渡る。近景シルエット層） ---------------- */

export function createGantryCatwalk(THREE, materials, {
  lengthM = 14,
  widthM = 1.0,
  deckHeight = 15.0,
  supportSpacing = 6.5,
  railings = true,
  name = 'kazami-catwalk',
} = {}) {
  const s = sink();
  s.add(new THREE.BoxGeometry(widthM, 0.14, lengthM), materials.timber,
    { position: [0, deckHeight, 0], shade: [0.9, 1.0] });
  // 縦桁
  for (const sx of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.16, 0.4, lengthM), materials.timber,
      { position: [sx * widthM * 0.5, deckHeight - 0.24, 0], shade: [0.75, 0.9] });
  }
  // 支柱（頭上を跨ぐ細い柱。プレイ帯の断面 0.3 m 角）
  const supports = Math.max(2, Math.round(lengthM / supportSpacing) + 1);
  for (let i = 0; i < supports; i++) {
    const z = -lengthM / 2 + (i / (supports - 1)) * lengthM;
    for (const sx of [-1, 1]) {
      s.add(new THREE.BoxGeometry(0.3, deckHeight, 0.3), materials.timber,
        { position: [sx * widthM * 0.5, deckHeight / 2, z], shade: [0.36, 0.95] });
    }
    strut(THREE, s, materials.timber,
      [-widthM * 0.5, deckHeight - 2.4, z], [widthM * 0.5, deckHeight - 0.4, z], 0.09, { seg: 4 });
  }
  if (railings) {
    for (const sx of [-1, 1]) {
      s.add(new THREE.BoxGeometry(0.09, 0.09, lengthM), materials.gold,
        { position: [sx * widthM * 0.5, deckHeight + 1.0, 0], shade: [1.0, 1.1] });
      const posts = Math.max(2, Math.round(lengthM / 1.8));
      for (let i = 0; i <= posts; i++) {
        const z = -lengthM / 2 + (i / posts) * lengthM;
        s.add(new THREE.BoxGeometry(0.07, 1.0, 0.07), materials.timber,
          { position: [sx * widthM * 0.5, deckHeight + 0.5, z], shade: [0.8, 1.0] });
      }
    }
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'gantryCatwalk';
  group.userData.lengthM = lengthM;
  group.userData.deckHeightM = deckHeight;
  return group;
}

/* --- 語彙7: 造船台の盤木と枕木（床のパターンと動線） -------------------- */

export function createSlipwayWays(THREE, materials, {
  lengthM = 20,
  gaugeM = 5.8,
  sleeperEveryM = 1.7,
  wayHeight = 0.3,
  apronWidthM = 8.4,
  laneAccent = true,
  seed = 19,
  name = 'kazami-slipway',
} = {}) {
  const random = archRandom(seed);
  const s = sink();
  // 目地の下地（暗い石）→ その上に大判の石を浮かせて目地線を影で出す
  s.add(new THREE.BoxGeometry(apronWidthM, 0.06, lengthM), materials.stoneJoint,
    { position: [0, 0.03, 0], shade: [0.62, 0.8] });
  const cols = 3; const rows = Math.max(1, Math.round(lengthM / 2.6));
  const tw = apronWidthM / cols; const td = lengthM / rows;
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      const k = 0.84 + random() * 0.28;
      s.add(new THREE.BoxGeometry(tw - 0.1, 0.05, td - 0.1), materials.stone, {
        position: [-apronWidthM / 2 + tw * (i + 0.5), 0.085, -lengthM / 2 + td * (j + 0.5)],
        tint: [k, k, k], shade: [0.98, 1.02],
      });
    }
  }
  // 枕木（横）
  const sleepers = Math.max(2, Math.round(lengthM / sleeperEveryM));
  for (let i = 0; i <= sleepers; i++) {
    const z = -lengthM / 2 + (i / sleepers) * lengthM;
    s.add(new THREE.BoxGeometry(gaugeM + 1.5, 0.2, 0.46), materials.timber,
      { position: [0, 0.19, z], shade: [0.5, 0.72] });
  }
  // 盤木（縦の2条。船を滑らせる道）
  for (const sx of [-1, 1]) {
    s.add(new THREE.BoxGeometry(0.62, wayHeight, lengthM), materials.timber,
      { position: [sx * gaugeM / 2, wayHeight / 2 + 0.1, 0], shade: [0.45, 0.78] });
    // 銅の擦り板（差し色。動線そのものを光らせる）
    if (laneAccent) {
      s.add(new THREE.BoxGeometry(0.22, 0.04, lengthM), materials.gold,
        { position: [sx * gaugeM / 2, wayHeight + 0.12, 0], shade: [1.0, 1.1] });
    }
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'slipwayWays';
  group.userData.footprintM = [apronWidthM, lengthM];
  group.userData.heightM = wayHeight + 0.16;
  return group;
}

/* --- 語彙8: 材木積み（当たり判定の箱を丸太で満たす） -------------------- */

/**
 * 材木積み。**当たり判定 AABB の内側だけを丸太で満たす**ので、
 * 見た目の遮蔽と当たり判定が完全に一致する（`cover` タグの箱を包む専用）。
 * ローカル: 原点は AABB の底面中心。
 */
export function createTimberStack(THREE, materials, {
  widthM = 4,
  depthM = 1.5,
  heightM = 2.5,
  logRadius = 0.24,
  strap = true,
  seed = 23,
  name = 'kazami-timber-stack',
} = {}) {
  const random = archRandom(seed);
  const s = sink();
  const layers = Math.max(1, Math.floor(heightM / (logRadius * 2)));
  const inset = logRadius;
  for (let l = 0; l < layers; l++) {
    const y = logRadius + l * (logRadius * 2);
    if (y + logRadius > heightM) break;
    const alongX = l % 2 === 0;
    const across = alongX ? depthM : widthM;
    const along = alongX ? widthM : depthM;
    const count = Math.max(1, Math.floor((across - inset * 0.4) / (logRadius * 2)));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0 : (i / (count - 1) - 0.5) * (across - logRadius * 2);
      const k = 0.86 + random() * 0.26;
      s.add(new THREE.CylinderGeometry(logRadius, logRadius * 0.94, along - 0.06, 6, 1, true),
        materials.timber, {
          position: alongX ? [0, y, t] : [t, y, 0],
          rotation: alongX ? [0, 0, Math.PI / 2] : [Math.PI / 2, 0, 0],
          tint: [k, k, k], shade: [0.42, 1.0],
        });
    }
  }
  // 四隅の杭（積み崩れ止め）
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      s.add(new THREE.BoxGeometry(0.14, heightM, 0.14), materials.timber, {
        position: [sx * (widthM / 2 - 0.09), heightM / 2, sz * (depthM / 2 - 0.09)],
        shade: [0.4, 0.9],
      });
    }
  }
  if (strap) {
    // 銅の締め帯（差し色）。AABB の内側に収める
    s.add(new THREE.BoxGeometry(widthM - 0.06, 0.09, depthM - 0.06), materials.gold,
      { position: [0, heightM * 0.62, 0], shade: [0.95, 1.05] });
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'timberStack';
  group.userData.footprintM = [widthM, depthM];
  group.userData.heightM = heightM;
  return group;
}

/* --- 語彙9: 造船所の門（入口の背の高い要素＋灯） ------------------------ */

/**
 * 入口の門。**進む方向を示すのが仕事**（ARCH_BRIEF「入口に背の高い要素と照明」）。
 * 柱は細い（プレイ帯で偽の遮蔽にならない）、高さは 7 m 超で遠くから見える。
 */
export function createShipyardGate(THREE, materials, {
  spanM = 5.4,
  postHeight = 6.4,
  postSection = 0.42,
  lamp = true,
  lampSide = 'east',
  vane = true,
  name = 'kazami-gate',
} = {}) {
  const s = sink();
  const half = spanM / 2;
  for (const sx of [-1, 1]) {
    s.add(new THREE.BoxGeometry(postSection, postHeight, postSection), materials.timber,
      { position: [sx * half, postHeight / 2, 0], shade: [0.38, 0.95] });
    // 沓（銅）
    s.add(new THREE.BoxGeometry(postSection + 0.2, 0.34, postSection + 0.2), materials.gold,
      { position: [sx * half, 0.17, 0], shade: [0.5, 0.66] });
    // 方杖
    strut(THREE, s, materials.timber,
      [sx * half, postHeight - 1.5, 0], [sx * (half - 1.4), postHeight + 0.1, 0], 0.14,
      { shade: [0.7, 0.95] });
  }
  // 冠木（上の梁。2段）
  s.add(new THREE.BoxGeometry(spanM + 1.9, 0.36, postSection * 1.2), materials.timber,
    { position: [0, postHeight + 0.18, 0], shade: [0.95, 1.05] });
  s.add(new THREE.BoxGeometry(spanM + 1.1, 0.24, postSection * 0.9), materials.timber,
    { position: [0, postHeight - 0.72, 0], shade: [0.88, 0.98] });
  // 額（銅板）
  s.add(new THREE.BoxGeometry(1.5, 0.62, 0.1), materials.gold,
    { position: [0, postHeight - 0.3, postSection * 0.5], shade: [1.0, 1.1] });
  const group = bake(THREE, s.parts, name);
  if (lamp) {
    const glass = lampSide === 'west' ? materials.lampWest : materials.lampEast;
    const l = sink();
    for (const sx of [-1, 1]) {
      l.add(new THREE.BoxGeometry(0.09, 0.5, 0.09), materials.timber,
        { position: [sx * (half - 0.9), postHeight - 0.55, 0], shade: [0.6, 0.8] });
      l.add(new THREE.SphereGeometry(0.34, 8, 6), glass,
        { position: [sx * (half - 0.9), postHeight - 1.1, 0], shade: [1, 1] });
      l.add(new THREE.ConeGeometry(0.46, 0.3, 6, 1), materials.gold,
        { position: [sx * (half - 0.9), postHeight - 0.74, 0], shade: [1, 1.1] });
    }
    const lamps = bake(THREE, l.parts, `${name}-lamps`);
    group.add(lamps);
  }
  if (vane) {
    const v = createWindVane(THREE, materials, { scale: 'small', headingRad: 1.1, name: `${name}-vane` });
    v.position.set(0, postHeight + 0.36, 0);
    group.add(v);
  }
  markDecorative(group);
  group.userData.kazamiVocabulary = 'shipyardGate';
  group.userData.spanM = spanM;
  group.userData.postSectionM = postSection;
  group.userData.heightM = postHeight + 1.6;
  return group;
}

/* --- 語彙10: 風見盤（床象嵌。動線ラインの起点） ------------------------- */

/**
 * 風見盤。拠点中心の床に打つ方位盤の象嵌と、そこから各入口へ伸びる銅の動線ライン。
 * **完全に平ら**（最大 0.14 m）なので遮蔽にならない。ARCH_BRIEF §3.6。
 */
export function createCompassInlay(THREE, materials, {
  radiusM = 5.2,
  rays = 16,
  lanes = [],
  laneWidthM = 0.62,
  name = 'kazami-compass',
} = {}) {
  const s = sink();
  // 盤の下地
  s.add(new THREE.CylinderGeometry(radiusM, radiusM, 0.05, 24, 1, false), materials.stoneJoint,
    { position: [0, 0.025, 0], shade: [0.66, 0.8] });
  s.add(new THREE.CylinderGeometry(radiusM * 0.94, radiusM * 0.94, 0.05, 24, 1, false), materials.stone,
    { position: [0, 0.06, 0], shade: [0.95, 1.02] });
  // 方位の輻（16方位。長短を交互に）
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const long = i % 4 === 0;
    const len = radiusM * (long ? 0.9 : 0.56);
    s.add(new THREE.BoxGeometry(long ? 0.2 : 0.11, 0.03, len), materials.gold, {
      position: [Math.sin(a) * len * 0.5, 0.095, Math.cos(a) * len * 0.5],
      rotation: [0, a, 0], shade: [1.0, 1.1],
    });
  }
  // 中心の環（船の羅針）
  s.add(new THREE.CylinderGeometry(0.72, 0.72, 0.07, 16, 1, false), materials.gold,
    { position: [0, 0.105, 0], shade: [1.02, 1.12] });
  s.add(new THREE.CylinderGeometry(0.5, 0.5, 0.05, 16, 1, false), materials.roof,
    { position: [0, 0.13, 0], shade: [1.0, 1.1] });
  // 動線ライン（入口へ伸びる銅の帯）
  for (const lane of lanes) {
    const dx = lane[0]; const dz = lane[1];
    const len = Math.hypot(dx, dz);
    if (len < 0.5) continue;
    s.add(new THREE.BoxGeometry(laneWidthM, 0.03, len - radiusM * 0.9), materials.gold, {
      position: [dx * 0.5 * (1 + radiusM * 0.9 / len), 0.09, dz * 0.5 * (1 + radiusM * 0.9 / len)],
      rotation: [0, Math.atan2(dx, dz), 0], shade: [1.0, 1.08],
    });
  }
  const group = bake(THREE, s.parts, name);
  group.userData.kazamiVocabulary = 'compassInlay';
  group.userData.radiusM = radiusM;
  group.userData.heightM = 0.14;
  return group;
}

/* ================================================================== *
 * 3. 配置データ（この区画の「正」。テストも描画もここを読む）
 * ================================================================== */

const SL = KAZAMI_SLIPWAY;
const SLIP_MID_Y = (SL.sternY + SL.bowY) / 2;
const Z = KAZAMI_FLOOR_Z_M;

/** 高台（当たり判定 tower）の天面。ガントリーはここに立つ。 */
const PLATFORM = Object.freeze({ id: 'flash-site-kazami-high-platform', min: [-71, -53, 4], max: [-65, -47, 9] });

/**
 * 入口。前進スポーン（東 `[8,-72]`）と基地（西 `[-118,0]`）からの接近方向に
 * 背の高い門と灯を置く。**進む方向を示すのが仕事。**
 */
export const KAZAMI_GATES = Object.freeze([
  { id: 'gate-southeast', positionM: [-41.5, -52.5, Z], yawRad: -0.72, note: '東前進スポーン [8,-72] からの接近' },
  { id: 'gate-northwest', positionM: [-73.0, -31.5, Z], yawRad: 0.68, note: '西基地 [-118,0] からの接近' },
  { id: 'gate-north', positionM: [-49.5, -29.5, Z], yawRad: 0.06, note: '北の回り込み' },
  { id: 'gate-south', positionM: [-43.5, -58.5, Z], yawRad: -0.1, note: '南の回り込み' },
]);

/** 灯（単位モチーフの小スケール）。動線に沿って並べる。 */
export const KAZAMI_LAMPS = Object.freeze([
  [-45.5, -48.0], [-45.5, -40.0], [-66.5, -33.0], [-52.0, -32.5],
  [-61.0, -32.5], [-47.5, -56.5], [-58.5, -55.0], [-72.5, -44.0],
  [-72.5, -55.5], [-38.5, -44.0],
]);

/** 松（黒松）。プレイ空間に疎、境界に密（ARCH_BRIEF §3.5）。 */
export const KAZAMI_TREES = Object.freeze([
  // プレイ空間（疎。拠点中心から 9 m 以上、動線から外す）
  { xy: [-45.0, -33.5], h: 5.6 }, { xy: [-42.0, -37.5], h: 4.8 },
  { xy: [-70.5, -58.5], h: 5.2 }, { xy: [-74.0, -35.5], h: 6.0 },
  { xy: [-40.5, -58.0], h: 5.0 }, { xy: [-63.5, -58.5], h: 4.6 },
  // 区画の境界（密。柔らかい遮蔽で外周を閉じる）
  { xy: [-76.5, -28.5], h: 6.4 }, { xy: [-75.5, -32.0], h: 5.4 }, { xy: [-77.5, -37.5], h: 6.8 },
  { xy: [-77.0, -46.0], h: 5.8 }, { xy: [-78.0, -52.5], h: 6.6 }, { xy: [-76.0, -60.5], h: 5.2 },
  { xy: [-71.5, -63.5], h: 6.2 }, { xy: [-64.5, -64.0], h: 5.6 }, { xy: [-56.0, -63.5], h: 6.4 },
  { xy: [-48.0, -64.0], h: 5.4 }, { xy: [-39.0, -62.5], h: 6.0 }, { xy: [-35.5, -55.0], h: 6.6 },
  { xy: [-34.5, -46.0], h: 5.8 }, { xy: [-35.0, -37.0], h: 6.2 }, { xy: [-37.5, -28.5], h: 5.6 },
  { xy: [-44.5, -25.5], h: 6.4 }, { xy: [-54.0, -25.0], h: 5.8 }, { xy: [-66.0, -25.5], h: 6.6 },
]);

/** 遠景（層3・4）。競技境界 x[-126,126] y[-92,92] の外だけ。造船所の借景。 */
export const KAZAMI_DISTANT = Object.freeze([
  { kind: 'block', xy: [-142, -78], w: 26, d: 15, h: 17, note: '船台小屋' },
  { kind: 'block', xy: [-140, -100], w: 30, d: 16, h: 14, note: '船台小屋' },
  { kind: 'tower', xy: [-131, -95], w: 6.5, d: 6.5, h: 30, note: '起重機塔' },
  { kind: 'tower', xy: [-152, -88], w: 7.5, d: 7.5, h: 36, note: '起重機塔' },
  { kind: 'block', xy: [-108, -108], w: 22, d: 18, h: 13, note: '製材所' },
  { kind: 'tower', xy: [-90, -104], w: 5.5, d: 5.5, h: 24, note: '起重機塔' },
  { kind: 'ridge', xy: [-166, -120], w: 60, d: 34, h: 26, note: '南西の丘' },
  { kind: 'crag', xy: [-118, -132], w: 34, d: 26, h: 20, note: '南西の岩山' },
]);

/**
 * **この区画の配置データ。** `buildKazamiArchitecture()` はこの配列を順に組む。
 * `occlusion` は `KAZAMI_OCCLUSION_CLASSES` のキー。テストがこの宣言どおりか実測する。
 */
export const KAZAMI_STRUCTURES = Object.freeze([
  /* --- 層1: 床（すべて 0.45 m 以下） --- */
  {
    id: 'kazami-slipway-ways', vocabulary: 'slipwayWays', occlusion: 'flat',
    positionM: [SL.axisX, SLIP_MID_Y, Z], yawRad: 0,
    params: { lengthM: 20, gaugeM: SL.gaugeM, apronWidthM: 8.4 },
    note: '造船台の盤木と枕木。ガントリーの軌間に一致させ、進行方向を床で示す',
  },
  {
    id: 'kazami-compass-inlay', vocabulary: 'compassInlay', occlusion: 'flat',
    positionM: [KAZAMI_CENTER_M[0], KAZAMI_CENTER_M[1], Z], yawRad: 0,
    params: {
      radiusM: 5.2,
      lanes: KAZAMI_GATES.map(g => [g.positionM[0] - KAZAMI_CENTER_M[0], g.positionM[1] - KAZAMI_CENTER_M[1]])
        .map(([dx, dy]) => {
          const len = Math.hypot(dx, dy);
          const clip = Math.min(len, 11.5);
          return [dx / len * clip, dy / len * clip];
        }),
    },
    note: '風見盤。拠点中心の象嵌から4つの門へ銅の動線ラインを伸ばす',
  },

  /* --- 層2: この区画の核（近景シルエット層） --- */
  {
    id: 'kazami-keel-hull', vocabulary: 'keelHull', occlusion: 'permeable',
    positionM: [SL.axisX, SLIP_MID_Y, Z + 0.34], yawRad: 0,
    params: { lengthM: 15, stations: 13, maxHalfBeamM: 2.25, maxRiseM: 5.0, ribSection: 0.26 },
    note: '組みかけの船殻。肋骨は 0.26 m 角の細材で、間隔 1.15 m。射線を切らない',
  },
  {
    id: 'kazami-mast-fore', vocabulary: 'shipMast', occlusion: 'permeable',
    positionM: [SL.axisX, SLIP_MID_Y + 4.1, Z + 1.1], yawRad: 0.12,
    params: { height: 15.5, baseRadius: 0.3, topRadius: 0.15, yards: [{ at: 0.55, lengthM: 5.2 }], vaneScale: 'medium', headingRad: 0.4 },
    note: '三本帆柱の前檣',
  },
  {
    id: 'kazami-mast-main', vocabulary: 'shipMast', occlusion: 'permeable',
    positionM: [SL.axisX, SLIP_MID_Y, Z + 1.1], yawRad: 0,
    params: { height: 21.0, baseRadius: 0.36, topRadius: 0.18, vaneScale: 'medium', headingRad: 0.75 },
    note: '三本帆柱の主檣。頂部 z≈27。マップのどこからでも見える',
  },
  {
    id: 'kazami-mast-mizzen', vocabulary: 'shipMast', occlusion: 'permeable',
    positionM: [SL.axisX, SLIP_MID_Y - 4.1, Z + 1.1], yawRad: -0.14,
    params: { height: 12.5, baseRadius: 0.27, topRadius: 0.14, yards: [{ at: 0.6, lengthM: 4.2 }], vaneScale: 'medium', headingRad: 1.2 },
    note: '三本帆柱の後檣',
  },
  {
    id: 'kazami-keel-gantry', vocabulary: 'keelGantry', occlusion: 'permeable',
    positionM: [(PLATFORM.min[0] + PLATFORM.max[0]) / 2, (PLATFORM.min[1] + PLATFORM.max[1]) / 2, Z], yawRad: 0,
    supportSolidId: PLATFORM.id,
    params: { gaugeM: SL.gaugeM, baseM: 5.2, legHeight: 15.0, headHeight: 18.6, jibM: 9.0 },
    note: '中ランドマーク。柱4本は高台 AABB のフットプリント内。ジブは船首方向へ張り出す',
  },
  {
    id: 'kazami-gantry-north-portal', vocabulary: 'timberBent', occlusion: 'permeable',
    positionM: [SL.axisX, SL.bowY + 1.4, Z], yawRad: Math.PI / 2,
    params: { span: SL.gaugeM + 1.4, postHeight: 11.5, riseM: 2.0, postSection: 0.4 },
    note: '軌道の北端の門型。ガントリーと同じ形を小さく反復（モジュールの3スケール反復）',
  },
  {
    id: 'kazami-catwalk-west', vocabulary: 'gantryCatwalk', occlusion: 'aerial',
    positionM: [SL.axisX - SL.gaugeM / 2 - 0.9, SLIP_MID_Y + 1.0, Z], yawRad: 0,
    params: { lengthM: 15, widthM: 1.0, deckHeight: 12.6, supportSpacing: 7.2 },
    aerialSupportNote: '支柱は 0.3 m 角（permeable 規則も同時に満たす）',
    note: '軌道の西を渡る空中歩廊。頭上を通し、地表に縞の影を落とす',
  },
  {
    id: 'kazami-catwalk-east', vocabulary: 'gantryCatwalk', occlusion: 'aerial',
    positionM: [SL.axisX + SL.gaugeM / 2 + 0.9, SLIP_MID_Y + 1.0, Z], yawRad: 0,
    params: { lengthM: 15, widthM: 1.0, deckHeight: 12.6, supportSpacing: 7.2 },
    note: '同・東側',
  },

  /* --- 層2: 船架小屋の小屋組（壁体 AABB の天面に載る） --- */
  {
    id: 'kazami-shed-bent-north-west', vocabulary: 'timberBent', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-north',
    positionM: [-62.6, -30, 11], yawRad: 0,
    params: { span: 8.0, postHeight: 0.5, riseM: 2.6, postSection: 0.32 },
    note: '北の船架小屋の妻側小屋組。壁タグは ARCH_WALKABLE_TAGS に無く人が立たない',
  },
  {
    id: 'kazami-shed-bent-north-east', vocabulary: 'timberBent', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-north',
    positionM: [-56.4, -30, 11], yawRad: 0,
    params: { span: 8.0, postHeight: 0.5, riseM: 2.6, postSection: 0.32 },
    note: '同・東妻',
  },
  {
    id: 'kazami-shed-bent-south-west', vocabulary: 'timberBent', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-south',
    positionM: [-55.6, -58, 11], yawRad: 0,
    params: { span: 8.0, postHeight: 0.5, riseM: 2.6, postSection: 0.32 },
    note: '南の船架小屋の妻側小屋組',
  },
  {
    id: 'kazami-shed-bent-south-east', vocabulary: 'timberBent', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-south',
    positionM: [-49.4, -58, 11], yawRad: 0,
    params: { span: 8.0, postHeight: 0.5, riseM: 2.6, postSection: 0.32 },
    note: '同・東妻',
  },
  {
    id: 'kazami-shed-vane-north', vocabulary: 'windVane', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-north',
    positionM: [-59.5, -30, 14.3], yawRad: 0,
    params: { scale: 'medium', headingRad: 0.9 },
    note: '棟の風見（中スケール）',
  },
  {
    id: 'kazami-shed-vane-south', vocabulary: 'windVane', occlusion: 'roofborne',
    sourceSolidId: 'flash-site-kazami-mass-south',
    positionM: [-52.5, -58, 14.3], yawRad: 0,
    params: { scale: 'medium', headingRad: -0.7 },
    note: '棟の風見（中スケール）',
  },

  /* --- 層1: 材木積み（当たり判定 cover の箱を丸太で満たす） --- */
  {
    id: 'kazami-stack-northwest', vocabulary: 'timberStack', occlusion: 'wrapped',
    sourceSolidId: 'flash-site-kazami-cover-northwest',
    note: '当たり判定 3x1.5x2.5 の内側だけを丸太で満たす。見た目と当たり判定が一致する',
  },
  {
    id: 'kazami-stack-northeast', vocabulary: 'timberStack', occlusion: 'wrapped',
    sourceSolidId: 'flash-site-kazami-cover-northeast',
    note: '同上',
  },
  {
    id: 'kazami-stack-south', vocabulary: 'timberStack', occlusion: 'wrapped',
    sourceSolidId: 'flash-site-kazami-cover-south',
    note: '当たり判定 4x1.5x2.5',
  },
]);

/* ================================================================== *
 * 4. ビルダー
 * ================================================================== */

/** `map_oshioi_flashpoint_geometry.js` から風見の当たり判定箱を**読むだけ**。 */
export function readKazamiSolids(solids = null) {
  const source = Array.isArray(solids) ? solids : buildOshioiFlashpointGeometry().solids;
  return source.filter(s => typeof s.id === 'string' && s.id.includes(`-${KAZAMI_SITE_ID}-`));
}

/** 風見の語彙に合わせた `wrapSolid` の tag 別レシピ上書き。 */
export const KAZAMI_TAG_OVERRIDES = Object.freeze({
  // 船架小屋 = 切妻の長屋。妻面を大きく開ける
  wall: { roof: 'gable', openings: 3, eaves: true, lattice: true, parapet: false },
  // 材木積みで包むので wrapSolid は使わない（下の SKIP_WRAP_TAGS）
  cover: null,
  // 高台は天面に石畳＋欄干。ガントリーの柱脚が載る
  tower: { roof: 'none', openings: 0, eaves: false, parapet: true, lattice: false, paving: true },
  // 目標パッドは自前の風見盤を敷くので wrapSolid の石畳は止める
  rim: { roof: 'none', openings: 0, eaves: false, parapet: false, lattice: false, paving: false },
  stair: { roof: 'none', openings: 0, eaves: false, parapet: true, lattice: false, paving: true },
});

/** `wrapSolid` を掛けないタグ（自前の語彙で包むもの／床）。 */
export const KAZAMI_SKIP_WRAP_TAGS = Object.freeze(['ground', 'slab', 'cover']);

/**
 * 風見（南西拠点）の建築をまるごと組む。
 *
 * @param {object} THREE  three 名前空間
 * @param {object} [options]
 * @param {object} [options.kit]     既存の arch_kit（マテリアル共有のため）
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 * @param {number} [options.seed=41]
 * @param {Array}  [options.solids]  当たり判定 solids（省略時は SSOT から読む）
 * @param {boolean}[options.distant=true] 層3・4の借景を含めるか
 * @param {boolean}[options.merge=true]   マテリアル単位に畳むか
 * @returns {THREE.Group} `userData.collision === false` の描画専用グループ。
 *                        `world`（Z-up）へそのまま `add` できる。
 */
export function buildKazamiArchitecture(THREE, options = {}) {
  const kit = options.kit || createArchKit(THREE, { detail: options.detail || 'medium' });
  const materials = kit.materials;
  const detail = options.detail || 'medium';
  const seed = Number.isFinite(options.seed) ? options.seed : 41;
  const solids = readKazamiSolids(options.solids);
  const solidById = new Map(solids.map(s => [s.id, s]));

  const root = new THREE.Group();
  root.name = 'arch-site-kazami';
  markDecorative(root);
  root.userData.siteId = KAZAMI_SITE_ID;
  root.userData.archSite = true;

  const parts = [];      // { id, node, occlusion, sourceSolidId, supportSolidId }
  const addPart = (node, meta) => {
    root.add(node);
    parts.push({ ...meta, node });
  };

  /* --- (a) 当たり判定の箱を建築へ変換（汎用の壁体・階段・欄干） --- */
  const wrapped = new THREE.Group();
  wrapped.name = 'kazami-wrapped-solids';
  markDecorative(wrapped);
  let wrapIndex = 0;
  const wrappedAudits = [];
  for (const solid of solids) {
    if (KAZAMI_SKIP_WRAP_TAGS.includes(solid.tag)) continue;
    const override = KAZAMI_TAG_OVERRIDES[solid.tag];
    const child = kit.wrapSolid(solid, {
      siteId: KAZAMI_SITE_ID,
      fit: 'flush',
      detail,
      seed: seed + wrapIndex * 13,
      merge: false,
      archStyle: 'pointed',
      ...(override ? { recipe: override } : {}),
    });
    child.userData.sourceSolidId = solid.id;
    wrapped.add(child);
    wrappedAudits.push({ id: solid.id, node: child, solid });
    wrapIndex += 1;
  }
  addPart(wrapped, { id: 'kazami-wrapped-solids', occlusion: 'wrapped', children: wrappedAudits });

  /* --- (b) 配置データに従って固有の構造物を建てる --- */
  const factories = {
    windVane: (p) => createWindVane(THREE, materials, p),
    timberBent: (p) => createTimberBent(THREE, materials, p),
    keelHull: (p) => createKeelHull(THREE, materials, { seed, ...p }),
    shipMast: (p) => createShipMast(THREE, materials, p),
    keelGantry: (p) => createKeelGantry(THREE, materials, p),
    gantryCatwalk: (p) => createGantryCatwalk(THREE, materials, p),
    slipwayWays: (p) => createSlipwayWays(THREE, materials, { seed: seed + 3, ...p }),
    timberStack: (p) => createTimberStack(THREE, materials, { seed: seed + 7, ...p }),
    shipyardGate: (p) => createShipyardGate(THREE, materials, p),
    compassInlay: (p) => createCompassInlay(THREE, materials, p),
  };

  for (const entry of KAZAMI_STRUCTURES) {
    const factory = factories[entry.vocabulary];
    if (!factory) throw new TypeError(`KAZAMI_UNKNOWN_VOCABULARY:${entry.vocabulary}`);
    let params = entry.params || {};
    let position = entry.positionM;
    // 材木積みは当たり判定 AABB から寸法を取る（見た目と当たり判定を一致させる）
    if (entry.vocabulary === 'timberStack' && entry.sourceSolidId) {
      const solid = solidById.get(entry.sourceSolidId);
      if (!solid) throw new TypeError(`KAZAMI_MISSING_SOLID:${entry.sourceSolidId}`);
      params = {
        widthM: solid.max[0] - solid.min[0],
        depthM: solid.max[1] - solid.min[1],
        heightM: solid.max[2] - solid.min[2],
        ...params,
      };
      position = [
        (solid.min[0] + solid.max[0]) / 2,
        (solid.min[1] + solid.max[1]) / 2,
        solid.min[2],
      ];
    }
    const node = factory(params);
    node.name = entry.id;
    // ローカル Y-up の (x, y, z) は、mountKazami で (game x, game z(up), game -y) に対応する。
    // すなわちローカル +Z は ゲーム -Y。yaw=0 で「ローカル +Z が南を向く」ため、
    // 船首を北へ向けたい構造物は yaw = PI を使う……のではなく、
    // 造形側で +Z を船首としているので、ここで PI を足して北向きにする。
    const yaw = (entry.yawRad || 0) + (entry.vocabulary === 'keelHull'
      || entry.vocabulary === 'keelGantry' || entry.vocabulary === 'slipwayWays'
      || entry.vocabulary === 'gantryCatwalk' ? Math.PI : 0);
    mountKazami(node, position, yaw);
    addPart(node, {
      id: entry.id,
      occlusion: entry.occlusion,
      sourceSolidId: entry.sourceSolidId || null,
      supportSolidId: entry.supportSolidId || null,
      vocabulary: entry.vocabulary,
    });
  }

  /* --- (c) 入口の門（背の高い要素＋灯） --- */
  for (const gate of KAZAMI_GATES) {
    const node = createShipyardGate(THREE, materials, { lampSide: 'east', name: gate.id });
    mountKazami(node, gate.positionM, gate.yawRad);
    addPart(node, { id: gate.id, occlusion: 'permeable', vocabulary: 'shipyardGate' });
  }

  /* --- (d) 灯（単位モチーフの反復） --- */
  const lamps = new THREE.Group();
  lamps.name = 'kazami-lamps';
  markDecorative(lamps);
  for (let i = 0; i < KAZAMI_LAMPS.length; i++) {
    const [x, y] = KAZAMI_LAMPS[i];
    const lamp = kit.createLampPost({ height: 4.6, side: 'east', globeRadius: 0.32, detail, name: `kazami-lamp-${i}` });
    mountKazami(lamp, [x, y, Z], 0);
    lamps.add(lamp);
  }
  addPart(lamps, { id: 'kazami-lamps', occlusion: 'permeable', vocabulary: 'lampPost' });

  /* --- (e) 植生（柔らかい遮蔽） --- */
  const grove = new THREE.Group();
  grove.name = 'kazami-grove';
  markDecorative(grove);
  for (let i = 0; i < KAZAMI_TREES.length; i++) {
    const t = KAZAMI_TREES[i];
    const tree = kit.createTree({
      height: t.h, crownRadius: t.h * 0.3, kind: 'pine', seed: seed + i * 17, detail,
      name: `kazami-pine-${i}`,
    });
    mountKazami(tree, [t.xy[0], t.xy[1], Z], (i * 0.7) % (Math.PI * 2));
    grove.add(tree);
  }
  addPart(grove, { id: 'kazami-grove', occlusion: 'soft', vocabulary: 'tree' });

  /* --- (f) 遠景（層3・4）。競技境界の外だけ --- */
  if (options.distant !== false) {
    const distant = new THREE.Group();
    distant.name = 'kazami-distant';
    markDecorative(distant);
    for (let i = 0; i < KAZAMI_DISTANT.length; i++) {
      const d = KAZAMI_DISTANT[i];
      const mass = kit.createSilhouetteMass({
        kind: d.kind, width: d.w, depth: d.d, height: d.h, seed: seed + i * 29,
        name: `kazami-distant-${i}`,
      });
      mountKazami(mass, [d.xy[0], d.xy[1], 0], (i * 0.53) % Math.PI);
      distant.add(mass);
    }
    addPart(distant, { id: 'kazami-distant', occlusion: 'distant', vocabulary: 'silhouetteMass' });
  }

  root.userData.kazamiParts = parts.map(p => ({
    id: p.id, occlusion: p.occlusion, vocabulary: p.vocabulary || null,
    sourceSolidId: p.sourceSolidId || null, supportSolidId: p.supportSolidId || null,
  }));
  root.userData.wrappedSolidIds = wrappedAudits.map(a => a.id);

  if (options.merge !== false) kit.mergeArchRoot(root);
  markDecorative(root);
  return root;
}

/**
 * テスト用: 構造物を「宣言した遮蔽クラスごとに個別のグループ」で返す。
 * `buildKazamiArchitecture` と同じ配置だが、マージせず1件ずつ検査できる形。
 */
export function buildKazamiParts(THREE, options = {}) {
  const kit = options.kit || createArchKit(THREE, { detail: options.detail || 'medium' });
  const root = buildKazamiArchitecture(THREE, { ...options, kit, merge: false });
  const byId = new Map();
  for (const child of root.children) byId.set(child.name, child);
  return { kit, root, byId, manifest: root.userData.kazamiParts };
}

/** 支持面（人が立てる天面）の一覧。テストのプレイ帯判定に使う。 */
export function kazamiSupportSurfaces(solids = null) {
  const source = Array.isArray(solids) ? solids : buildOshioiFlashpointGeometry().solids;
  return source
    .filter(s => ARCH_WALKABLE_TAGS.includes(s.tag))
    .map(s => ({ id: s.id, min: s.min, max: s.max }));
}

export default buildKazamiArchitecture;
