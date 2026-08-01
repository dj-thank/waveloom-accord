/**
 * site_mizuichi.js — 水市（北東拠点・浮標市場）の建築配置データ
 *
 * 担当区画: mizuichi 中心 [56, 44, 4] / playBounds x[36,76] y[27,61]
 * 中ランドマーク: 競り市クレーン [68, 50, 9]
 *
 * 【この区画にしかない建築語彙】
 *   浮標（3スケールで反復する単位モチーフ）／日除け布の連なり／競り台（浮き段の露店）／
 *   汐入り水路／吊り下げ品／浮標と灯の連（festoon）／競り鐘を吊るした木造クレーン。
 *   汎用の壁体・階段・欄干だけを arch_kit と共有し、象徴的な構造物はすべて固有に作る。
 *
 * 【絶対規則】
 *   - `solids` は読むだけ。当たり判定は1つも作らない。全ノード userData.collision === false。
 *   - `world` は既に Z-up（render.js:245 の rotation.x = -PI/2 の内側）。
 *     このファイルの造形はすべて **ゲーム座標 Z-up のまま**書く。root に回転を掛けない。
 *     Y軸に生えるプリミティブ（Cylinder / Cone）だけ geometry 側で rotateX(PI/2) する。
 *   - 当たり判定の無い場所に「遮蔽に見える不透明な塊」を置かない。
 *     すべての出力ノードは MIZUICHI_OCCLUSION_CLASSES のどれかを宣言し、
 *     tests/architecture_mizuichi.test.js が宣言と実測 bbox を突き合わせる。
 */

/* ------------------------------------------------------------------ *
 * 0. 区画のメタデータ
 * ------------------------------------------------------------------ */

export const MIZUICHI_SITE = Object.freeze({
  id: 'mizuichi',
  displayName: '浮標市場',
  shortName: '水市',
  center: Object.freeze([56, 44, 4]),
  radiusM: 7,
  playBoundsM: Object.freeze({ x: Object.freeze([36, 76]), y: Object.freeze([27, 61]) }),
  groundZ: 4,
  landmark: Object.freeze({
    id: 'auction-crane',
    anchorSolidId: 'flash-site-mizuichi-high-platform',
    baseCenter: Object.freeze([68, 50, 9]),
    // 実測は test が measure する。ここは設計値。
    designTopZ: 25.4,
  }),
});

/**
 * 「遮蔽に見える不透明な塊」を当たり判定の無い場所に置かないための分類。
 * 出力ノードは必ずこのどれか1つを userData.occlusionClass に宣言する。
 */
export const MIZUICHI_OCCLUSION_CLASSES = Object.freeze({
  wrapped: '当たり判定AABBを包む建築。kit.auditFootprint(node, aabb).safe が真であること',
  stacked: '既存コライダーの水平フットプリント内に収まる垂直の延長（塔・柱・欄干）',
  aerial: '直下の立面から MIZUICHI_AERIAL_CLEARANCE_M 以上高い位置にしか無い（吊り物・腕木・天蓋）',
  flat: '床の意匠。高さ MIZUICHI_FLAT_MAX_M 以下（石畳・水路・動線ライン・渡し板）',
  soft: '植生。射線を切らない柔らかい遮蔽（ARCH_BRIEF §3.5）',
  distant: 'マップ境界 x[-126,126] y[-92,92] の外の借景。この制限の対象外',
});

/** 直下の立面からこの高さ以上にしか無いものは遮蔽にならない（頭上 2.2m ＋ 余裕 0.4m）。 */
export const MIZUICHI_AERIAL_CLEARANCE_M = 2.6;
/** 床の意匠として許す最大高さ。膝下で、遮蔽として使えない。 */
export const MIZUICHI_FLAT_MAX_M = 0.5;
/** マップ境界（この外は借景）。 */
export const MIZUICHI_MAP_BOUNDS = Object.freeze({ x: Object.freeze([-126, 126]), y: Object.freeze([-92, 92]) });

/**
 * 浮標＝水市の単位モチーフ。ARCH_BRIEF §3.2「同一部品を3スケールで反復する」。
 * 部品を増やさずに密度を上げるための唯一のモチーフ。
 */
export const MIZUICHI_BUOY_SCALES = Object.freeze({
  small: Object.freeze({ radiusM: 0.30, use: '吊り下げ品・棟飾り・欄干の浮子・連の玉' }),
  medium: Object.freeze({ radiusM: 0.78, use: '水路に浮かぶ浮標・競り台の頂・門柱の玉' }),
  large: Object.freeze({ radiusM: 1.95, use: 'クレーンの吊り浮標束・遠景の櫓に掛かる浮標' }),
});

/**
 * 出力ノードの目録。builder はこの id を持つ子ノードだけを root 直下に作る。
 * テストは「目録 ⇔ 実際の子ノード」を 1:1 で突き合わせる。
 */
export const MIZUICHI_STRUCTURES = Object.freeze([
  { id: 'mizuichi-pad-paving', occlusionClass: 'flat', anchors: ['flash-site-mizuichi-objective-pad'], note: '競り広場の大判石畳＋三方向の動線ライン（金）' },
  { id: 'mizuichi-approach-paving', occlusionClass: 'flat', anchors: ['flash-ring-east-floor', 'flash-ring-north-floor'], note: '西・北・東の進入路の敷石と動線ライン' },
  { id: 'mizuichi-tide-canal', occlusionClass: 'flat', anchors: ['flash-ring-east-floor'], note: '汐入り水路。碧い浅瀬＋石の護岸＋渡し板＋汐留め' },
  { id: 'mizuichi-canal-buoys', occlusionClass: 'flat', anchors: ['flash-ring-east-floor'], note: '水路に浮かぶ中スケール浮標と繋留環' },
  { id: 'mizuichi-stall-northwest', occlusionClass: 'wrapped', anchors: ['flash-site-mizuichi-cover-northwest'], note: '競り台（北西）。浮き段・掲示板・小庇・吊り浮標' },
  { id: 'mizuichi-stall-northeast', occlusionClass: 'wrapped', anchors: ['flash-site-mizuichi-cover-northeast'], note: '競り台（北東）' },
  { id: 'mizuichi-stall-south', occlusionClass: 'wrapped', anchors: ['flash-site-mizuichi-cover-south'], note: '競り台（南）。広場側に段を向ける' },
  { id: 'mizuichi-hall-north', occlusionClass: 'wrapped', anchors: ['flash-site-mizuichi-mass-north'], note: '北の競り市大屋根。反り屋根＋棟の浮標＋干し網の櫓' },
  { id: 'mizuichi-hall-south', occlusionClass: 'wrapped', anchors: ['flash-site-mizuichi-mass-south'], note: '南の競り市大屋根（低い方）' },
  { id: 'mizuichi-crane-tower', occlusionClass: 'stacked', anchors: ['flash-site-mizuichi-high-platform'], note: '競り市クレーンの木造ラチス塔（中ランドマーク）' },
  { id: 'mizuichi-crane-jib', occlusionClass: 'aerial', anchors: [], note: 'クレーンの腕木・釣合錘・斜張索' },
  { id: 'mizuichi-crane-tackle', occlusionClass: 'aerial', anchors: [], note: '吊り索・滑車・大浮標束・競り鐘（金）' },
  { id: 'mizuichi-crane-pennant', occlusionClass: 'aerial', anchors: [], note: '塔頂の吹き流しと灯' },
  { id: 'mizuichi-gate-masts', occlusionClass: 'stacked', anchors: [
    'flash-site-mizuichi-boundary-post-nw', 'flash-site-mizuichi-boundary-post-ne',
    'flash-site-mizuichi-boundary-post-sw', 'flash-site-mizuichi-boundary-post-se',
  ], note: '四隅の浮標門柱。天蓋を支え、灯を掲げる' },
  { id: 'mizuichi-market-canopy', occlusionClass: 'aerial', anchors: [], note: '日除け布の連なり（藍と生成の縞）と梁' },
  { id: 'mizuichi-hanging-goods', occlusionClass: 'aerial', anchors: [], note: '吊り下げ品。籠・網・干物・小浮標' },
  { id: 'mizuichi-festoon-garlands', occlusionClass: 'aerial', anchors: [], note: '浮標と灯の連。クレーンと両大屋根を結ぶ' },
  { id: 'mizuichi-stair-rails', occlusionClass: 'stacked', anchors: ['flash-site-mizuichi-stair-x', 'flash-site-mizuichi-stair-y'], note: '縄と浮子の欄干（階段の汎用語彙）' },
  { id: 'mizuichi-planting-inner', occlusionClass: 'soft', anchors: [], note: 'プレイ空間の疎らな植生' },
  { id: 'mizuichi-planting-edge', occlusionClass: 'soft', anchors: [], note: '区画境界の密な植生' },
  { id: 'mizuichi-distant-market-town', occlusionClass: 'distant', anchors: [], note: '北東の対岸市場町。浮標を掛けた櫓と倉のシルエット' },
]);

/* ------------------------------------------------------------------ *
 * 1. 内部ユーティリティ（Z-up のまま造形する）
 * ------------------------------------------------------------------ */

function need(condition, message) {
  if (!condition) throw new TypeError(`MIZUICHI_${message}`);
}

/** 決定論的擬似乱数。テストの再現性のために必須。 */
export function mizuichiRandom(seed = 21) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function next() {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function markDecorative(node) {
  node.userData.collision = false;
  node.userData.decorativeOnly = true;
  node.userData.staticDecoration = true;
  node.userData.mizuichi = true;
  return node;
}

function createSink() {
  const parts = [];
  return {
    parts,
    add(geometry, material, opts = {}) {
      parts.push({ geometry, material, ...opts });
      return parts[parts.length - 1];
    },
  };
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

/**
 * parts をマテリアル別に1メッシュへ畳む。頂点色は Z 方向のグラデーションで焼く
 * （arch_kit と同じ規約。vertexColors:true のマテリアルなので色属性は必須）。
 */
function bakeParts(THREE, parts, name) {
  const group = new THREE.Group();
  group.name = name;
  if (!parts.length) { markDecorative(group); return group; }
  const prepared = [];
  let minZ = Infinity; let maxZ = -Infinity;
  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (!source.attributes.normal) source.computeVertexNormals();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position.clone());
    geometry.setAttribute('normal', source.attributes.normal.clone());
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(part.position || [0, 0, 0]),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(
        (part.rotation || [0, 0, 0])[0], (part.rotation || [0, 0, 0])[1], (part.rotation || [0, 0, 0])[2],
      )),
      new THREE.Vector3().fromArray(part.scale || [1, 1, 1]),
    );
    geometry.applyMatrix4(matrix);
    const position = geometry.attributes.position;
    for (let i = 0; i < position.count; i++) {
      const z = position.getZ(i);
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    prepared.push({ geometry, part });
  }
  const span = Math.max(1e-6, maxZ - minZ);
  const buckets = new Map();
  for (const { geometry, part } of prepared) {
    const position = geometry.attributes.position;
    const colors = new Float32Array(position.count * 3);
    const [shadeLow, shadeHigh] = part.shade || [0.62, 1.04];
    const tint = part.tint || [1, 1, 1];
    for (let i = 0; i < position.count; i++) {
      const t = (position.getZ(i) - minZ) / span;
      const k = shadeLow + (shadeHigh - shadeLow) * t;
      colors[i * 3 + 0] = tint[0] * k;
      colors[i * 3 + 1] = tint[1] * k;
      colors[i * 3 + 2] = tint[2] * k;
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const key = part.material?.uuid || 'none';
    const bucket = buckets.get(key) || { material: part.material, geometries: [] };
    bucket.geometries.push(geometry);
    buckets.set(key, bucket);
  }
  for (const bucket of buckets.values()) {
    const mesh = new THREE.Mesh(concatGeometries(THREE, bucket.geometries), bucket.material);
    mesh.name = `${name}-${bucket.material?.userData?.archMaterial || bucket.material?.name || 'part'}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    markDecorative(mesh);
    group.add(mesh);
  }
  markDecorative(group);
  return group;
}

/* --- Z-up のプリミティブ生成子 ------------------------------------- */

function makeShapes(THREE) {
  const cache = new Map();
  const keyed = (key, factory) => {
    if (!cache.has(key)) cache.set(key, factory());
    return cache.get(key);
  };
  return {
    /** 直方体。引数はそのままゲーム座標の x / y / z の寸法。 */
    box: (sx, sy, sz) => new THREE.BoxGeometry(sx, sy, sz),
    /** +Z を軸とする円柱（Y-up の CylinderGeometry を倒す）。 */
    tube: (rTop, rBottom, h, seg = 8) => new THREE.CylinderGeometry(rTop, rBottom, h, seg, 1, true).rotateX(Math.PI / 2),
    /** +Z を軸とする円錐（頂点が +Z 側）。 */
    cone: (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg, 1).rotateX(Math.PI / 2),
    sphere: (r, wSeg = 8, hSeg = 6) => keyed(`s${r}|${wSeg}|${hSeg}`, () => new THREE.SphereGeometry(r, wSeg, hSeg)),
    /** XY 平面に寝た環（軸は +Z）。 */
    ring: (r, tube, radial = 6, tubular = 10) => new THREE.TorusGeometry(r, tube, radial, tubular),
  };
}

/** 2点間に棒（円柱）を渡す。Z-up。 */
function strut(sink, shapes, a, b, radius, material, opts = {}) {
  const dx = b[0] - a[0]; const dy = b[1] - a[1]; const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return null;
  // +Z 軸の円柱を (dx,dy,dz) 方向へ向ける。
  const yaw = Math.atan2(dy, dx);
  const pitch = Math.acos(Math.max(-1, Math.min(1, dz / len)));
  return sink.add(
    shapes.tube(radius, radius * (opts.taper ?? 1), len, opts.segments ?? 6),
    material,
    {
      position: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2],
      // ZYX: まず Z 回りに yaw、次に Y 回りに pitch。
      rotation: [0, pitch, yaw - Math.PI / 2],
      shade: opts.shade || [0.5, 0.95],
      tint: opts.tint,
    },
  );
}

/**
 * 浮標。水市の単位モチーフ。3スケールで同じ部品を反復する（ARCH_BRIEF §3.2）。
 * @param {'small'|'medium'|'large'} scale
 */
function buoy(sink, shapes, materials, center, scale = 'medium', opts = {}) {
  const r = opts.radius ?? MIZUICHI_BUOY_SCALES[scale].radiusM;
  const seg = scale === 'small' ? [6, 4] : scale === 'medium' ? [8, 6] : [10, 7];
  const [x, y, z] = center;
  const body = opts.bodyMaterial || (opts.cool ? materials.indigo : materials.plaster);
  sink.add(shapes.sphere(1, seg[0], seg[1]), body, {
    position: [x, y, z], scale: [r, r, r * 1.12], shade: [0.6, 1.06],
  });
  // 赤道の帯（金の差し色。面積を絞る）
  sink.add(shapes.ring(r * 0.98, r * 0.11, 5, seg[0]), materials.gold, {
    position: [x, y, z], rotation: [0, 0, 0], shade: [1.0, 1.08],
  });
  // 上の小柱と下の錘（浮標のシルエットを決める）
  sink.add(shapes.tube(r * 0.11, r * 0.15, r * 0.95, 5), materials.timber, {
    position: [x, y, z + r * 1.4], shade: [0.7, 1.0],
  });
  if (scale !== 'small') {
    sink.add(shapes.cone(r * 0.42, r * 0.6, seg[0]), opts.capMaterial || materials.indigo, {
      position: [x, y, z + r * 1.05], rotation: [Math.PI, 0, 0], shade: [0.85, 1.0],
    });
  }
  return r;
}

/** 布（日除け・吹き流し）。両端で吊られて垂れ下がる曲面を薄い帯で作る。 */
function saggingCloth(THREE, sink, material, {
  x0, x1, y0, y1, zEdge, sag = 1.2, steps = 6, axis = 'y', tint,
}) {
  const positions = [];
  const push = (p) => positions.push(p[0], p[1], p[2]);
  const at = (i, j) => {
    const t = i / steps;
    const drop = sag * Math.sin(Math.PI * t);
    if (axis === 'y') {
      return [j ? x1 : x0, y0 + (y1 - y0) * t, zEdge - drop];
    }
    return [x0 + (x1 - x0) * t, j ? y1 : y0, zEdge - drop];
  };
  for (let i = 0; i < steps; i++) {
    const a = at(i, 0); const b = at(i, 1); const c = at(i + 1, 1); const d = at(i + 1, 0);
    push(a); push(b); push(c);
    push(a); push(c); push(d);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  sink.add(geometry, material, { shade: [0.72, 1.06], tint });
}

/**
 * 反り屋根（水市の大屋根）。棟は X 方向、断面は Y 方向に湾曲して軒先が反り上がる。
 * 「壁は直線・屋根は曲線」（ARCH_BRIEF §3.7）の屋根側を担当する。
 */
function curvedMarketRoof(THREE, sink, material, {
  cx, cy, z0, spanX, spanY, height, seg = 10, tint,
}) {
  const profile = (t) => {
    const base = height * Math.pow(Math.sin(Math.PI * Math.min(1, Math.max(0, t))), 0.72);
    const edge = Math.min(t, 1 - t);
    const flare = height * 0.26 * Math.exp(-9 * edge);     // 軒先の反り
    return base + flare;
  };
  const yAt = (t) => cy + (t - 0.5) * spanY;
  const x0 = cx - spanX / 2; const x1 = cx + spanX / 2;
  const positions = [];
  const push = (p) => positions.push(p[0], p[1], p[2]);
  for (let i = 0; i < seg; i++) {
    const t0 = i / seg; const t1 = (i + 1) / seg;
    const a = [x0, yAt(t0), z0 + profile(t0)];
    const b = [x1, yAt(t0), z0 + profile(t0)];
    const c = [x1, yAt(t1), z0 + profile(t1)];
    const d = [x0, yAt(t1), z0 + profile(t1)];
    push(a); push(b); push(c);
    push(a); push(c); push(d);
    // 妻側の三角（屋根裏を見せない）
    const mid0 = [x0, yAt(t0), z0]; const mid1 = [x0, yAt(t1), z0];
    push(a); push(d); push(mid1); push(a); push(mid1); push(mid0);
    const e0 = [x1, yAt(t0), z0]; const e1 = [x1, yAt(t1), z0];
    push(b); push(e0); push(e1); push(b); push(e1); push(c);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.computeVertexNormals();
  sink.add(geometry, material, { shade: [0.6, 1.06], tint });
  return z0 + profile(0.5);
}

/* ------------------------------------------------------------------ *
 * 2. 当たり判定箱の読み取り（読むだけ・書かない）
 * ------------------------------------------------------------------ */

const REQUIRED_SOLIDS = Object.freeze([
  'objective-pad',
  'boundary-post-nw', 'boundary-post-ne', 'boundary-post-sw', 'boundary-post-se',
  'cover-northwest', 'cover-northeast', 'cover-south',
  'mass-north', 'mass-south', 'high-platform',
]);

/** mizuichi に属する solid を suffix で引く索引を作る。入力配列は一切変更しない。 */
export function indexMizuichiSolids(solids) {
  need(Array.isArray(solids), 'SOLIDS_INVALID');
  const prefix = 'flash-site-mizuichi-';
  const bySuffix = new Map();
  const stairsX = []; const stairsY = [];
  for (const solid of solids) {
    if (typeof solid?.id !== 'string' || !solid.id.startsWith(prefix)) continue;
    const suffix = solid.id.slice(prefix.length);
    const frozen = {
      id: solid.id,
      tag: solid.tag,
      min: [Number(solid.min[0]), Number(solid.min[1]), Number(solid.min[2])],
      max: [Number(solid.max[0]), Number(solid.max[1]), Number(solid.max[2])],
    };
    if (suffix.startsWith('stair-x-')) stairsX.push(frozen);
    else if (suffix.startsWith('stair-y-')) stairsY.push(frozen);
    else bySuffix.set(suffix, frozen);
  }
  for (const key of REQUIRED_SOLIDS) need(bySuffix.has(key), `SOLID_MISSING_${key}`);
  need(stairsX.length > 0 && stairsY.length > 0, 'STAIRS_MISSING');
  stairsX.sort((a, b) => a.min[0] - b.min[0]);
  stairsY.sort((a, b) => a.min[1] - b.min[1]);
  return { bySuffix, stairsX, stairsY, get: (k) => bySuffix.get(k) };
}

const center2 = (s) => [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2];
const sizeOf = (s) => [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]];

/* ------------------------------------------------------------------ *
 * 3. 構造物ビルダー
 * ------------------------------------------------------------------ */

/** 競り台。cover の箱を「浮き段の露店」に変える（SSOT の coverLanguage に対応）。 */
function buildStall(THREE, kit, shapes, solid, { facing, seed }) {
  const m = kit.materials;
  const sink = createSink();
  const [cx, cy] = center2(solid);
  const [sx, sy, sz] = sizeOf(solid);
  const z0 = solid.min[2]; const zTop = solid.max[2];
  const random = mizuichiRandom(seed);
  const fy = facing;                               // +1 なら +Y 側が広場

  // 石の基壇（AABB の中に収める）
  sink.add(shapes.box(sx, sy, 0.34), m.stone, { position: [cx, cy, z0 + 0.17], shade: [0.5, 0.8] });
  // 浮き段（競りに掛ける品を並べる二段）
  for (let i = 0; i < 2; i++) {
    const h = 0.42 + i * 0.34;
    const depth = sy * (0.52 - i * 0.16);
    sink.add(shapes.box(sx - 0.5 - i * 0.5, depth, 0.22), m.timber, {
      position: [cx, cy + fy * (sy / 2 - depth / 2 - 0.12), z0 + h],
      shade: [0.55, 0.95],
    });
  }
  // 背板（格子つき掲示板）— 広場と反対側の面
  sink.add(shapes.box(sx - 0.3, 0.14, sz - 0.5), m.plaster, {
    position: [cx, cy - fy * (sy / 2 - 0.1), z0 + (sz - 0.5) / 2 + 0.34], shade: [0.55, 1.0],
  });
  for (let i = 0; i < 5; i++) {
    sink.add(shapes.box(0.07, 0.1, sz - 1.0), m.timber, {
      position: [cx - (sx - 1.0) / 2 + ((sx - 1.0) * i) / 4, cy - fy * (sy / 2 - 0.2), z0 + (sz - 1.0) / 2 + 0.5],
      shade: [0.45, 0.9],
    });
  }
  // 四隅の柱と梁
  const px = (sx - 0.5) / 2; const py = (sy - 0.4) / 2;
  for (const ox of [-px, px]) {
    for (const oy of [-py, py]) {
      sink.add(shapes.box(0.18, 0.18, sz), m.timber, { position: [cx + ox, cy + oy, z0 + sz / 2], shade: [0.42, 0.92] });
    }
  }
  sink.add(shapes.box(sx - 0.3, 0.16, 0.16), m.timber, { position: [cx, cy + py, zTop - 0.1], shade: [0.9, 1.0] });
  sink.add(shapes.box(sx - 0.3, 0.16, 0.16), m.timber, { position: [cx, cy - py, zTop - 0.1], shade: [0.9, 1.0] });

  // 小庇（AABB 天面より上。頭上クリアランス 2.2m より上なので張り出してよい）
  saggingCloth(THREE, sink, kit.materialsExtra.clothPale, {
    x0: cx - sx / 2 - 0.3, x1: cx + sx / 2 + 0.3,
    y0: cy - fy * (sy / 2), y1: cy + fy * (sy / 2 + 0.95),
    zEdge: zTop + 0.62, sag: 0.42, steps: 4, axis: 'y',
  });
  sink.add(shapes.box(sx + 0.6, 0.12, 0.12), m.gold, { position: [cx, cy + fy * (sy / 2 + 0.95), zTop + 0.2], shade: [1.0, 1.1] });
  for (const ox of [-px, px]) {
    strut(sink, shapes, [cx + ox, cy + fy * py, zTop], [cx + ox, cy + fy * (sy / 2 + 0.9), zTop + 0.28], 0.06, m.timber);
  }
  // 競り台の頂の浮標（中スケール）と吊り浮標（小）
  buoy(sink, shapes, m, [cx - sx / 2 + 0.55, cy, zTop + 0.95], 'medium', { cool: random() > 0.5 });
  for (let i = 0; i < 3; i++) {
    const x = cx - sx * 0.3 + (sx * 0.6 * i) / 2;
    const zHang = zTop + 0.34;
    strut(sink, shapes, [x, cy + fy * (sy / 2 + 0.72), zTop + 0.5], [x, cy + fy * (sy / 2 + 0.72), zHang], 0.03, m.timber);
    buoy(sink, shapes, m, [x, cy + fy * (sy / 2 + 0.72), zHang - 0.3], 'small', { cool: i % 2 === 0 });
  }
  return bakeParts(THREE, sink.parts, `stall-${solid.id}`);
}

/** 競り市の大屋根。汎用の壁体は arch_kit、屋根と棟飾りは水市固有。 */
function buildMarketHall(THREE, kit, shapes, solid, { seed, netRacks }) {
  const m = kit.materials;
  const container = new THREE.Group();
  const [cx, cy] = center2(solid);
  const [sx, sy] = sizeOf(solid);
  const zTop = solid.max[2];

  // 汎用語彙（壁体・開口・格子・灯）は共有してよい部分
  const shell = kit.wrapSolid(solid, {
    siteId: 'mizuichi',
    seed,
    roof: 'none',
    recipe: { roof: 'none', openings: 'auto', eaves: true, lattice: true, parapet: false },
    detail: 'medium',
    name: `mizuichi-hall-shell-${solid.id}`,
  });
  container.add(shell);

  const sink = createSink();
  // 反り屋根（水市固有のシルエット）。天面より上なので張り出してよい。
  const ridgeZ = curvedMarketRoof(THREE, sink, m.roof, {
    cx, cy, z0: zTop, spanX: sx + 1.2, spanY: sy + 1.6, height: 3.4, seg: 10,
  });
  // 棟木と棟の浮標（小スケールの反復）
  sink.add(shapes.box(sx + 1.4, 0.34, 0.26), m.plasterShade, { position: [cx, cy, ridgeZ + 0.1], shade: [1.0, 1.08] });
  for (let i = 0; i < 5; i++) {
    const x = cx - (sx - 0.4) / 2 + ((sx - 0.4) * i) / 4;
    buoy(sink, shapes, m, [x, cy, ridgeZ + 0.72], 'small', { cool: i % 2 === 1 });
  }
  // 妻の破風板（金の細帯）
  for (const ox of [-1, 1]) {
    sink.add(shapes.box(0.16, sy + 1.6, 0.14), m.gold, {
      position: [cx + ox * (sx + 1.2) / 2, cy, zTop + 0.9], shade: [1.0, 1.1],
    });
  }
  // 干し網の櫓（屋根の上の開いた骨組み。水市だけの上物）
  if (netRacks) {
    for (let i = 0; i < 3; i++) {
      const x = cx - (sx - 2.2) / 2 + ((sx - 2.2) * i) / 2;
      const zBase = ridgeZ + 0.2;
      strut(sink, shapes, [x, cy - 1.1, zBase], [x, cy - 1.1, zBase + 2.4], 0.1, m.timber);
      strut(sink, shapes, [x, cy + 1.1, zBase], [x, cy + 1.1, zBase + 2.4], 0.1, m.timber);
      strut(sink, shapes, [x, cy - 1.1, zBase + 2.4], [x, cy + 1.1, zBase + 2.4], 0.08, m.timber);
      // 干し網（藍の薄い面）
      saggingCloth(THREE, sink, kit.materialsExtra.clothIndigo, {
        x0: x - 0.05, x1: x + 0.05, y0: cy - 1.1, y1: cy + 1.1, zEdge: zBase + 2.3, sag: 0.75, steps: 4, axis: 'y',
      });
      saggingCloth(THREE, sink, kit.materialsExtra.clothIndigo, {
        x0: x - 1.0, x1: x + 1.0, y0: cy - 1.05, y1: cy + 1.05, zEdge: zBase + 2.25, sag: 0.9, steps: 4, axis: 'x',
      });
    }
  }
  container.add(bakeParts(THREE, sink.parts, `hall-crown-${solid.id}`));
  kit.mergeArchRoot(container);
  return container;
}

/** 競り市クレーン（中ランドマーク）。塔は platform のフットプリント内に収める。 */
function buildCraneTower(THREE, kit, shapes, platform) {
  const m = kit.materials;
  const sink = createSink();
  const [cx, cy] = center2(platform);
  const zBase = platform.max[2];
  const half = Math.min(sizeOf(platform)[0], sizeOf(platform)[1]) / 2;   // 3.0
  const legOut = half - 0.75;                                            // 2.25
  const topOut = 0.85;
  const zTopFrame = zBase + 11.5;
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const legAt = (sx, sy, z) => {
    const t = (z - zBase) / (zTopFrame - zBase);
    const out = legOut + (topOut - legOut) * t;
    return [cx + sx * out, cy + sy * out, z];
  };
  // 4本脚
  for (const [ox, oy] of corners) {
    strut(sink, shapes, legAt(ox, oy, zBase), legAt(ox, oy, zTopFrame), 0.19, m.timber, { segments: 6, shade: [0.42, 0.95] });
  }
  // 水平材と筋交い（開いたラチス。塊にしない）
  const levels = [0, 0.26, 0.52, 0.78, 1];
  for (let l = 0; l < levels.length; l++) {
    const z = zBase + (zTopFrame - zBase) * levels[l];
    for (let i = 0; i < 4; i++) {
      const a = corners[i]; const b = corners[(i + 1) % 4];
      strut(sink, shapes, legAt(a[0], a[1], z), legAt(b[0], b[1], z), 0.1, m.timber, { segments: 5, shade: [0.5, 0.95] });
      if (l < levels.length - 1) {
        const z2 = zBase + (zTopFrame - zBase) * levels[l + 1];
        strut(sink, shapes, legAt(a[0], a[1], z), legAt(b[0], b[1], z2), 0.075, m.timber, { segments: 4, shade: [0.45, 0.9] });
      }
    }
  }
  // 塔頂の櫓（競り人が立つ台のかたち）
  sink.add(shapes.box(topOut * 2.6, topOut * 2.6, 0.3), m.plasterShade, { position: [cx, cy, zTopFrame + 0.15], shade: [1.0, 1.06] });
  sink.add(shapes.box(topOut * 2.9, topOut * 2.9, 0.14), m.gold, { position: [cx, cy, zTopFrame + 0.36], shade: [1.02, 1.1] });
  // 手すり
  for (const [ox, oy] of corners) {
    strut(sink, shapes, [cx + ox * topOut * 1.3, cy + oy * topOut * 1.3, zTopFrame + 0.3],
      [cx + ox * topOut * 1.3, cy + oy * topOut * 1.3, zTopFrame + 1.05], 0.07, m.timber, { segments: 5 });
  }
  for (let i = 0; i < 4; i++) {
    const a = corners[i]; const b = corners[(i + 1) % 4];
    strut(sink, shapes, [cx + a[0] * topOut * 1.3, cy + a[1] * topOut * 1.3, zTopFrame + 1.0],
      [cx + b[0] * topOut * 1.3, cy + b[1] * topOut * 1.3, zTopFrame + 1.0], 0.055, m.timber, { segments: 5 });
  }
  return bakeParts(THREE, sink.parts, 'crane-tower');
}

function buildCraneJib(THREE, kit, shapes, platform) {
  const m = kit.materials;
  const sink = createSink();
  const [cx, cy] = center2(platform);
  const zTopFrame = platform.max[2] + 11.5;      // 20.5
  const pivot = [cx, cy, zTopFrame + 1.4];
  const tip = [cx - 11.5, cy, zTopFrame + 0.1];
  const counter = [cx + 5.4, cy, zTopFrame + 0.9];
  const lower = -0.9;
  const chord = (a, b, dz, r) => strut(sink, shapes, [a[0], a[1], a[2] + dz], [b[0], b[1], b[2] + dz], r, m.timber, { segments: 5 });
  // 腕木（上下弦材＋ウェブ）
  chord(pivot, tip, 0, 0.13);
  chord(pivot, tip, lower, 0.13);
  chord(pivot, counter, 0, 0.12);
  chord(pivot, counter, lower, 0.12);
  const webs = 7;
  for (let i = 0; i <= webs; i++) {
    const t = i / webs;
    const p = [pivot[0] + (tip[0] - pivot[0]) * t, cy, pivot[2] + (tip[2] - pivot[2]) * t];
    strut(sink, shapes, [p[0], cy, p[2]], [p[0], cy, p[2] + lower], 0.07, m.timber, { segments: 4 });
    if (i < webs) {
      const t2 = (i + 1) / webs;
      const q = [pivot[0] + (tip[0] - pivot[0]) * t2, cy, pivot[2] + (tip[2] - pivot[2]) * t2];
      strut(sink, shapes, [p[0], cy, p[2] + lower], [q[0], cy, q[2]], 0.055, m.timber, { segments: 4 });
    }
  }
  for (let i = 1; i <= 3; i++) {
    const t = i / 3;
    const p = [pivot[0] + (counter[0] - pivot[0]) * t, cy, pivot[2] + (counter[2] - pivot[2]) * t];
    strut(sink, shapes, [p[0], cy, p[2]], [p[0], cy, p[2] + lower], 0.065, m.timber, { segments: 4 });
  }
  // 釣合錘（石）
  sink.add(shapes.box(1.7, 1.9, 1.35), m.stone, { position: [counter[0] + 0.3, cy, counter[2] - 1.4], shade: [0.62, 0.9] });
  sink.add(shapes.box(1.9, 2.1, 0.16), m.gold, { position: [counter[0] + 0.3, cy, counter[2] - 0.65], shade: [1.0, 1.1] });
  // 斜張索（塔頂 → 腕木）
  const mastTop = [cx, cy, zTopFrame + 4.4];
  for (const t of [0.45, 0.82]) {
    const p = [pivot[0] + (tip[0] - pivot[0]) * t, cy, pivot[2] + (tip[2] - pivot[2]) * t];
    strut(sink, shapes, mastTop, p, 0.045, m.plasterShade, { segments: 4, shade: [0.7, 1.0] });
  }
  strut(sink, shapes, mastTop, [counter[0], cy, counter[2]], 0.045, m.plasterShade, { segments: 4, shade: [0.7, 1.0] });
  return bakeParts(THREE, sink.parts, 'crane-jib');
}

function buildCraneTackle(THREE, kit, shapes, platform) {
  const m = kit.materials;
  const sink = createSink();
  const [cx, cy] = center2(platform);
  const zTopFrame = platform.max[2] + 11.5;
  const jibZ = (x) => zTopFrame + 1.4 + ((x - cx) / -11.5) * (-1.3) - 0.9;
  // 吊り索と滑車
  const hookX = cx - 9.2;
  const zHang = jibZ(hookX);
  strut(sink, shapes, [hookX, cy, zHang], [hookX, cy, zHang - 5.0], 0.055, m.plasterShade, { segments: 4, shade: [0.8, 1.0] });
  sink.add(shapes.box(0.72, 0.5, 0.62), m.timber, { position: [hookX, cy, zHang - 5.3], shade: [0.7, 0.95] });
  sink.add(shapes.ring(0.34, 0.075, 5, 8), m.gold, {
    position: [hookX, cy, zHang - 5.85], rotation: [Math.PI / 2, 0, 0], shade: [1.0, 1.1],
  });
  // 大浮標束（3スケールの最大）— 水市の一目で分かる吊り物
  const cluster = [
    { p: [hookX - 0.1, cy - 0.2, zHang - 7.3], scale: 'large', cool: false },
    { p: [hookX + 1.5, cy + 0.9, zHang - 6.5], scale: 'medium', cool: true },
    { p: [hookX - 1.4, cy + 0.8, zHang - 6.2], scale: 'medium', cool: false },
    { p: [hookX + 0.4, cy - 1.6, zHang - 6.0], scale: 'medium', cool: true },
  ];
  for (const item of cluster) {
    buoy(sink, shapes, m, item.p, item.scale, { cool: item.cool });
    strut(sink, shapes, [item.p[0], item.p[1], item.p[2] + 1.6], [hookX, cy, zHang - 5.4], 0.035, m.plasterShade, { segments: 4 });
  }
  // 競り鐘（金）。SSOT identity「吊り浮標と競り鐘」
  const bellX = cx - 5.4;
  const bellZ = jibZ(bellX) - 2.4;
  strut(sink, shapes, [bellX, cy, jibZ(bellX)], [bellX, cy, bellZ + 0.9], 0.05, m.timber, { segments: 4 });
  sink.add(shapes.box(1.5, 0.22, 0.22), m.timber, { position: [bellX, cy, bellZ + 0.95], shade: [0.9, 1.0] });
  sink.add(shapes.cone(0.82, 1.5, 10), m.gold, { position: [bellX, cy, bellZ + 0.1], rotation: [0, 0, 0], shade: [0.85, 1.12] });
  sink.add(shapes.ring(0.8, 0.1, 5, 10), m.gold, { position: [bellX, cy, bellZ - 0.6], shade: [1.0, 1.12] });
  sink.add(shapes.sphere(0.2, 6, 5), m.timber, { position: [bellX, cy, bellZ - 0.95], shade: [0.8, 0.95] });
  return bakeParts(THREE, sink.parts, 'crane-tackle');
}

function buildCranePennant(THREE, kit, shapes, platform) {
  const m = kit.materials;
  const sink = createSink();
  const [cx, cy] = center2(platform);
  const zTopFrame = platform.max[2] + 11.5;
  strut(sink, shapes, [cx, cy, zTopFrame + 1.3], [cx, cy, zTopFrame + 4.6], 0.16, m.timber, { segments: 6, taper: 0.6 });
  // 灯（西＝藍。ARCH_BRIEF §3.4 の寒色は1色のみ）
  sink.add(shapes.sphere(0.42, 8, 6), m.lampWest, { position: [cx, cy, zTopFrame + 4.9], shade: [1, 1] });
  sink.add(shapes.cone(0.62, 0.5, 8), m.gold, { position: [cx, cy, zTopFrame + 5.25], shade: [1, 1.1] });
  // 吹き流し（藍の布）
  saggingCloth(THREE, sink, kit.materialsExtra.clothIndigo, {
    x0: cx + 0.1, x1: cx + 4.2, y0: cy - 0.02, y1: cy - 0.02, zEdge: zTopFrame + 4.3, sag: 1.5, steps: 5, axis: 'x',
  });
  saggingCloth(THREE, sink, kit.materialsExtra.clothPale, {
    x0: cx + 0.1, x1: cx + 3.4, y0: cy + 0.7, y1: cy + 0.7, zEdge: zTopFrame + 3.8, sag: 1.2, steps: 5, axis: 'x',
  });
  return bakeParts(THREE, sink.parts, 'crane-pennant');
}

/** 四隅の浮標門柱。boundary-post の 0.8x0.8 の中に必ず収める。 */
function buildGateMasts(THREE, kit, shapes, posts) {
  const m = kit.materials;
  const sink = createSink();
  for (const [index, post] of posts.entries()) {
    const [px, py] = center2(post);
    const zTop = post.max[2];               // 5.4
    const mastTop = 9.7;
    sink.add(shapes.box(0.62, 0.62, 0.18), m.stone, { position: [px, py, zTop + 0.09], shade: [0.55, 0.8] });
    strut(sink, shapes, [px, py, zTop], [px, py, mastTop], 0.15, m.timber, { segments: 6, taper: 0.78 });
    // 帯（金の差し色は細く）
    for (const z of [zTop + 1.4, zTop + 2.9]) {
      sink.add(shapes.ring(0.2, 0.045, 5, 8), m.gold, { position: [px, py, z], shade: [1, 1.1] });
    }
    // 頂の浮標（中スケール）と灯
    buoy(sink, shapes, m, [px, py, mastTop + 0.55], 'medium', { cool: index % 2 === 0 });
    sink.add(shapes.sphere(0.26, 8, 6), m.lampWest, { position: [px, py, mastTop + 1.72], shade: [1, 1] });
    sink.add(shapes.cone(0.34, 0.34, 8), m.gold, { position: [px, py, mastTop + 1.98], shade: [1, 1.1] });
  }
  return bakeParts(THREE, sink.parts, 'gate-masts');
}

/** 日除け布の連なり。門柱の頂を結ぶ梁と、その間に垂れる藍と生成の縞。 */
function buildMarketCanopy(THREE, kit, shapes, posts) {
  const m = kit.materials;
  const sink = createSink();
  const xs = [...new Set(posts.map(p => Math.round(center2(p)[0] * 10) / 10))].sort((a, b) => a - b);
  const ys = [...new Set(posts.map(p => Math.round(center2(p)[1] * 10) / 10))].sort((a, b) => a - b);
  const [x0, x1] = [xs[0], xs[xs.length - 1]];
  const [y0, y1] = [ys[0], ys[ys.length - 1]];
  const beamZ = 9.55;
  // 南北の主梁（門柱の真上）
  for (const x of [x0, x1]) {
    sink.add(shapes.box(0.24, y1 - y0 + 0.6, 0.3), m.timber, { position: [x, (y0 + y1) / 2, beamZ], shade: [0.72, 1.0] });
  }
  // 東西の小梁
  const bands = 4;
  const beamY = [];
  for (let i = 0; i < bands; i++) {
    const y = y0 + ((y1 - y0) * i) / (bands - 1);
    beamY.push(y);
    sink.add(shapes.box(x1 - x0 + 0.6, 0.2, 0.24), m.timber, { position: [(x0 + x1) / 2, y, beamZ - 0.12], shade: [0.72, 1.0] });
  }
  // 日除け布（藍と生成の縞。区画ごとに互い違い）
  const bays = 4;
  for (let b = 0; b < bands - 1; b++) {
    for (let i = 0; i < bays; i++) {
      const bx0 = x0 + ((x1 - x0) * i) / bays;
      const bx1 = x0 + ((x1 - x0) * (i + 1)) / bays;
      const cloth = (b + i) % 2 === 0 ? kit.materialsExtra.clothIndigo : kit.materialsExtra.clothPale;
      saggingCloth(THREE, sink, cloth, {
        x0: bx0 + 0.06, x1: bx1 - 0.06, y0: beamY[b], y1: beamY[b + 1],
        zEdge: beamZ - 0.28, sag: 1.05, steps: 5, axis: 'y',
      });
    }
  }
  // 梁の交点の吊り灯（西＝藍）
  for (const x of [x0, x1]) {
    for (const y of [beamY[1], beamY[2]]) {
      strut(sink, shapes, [x, y, beamZ - 0.2], [x, y, beamZ - 1.5], 0.035, m.timber, { segments: 4 });
      sink.add(shapes.box(0.34, 0.34, 0.42), m.timber, { position: [x, y, beamZ - 1.75], shade: [0.85, 1.0] });
      sink.add(shapes.sphere(0.24, 8, 6), m.lampWest, { position: [x, y, beamZ - 1.78], shade: [1, 1] });
    }
  }
  return bakeParts(THREE, sink.parts, 'market-canopy');
}

/** 吊り下げ品。天蓋の梁から下がる籠・網・干物・小浮標。 */
function buildHangingGoods(THREE, kit, shapes, posts, seed = 47) {
  const m = kit.materials;
  const sink = createSink();
  const random = mizuichiRandom(seed);
  const xs = [...new Set(posts.map(p => Math.round(center2(p)[0] * 10) / 10))].sort((a, b) => a - b);
  const ys = [...new Set(posts.map(p => Math.round(center2(p)[1] * 10) / 10))].sort((a, b) => a - b);
  const beamZ = 9.55;
  const bands = 4;
  for (let b = 0; b < bands; b++) {
    const y = ys[0] + ((ys[ys.length - 1] - ys[0]) * b) / (bands - 1);
    const count = 5;
    for (let i = 0; i < count; i++) {
      const x = xs[0] + 0.9 + ((xs[xs.length - 1] - xs[0] - 1.8) * i) / (count - 1);
      const drop = 1.5 + random() * 0.9;
      const zTop = beamZ - 0.24;
      const zItem = zTop - drop;
      if (zItem < 7.0) continue;                    // 頭上クリアランスを割らせない
      strut(sink, shapes, [x, y, zTop], [x, y, zItem + 0.2], 0.028, m.timber, { segments: 4 });
      const roll = random();
      if (roll < 0.34) {
        // 籠
        sink.add(shapes.tube(0.34, 0.26, 0.46, 8), m.timber, { position: [x, y, zItem - 0.05], shade: [0.7, 1.0] });
        sink.add(shapes.ring(0.33, 0.045, 4, 8), m.gold, { position: [x, y, zItem + 0.18], shade: [1, 1.1] });
      } else if (roll < 0.62) {
        // 網
        saggingCloth(THREE, sink, kit.materialsExtra.clothIndigo, {
          x0: x - 0.46, x1: x + 0.46, y0: y - 0.02, y1: y - 0.02, zEdge: zItem + 0.2, sag: 0.55, steps: 4, axis: 'x',
        });
        saggingCloth(THREE, sink, kit.materialsExtra.clothIndigo, {
          x0: x - 0.02, x1: x + 0.02, y0: y - 0.42, y1: y + 0.42, zEdge: zItem + 0.16, sag: 0.5, steps: 4, axis: 'y',
        });
      } else if (roll < 0.82) {
        // 干し物の連
        for (let k = 0; k < 3; k++) {
          sink.add(shapes.box(0.16, 0.34, 0.3), m.plasterWarm || m.plaster, {
            position: [x, y - 0.34 + k * 0.34, zItem - 0.1], rotation: [0, 0, random() * 0.3], shade: [0.75, 1.0],
          });
        }
      } else {
        buoy(sink, shapes, m, [x, y, zItem - 0.12], 'small', { cool: random() > 0.5 });
      }
    }
  }
  return bakeParts(THREE, sink.parts, 'hanging-goods');
}

/** 浮標と灯の連。クレーンと両大屋根の頂を結ぶ懸垂線。導線と夜間の可読性を作る。 */
function buildFestoonGarlands(THREE, kit, shapes, anchors, seed = 53) {
  const m = kit.materials;
  const sink = createSink();
  const random = mizuichiRandom(seed);
  const curveZ = (a, b, t, sag) => a[2] + (b[2] - a[2]) * t - sag * Math.sin(Math.PI * t);
  for (const [index, line] of anchors.entries()) {
    const { from, to, sag } = line;
    const seg = 10;
    for (let i = 0; i < seg; i++) {
      const t0 = i / seg; const t1 = (i + 1) / seg;
      const p0 = [from[0] + (to[0] - from[0]) * t0, from[1] + (to[1] - from[1]) * t0, curveZ(from, to, t0, sag)];
      const p1 = [from[0] + (to[0] - from[0]) * t1, from[1] + (to[1] - from[1]) * t1, curveZ(from, to, t1, sag)];
      strut(sink, shapes, p0, p1, 0.045, m.timber, { segments: 4, shade: [0.7, 1.0] });
      if (i % 2 === 0) {
        const hangZ = p0[2] - 0.42;
        if (index % 2 === 0) {
          buoy(sink, shapes, m, [p0[0], p0[1], hangZ - 0.3], 'small', { cool: random() > 0.5 });
        } else {
          sink.add(shapes.sphere(0.2, 6, 5), m.lampWest, { position: [p0[0], p0[1], hangZ - 0.2], shade: [1, 1] });
          sink.add(shapes.cone(0.24, 0.22, 6), m.gold, { position: [p0[0], p0[1], hangZ + 0.02], shade: [1, 1.1] });
        }
      }
    }
  }
  return bakeParts(THREE, sink.parts, 'festoon-garlands');
}

/** 縄と浮子の欄干。階段の当たり判定フットプリント内に必ず収める。 */
function buildStairRails(THREE, kit, shapes, stairsX, stairsY) {
  const m = kit.materials;
  const sink = createSink();
  const railRun = (steps, axis) => {
    // axis 'x': 段は X に並ぶ。手すりは Y の両端側の内側へ。
    const lateral = axis === 'x' ? 1 : 0;
    const lo = steps[0].min[lateral] + 0.22;
    const hi = steps[0].max[lateral] - 0.22;
    for (const side of [lo, hi]) {
      let prev = null;
      for (const step of steps) {
        const along = axis === 'x'
          ? (step.min[0] + step.max[0]) / 2
          : (step.min[1] + step.max[1]) / 2;
        const p = axis === 'x' ? [along, side, step.max[2]] : [side, along, step.max[2]];
        sink.add(shapes.box(0.15, 0.15, 0.98), m.timber, { position: [p[0], p[1], p[2] + 0.49], shade: [0.45, 0.9] });
        const top = [p[0], p[1], p[2] + 0.98];
        if (prev) strut(sink, shapes, prev, top, 0.05, m.plasterShade, { segments: 4, shade: [0.8, 1.05] });
        prev = top;
      }
    }
    // 数段おきに浮子（小浮標）を欄干に付ける
    for (let i = 1; i < steps.length; i += 3) {
      const step = steps[i];
      const along = axis === 'x' ? (step.min[0] + step.max[0]) / 2 : (step.min[1] + step.max[1]) / 2;
      const p = axis === 'x' ? [along, hi, step.max[2] + 1.02] : [hi, along, step.max[2] + 1.02];
      buoy(sink, shapes, m, p, 'small', { radius: 0.2, cool: i % 2 === 0 });
    }
  };
  railRun(stairsX, 'x');
  railRun(stairsY, 'y');
  return bakeParts(THREE, sink.parts, 'stair-rails');
}

/** 汐入り水路。床の意匠として水面・護岸・渡し板を敷く（高さ 0.5m 以下）。 */
function buildTideCanal(THREE, kit, shapes, { x0, x1, yCenter, width, waterZ }) {
  const m = kit.materials;
  const sink = createSink();
  const halfW = width / 2;
  // 水面（碧い浅瀬。唯一の寒色の淡い派生）
  sink.add(shapes.box(x1 - x0, width, 0.06), m.shallow, { position: [(x0 + x1) / 2, yCenter, waterZ - 0.03], shade: [0.85, 1.05] });
  // 護岸（石。目地を出すため二段）
  for (const oy of [-1, 1]) {
    sink.add(shapes.box(x1 - x0, 0.62, 0.26), m.stone, {
      position: [(x0 + x1) / 2, yCenter + oy * (halfW + 0.31), waterZ + 0.05], shade: [0.6, 0.95],
    });
    sink.add(shapes.box(x1 - x0, 0.2, 0.08), m.gold, {
      position: [(x0 + x1) / 2, yCenter + oy * (halfW + 0.02), waterZ + 0.2], shade: [1.0, 1.1],
    });
  }
  // 渡し板（3か所）
  for (const x of [x0 + 3.6, (x0 + x1) / 2, x1 - 4.2]) {
    sink.add(shapes.box(1.9, width + 1.5, 0.14), m.timber, { position: [x, yCenter, waterZ + 0.14], shade: [0.75, 1.0] });
    for (const oy of [-1, 1]) {
      sink.add(shapes.box(2.0, 0.12, 0.1), m.plasterShade, { position: [x, yCenter + oy * (halfW + 0.6), waterZ + 0.24], shade: [1, 1.05] });
    }
  }
  // 汐留め（東端の樋門。低く抑える）
  sink.add(shapes.box(0.5, width + 1.4, 0.44), m.stone, { position: [x1 - 0.25, yCenter, waterZ + 0.16], shade: [0.6, 0.95] });
  sink.add(shapes.box(0.24, width - 0.4, 0.34), m.timber, { position: [x1 - 0.55, yCenter, waterZ + 0.12], shade: [0.6, 0.9] });
  return bakeParts(THREE, sink.parts, 'tide-canal');
}

/** 水路に浮かぶ浮標と繋留環。膝下に抑えて遮蔽にしない。 */
function buildCanalBuoys(THREE, kit, shapes, { x0, x1, yCenter, width, waterZ }, seed = 61) {
  const m = kit.materials;
  const sink = createSink();
  const random = mizuichiRandom(seed);
  const count = 6;
  for (let i = 0; i < count; i++) {
    const x = x0 + 2.4 + ((x1 - x0 - 5.0) * i) / (count - 1);
    const y = yCenter + (random() - 0.5) * (width - 1.1);
    // 半分沈んだ姿にして総高を 0.5m 以下に抑える（膝下＝遮蔽にならない）
    const r = 0.34;
    sink.add(shapes.sphere(1, 8, 6), i % 2 ? m.indigo : m.plaster, {
      position: [x, y, waterZ + 0.02], scale: [r * 2.1, r * 2.1, r * 0.86], shade: [0.7, 1.05],
    });
    sink.add(shapes.ring(r * 1.5, 0.055, 4, 8), m.gold, { position: [x, y, waterZ + 0.16], shade: [1, 1.1] });
  }
  // 護岸の繋留環
  for (let i = 0; i < 5; i++) {
    const x = x0 + 3.0 + ((x1 - x0 - 6.0) * i) / 4;
    for (const oy of [-1, 1]) {
      sink.add(shapes.ring(0.16, 0.035, 4, 7), m.gold, {
        position: [x, yCenter + oy * (width / 2 + 0.31), waterZ + 0.28], rotation: [Math.PI / 2, 0, 0], shade: [1, 1.1],
      });
    }
  }
  return bakeParts(THREE, sink.parts, 'canal-buoys');
}

/* ------------------------------------------------------------------ *
 * 4. 公開ビルダー
 * ------------------------------------------------------------------ */

/**
 * 水市の建築を組み立てる。
 * @param {object} kit  createArchKit(THREE) の戻り値（THREE 注入済み）
 * @param {object} options
 * @param {Array}  options.solids  当たり判定 solid の配列。**読むだけ**
 * @param {boolean} [options.mergeRoot=false] true で root 全体をマテリアル単位に畳む
 *                  （ドローコール最小。false だとノード単位の検査ができる）
 * @returns {object} THREE.Group
 */
export function buildMizuichiArchitecture(kit, options = {}) {
  need(kit && kit.THREE && typeof kit.wrapSolid === 'function', 'KIT_INVALID');
  const THREE = kit.THREE;
  const index = indexMizuichiSolids(options.solids);
  const shapes = makeShapes(THREE);
  const seed = Number.isFinite(options.seed) ? options.seed : 21;
  const m = kit.materials;

  // 布は下から見上げるので両面。arch_kit のマテリアルは触らず、この区画専用に足す。
  if (!kit.materialsExtra) {
    const cloth = (name, hex, opacity) => {
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(hex), vertexColors: true, roughness: 0.94, metalness: 0,
        side: THREE.DoubleSide, transparent: opacity < 1, opacity,
      });
      material.name = `mizuichi-${name}`;
      material.userData.archMaterial = name;
      return material;
    };
    kit.materialsExtra = {
      clothIndigo: cloth('clothIndigo', kit.palette.indigo, 0.96),
      clothPale: cloth('clothPale', kit.palette.plasterWarm ?? '#e2c9a6', 0.96),
    };
  }

  const root = new THREE.Group();
  root.name = options.name || 'mizuichi-architecture';
  markDecorative(root);
  root.userData.siteId = 'mizuichi';
  root.userData.archSite = MIZUICHI_SITE.id;

  const emit = (id, node) => {
    const spec = MIZUICHI_STRUCTURES.find(entry => entry.id === id);
    need(spec, `UNDECLARED_NODE_${id}`);
    node.name = id;
    markDecorative(node);
    node.traverse(child => markDecorative(child));
    node.userData.occlusionClass = spec.occlusionClass;
    node.userData.anchorSolidIds = [...spec.anchors];
    node.userData.mizuichiStructure = id;
    root.add(node);
    return node;
  };

  const pad = index.get('objective-pad');
  const posts = ['nw', 'ne', 'sw', 'se'].map(k => index.get(`boundary-post-${k}`));
  const platform = index.get('high-platform');
  const massNorth = index.get('mass-north');
  const massSouth = index.get('mass-south');
  const [padCx, padCy] = center2(pad);
  const padTop = pad.max[2];

  /* --- 床（ARCH_BRIEF §3.6: 単色にせず必ずパターンと動線ライン） --- */
  {
    const group = new THREE.Group();
    const patch = kit.createPavingPatch({
      width: sizeOf(pad)[0], depth: sizeOf(pad)[1], tileSizeM: 3.0, joint: 0.11,
      // 動線ライン: 西の進入路 / 北の水路 / 東のクレーンへ
      lanes: [
        { from: [-9, 0], to: [9, 0], width: 0.62 },
        { from: [0, -9], to: [0, 9], width: 0.62 },
        { from: [-6.4, 6.4], to: [6.4, -6.4], width: 0.34 },
      ],
      seed: seed + 3, name: 'mizuichi-pad-paving-patch',
    });
    kit.mountZUp(patch, [padCx, padCy, padTop - 0.118]);
    group.add(patch);
    kit.mergeArchRoot(group);
    emit('mizuichi-pad-paving', group);
  }

  {
    const group = new THREE.Group();
    const approaches = [
      { p: [42.5, 44, padTop], w: 9, d: 8, lane: 'x', s: 11 },     // 西（前進スポーン側）
      { p: [59, 65.5, padTop], w: 12, d: 8, lane: 'z', s: 12 },    // 北
      { p: [80, 48, padTop], w: 9, d: 9, lane: 'x', s: 13 },       // 東（基地側）
    ];
    for (const a of approaches) {
      const patch = kit.createPavingPatch({
        width: a.w, depth: a.d, tileSizeM: 2.6, joint: 0.1,
        laneAxis: a.lane, laneWidth: 0.7, seed: seed + a.s,
        name: `mizuichi-approach-${a.s}`,
      });
      kit.mountZUp(patch, [a.p[0], a.p[1], a.p[2] - 0.118]);
      group.add(patch);
    }
    kit.mergeArchRoot(group);
    emit('mizuichi-approach-paving', group);
  }

  /* --- 汐入り水路（この区画にしかない床の分節） ------------------- */
  const canal = { x0: 46.6, x1: 68.4, yCenter: 54.5, width: 2.6, waterZ: padTop };
  emit('mizuichi-tide-canal', buildTideCanal(THREE, kit, shapes, canal));
  emit('mizuichi-canal-buoys', buildCanalBuoys(THREE, kit, shapes, canal, seed + 40));

  /* --- 競り台（cover 3箱） ----------------------------------------- */
  emit('mizuichi-stall-northwest', buildStall(THREE, kit, shapes, index.get('cover-northwest'), { facing: -1, seed: seed + 5 }));
  emit('mizuichi-stall-northeast', buildStall(THREE, kit, shapes, index.get('cover-northeast'), { facing: -1, seed: seed + 6 }));
  emit('mizuichi-stall-south', buildStall(THREE, kit, shapes, index.get('cover-south'), { facing: 1, seed: seed + 7 }));

  /* --- 大屋根（近景シルエット層 6–25 m を厚くする） ---------------- */
  emit('mizuichi-hall-north', buildMarketHall(THREE, kit, shapes, massNorth, { seed: seed + 9, netRacks: true }));
  emit('mizuichi-hall-south', buildMarketHall(THREE, kit, shapes, massSouth, { seed: seed + 10, netRacks: false }));

  /* --- 中ランドマーク: 競り市クレーン ------------------------------ */
  emit('mizuichi-crane-tower', buildCraneTower(THREE, kit, shapes, platform));
  emit('mizuichi-crane-jib', buildCraneJib(THREE, kit, shapes, platform));
  emit('mizuichi-crane-tackle', buildCraneTackle(THREE, kit, shapes, platform));
  emit('mizuichi-crane-pennant', buildCranePennant(THREE, kit, shapes, platform));

  /* --- 門柱・天蓋・吊り下げ品 -------------------------------------- */
  emit('mizuichi-gate-masts', buildGateMasts(THREE, kit, shapes, posts));
  emit('mizuichi-market-canopy', buildMarketCanopy(THREE, kit, shapes, posts));
  emit('mizuichi-hanging-goods', buildHangingGoods(THREE, kit, shapes, posts, seed + 26));

  /* --- 浮標と灯の連 ------------------------------------------------ */
  {
    const [mnx, mny] = center2(massNorth); const mnz = massNorth.max[2] + 3.9;
    const [msx, msy] = center2(massSouth); const msz = massSouth.max[2] + 3.9;
    const [pcx, pcy] = center2(platform); const pcz = platform.max[2] + 15.9;
    const lines = [
      { from: [pcx, pcy, pcz], to: [mnx, mny, mnz], sag: 4.4 },
      { from: [pcx, pcy, pcz], to: [msx, msy, msz], sag: 5.2 },
      { from: [mnx - 3.5, mny, mnz - 0.4], to: [msx - 3.5, msy, msz - 0.4], sag: 5.6 },
      { from: [mnx + 3.5, mny, mnz - 0.4], to: [msx + 3.5, msy, msz - 0.4], sag: 5.6 },
    ];
    emit('mizuichi-festoon-garlands', buildFestoonGarlands(THREE, kit, shapes, lines, seed + 32));
  }

  emit('mizuichi-stair-rails', buildStairRails(THREE, kit, shapes, index.stairsX, index.stairsY));

  /* --- 植生（プレイ空間に疎・境界に密／ARCH_BRIEF §3.5） ---------- */
  {
    const group = new THREE.Group();
    const spots = [[44.5, 36.5], [45.0, 52.0], [72.5, 37.0], [70.0, 60.0]];
    const random = mizuichiRandom(seed + 70);
    for (const [i, [x, y]] of spots.entries()) {
      const h = 4.4 + random() * 1.8;
      const tree = kit.createTree({
        height: h, crownRadius: h * 0.3, kind: i % 2 ? 'pine' : 'broadleaf',
        seed: seed + 71 + i * 5, detail: 'medium', name: `mizuichi-tree-inner-${i}`,
      });
      kit.mountZUp(tree, [x, y, padTop], random() * Math.PI * 2);
      group.add(tree);
    }
    kit.mergeArchRoot(group);
    emit('mizuichi-planting-inner', group);
  }
  {
    const group = new THREE.Group();
    const random = mizuichiRandom(seed + 80);
    const line = [];
    for (let i = 0; i < 11; i++) line.push([37.0 + i * 3.9, 63.4 + random() * 1.8]);        // 北縁
    for (let i = 0; i < 9; i++) line.push([78.4 + random() * 1.8, 28.5 + i * 3.9]);         // 東縁
    for (let i = 0; i < 7; i++) line.push([38.0 + i * 3.4, 24.6 - random() * 1.6]);         // 南縁
    for (const [i, [x, y]] of line.entries()) {
      const h = 3.6 + random() * 2.6;
      const tree = kit.createTree({
        height: h, crownRadius: h * 0.34, kind: i % 3 === 0 ? 'pine' : 'broadleaf',
        seed: seed + 81 + i * 3, detail: 'low', name: `mizuichi-tree-edge-${i}`,
      });
      kit.mountZUp(tree, [x, y, padTop], random() * Math.PI * 2);
      group.add(tree);
    }
    kit.mergeArchRoot(group);
    emit('mizuichi-planting-edge', group);
  }

  /* --- 遠景（層3）: 北東の対岸市場町。境界の外にだけ置く ---------- */
  {
    const group = new THREE.Group();
    const random = mizuichiRandom(seed + 90);
    const masses = [
      [138, 52, 22, 16, 24], [146, 74, 18, 20, 31], [134, 96, 20, 18, 19],
      [152, 34, 16, 16, 27], [96, 104, 24, 18, 21], [70, 110, 20, 16, 28],
      [120, 118, 22, 20, 17], [46, 102, 18, 16, 23],
    ];
    for (const [i, [x, y, w, d, h]] of masses.entries()) {
      const mass = kit.createSilhouetteMass({
        kind: i % 3 === 0 ? 'tower' : 'block', width: w, depth: d, height: h,
        seed: seed + 91 + i, name: `mizuichi-distant-${i}`,
      });
      kit.mountZUp(mass, [x, y, 0], random() * 0.6);
      group.add(mass);
    }
    // 浮標を掛けた櫓（水市の遠景固有のシルエット）
    const sink = createSink();
    for (const [i, [x, y, hh]] of [[132, 62, 34], [104, 108, 30], [150, 90, 38]].entries()) {
      const legs = [[-3.4, -3.4], [3.4, -3.4], [3.4, 3.4], [-3.4, 3.4]];
      for (const [ox, oy] of legs) {
        strut(sink, shapes, [x + ox, y + oy, 0], [x + ox * 0.3, y + oy * 0.3, hh], 0.7, m.silhouette, { segments: 5, shade: [0.4, 1.0] });
      }
      for (const z of [hh * 0.35, hh * 0.68, hh]) {
        const t = z / hh;
        const s = 3.4 * (1 - t * 0.7);
        sink.add(shapes.box(s * 2, s * 2, 0.5), m.silhouette, { position: [x, y, z], shade: [0.5, 1.0] });
      }
      // 掛かった大浮標（3スケールの最大を遠景でも反復する）
      for (let k = 0; k < 3; k++) {
        sink.add(shapes.sphere(1, 6, 4), k % 2 ? m.indigo : m.silhouette, {
          position: [x + (k - 1) * 3.2, y + (i % 2 ? 2.6 : -2.6), hh * 0.52 - k * 2.4],
          scale: [2.0, 2.0, 2.2], shade: [0.6, 1.0],
        });
      }
    }
    group.add(bakeParts(THREE, sink.parts, 'distant-buoy-gantries'));
    kit.mergeArchRoot(group);
    emit('mizuichi-distant-market-town', group);
  }

  if (options.mergeRoot) kit.mergeArchRoot(root);
  root.userData.structureCount = root.children.length;
  return root;
}

export default buildMizuichiArchitecture;
