// 画像→Three.js候補を「実マップへ一時配置したとき」の安全ゲート。
//
// 目的は NEXT_GATE.md の項目5〜6（fake-cover cluster / sightline・route・
// gameplay-collision）を、候補を runtime へ登録せずに測ることである。
// ここは読み取り専用の監査で、shared/data の実データには一切書き込まない。
// 候補の presentation 層は「仮想層」としてマップの複製に足すだけで、
// 元の map.presentation.layers は変更しない。
//
// 安全上の不変条件（弱めない）:
//   1. すべての部品は既存 solid の XY footprint に収まる（許容 0.35m）。
//   2. 宿主上端より高く出る部品は XY 最大辺 0.80m 以下（細い垂直要素のみ）。
//   3. 近接した部品の**束**が、立てる床の胴体帯で体を隠せる塊になってはならない
//      （tools/audit_fake_cover_clusters.mjs の規則をそのまま再利用する）。
//   4. 当たり判定は none のまま。ここで collision を足して「安全に見せる」ことはしない。
//
// 使い方:
//   node tools/audit_img2threejs_candidate_placement.mjs [--out <path>]
// 監査が1件でも落ちれば exit 1。落ちること自体は正常な結果であり、
// 規則を緩めるのではなく候補側の寸法・配置を直すこと。

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { buildMap } from '../shared/data/map_oshioi.js';
import { findUnsafeClusters } from './audit_fake_cover_clusters.mjs';
import COMBAT from '../shared/data/combat.json' with { type: 'json' };

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// tests/map_site_cladding.test.js と同じ値。ここで独自に緩めない。
export const XY_TOLERANCE_M = 0.35;
export const THIN_VERTICAL_M = 0.8;
export const BODY_BAND_M = 2.2;
const REACH_UP_M = 1.1136;   // combat.json のジャンプ到達
const REACH_XY_M = 3.5;

const CAPSULE_RADIUS_M = COMBAT.movement.capsuleRadiusM;
const STAND_HEIGHT_M = COMBAT.movement.standHeightM;

// ---------------------------------------------------------------------------
// 候補仕様 → ワールド空間の箱
// ---------------------------------------------------------------------------

// OBJECT_SCULPT_SPEC は Y-up のオブジェクト空間（原点=接地面の中心）で書かれている。
// マップは Z-up なので (x, y, z)obj → (x, z, y)world へ入れ替えたうえで yaw を掛ける。
function extentOf(dimensions = {}) {
  const radius = Number.isFinite(dimensions.radius) ? dimensions.radius : 0;
  const fallback = radius * 2;
  const pick = (value) => (Number.isFinite(value) ? Number(value) : null);
  return {
    x: pick(dimensions.width) ?? pick(dimensions.length) ?? fallback,
    y: pick(dimensions.height) ?? fallback,
    z: pick(dimensions.depth) ?? fallback,
  };
}

// transform.position が未設定（[0,0,0]）の部品は attachment の中点を採る。
// また tube / curve-sweep のような1次元プリミティブは length をどの軸へ伸ばすかが
// dimensions だけでは決まらないので、attachment の向きから決める。
// これは仕様の書き方に対する明示的な解釈であり、証跡にも記録する。
export const POSITION_RESOLUTION =
  'transform.position, falling back to the attachment localStart/localEnd midpoint in object space; '
  + 'the length axis of tube/curve-sweep parts is taken from the dominant attachment direction';

const ONE_DIMENSIONAL = new Set(['tube', 'curve-sweep']);

// length を伸ばす軸。attachment の差分が最大の成分を採る。
function lengthAxis(component) {
  const start = component.attachment?.localStart;
  const end = component.attachment?.localEnd;
  if (!Array.isArray(start) || !Array.isArray(end)) return 0;
  const delta = [0, 1, 2].map(axis => Math.abs(end[axis] - start[axis]));
  const largest = Math.max(...delta);
  if (largest < 1e-6) return 0;
  return delta.indexOf(largest);
}

function localCenter(component, extent) {
  const position = component.transform?.position || [0, 0, 0];
  if (position.some(value => Math.abs(value) > 1e-9)) return position;
  if (component.parent == null) return [0, extent.y / 2, 0];
  const start = component.attachment?.localStart;
  const end = component.attachment?.localEnd;
  if (Array.isArray(start) && Array.isArray(end)) {
    return [0, 1, 2].map(axis => (start[axis] + end[axis]) / 2);
  }
  return position;
}

export function buildCandidateParts(spec, anchor) {
  const yaw = anchor.yawRad || 0;
  const cos = Math.cos(yaw);
  const sin = Math.sin(yaw);
  const [ax, ay, az] = anchor.position;

  return spec.componentTree.map((component) => {
    const extent = extentOf(component.dimensions);
    if (ONE_DIMENSIONAL.has(component.primitive) && Number.isFinite(component.dimensions?.length)) {
      const radius = Number(component.dimensions.radius) || 0;
      const length = Number(component.dimensions.length);
      const axis = lengthAxis(component);
      extent.x = axis === 0 ? length : radius * 2;
      extent.y = axis === 1 ? length : radius * 2;
      extent.z = axis === 2 ? length : radius * 2;
    }
    const [lx, ly, lz] = localCenter(component, extent);
    // オブジェクト空間の (x, z) をワールドの (x, y) へ、yaw 回転して配置する。
    const wx = ax + lx * cos - lz * sin;
    const wy = ay + lx * sin + lz * cos;
    const wz = az + ly;
    const halfX = Math.abs(cos) * extent.x / 2 + Math.abs(sin) * extent.z / 2;
    const halfY = Math.abs(sin) * extent.x / 2 + Math.abs(cos) * extent.z / 2;
    return {
      id: component.id,
      // root は「宣言された安全エンベロープ」であって描画される部品ではない。
      // 両方測るが、所見は分けて扱う。
      kind: component.parent == null ? 'declared-envelope' : 'authored-part',
      colliderType: component.actionProfile?.collider?.type ?? 'unspecified',
      position: [wx, wy, wz],
      scale: [extent.x, extent.z, extent.y],
      rotation: [0, 0, yaw],
      minX: wx - halfX,
      maxX: wx + halfX,
      minY: wy - halfY,
      maxY: wy + halfY,
      z0: wz - extent.y / 2,
      z1: wz + extent.y / 2,
      widestXY: Math.max(halfX * 2, halfY * 2),
    };
  });
}

// ---------------------------------------------------------------------------
// マップ側の補助
// ---------------------------------------------------------------------------

function findHost(solids, part) {
  let host = null;
  for (const solid of solids) {
    if (part.minX < solid.min[0] - XY_TOLERANCE_M || part.maxX > solid.max[0] + XY_TOLERANCE_M) continue;
    if (part.minY < solid.min[1] - XY_TOLERANCE_M || part.maxY > solid.max[1] + XY_TOLERANCE_M) continue;
    if (!host || solid.max[2] > host.max[2]) host = solid;
  }
  return host;
}

// 「実際に立てる天面」の伝播。到達できない屋根の上を胴体帯の基準にしない。
function standableSolids(solids) {
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
  return solids.filter((_, index) => reachable[index]);
}

// 部品の真下に「人が実際に立てる床」があるか。壁の footprint 内に収まる
// 掛け物（当たり判定のある壁の上）は、そもそも人が入れないので該当しない。
function walkableOverlap(part, standable, samples = 6) {
  const hits = [];
  for (let i = 0; i < samples; i++) {
    const px = part.minX + ((i + 0.5) * (part.maxX - part.minX)) / samples;
    for (let j = 0; j < samples; j++) {
      const py = part.minY + ((j + 0.5) * (part.maxY - part.minY)) / samples;
      let standTop = null;
      for (const solid of standable) {
        if (px < solid.min[0] || px > solid.max[0] || py < solid.min[1] || py > solid.max[1]) continue;
        if (solid.max[2] > part.z1 - 0.01) continue;   // 部品より高い床の上には立てない
        if (standTop == null || solid.max[2] > standTop) standTop = solid.max[2];
      }
      if (standTop == null) continue;
      // その床に立った人の胴体〜頭が部品と重なるか
      if (standTop + STAND_HEIGHT_M <= part.z0 || standTop >= part.z1) continue;
      hits.push({ at: [Number(px.toFixed(3)), Number(py.toFixed(3))], standTop });
    }
  }
  return hits;
}

function collectRoutes(map) {
  const routes = [];
  for (const [id, points] of Object.entries(map.routes || {})) routes.push({ id: `routes.${id}`, points });
  const runtime = map.flashpoint?.runtime;
  for (const [site, bySide] of Object.entries(runtime?.routesBySite || {})) {
    for (const [side, lanes] of Object.entries(bySide || {})) {
      for (const lane of Object.values(lanes || {})) {
        if (Array.isArray(lane?.points)) routes.push({ id: lane.id || `${site}.${side}`, points: lane.points });
      }
    }
  }
  for (const [site, accesses] of Object.entries(runtime?.highGroundRoutesBySite || {})) {
    for (const access of Object.values(accesses || {})) {
      if (Array.isArray(access?.points)) routes.push({ id: access.id || `${site}.high`, points: access.points });
    }
  }
  return routes;
}

function pointBoxDistance(px, py, part) {
  const dx = Math.max(part.minX - px, px - part.maxX, 0);
  const dy = Math.max(part.minY - py, py - part.maxY, 0);
  return Math.hypot(dx, dy);
}

// 経路点は 0.4m のカプセル半径を持つ。部品がその帯に入っていれば通行を塞ぐ。
function routeClearance(parts, routes) {
  let nearest = { distanceM: Infinity, routeId: null, partId: null, at: null };
  const blocking = [];
  for (const route of routes) {
    for (const point of route.points) {
      const [px, py, pz] = point;
      for (const part of parts) {
        if (pz + STAND_HEIGHT_M <= part.z0 || pz >= part.z1) continue;
        const distance = pointBoxDistance(px, py, part);
        if (distance < nearest.distanceM) {
          nearest = { distanceM: distance, routeId: route.id, partId: part.id, at: [px, py, pz] };
        }
        if (distance < CAPSULE_RADIUS_M) {
          blocking.push({ routeId: route.id, partId: part.id, at: [px, py, pz], distanceM: Number(distance.toFixed(3)) });
        }
      }
    }
  }
  return {
    nearest: Number.isFinite(nearest.distanceM)
      ? { ...nearest, distanceM: Number(nearest.distanceM.toFixed(3)) }
      : { distanceM: null, routeId: null, partId: null, at: null },
    blocking,
  };
}

// ---------------------------------------------------------------------------
// 配置提案（候補のみ。ここに書いてもマップには登録されない）
// ---------------------------------------------------------------------------

export const PLACEMENT_PROPOSALS = [
  {
    id: 'prop-market-awning-01',
    specPath: 'work/asset-rush/aaa-v1-pilot/img2threejs/prop-market-awning-01/OBJECT_SCULPT_SPEC.json',
    // 北回廊の外欄干（上端7m）に沿って掛ける。SAFETY_POLICY の
    // 「既存の壁・天蓋アンカーに沿わせる／通行帯に孤立して置かない」に対応。
    anchor: { solidId: 'canonical-076-wall', position: [20, 26.3, 4], yawRad: 0 },
    policy: {
      undersideMinM: 2.2,
      standingFloorZ: 4,
      rationale: 'north cloister outer balustrade; canopy hangs inside the wall footprint, not over the walkway',
    },
  },
  {
    id: 'prop-roof-finial-01',
    specPath: 'work/asset-rush/aaa-v1-pilot/img2threejs/prop-roof-finial-01/OBJECT_SCULPT_SPEC.json',
    // 角（kado）拠点の北棟屋根（上端11m）。歩ける縁から0.25m以上内側へ。
    anchor: { solidId: 'flash-site-kado-mass-north', position: [50, -30, 11], yawRad: 0 },
    policy: {
      rimClearanceMinM: 0.25,
      rationale: 'authored roof socket above the playable standing surface; no climb affordance',
    },
  },
];

// 規則が緩んでいないことを示すための対照。市場レーンの真ん中に自立させる。
export const UNSAFE_CONTROL_PROPOSAL = {
  id: 'control-free-standing-awning',
  specPath: 'work/asset-rush/aaa-v1-pilot/img2threejs/prop-market-awning-01/OBJECT_SCULPT_SPEC.json',
  anchor: { solidId: null, position: [20, -10, 4], yawRad: 0 },
  policy: { undersideMinM: 2.2, standingFloorZ: 4, rationale: 'deliberately unsafe control; must be rejected' },
};

// ---------------------------------------------------------------------------
// 監査本体
// ---------------------------------------------------------------------------

function readSpec(specPath) {
  const absolute = path.join(ROOT, specPath);
  const bytes = readFileSync(absolute);
  return {
    spec: JSON.parse(bytes.toString('utf8')),
    sha256: createHash('sha256').update(bytes).digest('hex').toUpperCase(),
  };
}

export function auditPlacement(map, proposal, baselineClusters) {
  const { spec, sha256 } = readSpec(proposal.specPath);
  const parts = buildCandidateParts(spec, proposal.anchor);
  const solids = map.solids;
  const standable = standableSolids(solids);
  const findings = [];

  // 1) footprint 内包
  const hosts = [];
  for (const part of parts) {
    const host = findHost(solids, part);
    hosts.push({ partId: part.id, hostId: host?.id ?? null, hostTop: host?.max[2] ?? null });
    if (!host) {
      findings.push({
        rule: 'host-containment',
        severity: 'fail',
        partId: part.id,
        partKind: part.kind,
        detail: 'no collision solid contains this part footprint; it would read as cover that bullets pass through',
      });
    }
  }

  // 2) 宿主より上に出る部品の細さ
  const aboveHost = [];
  for (const [index, part] of parts.entries()) {
    const host = hosts[index];
    if (host.hostTop == null || part.z1 <= host.hostTop + 0.05) continue;
    aboveHost.push({
      partId: part.id,
      partKind: part.kind,
      risesM: Number((part.z1 - host.hostTop).toFixed(3)),
      widestXY: Number(part.widestXY.toFixed(3)),
    });
    if (part.widestXY > THIN_VERTICAL_M + 1e-9) {
      findings.push({
        rule: 'thin-vertical',
        severity: 'fail',
        partId: part.id,
        partKind: part.kind,
        measured: Number(part.widestXY.toFixed(3)),
        limit: THIN_VERTICAL_M,
        detail: `rises ${(part.z1 - host.hostTop).toFixed(2)}m above host ${host.hostId} but is `
          + `${part.widestXY.toFixed(2)}m wide`,
      });
    }
  }

  // 3) 束ねた塊の検査。候補を仮想の被覆層として複製マップへ足して測る。
  const probeMap = {
    ...map,
    presentation: {
      ...map.presentation,
      layers: [
        ...map.presentation.layers,
        {
          id: `candidate-${proposal.id}`,
          semantics: 'clad-existing-solid',
          primitive: 'box',
          material: 'candidate-probe',
          transforms: parts.map(part => ({
            position: part.position,
            scale: part.scale,
            rotation: part.rotation,
          })),
        },
      ],
    },
  };
  const withCandidate = findUnsafeClusters(probeMap);
  const baselineKeys = new Set(baselineClusters.map(entry => `${entry.at[0].toFixed(2)}:${entry.at[1].toFixed(2)}:${entry.stand.toFixed(2)}`));
  const newClusters = withCandidate.filter(entry => (
    !baselineKeys.has(`${entry.at[0].toFixed(2)}:${entry.at[1].toFixed(2)}:${entry.stand.toFixed(2)}`)
  ));
  for (const cluster of newClusters) {
    findings.push({
      rule: 'fake-cover-cluster',
      severity: 'fail',
      partId: null,
      detail: `new body-height cluster ${cluster.w.toFixed(2)}x${cluster.d.toFixed(2)}m fill ${cluster.fill.toFixed(2)} `
        + `over standable top ${cluster.stand.toFixed(2)} (${cluster.standId})`,
    });
  }

  // 4) 当たり判定を持ち込んでいないこと
  for (const part of parts) {
    if (part.colliderType !== 'none') {
      findings.push({
        rule: 'presentation-only',
        severity: 'fail',
        partId: part.id,
        partKind: part.kind,
        measured: part.colliderType,
        detail: 'candidate parts must declare collider.type = none',
      });
    }
  }

  // 5) 通行帯（射線と足場）。人が立てる床の胴体帯に入っている部品を挙げる。
  const walkableIntrusions = [];
  for (const part of parts) {
    const hits = walkableOverlap(part, standable);
    if (hits.length === 0) continue;
    walkableIntrusions.push({
      partId: part.id,
      partKind: part.kind,
      samples: hits.length,
      standTop: hits[0].standTop,
      widestXY: Number(part.widestXY.toFixed(3)),
      z: [Number(part.z0.toFixed(3)), Number(part.z1.toFixed(3))],
    });
  }

  // 6) 経路クリアランス
  const routes = routeClearance(parts, collectRoutes(map));
  for (const block of routes.blocking) {
    findings.push({
      rule: 'route-clearance',
      severity: 'fail',
      partId: block.partId,
      measured: block.distanceM,
      limit: CAPSULE_RADIUS_M,
      detail: `blocks route ${block.routeId} at (${block.at.join(', ')})`,
    });
  }

  // 7) 個別の配置ポリシー
  const authored = parts.filter(part => part.kind === 'authored-part');
  const lowestZ = Math.min(...authored.map(part => part.z0));
  const metrics = {
    lowestAuthoredPartZ: Number(lowestZ.toFixed(3)),
    envelope: {
      x: [Number(Math.min(...parts.map(p => p.minX)).toFixed(3)), Number(Math.max(...parts.map(p => p.maxX)).toFixed(3))],
      y: [Number(Math.min(...parts.map(p => p.minY)).toFixed(3)), Number(Math.max(...parts.map(p => p.maxY)).toFixed(3))],
      z: [Number(Math.min(...parts.map(p => p.z0)).toFixed(3)), Number(Math.max(...parts.map(p => p.z1)).toFixed(3))],
    },
  };

  if (Number.isFinite(proposal.policy?.undersideMinM)) {
    // SAFETY_POLICY は「床から2.20m以上の下端」**または**「人の水平footprintの外」を求める。
    // 両方測って、どちらかが成立していれば通す。
    //
    // 下端は「頭上に張り出す部品」で測る。接地している支柱を混ぜると、
    // 支柱が床に刺さっているだけで clearance が常に0以下になり意味を失う。
    const floor = proposal.policy.standingFloorZ;
    const overhead = authored.filter(part => part.z0 > floor + 0.05);
    const clearance = overhead.length > 0
      ? Math.min(...overhead.map(part => part.z0)) - floor
      : Infinity;
    metrics.groundContactParts = authored.length - overhead.length;
    metrics.undersideClearanceM = Number.isFinite(clearance) ? Number(clearance.toFixed(3)) : null;
    metrics.outsideWalkableFootprint = walkableIntrusions.length === 0;
    if (clearance + 1e-9 < proposal.policy.undersideMinM && walkableIntrusions.length > 0) {
      findings.push({
        rule: 'underside-clearance',
        severity: 'fail',
        partId: null,
        measured: metrics.undersideClearanceM,
        limit: proposal.policy.undersideMinM,
        detail: 'lowest authored part is inside a standing player body band and below the declared underside clearance',
      });
    } else if (clearance + 1e-9 < proposal.policy.undersideMinM) {
      findings.push({
        rule: 'underside-clearance',
        severity: 'note',
        partId: null,
        measured: metrics.undersideClearanceM,
        limit: proposal.policy.undersideMinM,
        detail: 'declared 2.20m underside is not met by the authored geometry; this placement passes only because '
          + 'the whole envelope sits inside the host wall footprint, outside any standing player body band',
      });
    }
  }

  if (Number.isFinite(proposal.policy?.rimClearanceMinM)) {
    const host = solids.find(solid => solid.id === proposal.anchor.solidId);
    if (host) {
      const clearance = Math.min(
        Math.min(...parts.map(part => part.minX)) - host.min[0],
        host.max[0] - Math.max(...parts.map(part => part.maxX)),
        Math.min(...parts.map(part => part.minY)) - host.min[1],
        host.max[1] - Math.max(...parts.map(part => part.maxY)),
      );
      metrics.rimClearanceM = Number(clearance.toFixed(3));
      if (clearance + 1e-9 < proposal.policy.rimClearanceMinM) {
        findings.push({
          rule: 'rim-clearance',
          severity: 'fail',
          partId: null,
          measured: metrics.rimClearanceM,
          limit: proposal.policy.rimClearanceMinM,
          detail: `too close to the walkable rim of ${host.id}`,
        });
      }
    }
  }

  const failures = findings.filter(finding => finding.severity === 'fail');
  return {
    id: proposal.id,
    specPath: proposal.specPath,
    specSha256: sha256,
    anchor: proposal.anchor,
    policy: proposal.policy,
    adoptionState: 'candidate',
    runtimeAdmission: 'NOT_RUNTIME_ADMITTED',
    positionResolution: POSITION_RESOLUTION,
    partCount: parts.length,
    parts: parts.map(part => ({
      id: part.id,
      kind: part.kind,
      colliderType: part.colliderType,
      x: [Number(part.minX.toFixed(3)), Number(part.maxX.toFixed(3))],
      y: [Number(part.minY.toFixed(3)), Number(part.maxY.toFixed(3))],
      z: [Number(part.z0.toFixed(3)), Number(part.z1.toFixed(3))],
      widestXY: Number(part.widestXY.toFixed(3)),
    })),
    hosts,
    aboveHost,
    walkableIntrusions,
    routeClearance: routes,
    clusters: {
      baseline: baselineClusters.length,
      withCandidate: withCandidate.length,
      new: newClusters,
    },
    metrics,
    findings,
    verdict: failures.length === 0 ? 'PASS' : 'FAIL',
  };
}

export function auditCandidatePlacements(proposals = PLACEMENT_PROPOSALS) {
  const map = buildMap();
  const baseline = findUnsafeClusters(map);
  const placements = proposals.map(proposal => auditPlacement(map, proposal, baseline));
  return {
    schemaVersion: '1.0.0',
    generatedFor: '2026-08-02',
    scope: 'candidate placement probe only; no runtime registration, no collision, no map data mutation',
    limits: {
      xyToleranceM: XY_TOLERANCE_M,
      thinVerticalM: THIN_VERTICAL_M,
      bodyBandM: BODY_BAND_M,
      capsuleRadiusM: CAPSULE_RADIUS_M,
      standHeightM: STAND_HEIGHT_M,
    },
    mapSolids: map.solids.length,
    baselineUnsafeClusters: baseline.length,
    placements,
    verdict: placements.every(placement => placement.verdict === 'PASS') ? 'PASS' : 'FAIL',
  };
}

if (process.argv[1] && process.argv[1].endsWith('audit_img2threejs_candidate_placement.mjs')) {
  const outIndex = process.argv.indexOf('--out');
  const report = auditCandidatePlacements();
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (outIndex > -1 && process.argv[outIndex + 1]) {
    const target = path.resolve(ROOT, process.argv[outIndex + 1]);
    writeFileSync(target, json);
    console.log(`written ${path.relative(ROOT, target)}`);
  }
  for (const placement of report.placements) {
    console.log(`${placement.verdict} ${placement.id} `
      + `(parts ${placement.partCount}, new clusters ${placement.clusters.new.length}, `
      + `findings ${placement.findings.length})`);
    for (const finding of placement.findings) {
      console.log(`  [${finding.severity}] ${finding.rule}${finding.partId ? ` @${finding.partId}` : ''}: ${finding.detail}`);
    }
  }
  console.log(`overall ${report.verdict}`);
  process.exitCode = report.verdict === 'PASS' ? 0 : 1;
}
