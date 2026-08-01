// 大潮井 ランドマークと祭礼 — 描画専用の被覆データ（担当 L）
//
// 目的は「どこにいても現在地が分かる」。中央に祭儀灯柱（設計書§15）、
// 5拠点それぞれに固有シルエットの中ランドマーク、分岐に潮汲み櫂の道標、
// 東=橙硝子／西=藍硝子の陣営色を持つ祭旗・幟・観客灯を置く。
//
// 安全規則（tests/map_site_cladding.test.js）:
//   1) すべての transform は宿主 solid の XY footprint 内（許容0.35m）
//   2) 宿主上端 +0.05m を超える部材は XY 最大辺 0.8m 以下
//   3) rotation[0]（ピッチ）は使わない。yaw のみ。
// 結果として「30mの塔」は太い一本では作れない。ここでは実在の櫓・起重機と同じく
// 0.8m以下の細材を組んだ開放トラスとして建てる。細材は体高帯でさらに細く（≤0.34m）し、
// 「柱に見えて通り抜ける」偽の遮蔽にならないようにしてある。
//
// 宿主（canonical-* と flash-* のみを使う。ring-* は K が編集中なので依存しない）:
//   canonical-027-cover  x[-1.25,1.25] y[-1.25,1.25] 上端 5.0  （井桁＝祭儀灯柱の台）
//   canonical-028..031   0.8x0.8 (±3.6,±3.6)         上端 3.7  （潮壺＝外脚の台）
//   canonical-010-slab   x[-6,6]   y[-6,6]           上端 2.5
//   canonical-130/131-tower x[-3,3] y[±10,±16]       上端 8.0  （北櫓・南櫓＝塩窯の煙突台）
//   canonical-006/007-slab  x[8,32]/[-32,-8] y[-22,22] 上端 4.0
//   canonical-072/073-slab  x[-43,43] y[±20,±26]     上端 4.0
//   canonical-001-ground x[-46,46] y[-34,34]         上端 0.0
//   flash-ring-{east,west}-floor x[±46,±126] y[-92,92] 上端 4.0
//   flash-ring-{north,south}-floor x[-46,46] y[±34,±92] 上端 4.0
//   flash-site-*-mass-*        9x4  上端 10〜12
//   flash-site-*-high-platform 6x6  上端 8〜9

const round = value => Math.round(value * 1000) / 1000;

// ---------------------------------------------------------------------------
// 部材ヘルパ（z0=下端, z1=上端 で書く。中心とスケールは自動計算）
// ---------------------------------------------------------------------------

// 宿主上端より高く伸びる部材は XY 0.8m 以下でなければならない（安全規則3）。
// collar の桟幅 step*0.92 が条件次第で 0.81m になり 1cm 超過していたので、
// 「上へ伸ばす用」の部材は生成時に 0.78m で頭打ちにする。
const THIN_CAP_M = 0.78;

function span(bucket, x, y, z0, z1, sx, sy, yaw = 0) {
  // 「細い垂直要素」の 0.8m 制限は回転後の XY AABB に対する制限である。
  // 生スケールが 0.78m でも yaw が付くと |cos|*sx + |sin|*sy で 0.81m に膨らみ、
  // 安全テストが落ちる（実際に道標の腕木で発生）。
  // 元から細い部材（最大辺 0.8m 以下）に限り、回転後の実効幅で頭打ちにする。
  if (yaw !== 0 && Math.max(sx, sy) <= 0.8) {
    const c = Math.abs(Math.cos(yaw));
    const s2 = Math.abs(Math.sin(yaw));
    const extentX = c * sx + s2 * sy;
    const extentY = s2 * sx + c * sy;
    const worst = Math.max(extentX, extentY);
    if (worst > THIN_CAP_M) {
      const k = THIN_CAP_M / worst;
      sx *= k;
      sy *= k;
    }
  }
  bucket.push({
    position: [round(x), round(y), round((z0 + z1) / 2)],
    scale: [round(sx), round(sy), round(z1 - z0)],
    rotation: [0, 0, round(yaw)],
  });
}

// 4辺の水平環。1部材ずつ 0.8m 以下に割るので宿主上端より上でも合法。
function collar(bucket, cx, cy, halfX, halfY, z0, z1, bar = 0.26, seg = 0.72) {
  for (const signY of [-1, 1]) {
    const count = Math.max(1, Math.ceil((halfX * 2) / seg));
    const step = (halfX * 2) / count;
    for (let index = 0; index < count; index++) {
      span(bucket, cx - halfX + step * (index + 0.5), cy + signY * halfY, z0, z1, Math.min(step * 0.92, THIN_CAP_M), bar);
    }
  }
  for (const signX of [-1, 1]) {
    const count = Math.max(1, Math.ceil((halfY * 2) / seg));
    const step = (halfY * 2) / count;
    for (let index = 0; index < count; index++) {
      span(bucket, cx + signX * halfX, cy - halfY + step * (index + 0.5), z0, z1, bar, Math.min(step * 0.92, THIN_CAP_M));
    }
  }
}

// 軸平行の水平梁。長さを 0.8m 以下の部材に割る。
function beam(bucket, x0, y0, x1, y1, z0, z1, bar = 0.3, seg = 0.72) {
  const alongX = Math.abs(x1 - x0) >= Math.abs(y1 - y0);
  const length = alongX ? Math.abs(x1 - x0) : Math.abs(y1 - y0);
  const count = Math.max(1, Math.ceil(length / seg));
  const step = length / count;
  for (let index = 0; index < count; index++) {
    const t = (step * (index + 0.5)) / length;
    const x = x0 + (x1 - x0) * t;
    const y = y0 + (y1 - y0) * t;
    if (alongX) span(bucket, x, y, z0, z1, step * 0.92, bar);
    else span(bucket, x, y, z0, z1, bar, step * 0.92);
  }
}

// 斜材（yaw のみ。ピッチは使わないので水平の筋交いとして効く）
function brace(bucket, x0, y0, x1, y1, z0, z1, bar = 0.24, seg = 0.7) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const length = Math.hypot(dx, dy);
  const yaw = Math.atan2(dy, dx);
  const count = Math.max(1, Math.ceil(length / seg));
  const step = length / count;
  for (let index = 0; index < count; index++) {
    const t = (step * (index + 0.5)) / length;
    span(bucket, x0 + dx * t, y0 + dy * t, z0, z1, step * 0.9, bar, yaw);
  }
}

// ---------------------------------------------------------------------------
// 収集先。層は9本まで（PLAN.md §2-2 の L 割当）
// ---------------------------------------------------------------------------

const plinth = [];   // box / shellShade  基壇・笠石・道標の台・明色の水平帯
const body = [];     // box / shell       胴（白金色の大質量）
const beaconBody = []; // box / copperPlaster 中央灯柱だけを遠景から抜く暖色の胴
const frame = [];    // box / basalt      骨組（柱・横材・斜材・幟竿）
const arcade = [];   // archWall / shellShade  曲線の開口
const cap = [];      // terrace / copperPlaster 笠
const spire = [];    // spire / copper    頂部
const mast = [];     // cylinder / copper 煙突・帆柱・避雷針・吊索
const lamps = [];    // { transform, side, key } 祭旗・幟・観客灯（陣営色）

function lamp(side, key, x, y, z0, z1, sx, sy, yaw = 0) {
  const bucket = [];
  span(bucket, x, y, z0, z1, sx, sy, yaw);
  lamps.push({ transform: bucket[0], side, key });
}

// ===========================================================================
// 1. 祭儀灯柱（設計書§15: マップ最高点+14m・白金色・「光の柱＝目標」）
//    宿主: canonical-027-cover（井桁, 上端5.0）と canonical-028..031（潮壺, 上端3.7）
// ===========================================================================

const BEACON_CORE_HALF = 0.72;     // 芯柱の中心オフセット（井桁 ±1.25+0.35 に収まる）
const BEACON_TOP = 34.0;           // 芯柱＋尖塔の頂点
const BEACON_TIP = 36.4;           // 避雷針の頂点＝マップ最高点

// 基壇（井桁の上。上端 5.0 以下なので太くてよい）
span(plinth, 0, 0, 2.5, 3.6, 3.1, 3.1);
span(plinth, 0, 0, 3.6, 4.6, 2.7, 2.7);
span(plinth, 0, 0, 4.6, 5.0, 3.0, 3.0);

// **胴体帯の一本化（検証の blocker）**
// 旧版は 5.0 から 0.74m 角の柱4本を 0.7m 間隔で立てていた。個々は 0.8m 制限を
// 守るが、束ねると 2.18 x 2.18m の塊になり、宿主（井桁）の当たり判定は z=5.0 までしか
// 無い。市場段丘(z=4)に立つ目線 5.6m がこの帯に入るため、目標の中央で最も撃ち合いが
// 起きる高さに「見た目だけの遮蔽」が立っていた。
// 5.0 → BEACON_SOLO_TOP は **1本の細い軸**（0.78m）にして、束ねても 0.8m を超えない。
// 分岐は、傍らで立てる最も高い天面（段丘 z=4.0）の胴体帯 4.0〜6.2m より上に置く。
const BEACON_SOLO_TOP = 7.6;
span(beaconBody, 0, 0, 5.0, 6.6, 0.78, 0.78);
span(beaconBody, 0, 0, 6.6, BEACON_SOLO_TOP, 0.7, 0.7);
// 銅の締め輪（遠景で淡灰の都市に対してシルエットの刻みを作る）
span(cap, 0, 0, 6.5, 6.72, 0.78, 0.78);

// 芯柱4本（白金色）。分岐点 → 28.0 を4段に分節して 3スケール反復を作る
const BEACON_SEGMENTS = [
  [BEACON_SOLO_TOP, 11.4, 0.74],
  [11.4, 17.6, 0.7],
  [17.6, 23.2, 0.64],
  [23.2, 28.0, 0.58],
];
for (const [z0, z1, width] of BEACON_SEGMENTS) {
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(beaconBody, signX * BEACON_CORE_HALF, signY * BEACON_CORE_HALF, z0, z1, width, width);
    }
  }
}

// 芯柱の水平環（5段）。分岐点にも環を入れて「柱が割れる」形を読ませる。
for (const z of [BEACON_SOLO_TOP, 11.4, 17.6, 23.2, 27.4]) {
  collar(frame, 0, 0, BEACON_CORE_HALF, BEACON_CORE_HALF, z, z + 0.42, 0.24);
}

// 濃色の帯（検証の minor: 132m 離れた kado から見ると淡灰の遠景都市に紛れる）。
// basalt(frame) と copperPlaster(cap) を芯柱に一定間隔で巻き、
// 遠景専用材質 farShell(0xe6dcc6) に対して明暗のコントラストを作る。
for (const z of [9.2, 13.8, 19.4, 25.0]) {
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      const width = z < 11.4 ? 0.76 : z < 17.6 ? 0.72 : z < 23.2 ? 0.66 : 0.6;
      span(frame, signX * BEACON_CORE_HALF, signY * BEACON_CORE_HALF, z, z + 0.55, width, width);
    }
  }
}
for (const z of [12.6, 18.4, 24.0]) {
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      const width = z < 17.6 ? 0.74 : z < 23.2 ? 0.68 : 0.62;
      span(cap, signX * BEACON_CORE_HALF, signY * BEACON_CORE_HALF, z, z + 0.34, width, width);
    }
  }
}

// 外脚4本（潮壺の上）。体高帯 3.7〜6.4 は 0.32m まで細くして偽の遮蔽を避ける
for (const signX of [-1, 1]) {
  for (const signY of [-1, 1]) {
    span(frame, signX * 3.6, signY * 3.6, 3.7, 6.4, 0.32, 0.32);
    span(frame, signX * 3.6, signY * 3.6, 6.4, 13.2, 0.52, 0.52);
    // 外脚から芯柱への斜材（水平の筋交い）
    brace(frame, signX * 3.25, signY * 3.25, signX * 1.0, signY * 1.0, 12.6, 13.0);
    lamp(signX > 0 ? 'east' : 'west', Math.hypot(3.6, 3.6), signX * 3.6, signY * 3.6, 13.2, 13.8, 0.5, 0.5);
  }
}

// 笠（段丘状に3段）
span(cap, 0, 0, 28.0, 28.7, 0.78, 0.78);
span(cap, 0, 0, 28.7, 29.2, 0.7, 0.7);
span(cap, 0, 0, 29.2, 29.6, 0.6, 0.6);

// 頂部の尖塔と避雷針
span(spire, 0, 0, 29.6, BEACON_TOP, 0.7, 0.7);
span(mast, 0, 0, BEACON_TOP, BEACON_TIP, 0.16, 0.16);

// 頂灯（東西で色が割れる。占有率0%でも必ず1つ残る先頭要素）
lamp('east', 0, 0.3, 0, 29.6, 30.6, 0.46, 0.5);
lamp('west', 0, -0.3, 0, 29.6, 30.6, 0.46, 0.5);

// 芯柱の段ごとの灯（中心から外へ波状に点く）
for (const z of [11.4, 17.6, 23.2, 27.4]) {
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      lamp(signX > 0 ? 'east' : 'west', z,
        signX * BEACON_CORE_HALF, signY * BEACON_CORE_HALF, z - 0.5, z, 0.44, 0.44);
    }
  }
}

// ===========================================================================
// 2. 塩窯（shiogama, 中央拠点）の中ランドマーク = 大煙突
//    宿主: canonical-130-tower(0,13) と canonical-131-tower(0,-13)（6x6, 上端8.0）
// ===========================================================================

function saltKiln(cy, flueRadius, flueTop, arches) {
  // 台座（上端 8.0 まで）
  span(plinth, 0, cy, 4.0, 7.4, 5.4, 5.4);
  span(plinth, 0, cy, 7.4, 8.0, 5.9, 5.9);
  span(body, 0, cy, 5.2, 7.4, 4.2, 4.2);

  // 焚口の曲線開口
  const faces = [
    [0, cy - 2.6, 0], [0, cy + 2.6, 0],
    [-2.6, cy, Math.PI / 2], [2.6, cy, Math.PI / 2],
  ];
  for (let index = 0; index < arches; index++) {
    const [ax, ay, yaw] = faces[index];
    span(arcade, ax, ay, 4.2, 7.2, 4.4, 0.6, yaw);
  }

  // 煙道（宿主上端より上なので 0.8m 以下の細材を束ねる）
  //
  // **束の分岐は 11.4m より上（検証の blocker）**
  // 旧版は櫓の天端 8.0 からいきなり 0.76m 角を 0.85m 間隔で4本立てていた。
  // 束ねると 2.46 x 2.46m になり、櫓天端（z=8.0、階段から登れる）と欄干天端（z=9.0）の
  // 胴体帯を丸ごと覆う＝隠れたのに撃たれる。9.0+2.2=11.2 より上でしか束ねない。
  const FLUE_SPLIT_Z = 11.4;
  const offsets = flueRadius > 0 ? [[-1, -1], [1, -1], [-1, 1], [1, 1]] : [[0, 0]];
  if (flueRadius > 0) {
    // 8.0 → 11.4 は一本の太い煙道（0.78m）。ここが胴体帯。
    span(mast, 0, cy, 8.0, 10.0, 0.78, 0.78);
    span(mast, 0, cy, 10.0, FLUE_SPLIT_Z, 0.72, 0.72);
    collar(frame, 0, cy, 0.36, 0.36, FLUE_SPLIT_Z - 0.5, FLUE_SPLIT_Z - 0.1, 0.22);
  }
  const flueBase = flueRadius > 0 ? FLUE_SPLIT_Z : 8.0;
  for (const [ox, oy] of offsets) {
    span(mast, ox * flueRadius, cy + oy * flueRadius, flueBase, (flueBase + flueTop) / 2, 0.76, 0.76);
    span(mast, ox * flueRadius, cy + oy * flueRadius, (flueBase + flueTop) / 2, flueTop, 0.64, 0.64);
  }
  const half = flueRadius > 0 ? flueRadius : 0.34;
  collar(frame, 0, cy, half, half, flueBase + (flueTop - flueBase) * 0.42,
    flueBase + 0.4 + (flueTop - flueBase) * 0.42, 0.24);
  collar(frame, 0, cy, half, half, flueTop - 1.4, flueTop - 1.0, 0.24);

  span(cap, 0, cy, flueTop, flueTop + 0.7, 0.78, 0.78);
  span(spire, 0, cy, flueTop + 0.7, flueTop + 3.2, 0.68, 0.68);

  for (const [ox, oy] of offsets) {
    lamp(ox >= 0 ? 'east' : 'west', 13 + Math.abs(cy),
      ox * flueRadius, cy + oy * flueRadius, flueTop - 0.7, flueTop - 0.1, 0.5, 0.5);
  }
}

saltKiln(13, 0.85, 20.0, 4);   // 北櫓 = 大煙突（頂点 23.2m, 中心から13m）
saltKiln(-13, 0, 16.4, 2);     // 南櫓 = 副煙突（頂点 19.6m。3スケール反復の中サイズ）

// ===========================================================================
// 3. 4拠点の中ランドマーク（遠景からシルエットで識別できる固有形）
// ===========================================================================

const SITES = [
  {
    id: 'mizuichi', kind: 'crane', side: 'east',
    mass: { x: [48, 57], y: [56, 60], top: 12 },
    plat: { x: [65, 71], y: [47, 53], top: 9 },
    jib: [0, -1],
  },
  {
    id: 'kado', kind: 'gantry', side: 'east',
    mass: { x: [55, 64], y: [-60, -56], top: 12 },
    plat: { x: [41, 47], y: [-55, -49], top: 8 },
  },
  {
    id: 'ami', kind: 'lock', side: 'west',
    mass: { x: [-64, -55], y: [56, 60], top: 12 },
    plat: { x: [-47, -41], y: [47, 53], top: 8 },
  },
  {
    id: 'kazami', kind: 'watch', side: 'west',
    mass: { x: [-64, -55], y: [-32, -28], top: 11 },
    plat: { x: [-71, -65], y: [-53, -47], top: 9 },
  },
];

function siteBase(site) {
  const { x, y, top } = site.mass;
  const cx = (x[0] + x[1]) / 2;
  const cy = (y[0] + y[1]) / 2;
  const width = x[1] - x[0];
  const depth = y[1] - y[0];

  // 基壇・胴・軒（宿主上端まで。太くてよい）
  span(plinth, cx, cy, 4.0, 6.6, width - 0.3, depth - 0.3);
  span(body, cx, cy, 6.6, top - 0.6, width - 1.4, depth - 0.8);
  span(plinth, cx, cy, top - 0.6, top, width, depth);

  // 長辺2面に曲線の開口を3連ずつ
  for (const signY of [-1, 1]) {
    for (let index = -1; index <= 1; index++) {
      span(arcade, cx + index * 2.9, cy + signY * (depth / 2 - 0.4), 4.2, 6.5, 2.4, 0.7);
    }
  }
  return { cx, cy, top };
}

function sitePlatform(site) {
  const { x, y, top } = site.plat;
  const cx = (x[0] + x[1]) / 2;
  const cy = (y[0] + y[1]) / 2;
  span(plinth, cx, cy, top - 0.5, top, 6, 6);
  for (let index = -1; index <= 1; index++) {
    span(arcade, cx + index * 1.8, cy - 2.6, 4.2, 6.8, 1.6, 0.6);
  }
  // 台上の信号柱（12〜20m帯を埋めて奥行きの4層目を作る）
  span(frame, cx, cy, top, top + 2.4, 0.32, 0.32);
  span(frame, cx, cy, top + 2.4, top + 7.6, 0.6, 0.6);
  span(spire, cx, cy, top + 7.6, top + 9.4, 0.62, 0.62);
  lamp(site.side, 60, cx, cy, top + 6.8, top + 7.6, 0.58, 0.58);
}

function siteCrane(site) {
  const { cx, cy, top } = siteBase(site);
  const [jx, jy] = site.jib;
  // 起重機の塔（4本の柱＋3段の水平環）
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(frame, cx + signX * 1.6, cy + signY * 1.2, top, top + 5.5, 0.72, 0.72);
      span(frame, cx + signX * 1.6, cy + signY * 1.2, top + 5.5, top + 11, 0.62, 0.62);
    }
  }
  for (const dz of [4.0, 8.0, 10.6]) {
    collar(frame, cx, cy, 1.6, 1.2, top + dz, top + dz + 0.4, 0.24);
  }
  // ジブ（腕）と釣合梁。遠景での識別点。
  const jibZ = top + 9.6;
  beam(frame, cx + jx * 2.4, cy + jy * 2.4, cx + jx * 13, cy + jy * 13, jibZ, jibZ + 0.55, 0.42);
  beam(frame, cx - jx * 2.4, cy - jy * 2.4, cx - jx * 5.6, cy - jy * 5.6, jibZ, jibZ + 0.55, 0.42);
  span(mast, cx + jx * 12.4, cy + jy * 12.4, top + 2.4, jibZ, 0.2, 0.2);
  span(plinth, cx + jx * 12.4, cy + jy * 12.4, top + 1.6, top + 2.4, 0.66, 0.66);
  span(cap, cx, cy, top + 11, top + 11.8, 0.78, 0.78);
  span(spire, cx, cy, top + 11.8, top + 13.6, 0.7, 0.7);
  lamp(site.side, 20, cx + jx * 12.4, cy + jy * 12.4, jibZ + 0.55, jibZ + 1.1, 0.5, 0.5);
  lamp(site.side, 10, cx, cy, top + 10.4, top + 11, 0.6, 0.6);
  sitePlatform(site);
}

function siteGantry(site) {
  const { cx, cy, top } = siteBase(site);
  // 門形の脚2組
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(frame, cx + signX * 3.0, cy + signY * 1.0, top, top + 4.5, 0.74, 0.74);
      span(frame, cx + signX * 3.0, cy + signY * 1.0, top + 4.5, top + 8.6, 0.62, 0.62);
    }
    collar(frame, cx + signX * 3.0, cy, 0.5, 1.0, top + 4.3, top + 4.7, 0.24);
  }
  // 上部の桁2本＝ガントリーの識別点
  for (const [dz, bar] of [[8.0, 0.5], [5.4, 0.36]]) {
    for (const signY of [-1, 1]) {
      beam(frame, cx - 3.0, cy + signY * 1.0, cx + 3.0, cy + signY * 1.0, top + dz, top + dz + 0.55, bar);
    }
  }
  beam(frame, cx, cy - 1.0, cx, cy + 1.0, top + 8.6, top + 9.0, 0.36);
  for (const signX of [-1, 1]) {
    span(cap, cx + signX * 3.0, cy, top + 8.6, top + 9.3, 0.76, 0.76);
    span(spire, cx + signX * 3.0, cy, top + 9.3, top + 11.4, 0.68, 0.68);
    lamp(site.side, signX > 0 ? 10 : 20, cx + signX * 3.0, cy, top + 8.0, top + 8.6, 0.56, 0.56);
  }
  lamp(site.side, 5, cx, cy + 1.0, top + 8.55, top + 9.2, 0.5, 0.5);
  sitePlatform(site);
}

function siteLock(site) {
  const { cx, cy, top } = siteBase(site);
  // 閘門櫓: 角柱4本＋3段の水平環＋吊り扉
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(frame, cx + signX * 1.4, cy + signY * 1.2, top, top + 4.2, 0.76, 0.76);
      span(frame, cx + signX * 1.4, cy + signY * 1.2, top + 4.2, top + 8.4, 0.66, 0.66);
    }
  }
  for (const dz of [3.0, 6.0, 8.2]) {
    collar(frame, cx, cy, 1.4, 1.2, top + dz, top + dz + 0.45, 0.26);
  }
  // 吊り扉（0.78m の板を並べた閘門の落し戸）
  for (let index = -1; index <= 1; index++) {
    span(plinth, cx + index * 0.82, cy - 1.2, top + 1.2, top + 4.6, 0.78, 0.3);
    span(plinth, cx + index * 0.82, cy + 1.2, top + 1.2, top + 4.6, 0.78, 0.3);
  }
  span(cap, cx, cy, top + 8.4, top + 9.4, 0.78, 0.78);
  span(spire, cx, cy, top + 9.4, top + 12.5, 0.72, 0.72);
  lamp(site.side, 10, cx, cy, top + 7.6, top + 8.4, 0.62, 0.62);
  lamp(site.side, 20, cx + 1.4, cy, top + 3.0, top + 3.6, 0.5, 0.5);
  sitePlatform(site);
}

function siteWatch(site) {
  const { cx, cy, top } = siteBase(site);
  // 見張り: 細い櫓の上に張り出した番屋
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(frame, cx + signX * 1.2, cy + signY * 1.0, top, top + 3.6, 0.7, 0.7);
      span(frame, cx + signX * 1.2, cy + signY * 1.0, top + 3.6, top + 7.0, 0.6, 0.6);
    }
  }
  for (const dz of [3.4, 6.8]) {
    collar(frame, cx, cy, 1.2, 1.0, top + dz, top + dz + 0.4, 0.24);
  }
  // 番屋（0.78m の箱を4つ並べて 1.8m 角の小屋に見せる）
  for (const signX of [-1, 1]) {
    for (const signY of [-1, 1]) {
      span(body, cx + signX * 0.86, cy + signY * 0.76, top + 7.0, top + 9.4, 0.78, 0.68);
      span(plinth, cx + signX * 0.86, cy + signY * 0.76, top + 9.4, top + 9.9, 0.78, 0.72);
    }
  }
  span(cap, cx, cy, top + 9.9, top + 10.7, 0.78, 0.78);
  span(spire, cx, cy, top + 10.7, top + 13.0, 0.7, 0.7);
  lamp(site.side, 10, cx, cy, top + 9.9, top + 10.5, 0.62, 0.62);
  lamp(site.side, 20, cx - 0.86, cy - 0.76, top + 7.6, top + 8.4, 0.52, 0.52);
  sitePlatform(site);
}

for (const site of SITES) {
  if (site.kind === 'crane') siteCrane(site);
  else if (site.kind === 'gantry') siteGantry(site);
  else if (site.kind === 'lock') siteLock(site);
  else siteWatch(site);
}

// ===========================================================================
// 4. 道標（設計書§15: 潮汲み櫂を模した矢印道標・「井」の焼き印＝目標方向）
//    すべて上端4.0の床の上。柱は 0.26m でシルエットに嘘がない。
// ===========================================================================

const WAYMARKS = [
  [26, 10], [26, -10], [14, 18], [14, -18],
  [40, 22.5], [40, -22.5], [52, 30], [52, -30],
  [-26, 10], [-26, -10], [-14, 18], [-14, -18],
  [-40, 22.5], [-40, -22.5], [-52, 30], [-52, -30],
];

for (const [x, y] of WAYMARKS) {
  const yaw = Math.atan2(-y, -x);           // 目標（原点）を指す
  const side = x >= 0 ? 'east' : 'west';
  span(plinth, x, y, 4.0, 4.34, 0.78, 0.78);          // 台
  span(frame, x, y, 4.34, 6.9, 0.26, 0.26);           // 柄
  span(plinth, x, y, 6.05, 6.75, 0.78, 0.24, yaw);    // 櫂の水掻き（矢印）
  lamp(side, Math.hypot(x, y), x, y, 6.4, 6.72, 0.3, 0.3, yaw);  // 「井」の焼き印
}

// ===========================================================================
// 5. 祭旗・幟（東=橙硝子／西=藍硝子）
//    竿は frame、旗布は陣営色の層。占有率で点灯量を差し替えられるよう
//    「原点から遠い順」に並べ、自陣側から中央へ向かって点いていく。
// ===========================================================================

for (const side of ['east', 'west']) {
  const signX = side === 'east' ? 1 : -1;
  for (const x of [50, 72]) {
    for (const y of [-36, -24, -12, 0, 12, 24, 36]) {
      const px = signX * x;
      span(frame, px, y, 4.0, 9.2, 0.24, 0.24);
      lamp(side, -Math.hypot(px, y), px, y, 5.6, 8.8, 0.7, 0.14);
    }
  }
}

// ===========================================================================
// 6. 観客灯（段丘の浮き玉灯。占有率に応じて波状に点く）
//    canonical-072/073-slab（x[-43,43], y[±20,±26], 上端4.0）の上。
// ===========================================================================

// 検証の minor: 「金冠ボラードが等間隔で14本以上一列に並び、3スケール反復が
// 機械的に見える」。間隔を不均一にし、一部を欠落させ、高さを3段に振る。
const CLOISTER_BOLLARD_X = [
  -40.5, -35.2, -31.8, -24.6, -20.9, -19.1, -12.4, -6.8, -4.9,
  2.2, 6.1, 7.9, 14.8, 18.3, 24.7, 26.9, 33.4, 39.2,
];
for (const y of [23, -23]) {
  const flip = y > 0 ? 1 : -1;
  for (const [index, baseX] of CLOISTER_BOLLARD_X.entries()) {
    // 南列は北列の鏡像にせず、位相をずらして「同じ列が2本」に見えないようにする
    const x = flip > 0 ? baseX : -baseX + (index % 3 === 1 ? 1.6 : -0.9);
    // x=±40 には道標（WAYMARKS の [±40, ±22.5]）が立つ。1.5m 以内に並ぶと
    // 台どうしが束なって 1.2m 級の塊になるので、この帯には置かない。
    if (Math.abs(x) > 36.5) continue;
    if ((index * 5 + (flip > 0 ? 0 : 3)) % 7 === 0) continue;   // 欠落
    const tier = (index * 3 + (flip > 0 ? 0 : 1)) % 3;
    const height = [0.42, 0.6, 0.88][tier];
    const width = [0.44, 0.52, 0.62][tier];
    span(plinth, x, y, 4.0, 4.3 + tier * 0.16, width + 0.16, width + 0.16);
    lamp(x >= 0 ? 'east' : 'west', Math.abs(x),
      x, y, 4.3 + tier * 0.16, 4.3 + tier * 0.16 + height, width, width);
  }
}

// ===========================================================================
// 7. 中間高度（12〜20m帯）の標識柱 — 奥行きの4層目とスカイラインの振幅を作る
//    すべて上端4.0の床の上。体高帯は 0.3m、上は 0.62m。
// ===========================================================================

const PYLONS = [
  [50, -70, 17.2], [50, 70, 18.6], [74, -40, 14.4], [74, 40, 15.8],
  [96, -16, 13.2], [96, 16, 19.4],
  [-50, -70, 18.6], [-50, 70, 17.2], [-74, -40, 15.8], [-74, 40, 14.4],
  [-96, -16, 19.4], [-96, 16, 13.2],
  [-30, 70, 16.4], [0, 76, 20.2], [30, 70, 16.4],
  [-30, -70, 16.4], [0, -76, 20.2], [30, -70, 16.4],
];

for (const [x, y, height] of PYLONS) {
  const side = x >= 0 ? 'east' : 'west';
  span(frame, x, y, 4.0, 7.0, 0.3, 0.3);
  span(frame, x, y, 7.0, height, 0.62, 0.62);
  span(spire, x, y, height, height + 1.6, 0.64, 0.64);
  lamp(side, 200 - height, x, y, height - 0.9, height - 0.2, 0.58, 0.58);
}

// ===========================================================================
// 層の組み立て
// ===========================================================================

// 灯は「点く順」に並べる。key が小さいほど先に点く。
const eastLamps = lamps.filter(entry => entry.side === 'east')
  .sort((a, b) => a.key - b.key).map(entry => entry.transform);
const westLamps = lamps.filter(entry => entry.side === 'west')
  .sort((a, b) => a.key - b.key).map(entry => entry.transform);

/** 陣営色。R が materials を差し替えたらここだけ変えれば全灯に効く。 */
export const LANDMARK_FACTION_MATERIALS = Object.freeze({
  east: 'windowGlow',   // 橙硝子（emissive 0x9a5d14）
  // 旧: 'indigoWall'。emissive を持たない標準材質なので「灯」ではなく暗い青い箱に
  // 描かれ、東 65 個だけが光る非対称になっていた（検証の blocker）。
  west: 'indigoGlow',   // 藍硝子（emissive 0x1a4a7a）
});

/** 祭礼の灯（層ID → 点灯順に並んだ transform）。ランタイムが占有率で切り詰める。 */
export const LANDMARK_FESTIVAL_LAMPS = Object.freeze({
  east: Object.freeze({ layerId: 'landmark-lamp-east', total: eastLamps.length }),
  west: Object.freeze({ layerId: 'landmark-lamp-west', total: westLamps.length }),
});

function litSlice(list, ratio) {
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 1;
  return list.slice(0, Math.max(1, Math.round(list.length * value)));
}

/**
 * 層配列を組み立てる。色と点灯量を実行時に差し替えられる。
 * @param {{eastMaterial?:string, westMaterial?:string,
 *          eastOccupancy?:number, westOccupancy?:number}} [options]
 */
export function buildLandmarkLayers(options = {}) {
  const solid = (id, primitive, material, transforms, castShadow = true) => ({
    id, primitive, material,
    semantics: 'clad-existing-solid',
    castShadow, receiveShadow: true,
    transforms,
  });
  return [
    solid('landmark-plinth', 'box', 'shellShade', plinth),
    solid('landmark-body', 'box', 'shell', body),
    solid('landmark-beacon-body', 'box', 'copperPlaster', beaconBody),
    solid('landmark-frame', 'box', 'basalt', frame),
    solid('landmark-arcade', 'archWall', 'shellShade', arcade),
    solid('landmark-cap', 'terrace', 'copperPlaster', cap),
    solid('landmark-spire', 'spire', 'copper', spire),
    solid('landmark-mast', 'cylinder', 'copper', mast),
    solid('landmark-lamp-east', 'box',
      options.eastMaterial || LANDMARK_FACTION_MATERIALS.east,
      litSlice(eastLamps, options.eastOccupancy), false),
    solid('landmark-lamp-west', 'box',
      options.westMaterial || LANDMARK_FACTION_MATERIALS.west,
      litSlice(westLamps, options.westOccupancy), false),
  ];
}

export const LANDMARK_LAYERS = buildLandmarkLayers();

export const LANDMARK_INSTANCE_COUNT = LANDMARK_LAYERS
  .reduce((sum, layer) => sum + layer.transforms.length, 0);

/** 検証・報告用の実測メタ。 */
export const LANDMARK_SUMMARY = Object.freeze({
  beaconTopM: BEACON_TIP,
  layerCount: LANDMARK_LAYERS.length,
  instanceCount: LANDMARK_INSTANCE_COUNT,
});
