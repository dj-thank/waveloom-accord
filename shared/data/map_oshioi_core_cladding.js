// 大潮井 中央コア — 旧来 canonical-* ソリッドの被覆（担当 C）
//
// 旧来の中央コア（92x68m、canonical-* 175個、密度24.77でマップ最高）は、
// 被覆が主要12箱＋回廊20箱しか無く、残りは素の当たり判定の箱として描かれていた。
// ここは制圧点＝最も戦闘が起き、最も見られる場所である。
//
// 設計書§12の世界観をここで実装する:
//   貝灰漆喰の白い集会堂 / 段丘状の市場 / 色ガラスの浮き玉灯籠 /
//   渡り石の参道 / 掘り下げボウルの目標
//
// 安全規則（tests/map_site_cladding.test.js が強制。緩めない）:
//   1. 当たり判定は一切変更しない。ここは描画専用データである。
//   2. すべての被覆は宿主 solid の XY footprint 内（許容0.35m）。本ファイルは
//      自前の guard で 0.30m に締めて、テストの許容に 0.05m の余裕を残す。
//   3. 宿主上端 +0.05m より高く伸びてよいのは XY 0.8m 以下の細い垂直要素だけ。
//   4. rotation[0]（ピッチ）は使わない。全要素が軸並行なので rotation は常に [0,0,0]。
//
// 循環importの回避:
//   map_oshioi.js → presentation.js → 本ファイル、の順で読まれる。
//   したがって map_oshioi.js を import できない。canonical-* の座標は
//   map_oshioi.js の buildMap() と同一の構築コードをここに写して再現する。
//   （site_cladding.js が SHIOGAMA_HOSTS / CORE_HOSTS_HALF で宿主を書き下しているのと同じ方針。
//     値がずれれば containment テストが即座に落ちるので、黙って嘘にはならない。）
//   flashpoint_geometry は import してよいので、削除される canonical id はそこから取る。

import { buildOshioiFlashpointGeometry } from './map_oshioi_flashpoint_geometry.js';

// ---------------------------------------------------------------------------
// 1. canonical-* の再現（map_oshioi.js buildMap() と同一の構築順）
// ---------------------------------------------------------------------------

function bx(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], tag };
}

function rot(b) {
  return {
    min: [-b.max[0], -b.max[1], b.min[2]],
    max: [-b.min[0], -b.min[1], b.max[2]],
    tag: b.tag,
  };
}

function stairs(axis, a0, a1, c0, c1, z0, z1, steps, tag = 'stair') {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    const top = z0 + ((z1 - z0) * (i + 1)) / steps;
    const minZ = Math.min(0, top);
    const maxZ = Math.max(0, top);
    if (!(minZ < maxZ)) continue;
    if (axis === 'x') out.push(bx(Math.min(t0, t1), c0, minZ, Math.max(t0, t1), c1, maxZ, tag));
    else out.push(bx(c0, Math.min(t0, t1), minZ, c1, Math.max(t0, t1), maxZ, tag));
  }
  return out;
}

function buildCanonicalSolids() {
  const S = [];
  S.push(bx(-46, -34, -1, 46, 34, 0, 'ground'));
  S.push(bx(-47, -34, 0, -46, 34, 10, 'wall'));
  S.push(bx(46, -34, 0, 47, 34, 10, 'wall'));
  S.push(bx(-47, -35, 0, 47, -34, 10, 'wall'));
  S.push(bx(-47, 34, 0, 47, 35, 10, 'wall'));

  S.push(bx(8, -22, 0, 32, 22, 4, 'slab'));
  S.push(bx(-32, -22, 0, -8, 22, 4, 'slab'));
  S.push(bx(-8, 6, 0, 8, 22, 4, 'slab'));
  S.push(bx(-8, -22, 0, 8, -6, 4, 'slab'));

  S.push(bx(-6, -6, 0, 6, 6, 2.5, 'slab'));
  S.push(bx(6, 1.5, 0, 8, 6, 4, 'rim'));
  S.push(bx(6, -6, 0, 8, -1.5, 4, 'rim'));
  const eastBowlStairs = stairs('x', 6, 8, -1.5, 1.5, 2.5, 4.0, 3);
  S.push(...eastBowlStairs);
  S.push(bx(-8, 1.5, 0, -6, 6, 4, 'rim'));
  S.push(bx(-8, -6, 0, -6, -1.5, 4, 'rim'));
  S.push(...eastBowlStairs.map(rot));
  const northBowlStairs = stairs('y', 4, 6, -1.5, 1.5, 2.5, 4.0, 3);
  S.push(...northBowlStairs, ...northBowlStairs.map(rot));

  S.push(bx(-1.25, -1.25, 2.5, 1.25, 1.25, 5.0, 'cover'));
  for (const [px, py] of [[3.6, 3.6], [-3.6, 3.6], [3.6, -3.6], [-3.6, -3.6]]) {
    S.push(bx(px - 0.4, py - 0.4, 2.5, px + 0.4, py + 0.4, 3.7, 'cover'));
  }

  const eastSide = [];
  eastSide.push(bx(38, -8, 0, 46, 8, 4, 'slab'));
  eastSide.push(bx(38, -8, 4, 38.6, -2, 8, 'spawnwall'));
  eastSide.push(bx(38, 2, 4, 38.6, 8, 8, 'spawnwall'));
  eastSide.push(bx(38, 8, 4, 40, 8.6, 8, 'spawnwall'));
  eastSide.push(bx(43, 8, 4, 46, 8.6, 8, 'spawnwall'));
  eastSide.push(bx(38, -8.6, 4, 40, -8, 8, 'spawnwall'));
  eastSide.push(bx(43, -8.6, 4, 46, -8, 8, 'spawnwall'));
  eastSide.push(bx(32, -3, 0, 38, 3, 4, 'slab'));
  eastSide.push(bx(32, 2.7, 4, 38, 3, 4.8, 'wall'));
  eastSide.push(bx(32, -3, 4, 38, -2.7, 4.8, 'wall'));
  eastSide.push(bx(40, 8, 0, 43, 20, 4, 'slab'));
  eastSide.push(bx(40, 8, 4, 40.3, 20, 4.8, 'wall'));
  eastSide.push(bx(42.7, 8, 4, 43, 20, 4.8, 'wall'));
  eastSide.push(...stairs('y', -8, -13, 40, 43, 4.0, 0.0, 8));
  for (const b of eastSide) { S.push(b); S.push(rot(b)); }

  const north = [];
  north.push(bx(-43, 20, 0, 43, 26, 4, 'slab'));
  north.push(bx(-43, 26, 4, -16, 26.6, 7, 'wall'));
  north.push(bx(-12, 26, 4, 43, 26.6, 7, 'wall'));
  for (let x = -40; x < 40; x += 8) north.push(bx(x, 20, 4, x + 5, 20.4, 6.2, 'wall'));
  for (const b of north) { S.push(b); S.push(rot(b)); }

  const sstair = stairs('y', -30, -26, 12, 16, 0.0, 4.0, 8);
  for (const b of sstair) { S.push(b); S.push(rot(b)); }
  const shallowsConnector = stairs('x', 38, 32, -19.5, -16.5, 0.0, 4.0, 8);
  for (const b of shallowsConnector) { S.push(b); S.push(rot(b)); }

  const towerN = [];
  towerN.push(bx(-3, 10, 4, 3, 16, 8, 'tower'));
  towerN.push(bx(-3, 15.7, 8, 3, 16, 9, 'wall'));
  towerN.push(bx(-3, 10, 8, -2.7, 16, 9, 'wall'));
  towerN.push(bx(-3, 10, 8, 3, 10.3, 9, 'wall'));
  towerN.push(...stairs('x', 7, 3, 12, 14, 4.0, 8.0, 8));
  for (const b of towerN) { S.push(b); S.push(rot(b)); }

  const covers = [];
  covers.push(bx(19.2, -0.8, 4, 20.8, 0.8, 9, 'cover'));
  covers.push(bx(13.4, 7.4, 4, 14.9, 8.9, 5.5, 'cover'));
  covers.push(bx(25.4, -12.6, 4, 26.9, -11.1, 5.5, 'cover'));
  covers.push(bx(11.0, -14.8, 4, 12.5, -13.3, 5.5, 'cover'));
  covers.push(bx(28.0, 10.0, 4, 29.5, 11.5, 5.5, 'cover'));
  covers.push(bx(27.0, 2.5, 4, 29.0, 4.5, 6.4, 'cover'));
  covers.push(bx(12.2, -0.6, 4, 14.2, 0.8, 6.4, 'cover'));
  covers.push(bx(35.5, 21.8, 4, 37.5, 23.8, 6.4, 'cover'));
  covers.push(bx(21.0, 11.5, 4, 23.0, 13.5, 6.4, 'cover'));
  for (const b of covers) { S.push(b); S.push(rot(b)); }

  const rocks = [];
  rocks.push(bx(33, -15, 0, 35, -13, 1.6, 'cover'));
  rocks.push(bx(17, -29, 0, 19, -27, 1.6, 'cover'));
  rocks.push(bx(-1, 29, 0, 1, 31, 1.6, 'cover'));
  for (const b of rocks) { S.push(b); S.push(rot(b)); }

  const removed = new Set(buildOshioiFlashpointGeometry().removeCanonicalSolidIds || []);
  return S
    .map((solid, index) => ({
      id: `canonical-${String(index + 1).padStart(3, '0')}-${solid.tag}`,
      min: solid.min,
      max: solid.max,
      tag: solid.tag,
    }))
    .filter(solid => !removed.has(solid.id));
}

const CANONICAL = buildCanonicalSolids();
const byId = new Map(CANONICAL.map(solid => [solid.id, solid]));
const get = id => {
  const solid = byId.get(id);
  if (!solid) throw new Error(`core cladding: unknown canonical solid ${id}`);
  return solid;
};
const withTag = tag => CANONICAL.filter(solid => solid.tag === tag);

// ---------------------------------------------------------------------------
// 2. 層と guard
// ---------------------------------------------------------------------------

// 8層。PLAN.md §2-2 の C 割当（層 +8 / インスタンス +3,000 / 三角形 +90,000）を守る。
const LAYER_SPECS = [
  ['core-plinth', 'box', 'basalt'],        // 基壇・沓石・暗い足元
  ['core-string', 'box', 'shellShade'],    // 水平線・笠石・段丘の縁・渡り石
  ['core-pilaster', 'box', 'shell'],       // 付柱・柱・欄干子・灯柱の胴（貝灰漆喰）
  ['core-window', 'box', 'windowGlow'],    // 色ガラスの窓・浮き玉灯籠の光
  ['core-arch', 'archWall', 'shellShade'], // 半円アーチの開口（市場段丘のアーケード）
  // 旧: ['core-gate','archGate','copperPlaster']。
  // 尖頭アーチ 60 個（うち 50 個が中央制圧点の回廊と櫓の門）は、白漆喰の大質量＋
  // 金の円錐頂華＋暖色の砂の広場と同時に置くと実在文化の様式として読まれうる。
  // 設計書§12・§15 は尖頭アーチを一度も要求していないので、半円アーチへ置換する。
  ['core-gate', 'archWall', 'copperPlaster'], // 半円アーチの門（回廊と櫓）
  ['core-fixture', 'box', 'cedar'],        // 潮汲みの装置・腕木・梁・桶
  ['core-crown', 'spire', 'copper'],       // 頂部（宿主上端より上は XY 0.8m 以下）
  // 設計書§12「色ガラスの浮き玉灯籠が軒先とロープに連なり」。
  // 実装は箱の窓ばかりで、球状の浮き玉は 23 個しか無く「連なる」連続体が無かった。
  // 併せて、プレイ領域内の 6〜14m 帯（原則1の第2層）が 14.8% しかないという
  // 指摘にもここで応える。dodecaLow は36三角形と安い。
  ['core-lantern', 'dodecaLow', 'windowGlow'],
];

const OUT_LIMIT = 0.30;   // 宿主 footprint からの張り出し上限（テスト許容0.35に0.05の余裕）
const RISE_EPS = 0.05;    // テストと同じ「宿主上端を超えた」判定閾値
const THIN = 0.8;         // 宿主より高く伸びてよい XY の上限

const buckets = new Map(LAYER_SPECS.map(([id]) => [id, []]));

function emit(key, host, position, scale) {
  const bucket = buckets.get(key);
  if (!bucket) throw new Error(`core cladding: unknown layer ${key}`);
  const [x, y, z] = position;
  const [sx, sy, sz] = scale;
  if (!(sx > 0 && sy > 0 && sz > 0)) throw new Error(`core cladding: ${key} non-positive scale`);
  // 宿主からのはみ出しは例外にせず、宿主の footprint へ切り詰める。
  // canonical-* には厚さ0.4mの薄い外周壁も含まれ、厚い壁向けの寸法をそのまま
  // 載せると 56 箇所がはみ出してビルドごと落ちていた。切り詰めれば
  // 「宿主 XY footprint 内」という安全規則を満たしたまま部品を残せる。
  const lo0 = host.min[0] - OUT_LIMIT;
  const hi0 = host.max[0] + OUT_LIMIT;
  const lo1 = host.min[1] - OUT_LIMIT;
  const hi1 = host.max[1] + OUT_LIMIT;
  const x0 = Math.max(x - sx / 2, lo0);
  const x1 = Math.min(x + sx / 2, hi0);
  const y0 = Math.max(y - sy / 2, lo1);
  const y1 = Math.min(y + sy / 2, hi1);
  // 切り詰めた結果つぶれる部品は落とす（0.05m未満は見えない）。
  if (!(x1 - x0 > 0.05 && y1 - y0 > 0.05)) return;
  let fx = x1 - x0;
  let fy = y1 - y0;
  const fcx = (x0 + x1) / 2;
  const fcy = (y0 + y1) / 2;
  // 宿主より高く伸びる要素は XY 0.8m 以下でなければならない（安全規則3）。
  // 切り詰めても太い場合は、上端を宿主に合わせて下げる方を採る。
  let fz = z;
  let fsz = sz;
  if (z + sz / 2 > host.max[2] + RISE_EPS && Math.max(fx, fy) > THIN + 1e-9) {
    const top = host.max[2];
    const bottom = Math.min(z - sz / 2, top - 0.05);
    fsz = top - bottom;
    fz = (top + bottom) / 2;
  }
  if (!(fsz > 0.02)) return;
  bucket.push({ position: [fcx, fcy, fz], scale: [fx, fy, fsz], rotation: [0, 0, 0] });
}

const cx = h => (h.min[0] + h.max[0]) / 2;
const cy = h => (h.min[1] + h.max[1]) / 2;
const wOf = h => h.max[0] - h.min[0];
const dOf = h => h.max[1] - h.min[1];

// 宿主を一周する水平帯。1インスタンスで塊を「階を持つ建物」に変える最小構成。
function band(host, key, z0, z1, out) {
  emit(key, host, [cx(host), cy(host), (z0 + z1) / 2],
    [wOf(host) + out * 2, dOf(host) + out * 2, z1 - z0]);
}

// 天面に載せる板（上端が宿主上端 +0.05 を超えないので幅制限なし）。
function cap(host, key, out, thickness = 0.12) {
  emit(key, host, [cx(host), cy(host), host.max[2] - thickness / 2 + 0.02],
    [wOf(host) + out * 2, dOf(host) + out * 2, thickness]);
}

// 指定した面に沿って count 個を等間隔に並べる。face: '+x' '-x' '+y' '-y'
function faceRun(host, key, face, count, opts) {
  const { along = 0.6, thick = 0.4, z0, z1, out = 0.12, skip = null, margin = 0.6 } = opts;
  const alongX = face === '+y' || face === '-y';
  const a0 = (alongX ? host.min[0] : host.min[1]) + margin;
  const a1 = (alongX ? host.max[0] : host.max[1]) - margin;
  if (a1 - a0 <= 0 || count <= 0) return;
  for (let i = 0; i < count; i++) {
    if (typeof skip === 'function' && skip(i)) continue;
    const a = a0 + (a1 - a0) * (count === 1 ? 0.5 : i / (count - 1));
    const edge = face === '+x' ? host.max[0] : face === '-x' ? host.min[0]
      : face === '+y' ? host.max[1] : host.min[1];
    const sign = (face === '+x' || face === '+y') ? 1 : -1;
    const n = edge + sign * (out - thick / 2);
    emit(key, host,
      alongX ? [a, n, (z0 + z1) / 2] : [n, a, (z0 + z1) / 2],
      alongX ? [along, thick, z1 - z0] : [thick, along, z1 - z0]);
  }
}

// 決定論的な擬似乱数（反復を崩すため。実行ごとに同じ値になる）
function noise(n) {
  const v = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
}

// ---------------------------------------------------------------------------
// 3. 渡り石の参道（canonical-001-ground。上端 0.0 なので板は z<=0.05 に収める）
// ---------------------------------------------------------------------------

const GROUND = get('canonical-001-ground');
const STONE_Z = -0.04;

const APPROACH_PATHS = [
  [[41, -13.5], [43, -21], [38.5, -27.5], [29, -30], [17, -31.2], [3, -32], [-13, -31.4]],
  [[34.5, -15.5], [30, -21], [24.5, -26.5]],
  [[44.5, -23], [44.5, -31]],
];

let stoneSeed = 0;
for (const path of APPROACH_PATHS) {
  for (let seg = 1; seg < path.length; seg++) {
    const [ax, ay] = path[seg - 1];
    const [bxp, byp] = path[seg];
    const dx = bxp - ax;
    const dy = byp - ay;
    const len = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.round(len / 2.6));
    const nx = -dy / len;
    const ny = dx / len;
    for (let i = 0; i < steps; i++) {
      const tt = (i + 0.5) / steps;
      const px = ax + dx * tt;
      const py = ay + dy * tt;
      stoneSeed += 1;
      const r = noise(stoneSeed);
      const size = 1.5 + r * 1.5;                 // 1.5〜3.0m の5段階に散る渡り石
      const lateral = (noise(stoneSeed * 3.7) - 0.5) * 1.1;
      for (const s of [1, -1]) {                  // 180度回転対称
        emit('core-string', GROUND,
          [s * (px + nx * lateral), s * (py + ny * lateral), STONE_Z],
          [size, size * (0.7 + noise(stoneSeed * 5.3) * 0.5), 0.1]);
        if (r > 0.55) {
          emit('core-plinth', GROUND,
            [s * (px - nx * (1.4 + r)), s * (py - ny * (1.4 + r)), STONE_Z - 0.01],
            [1.0 + r * 0.8, 1.0 + r * 0.6, 0.08]);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 4. 外周壁（canonical-004/005）— 貝灰漆喰の白い集会堂の外郭
// ---------------------------------------------------------------------------

for (const id of ['canonical-004-wall', 'canonical-005-wall']) {
  const h = get(id);
  band(h, 'core-plinth', 0.0, 0.85, 0.26);
  band(h, 'core-string', 3.95, 4.4, 0.2);
  band(h, 'core-string', 6.9, 7.3, 0.14);
  band(h, 'core-string', 9.35, 10.0, 0.3);
  const face = id === 'canonical-004-wall' ? '+y' : '-y';
  const back = id === 'canonical-004-wall' ? '-y' : '+y';
  faceRun(h, 'core-pilaster', face, 15, { along: 0.95, thick: 1.5, z0: 0.85, z1: 9.35, out: 0.28 });
  faceRun(h, 'core-pilaster', back, 8, { along: 0.8, thick: 1.2, z0: 0.85, z1: 9.35, out: 0.22 });
  // 半円アーチの列（開口。板の模様ではなく本物の穴）
  faceRun(h, 'core-arch', face, 8, { along: 6.0, thick: 1.3, z0: 1.0, z1: 6.2, out: 0.26 });
  faceRun(h, 'core-window', face, 8, { along: 2.0, thick: 0.2, z0: 2.2, z1: 5.0, out: 0.12 });
  // 腕木（軒を受ける材。縦の反復を横に割る）
  faceRun(h, 'core-fixture', face, 23, { along: 0.44, thick: 1.3, z0: 9.0, z1: 9.35, out: 0.3 });
}

// ---------------------------------------------------------------------------
// 5. 段丘状の市場（canonical-006/007 大スラブ、008/009 帯、072/073 回廊床）
// ---------------------------------------------------------------------------

function terraceSlab(h, opts) {
  const { longFaces, shortFaces, arches = 0, archFaces = [], gates = 0, gateFaces = [] } = opts;
  band(h, 'core-plinth', 0.0, 0.6, 0.24);
  band(h, 'core-string', 1.85, 2.15, 0.13);
  band(h, 'core-string', 3.5, 4.0, 0.28);
  for (const face of longFaces) {
    faceRun(h, 'core-pilaster', face, opts.longCount, { along: 0.85, thick: 1.0, z0: 0.6, z1: 3.5, out: 0.24 });
    faceRun(h, 'core-fixture', face, opts.longCount * 2, { along: 0.34, thick: 0.9, z0: 3.2, z1: 3.5, out: 0.3 });
  }
  for (const face of shortFaces) {
    faceRun(h, 'core-pilaster', face, opts.shortCount, { along: 0.8, thick: 1.0, z0: 0.6, z1: 3.5, out: 0.24 });
  }
  for (const face of archFaces) {
    faceRun(h, 'core-arch', face, arches, { along: 5.6, thick: 1.1, z0: 0.5, z1: 3.55, out: 0.24 });
    faceRun(h, 'core-window', face, arches, { along: 1.8, thick: 0.18, z0: 1.2, z1: 2.9, out: 0.1 });
  }
  for (const face of gateFaces) {
    faceRun(h, 'core-gate', face, gates, { along: 3.4, thick: 0.9, z0: 0.5, z1: 3.55, out: 0.2 });
  }
}

for (const id of ['canonical-006-slab', 'canonical-007-slab']) {
  const h = get(id);
  const inner = id === 'canonical-006-slab' ? '-x' : '+x';
  const outer = id === 'canonical-006-slab' ? '+x' : '-x';
  terraceSlab(h, {
    longFaces: [inner, outer], shortFaces: ['+y', '-y'],
    longCount: 8, shortCount: 4,
    arches: 6, archFaces: [inner, outer],
    gates: 2, gateFaces: ['+y', '-y'],
  });
  // 段丘の縁の歩廊（天面。上端 4.02 なので幅制限なし）
  for (const s of [1, -1]) {
    emit('core-string', h, [cx(h) + s * (wOf(h) / 2 - 1.5), cy(h), 3.97],
      [2.6, dOf(h) - 1.2, 0.1]);
  }
  emit('core-plinth', h, [cx(h), cy(h), 3.96], [wOf(h) - 7.0, dOf(h) - 6.0, 0.08]);
}

// 北帯・南帯（ボウルの内壁を兼ねる。z 2.5〜4.0 だけが見える）
for (const id of ['canonical-008-slab', 'canonical-009-slab']) {
  const h = get(id);
  const bowlFace = id === 'canonical-008-slab' ? '-y' : '+y';
  const outFace = id === 'canonical-008-slab' ? '+y' : '-y';
  band(h, 'core-plinth', 0.0, 0.6, 0.22);
  band(h, 'core-string', 2.55, 2.85, 0.16);
  band(h, 'core-string', 3.05, 3.3, 0.16);
  band(h, 'core-string', 3.55, 4.0, 0.26);
  // ボウル側は目標から常に見える面。灯籠の壁龕を並べる。
  faceRun(h, 'core-pilaster', bowlFace, 6, { along: 0.7, thick: 0.8, z0: 2.6, z1: 3.55, out: 0.24 });
  faceRun(h, 'core-window', bowlFace, 5, { along: 1.0, thick: 0.24, z0: 2.9, z1: 3.5, out: 0.18 });
  faceRun(h, 'core-gate', bowlFace, 3, { along: 2.4, thick: 0.7, z0: 2.55, z1: 3.95, out: 0.18 });
  faceRun(h, 'core-pilaster', '+x', 5, { along: 0.8, thick: 1.0, z0: 0.6, z1: 3.55, out: 0.22 });
  faceRun(h, 'core-pilaster', '-x', 5, { along: 0.8, thick: 1.0, z0: 0.6, z1: 3.55, out: 0.22 });
  faceRun(h, 'core-arch', outFace, 3, { along: 4.4, thick: 1.0, z0: 0.5, z1: 3.55, out: 0.22 });
  faceRun(h, 'core-fixture', bowlFace, 9, { along: 0.32, thick: 0.9, z0: 3.3, z1: 3.55, out: 0.28 });
}

// 回廊床（86m の長大スラブ。市場側の面が回廊のシルエットを作る）
for (const id of ['canonical-072-slab', 'canonical-073-slab']) {
  const h = get(id);
  const inner = id === 'canonical-072-slab' ? '-y' : '+y';
  band(h, 'core-plinth', 0.0, 0.55, 0.22);
  band(h, 'core-string', 2.0, 2.3, 0.12);
  band(h, 'core-string', 3.55, 4.0, 0.26);
  faceRun(h, 'core-pilaster', inner, 15, { along: 0.9, thick: 1.0, z0: 0.55, z1: 3.55, out: 0.24 });
  faceRun(h, 'core-fixture', inner, 22, { along: 0.36, thick: 0.9, z0: 3.25, z1: 3.55, out: 0.3 });
  faceRun(h, 'core-arch', inner, 7, { along: 5.4, thick: 1.0, z0: 0.5, z1: 3.55, out: 0.22 });
}

// ---------------------------------------------------------------------------
// 6. 掘り下げボウルの目標
// ---------------------------------------------------------------------------

{
  const floor = get('canonical-010-slab');
  // 同心の敷石。目標へ近づくほど明るい（原則6の明度勾配を中央で担う）
  emit('core-plinth', floor, [0, 0, 2.44], [11.4, 11.4, 0.1]);
  emit('core-string', floor, [0, 0, 2.46], [9.2, 9.2, 0.1]);
  emit('core-plinth', floor, [0, 0, 2.47], [6.6, 6.6, 0.09]);
  emit('core-string', floor, [0, 0, 2.48], [4.6, 4.6, 0.09]);
  // 放射の目地
  for (let i = 0; i < 8; i++) {
    const ang = (i / 8) * Math.PI * 2;
    const rr = 3.6;
    emit('core-plinth', floor,
      [Math.cos(ang) * rr * 0.72, Math.sin(ang) * rr * 0.72, 2.49],
      [Math.abs(Math.cos(ang)) > 0.5 ? 3.6 : 0.36, Math.abs(Math.cos(ang)) > 0.5 ? 0.36 : 3.6, 0.08]);
  }
}

// ボウルのリム（縁石）。渡り石の参道がここでボウルへ落ちる。
for (const id of ['canonical-011-rim', 'canonical-012-rim', 'canonical-016-rim', 'canonical-017-rim']) {
  const h = get(id);
  band(h, 'core-plinth', 0.0, 0.5, 0.2);
  band(h, 'core-string', 2.55, 2.85, 0.16);
  cap(h, 'core-string', 0.24, 0.24);
  const outward = h.min[0] > 0 ? '+x' : '-x';
  faceRun(h, 'core-pilaster', outward, 3, { along: 0.7, thick: 0.7, z0: 0.5, z1: 3.6, out: 0.22, margin: 0.5 });
  // 灯柱（宿主上端 4.0 より上。XY 0.8m 以下の細い垂直要素）
  for (const s of [1, -1]) {
    const py = cy(h) + s * (dOf(h) / 2 - 0.6);
    emit('core-pilaster', h, [cx(h), py, 4.65], [0.44, 0.44, 1.4]);
    emit('core-window', h, [cx(h), py, 5.6], [0.6, 0.6, 0.62]);
    emit('core-crown', h, [cx(h), py, 6.15], [0.56, 0.56, 0.6]);
  }
}

// 井桁（ボウル中央の全身遮蔽＝潮汲みの装置そのもの）
{
  const h = get('canonical-027-cover');
  band(h, 'core-plinth', 2.5, 2.86, 0.26);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    emit('core-pilaster', h, [sx * 1.02, sy * 1.02, 3.93], [0.46, 0.46, 2.14]);
  }
  // 井桁に組んだ梁（宿主上端 5.0 を超えないので太くてよい）
  for (const s of [1, -1]) {
    emit('core-fixture', h, [0, s * 1.15, 4.78], [2.86, 0.34, 0.3]);
    emit('core-fixture', h, [s * 1.15, 0, 4.5], [0.34, 2.86, 0.3]);
  }
  emit('core-window', h, [0, 0, 4.86], [1.7, 1.7, 0.12]);   // 井戸の底から届く光
  emit('core-fixture', h, [0, 0, 4.3], [0.9, 0.9, 0.66]);   // 潮汲みの桶
  // 上へ伸びる支柱と浮き玉灯籠（XY 0.8m 以下）
  for (const s of [1, -1]) {
    emit('core-pilaster', h, [s * 0.95, 0, 5.65], [0.3, 0.3, 1.4]);
    emit('core-window', h, [s * 0.95, 0, 6.62], [0.62, 0.62, 0.62]);
    emit('core-crown', h, [s * 0.95, 0, 7.18], [0.58, 0.58, 0.56]);
  }
}

// 潮壺（半身遮蔽 ×4）— 色ガラスの浮き玉灯籠を載せる
for (const id of ['canonical-028-cover', 'canonical-029-cover', 'canonical-030-cover', 'canonical-031-cover']) {
  const h = get(id);
  band(h, 'core-plinth', 2.5, 2.72, 0.16);
  band(h, 'core-string', 3.36, 3.62, 0.14);
  emit('core-window', h, [cx(h), cy(h), 3.92], [0.52, 0.52, 0.46]);
  emit('core-crown', h, [cx(h), cy(h), 4.35], [0.48, 0.48, 0.42]);
}

// ---------------------------------------------------------------------------
// 7. 灯籠櫓（canonical-130/131 と欄干 132-137）
// ---------------------------------------------------------------------------

for (const id of ['canonical-130-tower', 'canonical-131-tower']) {
  const h = get(id);
  band(h, 'core-plinth', 4.0, 4.65, 0.26);
  band(h, 'core-string', 5.9, 6.2, 0.14);
  band(h, 'core-string', 7.4, 8.0, 0.3);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    emit('core-pilaster', h, [cx(h) + sx * 2.55, cy(h) + sy * 2.55, 6.0], [0.8, 0.8, 2.8]);
  }
  // 設計書§12「貝灰漆喰の白い集会堂が南北に一棟ずつ建つ」。
  // 検証で「南北の櫓は site_cladding が大窯・core_cladding が灯籠櫓・landmarks が
  // 大煙突として三重に被覆しており、物語が三つ重なって集会堂には読めない」と出た。
  // core_cladding 側の語彙を集会堂へ振り直す: shell(0xf0e4cc) の白い大質量＋
  // 半円アーチ（core-arch）を主役にし、尖った門は使わない。
  emit('core-pilaster', h, [cx(h), cy(h), 6.0], [wOf(h) - 1.4, dOf(h) - 1.4, 2.8]);
  for (const face of ['+x', '-x', '+y', '-y']) {
    faceRun(h, 'core-arch', face, 1, { along: 4.3, thick: 0.8, z0: 4.6, z1: 7.4, out: 0.26 });
    faceRun(h, 'core-window', face, 2, { along: 1.1, thick: 0.2, z0: 5.1, z1: 6.9, out: 0.12 });
  }
  // 頂部（宿主上端 8.0 より上は XY 0.8m 以下）
  emit('core-pilaster', h, [cx(h), cy(h), 10.6], [0.78, 0.78, 5.2]);
  emit('core-window', h, [cx(h), cy(h), 13.8], [0.76, 0.76, 1.2]);
  emit('core-crown', h, [cx(h), cy(h), 15.1], [0.74, 0.74, 1.4]);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    emit('core-pilaster', h, [cx(h) + sx * 2.6, cy(h) + sy * 2.6, 9.2], [0.42, 0.42, 2.4]);
    emit('core-crown', h, [cx(h) + sx * 2.6, cy(h) + sy * 2.6, 10.75], [0.4, 0.4, 0.7]);
  }
}

for (const id of ['canonical-132-wall', 'canonical-133-wall', 'canonical-134-wall',
  'canonical-135-wall', 'canonical-136-wall', 'canonical-137-wall']) {
  const h = get(id);
  cap(h, 'core-string', 0.16, 0.22);
  const alongX = wOf(h) > dOf(h);
  faceRun(h, 'core-pilaster', alongX ? '+y' : '+x', 7,
    { along: 0.28, thick: 0.5, z0: 8.1, z1: 8.85, out: 0.1, margin: 0.4 });
}

// ---------------------------------------------------------------------------
// 8. 階段（74枚）— 踏み面の縁石と蹴込みの影
// ---------------------------------------------------------------------------

let stairSeed = 0;
for (const h of withTag('stair')) {
  stairSeed += 1;
  const top = h.max[2];
  emit('core-string', h, [cx(h), cy(h), top - 0.05], [wOf(h) + 0.12, dOf(h) + 0.12, 0.14]);
  emit('core-plinth', h, [cx(h), cy(h), top - 0.24], [wOf(h) + 0.2, dOf(h) + 0.2, 0.16]);
  // 3段に1本、手すり柱（XY 0.28m。柱に見えない太さに留める＝偽の遮蔽対策）
  if (stairSeed % 3 === 0) {
    const alongX = wOf(h) > dOf(h);
    const px = alongX ? h.min[0] + 0.35 : cx(h);
    const py = alongX ? cy(h) : h.min[1] + 0.35;
    emit('core-pilaster', h, [px, py, top + 0.52], [0.28, 0.28, 1.04]);
  }
}

// ---------------------------------------------------------------------------
// 9. 遮蔽（29個）— 大灯柱・市場の木箱・渚の岩
// ---------------------------------------------------------------------------

for (const h of withTag('cover')) {
  const id = h.id;
  if (id === 'canonical-027-cover') continue;
  if (['canonical-028-cover', 'canonical-029-cover', 'canonical-030-cover', 'canonical-031-cover'].includes(id)) continue;
  const zb = h.min[2];
  const zt = h.max[2];
  const hh = zt - zb;
  if (hh > 4) {
    // 大灯柱（1.6x1.6x5.0）— 市場通りを分断する主役。色ガラスの灯を入れる。
    band(h, 'core-plinth', zb, zb + 0.6, 0.26);
    band(h, 'core-string', zb + 2.3, zb + 2.7, 0.16);
    for (const face of ['+x', '-x', '+y', '-y']) {
      faceRun(h, 'core-window', face, 1, { along: 0.8, thick: 0.22, z0: zb + 3.3, z1: zb + 4.5, out: 0.14, margin: 0.2 });
    }
    band(h, 'core-string', zt - 0.55, zt, 0.3);
    emit('core-pilaster', h, [cx(h), cy(h), zt + 1.3], [0.62, 0.62, 2.6]);
    emit('core-window', h, [cx(h), cy(h), 11.05], [0.74, 0.74, 1.5]);
    emit('core-crown', h, [cx(h), cy(h), 12.4], [0.7, 0.7, 1.2]);
  } else if (hh > 2.0) {
    // 全身遮蔽（2.0x2.0x2.4）— 現状まったく被覆が無い8個
    band(h, 'core-plinth', zb, zb + 0.34, 0.24);
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      emit('core-pilaster', h,
        [cx(h) + sx * (wOf(h) / 2 - 0.24), cy(h) + sy * (dOf(h) / 2 - 0.24), zb + hh * 0.55],
        [0.44, 0.44, hh * 0.72]);
    }
    band(h, 'core-fixture', zb + hh * 0.5, zb + hh * 0.62, 0.2);
    cap(h, 'core-string', 0.28, 0.3);
    emit('core-window', h, [cx(h), cy(h), zt - 0.66], [wOf(h) - 0.9, dOf(h) - 0.9, 0.5]);
  } else if (zb >= 3.9) {
    // 市場の木箱（1.5x1.5x1.5）
    band(h, 'core-plinth', zb, zb + 0.22, 0.2);
    band(h, 'core-fixture', zb + 0.6, zb + 0.78, 0.14);
    cap(h, 'core-string', 0.22, 0.24);
    emit('core-window', h, [cx(h), cy(h), zt + 0.28], [0.44, 0.44, 0.4]);
  } else {
    // 渚の岩（2x2x1.6、下段）
    band(h, 'core-plinth', zb, zb + 0.4, 0.28);
    emit('core-string', h, [cx(h), cy(h), zt - 0.18], [wOf(h) - 0.5, dOf(h) - 0.5, 0.3]);
    emit('core-fixture', h, [cx(h), cy(h), zt + 0.3], [0.5, 0.5, 0.6]);
  }
}

// ---------------------------------------------------------------------------
// 10. 回廊の腰壁窓（canonical-078〜097。設計書の「渡り石の参道」が抜ける回廊）
// ---------------------------------------------------------------------------

const CLOISTER_IDS = CANONICAL
  .filter(s => s.tag === 'wall' && Math.abs(s.max[2] - 6.2) < 1e-9)
  .map(s => s.id);

// 検証で「回廊の壁が1スケールの均一反復。同一寸法のパネル＋同一の黒いブラケットが
// 20回以上、寸法も間隔も完全に同じで並ぶ」と出た。拠点被覆が守っている
// 原則2「モジュールの3スケール反復」を、ここにも同じ考え方で入れる。
// site_cladding の TIER_BAY[0.46,0.72,1.0] / TIER_CAP[0.5,0.75,1.0] に倣う。
const CLOISTER_TIER_BAY = [0.52, 0.76, 1.0];
const CLOISTER_TIER_CAP = [0.55, 0.78, 1.0];

let cloisterSeed = 0;
for (const id of CLOISTER_IDS) {
  const h = get(id);
  cloisterSeed += 1;
  // 3スケール。並び順を 0,2,1,0,1,2,... と回して周期4・周期8の反復も同時に割る。
  const tier = [0, 2, 1, 0, 1, 2, 2, 0, 1][cloisterSeed % 9];
  const kb = CLOISTER_TIER_BAY[tier];
  const kc = CLOISTER_TIER_CAP[tier];
  const face = h.min[1] > 0 ? '-y' : '+y';
  band(h, 'core-string', 4.0, 4.24 + 0.18 * kb, 0.18 + 0.1 * kb);
  band(h, 'core-string', 6.2 - 0.2 - 0.12 * kb, 6.2, 0.2 + 0.12 * kb);
  faceRun(h, 'core-gate', face, tier === 0 ? 2 : 1,
    { along: tier === 0 ? 1.9 : 4.4 * kb, thick: 0.72, z0: 4.35, z1: 4.6 + 1.45 * kb, out: 0.16, margin: 0.3 });
  faceRun(h, 'core-window', face, tier === 2 ? 2 : 1,
    { along: (tier === 2 ? 1.05 : 2.1) * kb, thick: 0.16, z0: 4.7, z1: 4.9 + 0.95 * kb, out: 0.06, margin: 0.3 });
  faceRun(h, 'core-pilaster', face, 2 + tier,
    { along: 0.34 + 0.22 * kb, thick: 0.62, z0: 4.42, z1: 5.92, out: 0.1 + 0.06 * kb, margin: 0.34 });
  // 腰壁の上に載る浮き玉灯籠（宿主上端 6.2 より上。XY 0.8m 以下）。大きさも3段。
  const lx = h.min[0] + wOf(h) * [0.28, 0.5, 0.72][(cloisterSeed + tier) % 3];
  emit('core-lantern', h, [lx, cy(h), 6.32 + 0.24 * kc], [0.72 * kc, 0.72 * kc, 0.68 * kc]);
  emit('core-crown', h, [lx, cy(h), 6.7 + 0.5 * kc], [0.6 * kc, 0.6 * kc, 0.44 * kc]);
}

// 回廊の外欄干（canonical-074〜077）
for (const id of ['canonical-074-wall', 'canonical-075-wall', 'canonical-076-wall', 'canonical-077-wall']) {
  const h = get(id);
  band(h, 'core-plinth', 4.0, 4.4, 0.24);
  band(h, 'core-string', 5.3, 5.6, 0.14);
  cap(h, 'core-string', 0.26, 0.3);
  const face = h.min[1] > 0 ? '-y' : '+y';
  const span = wOf(h);
  faceRun(h, 'core-pilaster', face, Math.max(4, Math.round(span / 3.6)),
    { along: 0.36, thick: 0.7, z0: 4.4, z1: 5.3, out: 0.2, margin: 0.8 });
  faceRun(h, 'core-fixture', face, Math.max(3, Math.round(span / 7.0)),
    { along: 0.4, thick: 0.9, z0: 5.6, z1: 6.7, out: 0.28, margin: 1.2 });
}

// ---------------------------------------------------------------------------
// 11. スポーン台・潮見庭・接続ブリッジ
// ---------------------------------------------------------------------------

for (const id of ['canonical-032-slab', 'canonical-033-slab']) {
  const h = get(id);
  const inner = id === 'canonical-032-slab' ? '-x' : '+x';
  terraceSlab(h, {
    longFaces: ['+y', '-y'], shortFaces: [inner],
    longCount: 4, shortCount: 2,
    arches: 2, archFaces: [inner],
    gates: 2, gateFaces: ['+y', '-y'],
  });
}

for (const id of ['canonical-046-slab', 'canonical-047-slab']) {
  const h = get(id);
  const inner = id === 'canonical-046-slab' ? '-x' : '+x';
  band(h, 'core-plinth', 0.0, 0.6, 0.24);
  band(h, 'core-string', 3.5, 4.0, 0.28);
  faceRun(h, 'core-arch', inner, 1, { along: 5.0, thick: 1.0, z0: 0.5, z1: 3.55, out: 0.24 });
  faceRun(h, 'core-pilaster', '+y', 3, { along: 0.8, thick: 1.0, z0: 0.6, z1: 3.5, out: 0.24 });
  faceRun(h, 'core-pilaster', '-y', 3, { along: 0.8, thick: 1.0, z0: 0.6, z1: 3.5, out: 0.24 });
  faceRun(h, 'core-fixture', '+y', 4, { along: 0.34, thick: 0.9, z0: 3.2, z1: 3.5, out: 0.3 });
  faceRun(h, 'core-fixture', '-y', 4, { along: 0.34, thick: 0.9, z0: 3.2, z1: 3.5, out: 0.3 });
}

for (const id of ['canonical-052-slab', 'canonical-053-slab']) {
  const h = get(id);
  band(h, 'core-plinth', 0.0, 0.6, 0.22);
  band(h, 'core-string', 3.5, 4.0, 0.26);
  for (const face of ['+x', '-x']) {
    faceRun(h, 'core-pilaster', face, 5, { along: 0.8, thick: 0.9, z0: 0.6, z1: 3.5, out: 0.22 });
    faceRun(h, 'core-arch', face, 2, { along: 4.2, thick: 0.9, z0: 0.5, z1: 3.55, out: 0.2 });
    faceRun(h, 'core-fixture', face, 7, { along: 0.34, thick: 0.8, z0: 3.2, z1: 3.5, out: 0.28 });
  }
}

// 縁石（潮見庭と接続ブリッジ。渡り石の参道を照らす灯）
for (const id of ['canonical-048-wall', 'canonical-049-wall', 'canonical-050-wall', 'canonical-051-wall',
  'canonical-054-wall', 'canonical-055-wall', 'canonical-056-wall', 'canonical-057-wall']) {
  const h = get(id);
  cap(h, 'core-string', 0.2, 0.22);
  const alongX = wOf(h) > dOf(h);
  const span = alongX ? wOf(h) : dOf(h);
  const count = Math.max(2, Math.round(span / 3.2));
  for (let i = 0; i < count; i++) {
    const tt = (i + 0.5) / count;
    const px = alongX ? h.min[0] + wOf(h) * tt : cx(h);
    const py = alongX ? cy(h) : h.min[1] + dOf(h) * tt;
    emit('core-pilaster', h, [px, py, 5.15], [0.3, 0.3, 0.8]);
    emit('core-window', h, [px, py, 5.72], [0.4, 0.4, 0.36]);
    emit('core-crown', h, [px, py, 6.06], [0.38, 0.38, 0.34]);
  }
}

// スポーン壁（canonical-034〜045）
for (const h of withTag('spawnwall')) {
  const alongX = wOf(h) > dOf(h);
  const face = alongX ? (cy(h) > 0 ? '+y' : '-y') : (cx(h) > 0 ? '+x' : '-x');
  band(h, 'core-plinth', 4.0, 4.55, 0.24);
  band(h, 'core-string', 7.4, 8.0, 0.28);
  const span = alongX ? wOf(h) : dOf(h);
  faceRun(h, 'core-pilaster', face, Math.max(2, Math.round(span / 2.4)),
    { along: 0.5, thick: 0.6, z0: 4.55, z1: 7.4, out: 0.22, margin: 0.4 });
  faceRun(h, 'core-window', face, Math.max(1, Math.round(span / 3.2)),
    { along: 0.6, thick: 0.2, z0: 5.4, z1: 6.9, out: 0.12, margin: 0.9 });
}

// ---------------------------------------------------------------------------
// 12. 浮き玉灯籠の連なり（設計書§12）＝ 6〜14m 帯の充填
// ---------------------------------------------------------------------------
// 検証: 「プレイ領域内 7,781 インスタンスの 73.7% が 6m 未満。原則1の第2層
// （近景建築 6〜25m）が 14.8% しかなく、遠景と足元の間が空洞」。
// 同時に設計書§12「色ガラスの浮き玉灯籠が軒先とロープに連なり」が未実装だった。
//
// 安全規則との折り合い: 宿主上端（床 4.0）より上へ出せるのは XY 0.8m 以下。
// 索は 0.62m 以下の細片へ分割して実際に接続する。これなら灯を「浮かせる」ので
// はなく吊るせ、各片は身体を隠せない細さのままになる。
function garland(host, ax, ay, bx, by, poleTop, sag, count, seed) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  // 吊り柱（両端）と腕木
  for (const [px, py] of [[ax, ay], [bx, by]]) {
    emit('core-pilaster', host, [px, py, (host.max[2] + poleTop) / 2],
      [0.34, 0.34, poleTop - host.max[2]]);
    emit('core-fixture', host, [px, py, poleTop - 0.22], [0.62, 0.62, 0.26]);
    emit('core-crown', host, [px, py, poleTop + 0.42], [0.42, 0.42, 0.8]);
  }
  // 懸垂索。短片に割ることで、0.8m 制限を越える横長の飾りを作らない。
  const wirePoint = (t) => [
    ax + dx * t,
    ay + dy * t,
    poleTop - Math.sin(t * Math.PI) * sag,
  ];
  const wireSteps = Math.max(1, Math.ceil(length / 0.62));
  const alongX = Math.abs(dx) >= Math.abs(dy);
  for (let i = 0; i < wireSteps; i++) {
    const start = wirePoint(i / wireSteps);
    const end = wirePoint((i + 1) / wireSteps);
    const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
    emit('core-fixture', host,
      [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2, (start[2] + end[2]) / 2],
      alongX ? [Math.min(0.76, span + 0.04), 0.12, 0.12]
        : [0.12, Math.min(0.76, span + 0.04), 0.12]);
  }

  // 索に連なる浮き玉。垂れ（sag）で懸垂線を作る。大きさは3段。
  for (let i = 1; i < count; i++) {
    const t = i / count;
    const drop = Math.sin(t * Math.PI) * sag;
    const k = [0.62, 0.86, 1.0][(i + seed) % 3];
    const size = 0.5 * k + 0.16;
    const lanternZ = poleTop - 0.5 - drop;
    emit('core-lantern', host,
      [ax + dx * t, ay + dy * t, lanternZ],
      [size, size, size * 1.06]);
    // 灯の上端から実際の懸垂索まで届く短い紐。これが無いと光点だけが
    // 空中に残り、視覚的にも競技的にも説明不能な装飾になる。
    const wireZ = poleTop - drop;
    const lanternTop = lanternZ + size * 1.06 / 2;
    emit('core-fixture', host,
      [ax + dx * t, ay + dy * t, (lanternTop + wireZ) / 2],
      [0.12, 0.12, Math.max(0.08, wireZ - lanternTop)]);
    if ((i + seed) % 3 === 0) {
      // 吊り索の結び目（灯の間の細い金具。列の連続感を作る）
      emit('core-fixture', host,
        [ax + dx * t, ay + dy * t, poleTop - 0.16 - drop * 0.42], [0.22, 0.22, 0.6]);
    }
  }
}

// 北回廊・南回廊の床（86m のスラブ）に沿って、街区の軒高（8.5〜12.5m）へ張る
for (const id of ['canonical-072-slab', 'canonical-073-slab']) {
  const h = get(id);
  const y = cy(h) + (id === 'canonical-072-slab' ? -1.2 : 1.2);
  const anchors = [-40, -30.5, -19, -9.5, 2, 12.5, 23, 33, 41];
  for (let i = 1; i < anchors.length; i++) {
    const top = 8.6 + ((i * 5) % 4) * 1.3;          // 8.6 / 9.9 / 11.2 / 12.5
    const span = anchors[i] - anchors[i - 1];
    garland(h, anchors[i - 1], y, anchors[i], y, top, 1.1 + (i % 3) * 0.35,
      Math.max(3, Math.round(span / 1.5)), i);
  }
}

// 市場段丘（canonical-006/007）の中央通りに沿って、南北へ張る
for (const id of ['canonical-006-slab', 'canonical-007-slab']) {
  const h = get(id);
  const x = cx(h) + (id === 'canonical-006-slab' ? -2.5 : 2.5);
  const anchors = [-20, -11.5, -3, 6.5, 15, 21];
  for (let i = 1; i < anchors.length; i++) {
    const top = 9.4 + ((i * 3) % 4) * 1.2;          // 9.4 / 10.6 / 11.8 / 13.0
    const span = anchors[i] - anchors[i - 1];
    garland(h, x, anchors[i - 1], x, anchors[i], top, 1.2 + (i % 2) * 0.4,
      Math.max(3, Math.round(span / 1.5)), i + 4);
  }
}

// スポーン台（canonical-032/033）から回廊へ抜ける動線の軒灯
for (const id of ['canonical-052-slab', 'canonical-053-slab']) {
  const h = get(id);
  const x = cx(h);
  garland(h, x, h.min[1] + 1.5, x, h.max[1] - 1.5, 10.2, 1.0,
    Math.max(3, Math.round((dOf(h) - 3) / 1.5)), 2);
}

// ---------------------------------------------------------------------------
// 13. export（PROJECT.md §3 の契約）
// ---------------------------------------------------------------------------

export const CORE_CLADDING_LAYERS = LAYER_SPECS
  .filter(([id]) => buckets.get(id).length > 0)
  .map(([id, primitive, material]) => ({
    id,
    primitive,
    material,
    // プレイ領域内なので clad-existing-solid。宿主 footprint 内であることは
    // 上の emit() の guard と tests/map_site_cladding.test.js の二重で保証する。
    semantics: 'clad-existing-solid',
    castShadow: material !== 'windowGlow',
    receiveShadow: material !== 'windowGlow',
    transforms: buckets.get(id),
  }));

export const CORE_CLADDING_INSTANCE_COUNT = CORE_CLADDING_LAYERS
  .reduce((sum, layer) => sum + layer.transforms.length, 0);
