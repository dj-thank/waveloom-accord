/**
 * site_shiogama.js — 中央拠点「塩窯」の建築（描画専用）
 *
 * 役割
 *   `map_oshioi.js` / `map_oshioi_flashpoint_geometry.js` の当たり判定 AABB を **読むだけ**で、
 *   arch_kit の「箱を包む」API（`wrapSolids`）で汎用建築へ変換し、そのうえに
 *   **塩窯にしかない固有の構造物**（塩焼き窯・煙突・湯気・枝条架・鹹水溝・祭儀灯柱）を足す。
 *
 * 絶対規則（ARCH_BRIEF §1 / survey §6.5）
 *   - `solids` を一切変更しない。当たり判定は生成しない。全ノード `userData.collision === false`。
 *   - 共有ファイル（arch_kit.js / presentation.js / render.js / flashpoint_geometry.js）を書き換えない。
 *   - `world`（`render.js:245` で `rotation.x = -PI/2` 済み）へ直接 add する。
 *     単体プリミティブは Y-up ローカルで作り、`kit.mountZUp()` で Z-up 世界へ載せる。
 *   - 新規テクスチャ 0 枚。配色は arch_kit のパレット（貝灰漆喰の白＋金の差し色＋寒色は藍1色）。
 *
 * 「箱に見えない」ための2つの検査（tests/architecture_shiogama.test.js が実行する）
 *   1. 当たり判定の箱に載せる構造物 → `kit.auditFootprint(node, anchorSolid)` が `safe:true`。
 *      頭上クリアランス `ARCH_PLAY_CLEARANCE_M = 2.2`（AABB 底面から）より下では 1mm も外へ出さない。
 *   2. 当たり判定の無い場所へ置く装飾 → 床上 0.4〜2.2 m の帯における水平断面の連結成分が
 *      `OPEN_FLOOR_MASS_LIMIT_M2 = 0.6` 以下（＝細い柱や板しか置かない）。
 *      例外は `softOcclusion:true`（植生・吊り枝条。射線を完全には切らない）だけ。
 *
 * 塩窯の固有語彙（他4拠点と共有しない。共有してよいのは汎用の壁体・階段・欄干まで）
 *   saltKiln     八角の塩焼き窯（腰石＋バッター付き胴＋鉄輪＋焚口）。small/medium/large の3スケール
 *   kilnStack    煙突（八角のテーパー柱＋鉄輪＋開いた笠）。3スケールで反復
 *   ventHood     煙出し（4本の細柱で頭上 2.4 m より上に持ち上げた越屋根）
 *   steamPlume   湯気（半透明の低ポリ塊。必ず z ≥ 8 m）
 *   lanternHead  灯室（組子格子＋宝形屋根＋頂華）。3スケールで反復
 *   beaconColumn 祭儀灯柱（大ランドマーク。八角窯の腰＋角柱＋灯室＋葱花）
 *   saltGate     塩門（入口の背の高い標＋灯）
 *   brineTrellis 枝条架（鹹水を垂らす吊り架。柔らかい遮蔽）
 *   brineChannel 鹹水溝（碧い浅瀬＝唯一の寒色）＋ 塩と灰の山（高さ 0.38 m）
 *   kilnHouseRow 窯屋の列（境界壁の上に載る近景シルエット層）
 */

import { createArchKit, ARCH_PLAY_CLEARANCE_M } from '../../../client/img2threejs/runtime/arch_kit.js';

export const SHIOGAMA_SITE_ID = 'shiogama';
export const SHIOGAMA_CENTER_M = Object.freeze([0, 0, 2.5]);

/** 塩窯区画＝legacy core の地面 `canonical-001-ground` の範囲。 */
export const SHIOGAMA_DISTRICT_M = Object.freeze({ x: [-46, 46], y: [-34, 34] });

/** 当たり判定の無い床の上に置いてよい「不透明な塊」の水平断面上限（連結成分ごと）。 */
export const OPEN_FLOOR_MASS_LIMIT_M2 = 0.6;

/** 湯気はこの高さより下に出さない（プレイ高さの遮蔽に見せない）。 */
export const STEAM_MIN_Z_M = 8;

/* ------------------------------------------------------------------ *
 * ARCH_BRIEF §3.2「モジュールを3スケールで反復する」
 * 部品数を増やさずに密度を上げるための単位。塩窯は「窯」と「灯」が単位モチーフ。
 * ------------------------------------------------------------------ */
export const SHIOGAMA_MODULE_SCALES = Object.freeze({
  kiln: Object.freeze({ small: 0.62, medium: 1.55, large: 2.9 }),      // 八角窯の外接半径 m
  lantern: Object.freeze({ small: 0.62, medium: 1.05, large: 1.9 }),   // 灯室の一辺 m
  stack: Object.freeze({ small: 3.4, medium: 7.6, large: 15.5 }),      // 煙突の高さ m
});

/* ------------------------------------------------------------------ *
 * 当たり判定側の固定 id（`map_oshioi.js` の legacy core。読むだけ）
 * ------------------------------------------------------------------ */
const ID = Object.freeze({
  beaconBase: 'canonical-027-cover',                                   // 2.5x2.5x2.5 中央の角柱＝SSOTの 'square-beacon'
  kilnTowers: Object.freeze(['canonical-130-tower', 'canonical-131-tower']),  // 6x6x4 北窯屋根/南窯屋根 z=8
  kilnRails: Object.freeze(['canonical-132-wall', 'canonical-133-wall', 'canonical-134-wall',
    'canonical-135-wall', 'canonical-136-wall', 'canonical-137-wall']),
  gateMajor: Object.freeze(['canonical-154-cover', 'canonical-155-cover']),   // 1.6x1.6x5 東西の入口
  gateMinor: Object.freeze(['canonical-174-cover', 'canonical-175-cover',
    'canonical-176-cover', 'canonical-177-cover']),                    // 2x2x1.6 南北の入口
  ashWalls: Object.freeze(['canonical-074-wall', 'canonical-075-wall',
    'canonical-076-wall', 'canonical-077-wall']),                      // y=±26 の長い囲い壁 h=3
  ridgeWalls: Object.freeze(['canonical-004-wall', 'canonical-005-wall']),    // 94x1x10 区画境界（近景シルエットの土台）
  pad: 'canonical-010-slab',                                           // 12x12x2.5 目標の壇
});

/** 焚口壁（y=±20 の千鳥壁 5x0.4x2.2）。SSOT identity の 'staggered-kiln-walls'。 */
const FIREBOX_WALL_IDS = Object.freeze([
  'canonical-078-wall', 'canonical-079-wall', 'canonical-080-wall', 'canonical-081-wall',
  'canonical-082-wall', 'canonical-083-wall', 'canonical-084-wall', 'canonical-085-wall',
  'canonical-086-wall', 'canonical-087-wall', 'canonical-088-wall', 'canonical-089-wall',
  'canonical-090-wall', 'canonical-091-wall', 'canonical-092-wall', 'canonical-093-wall',
  'canonical-094-wall', 'canonical-095-wall', 'canonical-096-wall', 'canonical-097-wall',
]);

/** 床（石畳と動線ラインを敷く slab）。ARCH_BRIEF §3.6「床は単色にしない」。 */
const PAVED_SLAB_IDS = Object.freeze([
  'canonical-006-slab', 'canonical-007-slab', 'canonical-008-slab',
  'canonical-009-slab', 'canonical-010-slab', 'canonical-072-slab', 'canonical-073-slab',
]);

/** 固有語彙の一覧（テストの単一の出所）。汎用語彙（arch_kit）と id が衝突しないこと。 */
export const SHIOGAMA_VOCABULARY = Object.freeze([
  { id: 'saltKiln', triangleBudget: 2600, note: '八角の塩焼き窯。腰石＋バッター胴＋鉄輪＋焚口' },
  { id: 'kilnStack', triangleBudget: 1400, note: '煙突。八角テーパー＋鉄輪＋開いた笠' },
  { id: 'ventHood', triangleBudget: 900, note: '煙出し。細柱4本で頭上 2.4m より上へ屋根を逃がす' },
  { id: 'steamPlume', triangleBudget: 900, note: '湯気。半透明・低ポリ。z>=8m' },
  { id: 'lanternHead', triangleBudget: 2600, note: '灯室。組子格子＋宝形屋根＋頂華' },
  { id: 'beaconColumn', triangleBudget: 9000, note: '祭儀灯柱（大ランドマーク）' },
  { id: 'saltGate', triangleBudget: 4200, note: '塩門。入口の背の高い標と灯' },
  { id: 'brineTrellis', triangleBudget: 1800, note: '枝条架。柔らかい遮蔽' },
  { id: 'brineChannel', triangleBudget: 1600, note: '鹹水溝と塩・灰の山' },
  { id: 'kilnHouseRow', triangleBudget: 26000, note: '窯屋の列（近景シルエット層 6〜25m）' },
  { id: 'fireboxBay', triangleBudget: 2600, note: '焚口壁の笠木＋焚口＋煙突' },
  { id: 'ashCopingWall', triangleBudget: 9000, note: '灰囲い壁の笠木＋軒灯＋小窯' },
]);

/* ================================================================== *
 * 造形の小道具（arch_kit の bakeParts 相当。頂点色の縦グラデーションを焼く）
 * ================================================================== */

function createSink(THREE) {
  const parts = [];
  return {
    parts,
    add(geometry, material, opts = {}) {
      const {
        position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1],
        tint = [1, 1, 1], shade = [0.62, 1.02],
      } = opts;
      const matrix = new THREE.Matrix4().compose(
        new THREE.Vector3().fromArray(position),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
        Array.isArray(scale) ? new THREE.Vector3().fromArray(scale) : new THREE.Vector3(scale, scale, scale),
      );
      parts.push({ geometry, material, matrix, tint, shade });
    },
  };
}

function bakeSink(THREE, sink, name, markDecorative) {
  const group = new THREE.Group();
  group.name = name;
  const prepared = [];
  let minY = Infinity; let maxY = -Infinity;
  for (const part of sink.parts) {
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
    const [lo, hi] = part.shade;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) - minY) / span;
      const k = lo + (hi - lo) * t;
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

function rng(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function next() {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ================================================================== *
 * 固有語彙のファクトリ（すべて Y-up ローカル。原点は底面中心）
 * ================================================================== */

function createShiogamaVocabulary(THREE, kit) {
  const M = kit.materials;
  const mark = kit.markDecorative;

  /** 湯気専用の半透明マテリアル（新規テクスチャ 0 枚。頂点色つき） */
  const steamMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color('#f4efe4'),
    vertexColors: true,
    transparent: true,
    opacity: 0.3,
    depthWrite: false,
    roughness: 1,
    metalness: 0,
    flatShading: true,
  });
  steamMaterial.name = 'arch-steam';
  steamMaterial.userData.archMaterial = 'steam';

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  /** 八角柱（塩窯の基本断面）。radialSegments=8 の外接半径で指定する。 */
  const oct = (rTop, rBottom, h, open = true) => new THREE.CylinderGeometry(rTop, rBottom, h, 8, 1, open);
  const hoop = (r, tube) => new THREE.TorusGeometry(r, tube, 5, 8);

  /* --- 1. 塩焼き窯（八角）------------------------------------------ */
  /**
   * 腰石 → バッター（内転び）付きの胴 → 肩 → 喉。鉄輪（金）と焚口（アーチ＋炎）。
   * 半径は「外接半径」。水平フットプリントは 2*radius の正方形に必ず収まる。
   */
  const createSaltKiln = ({
    radius = 1.55,
    height = 3.2,
    batter = 0.82,
    fireboxes = 3,
    fireboxFacing = 0,
    hoops = 2,
    throat = true,
    glow = true,
    detail = 'medium',
    name = 'shiogama-salt-kiln',
  } = {}) => {
    const r = radius; const h = height;
    const group = new THREE.Group();
    group.name = name;
    const sink = createSink(THREE);
    const plinthH = h * 0.11;
    const drumH = h * 0.66;
    const shoulderH = h * 0.15;
    const throatH = h * 0.08;
    sink.add(oct(r * 0.99, r * 1.03, plinthH, false), M.stone,
      { position: [0, plinthH / 2, 0], shade: [0.44, 0.62] });
    sink.add(oct(r * batter, r * 0.99, drumH), M.plaster,
      { position: [0, plinthH + drumH / 2, 0], shade: [0.6, 1.02] });
    sink.add(oct(r * batter * 0.66, r * batter, shoulderH, false), M.plasterShade,
      { position: [0, plinthH + drumH + shoulderH / 2, 0], shade: [0.95, 1.06] });
    if (throat) {
      sink.add(oct(r * batter * 0.5, r * batter * 0.62, throatH, false), M.stoneJoint,
        { position: [0, plinthH + drumH + shoulderH + throatH / 2, 0], shade: [0.3, 0.5] });
    }
    for (let i = 0; i < Math.max(0, Math.round(hoops)); i++) {
      const t = 0.28 + (i / Math.max(1, hoops)) * 0.52;
      const y = plinthH + drumH * t;
      const rr = r * (0.99 + (batter - 0.99) * t);
      sink.add(hoop(rr * 1.005, Math.max(0.035, r * 0.035)), M.gold,
        { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0], shade: [0.95, 1.12] });
    }
    group.add(bakeSink(THREE, sink, `${name}-body`, mark));

    // 焚口: 開口の外面が胴の外面と一致するよう内側へ寄せる（フットプリント厳守）
    const count = Math.max(0, Math.round(fireboxes));
    const openW = Math.min(r * 0.62, 1.05);
    const openH = Math.min(h * 0.42, openW * 1.55);
    const openD = Math.min(0.3, r * 0.24);
    for (let i = 0; i < count; i++) {
      const a = fireboxFacing + (i / count) * Math.PI * 2;
      const rr = r * batter * 0.9 - openD / 2;
      const frame = kit.createArchOpening({
        width: openW, height: openH, style: 'round', depth: openD,
        reveal: Math.min(0.16, openW * 0.2), keystone: true, detail,
        name: `${name}-firebox`,
      });
      frame.position.set(Math.sin(a) * rr, plinthH + 0.02, Math.cos(a) * rr);
      frame.rotation.y = a;
      group.add(frame);
      if (glow) {
        const fire = createSink(THREE);
        fire.add(box(openW * 0.86, openH * 0.72, 0.06), M.lampEast,
          { position: [0, openH * 0.36 + plinthH, 0], shade: [0.8, 1.2] });
        const emb = bakeSink(THREE, fire, `${name}-fire`, mark);
        emb.position.set(Math.sin(a) * (rr - 0.04), 0.02, Math.cos(a) * (rr - 0.04));
        emb.rotation.y = a;
        group.add(emb);
      }
    }
    mark(group);
    group.userData.archVocabulary = 'saltKiln';
    group.userData.footprintM = [r * 2, r * 2];
    group.userData.heightM = h;
    return group;
  };

  /* --- 2. 煙突 ------------------------------------------------------ */
  const createKilnStack = ({
    height = 7.6,
    baseRadius = 0.52,
    topRatio = 0.66,
    hoops = 3,
    cowl = true,
    detail = 'medium',
    name = 'shiogama-kiln-stack',
  } = {}) => {
    const h = height; const rb = baseRadius; const rt = rb * topRatio;
    const group = new THREE.Group();
    group.name = name;
    const sink = createSink(THREE);
    sink.add(oct(rb * 1.06, rb * 1.14, h * 0.06, false), M.stone,
      { position: [0, h * 0.03, 0], shade: [0.42, 0.6] });
    sink.add(oct(rt, rb, h * 0.86), M.plaster,
      { position: [0, h * 0.06 + h * 0.43, 0], shade: [0.55, 1.04] });
    for (let i = 0; i < Math.max(0, Math.round(hoops)); i++) {
      const t = (i + 0.6) / (hoops + 0.4);
      const y = h * 0.06 + h * 0.86 * t;
      const rr = rb + (rt - rb) * t;
      sink.add(hoop(rr * 1.02, rb * 0.09), M.gold,
        { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0], shade: [0.95, 1.12] });
    }
    if (cowl) {
      // 開いた笠（外へ向かって広がる円錐）。曲線は屋根の役割（§3.7）
      sink.add(new THREE.CylinderGeometry(rt * 1.85, rt * 1.02, h * 0.055, 8, 1, true), M.roof,
        { position: [0, h * 0.945, 0], shade: [1.0, 1.1] });
      sink.add(oct(rt * 0.86, rt * 0.86, h * 0.04, false), M.stoneJoint,
        { position: [0, h * 0.99, 0], shade: [0.28, 0.42] });
      sink.add(hoop(rt * 1.9, rt * 0.1), M.gold,
        { position: [0, h * 0.972, 0], rotation: [Math.PI / 2, 0, 0], shade: [1.0, 1.15] });
    }
    group.add(bakeSink(THREE, sink, `${name}-body`, mark));
    mark(group);
    group.userData.archVocabulary = 'kilnStack';
    group.userData.footprintM = [rb * 2 * 1.14, rb * 2 * 1.14];
    group.userData.heightM = h;
    group.userData.mouthRadiusM = rt;
    return group;
  };

  /* --- 3. 煙出し（越屋根）------------------------------------------ */
  /**
   * 高台の天面に立つ。**プレイヤーの頭上（clearM）より上にしか塊を置かない。**
   * 支えは 4 本の細柱だけ（1本あたり水平断面 0.04 m² 未満）。
   */
  const createVentHood = ({
    width = 3.6,
    clearM = 2.4,
    hoodHeight = 1.5,
    postWidth = 0.19,
    name = 'shiogama-vent-hood',
  } = {}) => {
    const group = new THREE.Group();
    group.name = name;
    const sink = createSink(THREE);
    const half = width / 2 - postWidth;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      sink.add(box(postWidth, clearM, postWidth), M.timber,
        { position: [sx * half, clearM / 2, sz * half], shade: [0.4, 0.85] });
    }
    sink.add(box(width, 0.16, width), M.timber,
      { position: [0, clearM + 0.08, 0], shade: [0.7, 0.9] });
    sink.add(new THREE.CylinderGeometry(width * 0.16, width * 0.44, hoodHeight, 8, 1, true), M.plasterShade,
      { position: [0, clearM + 0.16 + hoodHeight / 2, 0], shade: [0.7, 1.05] });
    group.add(bakeSink(THREE, sink, `${name}-body`, mark));
    const roof = kit.createRoof({
      width: width * 0.72, depth: width * 0.72, height: width * 0.24,
      kind: 'hip', ridgeRatio: 0.06, overhang: width * 0.12, name: `${name}-roof`,
    });
    roof.position.y = clearM + 0.16 + hoodHeight;
    group.add(roof);
    mark(group);
    group.userData.archVocabulary = 'ventHood';
    group.userData.heightM = clearM + 0.16 + hoodHeight + width * 0.24;
    group.userData.mouthRadiusM = width * 0.16;
    return group;
  };

  /* --- 4. 湯気 ------------------------------------------------------ */
  const createSteamPlume = ({
    radius = 0.9,
    height = 6,
    puffs = 5,
    seed = 3,
    name = 'shiogama-steam',
  } = {}) => {
    const random = rng(seed);
    const sink = createSink(THREE);
    for (let i = 0; i < Math.max(1, Math.round(puffs)); i++) {
      const t = i / Math.max(1, puffs - 1);
      const r = radius * (0.6 + t * 1.5);
      sink.add(new THREE.IcosahedronGeometry(1, 0), steamMaterial, {
        position: [(random() - 0.5) * radius * 1.6 * t, height * (0.06 + t * 0.94), (random() - 0.5) * radius * 1.6 * t],
        scale: [r, r * (0.62 + random() * 0.3), r],
        rotation: [random() * 3, random() * 3, random() * 3],
        tint: [1, 1, 1],
        shade: [1.0, 1.0],
      });
    }
    const group = bakeSink(THREE, sink, name, mark);
    group.userData.archVocabulary = 'steamPlume';
    group.userData.softOcclusion = true;
    group.userData.heightM = height;
    return group;
  };

  /* --- 5. 灯室 ------------------------------------------------------ */
  const createLanternHead = ({
    size = 1.05,
    side = 'east',
    detail = 'medium',
    name = 'shiogama-lantern',
  } = {}) => {
    const s = size;
    const group = new THREE.Group();
    group.name = name;
    const sink = createSink(THREE);
    sink.add(box(s * 1.32, s * 0.13, s * 1.32), M.plasterShade,
      { position: [0, s * 0.065, 0], shade: [0.5, 0.7] });
    const post = s * 0.13;
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      sink.add(box(post, s * 0.95, post), M.timber,
        { position: [sx * (s / 2 - post / 2), s * 0.13 + s * 0.475, sz * (s / 2 - post / 2)], shade: [0.42, 0.9] });
    }
    sink.add(new THREE.SphereGeometry(s * 0.31, 8, 6), side === 'west' ? M.lampWest : M.lampEast,
      { position: [0, s * 0.13 + s * 0.46, 0], shade: [1, 1] });
    group.add(bakeSink(THREE, sink, `${name}-body`, mark));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const screen = kit.createLatticeScreen({
        width: s * 0.82, height: s * 0.86, columns: 4, rows: 5,
        barWidth: Math.max(0.035, s * 0.045), thickness: 0.05,
        pattern: 'kumiko', frame: true, detail, name: `${name}-screen`,
      });
      screen.position.set(Math.sin(a) * (s / 2 - 0.05), s * 0.16, Math.cos(a) * (s / 2 - 0.05));
      screen.rotation.y = a;
      group.add(screen);
    }
    const roof = kit.createRoof({
      width: s * 1.34, depth: s * 1.34, height: s * 0.62,
      kind: 'hip', ridgeRatio: 0.04, overhang: s * 0.2, name: `${name}-roof`,
    });
    roof.position.y = s * 1.1;
    group.add(roof);
    const finial = kit.createDome({
      radius: s * 0.26, height: s * 0.34, profile: 'onion',
      drumHeight: s * 0.1, finial: true, detail, name: `${name}-finial`,
    });
    finial.position.y = s * 1.1 + s * 0.62;
    group.add(finial);
    mark(group);
    group.userData.archVocabulary = 'lanternHead';
    group.userData.footprintM = [s * 1.74, s * 1.74];
    group.userData.heightM = s * 1.1 + s * 0.62 + s * 0.6;
    return group;
  };

  /* --- 6. 祭儀灯柱（大ランドマーク）-------------------------------- */
  /**
   * SSOT `identity.silhouette = 'octagonal-kiln-and-square-beacon'` をそのまま形にする。
   * 当たり判定 `canonical-027-cover`（2.5x2.5x2.5）の上に立ち、
   * 天面より上の軸は「壇の上に立つ人の頭上帯」で断面 0.6 m² を超えないよう細く保つ。
   */
  const createBeaconColumn = ({
    baseHeight = 2.5,
    baseRadius = 1.15,
    shaftTop = 8.6,
    detail = 'high',
    name = 'shiogama-beacon-column',
  } = {}) => {
    const group = new THREE.Group();
    group.name = name;
    const kiln = createSaltKiln({
      radius: baseRadius, height: baseHeight, batter: 0.86,
      fireboxes: 4, fireboxFacing: 0, hoops: 2, throat: false, detail,
      name: `${name}-hearth`,
    });
    group.add(kiln);

    const sink = createSink(THREE);
    // 角柱（八角ではなく四角＝'square beacon'）。断面 0.62 m 角 → 水平断面 0.38 m²
    const shaftH = shaftTop - baseHeight;
    sink.add(new THREE.CylinderGeometry(0.4, 0.46, shaftH, 4), M.plaster,
      { position: [0, baseHeight + shaftH / 2, 0], rotation: [0, Math.PI / 4, 0], shade: [0.6, 1.02] });
    for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      sink.add(box(0.085, shaftH, 0.085), M.timber,
        { position: [sx * 0.29, baseHeight + shaftH / 2, sz * 0.29], shade: [0.4, 0.9] });
    }
    for (let i = 0; i < 4; i++) {
      const y = baseHeight + shaftH * (0.16 + i * 0.24);
      sink.add(hoop(0.5, 0.045), M.gold,
        { position: [0, y, 0], rotation: [Math.PI / 2, 0, 0], shade: [0.95, 1.12] });
    }
    group.add(bakeSink(THREE, sink, `${name}-shaft`, mark));

    // 灯室（large）→ 宝形 → 上軸 → 葱花。ここから上は誰の頭上帯にも入らない
    const lantern = createLanternHead({
      size: SHIOGAMA_MODULE_SCALES.lantern.large, side: 'east', detail, name: `${name}-lantern`,
    });
    lantern.position.y = shaftTop;
    group.add(lantern);
    const lanternTop = shaftTop + lantern.userData.heightM;

    const upper = createSink(THREE);
    upper.add(new THREE.CylinderGeometry(0.3, 0.38, 3.2, 4), M.plaster,
      { position: [0, lanternTop + 1.6, 0], rotation: [0, Math.PI / 4, 0], shade: [0.75, 1.05] });
    for (let i = 0; i < 2; i++) {
      upper.add(hoop(0.4, 0.04), M.gold,
        { position: [0, lanternTop + 0.8 + i * 1.7, 0], rotation: [Math.PI / 2, 0, 0], shade: [1, 1.15] });
    }
    group.add(bakeSink(THREE, upper, `${name}-upper`, mark));

    const crown = kit.createDome({
      radius: 1.1, height: 1.55, profile: 'onion', drumHeight: 0.5, finial: true, detail,
      name: `${name}-crown`,
    });
    crown.position.y = lanternTop + 3.2;
    group.add(crown);

    mark(group);
    group.userData.archVocabulary = 'beaconColumn';
    group.userData.heightM = lanternTop + 3.2 + 2.6;
    return group;
  };

  /* --- 7. 塩門（入口の標）------------------------------------------ */
  const createSaltGate = ({
    pylonHeight = 5,
    pylonRadius = 0.78,
    lanternSize = SHIOGAMA_MODULE_SCALES.lantern.medium,
    banner = true,
    side = 'east',
    detail = 'medium',
    name = 'shiogama-salt-gate',
  } = {}) => {
    const group = new THREE.Group();
    group.name = name;
    const sink = createSink(THREE);
    const r = pylonRadius; const h = pylonHeight;
    sink.add(oct(r * 0.99, r * 1.02, h * 0.1, false), M.stone,
      { position: [0, h * 0.05, 0], shade: [0.42, 0.62] });
    sink.add(oct(r * 0.7, r * 0.99, h * 0.78), M.plaster,
      { position: [0, h * 0.1 + h * 0.39, 0], shade: [0.55, 1.02] });
    sink.add(oct(r * 0.86, r * 0.7, h * 0.12, false), M.plasterShade,
      { position: [0, h * 0.88 + h * 0.06, 0], shade: [0.98, 1.08] });
    for (let i = 0; i < 3; i++) {
      const t = 0.2 + i * 0.28;
      sink.add(hoop(r * (0.99 + (0.7 - 0.99) * t) * 1.02, r * 0.06), M.gold,
        { position: [0, h * 0.1 + h * 0.78 * t, 0], rotation: [Math.PI / 2, 0, 0], shade: [0.98, 1.12] });
    }
    if (banner) {
      // 藍の幟。頭上（AABB 底面 +2.2m）より上にだけ吊る
      for (const sx of [1, -1]) {
        sink.add(box(0.05, h * 0.34, r * 1.1), M.indigo, {
          position: [sx * r * 0.72, h * 0.62, 0], shade: [0.7, 1.0],
        });
      }
    }
    group.add(bakeSink(THREE, sink, `${name}-pylon`, mark));
    const lantern = createLanternHead({ size: lanternSize, side, detail, name: `${name}-lantern` });
    lantern.position.y = h;
    group.add(lantern);
    mark(group);
    group.userData.archVocabulary = 'saltGate';
    group.userData.heightM = h + lantern.userData.heightM;
    return group;
  };

  /* --- 8. 枝条架（柔らかい遮蔽）------------------------------------ */
  const createBrineTrellis = ({
    width = 5.2,
    height = 4.4,
    strands = 13,
    seed = 9,
    name = 'shiogama-brine-trellis',
  } = {}) => {
    const random = rng(seed);
    const sink = createSink(THREE);
    const post = 0.2;
    for (const sx of [1, -1]) {
      sink.add(box(post, height, post * 1.2), M.timber,
        { position: [sx * (width / 2 - post / 2), height / 2, 0], shade: [0.4, 0.9] });
    }
    sink.add(box(width + 0.3, 0.18, 0.24), M.timber,
      { position: [0, height - 0.09, 0], shade: [0.75, 0.95] });
    sink.add(box(width * 0.96, 0.12, 0.2), M.timber,
      { position: [0, height * 0.72, 0], shade: [0.6, 0.8] });
    const n = Math.max(2, Math.round(strands));
    for (let i = 0; i < n; i++) {
      const x = -width / 2 + ((i + 0.5) / n) * width;
      const drop = height * (0.52 + random() * 0.2);
      sink.add(box(0.05, drop, 0.05), M.foliageDeep, {
        position: [x, height - 0.18 - drop / 2, (random() - 0.5) * 0.12], shade: [0.4, 0.95],
      });
    }
    // 受けの浅い鹹水盤（碧＝唯一の寒色）。高さ 0.22 m
    sink.add(box(width * 0.92, 0.22, 1.5), M.shallow,
      { position: [0, 0.11, 0], shade: [0.75, 1.0] });
    const group = bakeSink(THREE, sink, name, mark);
    group.userData.archVocabulary = 'brineTrellis';
    group.userData.softOcclusion = true;   // 射線を完全には切らない（ARCH_BRIEF §3.5）
    group.userData.heightM = height;
    return group;
  };

  /* --- 9. 鹹水溝（低い床面の情報量。高さ 0.4 m 未満）--------------- */
  const createBrineChannel = ({
    length = 22,
    width = 3.4,
    mounds = 4,
    seed = 5,
    name = 'shiogama-brine-channel',
  } = {}) => {
    const random = rng(seed);
    const sink = createSink(THREE);
    sink.add(box(length, 0.14, width), M.stoneJoint,
      { position: [0, 0.07, 0], shade: [0.4, 0.6] });
    sink.add(box(length - 0.5, 0.1, width - 0.7), M.shallow,
      { position: [0, 0.16, 0], shade: [0.8, 1.05] });
    for (const sz of [1, -1]) {
      sink.add(box(length, 0.3, 0.36), M.stone,
        { position: [0, 0.15, sz * (width / 2 + 0.18)], shade: [0.55, 0.9] });
    }
    for (let i = 0; i < Math.max(0, Math.round(mounds)); i++) {
      const x = -length / 2 + ((i + 0.5) / Math.max(1, mounds)) * length;
      const sz = i % 2 ? 1 : -1;
      // 塩と灰の山: 0.38 m 未満に抑え「床上 0.4〜2.2 m の遮蔽帯」に入れない
      sink.add(new THREE.ConeGeometry(0.95 + random() * 0.4, 0.36, 7), M.plaster,
        { position: [x, 0.18, sz * (width / 2 + 1.5)], shade: [0.82, 1.06] });
      sink.add(new THREE.ConeGeometry(0.62, 0.3, 6), M.plasterShade,
        { position: [x + 1.3, 0.15, sz * (width / 2 + 2.6)], shade: [0.7, 0.95] });
    }
    const group = bakeSink(THREE, sink, name, mark);
    group.userData.archVocabulary = 'brineChannel';
    group.userData.heightM = 0.38;
    return group;
  };

  return {
    steamMaterial,
    createSaltKiln,
    createKilnStack,
    createVentHood,
    createSteamPlume,
    createLanternHead,
    createBeaconColumn,
    createSaltGate,
    createBrineTrellis,
    createBrineChannel,
  };
}

/* ================================================================== *
 * 配置（当たり判定の箱を読んで組み立てる）
 * ================================================================== */

const byId = (solids) => {
  const map = new Map();
  for (const solid of solids) map.set(solid.id, solid);
  return map;
};

const sizeOf = (s) => [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];
const centerOf = (s) => [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2];

/** 塩窯区画に属する当たり判定 AABB だけを取り出す（読むだけ。並べ替えもしない）。 */
export function selectShiogamaSolids(solids) {
  const { x, y } = SHIOGAMA_DISTRICT_M;
  return solids.filter((solid) => {
    const cx = (solid.min[0] + solid.max[0]) / 2;
    const cy = (solid.min[1] + solid.max[1]) / 2;
    return cx >= x[0] && cx <= x[1] && cy >= y[0] && cy <= y[1];
  });
}

/** 固有構造物が土台にする（＝汎用 wrap から除外する）solid の id 集合。 */
export function shiogamaBespokeSolidIds() {
  return new Set([
    ID.beaconBase,
    ...ID.kilnTowers,
    ...ID.gateMajor,
    ...ID.gateMinor,
    ...ID.ashWalls,
    ...ID.ridgeWalls,
    ...FIREBOX_WALL_IDS,
    ...PAVED_SLAB_IDS,
  ]);
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

/**
 * 塩窯の建築を組み立てる。
 *
 * @param {object} THREE  three モジュール（注入式）
 * @param {object} options
 * @param {Array}  options.solids           `buildMap().solids`（読むだけ）
 * @param {object} [options.kit]            既存の arch_kit インスタンス
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 * @param {boolean} [options.includeBackdrop=true]  境界外の遠景（層3）を含めるか
 * @param {boolean} [options.merge=false]   マテリアル単位に畳むか（描画用。検査前は false）
 * @returns {THREE.Group} Z-up の `world` へそのまま add できるグループ
 */
export function buildShiogamaArchitecture(THREE, options = {}) {
  const {
    solids = [],
    detail = 'medium',
    includeBackdrop = true,
    merge = false,
    seed = 61,
  } = options;
  const kit = options.kit || createArchKit(THREE, { detail });
  const vocab = createShiogamaVocabulary(THREE, kit);
  const district = selectShiogamaSolids(solids);
  const index = byId(district);
  const bespoke = shiogamaBespokeSolidIds();

  const root = new THREE.Group();
  root.name = 'shiogama-architecture';
  kit.markDecorative(root);

  /** 検査用の索引。{node, anchorSolidId, softOcclusion, kind} */
  const registry = [];
  const place = (node, kind, { anchorSolidId = null, position, yawRad = 0, softOcclusion = false } = {}) => {
    if (position) kit.mountZUp(node, position, yawRad);
    node.userData.shiogamaKind = kind;
    node.userData.shiogamaAnchor = anchorSolidId;
    if (softOcclusion) node.userData.softOcclusion = true;
    root.add(node);
    registry.push({ node, kind, anchorSolidId, softOcclusion: !!(softOcclusion || node.userData.softOcclusion) });
    return node;
  };

  /* --- 0. 汎用: 当たり判定の箱を機械的に建築へ ---------------------- */
  const wrapped = kit.wrapSolids(district, {
    siteId: SHIOGAMA_SITE_ID,
    seed,
    detail,
    skipTags: ['ground', 'slab'],
    filter: (solid) => !bespoke.has(solid.id),
    merge: false,
    name: 'shiogama-wrapped-solids',
  });
  root.add(wrapped);
  for (const child of wrapped.children) {
    if (child.userData?.sourceSolidId) {
      registry.push({ node: child, kind: 'wrapSolid', anchorSolidId: child.userData.sourceSolidId, softOcclusion: false });
    }
  }

  /* --- 1. 大ランドマーク: 祭儀灯柱（中央 [0,0,2.5]）---------------- */
  const beaconBase = index.get(ID.beaconBase);
  if (beaconBase) {
    const c = centerOf(beaconBase);
    const s = sizeOf(beaconBase);
    const beacon = vocab.createBeaconColumn({
      baseHeight: s[2], baseRadius: Math.min(s[0], s[1]) / 2 - 0.1, shaftTop: s[2] + 6.1, detail: 'high',
    });
    place(beacon, 'beaconColumn', { anchorSolidId: beaconBase.id, position: [c[0], c[1], beaconBase.min[2]] });
    const plume = vocab.createSteamPlume({ radius: 0.8, height: 5.5, puffs: 5, seed: 71 });
    place(plume, 'steamPlume', { position: [c[0], c[1], beaconBase.min[2] + beacon.userData.heightM + 0.6], softOcclusion: true });
  }

  /* --- 2. 中ランドマーク: 北窯・南窯（高台 [0,±13,8]）-------------- */
  ID.kilnTowers.forEach((id, i) => {
    const tower = index.get(id);
    if (!tower) return;
    const c = centerOf(tower);
    const s = sizeOf(tower);
    const r = Math.min(s[0], s[1]) / 2 - 0.05;
    const kiln = vocab.createSaltKiln({
      radius: Math.min(r, SHIOGAMA_MODULE_SCALES.kiln.large),
      height: s[2],
      batter: 0.84,
      fireboxes: 4,
      fireboxFacing: Math.PI / 4,
      hoops: 3,
      detail,
      name: `shiogama-kiln-large-${i}`,
    });
    place(kiln, 'saltKiln', { anchorSolidId: id, position: [c[0], c[1], tower.min[2]] });

    // 煙出し: 高台の天面に立つ人の頭上（+2.4m）より上にしか塊を置かない
    const hood = vocab.createVentHood({ width: Math.min(s[0], s[1]) * 0.62, clearM: 2.4, hoodHeight: 1.6 });
    place(hood, 'ventHood', { anchorSolidId: id, position: [c[0], c[1], tower.max[2]] });

    // 中ランドマークの本体: 大スケールの煙突。天面より 2.4m 上から生やす
    const stack = vocab.createKilnStack({
      height: SHIOGAMA_MODULE_SCALES.stack.large,
      baseRadius: 0.72, hoops: 4, detail,
      name: `shiogama-stack-large-${i}`,
    });
    const stackBaseZ = tower.max[2] + hood.userData.heightM - 0.4;
    place(stack, 'kilnStack', { anchorSolidId: id, position: [c[0], c[1], stackBaseZ] });
    const plume = vocab.createSteamPlume({ radius: 1.1, height: 8, puffs: 6, seed: 101 + i * 17 });
    place(plume, 'steamPlume', { position: [c[0], c[1], stackBaseZ + stack.userData.heightM], softOcclusion: true });
  });

  /* --- 3. 入口: 塩門（東西 大／南北 小）---------------------------- */
  ID.gateMajor.forEach((id, i) => {
    const solid = index.get(id);
    if (!solid) return;
    const c = centerOf(solid);
    const s = sizeOf(solid);
    const gate = vocab.createSaltGate({
      pylonHeight: s[2],
      pylonRadius: Math.min(s[0], s[1]) / 2 - 0.02,
      lanternSize: SHIOGAMA_MODULE_SCALES.lantern.medium,
      side: c[0] > 0 ? 'east' : 'west',
      detail,
      name: `shiogama-gate-major-${i}`,
    });
    place(gate, 'saltGate', {
      anchorSolidId: id,
      position: [c[0], c[1], solid.min[2]],
      yawRad: c[0] > 0 ? -Math.PI / 2 : Math.PI / 2,
    });
  });
  ID.gateMinor.forEach((id, i) => {
    const solid = index.get(id);
    if (!solid) return;
    const c = centerOf(solid);
    const s = sizeOf(solid);
    const gate = vocab.createSaltGate({
      pylonHeight: s[2],
      pylonRadius: Math.min(s[0], s[1]) / 2 - 0.02,
      lanternSize: SHIOGAMA_MODULE_SCALES.lantern.small,
      banner: false,
      side: c[0] > 0 ? 'east' : 'west',
      detail,
      name: `shiogama-gate-minor-${i}`,
    });
    place(gate, 'saltGate', { anchorSolidId: id, position: [c[0], c[1], solid.min[2]] });
  });

  /* --- 4. 焚口壁（y=±20 の千鳥壁 20 枚）---------------------------- *
   * 頭上クリアランス（AABB 底面 +2.2 m ＝壁の天面 z=6.2）より下では 1mm も出さない。
   * 出すのは笠木・軒灯・煙突だけ。近景 20 m のシルエットに律動を作る。            */
  FIREBOX_WALL_IDS.forEach((id, i) => {
    const wall = index.get(id);
    if (!wall) return;
    const c = centerOf(wall);
    const s = sizeOf(wall);
    const top = s[2];                       // ローカル Y: 壁の天面 = AABB 底面 +2.2
    const alongX = s[0] >= s[1];
    const len = alongX ? s[0] : s[1];
    const thick = alongX ? s[1] : s[0];
    const group = new THREE.Group();
    group.name = `shiogama-firebox-bay-${i}`;
    const sink = createSink(THREE);
    const M = kit.materials;
    // 焚口（壁面に彫り込む。厚み内に収める）
    const openW = Math.min(1.15, len * 0.26);
    const openH = Math.min(1.5, top * 0.66);
    const glowD = Math.max(0.05, thick * 0.3);
    for (const sz of [1, -1]) {
      sink.add(new THREE.BoxGeometry(openW * 0.92, openH * 0.8, glowD), M.lampEast, {
        position: [0, openH * 0.42, sz * (thick / 2 - glowD / 2 - 0.01)], shade: [0.85, 1.15],
      });
    }
    // 笠木（瓦）: 天面より上にだけ張り出す
    sink.add(new THREE.BoxGeometry(len + 0.7, 0.18, thick + 0.72), M.roof,
      { position: [0, top + 0.09, 0], shade: [0.95, 1.06] });
    sink.add(new THREE.BoxGeometry(len + 0.5, 0.14, thick + 0.42), M.plasterShade,
      { position: [0, top + 0.25, 0], shade: [1.0, 1.08] });
    const bake = bakeSink(THREE, sink, `${group.name}-body`, kit.markDecorative);
    group.add(bake);
    // 焚口の縁（アーチ）。両面。壁厚に収める
    for (const sz of [1, -1]) {
      const frame = kit.createArchOpening({
        width: openW, height: openH, style: 'round',
        depth: Math.max(0.12, thick * 0.55), reveal: 0.14, keystone: true, detail,
        name: `${group.name}-mouth`,
      });
      frame.position.set(0, 0.02, sz * (thick / 2 - Math.max(0.12, thick * 0.55) / 2));
      if (sz < 0) frame.rotation.y = Math.PI;
      group.add(frame);
    }
    // 軒灯（小スケールの灯モジュール）
    const lamp = vocab.createLanternHead({
      size: SHIOGAMA_MODULE_SCALES.lantern.small, side: c[1] > 0 ? 'east' : 'west', detail,
      name: `${group.name}-lamp`,
    });
    lamp.position.set(len / 2 - 0.5, top + 0.32, 0);
    group.add(lamp);
    // 煙突は 3 枚に 1 枚。3スケールで循環させて律動を作る
    if (i % 3 === 0) {
      const scaleKey = ['large', 'medium', 'small'][(i / 3) % 3];
      const stack = vocab.createKilnStack({
        height: SHIOGAMA_MODULE_SCALES.stack[scaleKey],
        baseRadius: scaleKey === 'large' ? 0.5 : scaleKey === 'medium' ? 0.4 : 0.3,
        hoops: scaleKey === 'small' ? 2 : 3, detail,
        name: `${group.name}-stack`,
      });
      stack.position.set(-len / 2 + 0.9, top + 0.32, 0);
      group.add(stack);
      if (scaleKey !== 'small') {
        const plume = vocab.createSteamPlume({
          radius: 0.6, height: 4.2, puffs: 4, seed: 211 + i * 13,
        });
        plume.position.set(-len / 2 + 0.9, top + 0.32 + SHIOGAMA_MODULE_SCALES.stack[scaleKey], 0);
        group.add(plume);
      }
    }
    kit.markDecorative(group);
    group.userData.archVocabulary = 'fireboxBay';
    place(group, 'fireboxBay', {
      anchorSolidId: id,
      position: [c[0], c[1], wall.min[2]],
      yawRad: alongX ? 0 : Math.PI / 2,
    });
  });

  /* --- 5. 灰囲い壁（y=±26 / h=3）---------------------------------- */
  ID.ashWalls.forEach((id, i) => {
    const wall = index.get(id);
    if (!wall) return;
    const c = centerOf(wall);
    const s = sizeOf(wall);
    const alongX = s[0] >= s[1];
    const len = alongX ? s[0] : s[1];
    const thick = alongX ? s[1] : s[0];
    const top = s[2];
    const group = new THREE.Group();
    group.name = `shiogama-ash-wall-${i}`;
    const M = kit.materials;
    const sink = createSink(THREE);
    // 腰石＋漆喰の帯（厚み内に収める）
    sink.add(new THREE.BoxGeometry(len, 0.5, thick * 1.0), M.stone,
      { position: [0, 0.25, 0], shade: [0.42, 0.62] });
    sink.add(new THREE.BoxGeometry(len, 0.16, thick * 1.0), M.gold,
      { position: [0, top - 0.55, 0], shade: [0.98, 1.1] });
    // 笠木は天面（= AABB 底面 +3.0 > 2.2）より上にだけ張り出す
    sink.add(new THREE.BoxGeometry(len, 0.2, thick + 0.7), M.roof,
      { position: [0, top + 0.1, 0], shade: [0.95, 1.06] });
    sink.add(new THREE.BoxGeometry(len, 0.12, thick + 0.36), M.plasterShade,
      { position: [0, top + 0.26, 0], shade: [1.0, 1.08] });
    group.add(bakeSink(THREE, sink, `${group.name}-body`, kit.markDecorative));

    // 律動: 6m ごとに軒灯、12m ごとに小窯（灰の白）。3スケール反復の「小」
    const lampPitch = 6.5;
    const lamps = Math.max(1, Math.floor(len / lampPitch));
    for (let k = 0; k <= lamps; k++) {
      const x = -len / 2 + (k / lamps) * len;
      const lamp = vocab.createLanternHead({
        size: SHIOGAMA_MODULE_SCALES.lantern.small, side: c[1] > 0 ? 'east' : 'west', detail,
        name: `${group.name}-lamp-${k}`,
      });
      lamp.position.set(x, top + 0.32, 0);
      group.add(lamp);
      if (k % 2 === 1) {
        const smallKiln = vocab.createSaltKiln({
          radius: SHIOGAMA_MODULE_SCALES.kiln.small,
          height: 1.35, batter: 0.78, fireboxes: 2, hoops: 1, glow: false, detail,
          name: `${group.name}-kiln-${k}`,
        });
        smallKiln.position.set(x - lampPitch * 0.5, top + 0.32, 0);
        group.add(smallKiln);
      }
    }
    kit.markDecorative(group);
    group.userData.archVocabulary = 'ashCopingWall';
    place(group, 'ashCopingWall', {
      anchorSolidId: id,
      position: [c[0], c[1], wall.min[2]],
      yawRad: alongX ? 0 : Math.PI / 2,
    });
  });

  /* --- 6. 近景シルエット層: 窯屋の列（境界壁 94x1x10 の上）--------- *
   * ARCH_BRIEF §3.1「近景建築 6〜25 m のシルエット層」が現状最大の欠落。
   * 高さ 10 m の境界壁の稜線に窯屋を並べ、塩窯の輪郭を空へ抜く。
   * 当たり判定の頭上帯（底面 +2.2 m）には一切張り出さない。                    */
  ID.ridgeWalls.forEach((id, w) => {
    const wall = index.get(id);
    if (!wall) return;
    const c = centerOf(wall);
    const s = sizeOf(wall);
    const alongX = s[0] >= s[1];
    const len = alongX ? s[0] : s[1];
    const thick = alongX ? s[1] : s[0];
    const top = s[2];
    const group = new THREE.Group();
    group.name = `shiogama-kiln-house-row-${w}`;
    const M = kit.materials;
    const sink = createSink(THREE);
    sink.add(new THREE.BoxGeometry(len, 0.34, thick + 0.9), M.roof,
      { position: [0, top + 0.17, 0], shade: [0.9, 1.02] });
    sink.add(new THREE.BoxGeometry(len, 0.16, thick + 0.4), M.gold,
      { position: [0, top - 0.9, 0], shade: [0.98, 1.1] });
    group.add(bakeSink(THREE, sink, `${group.name}-crest`, kit.markDecorative));

    const bays = 7;
    for (let k = 0; k < bays; k++) {
      const x = -len / 2 + ((k + 0.5) / bays) * len;
      const houseW = len / bays * 0.74;
      const houseD = 6.5;
      const houseH = 4.2 + ((k * 5 + w * 3) % 3) * 1.3;
      const houseZ = top + 0.34;
      const wallNode = kit.createArchWall({
        width: houseW, height: houseH, thickness: 0.5,
        openings: 2, opening: { style: 'round' }, style: 'round', band: true, detail,
        name: `${group.name}-face-${k}`,
      });
      wallNode.position.set(x, houseZ, houseD / 2 - 0.25);
      group.add(wallNode);
      const backNode = kit.createArchWall({
        width: houseW, height: houseH, thickness: 0.5,
        openings: 1, style: 'round', band: true, detail,
        name: `${group.name}-back-${k}`,
      });
      backNode.position.set(x, houseZ, -houseD / 2 + 0.25);
      backNode.rotation.y = Math.PI;
      group.add(backNode);
      const roof = kit.createRoof({
        width: houseW, depth: houseD, height: houseH * 0.42,
        kind: k % 2 ? 'gable' : 'hip', ridgeRatio: 0.4, overhang: 0.6, name: `${group.name}-roof-${k}`,
      });
      roof.position.set(x, houseZ + houseH, 0);
      group.add(roof);
      // 3スケールの窯モジュール（中）と煙突（中/大）
      if (k % 2 === 0) {
        const kiln = vocab.createSaltKiln({
          radius: SHIOGAMA_MODULE_SCALES.kiln.medium, height: 3.4, batter: 0.82,
          fireboxes: 3, hoops: 2, detail: 'low', name: `${group.name}-kiln-${k}`,
        });
        kiln.position.set(x - houseW * 0.36, houseZ, houseD * 0.62);
        group.add(kiln);
      }
      const scaleKey = k % 3 === 0 ? 'large' : k % 3 === 1 ? 'medium' : 'small';
      const stack = vocab.createKilnStack({
        height: SHIOGAMA_MODULE_SCALES.stack[scaleKey],
        baseRadius: scaleKey === 'large' ? 0.66 : scaleKey === 'medium' ? 0.5 : 0.36,
        hoops: 3, detail: 'low', name: `${group.name}-stack-${k}`,
      });
      stack.position.set(x + houseW * 0.38, houseZ + houseH * 0.4, -houseD * 0.2);
      group.add(stack);
      if (scaleKey === 'large') {
        const plume = vocab.createSteamPlume({ radius: 1.0, height: 7, puffs: 5, seed: 301 + k * 11 + w * 5 });
        plume.position.set(x + houseW * 0.38, houseZ + houseH * 0.4 + SHIOGAMA_MODULE_SCALES.stack[scaleKey], -houseD * 0.2);
        group.add(plume);
      }
    }
    kit.markDecorative(group);
    group.userData.archVocabulary = 'kilnHouseRow';
    place(group, 'kilnHouseRow', {
      anchorSolidId: id,
      position: [c[0], c[1], wall.min[2]],
      yawRad: alongX ? 0 : Math.PI / 2,
    });
  });

  /* --- 7. 床: 大判の石畳と動線ライン（ARCH_BRIEF §3.6）-------------- */
  const PAVING_LIFT = -0.045;   // 目地が床面から 1.5cm、動線ラインが 9cm だけ持ち上がる
  for (const id of PAVED_SLAB_IDS) {
    const slab = index.get(id);
    if (!slab) continue;
    const c = centerOf(slab);
    const s = sizeOf(slab);
    const half = [s[0] / 2, s[1] / 2];
    // 動線ライン: 拠点中心（0,0）へ向かう。床のローカル座標は [x, z]=[gx, -gy]
    const toCenter = [-c[0], -c[1]];
    const norm = Math.hypot(toCenter[0], toCenter[1]) || 1;
    const dir = [toCenter[0] / norm, toCenter[1] / norm];
    const reach = Math.min(half[0], half[1]) * 1.6;
    const lanes = [
      { from: [-dir[0] * reach, dir[1] * reach], to: [dir[0] * reach, -dir[1] * reach], width: 0.55 },
    ];
    if (id === ID.pad) {
      // 目標の壇は十字の動線＋外周のライン
      lanes.length = 0;
      lanes.push({ from: [-half[0] * 0.92, 0], to: [half[0] * 0.92, 0], width: 0.6 });
      lanes.push({ from: [0, -half[1] * 0.92], to: [0, half[1] * 0.92], width: 0.6 });
    }
    const paving = kit.createPavingPatch({
      width: s[0] - 0.12, depth: s[1] - 0.12,
      tileSizeM: Math.max(2.0, Math.min(s[0], s[1]) / 4),
      joint: 0.12, lanes, seed: 41 + id.length,
      name: `shiogama-paving-${id}`,
    });
    place(paving, 'pavingPatch', { position: [c[0], c[1], slab.max[2] + PAVING_LIFT] });
  }

  /* --- 8. 鹹水溝と枝条架（y=±26.6〜34 の沈んだ水路。床 z=0）-------- */
  const trenchY = [30.3, -30.3];
  trenchY.forEach((ty, t) => {
    for (let k = 0; k < 3; k++) {
      const x = -30 + k * 30 + (t ? 8 : -8);
      const channel = vocab.createBrineChannel({ length: 20, width: 3.0, mounds: 4, seed: 401 + k * 7 + t * 3 });
      place(channel, 'brineChannel', { position: [x, ty, 0], yawRad: 0 });
      const trellis = vocab.createBrineTrellis({
        width: 5.2, height: 4.4, strands: 13, seed: 431 + k * 11 + t * 5,
        name: `shiogama-trellis-${t}-${k}`,
      });
      place(trellis, 'brineTrellis', { position: [x + 9.5, ty, 0], yawRad: Math.PI / 2, softOcclusion: true });
    }
    // 境界には植生を密に（ARCH_BRIEF §3.5）
    for (let k = 0; k < 4; k++) {
      const bed = kit.createPlantingBed({
        width: 5.5, depth: 2.6, count: 4, seed: 501 + k * 13 + t * 7,
        kinds: ['pine', 'broadleaf'], treeHeightM: [3.4, 5.6], detail,
        name: `shiogama-planting-${t}-${k}`,
      });
      place(bed, 'plantingBed', { position: [-36 + k * 24, ty + (t ? -2.6 : 2.6), 0], softOcclusion: true });
    }
  });

  /* --- 9. プレイ空間の植生は疎に（柔らかい遮蔽）-------------------- */
  const sparseTrees = [
    [-27, 12.5], [27, -12.5], [-27, -12.5], [27, 12.5],
    [-16.5, 6.5], [16.5, -6.5],
  ];
  sparseTrees.forEach(([x, y], i) => {
    const tree = kit.createTree({
      height: 5.6 + (i % 3) * 0.7, crownRadius: 1.9, kind: i % 2 ? 'pine' : 'broadleaf',
      seed: 601 + i * 9, detail, name: `shiogama-tree-${i}`,
    });
    place(tree, 'tree', { position: [x, y, 4], softOcclusion: true });
  });

  /* --- 10. 遠景（層3）: 塩田の町並み。境界外にだけ置く -------------- */
  if (includeBackdrop) {
    const backdrop = new THREE.Group();
    backdrop.name = 'shiogama-backdrop';
    kit.markDecorative(backdrop);
    const random = rng(seed + 7);
    for (let side = -1; side <= 1; side += 2) {
      for (let k = 0; k < 9; k++) {
        const x = -64 + k * 16 + (random() - 0.5) * 6;
        const y = side * (99 + random() * 16);
        const mass = kit.createSilhouetteMass({
          kind: ['block', 'tower', 'ridge', 'block'][k % 4],
          width: 11 + random() * 9, depth: 10 + random() * 8, height: 12 + random() * 16,
          seed: 700 + k * 13 + (side + 1) * 41,
          name: `shiogama-backdrop-mass-${side}-${k}`,
        });
        kit.mountZUp(mass, [x, y, 0]);
        backdrop.add(mass);
        if (k % 2 === 0) {
          const stack = vocab.createKilnStack({
            height: SHIOGAMA_MODULE_SCALES.stack.large * (0.9 + random() * 0.5),
            baseRadius: 0.9, hoops: 3, detail: 'low',
            name: `shiogama-backdrop-stack-${side}-${k}`,
          });
          kit.mountZUp(stack, [x + 6, y - side * 4, 8]);
          backdrop.add(stack);
          const plume = vocab.createSteamPlume({ radius: 1.6, height: 11, puffs: 5, seed: 801 + k * 7 + side });
          kit.mountZUp(plume, [x + 6, y - side * 4, 8 + SHIOGAMA_MODULE_SCALES.stack.large]);
          backdrop.add(plume);
        }
      }
    }
    root.add(backdrop);
    registry.push({ node: backdrop, kind: 'backdrop', anchorSolidId: null, softOcclusion: false, outsidePlayable: true });
  }

  root.userData.shiogama = {
    siteId: SHIOGAMA_SITE_ID,
    detail,
    structures: registry,
    vocabulary: SHIOGAMA_VOCABULARY.map(entry => entry.id),
    moduleScales: SHIOGAMA_MODULE_SCALES,
  };
  if (merge) kit.mergeArchRoot(root);
  return root;
}

/* ================================================================== *
 * 検査（テストが呼ぶ）
 * ================================================================== */

/**
 * 「当たり判定の箱がない場所に、遮蔽に見える不透明な塊を置いていないか」の実測。
 *
 * 床上 `bandLowM`〜`bandHighM` の帯を 0.25 m グリッドへ三角形の XY バウンディングボックスで
 * 保守的にラスタライズし、当たり判定 solid に覆われていないセルの連結成分の面積を返す。
 * `softOcclusion` の構造物（植生・枝条架・湯気）は対象外。
 *
 * @param {THREE.Object3D} root  `buildShiogamaArchitecture` の戻り値（merge 前）
 * @param {Array} solids         当たり判定 AABB
 */
export function auditShiogamaOpenFloorMass(root, solids, options = {}) {
  const {
    cellM = 0.25,
    bandLowM = 0.4,
    bandHighM = ARCH_PLAY_CLEARANCE_M,
    floors = [0, 4],
    bounds = SHIOGAMA_DISTRICT_M,
  } = options;

  const bands = floors.map(z => [z + bandLowM, z + bandHighM]);
  const inBand = (za, zb) => bands.some(([lo, hi]) => zb > lo && za < hi);

  const cols = Math.ceil((bounds.x[1] - bounds.x[0]) / cellM);
  const rows = Math.ceil((bounds.y[1] - bounds.y[0]) / cellM);
  const key = (i, j) => j * cols + i;

  // 当たり判定に覆われたセル（帯と重なる z を持つ solid）
  const covered = new Uint8Array(cols * rows);
  for (const solid of solids) {
    if (!inBand(solid.min[2], solid.max[2])) continue;
    const i0 = Math.max(0, Math.floor((solid.min[0] - bounds.x[0]) / cellM) - 1);
    const i1 = Math.min(cols - 1, Math.ceil((solid.max[0] - bounds.x[0]) / cellM));
    const j0 = Math.max(0, Math.floor((solid.min[1] - bounds.y[0]) / cellM) - 1);
    const j1 = Math.min(rows - 1, Math.ceil((solid.max[1] - bounds.y[0]) / cellM));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) covered[key(i, j)] = 1;
  }

  const occupied = new Uint8Array(cols * rows);
  const structures = root.userData?.shiogama?.structures || [];
  const skip = new Set();
  for (const entry of structures) {
    if (entry.softOcclusion || entry.outsidePlayable) entry.node.traverse(n => skip.add(n));
  }

  const a = { x: 0, y: 0, z: 0 }; const b = { x: 0, y: 0, z: 0 }; const c = { x: 0, y: 0, z: 0 };
  const vec = new (root.constructor === Object ? Object : Object)();  // 使わない（lint 回避）
  void vec;
  root.updateMatrixWorld(true);
  root.traverse((node) => {
    if (!node.isMesh || !node.geometry?.attributes?.position) return;
    if (skip.has(node)) return;
    let ancestor = node;
    while (ancestor) {
      if (ancestor.userData?.softOcclusion) return;
      ancestor = ancestor.parent;
    }
    const position = node.geometry.attributes.position;
    const matrix = node.matrixWorld.elements;
    const apply = (out, i) => {
      const x = position.getX(i); const y = position.getY(i); const z = position.getZ(i);
      out.x = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
      out.y = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
      out.z = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
    };
    for (let i = 0; i + 2 < position.count; i += 3) {
      apply(a, i); apply(b, i + 1); apply(c, i + 2);
      const za = Math.min(a.z, b.z, c.z); const zb = Math.max(a.z, b.z, c.z);
      if (!inBand(za, zb)) continue;
      const xa = Math.min(a.x, b.x, c.x); const xb = Math.max(a.x, b.x, c.x);
      const ya = Math.min(a.y, b.y, c.y); const yb = Math.max(a.y, b.y, c.y);
      if (xb < bounds.x[0] || xa > bounds.x[1] || yb < bounds.y[0] || ya > bounds.y[1]) continue;
      const i0 = Math.max(0, Math.floor((xa - bounds.x[0]) / cellM));
      const i1 = Math.min(cols - 1, Math.floor((xb - bounds.x[0]) / cellM));
      const j0 = Math.max(0, Math.floor((ya - bounds.y[0]) / cellM));
      const j1 = Math.min(rows - 1, Math.floor((yb - bounds.y[0]) / cellM));
      for (let j = j0; j <= j1; j++) for (let ii = i0; ii <= i1; ii++) {
        const k = key(ii, j);
        if (!covered[k]) occupied[k] = 1;
      }
    }
  });

  // 連結成分（4近傍）
  const cellArea = cellM * cellM;
  const seen = new Uint8Array(cols * rows);
  const components = [];
  const stack = [];
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const k = key(i, j);
      if (!occupied[k] || seen[k]) continue;
      let count = 0;
      let minI = i; let maxI = i; let minJ = j; let maxJ = j;
      stack.length = 0; stack.push(k); seen[k] = 1;
      while (stack.length) {
        const cur = stack.pop();
        const ci = cur % cols; const cj = (cur - ci) / cols;
        count += 1;
        if (ci < minI) minI = ci; if (ci > maxI) maxI = ci;
        if (cj < minJ) minJ = cj; if (cj > maxJ) maxJ = cj;
        const neighbours = [
          ci > 0 ? key(ci - 1, cj) : -1,
          ci < cols - 1 ? key(ci + 1, cj) : -1,
          cj > 0 ? key(ci, cj - 1) : -1,
          cj < rows - 1 ? key(ci, cj + 1) : -1,
        ];
        for (const n of neighbours) {
          if (n < 0 || seen[n] || !occupied[n]) continue;
          seen[n] = 1; stack.push(n);
        }
      }
      components.push({
        areaM2: Number((count * cellArea).toFixed(3)),
        centerM: [
          Number((bounds.x[0] + ((minI + maxI) / 2 + 0.5) * cellM).toFixed(2)),
          Number((bounds.y[0] + ((minJ + maxJ) / 2 + 0.5) * cellM).toFixed(2)),
        ],
      });
    }
  }
  components.sort((p, q) => q.areaM2 - p.areaM2);
  return {
    cellM,
    bands,
    componentCount: components.length,
    largest: components.slice(0, 8),
    maxAreaM2: components.length ? components[0].areaM2 : 0,
  };
}

/** 土台の当たり判定へのめり込み検査を全構造物へ回す。 */
export function auditShiogamaFootprints(kit, root, solids) {
  const index = byId(solids);
  const failures = [];
  const checked = [];
  for (const entry of root.userData?.shiogama?.structures || []) {
    if (!entry.anchorSolidId) continue;
    const anchor = index.get(entry.anchorSolidId);
    if (!anchor) { failures.push({ id: entry.anchorSolidId, reason: 'anchor-not-found' }); continue; }
    const report = kit.auditFootprint(entry.node, anchor);
    checked.push({ kind: entry.kind, anchorSolidId: entry.anchorSolidId, ...report });
    if (!report.safe) {
      failures.push({
        id: entry.anchorSolidId, kind: entry.kind,
        name: entry.node.name, maxProtrusionM: report.maxProtrusionM,
      });
    }
  }
  return { checked: checked.length, failures };
}

export default buildShiogamaArchitecture;
