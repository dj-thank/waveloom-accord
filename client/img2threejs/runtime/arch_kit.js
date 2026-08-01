/**
 * arch_kit.js — 大潮井の建築ボキャブラリー（曲面と開口）
 *
 * 目的: `map_blueprint.js` が box / stairs しか受け付けないため、当たり判定は
 * 軸平行の箱のままにしつつ、**見た目だけ**を任意形状の手続き建築で包む。
 *
 * 規約（ARCH_BRIEF §1 / survey §7.3）
 *  - 生成物はすべて描画専用。`userData.collision === false` を全ノードに付ける。
 *  - `solids` を読むだけで書かない。当たり判定は一切生成しない。
 *  - 造形は **Y-up ローカル空間**で作る（three の素のプリミティブと同じ向き）。
 *    ゲームの `world`（Z-up）へ載せるときは `mountZUp()` が
 *    `rotation.x = Math.PI / 2` を掛ける。Y-up ローカルの +Y が世界の +Z（上）になる。
 *    ※ すでに Z-up で書かれたグループに mountZUp を掛けてはいけない（横倒しになる）。
 *  - 新規 PNG を増やさない。配色は手続き的マテリアル＋頂点色のみ（ARCH_BRIEF §3.4）。
 *  - `geometry_kit.js` は編集しない。`createGeometryKit` を包んで語彙を足す。
 *  - 壁は直線・屋根と開口は曲線（ARCH_BRIEF §3.7）。
 *
 * すべての語彙は「マテリアルごとに 1 メッシュ」へ内部マージ済みで返る。
 * さらに `mergeArchRoot()` でグループ全体をマテリアル単位に畳めるので、
 * 拠点を丸ごと包んでもドローコールはマテリアル数（既定 13）で頭打ちになる。
 */

import { createGeometryKit } from './geometry_kit.js';

export const ARCH_KIT_ERRORS = Object.freeze({
  THREE_INVALID: 'ARCH_THREE_INVALID',
  AABB_INVALID: 'ARCH_AABB_INVALID',
  PARAM_INVALID: 'ARCH_PARAM_INVALID',
});

/* ------------------------------------------------------------------ *
 * 配色（ARCH_BRIEF §3.4）
 *   淡い暖色の大質量（貝灰漆喰の白）＋ 金の差し色 ＋ 寒色は1色（藍）＋ 緑の植生
 *   寒色は `COOL_HUE` の 1 色相からしか派生させない。
 * ------------------------------------------------------------------ */
export const ARCH_PALETTE = Object.freeze({
  plaster: '#efe6d6',        // 貝灰漆喰（主質量）
  plasterShade: '#d8cbb4',   // 同・陰面／下層
  plasterWarm: '#e2c9a6',    // 同・日照面の暖色寄り
  stone: '#b9ad99',          // 石畳・基壇
  stoneJoint: '#8e8271',     // 目地（暗い石）
  timber: '#7a5236',         // 杉・連子・格子
  gold: '#d6a53a',           // 金（差し色。面積を絞る）
  indigo: '#3f6ea8',         // 唯一の寒色（藍）。西の灯／布／深部
  indigoDeep: '#2b4d78',     // 同色相の暗い派生
  shallow: '#5f93ad',        // 碧い浅瀬（同色相の淡い派生）
  emberEast: '#ff9a4d',      // 東の灯（暖色側の光。寒色ではない）
  foliage: '#547a3c',        // 植生
  foliageDeep: '#3a5a2c',
  roof: '#8c6f5a',           // 瓦・屋根面
  silhouette: '#a2988a',     // 遠景の塊（層3・4）
});

const COOL_KEYS = Object.freeze(['indigo', 'indigoDeep', 'shallow']);

export const ARCH_DOME_SCALES = Object.freeze({
  small: { radiusM: 0.55, heightRatio: 1.25 },   // 頂華・軒灯
  medium: { radiusM: 2.0, heightRatio: 1.1 },    // 中屋根
  large: { radiusM: 6.0, heightRatio: 0.95 },    // 大ドーム
});

/** ARCH_BRIEF §3.1 の4層。距離帯で detail を決めるのに使う。 */
export const ARCH_DEPTH_LAYERS = Object.freeze({
  play: { id: 'play', rangeM: [0, 6], detail: 'high' },
  near: { id: 'near', rangeM: [6, 25], detail: 'medium' },
  city: { id: 'city', rangeM: [25, 80], detail: 'low' },
  frame: { id: 'frame', rangeM: [80, Infinity], detail: 'low' },
});

const DETAIL_LEVELS = Object.freeze({
  low: { radial: 8, rings: 5, arch: 5, lattice: 0.55 },
  medium: { radial: 14, rings: 8, arch: 8, lattice: 1 },
  high: { radial: 22, rings: 12, arch: 12, lattice: 1.4 },
});

/** 天面に人が立ちうるタグ。屋根や庇を上に生やさない（クリップ防止）。 */
export const ARCH_WALKABLE_TAGS = Object.freeze(['ground', 'slab', 'rim', 'stair', 'tower']);

/**
 * プレイヤーの頭上クリアランス。AABB 底面からこの高さまでは、装飾を
 * AABB の水平フットプリントの外へ出さない（当たり判定の無い壁にめり込まないため）。
 * これより上（庇・軒・屋根の出）は張り出してよい。むしろ影を作る主役になる。
 */
export const ARCH_PLAY_CLEARANCE_M = 2.2;

/* ------------------------------------------------------------------ *
 * 小道具
 * ------------------------------------------------------------------ */

function need(condition, code) {
  if (!condition) throw new TypeError(code);
}

/** 決定論的な擬似乱数（テストの再現性のため必須） */
export function archRandom(seed = 1) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function next() {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function detailOf(detail) {
  return DETAIL_LEVELS[detail] || DETAIL_LEVELS.medium;
}

/* ------------------------------------------------------------------ *
 * マテリアル（手続き的。テクスチャ 0 枚）
 * ------------------------------------------------------------------ */

/**
 * @returns {Object} 名前→THREE.Material。全マテリアルは vertexColors:true。
 *                   arch_kit が作るジオメトリには必ず color 属性が焼かれる。
 */
export function createArchMaterials(THREE, options = {}) {
  need(THREE?.MeshStandardMaterial, ARCH_KIT_ERRORS.THREE_INVALID);
  const { side, emissiveIntensity = 0.85, palette = ARCH_PALETTE } = options;
  const std = (name, hex, extra = {}) => {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(hex),
      vertexColors: true,
      ...extra,
    });
    material.name = `arch-${name}`;
    if (side !== undefined) material.side = side;
    material.userData.archMaterial = name;
    return material;
  };
  return {
    plaster: std('plaster', palette.plaster, { roughness: 0.92, metalness: 0.0 }),
    plasterShade: std('plasterShade', palette.plasterShade, { roughness: 0.95, metalness: 0.0 }),
    stone: std('stone', palette.stone, { roughness: 0.97, metalness: 0.0, flatShading: true }),
    stoneJoint: std('stoneJoint', palette.stoneJoint, { roughness: 1.0, metalness: 0.0 }),
    timber: std('timber', palette.timber, { roughness: 0.86, metalness: 0.0 }),
    gold: std('gold', palette.gold, { roughness: 0.3, metalness: 0.85 }),
    indigo: std('indigo', palette.indigo, { roughness: 0.7, metalness: 0.05 }),
    shallow: std('shallow', palette.shallow, { roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.85 }),
    roof: std('roof', palette.roof, { roughness: 0.8, metalness: 0.05 }),
    foliage: std('foliage', palette.foliage, { roughness: 1.0, metalness: 0.0, flatShading: true }),
    foliageDeep: std('foliageDeep', palette.foliageDeep, { roughness: 1.0, metalness: 0.0, flatShading: true }),
    lampEast: std('lampEast', palette.emberEast, {
      roughness: 0.4, emissive: new THREE.Color(palette.emberEast), emissiveIntensity,
    }),
    lampWest: std('lampWest', palette.indigo, {
      roughness: 0.4, emissive: new THREE.Color(palette.indigo), emissiveIntensity,
    }),
    silhouette: std('silhouette', palette.silhouette, { roughness: 1.0, metalness: 0.0, flatShading: true }),
  };
}

/** 配色規則の自己検査。寒色が1色相に収まっているか等をテストから確認できる。 */
export function auditArchPalette(palette = ARCH_PALETTE) {
  const hexToHsl = (hex) => {
    const r = parseInt(hex.slice(1, 3), 16) / 255;
    const g = parseInt(hex.slice(3, 5), 16) / 255;
    const b = parseInt(hex.slice(5, 7), 16) / 255;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const l = (max + min) / 2; const d = max - min;
    if (d === 0) return { h: 0, s: 0, l };
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h;
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return { h: (h * 60), s, l };
  };
  const cool = COOL_KEYS.map(key => ({ key, ...hexToHsl(palette[key]) }));
  const coolHues = cool.map(entry => entry.h);
  const hueSpread = Math.max(...coolHues) - Math.min(...coolHues);
  const base = hexToHsl(palette.plaster);
  return {
    coolKeys: [...COOL_KEYS],
    coolHueSpreadDeg: Number(hueSpread.toFixed(2)),
    coolIsSingleHue: hueSpread <= 30,
    baseIsWarmPale: base.l >= 0.7 && base.s <= 0.45,
    accentKey: 'gold',
    vegetationKeys: ['foliage', 'foliageDeep'],
  };
}

/* ------------------------------------------------------------------ *
 * パーツ収集とマージ（1 語彙 = マテリアル数ぶんのメッシュ）
 * ------------------------------------------------------------------ */

function stripGeometry(THREE, geometry) {
  const source = geometry.index ? geometry.toNonIndexed() : geometry.clone();
  if (!source.attributes.normal) source.computeVertexNormals();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', source.attributes.position.clone());
  out.setAttribute('normal', source.attributes.normal.clone());
  return out;
}

function createPartSink(THREE) {
  const parts = [];
  const add = (geometry, material, {
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    tint = [1, 1, 1],
    shade = [0.7, 1.0],
    matrix = null,
  } = {}) => {
    const m = matrix || new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
      Array.isArray(scale) ? new THREE.Vector3().fromArray(scale) : new THREE.Vector3(scale, scale, scale),
    );
    parts.push({ geometry, material, matrix: m, tint, shade });
    return parts[parts.length - 1];
  };
  return { parts, add };
}

/** parts を「マテリアル別に1メッシュ」へ畳んで Group に入れる。頂点色を焼く。 */
function bakeParts(THREE, parts, name) {
  const group = new THREE.Group();
  group.name = name;
  const prepared = [];
  let minY = Infinity; let maxY = -Infinity;
  for (const part of parts) {
    const geometry = stripGeometry(THREE, part.geometry);
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
    const [shadeLow, shadeHigh] = part.shade;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getY(i) - minY) / span;
      const k = shadeLow + (shadeHigh - shadeLow) * t;
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
    const mesh = new THREE.Mesh(concatGeometries(THREE, bucket.geometries), bucket.material);
    mesh.name = `${name}-${bucket.material?.userData?.archMaterial || 'part'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    markDecorative(mesh);
    group.add(mesh);
  }
  markDecorative(group);
  return group;
}

function concatGeometries(THREE, geometries) {
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

/** 描画専用マーカー。arch_kit が返すノードには必ず付く。 */
export function markDecorative(node) {
  node.userData.collision = false;
  node.userData.decorativeOnly = true;
  node.userData.staticDecoration = true;
  node.userData.archKit = true;
  return node;
}

/** Y-up ローカルで作った建築を Z-up の `world` へ載せる。 */
export function mountZUp(object3D, position = [0, 0, 0], yawRad = 0) {
  object3D.position.fromArray(position);
  object3D.rotation.set(Math.PI / 2, 0, 0);
  if (yawRad) {
    // 世界のヨー（Z軸まわり）はローカルの Y 軸まわりに相当する。
    object3D.rotation.set(Math.PI / 2, yawRad, 0, 'YXZ');
    object3D.rotation.order = 'YXZ';
    object3D.rotation.set(Math.PI / 2, yawRad, 0);
  }
  markDecorative(object3D);
  return object3D;
}

/* ------------------------------------------------------------------ *
 * 開口の輪郭（曲線を担当する側 / ARCH_BRIEF §3.7）
 * ------------------------------------------------------------------ */

/**
 * アーチ開口の外形を 2D 点列で返す（x 右・y 上、下端 y=0、中心 x=0）。
 * @param {'pointed'|'round'|'segmental'|'flat'} style
 */
export function archOutlinePoints({
  width = 2.2,
  height = 3.4,
  style = 'pointed',
  springRatio = 0.55,
  segments = 8,
} = {}) {
  need(width > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
  const a = width / 2;
  const seg = Math.max(3, Math.round(segments));
  if (style === 'flat') {
    return [[-a, 0], [a, 0], [a, height], [-a, height]];
  }
  let springY = Math.min(height * springRatio, height - a * 0.15);
  const rise = height - springY;
  const points = [[-a, 0], [a, 0], [a, springY]];
  if (style === 'pointed' && rise > a * 1.02) {
    // 等辺尖頭アーチ: 中心を対辺側にずらした2円弧が頂点で交わる。
    const c = (rise * rise - a * a) / (2 * a);
    const R = c + a;
    const endAngle = Math.acos(Math.min(1, Math.max(-1, c / R)));
    for (let i = 1; i <= seg; i++) {
      const angle = (i / seg) * endAngle;                       // 右円弧: 中心 (-c, springY)
      points.push([-c + R * Math.cos(angle), springY + R * Math.sin(angle)]);
    }
    for (let i = seg - 1; i >= 1; i--) {
      const angle = (i / seg) * endAngle;                       // 左円弧: 中心 (+c, springY)
      points.push([c - R * Math.cos(angle), springY + R * Math.sin(angle)]);
    }
  } else if (style === 'segmental') {
    const r = (a * a + rise * rise) / (2 * rise);
    const cy = springY + rise - r;
    const half = Math.asin(Math.min(1, a / r));
    for (let i = 1; i < seg * 2; i++) {
      const angle = half - (i / (seg * 2)) * (half * 2);
      points.push([r * Math.sin(angle), cy + r * Math.cos(angle)]);
    }
  } else {
    // 半円（round）。rise が半径未満のときの pointed もここに落ちる。
    springY = Math.max(0.02, height - a);
    points[2] = [a, springY];
    for (let i = 1; i < seg * 2; i++) {
      const angle = (i / (seg * 2)) * Math.PI;
      points.push([a * Math.cos(angle), springY + a * Math.sin(angle)]);
    }
  }
  points.push([-a, springY]);
  return points;
}

/* ------------------------------------------------------------------ *
 * 1. ドーム（3スケール共通・頂華つき）
 * ------------------------------------------------------------------ */

function domeProfile(THREE, radius, height, rings, profile) {
  const shapes = {
    hemisphere: { bulge: 1.0, shoulder: 0.55 },
    onion: { bulge: 1.22, shoulder: 0.62 },
    shallow: { bulge: 0.78, shoulder: 0.8 },
  };
  const { bulge, shoulder } = shapes[profile] || shapes.onion;
  const p0 = [radius, 0];
  const p1 = [radius * bulge, height * shoulder];
  const p2 = [0, height];
  const points = [];
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const u = 1 - t;
    const x = u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0];
    const y = u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1];
    points.push(new THREE.Vector2(Math.max(i === rings ? 0 : 0.001, x), y));
  }
  return points;
}

/* ------------------------------------------------------------------ *
 * 屋根の生ジオメトリ
 * ------------------------------------------------------------------ */

function hipRoofGeometry(THREE, width, depth, height, ridgeRatio) {
  const hw = width / 2; const hd = depth / 2;
  const rl = Math.max(0.0, Math.min(0.98, ridgeRatio)) * hw;
  // 下端 4 点（y=0）、棟 2 点（y=height）
  const b = [[-hw, 0, -hd], [hw, 0, -hd], [hw, 0, hd], [-hw, 0, hd]];
  const r0 = [-rl, height, 0]; const r1 = [rl, height, 0];
  const tri = [];
  const push = (...pts) => { for (const p of pts) tri.push(p[0], p[1], p[2]); };
  push(b[0], b[1], r1); push(b[0], r1, r0);            // 北面（台形）
  push(b[2], b[3], r0); push(b[2], r0, r1);            // 南面（台形）
  push(b[1], b[2], r1);                                // 東の寄せ
  push(b[3], b[0], r0);                                // 西の寄せ
  // 軒天（下向き面）で薄板に見せない
  push(b[0], b[2], b[1]); push(b[0], b[3], b[2]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tri), 3));
  geometry.computeVertexNormals();
  return geometry;
}

function gableRoofGeometry(THREE, width, depth, height) {
  return hipRoofGeometry(THREE, width, depth, height, 0.999);
}

/* ------------------------------------------------------------------ *
 * 本体
 * ------------------------------------------------------------------ */

/**
 * 建築キットを作る。geometry_kit の createGeometryKit を包み、建築語彙を足す。
 * @param {object} THREE  three モジュール（注入式）
 * @param {object} [options]
 * @param {Function} [options.mergeGeometries] geometry_kit 由来 API 用（任意）
 * @param {object}   [options.materials]       既存マテリアル群を使い回す場合
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 */
export function createArchKit(THREE, options = {}) {
  need(THREE?.Mesh && THREE?.Group && THREE?.BufferGeometry, ARCH_KIT_ERRORS.THREE_INVALID);
  const geometryKit = createGeometryKit(THREE, { mergeGeometries: options.mergeGeometries });
  const materials = options.materials || createArchMaterials(THREE, options);
  const defaultDetail = options.detail || 'medium';

  const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

  /* --- 1. ドーム ------------------------------------------------- */
  const createDome = ({
    scale = 'medium',
    radius = null,
    height = null,
    profile = 'onion',
    drumHeight = 0,
    finial = true,
    detail = defaultDetail,
    material = materials.plaster,
    finialMaterial = materials.gold,
    name = 'arch-dome',
  } = {}) => {
    const preset = ARCH_DOME_SCALES[scale] || ARCH_DOME_SCALES.medium;
    const r = Number.isFinite(radius) ? radius : preset.radiusM;
    const h = Number.isFinite(height) ? height : r * preset.heightRatio;
    need(r > 0 && h > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const sink = createPartSink(THREE);
    if (drumHeight > 0) {
      sink.add(new THREE.CylinderGeometry(r, r, drumHeight, d.radial, 1, true), material,
        { position: [0, drumHeight / 2, 0], shade: [0.62, 0.92] });
    }
    const points = domeProfile(THREE, r, h, d.rings, profile);
    sink.add(new THREE.LatheGeometry(points, d.radial), material,
      { position: [0, drumHeight, 0], shade: [0.68, 1.05] });
    if (finial) {
      const fr = r * 0.16;
      sink.add(new THREE.ConeGeometry(fr * 1.5, fr * 1.1, Math.max(6, d.radial / 2), 1), finialMaterial,
        { position: [0, drumHeight + h - fr * 0.2, 0], rotation: [Math.PI, 0, 0], shade: [0.9, 1.05] });
      sink.add(new THREE.SphereGeometry(fr, Math.max(6, d.radial / 2), Math.max(4, d.rings / 2)), finialMaterial,
        { position: [0, drumHeight + h + fr * 0.9, 0], shade: [0.95, 1.1] });
      sink.add(new THREE.ConeGeometry(fr * 0.42, fr * 2.1, Math.max(5, d.radial / 3), 1), finialMaterial,
        { position: [0, drumHeight + h + fr * 2.4, 0], shade: [1, 1.15] });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'dome';
    group.userData.archScale = scale;
    group.userData.footprintM = [r * 2, r * 2];
    group.userData.heightM = drumHeight + h + (finial ? r * 0.6 : 0);
    return group;
  };

  /* --- 2. アーチ開口 ---------------------------------------------- */
  /**
   * 開口“そのもの”ではなく、開口の縁（迫り石＋方立＋要石）を返す。
   * 壁のくり抜きは createArchWall / wrapSolid が holes として処理する。
   */
  const createArchOpening = ({
    width = 2.2,
    height = 3.4,
    style = 'pointed',
    depth = 0.45,
    reveal = 0.22,
    keystone = true,
    detail = defaultDetail,
    material = materials.plasterShade,
    keystoneMaterial = materials.gold,
    name = 'arch-opening',
  } = {}) => {
    const d = detailOf(detail);
    const inner = archOutlinePoints({ width, height, style, segments: d.arch });
    const outer = archOutlinePoints({
      width: width + reveal * 2,
      height: height + reveal,
      style,
      segments: d.arch,
    });
    const shape = new THREE.Shape();
    outer.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const hole = new THREE.Path();
    inner.forEach(([x, y], i) => (i ? hole.lineTo(x, y) : hole.moveTo(x, y)));
    hole.closePath();
    shape.holes.push(hole);
    const sink = createPartSink(THREE);
    const band = new THREE.ExtrudeGeometry(shape, { depth, steps: 1, bevelEnabled: false });
    band.translate(0, 0, -depth / 2);
    sink.add(band, material, { shade: [0.6, 1.0] });
    if (keystone) {
      const ks = Math.max(0.16, width * 0.14);
      sink.add(box(ks, ks * 1.5, depth * 1.14), keystoneMaterial,
        { position: [0, height + reveal - ks * 0.45, 0], shade: [0.85, 1.1] });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'archOpening';
    group.userData.openingM = { width, height, style };
    return group;
  };

  /**
   * 直線の壁体にアーチ開口をくり抜いて返す（ARCH_BRIEF §3.7 の役割分担そのもの）。
   * 壁はローカル XY 平面に立ち、厚みが Z。
   */
  const createArchWall = ({
    width = 9,
    height = 6,
    thickness = 0.4,
    openings = 2,
    opening = {},
    style = 'pointed',
    sill = 0,
    band = true,
    detail = defaultDetail,
    material = materials.plaster,
    trimMaterial = materials.plasterShade,
    name = 'arch-wall',
  } = {}) => {
    need(width > 0 && height > 0 && thickness > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const count = Math.max(0, Math.round(openings));
    const shape = new THREE.Shape();
    const hw = width / 2;
    shape.moveTo(-hw, 0); shape.lineTo(hw, 0); shape.lineTo(hw, height); shape.lineTo(-hw, height);
    shape.closePath();
    const placed = [];
    if (count > 0) {
      const pitch = width / count;
      const ow = Math.min(opening.width ?? pitch * 0.52, pitch * 0.78);
      const oh = Math.min(opening.height ?? Math.min(height * 0.72, ow * 1.9), height - 0.35);
      if (ow > 0.25 && oh > 0.4) {
        for (let i = 0; i < count; i++) {
          const cx = -hw + pitch * (i + 0.5);
          const points = archOutlinePoints({
            width: ow, height: oh, style: opening.style || style, segments: d.arch,
          });
          const path = new THREE.Path();
          points.forEach(([x, y], j) => {
            const px = x + cx; const py = y + sill;
            if (j) path.lineTo(px, py); else path.moveTo(px, py);
          });
          path.closePath();
          shape.holes.push(path);
          placed.push({ centerX: cx, width: ow, height: oh, sill });
        }
      }
    }
    const sink = createPartSink(THREE);
    // 帯（胴蛇腹・腰石）は「壁の外へ出す」のではなく「壁体を内側へ引く」ことで作る。
    // こうすると壁全体の外形は width x thickness x height の中に必ず収まる。
    const projection = band ? Math.min(0.07, thickness * 0.2) : 0;
    const bodyThickness = Math.max(0.06, thickness - projection * 2);
    const wall = new THREE.ExtrudeGeometry(shape, { depth: bodyThickness, steps: 1, bevelEnabled: false });
    wall.translate(0, 0, -bodyThickness / 2);
    sink.add(wall, material, { shade: [0.58, 1.0] });
    if (band) {
      const cornice = Math.min(0.28, height * 0.06);
      const plinth = Math.min(0.22, height * 0.05);
      sink.add(box(width, cornice, thickness), trimMaterial,
        { position: [0, height - cornice * 0.5, 0], shade: [0.9, 1.02] });
      sink.add(box(width, plinth, thickness), trimMaterial,
        { position: [0, plinth * 0.5, 0], shade: [0.5, 0.66] });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'archWall';
    group.userData.openings = placed;
    group.userData.footprintM = [width, thickness];
    group.userData.heightM = height;
    return group;
  };

  /* --- 3. 傾斜屋根・寄棟 ------------------------------------------ */
  const createRoof = ({
    width = 9,
    depth = 5,
    height = 2.2,
    kind = 'hip',
    ridgeRatio = 0.42,
    overhang = 0.5,
    ridgeCap = true,
    material = materials.roof,
    capMaterial = materials.plasterShade,
    name = 'arch-roof',
  } = {}) => {
    need(width > 0 && depth > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const w = width + overhang * 2; const dp = depth + overhang * 2;
    const sink = createPartSink(THREE);
    const geometry = kind === 'gable'
      ? gableRoofGeometry(THREE, w, dp, height)
      : hipRoofGeometry(THREE, w, dp, height, ridgeRatio);
    sink.add(geometry, material, { shade: [0.6, 1.05] });
    if (ridgeCap) {
      const rl = (kind === 'gable' ? 0.999 : ridgeRatio) * (w / 2) * 2;
      sink.add(box(Math.max(0.4, rl), 0.16, 0.34), capMaterial,
        { position: [0, height + 0.05, 0], shade: [0.95, 1.1] });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'roof';
    group.userData.footprintM = [w, dp];
    group.userData.heightM = height;
    return group;
  };

  /* --- 4. 庇・軒（開口の上に影を落とす主役） --------------------- */
  const createEave = ({
    width = 3.2,
    projection = 1.1,
    thickness = 0.14,
    drop = 0.34,
    brackets = 2,
    bracketDepth = 0.16,
    material = materials.timber,
    plateMaterial = materials.roof,
    name = 'arch-eave',
  } = {}) => {
    need(width > 0 && projection > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const sink = createPartSink(THREE);
    const slopeLength = Math.hypot(projection, drop);
    const angle = Math.atan2(drop, projection);
    sink.add(box(width, thickness, slopeLength), plateMaterial, {
      position: [0, -drop / 2, projection / 2],
      rotation: [angle, 0, 0],
      shade: [0.55, 1.0],
    });
    // 鼻隠し（先端の縁）— 影の輪郭をはっきりさせる
    sink.add(box(width * 1.02, thickness * 1.9, thickness * 1.6), material, {
      position: [0, -drop, projection], shade: [0.5, 0.8],
    });
    const count = Math.max(0, Math.round(brackets));
    for (let i = 0; i < count; i++) {
      const t = count === 1 ? 0.5 : i / (count - 1);
      const x = (t - 0.5) * width * 0.84;
      sink.add(box(bracketDepth, drop + thickness * 2, projection * 0.85), material, {
        position: [x, -drop / 2 - thickness, projection * 0.42],
        rotation: [angle * 0.5, 0, 0],
        shade: [0.42, 0.72],
      });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'eave';
    group.userData.footprintM = [width, projection];
    return group;
  };

  /* --- 5. 曲面テラス（段丘の縁を丸める） -------------------------- */
  const createCurvedTerrace = ({
    innerRadius = 4,
    outerRadius = 7,
    startAngleRad = -Math.PI / 2,
    endAngleRad = Math.PI / 2,
    height = 0.9,
    nosing = 0.12,
    detail = defaultDetail,
    material = materials.stone,
    edgeMaterial = materials.plaster,
    name = 'arch-terrace',
  } = {}) => {
    need(outerRadius > innerRadius && innerRadius >= 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const seg = Math.max(6, Math.round(d.radial * 1.2));
    const sweep = endAngleRad - startAngleRad;
    const shape = new THREE.Shape();
    for (let i = 0; i <= seg; i++) {
      const a = startAngleRad + (i / seg) * sweep;
      const x = Math.cos(a) * outerRadius; const y = Math.sin(a) * outerRadius;
      if (i) shape.lineTo(x, y); else shape.moveTo(x, y);
    }
    for (let i = seg; i >= 0; i--) {
      const a = startAngleRad + (i / seg) * sweep;
      shape.lineTo(Math.cos(a) * innerRadius, Math.sin(a) * innerRadius);
    }
    shape.closePath();
    const sink = createPartSink(THREE);
    const slab = new THREE.ExtrudeGeometry(shape, {
      depth: height, steps: 1, bevelEnabled: nosing > 0, bevelSegments: 2,
      bevelSize: nosing, bevelThickness: Math.min(nosing, height * 0.4),
    });
    // XY 平面で作った断面を水平（XZ）へ倒す
    slab.rotateX(-Math.PI / 2);
    slab.translate(0, height, 0);
    sink.add(slab, material, { shade: [0.5, 1.0] });
    // 縁の丸みを強調する外周リング
    const ringSeg = Math.max(6, Math.round(seg * 0.8));
    for (let i = 0; i < ringSeg; i++) {
      const a0 = startAngleRad + (i / ringSeg) * sweep;
      const a1 = startAngleRad + ((i + 1) / ringSeg) * sweep;
      const am = (a0 + a1) / 2;
      const chord = Math.hypot(
        Math.cos(a1) * outerRadius - Math.cos(a0) * outerRadius,
        Math.sin(a1) * outerRadius - Math.sin(a0) * outerRadius,
      );
      sink.add(box(chord * 1.02, 0.16, 0.22), edgeMaterial, {
        position: [Math.cos(am) * (outerRadius + 0.06), height + 0.08, Math.sin(am) * (outerRadius + 0.06)],
        rotation: [0, -am, 0],
        shade: [0.95, 1.1],
      });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'curvedTerrace';
    group.userData.heightM = height;
    return group;
  };

  /* --- 6. 格子スクリーン（開口を塞がず情報量を足す） -------------- */
  const createLatticeScreen = ({
    width = 2.4,
    height = 3.2,
    columns = 5,
    rows = 7,
    barWidth = 0.06,
    thickness = 0.06,
    pattern = 'kumiko',
    frame = true,
    detail = defaultDetail,
    material = materials.timber,
    frameMaterial = materials.plasterShade,
    name = 'arch-lattice',
  } = {}) => {
    need(width > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const cols = Math.max(1, Math.round(columns * d.lattice));
    const rws = Math.max(1, Math.round(rows * d.lattice * 0.7));
    const sink = createPartSink(THREE);
    for (let i = 1; i <= cols; i++) {
      const x = -width / 2 + (i / (cols + 1)) * width;
      sink.add(box(barWidth, height, thickness), material, { position: [x, height / 2, 0], shade: [0.4, 0.9] });
    }
    if (pattern !== 'vertical') {
      for (let j = 1; j <= rws; j++) {
        const y = (j / (rws + 1)) * height;
        sink.add(box(width, barWidth, thickness * 0.9), material, { position: [0, y, 0], shade: [0.4, 0.9] });
      }
    }
    if (pattern === 'kumiko') {
      const diag = Math.hypot(width, height);
      for (const sign of [1, -1]) {
        sink.add(box(diag, barWidth * 0.8, thickness * 0.8), material, {
          position: [0, height / 2, thickness * 0.5],
          rotation: [0, 0, sign * Math.atan2(height, width)],
          shade: [0.45, 0.95],
        });
      }
    }
    if (frame) {
      const f = barWidth * 2.2;
      sink.add(box(width + f, f, thickness * 1.6), frameMaterial, { position: [0, height + f / 2, 0], shade: [0.95, 1.05] });
      sink.add(box(width + f, f, thickness * 1.6), frameMaterial, { position: [0, -f / 2, 0], shade: [0.5, 0.6] });
      sink.add(box(f, height + f * 2, thickness * 1.6), frameMaterial, { position: [-(width + f) / 2, height / 2, 0], shade: [0.6, 1.0] });
      sink.add(box(f, height + f * 2, thickness * 1.6), frameMaterial, { position: [(width + f) / 2, height / 2, 0], shade: [0.6, 1.0] });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'latticeScreen';
    group.userData.footprintM = [width, thickness];
    group.userData.heightM = height;
    return group;
  };

  /* --- 7. 円柱列・柱廊 -------------------------------------------- */
  const createColonnade = ({
    count = 6,
    spacing = 2.6,
    radius = 0.28,
    height = 3.6,
    axis = 'x',
    entasis = 0.86,
    base = true,
    capital = true,
    architrave = true,
    arcade = false,
    arcadeStyle = 'round',
    detail = defaultDetail,
    material = materials.plaster,
    trimMaterial = materials.plasterShade,
    name = 'arch-colonnade',
  } = {}) => {
    need(count >= 1 && spacing > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const seg = Math.max(6, Math.round(d.radial * 0.6));
    const n = Math.round(count);
    const span = (n - 1) * spacing;
    const sink = createPartSink(THREE);
    const at = (t) => (axis === 'z' ? [0, 0, t] : [t, 0, 0]);
    const shaftHeight = height - (base ? 0.22 : 0) - (capital ? 0.2 : 0);
    for (let i = 0; i < n; i++) {
      const t = -span / 2 + i * spacing;
      const [px, , pz] = at(t);
      if (base) {
        sink.add(box(radius * 2.6, 0.22, radius * 2.6), trimMaterial, { position: [px, 0.11, pz], shade: [0.42, 0.6] });
      }
      sink.add(new THREE.CylinderGeometry(radius * entasis, radius, shaftHeight, seg, 1, true), material, {
        position: [px, (base ? 0.22 : 0) + shaftHeight / 2, pz], shade: [0.5, 1.0],
      });
      if (capital) {
        sink.add(box(radius * 2.8, 0.2, radius * 2.8), trimMaterial, {
          position: [px, height - 0.1, pz], shade: [0.98, 1.06],
        });
      }
    }
    if (architrave && n > 1) {
      const beam = span + radius * 3;
      sink.add(axis === 'z' ? box(radius * 2.4, 0.3, beam) : box(beam, 0.3, radius * 2.4), trimMaterial, {
        position: [0, height + 0.15, 0], shade: [1.0, 1.08],
      });
    }
    if (arcade && n > 1) {
      const clear = spacing - radius * 2;
      for (let i = 0; i < n - 1; i++) {
        const t = -span / 2 + i * spacing + spacing / 2;
        const [px, , pz] = at(t);
        const points = archOutlinePoints({
          width: clear, height: clear * 0.62, style: arcadeStyle, springRatio: 0.05, segments: d.arch,
        });
        const outer = archOutlinePoints({
          width: clear + 0.3, height: clear * 0.62 + 0.18, style: arcadeStyle, springRatio: 0.05, segments: d.arch,
        });
        const shape = new THREE.Shape();
        outer.forEach(([x, y], j) => (j ? shape.lineTo(x, y) : shape.moveTo(x, y)));
        shape.closePath();
        const hole = new THREE.Path();
        points.forEach(([x, y], j) => (j ? hole.lineTo(x, y) : hole.moveTo(x, y)));
        hole.closePath();
        shape.holes.push(hole);
        const spandrel = new THREE.ExtrudeGeometry(shape, { depth: radius * 1.6, steps: 1, bevelEnabled: false });
        spandrel.translate(0, 0, -radius * 0.8);
        sink.add(spandrel, material, {
          position: [px, height - clear * 0.62 - 0.28, pz],
          rotation: [0, axis === 'z' ? Math.PI / 2 : 0, 0],
          shade: [0.72, 1.0],
        });
      }
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'colonnade';
    group.userData.spanM = span;
    group.userData.heightM = height + (architrave ? 0.3 : 0);
    return group;
  };

  /* --- 8. パラペット・欄干 ---------------------------------------- */
  const createParapet = ({
    length = 9,
    height = 1.05,
    axis = 'x',
    postSpacing = 1.8,
    postWidth = 0.22,
    railThickness = 0.16,
    balusters = true,
    coping = true,
    detail = defaultDetail,
    material = materials.plaster,
    trimMaterial = materials.plasterShade,
    accentMaterial = materials.gold,
    name = 'arch-parapet',
  } = {}) => {
    need(length > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const d = detailOf(detail);
    const sink = createPartSink(THREE);
    const along = (w, h, t) => (axis === 'z' ? box(t, h, w) : box(w, h, t));
    const at = (t) => (axis === 'z' ? [0, 0, t] : [t, 0, 0]);
    sink.add(along(length, height * 0.34, 0.3), material, { position: [0, height * 0.17, 0], shade: [0.45, 0.75] });
    if (coping) {
      sink.add(along(length, railThickness, 0.42), trimMaterial, {
        position: [0, height - railThickness / 2, 0], shade: [1.0, 1.1],
      });
      sink.add(along(length, 0.05, 0.46), accentMaterial, {
        position: [0, height - railThickness - 0.03, 0], shade: [1.0, 1.12],
      });
    }
    const posts = Math.max(2, Math.round(length / Math.max(0.4, postSpacing)) + 1);
    for (let i = 0; i < posts; i++) {
      const t = -length / 2 + (i / (posts - 1)) * length;
      const [px, , pz] = at(t);
      sink.add(box(postWidth, height, postWidth * 1.3), material, { position: [px, height / 2, pz], shade: [0.5, 0.95] });
    }
    if (balusters && d.lattice > 0.6) {
      const gaps = posts - 1;
      const per = Math.max(1, Math.round(2 * d.lattice));
      const seg = Math.max(5, Math.round(d.radial * 0.4));
      for (let g = 0; g < gaps; g++) {
        for (let k = 1; k <= per; k++) {
          const t = -length / 2 + (length / gaps) * (g + k / (per + 1));
          const [px, , pz] = at(t);
          sink.add(new THREE.CylinderGeometry(0.055, 0.075, height * 0.55, seg, 1, true), trimMaterial, {
            position: [px, height * 0.34 + height * 0.275, pz], shade: [0.55, 0.95],
          });
        }
      }
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'parapet';
    group.userData.heightM = height;
    group.userData.lengthM = length;
    group.userData.depthM = coping ? 0.46 : Math.max(0.3, postWidth * 1.3);
    return group;
  };

  /* --- 9. 石畳パッチ（目地と動線ライン） -------------------------- */
  const createPavingPatch = ({
    width = 12,
    depth = 12,
    tileSizeM = 2.4,
    joint = 0.09,
    lanes = null,
    laneWidth = 0.5,
    laneAxis = 'z',
    seed = 7,
    material = materials.stone,
    jointMaterial = materials.stoneJoint,
    laneMaterial = materials.gold,
    name = 'arch-paving',
  } = {}) => {
    need(width > 0 && depth > 0 && tileSizeM > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const random = archRandom(seed);
    const sink = createPartSink(THREE);
    // 目地（暗い下地）を先に敷き、その上に石を浮かせる → 目地線が影として出る
    sink.add(box(width, 0.06, depth), jointMaterial, { position: [0, 0.03, 0], shade: [0.7, 0.9] });
    const cols = Math.max(1, Math.round(width / tileSizeM));
    const rows = Math.max(1, Math.round(depth / tileSizeM));
    const tw = width / cols; const td = depth / rows;
    for (let i = 0; i < cols; i++) {
      for (let j = 0; j < rows; j++) {
        const k = 0.82 + random() * 0.32;
        sink.add(box(tw - joint, 0.05, td - joint), material, {
          position: [-width / 2 + tw * (i + 0.5), 0.085, -depth / 2 + td * (j + 0.5)],
          tint: [k, k, k],
          shade: [0.98, 1.02],
        });
      }
    }
    const laneList = lanes || [
      laneAxis === 'z'
        ? { from: [0, -depth / 2], to: [0, depth / 2], width: laneWidth }
        : { from: [-width / 2, 0], to: [width / 2, 0], width: laneWidth },
    ];
    for (const lane of laneList) {
      const dx = lane.to[0] - lane.from[0];
      const dz = lane.to[1] - lane.from[1];
      const len = Math.hypot(dx, dz);
      if (len <= 0) continue;
      sink.add(box(lane.width || laneWidth, 0.03, len), laneMaterial, {
        position: [(lane.from[0] + lane.to[0]) / 2, 0.12, (lane.from[1] + lane.to[1]) / 2],
        rotation: [0, Math.atan2(dx, dz), 0],
        shade: [1.0, 1.1],
      });
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'pavingPatch';
    group.userData.footprintM = [width, depth];
    group.userData.laneCount = laneList.length;
    return group;
  };

  /* --- 10. 樹木と植栽 --------------------------------------------- */
  const createTree = ({
    height = 5.2,
    crownRadius = 1.7,
    kind = 'broadleaf',
    seed = 3,
    trunkRadius = null,
    detail = defaultDetail,
    trunkMaterial = materials.timber,
    crownMaterial = materials.foliage,
    crownDeepMaterial = materials.foliageDeep,
    name = 'arch-tree',
  } = {}) => {
    need(height > 0 && crownRadius > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const random = archRandom(seed);
    const d = detailOf(detail);
    const seg = Math.max(5, Math.round(d.radial * 0.4));
    const tr = trunkRadius ?? Math.max(0.08, height * 0.045);
    const sink = createPartSink(THREE);
    const trunkHeight = kind === 'pine' ? height * 0.42 : height * 0.5;
    sink.add(new THREE.CylinderGeometry(tr * 0.7, tr, trunkHeight, seg, 1, true), trunkMaterial, {
      position: [0, trunkHeight / 2, 0], shade: [0.35, 0.85],
    });
    if (kind === 'pine') {
      const tiers = 3;
      for (let i = 0; i < tiers; i++) {
        const t = i / (tiers - 1);
        const r = crownRadius * (1 - t * 0.55);
        sink.add(new THREE.ConeGeometry(r, (height - trunkHeight) * 0.55, seg, 1), i % 2 ? crownDeepMaterial : crownMaterial, {
          position: [0, trunkHeight + (height - trunkHeight) * (0.22 + t * 0.62), 0],
          shade: [0.5, 1.05],
        });
      }
    } else if (kind === 'palm') {
      const fronds = Math.max(4, Math.round(6 * d.lattice));
      for (let i = 0; i < fronds; i++) {
        const a = (i / fronds) * Math.PI * 2 + random() * 0.4;
        sink.add(box(crownRadius * 1.6, 0.06, crownRadius * 0.32), crownMaterial, {
          position: [Math.cos(a) * crownRadius * 0.6, trunkHeight + crownRadius * 0.25, Math.sin(a) * crownRadius * 0.6],
          rotation: [0, -a, -0.42],
          shade: [0.75, 1.05],
        });
      }
    } else {
      const blobs = Math.max(2, Math.round(3 * d.lattice));
      for (let i = 0; i < blobs; i++) {
        const r = crownRadius * (0.62 + random() * 0.45);
        sink.add(new THREE.IcosahedronGeometry(r, 0), i % 2 ? crownDeepMaterial : crownMaterial, {
          position: [
            (random() - 0.5) * crownRadius * 0.9,
            trunkHeight + crownRadius * (0.5 + i * 0.42),
            (random() - 0.5) * crownRadius * 0.9,
          ],
          scale: [1, 0.82 + random() * 0.3, 1],
          shade: [0.52, 1.08],
        });
      }
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'tree';
    group.userData.heightM = height;
    group.userData.softOcclusion = true;   // ARCH_BRIEF §3.5: 当たり判定を持たない柔らかい遮蔽
    return group;
  };

  /** 植栽の群。プレイ空間には疎に、境界には密に（§3.5）。 */
  const createPlantingBed = ({
    width = 6,
    depth = 3,
    count = 5,
    seed = 11,
    treeHeightM = [3.2, 5.4],
    kinds = ['broadleaf', 'pine'],
    curb = true,
    detail = defaultDetail,
    curbMaterial = materials.stone,
    name = 'arch-planting',
  } = {}) => {
    const random = archRandom(seed);
    const group = new THREE.Group();
    group.name = name;
    if (curb) {
      const sink = createPartSink(THREE);
      sink.add(box(width, 0.34, depth), curbMaterial, { position: [0, 0.17, 0], shade: [0.55, 0.95] });
      sink.add(box(width - 0.5, 0.3, depth - 0.5), materials.foliageDeep, { position: [0, 0.22, 0], shade: [0.5, 0.8] });
      group.add(...bakeParts(THREE, sink.parts, `${name}-curb`).children);
    }
    for (let i = 0; i < Math.max(0, Math.round(count)); i++) {
      const kind = kinds[Math.floor(random() * kinds.length) % kinds.length];
      const h = treeHeightM[0] + random() * (treeHeightM[1] - treeHeightM[0]);
      const tree = createTree({
        height: h, crownRadius: h * 0.32, kind, seed: seed * 31 + i * 7, detail,
        name: `${name}-tree-${i}`,
      });
      tree.position.set((random() - 0.5) * (width - 1), 0.3, (random() - 0.5) * (depth - 1));
      tree.rotation.y = random() * Math.PI * 2;
      group.add(tree);
    }
    markDecorative(group);
    group.userData.archVocabulary = 'plantingBed';
    group.userData.softOcclusion = true;
    return group;
  };

  /* --- 11. 遠景ビル・岩山のシルエット塊（層3・4） ---------------- */
  const createSilhouetteMass = ({
    kind = 'tower',
    width = 12,
    depth = 12,
    height = 26,
    seed = 5,
    material = materials.silhouette,
    capMaterial = materials.roof,
    name = 'arch-silhouette',
  } = {}) => {
    need(width > 0 && depth > 0 && height > 0, ARCH_KIT_ERRORS.PARAM_INVALID);
    const random = archRandom(seed);
    const sink = createPartSink(THREE);
    if (kind === 'crag') {
      const lumps = 3;
      for (let i = 0; i < lumps; i++) {
        const s = 1 - i * 0.26;
        sink.add(new THREE.IcosahedronGeometry(1, 0), material, {
          position: [(random() - 0.5) * width * 0.35, height * (0.28 + i * 0.24), (random() - 0.5) * depth * 0.35],
          scale: [width * 0.5 * s, height * 0.42 * s, depth * 0.5 * s],
          rotation: [0, random() * Math.PI, 0],
          shade: [0.42, 1.0],
        });
      }
    } else if (kind === 'ridge') {
      const steps = 4;
      for (let i = 0; i < steps; i++) {
        const t = i / steps;
        sink.add(box(width * (1 - t * 0.45), height * 0.34, depth * (1 - t * 0.3)), material, {
          position: [(random() - 0.5) * width * 0.2, height * (0.17 + t * 0.24), (random() - 0.5) * depth * 0.2],
          rotation: [0, (random() - 0.5) * 0.5, 0],
          shade: [0.4, 1.0],
        });
      }
    } else {
      // tower / block: 直線の壁体＋曲面の屋根（§3.7）を最小ポリゴンで
      sink.add(box(width, height, depth), material, { position: [0, height / 2, 0], shade: [0.38, 1.0] });
      if (kind === 'tower') {
        sink.add(box(width * 0.62, height * 0.3, depth * 0.62), material, {
          position: [0, height * 1.15, 0], shade: [1.0, 1.06],
        });
        sink.add(hipRoofGeometry(THREE, width * 0.78, depth * 0.78, height * 0.16, 0.3), capMaterial, {
          position: [0, height * 1.3, 0], shade: [1.02, 1.12],
        });
      } else {
        sink.add(hipRoofGeometry(THREE, width * 1.04, depth * 1.04, height * 0.12, 0.5), capMaterial, {
          position: [0, height, 0], shade: [1.0, 1.1],
        });
      }
    }
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'silhouetteMass';
    group.userData.depthLayer = 'city';
    group.userData.heightM = height;
    return group;
  };

  /* --- 灯（ARCH_BRIEF §3.2 の単位モチーフ）------------------------- */
  const createLampPost = ({
    height = 4.2,
    side = 'east',
    radius = 0.12,
    globeRadius = 0.34,
    detail = defaultDetail,
    material = materials.timber,
    name = 'arch-lamp',
  } = {}) => {
    const d = detailOf(detail);
    const seg = Math.max(5, Math.round(d.radial * 0.4));
    const glass = side === 'west' ? materials.lampWest : materials.lampEast;
    const sink = createPartSink(THREE);
    sink.add(new THREE.CylinderGeometry(radius * 0.7, radius, height, seg, 1, true), material, {
      position: [0, height / 2, 0], shade: [0.4, 0.9],
    });
    sink.add(new THREE.SphereGeometry(globeRadius, seg, Math.max(4, seg - 2)), glass, {
      position: [0, height + globeRadius * 0.6, 0], shade: [1, 1],
    });
    sink.add(new THREE.ConeGeometry(globeRadius * 1.5, globeRadius * 0.9, seg, 1), materials.gold, {
      position: [0, height + globeRadius * 1.8, 0], shade: [1, 1.1],
    });
    const group = bakeParts(THREE, sink.parts, name);
    group.userData.archVocabulary = 'lampPost';
    group.userData.heightM = height + globeRadius * 2.2;
    group.userData.radiusM = globeRadius * 1.5;
    return group;
  };

  /* ================================================================ *
   * 箱を包む API（最重要）
   * ================================================================ */

  const readAabb = (aabb) => {
    need(Array.isArray(aabb?.min) && Array.isArray(aabb?.max), ARCH_KIT_ERRORS.AABB_INVALID);
    const min = aabb.min.map(Number); const max = aabb.max.map(Number);
    need(min.length === 3 && max.length === 3 && min.every(Number.isFinite) && max.every(Number.isFinite),
      ARCH_KIT_ERRORS.AABB_INVALID);
    const size = [max[0] - min[0], max[1] - min[1], max[2] - min[2]];
    need(size.every(v => v > 0), ARCH_KIT_ERRORS.AABB_INVALID);
    return { min, max, size, center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2] };
  };

  /** タグ→建築の既定。5拠点で語彙を差し替えるための土台（ARCH_BRIEF §4）。 */
  const TAG_RECIPES = Object.freeze({
    wall: { roof: 'hip', openings: 'auto', eaves: true, parapet: false, lattice: true, dome: false },
    spawnwall: { roof: 'gable', openings: 'auto', eaves: true, parapet: false, lattice: true, dome: false },
    cover: { roof: 'flat', openings: 0, eaves: false, parapet: true, lattice: true, dome: false },
    tower: { roof: 'none', openings: 0, eaves: false, parapet: true, lattice: false, dome: false },
    rim: { roof: 'none', openings: 0, eaves: false, parapet: false, lattice: false, dome: false, paving: true },
    slab: { roof: 'none', openings: 0, eaves: false, parapet: false, lattice: false, dome: false, paving: true },
    stair: { roof: 'none', openings: 0, eaves: false, parapet: true, lattice: false, dome: false },
    ground: { roof: 'none', openings: 0, eaves: false, parapet: false, lattice: false, dome: false, paving: true },
  });

  /** 拠点ごとの語彙差し替え（ARCH_BRIEF §4「形だけ違う同じ広場にしない」） */
  const SITE_STYLES = Object.freeze({
    shiogama: { archStyle: 'round', roof: 'hip', domeProfile: 'onion', accent: 'gold', lampSide: 'east' },
    mizuichi: { archStyle: 'pointed', roof: 'gable', domeProfile: 'shallow', accent: 'gold', lampSide: 'west' },
    kado: { archStyle: 'segmental', roof: 'hip', domeProfile: 'hemisphere', accent: 'gold', lampSide: 'east' },
    ami: { archStyle: 'round', roof: 'gable', domeProfile: 'shallow', accent: 'gold', lampSide: 'west' },
    kazami: { archStyle: 'pointed', roof: 'hip', domeProfile: 'onion', accent: 'gold', lampSide: 'east' },
    generic: { archStyle: 'pointed', roof: 'hip', domeProfile: 'onion', accent: 'gold', lampSide: 'east' },
  });

  /**
   * 当たり判定の AABB を「建築」へ機械的に変換する。
   *
   * @param {{min:number[],max:number[],tag?:string,id?:string}} aabb  Z-up ゲーム座標
   * @param {object} [opts]
   * @param {'flush'|'inside'|'outside'} [opts.fit='flush']
   *        flush : 壁の外面が AABB の面と一致（既定。視覚がめり込まない）
   *        inside: 壁全体を AABB の内側へ（最も安全）
   *        outside: AABB の外へ張り出す（境界外の借景専用）
   * @param {string}  [opts.siteId]  拠点ID。語彙の差し替えに使う
   * @param {'hip'|'gable'|'flat'|'dome'|'none'} [opts.roof]
   * @param {number|'auto'} [opts.openings]
   * @param {number} [opts.seed]
   * @returns {THREE.Group} Z-up の world にそのまま add できるグループ
   */
  const wrapSolid = (aabb, opts = {}) => {
    const { min, size, center } = readAabb(aabb);
    const tag = opts.tag || aabb.tag || 'wall';
    const recipe = { ...(TAG_RECIPES[tag] || TAG_RECIPES.wall), ...(opts.recipe || {}) };
    const style = SITE_STYLES[opts.siteId] || SITE_STYLES.generic;
    const detail = opts.detail || defaultDetail;
    const seed = Number.isFinite(opts.seed) ? opts.seed : 17;
    const random = archRandom(seed);
    const fit = opts.fit || 'flush';
    const walkable = ARCH_WALKABLE_TAGS.includes(tag);

    // Y-up ローカル: X = ゲーム x, Y = ゲーム z（上）, Z = -ゲーム y
    const w = size[0]; const dpt = size[1]; const h = size[2];
    const thickness = Math.max(0.18, Math.min(opts.wallThickness ?? 0.36, Math.min(w, dpt) * 0.34));
    const grow = fit === 'outside' ? thickness : 0;
    const inset = fit === 'inside' ? thickness : 0;

    const group = new THREE.Group();
    group.name = opts.name || `arch-wrap-${aabb.id || tag}`;
    const parts = [];

    const outerW = w + grow * 2 - inset * 2;
    const outerD = dpt + grow * 2 - inset * 2;

    if ((recipe.paving || walkable) && outerW >= 0.6 && outerD >= 0.6) {
      const paving = createPavingPatch({
        width: outerW, depth: outerD,
        tileSizeM: Math.max(1.2, Math.min(outerW, outerD) / 4),
        laneAxis: outerW >= outerD ? 'x' : 'z',
        seed: seed + 4,
        name: `${group.name}-paving`,
      });
      paving.position.y = h - 0.02;   // 天面に貼る（天面より上に出さない）
      parts.push(paving);
    }

    if (!walkable && h > 0.6) {
      const openings = recipe.openings === 'auto'
        ? Math.max(0, Math.min(4, Math.floor(Math.max(w, dpt) / 3.4)))
        : Math.max(0, Math.round(Number(opts.openings ?? recipe.openings) || 0));
      const wallHeight = h;
      const faces = [
        { width: outerW, rot: 0, offset: [0, 0, outerD / 2 - thickness / 2], openings },
        { width: outerW, rot: Math.PI, offset: [0, 0, -outerD / 2 + thickness / 2], openings },
        { width: outerD, rot: Math.PI / 2, offset: [outerW / 2 - thickness / 2, 0, 0], openings: 0 },
        { width: outerD, rot: -Math.PI / 2, offset: [-outerW / 2 + thickness / 2, 0, 0], openings: 0 },
      ];
      for (const face of faces) {
        if (face.width <= 0.2) continue;
        const wall = createArchWall({
          width: face.width,
          height: wallHeight,
          thickness,
          openings: face.openings,
          style: opts.archStyle || style.archStyle,
          detail,
          name: `${group.name}-wall`,
        });
        wall.position.set(face.offset[0], 0, face.offset[2]);
        wall.rotation.y = face.rot;
        parts.push(wall);
        if (recipe.eaves && face.openings > 0 && wall.userData.openings.length) {
          for (const opening of wall.userData.openings) {
            // 庇の最下端が頭上クリアランスを割るなら出さない（めり込み防止）
            if (opening.height + 0.42 - 0.34 < ARCH_PLAY_CLEARANCE_M) continue;
            const eave = createEave({
              width: opening.width * 1.5,
              projection: Math.min(1.1, thickness * 2.6 + 0.4),
              drop: 0.3,
              brackets: 2,
              name: `${group.name}-eave`,
            });
            const local = new THREE.Vector3(opening.centerX, opening.height + 0.42, thickness / 2);
            local.applyEuler(new THREE.Euler(0, face.rot, 0));
            eave.position.set(face.offset[0] + local.x, local.y, face.offset[2] + local.z);
            eave.rotation.y = face.rot;
            parts.push(eave);
          }
        }
        if (recipe.lattice && face.openings > 0 && wall.userData.openings.length && detail !== 'low') {
          const opening = wall.userData.openings[0];
          const screen = createLatticeScreen({
            width: opening.width * 0.92,
            height: opening.height * 0.55,
            pattern: 'kumiko',
            detail,
            name: `${group.name}-lattice`,
          });
          const local = new THREE.Vector3(opening.centerX, 0, 0);
          local.applyEuler(new THREE.Euler(0, face.rot, 0));
          screen.position.set(face.offset[0] + local.x, 0, face.offset[2] + local.z);
          screen.rotation.y = face.rot;
          parts.push(screen);
        }
      }
    }

    const roofKind = opts.roof || (recipe.roof === 'hip' || recipe.roof === 'gable' ? style.roof : recipe.roof);
    if (!walkable && roofKind && roofKind !== 'none' && roofKind !== 'flat') {
      if (roofKind === 'dome') {
        const r = Math.min(outerW, outerD) * 0.5;
        const dome = createDome({
          radius: r, height: r * 1.05, profile: style.domeProfile, drumHeight: r * 0.22,
          detail, name: `${group.name}-dome`,
        });
        dome.position.y = h;
        parts.push(dome);
      } else {
        // 軒の出は「頭上クリアランスより上」でだけ許す
        const overhang = h >= ARCH_PLAY_CLEARANCE_M ? Math.min(0.55, Math.min(outerW, outerD) * 0.1) : 0;
        const roof = createRoof({
          width: outerW, depth: outerD,
          height: Math.max(0.7, Math.min(outerW, outerD) * 0.32),
          kind: roofKind, overhang,
          name: `${group.name}-roof`,
        });
        roof.position.y = h;
        parts.push(roof);
      }
    }
    if (!walkable && roofKind === 'flat' && recipe.parapet) {
      for (const [len, rot, off] of [
        [outerW, 0, [0, 0, outerD / 2]],
        [outerW, Math.PI, [0, 0, -outerD / 2]],
        [outerD, Math.PI / 2, [outerW / 2, 0, 0]],
        [outerD, -Math.PI / 2, [-outerW / 2, 0, 0]],
      ]) {
        if (len <= 0.4) continue;
        const parapet = createParapet({
          length: len, height: Math.min(0.75, h * 0.3), balusters: false, detail,
          name: `${group.name}-parapet`,
        });
        const inset = parapet.userData.depthM / 2;
        parapet.position.set(
          off[0] === 0 ? 0 : Math.sign(off[0]) * (Math.abs(off[0]) - inset),
          h,
          off[2] === 0 ? 0 : Math.sign(off[2]) * (Math.abs(off[2]) - inset),
        );
        parapet.rotation.y = rot;
        parts.push(parapet);
      }
    }

    if (walkable && recipe.parapet && h > 1.2) {
      for (const [len, rot, off] of [
        [outerW, 0, [0, 0, outerD / 2 - 0.35]],
        [outerD, Math.PI / 2, [outerW / 2 - 0.35, 0, 0]],
      ]) {
        if (len <= 1.2) continue;
        const parapet = createParapet({
          length: len - 0.8, height: 1.0, detail, name: `${group.name}-rail`,
        });
        parapet.position.set(off[0], h, off[2]);
        parapet.rotation.y = rot;
        parts.push(parapet);
      }
    }

    if (opts.lamp ?? (!walkable && h >= 2.2)) {
      const lamp = createLampPost({
        height: Math.max(1.2, h * 0.35), side: opts.lampSide || style.lampSide, detail,
        name: `${group.name}-lamp`,
      });
      const clear = lamp.userData.radiusM + 0.05;
      lamp.position.set(
        Math.max(0, outerW / 2 - clear), h * 0.55, Math.max(0, outerD / 2 - clear),
      );
      parts.push(lamp);
    }

    for (const part of parts) group.add(part);
    if (opts.merge !== false) mergeArchRoot(group);

    // Z-up の world 直下へ載せる: ローカル原点は AABB の底面中心
    mountZUp(group, [center[0], center[1], min[2]], opts.yawRad || 0);
    group.userData.archVocabulary = 'wrapSolid';
    group.userData.sourceSolidId = aabb.id || null;
    group.userData.sourceTag = tag;
    group.userData.fit = fit;
    group.userData.aabbM = { min: [...min], size: [...size] };
    group.userData.siteId = opts.siteId || null;
    // random は決定論性の担保としてのみ消費する（未使用でもシード依存を明示）
    group.userData.seed = seed + Math.floor(random() * 0);
    return group;
  };

  /** 複数の AABB をまとめて建築へ。skipTags のものは無視する。 */
  const wrapSolids = (solids, opts = {}) => {
    need(Array.isArray(solids), ARCH_KIT_ERRORS.AABB_INVALID);
    const skip = new Set(opts.skipTags || ['ground', 'slab']);
    const group = new THREE.Group();
    group.name = opts.name || 'arch-wrapped-solids';
    let index = 0;
    for (const solid of solids) {
      if (skip.has(solid.tag)) continue;
      if (typeof opts.filter === 'function' && !opts.filter(solid)) continue;
      const child = wrapSolid(solid, {
        ...opts,
        seed: (Number.isFinite(opts.seed) ? opts.seed : 17) + index * 13,
        merge: false,
      });
      group.add(child);
      index += 1;
    }
    if (opts.merge !== false) mergeArchRoot(group);
    markDecorative(group);
    group.userData.archVocabulary = 'wrapSolids';
    group.userData.wrappedCount = index;
    return group;
  };

  /* --- マージ（ドローコール削減。mergeGeometries 非依存） ---------- */
  /**
   * root 以下のメッシュをマテリアル単位で 1 メッシュに畳む。
   * `userData.preserveGeometry === true` のノードは触らない。
   * @returns {{sourceMeshes:number, mergedMeshes:number, drawCallsRemoved:number}}
   */
  const mergeArchRoot = (root) => {
    root.updateMatrixWorld(true);
    const inverse = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const targets = [];
    root.traverse((node) => {
      if (node === root) return;
      if (node.isMesh && node.geometry && node.userData?.preserveGeometry !== true) targets.push(node);
    });
    const buckets = new Map();
    for (const mesh of targets) {
      const key = mesh.material?.uuid || 'none';
      const list = buckets.get(key) || { material: mesh.material, meshes: [] };
      list.meshes.push(mesh);
      buckets.set(key, list);
    }
    let sourceMeshes = 0; let mergedMeshes = 0;
    for (const bucket of buckets.values()) {
      const geometries = bucket.meshes.map((mesh) => {
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(new THREE.Matrix4().copy(inverse).multiply(mesh.matrixWorld));
        if (!geometry.attributes.color) {
          const count = geometry.attributes.position.count;
          geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(count * 3).fill(1), 3));
        }
        if (!geometry.attributes.normal) geometry.computeVertexNormals();
        const trimmed = new THREE.BufferGeometry();
        trimmed.setAttribute('position', geometry.attributes.position);
        trimmed.setAttribute('normal', geometry.attributes.normal);
        trimmed.setAttribute('color', geometry.attributes.color);
        return trimmed;
      });
      const merged = new THREE.Mesh(concatGeometries(THREE, geometries), bucket.material);
      merged.name = `${root.name || 'arch'}-${bucket.material?.userData?.archMaterial || 'merged'}`;
      merged.castShadow = true;
      merged.receiveShadow = true;
      markDecorative(merged);
      for (const mesh of bucket.meshes) mesh.parent?.remove(mesh);
      root.add(merged);
      sourceMeshes += bucket.meshes.length;
      mergedMeshes += 1;
    }
    // 空になった中間 Group を掃除
    const empties = [];
    root.traverse((node) => {
      if (node !== root && node.isGroup && node.children.length === 0) empties.push(node);
    });
    for (const node of empties) node.parent?.remove(node);
    markDecorative(root);
    root.userData.archMerge = { sourceMeshes, mergedMeshes, drawCallsRemoved: sourceMeshes - mergedMeshes };
    return root.userData.archMerge;
  };

  /* --- 計測と検査 -------------------------------------------------- */
  const measureArch = (root) => {
    const base = geometryKit.measureModelPerformance(root);
    const materialsUsed = new Set();
    let collisionLeaks = 0;
    root.traverse((node) => {
      if (node.isMesh && node.material) materialsUsed.add(node.material.uuid);
      if (node.userData?.collision === true) collisionLeaks += 1;
    });
    return { ...base, triangles: Math.round(base.triangles), materials: materialsUsed.size, collisionLeaks };
  };

  /**
   * 「当たり判定のないジオメトリにプレイヤーがめり込まないか」の実測。
   * AABB 底面 + clearanceM 以下の高さにある頂点が、AABB の水平フットプリントから
   * どれだけはみ出しているか（m）を返す。0 ならプレイ高さでのめり込みは無い。
   * @param {THREE.Object3D} root  Z-up の world 相当空間に置かれたグループ
   * @param {{min:number[],max:number[]}} aabb  ゲーム座標の当たり判定箱
   */
  const auditFootprint = (root, aabb, { clearanceM = ARCH_PLAY_CLEARANCE_M } = {}) => {
    const { min, max } = readAabb(aabb);
    root.updateMatrixWorld(true);
    const vertex = new THREE.Vector3();
    let maxProtrusionM = 0; let sampled = 0; let aboveOnly = 0;
    root.traverse((node) => {
      if (!node.isMesh || !node.geometry?.attributes?.position) return;
      const position = node.geometry.attributes.position;
      for (let i = 0; i < position.count; i++) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(node.matrixWorld);
        const out = Math.max(
          min[0] - vertex.x, vertex.x - max[0],
          min[1] - vertex.y, vertex.y - max[1],
        );
        if (out <= 0) continue;
        if (vertex.z <= min[2] + clearanceM) {
          sampled += 1;
          if (out > maxProtrusionM) maxProtrusionM = out;
        } else {
          aboveOnly += 1;
        }
      }
    });
    return {
      clearanceM,
      maxProtrusionM: Number(maxProtrusionM.toFixed(4)),
      verticesOutsideBelowClearance: sampled,
      verticesOutsideAboveClearance: aboveOnly,
      safe: maxProtrusionM <= 1e-3,
    };
  };

  /** 描画専用であることの検査（テスト用）。true か、違反ノード名の配列を返す。 */
  const auditDecorative = (root) => {
    const violations = [];
    root.traverse((node) => {
      if (node.userData?.collision !== false) violations.push(node.name || node.type);
    });
    return violations;
  };

  return {
    ...geometryKit,           // geometry_kit の全 API をそのまま通す
    THREE,
    materials,
    palette: ARCH_PALETTE,
    domeScales: ARCH_DOME_SCALES,
    siteStyles: SITE_STYLES,
    tagRecipes: TAG_RECIPES,
    // 建築語彙
    createDome,
    createArchOpening,
    createArchWall,
    createRoof,
    createEave,
    createCurvedTerrace,
    createLatticeScreen,
    createColonnade,
    createParapet,
    createPavingPatch,
    createTree,
    createPlantingBed,
    createSilhouetteMass,
    createLampPost,
    // 箱を包む
    wrapSolid,
    wrapSolids,
    // 補助
    archOutlinePoints,
    mountZUp,
    markDecorative,
    mergeArchRoot,
    measureArch,
    auditDecorative,
    auditFootprint,
  };
}

/** 語彙の一覧と三角形予算（テストとドキュメントの単一の出所）。 */
export const ARCH_VOCABULARY = Object.freeze([
  { id: 'dome', factory: 'createDome', triangleBudget: 1200, note: 'ドーム。small/medium/large の3スケール。頂華つき' },
  { id: 'archOpening', factory: 'createArchOpening', triangleBudget: 900, note: 'アーチ開口の縁。尖頭/半円/セグメンタル' },
  { id: 'archWall', factory: 'createArchWall', triangleBudget: 1600, note: '直線の壁体にアーチ開口をくり抜く' },
  { id: 'roof', factory: 'createRoof', triangleBudget: 200, note: '寄棟/切妻。箱の上にシルエットを作る' },
  { id: 'eave', factory: 'createEave', triangleBudget: 400, note: '庇・軒。開口の上に影を落とす' },
  { id: 'curvedTerrace', factory: 'createCurvedTerrace', triangleBudget: 2400, note: '曲面テラス。段丘の縁を丸める' },
  { id: 'latticeScreen', factory: 'createLatticeScreen', triangleBudget: 1200, note: '格子スクリーン。開口を塞がない' },
  { id: 'colonnade', factory: 'createColonnade', triangleBudget: 3000, note: '円柱列・柱廊。arcade:true でアーケード' },
  { id: 'parapet', factory: 'createParapet', triangleBudget: 2000, note: 'パラペット・欄干の連続' },
  { id: 'pavingPatch', factory: 'createPavingPatch', triangleBudget: 1200, note: '石畳。目地と動線ラインつき' },
  { id: 'tree', factory: 'createTree', triangleBudget: 400, note: '低ポリ樹木。柔らかい遮蔽' },
  { id: 'plantingBed', factory: 'createPlantingBed', triangleBudget: 2400, note: '植栽枡＋樹木の群' },
  { id: 'silhouetteMass', factory: 'createSilhouetteMass', triangleBudget: 300, note: '遠景ビル・岩山。極低ポリ' },
  { id: 'lampPost', factory: 'createLampPost', triangleBudget: 600, note: '灯（単位モチーフ）。東=橙／西=藍' },
  { id: 'wrapSolid', factory: 'wrapSolid', triangleBudget: 6000, note: '当たり判定AABB→建築。壁体＋屋根＋開口＋庇' },
]);

export default createArchKit;
