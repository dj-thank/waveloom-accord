// 大潮井5拠点 — 既存ソリッドの被覆（クラッディング）。
//
// 目的: プレイ領域の中身が「当たり判定の箱そのもの」に見える状態を解消する。
//
// 安全規則（tests/map_site_cladding.test.js が強制）:
//   1. 当たり判定（solids）は一切変更しない。ここは描画専用データである。
//   2. すべての被覆は、宿主となる solid の XY footprint に収める（許容0.35m）。
//      これにより「見た目は遮蔽だが当たり判定が無い」偽の遮蔽が原理的に発生しない。
//   3. 宿主の上端より高く伸びてよいのは、XY方向が 0.8m 以下の細い垂直要素だけ。
//      本ファイルはさらに厳しく **0.34m 以下** に自主規制する。0.5m級の飾りは
//      「柱に見えるのに通り抜ける」体験になるため（PLAN §B-5）。
//      太い煙突・帆柱は「宿主内に収まる台座（幅自由）＋その上の細い軸」で表現する。
//   4. rotation[0]（ピッチ）は使わない。安全テストは yaw しか考慮しないため。
//
// 設計の3本柱:
//   A. **モジュールの3スケール反復** — bay / cap / bracket / crate の4モジュールを
//      大・中・小の3段階で使い回す。部品種を増やさずに密度と階層を作る（原則2）。
//   B. **屋根の脱・単調** — 屋根材5種（roofBlue / roofCopper / copperPlaster /
//      shellShade / basalt）× 形状4種（hipRoof / sawRoof / barrelRoof / spire）を
//      建物ごとに割り当て、大屋根は2枚に割って段差と天窓を入れる。
//   C. **5拠点の固有語彙** — 塩窯=窯と煙 / 水市=競りと浮標 / 角=乾ドックと船体 /
//      網=閘門と運河 / 風見=造船台と骨組み。形だけ違う同じ広場にしない。
//
// 層は「emit キー（意味）」と「層 ID（primitive+material）」を分離し、
// 同一 primitive+material の意味キーを1層へ束ねる。1層＝1ドローコールなので、
// 密度は層追加ではなく transforms 追加で稼ぐ（PLAN §2）。

import { buildOshioiFlashpointGeometry } from './map_oshioi_flashpoint_geometry.js';
import { buildOshioiRingGeometry } from './map_oshioi_ring_geometry.js';

const t = (position, scale, rotation = [0, 0, 0]) => ({ position, scale, rotation });

// 検証で「5拠点の材質分布が完全に同一（basalt 25-30% → shellShade 19-21% →
// shell 9-12% → copper 6-9% と同順位・同比率）で、色では拠点を判別できない」と出た。
// 幾何は 75〜85% が固有なのに、識別がシルエットだけに依存していた。
// 原因は DC 節約のための primitive+material 束ねで、kiln-body と market-store が
// 同じ層に、dock-cradle/lock-gate/kiln-ashledge が同じ暗色層に吸い込まれていたこと。
//
// 対策は2つ。
//   ① 壁の材質を拠点ごとに割る（下の LAYER_SPECS の clad-*-wall 5層）
//   ② 基壇（最頻材質 basalt の主因）も拠点ごとに割る。VOCAB は共通キー
//      'site-plinth' を使っているので、ここで拠点別キーへ振り替える。
const SITE_PLINTH_KEY = {
  shiogama: 'kiln-plinth',   // 窯の灰＝暗色
  mizuichi: 'market-plinth', // 競り場＝明るい貝灰
  kado: 'dock-plinth',       // 乾ドック＝濡れた岩
  ami: 'lock-plinth',        // 閘門＝藍
  kazami: 'slip-plinth',     // 造船台＝杉
};
let activeSite = null;

const buckets = new Map();
function emit(key, transform) {
  const target = (key === 'site-plinth' && activeSite && SITE_PLINTH_KEY[activeSite])
    ? SITE_PLINTH_KEY[activeSite] : key;
  if (!buckets.has(target)) buckets.set(target, []);
  buckets.get(target).push(transform);
}

// 決定論的な疑似乱数。同じ seed からは常に同じ値が出るのでビルドは再現する。
function hash01(n) {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

// 宿主より高く伸びる要素の自主上限（安全テストの上限は0.8m）。
const THIN_M = 0.34;

function box(solid) {
  const [x0, y0, z0] = solid.min;
  const [x1, y1, z1] = solid.max;
  return {
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2,
    w: x1 - x0, d: y1 - y0,
    zBase: z0, zTop: z1, h: z1 - z0,
  };
}

// 宿主の内側に収まる板・塊。inset は XY の食い込み量（負なら張り出し、-0.35 が限界）。
function inner(b, key, { inset = 0.12, from = 0, to = 1 }) {
  const zFrom = b.zBase + b.h * from;
  const zTo = b.zBase + b.h * to;
  if (zTo - zFrom <= 0.02) return;
  const ins = Math.max(inset, -0.34);
  emit(key, t(
    [b.cx, b.cy, (zFrom + zTo) / 2],
    [Math.max(0.05, b.w - ins * 2), Math.max(0.05, b.d - ins * 2), zTo - zFrom],
  ));
}

// 宿主 footprint 内の任意位置に置く塊。屋根の分割・付属屋・棚に使う。
function slab(b, key, { ox = 0, oy = 0, w, d, from, to }) {
  const zFrom = b.zBase + b.h * from;
  const zTo = b.zBase + b.h * to;
  if (zTo - zFrom <= 0.02) return;
  // footprint（許容0.35m）からはみ出さないよう幅を詰める。
  const maxW = 2 * (b.w / 2 + 0.3 - Math.abs(ox));
  const maxD = 2 * (b.d / 2 + 0.3 - Math.abs(oy));
  const sw = Math.min(w, maxW);
  const sd = Math.min(d, maxD);
  if (sw <= 0.05 || sd <= 0.05) return;
  emit(key, t([b.cx + ox, b.cy + oy, (zFrom + zTo) / 2], [sw, sd, zTo - zFrom]));
}

// 宿主の上端から伸びる細い垂直要素。軸は必ず THIN_M 以下。
// baseKey を渡すと、宿主の中に収まる「台座」を同じ軸線上に置く。
// これで 0.34m の軸でも煙突・帆柱として読める（安全規則を守ったまま太さの情報を戻す）。
function mast(b, key, { dx = 0, dy = 0, radius = 0.17, height = 3, baseKey = null, baseSize = 0 }) {
  const r = Math.min(radius, THIN_M / 2);
  emit(key, t([b.cx + dx, b.cy + dy, b.zTop + height / 2], [r * 2, r * 2, height]));
  if (!baseKey || baseSize <= 0) return;
  const s = Math.min(baseSize, 2 * (b.w / 2 + 0.3 - Math.abs(dx)), 2 * (b.d / 2 + 0.3 - Math.abs(dy)));
  if (s < 0.35) return;
  const hb = Math.min(Math.max(b.h * 0.16, 0.5), 1.6);
  emit(baseKey, t([b.cx + dx, b.cy + dy, b.zTop - hb / 2], [s, s, hb]));
}

// 宿主の天面に沿って等間隔に並べる小要素（すべて footprint 内）。
function rib(b, key, count, { thickness = 0.5, from = 0.05, to = 0.95, alongDepth = false }) {
  const span = alongDepth ? b.d : b.w;
  for (let i = 0; i < count; i++) {
    const along = ((i + 0.5) / count - 0.5) * (span - thickness * 2);
    const zFrom = b.zBase + b.h * from;
    const zTo = b.zBase + b.h * to;
    emit(key, t(
      alongDepth ? [b.cx, b.cy + along, (zFrom + zTo) / 2] : [b.cx + along, b.cy, (zFrom + zTo) / 2],
      alongDepth
        ? [Math.max(0.05, b.w - 0.3), thickness, zTo - zFrom]
        : [thickness, Math.max(0.05, b.d - 0.3), zTo - zFrom],
    ));
  }
}

// 四隅の付柱。footprint 内に収めるため、角から内側へ寄せて置く。
function corners(b, key, { inset = 0.9, size = 0.7, from = 0, to = 1 }) {
  const zFrom = b.zBase + b.h * from;
  const zTo = b.zBase + b.h * to;
  if (zTo - zFrom <= 0.02) return;
  const ox = Math.max(0, b.w / 2 - inset);
  const oy = Math.max(0, b.d / 2 - inset);
  for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    emit(key, t([b.cx + sx * ox, b.cy + sy * oy, (zFrom + zTo) / 2], [size, size, zTo - zFrom]));
  }
}

// ---- モジュール（3スケールで使い回す4部品） ----------------------------------
//
// TIER 0=小 / 1=中 / 2=大。同じ部品を3段階の大きさで置くことで、
// 部品の種類を増やさずに「近づくほど細部が出る」階層を作る（原則2）。
const TIER_BAY = [0.46, 0.72, 1.0];      // 開口モジュールの倍率
const TIER_CAP = [0.5, 0.75, 1.0];       // 頂部モジュールの倍率

// モジュール1: 開口ベイ（窓 + 庇 + まぐさ）。壁の反復を割る中核。
// - 一定確率で欠落させる（決定論的乱数）
// - 窓丈を3段に振る（0.42 / 0.66 / 0.95）
// - 建物ごとに位相をずらす
// - 一部に銅の庇を出して縦の反復を横線で断つ（金の差し色も兼ねる）
function bayModule(b, seed, {
  rows = 2, cells = 3, zStart = 0.3, zStep = 0.22,
  tier = 2, dropout = 0.18, hoodChance = 0.34, key = 'ring-window',
} = {}) {
  const k = TIER_BAY[tier];
  const phase = hash01(seed * 5.917 + 0.31);
  for (let row = 0; row < rows; row++) {
    const zc = b.zBase + b.h * (zStart + row * zStep) + b.h * 0.04 * phase;
    if (zc > b.zTop - b.h * 0.12 - 0.2) continue;
    for (let i = 0; i < cells; i++) {
      const along = ((i + 0.5) / cells - 0.5 + (phase - 0.5) * 0.16) * b.w * 0.72;
      for (const sy of [-1, 1]) {
        const r = hash01(seed * 17.13 + row * 3.71 + i * 1.37 + (sy > 0 ? 0.53 : 0.11));
        if (r < dropout) continue;
        const tall = r < 0.42 ? 0.42 : r < 0.74 ? 0.66 : 0.95;
        const paneW = (b.w / cells) * (0.3 + 0.24 * tall) * k;
        const paneH = b.h * 0.13 * tall * k;
        if (paneW < 0.12 || paneH < 0.12) continue;
        const y = b.cy + sy * (b.d / 2 - 0.05);
        emit(key, t([b.cx + along, y, zc], [paneW, 0.08, paneH]));
        // 銅の庇。壁の縦反復を切る水平線であり、原則4の金の差し色でもある。
        const hoodTop = zc + paneH / 2 + 0.26;
        if (r > 1 - hoodChance && hoodTop < b.zTop - 0.05) {
          emit('window-hood', t(
            [b.cx + along, y - sy * 0.03, zc + paneH / 2 + 0.2],
            [Math.min(paneW + 0.36, b.w - 0.2), 0.24, 0.12],
          ));
        }
      }
    }
  }
}

// モジュール2: 頂部キャップ（パラペット + 棟木 + 天窓）。
// 「上から見ると暗い平屋根が支配的」への直接の対策。明るいパラペットで屋根の縁を描き、
// 棟木で稜線を出し、天窓（windowGlow）で俯瞰に金の点を撒く。
function capModule(b, seed, { tier = 2, base = 0.84, lantern = true } = {}) {
  const k = TIER_CAP[tier];
  // 明るい貝灰のパラペット（屋根の縁取り）
  inner(b, 'ring-parapet', { inset: -0.24 * k, from: base - 0.02, to: base + 0.05 * k });
  // 棟木
  inner(b, 'ring-ridge', { inset: b.w * 0.42, from: 0.985, to: 1 });
  if (!lantern) return;
  // 天窓。俯瞰で屋根に光の点が並ぶ。footprint 内・宿主上端以下。
  const n = tier >= 2 ? 3 : tier === 1 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const ox = ((i + 0.5) / n - 0.5) * b.w * 0.5;
    slab(b, 'roof-lantern', {
      ox, w: Math.min(1.5 * k, b.w * 0.22), d: Math.min(1.1 * k, b.d * 0.3),
      from: 0.985, to: 1,
    });
  }
}

// モジュール3: 軒ブラケット（持ち送り）。軒下に等間隔の影を落とす。
function bracketModule(b, key, seed, { tier = 2, z = 0.8 } = {}) {
  const k = TIER_BAY[tier];
  const n = Math.max(2, Math.round(b.w / (2.4 / k)));
  const th = 0.22 * k + 0.12;
  for (let i = 0; i < n; i++) {
    const ox = ((i + 0.5) / n - 0.5) * (b.w - th * 2);
    if (hash01(seed * 4.13 + i * 2.71) < 0.12) continue;
    slab(b, key, { ox, w: th, d: b.d + 0.5, from: z, to: z + 0.045 });
  }
}

// モジュール4: 積荷（木箱）。3段階の大きさと向きで、同一寸法の当たり判定を隠す。
function crateModule(b, seed, keyBody, keyLid) {
  const r = hash01(seed * 2.311 + 1.7);
  const tier = r < 0.34 ? 0 : r < 0.7 ? 1 : 2;
  const shrink = [0.34, 0.2, 0.09][tier];
  const lidFrom = [0.66, 0.78, 0.87][tier];
  const yaw = (hash01(seed * 6.71) - 0.5) * 0.42;
  const w = Math.max(0.4, b.w - shrink * 2);
  const d = Math.max(0.4, b.d - shrink * 2);
  const zTo = b.zBase + b.h * lidFrom;
  emit(keyBody, t([b.cx, b.cy, (b.zBase + zTo) / 2], [w, d, zTo - b.zBase], [0, 0, yaw]));
  emit(keyLid, t([b.cx, b.cy, (zTo + b.zTop) / 2], [w + 0.1, d + 0.1, b.zTop - zTo], [0, 0, yaw]));
  // 3段目の細部: 締め縄・帯金。小さい木箱には付けない（3スケールの下端）。
  if (tier >= 1) {
    emit('window-hood', t(
      [b.cx, b.cy, b.zBase + b.h * 0.42], [w + 0.06, d + 0.06, 0.09], [0, 0, yaw],
    ));
  }
}

// 妻面・平側に貼る窓帯（拠点建築用の簡易版。3段の丈で反復を割る）。
function windowBand(b, key, seed, { z = 0.5, rows = 1, cells = 3, tier = 1 }) {
  bayModule(b, seed, { rows, cells, zStart: z, zStep: 0.22, tier, key, hoodChance: 0.4 });
}

// ---- 拠点ごとの建築語彙 ------------------------------------------------------
// 5拠点は当たり判定が完全に同一の型抜きなので、差は建築語彙だけで作る。
// 各語彙は「固有の装置」を3スケールで反復させ、形だけ違う同じ広場にならないようにする。

let vocabSeed = 0;

const VOCAB = {
  // 塩窯: 塩を焼く窯のドーム、灰の段、そして煙。垂直に立つ煙の柱が識別子。
  shiogama: {
    mass: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'kiln-body', { inset: 0.2, from: 0.08, to: 0.7 });
      inner(b, 'kiln-arch', { inset: 0.14, from: 0.08, to: 0.56 });
      emit('kiln-dome', t([b.cx, b.cy, b.zBase + b.h * 0.70], [b.w - 0.4, b.d - 0.4, b.h * 0.56]));
      // 銅の焼き締め帯を3段（3スケール反復）
      inner(b, 'kiln-band', { inset: -0.1, from: 0.66, to: 0.715 });
      inner(b, 'kiln-band', { inset: -0.02, from: 0.44, to: 0.475 });
      inner(b, 'kiln-band', { inset: 0.16, from: 0.24, to: 0.265 });
      corners(b, 'site-pilaster', { inset: 0.6, size: 0.5, from: 0.08, to: 0.68 });
      inner(b, 'kiln-ashledge', { inset: -0.14, from: 0.36, to: 0.41 });
      // 灰かき出し口（小さなアーチを3つ）
      for (let i = 0; i < 3; i++) {
        slab(b, 'kiln-arch', {
          ox: (i - 1) * b.w * 0.28, w: b.w * 0.2, d: b.d + 0.2, from: 0.08, to: 0.26,
        });
      }
      // 煙: 台座付きの煙突を大中小の3本。塩窯だけが持つ垂直語彙。
      mast(b, 'kiln-chimney', { dx: b.w * 0.28, radius: 0.17, height: 5.6, baseKey: 'kiln-body', baseSize: b.w * 0.34 });
      mast(b, 'kiln-chimney', { dx: -b.w * 0.3, dy: b.d * 0.18, radius: 0.14, height: 3.6, baseKey: 'kiln-body', baseSize: b.w * 0.24 });
      mast(b, 'kiln-chimney', { dx: -b.w * 0.06, dy: -b.d * 0.24, radius: 0.1, height: 2.1 });
      bracketModule(b, 'ring-eave', s, { tier: 1, z: 0.7 });
    },
    tower: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.22, from: 0, to: 0.07 });
      inner(b, 'kiln-body', { inset: 0.25, from: 0.07, to: 0.64 });
      inner(b, 'kiln-arch', { inset: 0.14, from: 0.07, to: 0.58 });
      emit('kiln-dome', t([b.cx, b.cy, b.zBase + b.h * 0.66], [b.w - 0.5, b.d - 0.5, b.h * 0.6]));
      inner(b, 'kiln-band', { inset: -0.12, from: 0.6, to: 0.66 });
      inner(b, 'kiln-band', { inset: 0.05, from: 0.36, to: 0.40 });
      corners(b, 'site-pilaster', { inset: 0.62, size: 0.52, from: 0.07, to: 0.62 });
      windowBand(b, 'site-window', s, { z: 0.28, rows: 2, cells: 2, tier: 1 });
      // 塩壺を窯の肩に大中小で載せる
      for (const [i, sc] of [[-1, 0.9], [0, 0.62], [1, 0.42]]) {
        slab(b, 'kiln-pot', {
          ox: i * b.w * 0.3, w: b.w * 0.22 * sc + 0.3, d: b.d * 0.22 * sc + 0.3,
          from: 0.9, to: 1,
        });
      }
      mast(b, 'kiln-chimney', { dx: -b.w * 0.24, dy: b.d * 0.2, radius: 0.17, height: 6.4, baseKey: 'kiln-body', baseSize: b.w * 0.3 });
      mast(b, 'site-finial', { radius: 0.12, height: 1.4 });
    },
    cover: (b) => {
      emit('kiln-pot', t([b.cx, b.cy, b.zBase + b.h * 0.60], [b.w - 0.3, b.d - 0.3, b.h * 0.76]));
      inner(b, 'site-plinth', { inset: -0.08, from: 0, to: 0.16 });
      inner(b, 'kiln-band', { inset: -0.04, from: 0.52, to: 0.6 });
      inner(b, 'kiln-band', { inset: 0.1, from: 0.28, to: 0.33 });
    },
    post: (b) => {
      inner(b, 'site-plinth', { inset: -0.06, from: 0, to: 0.2 });
      inner(b, 'kiln-band', { inset: 0.02, from: 0.62, to: 0.72 });
      mast(b, 'kiln-chimney', { radius: 0.14, height: 1.8 });
    },
  },

  // 水市: 段状の競り倉、日除けの布、鎖で吊られた浮標。水平の布と球が識別子。
  mizuichi: {
    mass: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'market-store', { inset: 0.15, from: 0.08, to: 0.6 });
      inner(b, 'market-arch', { inset: 0.08, from: 0.08, to: 0.56 });
      inner(b, 'site-string', { inset: -0.12, from: 0.6, to: 0.65 });
      inner(b, 'market-upper', { inset: 0.55, from: 0.65, to: 0.86 });
      inner(b, 'market-sawroof', { inset: 0.1, from: 0.86, to: 1 });
      corners(b, 'site-pilaster', { inset: 0.6, size: 0.5, from: 0.08, to: 0.6 });
      windowBand(b, 'site-window', s, { z: 0.24, rows: 2, cells: 3, tier: 2 });
      // 競り台と積み荷（3スケール）
      slab(b, 'market-crates', { ox: -b.w * 0.3, w: b.w * 0.28, d: b.d * 0.5, from: 0.08, to: 0.32 });
      slab(b, 'market-crates', { ox: -b.w * 0.3, oy: b.d * 0.2, w: b.w * 0.17, d: b.d * 0.28, from: 0.32, to: 0.46 });
      slab(b, 'market-crates', { ox: -b.w * 0.24, oy: -b.d * 0.16, w: b.w * 0.1, d: b.d * 0.15, from: 0.32, to: 0.4 });
      // 日除けの布を段違いに3枚（水市だけが持つ水平語彙）
      for (const [i, f] of [[-1, 0.58], [0, 0.5], [1, 0.62]]) {
        slab(b, 'market-banner', {
          ox: i * b.w * 0.28, w: b.w * 0.3, d: b.d + 0.4, from: f, to: f + 0.012,
        });
      }
      inner(b, 'market-awning', { inset: -0.3, from: 0.56, to: 0.62 });
      mast(b, 'market-mast', { dx: b.w * 0.3, radius: 0.15, height: 4.2, baseKey: 'market-crates', baseSize: 0.8 });
      slab(b, 'market-buoy', { ox: b.w * 0.3, w: 0.72, d: 0.72, from: 0.92, to: 1 });
      bracketModule(b, 'ring-eave', s, { tier: 2, z: 0.62 });
    },
    tower: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'market-store', { inset: 0.3, from: 0.08, to: 0.52 });
      inner(b, 'site-string', { inset: -0.1, from: 0.52, to: 0.57 });
      inner(b, 'market-upper', { inset: 0.9, from: 0.57, to: 0.94 });
      inner(b, 'market-awning', { inset: -0.06, from: 0.94, to: 1 });
      corners(b, 'site-pilaster', { inset: 0.7, size: 0.5, from: 0.08, to: 0.52 });
      windowBand(b, 'site-window', s, { z: 0.2, rows: 2, cells: 2, tier: 1 });
      slab(b, 'market-banner', { w: b.w + 0.3, d: b.d * 0.5, from: 0.55, to: 0.562 });
      mast(b, 'market-mast', { radius: 0.17, height: 7.0, baseKey: 'market-upper', baseSize: 0.9 });
      slab(b, 'market-buoy', { w: 0.66, d: 0.66, from: 0.86, to: 0.94 });
    },
    cover: (b) => {
      inner(b, 'market-stall', { inset: 0.16, from: 0, to: 0.64 });
      inner(b, 'site-string', { inset: -0.05, from: 0.64, to: 0.72 });
      inner(b, 'market-awning', { inset: -0.02, from: 0.78, to: 1 });
      slab(b, 'market-banner', { w: b.w + 0.2, d: b.d * 0.62, from: 0.74, to: 0.752 });
    },
    post: (b) => {
      inner(b, 'market-store', { inset: 0.12, from: 0, to: 0.6 });
      emit('market-buoy', t([b.cx, b.cy, b.zTop + 0.18], [THIN_M, THIN_M, THIN_M]));
      inner(b, 'window-hood', { inset: -0.05, from: 0.6, to: 0.68 });
    },
  },

  // 角: 乾ドックに架かる船体の曲面、盤木、進水レール。水平に伸びる船腹が識別子。
  kado: {
    mass: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.07 });
      inner(b, 'dock-cradle', { inset: 0.22, from: 0.07, to: 0.34 });
      emit('dock-hull', t([b.cx, b.cy, b.zBase + b.h * 0.66], [b.w - 0.5, b.d - 0.45, b.h * 0.62]));
      inner(b, 'dock-waterline', { inset: -0.16, from: 0.5, to: 0.55 });
      inner(b, 'dock-keel', { inset: b.w * 0.4, from: 0.3, to: 0.38 });
      rib(b, 'dock-strut', 5, { thickness: 0.34, from: 0.07, to: 0.34 });
      rib(b, 'dock-plate', 4, { thickness: 0.2, from: 0.68, to: 0.95, alongDepth: true });
      corners(b, 'dock-bollard', { inset: 0.55, size: 0.5, from: 0, to: 0.2 });
      // 進水レール2本（角だけが持つ床の語彙）
      for (const sy of [-1, 1]) {
        slab(b, 'dock-blocking', {
          oy: sy * b.d * 0.24, w: b.w - 0.4, d: 0.34, from: 0.02, to: 0.075,
        });
      }
      // 盤木を3スケールで積む
      for (const [i, sc] of [[-1, 1.0], [0, 0.68], [1, 0.44]]) {
        slab(b, 'dock-blocking', {
          ox: i * b.w * 0.26, w: b.w * 0.14 * sc + 0.3, d: b.d * 0.4 * sc + 0.2,
          from: 0.07, to: 0.07 + 0.14 * sc,
        });
      }
      mast(b, 'market-mast', { dx: b.w * 0.24, radius: 0.15, height: 4.4, baseKey: 'dock-blocking', baseSize: 0.8 });
      bracketModule(b, 'dock-plate', s, { tier: 0, z: 0.62 });
    },
    tower: (b, s) => {
      rib(b, 'dock-strut', 4, { thickness: 0.42, from: 0, to: 0.88, alongDepth: true });
      inner(b, 'dock-gantry', { inset: 0.15, from: 0.88, to: 1 });
      inner(b, 'dock-waterline', { inset: -0.1, from: 0.44, to: 0.5 });
      inner(b, 'dock-waterline', { inset: 0.16, from: 0.2, to: 0.235 });
      corners(b, 'site-pilaster', { inset: 0.6, size: 0.45, from: 0, to: 0.88 });
      windowBand(b, 'site-window', s, { z: 0.55, rows: 2, cells: 2, tier: 0 });
      mast(b, 'site-finial', { radius: 0.12, height: 1.8 });
      mast(b, 'dock-bollard', { dx: b.w * 0.26, radius: 0.13, height: 1.1 });
    },
    cover: (b) => {
      inner(b, 'dock-cradle', { inset: 0.14, from: 0, to: 0.52 });
      emit('dock-hull', t([b.cx, b.cy, b.zBase + b.h * 0.78], [b.w - 0.35, b.d - 0.3, b.h * 0.4]));
      inner(b, 'dock-waterline', { inset: -0.04, from: 0.52, to: 0.58 });
      slab(b, 'dock-blocking', { oy: -b.d * 0.3, w: b.w * 0.7, d: b.d * 0.2, from: 0, to: 0.22 });
    },
    post: (b) => {
      emit('dock-bollard', t([b.cx, b.cy, b.zBase + b.h * 0.5], [0.72, 0.72, b.h]));
      inner(b, 'dock-waterline', { inset: -0.04, from: 0.7, to: 0.8 });
      mast(b, 'site-finial', { radius: 0.1, height: 0.6 });
    },
  },

  // 網: 閘門の扉、巻上機、網を干す枠。垂直の格子と円い巻胴が識別子。
  ami: {
    mass: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'lock-house', { inset: 0.16, from: 0.08, to: 0.72 });
      inner(b, 'lock-arch', { inset: 0.09, from: 0.08, to: 0.68 });
      inner(b, 'lock-lattice', { inset: 0.3, from: 0.2, to: 0.64 });
      inner(b, 'site-string', { inset: -0.12, from: 0.72, to: 0.77 });
      inner(b, 'lock-roof', { inset: -0.05, from: 0.77, to: 1 });
      rib(b, 'lock-gate', 6, { thickness: 0.28, from: 0.08, to: 0.58, alongDepth: true });
      corners(b, 'site-pilaster', { inset: 0.6, size: 0.5, from: 0.08, to: 0.72 });
      windowBand(b, 'site-window', s, { z: 0.3, rows: 2, cells: 3, tier: 2 });
      // 巻上機の胴を大中小で3基（網だけが持つ円い語彙）
      for (const [i, sc] of [[-1, 1.0], [0, 0.66], [1, 0.44]]) {
        slab(b, 'lock-winch', {
          ox: i * b.w * 0.27, w: 0.9 * sc + 0.2, d: 0.9 * sc + 0.2,
          from: 0.72, to: 0.72 + 0.2 * sc,
        });
      }
      // 水位標尺
      slab(b, 'dock-waterline', { ox: b.w * 0.36, w: 0.3, d: b.d + 0.3, from: 0.1, to: 0.66 });
      mast(b, 'lock-vane', { dx: b.w * 0.3, radius: 0.13, height: 3.2, baseKey: 'lock-house', baseSize: 0.7 });
      bracketModule(b, 'ring-eave', s, { tier: 1, z: 0.735 });
    },
    tower: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'lock-house', { inset: 0.35, from: 0.08, to: 0.68 });
      inner(b, 'lock-lattice', { inset: 0.75, from: 0.24, to: 0.6 });
      inner(b, 'lock-roof', { inset: -0.1, from: 0.68, to: 1 });
      corners(b, 'site-pilaster', { inset: 0.62, size: 0.45, from: 0.08, to: 0.68 });
      windowBand(b, 'site-window', s, { z: 0.24, rows: 2, cells: 2, tier: 1 });
      slab(b, 'lock-winch', { w: 1.0, d: 1.0, from: 0.6, to: 0.72 });
      mast(b, 'lock-vane', { radius: 0.15, height: 3.0, baseKey: 'lock-house', baseSize: 0.8 });
    },
    cover: (b) => {
      rib(b, 'lock-netframe', 5, { thickness: 0.22, from: 0.1, to: 1 });
      inner(b, 'site-plinth', { inset: -0.05, from: 0, to: 0.12 });
      inner(b, 'lock-lattice', { inset: 0.24, from: 0.2, to: 0.92 });
    },
    post: (b) => {
      emit('lock-gate', t([b.cx, b.cy, b.zBase + b.h * 0.5], [b.w - 0.1, b.d - 0.05, b.h]));
      inner(b, 'dock-waterline', { inset: -0.03, from: 0.66, to: 0.76 });
      mast(b, 'lock-vane', { radius: 0.1, height: 0.8 });
    },
  },

  // 風見: 組みかけの竜骨と足場、風を読む見張り。骨組みの隙間が識別子。
  kazami: {
    mass: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'slip-keel', { inset: 0.3, from: 0.08, to: 0.24 });
      rib(b, 'slip-rib', 8, { thickness: 0.38, from: 0.24, to: 0.95 });
      inner(b, 'slip-colonnade', { inset: 0.5, from: 0.24, to: 0.88 });
      // 足場を3層（風見だけが持つ水平の段）
      inner(b, 'slip-scaffold', { inset: -0.14, from: 0.52, to: 0.565 });
      inner(b, 'slip-scaffold', { inset: -0.14, from: 0.76, to: 0.805 });
      inner(b, 'slip-scaffold', { inset: 0.1, from: 0.32, to: 0.355 });
      corners(b, 'site-pilaster', { inset: 0.55, size: 0.42, from: 0.08, to: 0.9 });
      // 起重機の斜梁を3スケールで
      for (const [i, sc] of [[-1, 1.0], [0, 0.62], [1, 0.4]]) {
        slab(b, 'slip-timber', {
          ox: i * b.w * 0.24, w: b.w * 0.1 * sc + 0.24, d: b.d + 0.3,
          from: 0.9, to: 0.9 + 0.09 * sc,
        });
      }
      mast(b, 'slip-vane', { dx: -b.w * 0.32, radius: 0.15, height: 4.8, baseKey: 'slip-keel', baseSize: 0.75 });
      windowBand(b, 'site-window', s, { z: 0.36, rows: 2, cells: 2, tier: 0, });
    },
    tower: (b, s) => {
      inner(b, 'site-plinth', { inset: -0.2, from: 0, to: 0.08 });
      inner(b, 'slip-keel', { inset: 0.28, from: 0.08, to: 0.6 });
      inner(b, 'slip-scaffold', { inset: -0.1, from: 0.6, to: 0.66 });
      emit('slip-cap', t([b.cx, b.cy, b.zBase + b.h * 0.78], [b.w - 0.7, b.d - 0.7, b.h * 0.4]));
      corners(b, 'site-pilaster', { inset: 0.6, size: 0.45, from: 0.08, to: 0.6 });
      windowBand(b, 'site-window', s, { z: 0.3, rows: 2, cells: 2, tier: 1 });
      mast(b, 'slip-vane', { radius: 0.17, height: 4.0, baseKey: 'slip-keel', baseSize: 0.8 });
    },
    cover: (b) => {
      rib(b, 'slip-timber', 4, { thickness: 0.34, from: 0, to: 0.78, alongDepth: true });
      inner(b, 'slip-keel', { inset: 0.2, from: 0.78, to: 1 });
      inner(b, 'slip-scaffold', { inset: -0.04, from: 0.56, to: 0.605 });
    },
    post: (b) => {
      inner(b, 'site-plinth', { inset: -0.05, from: 0, to: 0.25 });
      inner(b, 'slip-scaffold', { inset: 0.02, from: 0.6, to: 0.7 });
      mast(b, 'slip-vane', { radius: 0.13, height: 2.2 });
    },
  },
};

// 全拠点共通: 目標パッドの石畳と、階段の側桁。
function commonPad(b) {
  emit('site-paving', t([b.cx, b.cy, b.zTop - 0.03], [b.w - 0.6, b.d - 0.6, 0.06]));
}
function commonStair(b) {
  emit('stair-stringer', t([b.cx, b.cy, b.zBase + b.h * 0.5], [b.w - 0.12, b.d - 0.12, b.h * 0.94]));
}

// ---- 中央コア（canonical-* の宿主）------------------------------------------
// 中央コアの新規被覆は担当 C（map_oshioi_core_cladding.js）へ移管した。
// ここは既存分をそのまま維持する（削ると C が入るまで中央が素の箱に戻るため）。
// map_oshioi.js を import すると循環するので、宿主の座標をここに明示する。
// 値がずれたら containment テストが即座に落ちるので、黙って嘘にはならない。
function rot180Host(host) {
  return {
    min: [-host.max[0], -host.max[1], host.min[2]],
    max: [-host.min[0], -host.min[1], host.max[2]],
    role: host.role,
    vocab: host.vocab,
  };
}

const CORE_HOSTS_HALF = [
  // 大灯柱（市場通り40mを分割する主役。z=4→9）
  { min: [19.2, -0.8, 4], max: [20.8, 0.8, 9], role: 'tower', vocab: 'shiogama' },
  // 市場の木箱（半身遮蔽 z=4→5.5）
  { min: [13.4, 7.4, 4], max: [14.9, 8.9, 5.5], role: 'cover', vocab: 'mizuichi' },
  { min: [25.4, -12.6, 4], max: [26.9, -11.1, 5.5], role: 'cover', vocab: 'mizuichi' },
  { min: [11.0, -14.8, 4], max: [12.5, -13.3, 5.5], role: 'cover', vocab: 'mizuichi' },
  { min: [28.0, 10.0, 4], max: [29.5, 11.5, 5.5], role: 'cover', vocab: 'mizuichi' },
  // 渚の岩（下段の半身遮蔽 z=0→1.6）
  { min: [33, -15, 0], max: [35, -13, 1.6], role: 'cover', vocab: 'kado' },
  { min: [17, -29, 0], max: [19, -27, 1.6], role: 'cover', vocab: 'kado' },
  { min: [-1, 29, 0], max: [1, 31, 1.6], role: 'cover', vocab: 'kado' },
  // 潮見庭ブリッジの縁石（z=4→4.8）
  { min: [32, 2.7, 4], max: [38, 3, 4.8], role: 'post', vocab: 'ami' },
  { min: [32, -3, 4], max: [38, -2.7, 4.8], role: 'post', vocab: 'ami' },
  // 回廊接続ブリッジの縁石
  { min: [40, 8, 4], max: [40.3, 20, 4.8], role: 'post', vocab: 'ami' },
  { min: [42.7, 8, 4], max: [43, 20, 4.8], role: 'post', vocab: 'ami' },
];

// 北回廊の内壁（3m窓間隔で並ぶ低壁 z=4→6.2）。列柱と格子で回廊らしくする。
const CLOISTER_HOSTS = [];
for (let x = -40; x < 40; x += 8) {
  CLOISTER_HOSTS.push({ min: [x, 20, 4], max: [x + 5, 20.4, 6.2], role: 'cloister' });
}

const CORE_HOSTS = [];
for (const host of CORE_HOSTS_HALF) {
  CORE_HOSTS.push(host);
  CORE_HOSTS.push(rot180Host(host));
}
for (const host of CLOISTER_HOSTS) {
  CORE_HOSTS.push(host);
  CORE_HOSTS.push(rot180Host(host));
}

for (const host of CORE_HOSTS) {
  const b = box(host);
  if (host.role === 'cloister') {
    // 回廊の腰壁窓: 列柱＋格子＋笠石。柱間3mの列柱が連続する屋内路の表情を作る。
    inner(b, 'core-cloisterbase', { inset: -0.06, from: 0, to: 0.16 });
    inner(b, 'core-colonnade', { inset: 0.1, from: 0.16, to: 0.86 });
    inner(b, 'core-lattice', { inset: 0.02, from: 0.3, to: 0.8 });
    inner(b, 'core-coping', { inset: -0.1, from: 0.86, to: 1 });
    continue;
  }
  const vocab = VOCAB[host.vocab];
  if (!vocab) continue;
  vocabSeed += 1;
  activeSite = host.vocab;
  vocab[host.role](b, vocabSeed);
  activeSite = null;
}

const SHIOGAMA_HOSTS = [
  // 井桁（ボウル中央の全身遮蔽）→ 塩窯の本体
  { min: [-1.25, -1.25, 2.5], max: [1.25, 1.25, 5.0], role: 'mass' },
  // 灯籠櫓 北 / 南 → 大窯
  { min: [-3, 10, 4], max: [3, 16, 8], role: 'tower' },
  { min: [-3, -16, 4], max: [3, -10, 8], role: 'tower' },
  // 潮壺 ×4（半身遮蔽）→ 塩壺
  { min: [3.2, 3.2, 2.5], max: [4.0, 4.0, 3.7], role: 'cover' },
  { min: [-4.0, 3.2, 2.5], max: [-3.2, 4.0, 3.7], role: 'cover' },
  { min: [3.2, -4.0, 2.5], max: [4.0, -3.2, 3.7], role: 'cover' },
  { min: [-4.0, -4.0, 2.5], max: [-3.2, -3.2, 3.7], role: 'cover' },
];

for (const host of SHIOGAMA_HOSTS) {
  const b = box(host);
  vocabSeed += 1;
  activeSite = 'shiogama';
  if (host.role === 'mass') VOCAB.shiogama.mass(b, vocabSeed);
  else if (host.role === 'tower') VOCAB.shiogama.tower(b, vocabSeed);
  else VOCAB.shiogama.cover(b, vocabSeed);
  activeSite = null;
}

// ---- 移動リングの港湾街区 ----------------------------------------------------
// 178棟。ここが「まだ箱に見える」と指摘された本体。
// 屋根5材質×形状4種、庇・出窓・雨戸、3スケールのベイで塊を建物に変える。

// 屋根の族。材質と形状の組を5つ持ち、建物ごとに切り替える。
// 上から見て暗い平屋根が支配的、という指摘への直接の対策。
const ROOF_FAMILY = [
  { key: 'roof-hip-blue', kind: 'hip' },        // hipRoof / roofBlue
  { key: 'roof-saw-copper', kind: 'saw' },      // sawRoof / roofCopper
  { key: 'roof-barrel-pale', kind: 'barrel' },  // barrelRoof / shellShade（明るい貝灰の丸屋根）
  { key: 'roof-hip-plaster', kind: 'hip' },     // hipRoof / copperPlaster（焼けた赤褐）
  { key: 'roof-saw-dark', kind: 'saw' },        // sawRoof / basalt（濡れた暗色）
  { key: 'roof-barrel-warm', kind: 'barrel' },  // barrelRoof / roofCopper（焼けた銅の丸屋根）
  { key: 'roof-hip-sand', kind: 'hip' },        // hipRoof / shellShade（砂色の寄棟）
];

// 街区の材質は「最寄りの拠点」で決める。
// 検証で「4拠点の材質比が同順位・同比率で、色では拠点を判別できない」と出た。
// 幾何は 75〜85% が固有なのに、拠点±24m を占めるのはリング街区（共通材質）だった。
// 街区の壁と屋根の族を地区ごとに割り当てて、遠くからでも色で現在地が分かるようにする。
const DISTRICTS = [
  { id: 'mizuichi', x: 56, y: 44, store: 'ring-store', roofBias: 2 },        // 水市 = 貝灰の白
  { id: 'kado', x: 56, y: -44, store: 'ring-store-warm', roofBias: 1 },      // 角   = 焼けた赤褐
  { id: 'ami', x: -56, y: 44, store: 'ring-store-sand', roofBias: 0 },       // 網   = 砂色
  { id: 'kazami', x: -56, y: -44, store: 'ring-store-cedar', roofBias: 5 },  // 風見 = 杉
];

function districtOf(x, y) {
  let best = DISTRICTS[0];
  let bestD = Infinity;
  for (const district of DISTRICTS) {
    const d = Math.hypot(x - district.x, y - district.y);
    if (d < bestD) { bestD = d; best = district; }
  }
  return best;
}

function cladRingStore(b, seed) {
  const r1 = hash01(seed * 3.137);
  const r2 = hash01(seed * 7.719 + 2.1);
  const tall = b.h > 9;
  // 3スケール階層。同じモジュールを大・中・小で使い回す。
  const tier = b.h > 13 ? 2 : b.h > 7.5 ? 1 : 0;

  // 基壇・胴蛇腹・軒蛇腹の3本の水平線。塊を「階を持つ建物」に見せる最小構成。
  inner(b, 'ring-plinth', { inset: -0.22, from: 0, to: 0.07 });
  inner(b, 'ring-string', { inset: -0.12, from: tall ? 0.48 : 0.56, to: tall ? 0.53 : 0.61 });
  inner(b, 'ring-cornice', { inset: -0.28, from: 0.79, to: 0.85 });
  // 四隅の付柱で縦線を出す
  corners(b, 'ring-pilaster', { inset: 0.75, size: 0.6, from: 0.06, to: 0.8 });

  // 本体と上階（壁材質は地区で分ける）
  const district = districtOf(b.cx, b.cy);
  inner(b, district.store, { inset: 0.18, from: 0, to: tall ? 0.52 : 0.62 });
  inner(b, 'ring-upper', { inset: 0.62, from: tall ? 0.52 : 0.62, to: 0.84 });

  // 開口ベイ（3スケール・位相ずらし・欠落・銅の庇）
  bayModule(b, seed, {
    rows: tier + 2, cells: 2 + Math.floor(r1 * 3), zStart: tall ? 0.26 : 0.32,
    zStep: tall ? 0.17 : 0.2, tier, dropout: 0.18, hoodChance: 0.34,
  });
  // 中スケールのベイを妻側の上階にもう一段（同じ部品の縮小反復）
  if (tier >= 1) {
    bayModule(b, seed + 911, {
      rows: 1, cells: 2, zStart: 0.68, zStep: 0.1, tier: tier - 1,
      dropout: 0.12, hoodChance: 0.5,
    });
  }
  // 軒ブラケット（横方向の影の列）
  bracketModule(b, 'ring-eave', seed, { tier, z: tall ? 0.5 : 0.6 });

  // 付属屋: 本体より低い小屋を側面に寄せる。シルエットに段差が生まれる。
  if (seed % 2 === 0) {
    slab(b, 'ring-annex', { ox: b.w * 0.26, w: b.w * 0.42, d: b.d * 0.62, from: 0, to: 0.38 });
    slab(b, 'ring-annexroof', { ox: b.w * 0.26, w: b.w * 0.46, d: b.d * 0.66, from: 0.38, to: 0.47 });
  }
  // 戸口の枠
  inner(b, 'ring-doorframe', { inset: b.w * 0.34, from: 0, to: 0.3 });

  // ---- 屋根 ----
  // 検証で「上から見ると暗い平屋根が依然として支配的。勾配・曲面屋根は247しかない」。
  // 屋根の族を7つへ増やし、地区ごとに偏りを与えて（roofBias）色数も増やす。
  const roofBase = 0.84;
  const famA = ROOF_FAMILY[(seed + district.roofBias) % ROOF_FAMILY.length];
  if (b.w > 7.2 || tier === 2) {
    // 大屋根は2枚に割り、材質と高さを変えて段差を作る。
    const famB = ROOF_FAMILY[(seed * 3 + 2 + district.roofBias) % ROOF_FAMILY.length];
    slab(b, famA.key, { ox: -b.w * 0.25, w: b.w * 0.5 + 0.3, d: b.d + 0.3, from: roofBase, to: 1 });
    slab(b, famB.key, { ox: b.w * 0.25, w: b.w * 0.5 + 0.3, d: b.d + 0.3, from: roofBase - 0.04, to: 0.955 });
    // 谷の樋（暗い線が2枚の屋根を分ける）
    slab(b, 'ring-eave', { w: 0.42, d: b.d + 0.3, from: roofBase - 0.05, to: roofBase + 0.01 });
  } else {
    inner(b, famA.key, { inset: -0.15, from: roofBase, to: 1 });
  }
  // 屋根の上の第2形状（spire を2種の材質で使う。俯瞰の点景）
  if (seed % 4 === 1) {
    slab(b, 'ring-dome', { ox: -b.w * 0.2, w: Math.min(2.4, b.w * 0.3), d: Math.min(2.4, b.d * 0.4), from: 0.86, to: 1 });
  } else if (seed % 4 === 3) {
    slab(b, 'ring-spire', { ox: b.w * 0.18, w: Math.min(2.0, b.w * 0.26), d: Math.min(2.0, b.d * 0.34), from: 0.87, to: 1 });
  }
  // 頂部キャップ（パラペット・棟木・天窓）
  capModule(b, seed, { tier, base: roofBase });
  // 屋上の水槽（木箱モジュールの中スケール転用）
  if (seed % 5 === 2) {
    slab(b, 'ring-doorframe', {
      ox: b.w * 0.22, oy: -b.d * 0.2, w: Math.min(1.8, b.w * 0.24), d: Math.min(1.6, b.d * 0.3),
      from: 0.94, to: 1,
    });
  }

  // 街路に面した開口。3棟に1棟はアーチ、次は列柱、残りは格子にして反復を崩す。
  const faceKey = ['ring-arch', 'ring-colonnade', 'ring-lattice'][seed % 3];
  inner(b, faceKey, { inset: 0.1, from: 0, to: tall ? 0.5 : 0.6 });
  // アーチ帯を上階にもう一段（原則7の曲線開口を増やす。archWall は218三角形と安い）
  if (tier >= 1 && r2 > 0.45) {
    inner(b, 'ring-arch', { inset: 0.34, from: tall ? 0.54 : 0.64, to: 0.8 });
  }
  // 丸屋根の庇（barrelRoof を庇として横に使う。曲線要素の増量）
  if (r2 < 0.55) {
    slab(b, 'roof-barrel-copper', {
      oy: b.d * 0.02, w: b.w + 0.3, d: b.d * 0.34,
      from: tall ? 0.47 : 0.57, to: tall ? 0.53 : 0.63,
    });
  }

  // 細い垂直要素（すべて 0.34m 以下 + 宿主内の台座）
  mast(b, 'ring-flue', {
    dx: b.w * 0.3, dy: b.d * 0.22, radius: 0.15, height: tall ? 4.2 : 2.8,
    baseKey: 'ring-plinth', baseSize: Math.min(1.4, b.w * 0.22),
  });
  if (seed % 5 === 0) {
    mast(b, 'ring-spire', { radius: 0.17, height: 4.4, baseKey: 'ring-cornice', baseSize: Math.min(1.6, b.w * 0.24) });
  }
  if (seed % 3 === 1) {
    const finial = hash01(seed * 9.71 + 0.47);
    mast(b, 'ring-finial', {
      radius: 0.10 + finial * 0.07,
      height: 0.78 + finial * 1.08,
    });
  }
}

function cladRingCrate(b, seed) {
  // 木箱の蓋も屋根形状で回す。148個あるので「暗い平屋根」の主因のひとつだった。
  const lid = ['roof-barrel-copper', 'roof-hip-sand', 'ring-cratelid',
    'roof-saw-copper', 'roof-barrel-warm'][seed % 5];
  crateModule(b, seed, 'ring-crate', lid);
}

function cladRingDeck(b, seed) {
  inner(b, 'ring-deck', { inset: 0.2, from: 0, to: 0.86 });
  inner(b, 'ring-deckrail', { inset: -0.12, from: 0.86, to: 1 });
  // 桟橋台の縁に明るいパラペットと灯り。高所の輪郭を上から読めるようにする。
  inner(b, 'ring-parapet', { inset: -0.2, from: 0.8, to: 0.87 });
  for (let i = 0; i < 4; i++) {
    const ox = ((i + 0.5) / 4 - 0.5) * b.w * 0.8;
    slab(b, 'roof-lantern', { ox, w: 0.9, d: b.d * 0.5, from: 0.97, to: 1 });
    slab(b, 'ring-eave', { ox, oy: b.d * 0.36, w: 0.5, d: 0.5, from: 0.86, to: 0.98 });
  }
  bracketModule(b, 'ring-eave', seed, { tier: 2, z: 0.72 });
  mast(b, 'ring-flue', { dx: -b.w * 0.34, radius: 0.15, height: 3.2, baseKey: 'ring-deckrail', baseSize: 1.2 });
}

// 甲板の欄干ソリッド（13.0 x 0.4 x 1.25）にも被覆を掛ける。
function cladRingDeckRail(b, seed) {
  inner(b, 'ring-deckrail', { inset: 0.03, from: 0.55, to: 0.95 });
  inner(b, 'ring-plinth', { inset: -0.02, from: 0, to: 0.16 });
  const n = 9;
  for (let i = 0; i < n; i++) {
    const ox = ((i + 0.5) / n - 0.5) * (b.w - 0.6);
    if (hash01(seed * 3.3 + i) < 0.1) continue;
    slab(b, 'ring-pilaster', { ox, w: 0.3, d: b.d + 0.1, from: 0, to: 0.62 });
  }
}

const RING_RE = /^ring-(store|crate|deck|deckstair|deckrail)-/;

let ringSeed = 0;
for (const solid of buildOshioiRingGeometry().solids) {
  const match = RING_RE.exec(solid.id);
  if (!match) continue;
  const b = box(solid);
  ringSeed += 1;
  if (match[1] === 'store') cladRingStore(b, ringSeed);
  else if (match[1] === 'crate') cladRingCrate(b, ringSeed);
  else if (match[1] === 'deck') cladRingDeck(b, ringSeed);
  else if (match[1] === 'deckrail') cladRingDeckRail(b, ringSeed);
  else commonStair(b);
}

// ---- 地面 ----
// 宿主はリング床（flash-ring-*-floor、上端 z=4）。厚み 0.02 の面を z=4.015 に置くので
// 宿主上端 +0.05 の許容内に収まり、偽の遮蔽にはならない。
const GROUND_Z = 4.015;

// 回転後のXY AABBが宿主床の内側に完全に収まる場合だけ敷く。
function emitRoad(key, ax, ay, bx, by, width, floors) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1.5) return;
  const yaw = Math.atan2(dy, dx);
  const halfX = Math.abs(Math.cos(yaw)) * length / 2 + Math.abs(Math.sin(yaw)) * width / 2;
  const halfY = Math.abs(Math.sin(yaw)) * length / 2 + Math.abs(Math.cos(yaw)) * width / 2;
  const cx = (ax + bx) / 2;
  const cy = (ay + by) / 2;
  const fits = floors.some(floor => cx - halfX >= floor.min[0] && cx + halfX <= floor.max[0]
    && cy - halfY >= floor.min[1] && cy + halfY <= floor.max[1]);
  if (!fits) return;
  emit(key, t([cx, cy, GROUND_Z], [length, width, 0.02], [0, 0, yaw]));
}

{
  const runtime = buildOshioiFlashpointGeometry();
  const floors = runtime.solids.filter(solid => /^flash-ring-(east|west|north|south)-floor$/.test(solid.id));
  let laneIndex = 0;
  for (const source of [runtime.routesBySite, runtime.highGroundRoutesBySite]) {
    for (const sides of Object.values(source || {})) {
      for (const lanes of Object.values(sides || {})) {
        for (const route of Object.values(lanes || {})) {
          const points = Array.isArray(route) ? route : route?.points;
          if (!Array.isArray(points)) continue;
          laneIndex += 1;
          const primary = laneIndex % 3 === 0;
          const key = primary ? 'ground-avenue' : 'ground-lane';
          for (let i = 1; i < points.length; i++) {
            const [ax, ay] = points[i - 1];
            const [bx, by] = points[i];
            emitRoad(key, ax, ay, bx, by, primary ? 9 : 6, floors);
          }
        }
      }
    }
  }

  // 水路（潮の運河）。床の単調さを断ち、拠点間の帯に方向を与える。
  for (const floor of floors) {
    const midY = (floor.min[1] + floor.max[1]) / 2;
    const midX = (floor.min[0] + floor.max[0]) / 2;
    const spanX = floor.max[0] - floor.min[0];
    const spanY = floor.max[1] - floor.min[1];
    const alongY = spanY > spanX;
    const length = (alongY ? spanY : spanX) - 24;
    if (length < 20) continue;
    for (const offset of [-0.28, 0.28]) {
      const cx = alongY ? midX + spanX * offset : midX;
      const cy = alongY ? midY : midY + spanY * offset;
      emit('ground-canal', t([cx, cy, GROUND_Z + 0.004],
        alongY ? [5.5, length, 0.02] : [length, 5.5, 0.02]));
      emit('ground-canalrim', t([cx, cy, GROUND_Z + 0.002],
        alongY ? [7.2, length + 2, 0.02] : [length + 2, 7.2, 0.02]));
    }
  }

  // ---- 浮き玉灯籠の連なり（設計書§12 / 原則1 の第2層）------------------------
  // 検証: 「プレイ領域内の 73.7% が 6m 未満。近景建築 6〜25m が 14.8% しかなく、
  // 遠景都市と足元の間が空洞」。街路の上に灯の索を張って 8〜13m 帯を埋める。
  //
  // 安全規則: 宿主（リング床、上端 4.0）より上へ出せるのは XY 0.8m 以下。
  // 索そのものは長辺が 0.8m を超えるので置けない。0.34m の吊り柱と 0.52〜0.72m の
  // 浮き玉を 1.6m 間隔で並べ、**灯の列そのものを索に見せる**。
  const LANTERN_BUDGET = 1250;
  let lanterns = 0;
  // 7本に1つだけ頂冠を抜く。5〜8 span の範囲に収めた固定周期なので、
  // 乱数の偶然ではなくレビュー可能な手仕事のリズムとして再現できる。
  const FINIAL_SKIP_SPAN = 7;
  let stringFinialOrdinal = 0;
  const fitsFloor = (x, y, half) => floors.some(floor => x - half >= floor.min[0]
    && x + half <= floor.max[0] && y - half >= floor.min[1] && y + half <= floor.max[1]);

  const stringLine = (ax, ay, bx, by, seed) => {
    const dx = bx - ax;
    const dy = by - ay;
    const length = Math.hypot(dx, dy);
    if (length < 6) return;
    const ux = dx / length;
    const uy = dy / length;
    const spans = Math.max(1, Math.round(length / 9.5));
    // 端点を均等割りすると、隣接 span が同じ支柱・同じ金冠を二重に生成し、
    // 遠景では機械的な等間隔の列に見えた。共有する境界表を一度だけ立て、
    // 決定論的な小さな揺らぎを入れることで、索と支柱の接続を保ったまま
    // 反復を自然な港のリズムへ戻す。
    const boundaryAt = (index) => {
      if (index === 0) return 0;
      if (index === spans) return length;
      const base = index / spans;
      const jitter = (hash01(seed * 19.73 + index * 11.17) - 0.5) * 0.18 / spans;
      return (base + jitter) * length;
    };
    const boundaries = Array.from({ length: spans + 1 }, (_, index) => boundaryAt(index));
    const poleTops = boundaries.map((_, index) =>
      9.2 + ((index + seed) % 4) * 1.75 + (hash01(seed * 7.91 + index) - 0.5) * 0.42);
    const finialPhase = Math.floor(hash01(seed * 23.17 + 0.61) * FINIAL_SKIP_SPAN);

    // 吊り柱は line ごとに一度だけ生成する。端点を前後の span で重ねない。
    for (let index = 0; index < boundaries.length; index++) {
      const tt = boundaries[index];
      const top = poleTops[index];
      const px = ax + ux * tt;
      const py = ay + uy * tt;
      if (!fitsFloor(px, py, 0.5)) continue;
      emit('ring-pilaster', t([px, py, (GROUND_Z + top) / 2], [0.34, 0.34, top - GROUND_Z]));
      emit('ring-eave', t([px, py, top - 0.24], [0.62, 0.62, 0.28]));
      const skipFinial = (stringFinialOrdinal + finialPhase) % FINIAL_SKIP_SPAN === 0;
      stringFinialOrdinal += 1;
      if (skipFinial) continue;
      const tallCrown = hash01(seed * 5.77 + index * 3.11) >= 0.5;
      const finialScale = tallCrown ? 0.42 : 0.32;
      const finialHeight = tallCrown ? 1.08 : 0.72;
      emit('ring-finial', t([px, py, top + finialHeight / 2],
        [finialScale, finialScale, finialHeight]));
    }
    for (let s = 0; s < spans; s++) {
      if (lanterns >= LANTERN_BUDGET) return;
      const t0 = boundaries[s];
      const t1 = boundaries[s + 1];
      const top0 = poleTops[s];
      const top1 = poleTops[s + 1];
      const sag = 1.0 + ((s + seed) % 3) * 0.4;
      // 索は短い直交ボックスへ分割する。長い一本線を置くと「細くても
      // 偽の遮蔽」になり得るため、各片は0.72m未満に留める。両端の帆柱へ
      // 実際に接続し、灯籠の吊り紐もこの線へ届くようにする。
      const cordPoint = (f) => {
        const top = top0 + (top1 - top0) * f;
        return [
          ax + ux * (t0 + (t1 - t0) * f),
          ay + uy * (t0 + (t1 - t0) * f),
          top - Math.sin(f * Math.PI) * sag,
        ];
      };
      const cordSteps = Math.max(1, Math.ceil((t1 - t0) / 0.62));
      for (let i = 0; i < cordSteps; i++) {
        const start = cordPoint(i / cordSteps);
        const end = cordPoint((i + 1) / cordSteps);
        const cx = (start[0] + end[0]) / 2;
        const cy = (start[1] + end[1]) / 2;
        const horizontalLength = Math.hypot(end[0] - start[0], end[1] - start[1]);
        if (!fitsFloor(cx, cy, 0.5)) continue;
        emit('ring-lantern-cord', t(
          [cx, cy, (start[2] + end[2]) / 2],
          [Math.min(0.76, horizontalLength + 0.05), 0.12, 0.12],
          [0, 0, Math.atan2(end[1] - start[1], end[0] - start[0])],
        ));
      }
      // 索に連なる浮き玉。3段の大きさで反復を割る。各玉は上の索まで
      // 細い吊り紐を持つので、光点が空中で止まって見えない。
      const steps = Math.max(2, Math.round((t1 - t0) / 1.6));
      for (let i = 1; i < steps; i++) {
        if (lanterns >= LANTERN_BUDGET) return;
        const f = i / steps;
        const px = ax + ux * (t0 + (t1 - t0) * f);
        const py = ay + uy * (t0 + (t1 - t0) * f);
        if (!fitsFloor(px, py, 0.45)) continue;
        const k = [0.62, 0.84, 1.0][(i + seed) % 3];
        const size = 0.52 * k + 0.14;
        const wireZ = top0 + (top1 - top0) * f - Math.sin(f * Math.PI) * sag;
        const lanternZ = wireZ - 0.55;
        emit('ring-lantern', t(
          [px, py, lanternZ], [size, size, size * 1.08]));
        const lanternTop = lanternZ + size * 1.08 / 2;
        emit('ring-lantern-cord', t(
          [px, py, (lanternTop + wireZ) / 2],
          [0.12, 0.12, Math.max(0.08, wireZ - lanternTop)],
        ));
        lanterns += 1;
      }
    }
  };

  {
    let stringSeed = 0;
    for (const source of [runtime.routesBySite, runtime.highGroundRoutesBySite]) {
      for (const sides of Object.values(source || {})) {
        for (const lanes of Object.values(sides || {})) {
          for (const route of Object.values(lanes || {})) {
            const points = Array.isArray(route) ? route : route?.points;
            if (!Array.isArray(points)) continue;
            stringSeed += 1;
            if (stringSeed % 2 === 0) continue;   // 全経路に張ると索が重なる
            for (let i = 1; i < points.length; i++) {
              stringLine(points[i - 1][0], points[i - 1][1],
                points[i][0], points[i][1], stringSeed + i);
            }
          }
        }
      }
    }
  }

  // 拠点前の石畳広場。
  for (const site of runtime.sites || []) {
    const [cx, cy] = site.center || [0, 0];
    const fits = floors.some(floor => cx - 15 >= floor.min[0] && cx + 15 <= floor.max[0]
      && cy - 15 >= floor.min[1] && cy + 15 <= floor.max[1]);
    if (!fits) continue;
    emit('ground-plaza', t([cx, cy, GROUND_Z], [30, 30, 0.02]));
  }
}

const SITE_RE = /^flash-site-([a-z]+)-(.+)$/;

for (const solid of buildOshioiFlashpointGeometry().solids) {
  const match = SITE_RE.exec(solid.id);
  if (!match) continue;
  const [, site, role] = match;
  const vocab = VOCAB[site];
  const b = box(solid);
  if (role === 'objective-pad') { commonPad(b); continue; }
  if (role.startsWith('stair-')) { commonStair(b); continue; }
  if (!vocab) continue;
  vocabSeed += 1;
  activeSite = site;
  if (role.startsWith('mass-')) vocab.mass(b, vocabSeed);
  else if (role === 'high-platform') vocab.tower(b, vocabSeed);
  else if (role.startsWith('cover-')) vocab.cover(b, vocabSeed);
  else if (role.startsWith('boundary-post-')) vocab.post(b, vocabSeed);
  activeSite = null;
}

// ---- 層の定義 ----------------------------------------------------------------
// [層ID, primitive, material, [emitキー...]]
// 同じ primitive+material の意味キーを1層に束ねる。1層＝1ドローコールなので、
// 見た目を変えずにドローコールだけを削れる（80層 → 下記）。
//
// tests/map_site_cladding.test.js の "the five sites no longer share one identical
// vocabulary" は clad-{kiln,market,dock,lock,slip}-* を各3層以上要求するため、
// 5拠点の固有語彙にあたる層は統合せずに残す。
const LAYER_SPECS = [
  // --- 塩窯（5層）---
  ['clad-kiln-dome', 'sphere', 'copperPlaster', ['kiln-dome']],
  ['clad-kiln-chimney', 'cylinder', 'basalt', ['kiln-chimney', 'ring-flue']],
  ['clad-kiln-arch', 'archGate', 'copperPlaster', ['kiln-arch']],
  // 拠点固有の壁と基壇（材質で拠点を判別できるようにするための分離）
  ['clad-kiln-wall', 'box', 'copperPlaster', ['kiln-body']],
  ['clad-kiln-plinth', 'box', 'basalt', ['kiln-plinth', 'kiln-ashledge']],

  // --- 水市（7層）---
  ['clad-market-awning', 'barrelRoof', 'roofCopper', ['market-awning', 'roof-barrel-copper']],
  ['clad-market-sawroof', 'sawRoof', 'roofCopper', ['market-sawroof', 'roof-saw-copper']],
  ['clad-market-arch', 'archWall', 'shellShade', ['market-arch', 'ring-arch']],
  ['clad-market-buoy', 'sphere', 'copper', ['market-buoy', 'kiln-pot']],
  ['clad-market-banner', 'plane', 'indigoCloth', ['market-banner']],
  ['clad-market-wall', 'box', 'shell', ['market-store', 'market-stall']],
  ['clad-market-plinth', 'box', 'shellShade', ['market-plinth']],

  // --- 角（5層）---
  ['clad-dock-hull', 'box', 'wetRock', ['dock-hull', 'dock-plate']],
  ['clad-dock-strut', 'cylinder', 'cedar', ['dock-strut', 'slip-rib', 'market-mast']],
  ['clad-dock-bollard', 'cylinder', 'copper', ['dock-bollard', 'lock-vane', 'slip-vane', 'lock-winch']],
  ['clad-dock-wall', 'box', 'wetRock', ['dock-cradle']],
  ['clad-dock-plinth', 'box', 'wetRock', ['dock-plinth']],

  // --- 網（5層）---
  ['clad-lock-roof', 'hipRoof', 'roofBlue', ['lock-roof', 'roof-hip-blue']],
  ['clad-lock-arch', 'archGate', 'indigoWall', ['lock-arch']],
  ['clad-lock-lattice', 'lattice', 'cedar', ['lock-lattice', 'ring-lattice']],
  ['clad-lock-wall', 'box', 'indigoWall', ['lock-house']],
  ['clad-lock-plinth', 'box', 'indigoWall', ['lock-plinth', 'lock-gate']],

  // --- 風見（5層）---
  ['clad-slip-timber', 'box', 'cedar', [
    'slip-timber', 'ring-crate', 'ring-doorframe',
    'ring-deckrail', 'market-crates', 'lock-netframe', 'dock-blocking',
  ]],
  ['clad-slip-colonnade', 'colonnade', 'cedar', ['slip-colonnade']],
  ['clad-slip-cap', 'dodecaLow', 'shellShade', ['slip-cap']],
  ['clad-slip-wall', 'box', 'cedar', ['slip-keel', 'slip-scaffold']],
  ['clad-slip-plinth', 'box', 'cedar', ['slip-plinth']],

  // --- 共通の壁・帯（primitive+material で束ねた層）---
  ['clad-shell-trim', 'box', 'shellShade', [
    'stair-stringer', 'ring-string', 'ring-pilaster', 'site-string', 'ring-deck', 'ring-parapet',
  ]],
  ['clad-dark-trim', 'box', 'basalt', [
    'ring-eave', 'ring-cratelid', 'ring-plinth', 'site-plinth',
    'dock-gantry', 'dock-keel', 'ring-lantern-cord',
  ]],
  ['clad-wall-shell', 'box', 'shell', ['ring-store', 'ring-cornice', 'site-pilaster']],
  // 地区ごとの街区の壁（色で現在地が読めるようにする）
  ['clad-ring-store-warm', 'box', 'copperPlaster', ['ring-store-warm']],
  ['clad-ring-store-sand', 'box', 'shellShade', ['ring-store-sand']],
  ['clad-ring-store-cedar', 'box', 'cedar', ['ring-store-cedar']],
  ['clad-wall-copper', 'box', 'copperPlaster', ['ring-upper', 'ring-annex']],
  ['clad-wall-indigo', 'box', 'indigoWall', ['market-upper']],
  ['clad-window', 'box', 'windowGlow', ['ring-window', 'site-window', 'roof-lantern']],
  ['clad-metal-band', 'box', 'copper', ['window-hood', 'dock-waterline', 'kiln-band']],
  ['clad-ridge-blue', 'box', 'roofBlue', ['ring-ridge']],

  // --- 開口と柱（曲線要素。原則7）---
  ['clad-ring-colonnade', 'colonnade', 'shell', ['ring-colonnade']],

  // --- 屋根（材質5種 × 形状4種。原則1・原則7）---
  ['clad-roof-tile', 'hipRoof', 'copperPlaster', ['roof-hip-plaster']],
  ['clad-roof-shed', 'sawRoof', 'basalt', ['roof-saw-dark']],
  ['clad-roof-vault', 'barrelRoof', 'shellShade', ['roof-barrel-pale']],
  ['clad-roof-vault-warm', 'barrelRoof', 'copperPlaster', ['roof-barrel-warm']],
  ['clad-roof-sand', 'hipRoof', 'shellShade', ['roof-hip-sand']],
  ['clad-ring-annexroof', 'hipRoof', 'roofCopper', ['ring-annexroof']],
  ['clad-ring-dome', 'spire', 'copperPlaster', ['ring-dome']],
  ['clad-ring-spire', 'spire', 'roofBlue', ['ring-spire']],
  ['clad-ring-finial', 'spire', 'copper', ['ring-finial', 'site-finial']],
  // 街路に張った浮き玉灯籠（設計書§12「色ガラスの浮き玉灯籠が軒先とロープに連なり」）。
  // dodecaLow は36三角形。sphere(140) は使わない。
  ['clad-ring-lantern', 'dodecaLow', 'windowGlow', ['ring-lantern']],

  // --- 中央コア（担当 C へ移管。既存分をそのまま維持）---
  ['clad-core-cloisterbase', 'box', 'basalt', ['core-cloisterbase']],
  ['clad-core-colonnade', 'colonnade', 'shell', ['core-colonnade']],
  ['clad-core-lattice', 'lattice', 'cedar', ['core-lattice']],
  ['clad-core-coping', 'box', 'shellShade', ['core-coping']],

  // --- 地面（担当 G が別ファイルで拡張する。ここは既存分）---
  ['clad-site-paving', 'plane', 'shellShade', ['site-paving', 'ground-lane', 'ground-canalrim']],
  ['clad-ground-avenue', 'plane', 'basalt', ['ground-avenue']],
  ['clad-ground-plaza', 'plane', 'copperPlaster', ['ground-plaza']],
  ['clad-ground-canal', 'plane', 'wetRock', ['ground-canal']],
];

// 予算のハードガード。層が129に達すると presentation が丸ごと消えるため、
// B の割当（66層）を超えたらビルド時に落とす（PLAN §2-2）。
const B_LAYER_BUDGET = 66;

export const SITE_CLADDING_LAYERS = LAYER_SPECS
  .map(([id, primitive, material, keys]) => {
    const transforms = [];
    for (const key of keys) {
      const list = buckets.get(key);
      if (list) transforms.push(...list);
    }
    return { id, primitive, material, semantics: 'clad-existing-solid', castShadow: true, receiveShadow: true, transforms };
  })
  .filter(layer => layer.transforms.length > 0);

if (SITE_CLADDING_LAYERS.length > B_LAYER_BUDGET) {
  throw new Error(`site cladding uses ${SITE_CLADDING_LAYERS.length} layers, budget is ${B_LAYER_BUDGET}`);
}

export const SITE_CLADDING_INSTANCE_COUNT = SITE_CLADDING_LAYERS
  .reduce((sum, layer) => sum + layer.transforms.length, 0);
