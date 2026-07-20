// 潮汲み環礁ウルハ・大潮井 — グレーボックス幾何（Phase 2〜3簡易版）
// 凍結値: 全体92m×68m、三層（浅瀬0m/市場4m/櫓8m）、目標ボウル床2.5m、
// 判定円柱 半径7.0m×高さ5.0m、スポーン出口3本、回転対称（180度）。
// 経路実測はマップ仕様書の58/66/76mに対し本グレーボックスでは短縮近似
// （スポーン→目標 直線44m）。Phase 8のグレーボックス精査で寸法合わせを行う。
//
// 幾何はソリッドAABBの集合。top面が床、側面が壁として機能する。
// tag: ground/slab/rim/stair/cover/wall/tower/spawnwall

import { AUTHORED_COLLISION_MANIFEST } from './map_oshioi_authored_collision.js';
import { compileMapBlueprint } from './map_blueprint.js';

function box(minX, minY, minZ, maxX, maxY, maxZ, tag = 'solid') {
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], tag };
}

// Pinned to the checked-in GLB for decorative placement and offline reference
// generation. Runtime gameplay collision remains the canonical blueprint below.
export const AUTHORED_MAP_TRANSFORM = Object.freeze({
  gameFromSceneAxes: Object.freeze(['x', '-z', 'y']),
  sceneFromGameAxes: Object.freeze(['x', 'z', '-y']),
  sourceBounds: Object.freeze({
    min: Object.freeze([-77.52995323973266, -35.185485053386856, -83.08298595348464]),
    max: Object.freeze([171.99807404945543, -0.8035433780354992, 137.6234677127337]),
  }),
  fit: Object.freeze({ axis: 'width', ratio: 0.98, mapWidthM: 92 }),
  terrain: Object.freeze({ sourceAxis: 'y', planeRatio: 0.28, plane: -25.558541384288475 }),
  scale: 0.36132213675343944,
  scenePosition: Object.freeze([-17.066711633025545, 9.234866785272322, -9.853341704406931]),
});

function uppercaseHex(bytes) {
  return Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('').toUpperCase();
}

export async function verifyAuthoredAssetIdentity(bytes, asset, digest = undefined) {
  const expectedAssetHash = String(asset?.sha256 || '').toUpperCase();
  const configuredManifestHash = String(asset?.collisionManifest?.hash || '').toUpperCase();
  if (expectedAssetHash !== AUTHORED_COLLISION_MANIFEST.assetSha256
    || configuredManifestHash !== AUTHORED_COLLISION_MANIFEST.manifestHash
    || asset?.collisionManifest?.schemaVersion !== AUTHORED_COLLISION_MANIFEST.schemaVersion) {
    throw new Error('Authored map metadata does not match the collision manifest');
  }
  const source = bytes instanceof ArrayBuffer
    ? new Uint8Array(bytes)
    : (ArrayBuffer.isView(bytes) ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : null);
  if (!source) throw new TypeError('Authored map bytes must be an ArrayBuffer or view');
  const subtle = globalThis.crypto?.subtle;
  const digestFn = digest === undefined ? (subtle?.digest ? subtle.digest.bind(subtle) : null) : digest;
  if (typeof digestFn !== 'function') throw new Error('SHA-256 verification is unavailable');
  const actualAssetHash = uppercaseHex(new Uint8Array(await digestFn('SHA-256', source)));
  if (actualAssetHash !== expectedAssetHash) {
    throw new Error(`Authored map SHA-256 mismatch: ${actualAssetHash}`);
  }
  return Object.freeze({ assetSha256: actualAssetHash, manifestHash: configuredManifestHash });
}

// 180度回転（x,y反転）で対称化
function rot(b) {
  return {
    min: [-b.max[0], -b.max[1], b.min[2]],
    max: [-b.min[0], -b.min[1], b.max[2]],
    tag: b.tag,
  };
}

// 階段生成: axis('x'|'y')方向に fromA→toA、床高 z0→z1 を steps 段で登る
function stairs(axis, a0, a1, c0, c1, z0, z1, steps, tag = 'stair') {
  const out = [];
  for (let i = 0; i < steps; i++) {
    const t0 = a0 + ((a1 - a0) * i) / steps;
    const t1 = a0 + ((a1 - a0) * (i + 1)) / steps;
    const top = z0 + ((z1 - z0) * (i + 1)) / steps;
    const minZ = Math.min(0, top);
    const maxZ = Math.max(0, top);
    if (!(minZ < maxZ)) continue;
    if (axis === 'x') out.push(box(Math.min(t0, t1), c0, minZ, Math.max(t0, t1), c1, maxZ, tag));
    else out.push(box(c0, Math.min(t0, t1), minZ, c1, Math.max(t0, t1), maxZ, tag));
  }
  return out;
}

export function buildMap() {
  const S = [];

  // ---- 基盤と外周 ----
  S.push(box(-46, -34, -1, 46, 34, 0, 'ground'));            // 浅瀬（下段 z=0）
  S.push(box(-47, -34, 0, -46, 34, 10, 'wall'));             // 外周壁
  S.push(box(46, -34, 0, 47, 34, 10, 'wall'));
  S.push(box(-47, -35, 0, 47, -34, 10, 'wall'));
  S.push(box(-47, 34, 0, 47, 35, 10, 'wall'));

  // ---- 中段スラブ（市場段丘 z=4）。中央にボウル穴 ----
  S.push(box(8, -22, 0, 32, 22, 4, 'slab'));                 // 東市場
  S.push(box(-32, -22, 0, -8, 22, 4, 'slab'));               // 西市場
  S.push(box(-8, 6, 0, 8, 22, 4, 'slab'));                   // 北帯
  S.push(box(-8, -22, 0, 8, -6, 4, 'slab'));                 // 南帯

  // ---- 目標ボウル（床 z=2.5、リム z=4、東西に階段） ----
  S.push(box(-6, -6, 0, 6, 6, 2.5, 'slab'));                 // ボウル床
  S.push(box(6, 1.5, 0, 8, 6, 4, 'rim'));                    // 東リム北片
  S.push(box(6, -6, 0, 8, -1.5, 4, 'rim'));                  // 東リム南片
  S.push(...stairs('x', 6, 8, -1.5, 1.5, 2.5, 4.0, 3));      // 東階段（2.5→4.0）
  S.push(box(-8, 1.5, 0, -6, 6, 4, 'rim'));                  // 西リム北片
  S.push(box(-8, -6, 0, -6, -1.5, 4, 'rim'));                // 西リム南片
  S.push(...stairs('x', -8, -6, -1.5, 1.5, 4.0, 2.5, 3));    // 西階段

  // ---- ボウル内遮蔽（井桁＋潮壺4） ----
  S.push(box(-1.25, -1.25, 2.5, 1.25, 1.25, 5.0, 'cover'));  // 井桁（全身遮蔽）
  for (const [px, py] of [[3.6, 3.6], [-3.6, 3.6], [3.6, -3.6], [-3.6, -3.6]]) {
    S.push(box(px - 0.4, py - 0.4, 2.5, px + 0.4, py + 0.4, 3.7, 'cover')); // 潮壺（半身）
  }

  // ---- スポーン台と灯港（東=チームサイド0側。西は回転対称） ----
  const eastSide = [];
  eastSide.push(box(38, -8, 0, 46, 8, 4, 'slab'));           // 東スポーン台
  // 前面壁（正面ゲート y∈[-2,2] を開ける）
  eastSide.push(box(38, -8, 4, 38.6, -2, 8, 'spawnwall'));
  eastSide.push(box(38, 2, 4, 38.6, 8, 8, 'spawnwall'));
  // 北壁（回廊口 x∈[40,43] を開ける）
  eastSide.push(box(38, 8, 4, 40, 8.6, 8, 'spawnwall'));
  eastSide.push(box(43, 8, 4, 46, 8.6, 8, 'spawnwall'));
  // 南壁（渚口 x∈[40,43] を開ける）
  eastSide.push(box(38, -8.6, 4, 40, -8, 8, 'spawnwall'));
  eastSide.push(box(43, -8.6, 4, 46, -8, 8, 'spawnwall'));
  // 潮見庭（正面ブリッジ z=4。縁石付き＝落水防止）
  eastSide.push(box(32, -3, 0, 38, 3, 4, 'slab'));
  eastSide.push(box(32, 2.7, 4, 38, 3, 4.8, 'wall'));
  eastSide.push(box(32, -3, 4, 38, -2.7, 4.8, 'wall'));
  // 回廊接続ブリッジ（北へ。縁石付き）
  eastSide.push(box(40, 8, 0, 43, 20, 4, 'slab'));
  eastSide.push(box(40, 8, 4, 40.3, 20, 4.8, 'wall'));
  eastSide.push(box(42.7, 8, 4, 43, 20, 4.8, 'wall'));
  // 渚口の降り階段（南へ 4→0）
  eastSide.push(...stairs('y', -8, -13, 40, 43, 4.0, 0.0, 8));
  for (const b of eastSide) { S.push(b); S.push(rot(b)); }

  // ---- 回廊（北/南 z=4、外欄干z7、内側は窓付き低壁） ----
  const north = [];
  north.push(box(-43, 20, 0, 43, 26, 4, 'slab'));            // 北回廊床
  // Keep the stair landings open: the rotated gap serves the south stair at x=12..16.
  north.push(box(-43, 26, 4, -16, 26.6, 7, 'wall'));         // 外欄干（西）
  north.push(box(-12, 26, 4, 43, 26.6, 7, 'wall'));          // 外欄干（東）
  for (let x = -40; x < 40; x += 8) {
    north.push(box(x, 20, 4, x + 5, 20.4, 6.2, 'wall'));     // 内壁（3m窓間隔）
  }
  for (const b of north) { S.push(b); S.push(rot(b)); }

  // ---- 渚→回廊の上り階段（南 x∈[12,16]、北は回転対称） ----
  const sstair = stairs('y', -30, -26, 12, 16, 0.0, 4.0, 8);
  for (const b of sstair) { S.push(b); S.push(rot(b)); }

  // ---- 灯籠櫓（北/南 z=8、欄干z9、東側に上り階段） ----
  const towerN = [];
  towerN.push(box(-3, 10, 4, 3, 16, 8, 'tower'));            // 北櫓本体
  towerN.push(box(-3, 15.7, 8, 3, 16, 9, 'wall'));           // 欄干: 北
  towerN.push(box(-3, 10, 8, -2.7, 16, 9, 'wall'));          // 欄干: 西
  towerN.push(box(-3, 10, 8, 3, 10.3, 9, 'wall'));           // 欄干: 南（腰の高さ・ボウル側）
  towerN.push(...stairs('x', 7, 3, 12, 14, 4.0, 8.0, 8));    // 東から上る
  for (const b of towerN) { S.push(b); S.push(rot(b)); }

  // ---- 市場の遮蔽（大灯柱＋木箱。回転対称で配置） ----
  const covers = [];
  covers.push(box(19.2, -0.8, 4, 20.8, 0.8, 9, 'cover'));    // 大灯柱（正面射線を分断）
  covers.push(box(13.4, 7.4, 4, 14.9, 8.9, 5.5, 'cover'));
  covers.push(box(25.4, -12.6, 4, 26.9, -11.1, 5.5, 'cover'));
  covers.push(box(11.0, -14.8, 4, 12.5, -13.3, 5.5, 'cover'));
  covers.push(box(28.0, 10.0, 4, 29.5, 11.5, 5.5, 'cover'));
  for (const b of covers) { S.push(b); S.push(rot(b)); }

  // ---- 渚の岩（下段の遮蔽） ----
  const rocks = [];
  rocks.push(box(33, -15, 0, 35, -13, 1.6, 'cover'));
  rocks.push(box(17, -29, 0, 19, -27, 1.6, 'cover'));
  rocks.push(box(-1, 29, 0, 1, 31, 1.6, 'cover'));
  for (const b of rocks) { S.push(b); S.push(rot(b)); }

  // ---- 準備フェーズ中のみ有効なスポーン扉（ゲート/回廊口/渚口を塞ぐ） ----
  const doors = [];
  doors.push(box(38, -2, 4, 38.6, 2, 8, 'door'));            // 東正面ゲート
  doors.push(box(40, 8, 4, 43, 8.6, 8, 'door'));             // 東回廊口
  doors.push(box(40, -8.6, 4, 43, -8, 8, 'door'));           // 東渚口
  const setupDoors = [];
  for (const b of doors) { setupDoors.push(b); setupDoors.push(rot(b)); }

  const visualAsset = {
    id: 'chicken_gun_fruzer_mine',
    title: 'chicken gun fruzer mine',
    url: '/client/assets/chicken_gun_fruzer_mine.glb',
    author: 'amogusstrikesback2',
    license: 'CC BY 4.0',
    sourceUrl: 'https://sketchfab.com/3d-models/chicken-gun-fruzer-mine-055bcbb8505548b88af029ed198c37c2',
    sha256: 'DC9017A5F1D875B7CB45C00183E158491FAE042F6A33CE8EC42FCA8D9CA2E597',
    transform: AUTHORED_MAP_TRANSFORM,
    collision: false,
    collisionModel: 'decorative-only',
    displayMode: 'verified-reference-hidden',
    // Retained only to pin the referenced asset bytes and transform. These
    // generated proxies are offline evidence and never enter runtime solids.
    collisionManifest: Object.freeze({
      schemaVersion: AUTHORED_COLLISION_MANIFEST.schemaVersion,
      hash: AUTHORED_COLLISION_MANIFEST.manifestHash,
    }),
  };

  return compileMapBlueprint({
    id: 'map_oshioi',
    displayName: '潮汲み環礁ウルハ・大潮井',
    boundsM: { x: [-46, 46], y: [-34, 34] },
    killZ: -12,
    visualAsset,
    decorations: [{ ...visualAsset, collision: false }],
    geometry: S.map((solid, index) => ({
      id: `canonical-${String(index + 1).padStart(3, '0')}-${solid.tag}`,
      kind: 'box',
      min: solid.min,
      max: solid.max,
      tag: solid.tag,
    })),
    setupDoors,
    objective: { center: [0, 0, 2.5], radiusM: 7.0, heightM: 5.0 },
    // side 'east' / 'west'。試合側でチーム→サイド割当を行う
    spawns: {
      east: [
        { pos: [44, 0, 4], yaw: Math.PI },
        { pos: [42.5, 1, 4], yaw: Math.atan2(-1, -4.5) },
        { pos: [42.5, -1, 4], yaw: Math.atan2(1, -4.5) },
        { pos: [44, 6, 4], yaw: Math.atan2(3, -3) },
        { pos: [44, -6, 4], yaw: Math.atan2(-3, -3) },
      ],
      west: [
        { pos: [-44, 0, 4], yaw: 0 },
        { pos: [-42.5, -1, 4], yaw: Math.atan2(1, 4.5) },
        { pos: [-42.5, 1, 4], yaw: Math.atan2(-1, 4.5) },
        { pos: [-44, -6, 4], yaw: Math.atan2(-3, 3) },
        { pos: [-44, 6, 4], yaw: Math.atan2(3, 3) },
      ],
    },
    // 回復灯珠（小75×4。回転対称配置）
    pickups: [
      { id: 'pk_n_cloister', pos: [0, 23, 4], heal: 75, respawnSec: 30 },
      { id: 'pk_s_cloister', pos: [0, -23, 4], heal: 75, respawnSec: 30 },
      { id: 'pk_e_shallows', pos: [36.5, -14, 0], heal: 75, respawnSec: 30 },
      { id: 'pk_w_shallows', pos: [-36.5, 14, 0], heal: 75, respawnSec: 30 },
    ],
    // ボット用経路（東側視点。西側は反転して使用）
    routes: {
      front: [[40, 0, 4], [35, 0, 4], [28, 0, 4], [22, 2, 4], [18, 2, 4], [16, -1, 4], [14, 2, 4], [10, 2, 4], [10, 0, 4], [5.4, 0, 4], [5.4, 0, 2.5], [3, 0, 2.5]],
      cloister: [[41.5, 10, 4], [41.5, 16, 4], [41.5, 22, 4], [30, 23, 4], [16, 23, 4], [6.5, 23, 4], [6.5, 19, 4], [8, 15, 4], [8, 11, 4], [4.5, 8, 4], [2.5, 4.5, 4], [2, 3, 2.5]],
      shallows: [[41.5, -9, 4], [41.5, -12, 1.5], [40, -16, 0], [44, -19, 0], [44, -27, 0], [34, -28, 0], [24, -29, 0], [21, -30, 0], [14, -31, 0], [14, -31, 4], [14, -24.5, 4], [11, -23, 4], [8, -19, 4], [4, -16, 4], [4, -9, 4], [3, -8, 4], [3, -5.4, 4], [3, -5.4, 2.5], [2.5, -4.5, 2.5]],
    },
  });
}
