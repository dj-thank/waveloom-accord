/**
 * site_ami.js — 網（北西拠点）の建築配置データ
 *
 * 建築語彙: **閘門と運河**。水位差・閘門扉・網干し場・網橋。
 * 中ランドマーク: 閘門小屋（SSOT `highGrounds[0] = lockhouse [-44,50,8]` の当たり判定 tower 箱の上）。
 *
 * 規約（ARCH_BRIEF §1 / survey §7.3 / arch_kit_api §1）
 *  - `map_oshioi_flashpoint_geometry.js` の solids は **読むだけ**。当たり判定は一切作らない。
 *  - 生成物は全ノード `userData.collision === false`。
 *  - `client/render.js` の `world` は既に `rotation.x = -Math.PI/2` なので、
 *    このファイルの自前ジオメトリは **ゲーム座標 Z-up でそのまま**書く。
 *    `arch_kit` の単体語彙（Y-up で返る）だけ `kit.mountZUp()` を通す。
 *  - 共有ファイル（arch_kit.js / presentation.js / render.js / flashpoint_geometry.js）は書き換えない。
 *
 * 偽の遮蔽を作らないための自己規律（`auditAmiOcclusion` が実測で検査する）:
 *   プレイ帯（床 z=4 から頭上 2.2 m まで）に置いてよいのは次のいずれかだけ。
 *     a) 当たり判定 solid の水平フットプリントの内側にあるもの（= `wrapSolid` の生成物）
 *     b) 高さ 0.35 m 以下の地物（石畳・護岸の縁石・水面・動線ライン）
 *     c) 水平断面 0.6 m 以下の細い柱（標柱・係船柱・脚・格子桟）
 *     d) 植生（`softOcclusion`。ARCH_BRIEF §3.5 が明示的に許す柔らかい遮蔽）
 *   それ以外の塊は **すべて頭上 2.2 m より上**（＝ ARCH_BRIEF §3.1 の「近景建築 6〜25 m
 *   シルエット層」）か、`playableBounds` の外の借景に置く。
 */

import { createArchKit } from '../../../client/img2threejs/runtime/arch_kit.js';
import { buildOshioiFlashpointGeometry } from '../map_oshioi_flashpoint_geometry.js';

/* ------------------------------------------------------------------ *
 * 0. 区画の定数（SSOT `map_oshioi_flashpoint.js` の ami と一致させる）
 * ------------------------------------------------------------------ */

export const AMI_SITE = Object.freeze({
  id: 'ami',
  centerM: [-56, 44, 4],
  radiusM: 7,
  floorZ: 4,
  playBoundsM: Object.freeze({ x: [-76, -36], y: [27, 61] }),
  /** この区画が装飾を置く範囲（借景を含む）。他区画と重ならないようにする。 */
  districtBoundsM: Object.freeze({ x: [-112, -30], y: [12, 90] }),
  /** ゲームの競技境界。これより外は「遮蔽に見える塊」の禁止対象外（借景）。 */
  playableBoundsM: Object.freeze({ x: [-126, 126], y: [-92, 92] }),
  lockhouseM: [-44, 50, 8],
  solidPrefix: 'flash-site-ami-',
});

/** 頭上クリアランス。この高さより上でだけ塊を張り出してよい。 */
export const AMI_PLAY_CLEARANCE_M = 2.2;
/** 「地物」と見なす最大高さ（縁石・石畳・水面）。 */
export const AMI_GROUND_FURNITURE_M = 0.35;
/** 「細い柱」と見なす最大水平断面。 */
export const AMI_SLENDER_POST_M = 0.6;
/** 歩ける天面（tower/stair/rim）の上に塊を置いてよい最低クリアランス。 */
export const AMI_WALKABLE_CLEARANCE_M = 2.4;

/** 運河。北西から南東へ抜ける水路の本流。 */
export const AMI_CANAL = Object.freeze({
  xM: [-74.5, -65.5],
  centerXM: -70,
  yM: [16, 80],
  /** 閘室（上流門と下流門に挟まれた区間） */
  chamberYM: [34, 54],
  upperGateYM: 54,
  lowerGateYM: 34,
});

/**
 * 水位差。床スラブ（z=4）を掘れないので、水面の段差＋堰の縁石＋潮位標で表す。
 * 上流 → 閘室 → 下流 で単調に下がることをテストが検査する。
 */
export const AMI_WATER_LEVELS = Object.freeze({
  upperM: 4.16,
  chamberM: 4.09,
  lowerM: 4.02,
});

/**
 * この区画の単位モチーフ = **巻上輪（閘門扉を吊る歯車輪）**。
 * ARCH_BRIEF §3.2 の「同一部品を3スケールで反復して部品数を増やさず密度を上げる」。
 * 灯（arch_kit の lampPost）とは別に、網だけが持つモチーフとして反復する。
 */
export const AMI_WINCH_WHEEL_SCALES = Object.freeze({
  small: 0.42,   // 係船柱の頭
  medium: 1.55,  // 閘門扉の巻上機／標柱
  large: 2.20,   // 閘門小屋の大輪
});

/**
 * この区画にしか無い構造物の一覧。テストが「固有性」をこの配列で検査する。
 * `shared` は他区画と共有してよい汎用語彙（arch_kit 由来）。
 */
export const AMI_UNIQUE_STRUCTURES = Object.freeze([
  { id: 'ami-canal', label: '運河（水面・護岸縁石・曳舟道の動線ライン）', shared: false },
  { id: 'ami-lock-gate-upper', label: '上流閘門扉（吊り上げ式・巻上輪つき）', shared: false },
  { id: 'ami-lock-gate-lower', label: '下流閘門扉（吊り上げ式・巻上輪つき）', shared: false },
  { id: 'ami-tide-staff', label: '潮位標（水位差の目盛板）', shared: false },
  { id: 'ami-net-bridge-south', label: '網橋・南（吊り網つきの渡り橋）', shared: false },
  { id: 'ami-net-bridge-north', label: '網橋・北（吊り網つきの渡り橋）', shared: false },
  { id: 'ami-net-drying-yard', label: '網干し場（掛け竿と吊り網の列）', shared: false },
  { id: 'ami-lockhouse', label: '閘門小屋（中ランドマーク。巻上機小屋＋大輪＋灯）', shared: false },
  { id: 'ami-mooring-bollards', label: '係船柱（小巻上輪の反復）', shared: false },
  { id: 'ami-turning-basin', label: '船溜まりの曲面護岸', shared: false },
  { id: 'ami-approach-masts', label: '標柱（入口の背の高い要素＋灯）', shared: true },
  { id: 'ami-wrapped-solids', label: '当たり判定 AABB を包んだ壁体・階段・欄干', shared: true },
  { id: 'ami-paving-aprons', label: '石畳と動線ライン', shared: true },
  { id: 'ami-planting', label: '植生（境界に密・プレイ空間に疎）', shared: true },
  { id: 'ami-far-district', label: '遠景の運河沿い倉庫街', shared: true },
]);

/* ------------------------------------------------------------------ *
 * 1. solids の読み出し（読むだけ・複製もしない）
 * ------------------------------------------------------------------ */

/** ami の当たり判定箱だけを返す。`kazami` を巻き込まないよう前方一致で絞る。 */
export function amiSolids(solids = null) {
  const list = solids || buildOshioiFlashpointGeometry().solids;
  return list.filter(solid => typeof solid?.id === 'string' && solid.id.startsWith(AMI_SITE.solidPrefix));
}

/** 区画内（借景を除く）に効く当たり判定の水平フットプリント一覧。 */
export function amiCollisionFootprints(solids = null) {
  const list = solids || buildOshioiFlashpointGeometry().solids;
  const { x: [dx0, dx1], y: [dy0, dy1] } = AMI_SITE.districtBoundsM;
  return list
    .filter(solid => Array.isArray(solid?.min) && Array.isArray(solid?.max))
    .filter(solid => solid.max[0] >= dx0 && solid.min[0] <= dx1 && solid.max[1] >= dy0 && solid.min[1] <= dy1)
    .map(solid => ({
      id: solid.id,
      tag: solid.tag,
      min: [solid.min[0], solid.min[1], solid.min[2]],
      max: [solid.max[0], solid.max[1], solid.max[2]],
    }));
}

/* ------------------------------------------------------------------ *
 * 2. 自前ジオメトリの受け皿（Z-up のまま作る）
 * ------------------------------------------------------------------ */

function createZSink(THREE) {
  const parts = [];
  const elements = [];
  const box3 = new THREE.Box3();
  const add = (geometry, material, {
    position = [0, 0, 0],
    rotation = [0, 0, 0],
    scale = [1, 1, 1],
    tint = [1, 1, 1],
    shade = [0.62, 1.04],
    id = 'ami-part',
    cls = 'overhead',
  } = {}) => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3().fromArray(position),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation[0], rotation[1], rotation[2])),
      new THREE.Vector3().fromArray(Array.isArray(scale) ? scale : [scale, scale, scale]),
    );
    if (!geometry.boundingBox) geometry.computeBoundingBox();
    box3.copy(geometry.boundingBox).applyMatrix4(matrix);
    elements.push({
      id,
      cls,
      min: [box3.min.x, box3.min.y, box3.min.z],
      max: [box3.max.x, box3.max.y, box3.max.z],
    });
    parts.push({ geometry, material, matrix, tint, shade });
  };
  return { parts, elements, add };
}

/** parts をマテリアル別に1メッシュへ畳む。頂点色は世界 Z の縦グラデーションで焼く。 */
function bakeZParts(THREE, parts, name, markDecorative) {
  const group = new THREE.Group();
  group.name = name;
  const prepared = [];
  let minZ = Infinity; let maxZ = -Infinity;
  for (const part of parts) {
    const source = part.geometry.index ? part.geometry.toNonIndexed() : part.geometry.clone();
    if (!source.attributes.normal) source.computeVertexNormals();
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', source.attributes.position.clone());
    geometry.setAttribute('normal', source.attributes.normal.clone());
    geometry.applyMatrix4(part.matrix);
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
    const [low, high] = part.shade;
    for (let i = 0; i < position.count; i++) {
      const t = (position.getZ(i) - minZ) / span;
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
    let total = 0;
    for (const geometry of bucket.geometries) total += geometry.attributes.position.count;
    const position = new Float32Array(total * 3);
    const normal = new Float32Array(total * 3);
    const color = new Float32Array(total * 3);
    let offset = 0;
    for (const geometry of bucket.geometries) {
      position.set(geometry.attributes.position.array, offset * 3);
      normal.set(geometry.attributes.normal.array, offset * 3);
      color.set(geometry.attributes.color.array, offset * 3);
      offset += geometry.attributes.position.count;
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

/* ------------------------------------------------------------------ *
 * 3. 本体
 * ------------------------------------------------------------------ */

/**
 * 網（北西拠点）の建築を組み立てて `THREE.Group` で返す。
 * 返り値は `client/render.js` の `worldDressing`（Z-up の world 直下）に
 * そのまま `add` できる。全ノード `userData.collision === false`。
 *
 * @param {object} THREE
 * @param {object} [options]
 * @param {object}   [options.kit]     既存の arch_kit を使い回す場合
 * @param {'low'|'medium'|'high'} [options.detail='medium']
 * @param {number}   [options.seed=4103]
 * @param {Array}    [options.solids]  当たり判定 solids（省略時は SSOT から読む）
 * @param {boolean}  [options.merge=true] マテリアル単位に畳むか
 * @param {boolean}  [options.farDistrict=true] 借景（境界外）を作るか
 * @returns {THREE.Group}
 */
export function buildAmiArchitecture(THREE, options = {}) {
  const detail = options.detail || 'medium';
  const kit = options.kit || createArchKit(THREE, { detail });
  const mats = kit.materials;
  const seed = Number.isFinite(options.seed) ? options.seed : 4103;
  const random = kit.archRandom ? kit.archRandom(seed) : mulberry(seed);
  const solids = options.solids || buildOshioiFlashpointGeometry().solids;
  const mine = amiSolids(solids);

  const root = new THREE.Group();
  root.name = 'arch-site-ami';
  const sink = createZSink(THREE);
  const box3 = new THREE.Box3();
  /** kit 由来のオブジェクトを配置後の実測 Box3 で登録する。 */
  const registered = [];
  const place = (object3D, id, cls) => {
    object3D.updateMatrixWorld(true);
    box3.setFromObject(object3D);
    registered.push({
      id, cls,
      min: [box3.min.x, box3.min.y, box3.min.z],
      max: [box3.max.x, box3.max.y, box3.max.z],
    });
    root.add(object3D);
    return object3D;
  };

  /**
   * Y-up の arch_kit 語彙を Z-up world へ載せる。
   * `kit.mountZUp(obj, pos, yaw)` の yaw 経路は euler order を 'YXZ' に切り替えるため
   * 「ヨーを先に world Y 軸で掛ける」ことになり、物体が横倒しになる（実測済み）。
   * ここでは order を既定の 'XYZ' に保ったまま rotation.y にヨーを入れる。
   * R = RX(π/2)·RY(yaw) となり、ローカル +Y は world +Z のまま、ヨーは world Z 軸まわりになる。
   */
  const mount = (object3D, position, yawRad = 0) => {
    kit.mountZUp(object3D, position);
    if (yawRad) {
      object3D.rotation.order = 'XYZ';
      object3D.rotation.set(Math.PI / 2, yawRad, 0);
    }
    return object3D;
  };

  const box = (w, d, h) => new THREE.BoxGeometry(w, d, h);          // Z-up: 幅x・奥行y・高さz
  const post = (r, h, seg = 6) => {
    const g = new THREE.CylinderGeometry(r * 0.86, r, h, seg, 1, true);
    g.rotateX(Math.PI / 2);                                          // Y-up → Z-up
    return g;
  };

  const FLOOR = AMI_SITE.floorZ;
  const [CX0, CX1] = AMI_CANAL.xM;
  const [CY0, CY1] = AMI_CANAL.yM;
  const CANAL_W = CX1 - CX0;

  /* ---------------------------------------------------------------- *
   * 3.1 当たり判定 AABB を建築へ（arch_kit の「箱を包む」API）
   * ---------------------------------------------------------------- */
  const wrapped = kit.wrapSolids(mine, {
    siteId: 'ami',
    seed,
    detail,
    name: 'ami-wrapped-solids',
  });
  place(wrapped, 'ami-wrapped-solids', 'wrapped');

  /* ---------------------------------------------------------------- *
   * 3.2 運河 — 水面・護岸・曳舟道（すべて地物。高さ 0.35 m 以下）
   * ---------------------------------------------------------------- */
  const reaches = [
    { id: 'lower', y: [CY0, AMI_CANAL.lowerGateYM], z: AMI_WATER_LEVELS.lowerM, mat: mats.indigo },
    { id: 'chamber', y: AMI_CANAL.chamberYM, z: AMI_WATER_LEVELS.chamberM, mat: mats.shallow },
    { id: 'upper', y: [AMI_CANAL.upperGateYM, CY1], z: AMI_WATER_LEVELS.upperM, mat: mats.shallow },
  ];
  for (const reach of reaches) {
    const length = reach.y[1] - reach.y[0];
    sink.add(box(CANAL_W, length, 0.08), reach.mat, {
      position: [AMI_CANAL.centerXM, (reach.y[0] + reach.y[1]) / 2, reach.z - 0.04],
      shade: [0.9, 1.06],
      id: `ami-canal-water-${reach.id}`,
      cls: 'ground',
    });
  }
  // 護岸の縁石（両岸）。0.22 m の縁石なので遮蔽にならない。
  for (const [bankId, bx] of [['west', CX0 - 0.55], ['east', CX1 + 0.55]]) {
    sink.add(box(1.1, CY1 - CY0, 0.22), mats.stone, {
      position: [bx, (CY0 + CY1) / 2, FLOOR + 0.11],
      shade: [0.72, 1.0],
      id: `ami-canal-coping-${bankId}`,
      cls: 'ground',
    });
    // 目地（2.6 m ごとの暗い切れ目）→ 床が単色にならない（§3.6）
    for (let y = CY0 + 1.3; y < CY1; y += 2.6) {
      sink.add(box(1.18, 0.14, 0.24), mats.stoneJoint, {
        position: [bx, y, FLOOR + 0.12],
        shade: [0.6, 0.8],
        id: `ami-canal-joint-${bankId}`,
        cls: 'ground',
      });
    }
  }
  // 曳舟道の動線ライン（金の差し色。拠点へ向かう方向を示す）
  sink.add(box(0.4, CY1 - CY0, 0.05), mats.gold, {
    position: [CX1 + 1.6, (CY0 + CY1) / 2, FLOOR + 0.03],
    shade: [1.0, 1.12],
    id: 'ami-canal-towline',
    cls: 'ground',
  });
  // 堰（水位差の段差）— 各閘門の敷居
  for (const [sillId, sillY] of [['lower', AMI_CANAL.lowerGateYM], ['upper', AMI_CANAL.upperGateYM]]) {
    sink.add(box(CANAL_W + 2.2, 0.9, 0.26), mats.stone, {
      position: [AMI_CANAL.centerXM, sillY, FLOOR + 0.13],
      shade: [0.78, 1.02],
      id: `ami-canal-sill-${sillId}`,
      cls: 'ground',
    });
    sink.add(box(CANAL_W + 2.2, 0.14, 0.3), mats.gold, {
      position: [AMI_CANAL.centerXM, sillY + 0.38, FLOOR + 0.15],
      shade: [1.0, 1.14],
      id: `ami-canal-sill-mark-${sillId}`,
      cls: 'ground',
    });
  }

  /* ---------------------------------------------------------------- *
   * 3.3 巻上輪（3スケールで反復する単位モチーフ）
   * ---------------------------------------------------------------- */
  /**
   * @param {'x'|'y'} facing  輪の法線方向（世界軸）
   */
  const addWinchWheel = (center, radius, { facing = 'y', spokes = 8, id = 'ami-wheel', cls = 'overhead', teeth = true } = {}) => {
    const tube = Math.max(0.05, radius * 0.085);
    const radial = radius > 1.2 ? 6 : 5;
    const tubular = radius > 1.2 ? 20 : 12;
    const rim = new THREE.TorusGeometry(radius, tube, radial, tubular);
    rim.rotateX(Math.PI / 2);                       // XY 平面 → XZ 平面（法線 +Y）
    if (facing === 'x') rim.rotateZ(Math.PI / 2);   // → YZ 平面（法線 +X）
    sink.add(rim, mats.gold, { position: center, shade: [0.9, 1.12], id: `${id}-rim`, cls });
    const hub = post(radius * 0.14, radius * 0.34, 6);
    if (facing === 'y') hub.rotateX(Math.PI / 2); else hub.rotateY(Math.PI / 2);
    sink.add(hub, mats.timber, { position: center, shade: [0.55, 0.9], id: `${id}-hub`, cls });
    for (let i = 0; i < spokes; i++) {
      const a = (i / spokes) * Math.PI;
      const len = radius * 1.86;
      const geometry = facing === 'y'
        ? box(len, tube * 1.2, tube * 1.5)
        : box(tube * 1.2, len, tube * 1.5);
      sink.add(geometry, mats.timber, {
        position: center,
        rotation: facing === 'y' ? [0, a, 0] : [a, 0, 0],
        shade: [0.6, 0.98],
        id: `${id}-spoke`,
        cls,
      });
    }
    if (teeth) {
      const n = radius > 1.2 ? 16 : 10;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const ox = facing === 'y' ? Math.cos(a) * (radius + tube) : 0;
        const oy = facing === 'y' ? 0 : Math.cos(a) * (radius + tube);
        sink.add(box(tube * 1.7, tube * 1.7, tube * 1.7), mats.gold, {
          position: [center[0] + ox, center[1] + oy, center[2] + Math.sin(a) * (radius + tube)],
          shade: [1.0, 1.14],
          id: `${id}-tooth`,
          cls,
        });
      }
    }
  };

  /* ---------------------------------------------------------------- *
   * 3.4 閘門扉 — この区画の象徴。吊り上げ式の門扉を頭上に構える
   * ---------------------------------------------------------------- */
  const buildLockGate = (gateY, gateId) => {
    const HEAD_Z = 13.4;                 // 門枠の梁天端
    const LEAF_Z0 = 7.2; const LEAF_Z1 = 12.0;
    const bents = [
      { id: 'west', xs: [CX0 - 1.9, CX0 - 0.7] },
      { id: 'east', xs: [CX1 + 0.7, CX1 + 1.9] },
    ];
    for (const bent of bents) {
      for (const x of bent.xs) {
        // 脚は 0.46 角の細柱。プレイ帯では「柱」であって遮蔽ではない。
        sink.add(box(0.46, 0.46, HEAD_Z - FLOOR), mats.timber, {
          position: [x, gateY, FLOOR + (HEAD_Z - FLOOR) / 2],
          shade: [0.45, 1.0],
          id: `ami-lock-gate-${gateId}-leg`,
          cls: 'post',
        });
      }
      // 筋交いは頭上クリアランスより上でだけ入れる
      const [xa, xb] = bent.xs;
      for (let i = 0; i < 3; i++) {
        const z0 = 7.0 + i * 2.1;
        sink.add(box(Math.hypot(xb - xa, 2.1) + 0.2, 0.2, 0.2), mats.timber, {
          position: [(xa + xb) / 2, gateY, z0 + 1.05],
          rotation: [0, i % 2 ? Math.atan2(2.1, xb - xa) : -Math.atan2(2.1, xb - xa), 0],
          shade: [0.6, 1.0],
          id: `ami-lock-gate-${gateId}-brace`,
          cls: 'overhead',
        });
        sink.add(box(xb - xa + 0.4, 0.24, 0.24), mats.timber, {
          position: [(xa + xb) / 2, gateY, z0],
          shade: [0.6, 1.0],
          id: `ami-lock-gate-${gateId}-rung`,
          cls: 'overhead',
        });
      }
    }
    // 頭部の梁（2 本）と棟
    const headSpan = (CX1 + 1.9) - (CX0 - 1.9);
    for (const dy of [-0.65, 0.65]) {
      sink.add(box(headSpan + 0.8, 0.55, 1.0), mats.timber, {
        position: [AMI_CANAL.centerXM, gateY + dy, HEAD_Z - 0.5],
        shade: [0.86, 1.06],
        id: `ami-lock-gate-${gateId}-head`,
        cls: 'overhead',
      });
    }
    sink.add(box(headSpan + 1.4, 1.9, 0.3), mats.plasterShade, {
      position: [AMI_CANAL.centerXM, gateY, HEAD_Z + 0.15],
      shade: [1.0, 1.1],
      id: `ami-lock-gate-${gateId}-cap`,
      cls: 'overhead',
    });

    // --- 門扉本体（吊り上げられた状態）。板張り＋鉄帯＋曲面の冠。 ---
    const leafW = (CX1 + 0.5) - (CX0 - 0.5);
    const planks = 15;
    for (let i = 0; i < planks; i++) {
      const w = leafW / planks;
      sink.add(box(w - 0.05, 0.34, LEAF_Z1 - LEAF_Z0), mats.timber, {
        position: [CX0 - 0.5 + w * (i + 0.5), gateY, (LEAF_Z0 + LEAF_Z1) / 2],
        tint: [0.9 + (i % 3) * 0.06, 0.9 + (i % 3) * 0.06, 0.9 + (i % 3) * 0.06],
        shade: [0.55, 1.02],
        id: `ami-lock-gate-${gateId}-plank`,
        cls: 'overhead',
      });
    }
    for (const t of [0.14, 0.5, 0.86]) {
      sink.add(box(leafW + 0.16, 0.44, 0.3), mats.indigo, {
        position: [AMI_CANAL.centerXM, gateY, LEAF_Z0 + (LEAF_Z1 - LEAF_Z0) * t],
        shade: [0.8, 1.05],
        id: `ami-lock-gate-${gateId}-strap`,
        cls: 'overhead',
      });
    }
    // 曲面の冠（壁は直線・開口と屋根は曲線 §3.7）
    const outer = kit.archOutlinePoints({ width: leafW, height: 2.0, style: 'segmental', springRatio: 0.02, segments: 10 });
    const inner = kit.archOutlinePoints({ width: leafW - 0.9, height: 1.5, style: 'segmental', springRatio: 0.02, segments: 10 });
    const shape = new THREE.Shape();
    outer.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
    shape.closePath();
    const hole = new THREE.Path();
    inner.forEach(([x, y], i) => (i ? hole.lineTo(x, y + 0.1) : hole.moveTo(x, y + 0.1)));
    hole.closePath();
    shape.holes.push(hole);
    const crown = new THREE.ExtrudeGeometry(shape, { depth: 0.42, steps: 1, bevelEnabled: false });
    crown.rotateX(Math.PI / 2);                    // シェイプの +Y を世界 +Z へ
    sink.add(crown, mats.plaster, {
      position: [AMI_CANAL.centerXM, gateY + 0.21, LEAF_Z1 - 0.15],
      shade: [0.95, 1.12],
      id: `ami-lock-gate-${gateId}-crown`,
      cls: 'overhead',
    });

    // 釣合錘と鎖（水位差を動かす仕掛けの説明）
    for (const [side, x] of [['west', CX0 - 3.4], ['east', CX1 + 3.4]]) {
      sink.add(box(1.15, 1.15, 2.1), mats.stone, {
        position: [x, gateY, 8.0],
        shade: [0.7, 1.0],
        id: `ami-lock-gate-${gateId}-counterweight-${side}`,
        cls: 'overhead',
      });
      const chain = post(0.075, HEAD_Z - 9.05, 5);
      sink.add(chain, mats.gold, {
        position: [x, gateY, 9.05 + (HEAD_Z - 9.05) / 2],
        shade: [0.9, 1.1],
        id: `ami-lock-gate-${gateId}-chain`,
        cls: 'post',
      });
    }
    // 巻上輪（中スケール）を両側の梁下に
    addWinchWheel([CX0 - 1.3, gateY, 10.6], AMI_WINCH_WHEEL_SCALES.medium, {
      facing: 'y', id: `ami-lock-gate-${gateId}-wheel-w`,
    });
    addWinchWheel([CX1 + 1.3, gateY, 10.6], AMI_WINCH_WHEEL_SCALES.medium, {
      facing: 'y', id: `ami-lock-gate-${gateId}-wheel-e`,
    });
  };
  buildLockGate(AMI_CANAL.lowerGateYM, 'lower');
  buildLockGate(AMI_CANAL.upperGateYM, 'upper');

  /* ---------------------------------------------------------------- *
   * 3.5 潮位標 — 水位差を「読める」ものにする（網だけの計器）
   * ---------------------------------------------------------------- */
  for (const [staffId, sy, level] of [
    ['lower', AMI_CANAL.lowerGateYM - 2.4, AMI_WATER_LEVELS.lowerM],
    ['upper', AMI_CANAL.upperGateYM + 2.4, AMI_WATER_LEVELS.upperM],
  ]) {
    const sx = CX1 + 1.3;
    sink.add(box(0.52, 0.16, 7.4), mats.plaster, {
      position: [sx, sy, FLOOR + 3.7],
      shade: [0.6, 1.06],
      id: `ami-tide-staff-${staffId}-board`,
      cls: 'post',
    });
    for (let i = 0; i < 14; i++) {
      const z = FLOOR + 0.35 + i * 0.5;
      const major = i % 5 === 0;
      sink.add(box(major ? 0.5 : 0.3, 0.2, 0.07), major ? mats.gold : mats.indigo, {
        position: [sx - (major ? 0 : 0.1), sy, z],
        shade: [0.9, 1.12],
        id: `ami-tide-staff-${staffId}-mark`,
        cls: 'post',
      });
    }
    // 現在水位を示す指標（藍。上流と下流で高さが違う＝水位差そのもの）
    sink.add(box(0.72, 0.26, 0.12), mats.indigo, {
      position: [sx, sy, level + 0.2],
      shade: [1.0, 1.1],
      id: `ami-tide-staff-${staffId}-pointer`,
      cls: 'ground',
    });
  }

  /* ---------------------------------------------------------------- *
   * 3.6 網橋 ×2 — SSOT identity「二連網橋」。頭上を渡す＋吊り網
   * ---------------------------------------------------------------- */
  const buildNetBridge = (bridgeY, bridgeId) => {
    const DECK_Z = 9.6;
    const x0 = CX0 - 5.0; const x1 = CX1 + 3.5;
    const span = x1 - x0;
    sink.add(box(span, 3.0, 0.34), mats.timber, {
      position: [(x0 + x1) / 2, bridgeY, DECK_Z + 0.17],
      shade: [0.82, 1.04],
      id: `ami-net-bridge-${bridgeId}-deck`,
      cls: 'overhead',
    });
    // 桁は下弦を曲線に（アーチ）— 直線の壁体と対になる曲面（§3.7）
    const ribs = 11;
    for (let i = 0; i < ribs; i++) {
      const t = (i + 0.5) / ribs;
      const x = x0 + span * t;
      const sag = Math.sin(Math.PI * t) * 1.25;
      sink.add(box(span / ribs + 0.1, 0.3, 0.34 + sag), mats.timber, {
        position: [x, bridgeY, DECK_Z - (0.34 + sag) / 2],
        shade: [0.5, 0.92],
        id: `ami-net-bridge-${bridgeId}-rib`,
        cls: 'overhead',
      });
    }
    // 橋脚（細柱の四つ組）
    for (const px of [x0 + 0.9, x1 - 0.9]) {
      for (const dy of [-1.1, 1.1]) {
        for (const dx of [-0.55, 0.55]) {
          sink.add(box(0.34, 0.34, DECK_Z - FLOOR), mats.timber, {
            position: [px + dx, bridgeY + dy, FLOOR + (DECK_Z - FLOOR) / 2],
            shade: [0.42, 0.96],
            id: `ami-net-bridge-${bridgeId}-trestle`,
            cls: 'post',
          });
        }
      }
    }
    // 縄手すり（格子）
    for (const dy of [-1.5, 1.5]) {
      const rail = kit.createLatticeScreen({
        width: span, height: 1.25, columns: 22, rows: 3, barWidth: 0.055,
        pattern: 'grid', frame: true, detail, name: `ami-net-bridge-${bridgeId}-rail`,
      });
      kit.mountZUp(rail, [(x0 + x1) / 2, bridgeY + dy, DECK_Z + 0.34]);
      place(rail, `ami-net-bridge-${bridgeId}-rail`, 'overhead');
    }
    // 吊り網（橋から垂らす）。下端は頭上クリアランスより上。
    for (let i = 0; i < 3; i++) {
      const nx = x0 + span * (0.24 + i * 0.26);
      const net = kit.createLatticeScreen({
        width: 3.4, height: 3.0, columns: 9, rows: 8, barWidth: 0.05,
        pattern: 'grid', frame: false, detail, name: `ami-net-bridge-${bridgeId}-net`,
      });
      kit.mountZUp(net, [nx, bridgeY + 1.5, 6.5]);
      place(net, `ami-net-bridge-${bridgeId}-net`, 'overhead');
    }
  };
  buildNetBridge(41, 'south');
  buildNetBridge(58, 'north');

  /* ---------------------------------------------------------------- *
   * 3.7 網干し場 — 移動リング（survey §8-4 の 0.87 箱/1000m² の空白）を埋める
   * ---------------------------------------------------------------- */
  const buildDryingRow = (rowY, x0, x1, rowId, netRatio) => {
    const RAIL_Z = 8.3;
    const pitch = 4.4;
    const count = Math.max(2, Math.round((x1 - x0) / pitch) + 1);
    for (let i = 0; i < count; i++) {
      const x = x0 + ((x1 - x0) * i) / (count - 1);
      sink.add(box(0.32, 0.32, RAIL_Z - FLOOR), mats.timber, {
        position: [x, rowY, FLOOR + (RAIL_Z - FLOOR) / 2],
        shade: [0.42, 0.98],
        id: `ami-net-drying-yard-${rowId}-post`,
        cls: 'post',
      });
      // 方杖は頭上より上だけ
      for (const s of [-1, 1]) {
        sink.add(box(1.5, 0.2, 0.2), mats.timber, {
          position: [x + s * 0.6, rowY, RAIL_Z - 0.85],
          rotation: [0, s * 0.7, 0],
          shade: [0.6, 1.0],
          id: `ami-net-drying-yard-${rowId}-strut`,
          cls: 'overhead',
        });
      }
    }
    sink.add(box(x1 - x0 + 1.2, 0.26, 0.26), mats.timber, {
      position: [(x0 + x1) / 2, rowY, RAIL_Z],
      shade: [0.9, 1.04],
      id: `ami-net-drying-yard-${rowId}-rail`,
      cls: 'overhead',
    });
    for (let i = 0; i < count - 1; i++) {
      if (random() > netRatio) continue;
      const cx = x0 + ((x1 - x0) * (i + 0.5)) / (count - 1);
      const net = kit.createLatticeScreen({
        width: pitch - 0.8, height: 1.85, columns: 10, rows: 7, barWidth: 0.05,
        pattern: 'grid', frame: false, detail, name: `ami-net-drying-yard-${rowId}-net`,
      });
      kit.mountZUp(net, [cx, rowY, 6.4]);
      place(net, 'ami-net-drying-yard', 'overhead');
    }
  };
  buildDryingRow(65, -68, -42, 'ring-a', 0.7);
  buildDryingRow(70, -66, -44, 'ring-b', 0.55);
  buildDryingRow(31.5, -74, -62, 'south', 0.6);

  /* ---------------------------------------------------------------- *
   * 3.8 閘門小屋 — 中ランドマーク。歩ける tower 天面(z=8)の上 3.4 m から生やす
   * ---------------------------------------------------------------- */
  {
    const [LX, LY] = AMI_SITE.lockhouseM;
    const TOP = 8;                       // tower の天面（歩ける）
    const CABIN_Z = TOP + 3.4;           // クリアランス 3.4 m（>2.4 m）
    const CABIN_H = 4.3;
    for (const dx of [-2.35, 2.35]) {
      for (const dy of [-2.35, 2.35]) {
        sink.add(box(0.36, 0.36, CABIN_Z - TOP + 0.2), mats.timber, {
          position: [LX + dx, LY + dy, TOP + (CABIN_Z - TOP + 0.2) / 2],
          shade: [0.5, 1.0],
          id: 'ami-lockhouse-stilt',
          cls: 'post',
        });
      }
    }
    // 床版と回り縁（頭上なので塊でよい）
    sink.add(box(6.2, 6.2, 0.34), mats.stone, {
      position: [LX, LY, CABIN_Z - 0.17],
      shade: [0.72, 0.94],
      id: 'ami-lockhouse-floor',
      cls: 'overhead',
    });
    // 壁体は arch_kit の直線壁＋丸アーチ開口（ami の archStyle = 'round'）
    for (const [rot, ox, oy] of [
      [0, 0, 2.55], [Math.PI, 0, -2.55], [Math.PI / 2, 2.55, 0], [-Math.PI / 2, -2.55, 0],
    ]) {
      const wall = kit.createArchWall({
        width: 5.3, height: CABIN_H, thickness: 0.34, openings: 1,
        opening: { width: 2.0, height: 2.6, style: 'round' },
        style: 'round', sill: 0.9, band: true, detail,
        name: 'ami-lockhouse-wall',
      });
      mount(wall, [LX + ox, LY + oy, CABIN_Z], rot);
      place(wall, 'ami-lockhouse', 'overhead');
    }
    const roof = kit.createRoof({
      width: 5.6, depth: 5.6, height: 2.5, kind: 'gable', overhang: 0.75, ridgeCap: true,
      name: 'ami-lockhouse-roof',
    });
    kit.mountZUp(roof, [LX, LY, CABIN_Z + CABIN_H]);
    place(roof, 'ami-lockhouse', 'overhead');
    for (const [rot, ox, oy] of [[0, 0, 2.8], [Math.PI, 0, -2.8]]) {
      const eave = kit.createEave({
        width: 5.4, projection: 1.05, thickness: 0.15, drop: 0.36, brackets: 3,
        name: 'ami-lockhouse-eave',
      });
      mount(eave, [LX + ox, LY + oy, CABIN_Z + CABIN_H - 0.1], rot);
      place(eave, 'ami-lockhouse', 'overhead');
    }
    // 大巻上輪（3スケール反復の最大）
    addWinchWheel([LX, LY - 3.15, CABIN_Z + 2.2], AMI_WINCH_WHEEL_SCALES.large, {
      facing: 'y', spokes: 10, id: 'ami-lockhouse-great-wheel',
    });
    // 頂の灯（ami は西=藍）。どこからでも拠点が識別できるように
    const lantern = kit.createDome({
      radius: 1.0, height: 1.15, profile: 'shallow', drumHeight: 0.5, finial: true, detail,
      name: 'ami-lockhouse-lantern',
    });
    kit.mountZUp(lantern, [LX, LY, CABIN_Z + CABIN_H + 2.5]);
    place(lantern, 'ami-lockhouse', 'overhead');
    const beacon = new THREE.SphereGeometry(0.62, 10, 8);
    sink.add(beacon, mats.lampWest, {
      position: [LX, LY, CABIN_Z + CABIN_H + 4.9],
      shade: [1, 1],
      id: 'ami-lockhouse-beacon',
      cls: 'overhead',
    });
    sink.add(post(0.14, 2.2, 6), mats.gold, {
      position: [LX, LY, CABIN_Z + CABIN_H + 3.9],
      shade: [1, 1.12],
      id: 'ami-lockhouse-mast',
      cls: 'overhead',
    });
  }

  /* ---------------------------------------------------------------- *
   * 3.9 標柱 — 入口に背の高い要素と照明（進行方向を示す）
   * ---------------------------------------------------------------- */
  const APPROACHES = [
    { id: 'east-north', at: [-36.5, 54.5] },
    { id: 'east-south', at: [-36.5, 36.5] },
    { id: 'west-north', at: [-78.5, 50] },
    { id: 'west-south', at: [-78.5, 38] },
    { id: 'north', at: [-56, 62.5] },
    { id: 'south', at: [-56, 25.5] },
  ];
  for (const approach of APPROACHES) {
    const [mx, my] = approach.at;
    sink.add(post(0.19, 12.4, 7), mats.timber, {
      position: [mx, my, FLOOR + 6.2],
      shade: [0.42, 1.02],
      id: `ami-approach-masts-${approach.id}-shaft`,
      cls: 'post',
    });
    for (const z of [5.6, 8.4, 11.2]) {
      const ring = new THREE.TorusGeometry(0.3, 0.055, 5, 10);
      sink.add(ring, mats.gold, {
        position: [mx, my, z], shade: [1.0, 1.12],
        id: `ami-approach-masts-${approach.id}-ring`, cls: 'post',
      });
    }
    // 灯（藍）。プレイ帯にあるが球径 0.9 m → 細柱の規定内に収める
    sink.add(new THREE.SphereGeometry(0.44, 9, 7), mats.lampWest, {
      position: [mx, my, 9.6], shade: [1, 1],
      id: `ami-approach-masts-${approach.id}-lamp`, cls: 'post',
    });
    // 巻上輪（中スケール・小さめ）で「ここは網」と分かるようにする
    addWinchWheel([mx, my, 7.2], AMI_WINCH_WHEEL_SCALES.medium * 0.74, {
      facing: 'x', spokes: 6, id: `ami-approach-masts-${approach.id}-wheel`,
    });
    const lamp = kit.createLampPost({ height: 4.3, side: 'west', globeRadius: 0.3, detail, name: 'ami-approach-lamp' });
    kit.mountZUp(lamp, [mx + 2.4, my, FLOOR]);
    place(lamp, 'ami-approach-masts', 'post');
  }

  /* ---------------------------------------------------------------- *
   * 3.10 係船柱 — 小スケールの巻上輪を反復（部品を増やさず密度を上げる）
   * ---------------------------------------------------------------- */
  {
    let index = 0;
    for (let y = CY0 + 4; y <= CY1 - 4; y += 5.2) {
      const bx = CX1 + 2.5;
      sink.add(post(0.26, 0.62, 7), mats.stone, {
        position: [bx, y, FLOOR + 0.31], shade: [0.7, 1.0],
        id: 'ami-mooring-bollards-post', cls: 'post',
      });
      sink.add(new THREE.SphereGeometry(0.28, 7, 5), mats.stone, {
        position: [bx, y, FLOOR + 0.66], shade: [0.95, 1.05],
        id: 'ami-mooring-bollards-cap', cls: 'post',
      });
      if (index % 3 === 0) {
        addWinchWheel([CX0 - 2.5, y, FLOOR + 0.5], AMI_WINCH_WHEEL_SCALES.small, {
          facing: 'y', spokes: 6, teeth: false, id: 'ami-mooring-bollards-wheel', cls: 'post',
        });
      }
      index += 1;
    }
  }

  /* ---------------------------------------------------------------- *
   * 3.11 船溜まりの曲面護岸（曲線の担当。北端の転回場）
   * ---------------------------------------------------------------- */
  {
    const basin = kit.createCurvedTerrace({
      innerRadius: 5.4, outerRadius: 7.4, startAngleRad: -Math.PI * 0.98, endAngleRad: 0,
      height: 0.24, nosing: 0.08, detail, name: 'ami-turning-basin',
    });
    mount(basin, [AMI_CANAL.centerXM, CY1 - 1.5, FLOOR], Math.PI);
    place(basin, 'ami-turning-basin', 'ground');
  }

  /* ---------------------------------------------------------------- *
   * 3.12 石畳と動線ライン（床を単色にしない §3.6）
   * ---------------------------------------------------------------- */
  const APRONS = [
    { id: 'east', at: [-42, 44], size: [10, 22], lanes: [{ from: [-4.6, 0], to: [4.6, 0], width: 0.55 }] },
    { id: 'north', at: [-56, 58], size: [22, 8], lanes: [{ from: [0, -3.4], to: [0, 3.4], width: 0.55 }] },
    { id: 'south', at: [-56, 30.5], size: [22, 7], lanes: [{ from: [0, -3], to: [0, 3], width: 0.55 }] },
    { id: 'quay', at: [-63.4, 44], size: [4.2, 30], lanes: [{ from: [0, -13], to: [0, 13], width: 0.4 }] },
  ];
  for (const apron of APRONS) {
    const patch = kit.createPavingPatch({
      width: apron.size[0], depth: apron.size[1],
      tileSizeM: Math.max(1.6, Math.min(apron.size[0], apron.size[1]) / 3),
      joint: 0.1, lanes: apron.lanes, seed: seed + apron.id.length * 7,
      name: `ami-paving-aprons-${apron.id}`,
    });
    kit.mountZUp(patch, [apron.at[0], apron.at[1], FLOOR - 0.05]);
    place(patch, 'ami-paving-aprons', 'ground');
  }

  /* ---------------------------------------------------------------- *
   * 3.13 植生 — プレイ空間に疎、境界に密（§3.5）
   * ---------------------------------------------------------------- */
  const SPARSE_TREES = [[-72.5, 29.5], [-39.5, 29.5], [-39.5, 58.5], [-61, 24.5], [-49.5, 61.5], [-77.5, 60]];
  SPARSE_TREES.forEach(([tx, ty], i) => {
    const tree = kit.createTree({
      height: 4.6 + (i % 3) * 0.9, crownRadius: 1.5 + (i % 2) * 0.35,
      kind: i % 3 === 0 ? 'pine' : 'broadleaf', seed: seed + 11 * i, detail,
      name: 'ami-planting-tree',
    });
    kit.mountZUp(tree, [tx, ty, FLOOR]);
    place(tree, 'ami-planting', 'foliage');
  });
  for (let i = 0; i < 7; i++) {
    const bed = kit.createPlantingBed({
      width: 7.5, depth: 3.6, count: 5, kinds: ['broadleaf', 'pine'],
      treeHeightM: [3.6, 6.2], curb: true, seed: seed + 97 + i * 13, detail,
      name: 'ami-planting-bed',
    });
    const bx = i < 4 ? -84 - (i % 2) * 5 : -70 + (i - 4) * 11;
    const by = i < 4 ? 26 + i * 13 : 78 + (i % 2) * 5;
    mount(bed, [bx, by, FLOOR], (i * 0.7) % Math.PI);
    place(bed, 'ami-planting', 'foliage');
  }

  /* ---------------------------------------------------------------- *
   * 3.14 遠景 — 運河沿いの倉庫街（境界外のみ。層3・4）
   * ---------------------------------------------------------------- */
  if (options.farDistrict !== false) {
    // 競技境界 x[-126,126] y[-92,92] の **外側だけ**。内側に置くと偽の遮蔽になる。
    // 運河がこの街を抜けて続いている、という読みにするため水路の延長線上に並べる。
    const FAR = [
      ['block', -142, 22, 16, 13, 18], ['tower', -148, 40, 12, 12, 29],
      ['block', -144, 56, 17, 14, 21], ['tower', -156, 68, 13, 13, 33],
      ['block', -145, 82, 15, 13, 17], ['ridge', -158, 48, 26, 30, 24],
      ['crag', -160, 18, 22, 20, 20], ['crag', -152, 108, 19, 18, 18],
      ['block', -88, 110, 16, 13, 19], ['tower', -70, 114, 13, 13, 26],
      ['block', -52, 108, 15, 12, 16], ['tower', -108, 122, 12, 12, 30],
      ['block', -134, 110, 16, 13, 20], ['ridge', -96, 120, 30, 22, 21],
    ];
    for (let i = 0; i < FAR.length; i++) {
      const [kind, fx, fy, w, d, h] = FAR[i];
      const mass = kit.createSilhouetteMass({
        kind, width: w, depth: d, height: h, seed: seed + 200 + i * 17, name: 'ami-far-district',
      });
      mount(mass, [fx, fy, 0], (i * 0.41) % Math.PI);
      place(mass, 'ami-far-district', 'outside');
    }
  }

  /* ---------------------------------------------------------------- *
   * 4. 焼き込み・登録・マージ
   * ---------------------------------------------------------------- */
  const custom = bakeZParts(THREE, sink.parts, 'ami-custom', kit.markDecorative);
  root.add(custom);

  const elements = [...sink.elements, ...registered];
  kit.markDecorative(root);
  root.userData.siteId = 'ami';
  root.userData.archVocabulary = 'siteAmi';
  root.userData.amiElements = elements;
  root.userData.amiStructures = AMI_UNIQUE_STRUCTURES.map(entry => entry.id);
  root.userData.amiWaterLevels = { ...AMI_WATER_LEVELS };

  if (options.merge !== false) kit.mergeArchRoot(root);
  return root;
}

/* ------------------------------------------------------------------ *
 * 5. 検査 — 「遮蔽に見える塊」が当たり判定の無い場所に無いことの実測
 * ------------------------------------------------------------------ */

function insideFootprint(element, footprint, epsilon = 0.02) {
  return element.min[0] >= footprint.min[0] - epsilon
    && element.max[0] <= footprint.max[0] + epsilon
    && element.min[1] >= footprint.min[1] - epsilon
    && element.max[1] <= footprint.max[1] + epsilon;
}

/**
 * 生成済みの ami 建築（`root.userData.amiElements`）を実測 AABB で検査する。
 *
 * 違反 = 「プレイ帯（床〜床+2.2 m）に、当たり判定の無い不透明な塊がある」。
 * 免除されるのは 地物(≤0.35 m) / 細柱(水平断面 ≤0.6 m) / 植生 / 当たり判定内 / 境界外。
 *
 * @returns {{checked:number, violations:Array, walkableIntrusions:Array}}
 */
export function auditAmiOcclusion(root, solids = null, options = {}) {
  const elements = root?.userData?.amiElements || [];
  const footprints = amiCollisionFootprints(solids);
  const floorZ = options.floorZ ?? AMI_SITE.floorZ;
  const clearance = options.clearanceM ?? AMI_PLAY_CLEARANCE_M;
  const [px0, px1] = AMI_SITE.playableBoundsM.x;
  const [py0, py1] = AMI_SITE.playableBoundsM.y;
  const violations = [];
  const walkableIntrusions = [];
  let checked = 0;

  const walkableTops = footprints
    .filter(f => ['tower', 'stair', 'rim', 'slab', 'ground'].includes(f.tag))
    .filter(f => f.max[2] > floorZ + 0.5);

  for (const element of elements) {
    if (element.cls === 'wrapped' || element.cls === 'foliage') continue;
    // 競技境界の外は借景。§3.1 の層3・4。
    const outsideBounds = element.max[0] < px0 || element.min[0] > px1
      || element.max[1] < py0 || element.min[1] > py1;
    if (outsideBounds) continue;
    checked += 1;

    const sizeX = element.max[0] - element.min[0];
    const sizeY = element.max[1] - element.min[1];
    const heightAboveFloor = element.max[2] - floorZ;

    // 頭上に完全に逃げている（近景シルエット層）
    const overhead = element.min[2] >= floorZ + clearance - 1e-6;
    const groundFurniture = heightAboveFloor <= AMI_GROUND_FURNITURE_M + 1e-6;
    const slender = Math.max(sizeX, sizeY) <= AMI_SLENDER_POST_M + 1e-6;
    const covered = footprints.some(f => insideFootprint(element, f));

    if (!(overhead || groundFurniture || slender || covered)) {
      violations.push({
        id: element.id,
        cls: element.cls,
        sizeM: [Number(sizeX.toFixed(3)), Number(sizeY.toFixed(3))],
        zM: [Number(element.min[2].toFixed(3)), Number(element.max[2].toFixed(3))],
      });
    }

    // 歩ける天面の直上に塊を置いていないか（クリップ防止）
    if (!slender) {
      for (const top of walkableTops) {
        const overlaps = element.min[0] < top.max[0] && element.max[0] > top.min[0]
          && element.min[1] < top.max[1] && element.max[1] > top.min[1];
        if (!overlaps) continue;
        if (element.max[2] <= top.max[2] + 1e-6) continue;
        if (element.min[2] < top.max[2] + AMI_WALKABLE_CLEARANCE_M - 1e-6) {
          walkableIntrusions.push({
            id: element.id,
            over: top.id,
            clearanceM: Number((element.min[2] - top.max[2]).toFixed(3)),
          });
        }
      }
    }
  }
  return { checked, violations, walkableIntrusions };
}

/** 奥行き4層（ARCH_BRIEF §3.1）の充填状況を実測する。 */
export function auditAmiDepthLayers(root) {
  const elements = root?.userData?.amiElements || [];
  const floorZ = AMI_SITE.floorZ;
  const layers = { play: 0, near: 0, city: 0, frame: 0 };
  for (const element of elements) {
    const top = element.max[2] - floorZ;
    if (top <= 6) layers.play += 1;
    else if (top <= 25) layers.near += 1;
    else if (top <= 80) layers.city += 1;
    else layers.frame += 1;
  }
  return layers;
}

function mulberry(seed) {
  let state = (Math.floor(seed) || 1) >>> 0;
  return function next() {
    state |= 0; state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export default buildAmiArchitecture;
