import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMap } from '../shared/data/map_oshioi.js';
import { SITE_CLADDING_LAYERS } from '../shared/data/map_oshioi_site_cladding.js';
import { GROUND_LAYERS } from '../shared/data/map_oshioi_ground.js';
import { VEGETATION_LAYERS } from '../shared/data/map_oshioi_vegetation.js';
import { LANDMARK_LAYERS } from '../shared/data/map_oshioi_landmarks.js';
import { CORE_CLADDING_LAYERS } from '../shared/data/map_oshioi_core_cladding.js';

// 被覆は当たり判定を持たない描画専用データなので、「見た目は遮蔽だが撃ち抜ける」
// 偽の遮蔽になりうる。それを構造的に不可能にするのがこのテストの役目。
// semantics:'clad-existing-solid' の層は、既存 solid の XY footprint に収まっていなければならない。

const XY_TOLERANCE_M = 0.35;   // 装飾の縁取り分
const THIN_VERTICAL_M = 0.8;   // 宿主より高く伸びてよい細い垂直要素の上限

function xyBounds(transform) {
  const [x, y] = transform.position;
  const [sx, sy] = transform.scale;
  const yaw = transform.rotation?.[2] || 0;
  const halfX = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sy / 2;
  const halfY = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sy / 2;
  return { minX: x - halfX, maxX: x + halfX, minY: y - halfY, maxY: y + halfY };
}

test('cladding layers are wired into the presentation SSOT', () => {
  const map = buildMap();
  const clad = map.presentation.layers.filter(layer => layer.semantics === 'clad-existing-solid');
  assert.ok(clad.length > 0, 'cladding layers must reach the presentation');
  // 被覆は5つのモジュール（拠点・地面・植生・ランドマーク・中央コア）に分かれた。
  // これは「被覆が presentation に届いているか」という配線の確認であって、
  // 偽の遮蔽を防ぐ安全規則ではない。安全規則は下の2つのテスト
  // （footprint 内包／細い垂直要素／solid 数一致）で、そちらは無改変。
  // 植生は境界外にも層を持つ（veg-boundary-trunk / veg-boundary-crown）。
  // それらは semantics:'outside-playable-bounds' なので clad 側には数えない。
  const moduleClad = [
    ...SITE_CLADDING_LAYERS, ...GROUND_LAYERS, ...VEGETATION_LAYERS,
    ...LANDMARK_LAYERS, ...CORE_CLADDING_LAYERS,
  ].filter(layer => layer.semantics === 'clad-existing-solid');
  assert.equal(clad.length, moduleClad.length);
  for (const layer of clad) {
    assert.ok(layer.transforms.length > 0, `${layer.id} must not be empty`);
  }
});

test('every cladding instance is contained in an existing collision solid footprint', () => {
  const map = buildMap();
  const solids = map.solids;
  const clad = map.presentation.layers.filter(layer => layer.semantics === 'clad-existing-solid');

  let checked = 0;
  for (const layer of clad) {
    for (const [index, transform] of layer.transforms.entries()) {
      const b = xyBounds(transform);
      // 巨大な床スラブも XY 的には宿主になりうるので、
      // 「最も高い上端を持つ宿主」を採る。これが実際に立てる面の高さを表す。
      let host = null;
      for (const solid of solids) {
        if (b.minX < solid.min[0] - XY_TOLERANCE_M || b.maxX > solid.max[0] + XY_TOLERANCE_M) continue;
        if (b.minY < solid.min[1] - XY_TOLERANCE_M || b.maxY > solid.max[1] + XY_TOLERANCE_M) continue;
        if (!host || solid.max[2] > host.max[2]) host = solid;
      }
      assert.ok(host,
        `${layer.id}[${index}] at (${transform.position[0].toFixed(2)}, `
        + `${transform.position[1].toFixed(2)}) is not contained in any collision solid `
        + '— this would render as cover that bullets and bodies pass through');

      // 宿主より高く伸びる場合は、細い垂直要素だけを許す。
      const top = transform.position[2] + transform.scale[2] / 2;
      if (top > host.max[2] + 0.05) {
        const widest = Math.max(b.maxX - b.minX, b.maxY - b.minY);
        assert.ok(widest <= THIN_VERTICAL_M,
          `${layer.id}[${index}] rises ${(top - host.max[2]).toFixed(2)}m above its host `
          + `but is ${widest.toFixed(2)}m wide (limit ${THIN_VERTICAL_M}m)`);
      }
      checked += 1;
    }
  }
  assert.ok(checked >= 200, `expected production-scale cladding, only checked ${checked}`);
});

// インスタンス単位の 0.8m 制限は「0.74m の柱を 0.7m 間隔で4本」を素通しにする。
// 実際にそれで2件の偽の遮蔽がすり抜けた（祭儀灯柱の芯柱＝目標中央 2.18x2.18m、
// 灯籠櫓の煙道＝櫓天端 2.46x2.46m）。規則の**強化**としてここに束ねた塊の検査を足す。
const CLUSTER_GAP_M = 1.0;    // これ以下の隙間なら1つの塊として読める
const BODY_BAND_M = 2.2;      // 立っている人の胴体〜視線の帯
const STAND_NEAR_M = 6.0;     // 「その塊を遮蔽と信じて撃ち合う」距離
const CLUSTER_FILL = 0.40;    // 開放トラス（柱だけ）と詰まった塊を分ける占有率
const REACH_UP_M = 1.1136;    // combat.json のジャンプ到達
const REACH_XY_M = 3.5;       // combat.json の最大水平飛距離

function fillRatio(parts, minX, maxX, minY, maxY) {
  const w = maxX - minX;
  const d = maxY - minY;
  const nx = Math.min(96, Math.max(4, Math.round(w / 0.1)));
  const ny = Math.min(96, Math.max(4, Math.round(d / 0.1)));
  let hit = 0;
  for (let i = 0; i < nx; i++) {
    const px = minX + (i + 0.5) * (w / nx);
    for (let j = 0; j < ny; j++) {
      const py = minY + (j + 0.5) * (d / ny);
      for (const p of parts) {
        if (px >= p.minX && px <= p.maxX && py >= p.minY && py <= p.maxY) { hit += 1; break; }
      }
    }
  }
  return hit / (nx * ny);
}

test('nearby cladding never bundles into body-height cover without collision', () => {
  const map = buildMap();
  const solids = map.solids;
  const clad = map.presentation.layers.filter(layer => layer.semantics === 'clad-existing-solid');

  // 1) 当たり判定の外（宿主上端より上）に出ている部分だけを集める
  const parts = [];
  for (const layer of clad) {
    for (const [index, transform] of layer.transforms.entries()) {
      const b = xyBounds(transform);
      let host = null;
      for (const solid of solids) {
        if (b.minX < solid.min[0] - XY_TOLERANCE_M || b.maxX > solid.max[0] + XY_TOLERANCE_M) continue;
        if (b.minY < solid.min[1] - XY_TOLERANCE_M || b.maxY > solid.max[1] + XY_TOLERANCE_M) continue;
        if (!host || solid.max[2] > host.max[2]) host = solid;
      }
      if (!host) continue;
      const top = transform.position[2] + transform.scale[2] / 2;
      if (top <= host.max[2] + 0.05) continue;
      const z0 = Math.max(host.max[2], transform.position[2] - transform.scale[2] / 2);
      if (top - z0 < 0.2) continue;
      parts.push({ id: `${layer.id}[${index}]`, ...b, z0, z1: top });
    }
  }

  // 2) 「実際に立てる天面」だけを残す。床(z<=4.05)から段差1.1136m・水平3.5m以内で
  //    登れる天面を伝播させる。到達不能な大灯柱の頭まで数えると偽陽性になる。
  const reachable = solids.map(solid => solid.max[2] <= 4.05);
  for (let pass = 0; pass < 12; pass++) {
    let grew = false;
    for (let i = 0; i < solids.length; i++) {
      if (reachable[i]) continue;
      const a = solids[i];
      for (let j = 0; j < solids.length; j++) {
        if (!reachable[j]) continue;
        const b = solids[j];
        if (a.max[2] - b.max[2] > REACH_UP_M || b.max[2] - a.max[2] > 6) continue;
        const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0);
        const dy = Math.max(a.min[1] - b.max[1], b.min[1] - a.max[1], 0);
        if (Math.hypot(dx, dy) > REACH_XY_M) continue;
        reachable[i] = true;
        grew = true;
        break;
      }
    }
    if (!grew) break;
  }
  const standable = solids.filter((_, i) => reachable[i]);

  // 3) 立てる天面ごとに、その胴体帯に入る部分だけを近接連結して塊にする
  const CELL = 6;
  const partGrid = new Map();
  parts.forEach((part, index) => {
    for (let gx = Math.floor(part.minX / CELL); gx <= Math.floor(part.maxX / CELL); gx++) {
      for (let gy = Math.floor(part.minY / CELL); gy <= Math.floor(part.maxY / CELL); gy++) {
        const key = `${gx}:${gy}`;
        let bucket = partGrid.get(key);
        if (!bucket) partGrid.set(key, (bucket = []));
        bucket.push(index);
      }
    }
  });

  const seeds = new Map();
  for (const part of parts) {
    for (const solid of standable) {
      const dx = Math.max(part.minX - solid.max[0], solid.min[0] - part.maxX, 0);
      const dy = Math.max(part.minY - solid.max[1], solid.min[1] - part.maxY, 0);
      if (Math.hypot(dx, dy) > STAND_NEAR_M) continue;
      const stand = solid.max[2];
      if (!(part.z0 < stand + BODY_BAND_M && part.z1 > stand + 0.2)) continue;
      const key = `${Math.round(part.minX / 6)}:${Math.round(part.minY / 6)}:${stand.toFixed(2)}`;
      if (!seeds.has(key)) seeds.set(key, { stand, seed: part, standId: solid.id });
    }
  }

  const failures = [];
  for (const { stand, seed, standId } of seeds.values()) {
    const hi = stand + BODY_BAND_M;
    const inBand = part => part.z0 < hi && part.z1 > stand + 0.2;
    const group = [seed];
    const seen = new Set(group);
    const queue = [seed];
    while (queue.length) {
      const current = queue.pop();
      for (let gx = Math.floor((current.minX - CLUSTER_GAP_M) / CELL); gx <= Math.floor((current.maxX + CLUSTER_GAP_M) / CELL); gx++) {
        for (let gy = Math.floor((current.minY - CLUSTER_GAP_M) / CELL); gy <= Math.floor((current.maxY + CLUSTER_GAP_M) / CELL); gy++) {
          for (const index of partGrid.get(`${gx}:${gy}`) || []) {
            const part = parts[index];
            if (seen.has(part) || !inBand(part)) continue;
            const dx = Math.max(current.minX - part.maxX, part.minX - current.maxX, 0);
            const dy = Math.max(current.minY - part.maxY, part.minY - current.maxY, 0);
            if (dx > CLUSTER_GAP_M || dy > CLUSTER_GAP_M) continue;
            seen.add(part);
            group.push(part);
            queue.push(part);
          }
        }
      }
    }
    const minX = Math.min(...group.map(p => p.minX));
    const maxX = Math.max(...group.map(p => p.maxX));
    const minY = Math.min(...group.map(p => p.minY));
    const maxY = Math.max(...group.map(p => p.maxY));
    if (Math.min(maxX - minX, maxY - minY) <= THIN_VERTICAL_M) continue;
    const fill = fillRatio(group, minX, maxX, minY, maxY);
    if (fill < CLUSTER_FILL) continue;
    failures.push(
      `(${((minX + maxX) / 2).toFixed(1)}, ${((minY + maxY) / 2).toFixed(1)}) `
      + `${(maxX - minX).toFixed(2)}x${(maxY - minY).toFixed(2)}m fill ${fill.toFixed(2)} `
      + `over standable top ${stand.toFixed(2)} (${standId}): ${group.slice(0, 4).map(p => p.id).join(', ')}`);
  }
  assert.deepEqual(failures, [],
    'cladding bundles wider than a player body sit in someone\'s body band without collision');
});

test('every elevated lantern has a visible structural support or tether', () => {
  const map = buildMap();
  const allParts = [];
  const lanterns = [];
  for (const layer of map.presentation.layers) {
    if (layer.semantics !== 'clad-existing-solid') continue;
    for (const [index, transform] of layer.transforms.entries()) {
      const bounds = xyBounds(transform);
      const part = {
        id: `${layer.id}[${index}]`,
        layerId: layer.id,
        ...bounds,
        minZ: transform.position[2] - transform.scale[2] / 2,
        maxZ: transform.position[2] + transform.scale[2] / 2,
      };
      allParts.push(part);
      if (layer.id === 'clad-ring-lantern' || layer.id === 'core-lantern') lanterns.push(part);
    }
  }

  const unresolved = [];
  for (const lantern of lanterns) {
    const supported = allParts.some((part) => {
      if (part.id === lantern.id) return false;
      const overlapsXY = lantern.minX <= part.maxX + 0.02
        && lantern.maxX >= part.minX - 0.02
        && lantern.minY <= part.maxY + 0.02
        && lantern.maxY >= part.minY - 0.02;
      if (!overlapsXY) return false;
      const seatedOn = lantern.minZ - part.maxZ;
      const suspendedFrom = part.minZ - lantern.maxZ;
      return (seatedOn >= -0.03 && seatedOn <= 0.15)
        || (suspendedFrom >= -0.03 && suspendedFrom <= 0.8);
    });
    if (!supported) unresolved.push(lantern.id);
  }

  assert.ok(lanterns.length >= 700, `expected production lantern density, found ${lanterns.length}`);
  assert.deepEqual(unresolved, [],
    'a high lantern must read as mounted or tethered, never as an unexplained floating orb');
});

test('cladding never mutates collision geometry', async () => {
  // 被覆は描画専用なので、solids は「legacy + flashpoint + ring」の3ソースの合計に
  // 一致していなければならない。マジックナンバーではなく構成で縛る。
  const map = buildMap();
  const { buildOshioiFlashpointGeometry } = await import('../shared/data/map_oshioi_flashpoint_geometry.js');
  const { buildOshioiRingGeometry } = await import('../shared/data/map_oshioi_ring_geometry.js');
  const flash = buildOshioiFlashpointGeometry();
  const ring = buildOshioiRingGeometry();
  const cladLayers = map.presentation.layers.filter(l => l.semantics === 'clad-existing-solid');

  assert.ok(cladLayers.length > 0);
  assert.equal(buildMap().solids.length, map.solids.length, 'buildMap must be deterministic');
  const legacyCount = map.solids.length - flash.solids.length - ring.solids.length;
  assert.ok(legacyCount > 0, 'legacy core solids must survive');
  assert.equal(
    map.solids.length,
    legacyCount + flash.solids.length + ring.solids.length,
    'cladding must not add or remove a single collision solid',
  );
});

test('the five sites no longer share one identical vocabulary', () => {
  // 当たり判定は4拠点で同一の型抜きなので、差は建築語彙だけで作る。
  const prefixes = ['kiln', 'market', 'dock', 'lock', 'slip'];
  for (const prefix of prefixes) {
    const layers = SITE_CLADDING_LAYERS.filter(layer => layer.id.startsWith(`clad-${prefix}-`));
    assert.ok(layers.length >= 3,
      `site vocabulary "${prefix}" needs at least 3 distinct layers, got ${layers.length}`);
  }
});

test('the skyline and central beacon keep deliberate visual hierarchy', () => {
  const map = buildMap();
  const byId = new Map(map.presentation.layers.map(layer => [layer.id, layer]));

  const domes = byId.get('metropolis-dome-roofs');
  assert.ok(domes, 'the distant roof vocabulary needs a true dome family, not only spires');
  assert.equal(domes.primitive, 'dome');
  assert.equal(domes.semantics, 'outside-playable-bounds');
  assert.ok(domes.transforms.length >= 12,
    `expected a readable dome rhythm in the skyline, found ${domes.transforms.length}`);

  const beacon = byId.get('landmark-beacon-body');
  assert.ok(beacon, 'the central beacon needs its own contrast layer');
  assert.equal(beacon.material, 'copperPlaster');
  assert.ok(beacon.transforms.some(transform => transform.position[2] > 20),
    'the contrast treatment must reach the visible upper half of the beacon');

  const seams = byId.get('ground-figure-seam');
  assert.ok(seams, 'central-plaza seams must remain authored');
  assert.equal(seams.material, 'cedar',
    'plaza seams should describe the paving in warm cedar, not overpower it as black geometry');
});

test('gold finials do not stack duplicate crowns or repeat one silhouette', () => {
  const map = buildMap();
  const finials = map.presentation.layers.find(layer => layer.id === 'clad-ring-finial');
  assert.ok(finials, 'expected the shared gold-finial layer');

  const positions = new Set(finials.transforms.map(transform => transform.position
    .map(value => value.toFixed(5)).join(',')));
  assert.equal(positions.size, finials.transforms.length,
    'two authored finials must never occupy the same crown position');

  const silhouettes = new Set(finials.transforms.map(transform => transform.scale
    .map(value => value.toFixed(3)).join(',')));
  assert.ok(silhouettes.size >= 7,
    `expected varied gold-finial silhouettes, found only ${silhouettes.size}`);
});
