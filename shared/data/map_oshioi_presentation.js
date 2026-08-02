// 潮汲み環礁ウルハ・大潮井 — original presentation SSOT.
//
// This file contains only original Kagariai art direction and deterministic
// procedural placement data. The SURAVASA reference is not imported, traced,
// or redistributed; it was used only to benchmark abstract scene-density and
// landmark-hierarchy goals.

import { SITE_CLADDING_LAYERS } from './map_oshioi_site_cladding.js';
import { GROUND_LAYERS } from './map_oshioi_ground.js';
import { VEGETATION_LAYERS } from './map_oshioi_vegetation.js';
import { LANDMARK_LAYERS } from './map_oshioi_landmarks.js';
import { CORE_CLADDING_LAYERS } from './map_oshioi_core_cladding.js';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

const t = (position, scale, rotation = [0, 0, 0]) => ({ position, scale, rotation });
const EXPANDED_PLAYABLE_BOUNDS = Object.freeze({ x: [-126, 126], y: [-92, 92] });

function outsideExpandedPlayableBounds(transform, clearanceM = 1.5) {
  const [x, y] = transform.position;
  const [sx, sy] = transform.scale;
  const yaw = transform.rotation?.[2] || 0;
  // Deliberately conservative: pitch can only shorten the projected primary
  // beam axis, so using its full length cannot let an opaque instance leak
  // into the playable envelope.
  const halfX = Math.abs(Math.cos(yaw)) * sx / 2 + Math.abs(Math.sin(yaw)) * sy / 2;
  const halfY = Math.abs(Math.sin(yaw)) * sx / 2 + Math.abs(Math.cos(yaw)) * sy / 2;
  return x + halfX <= EXPANDED_PLAYABLE_BOUNDS.x[0] - clearanceM
    || x - halfX >= EXPANDED_PLAYABLE_BOUNDS.x[1] + clearanceM
    || y + halfY <= EXPANDED_PLAYABLE_BOUNDS.y[0] - clearanceM
    || y - halfY >= EXPANDED_PLAYABLE_BOUNDS.y[1] + clearanceM;
}

// 以前は `.filter(outsideExpandedPlayableBounds)` と書いていたが、Array#filter は
// (要素, index, 配列) を渡すため index が clearanceM に入り、index が大きいほど
// 判定が厳しくなっていた。結果 metropolis の窓 1,810 個のうち 23 個しか残らず、
// 遠景都市が「無地の白い直方体」に見えていた。必ず1引数で呼ぶ。
const outsideBounds = list => list.filter(transform => outsideExpandedPlayableBounds(transform));

// 決定論的な間引き。ドローコールは層数で決まるのでインスタンスは 0 コールだが、
// maxPresentationInstances(24,000) は 7 人で共有する固定資源なので R の取り分を守る。
function capTransforms(list, max) {
  if (list.length <= max) return list;
  const kept = [];
  const stride = list.length / max;
  for (let index = 0; index < max; index++) kept.push(list[Math.floor(index * stride)]);
  return kept;
}

const BUILDINGS = [
  // North shell-plaster workshops.
  { p: [-39, 40, 0], s: [10, 8, 16], roof: 3.8, accent: 0 },
  { p: [-26, 41, 0], s: [12, 10, 11], roof: 3.2, accent: 1 },
  { p: [-11, 40, 0], s: [10, 8, 18], roof: 4.2, accent: 2 },
  { p: [3, 41, 0], s: [12, 10, 12], roof: 3.4, accent: 0 },
  { p: [19, 40, 0], s: [11, 8, 20], roof: 4.5, accent: 1 },
  { p: [34, 41, 0], s: [13, 10, 14], roof: 3.8, accent: 2 },
  // South net lofts and tide stores use a lower, warmer rhythm.
  { p: [-36, -41, 0], s: [14, 10, 12], roof: 3.5, accent: 2 },
  { p: [-19, -40, 0], s: [10, 8, 17], roof: 4.1, accent: 0 },
  { p: [-5, -41, 0], s: [12, 10, 10], roof: 3.1, accent: 1 },
  { p: [10, -40, 0], s: [10, 8, 19], roof: 4.3, accent: 2 },
  { p: [24, -41, 0], s: [12, 10, 13], roof: 3.5, accent: 0 },
  { p: [39, -40, 0], s: [10, 8, 16], roof: 3.8, accent: 1 },
  // East/west districts close the panorama without entering the play bounds.
  { p: [53, -24, 0], s: [12, 12, 14], roof: 3.6, accent: 0 },
  { p: [54, -7, 0], s: [14, 12, 20], roof: 4.6, accent: 2 },
  { p: [53, 12, 0], s: [12, 14, 11], roof: 3.2, accent: 1 },
  { p: [54, 28, 0], s: [14, 12, 17], roof: 4.0, accent: 0 },
  { p: [-53, 24, 0], s: [12, 12, 14], roof: 3.6, accent: 2 },
  { p: [-54, 7, 0], s: [14, 12, 20], roof: 4.6, accent: 0 },
  { p: [-53, -12, 0], s: [12, 14, 11], roof: 3.2, accent: 1 },
  { p: [-54, -28, 0], s: [14, 12, 17], roof: 4.0, accent: 2 },
];

const skylineShells = [];
const skylineRoofs = [];
const skylineLattice = [];
// 窓は明度3階調に割る（原則1「遠景は明度を上げ彩度を落として後退させる」を
// 面ごとに分解し、原則2「同じ部品を3スケールで反復」を窓帯で実行する）。
const glowBright = [];
const glowMid = [];
const glowDim = [];

// 遠景の棟に「上端の後退段」と「薄い水平帯」を足す。box(12tri) だけで作るので
// ほぼ無料。プレースホルダの直方体から抜け出すための最小手数。
function addSetbacksAndBands(out, bands, x, y, base, width, depth, height, steps) {
  let top = base + height;
  let w = width;
  let d = depth;
  for (let step = 0; step < steps; step++) {
    const stepHeight = 1.6 + step * 1.1;
    w *= 0.72;
    d *= 0.72;
    out.push(t([x, y, top + stepHeight / 2], [w, d, stepHeight]));
    top += stepHeight;
  }
  const bandCount = height > 24 ? 3 : 2;
  for (let band = 0; band < bandCount; band++) {
    const z = base + height * ((band + 1) / (bandCount + 1));
    bands.push(t([x, y, z], [width * 1.03, depth * 1.03, 0.34 + band * 0.1]));
  }
  return top;
}

for (const [buildingIndex, sourceBuilding] of BUILDINGS.entries()) {
  const [sourceX, sourceY, base] = sourceBuilding.p;
  const northSouth = Math.abs(sourceY) >= 35;
  const x = northSouth ? sourceX * 2.45 : Math.sign(sourceX) * 138;
  const y = northSouth ? Math.sign(sourceY) * 103 : sourceY * 2.35;
  // 高さの階層を4段に割る。従来は 10〜20m に均一で、25m を超える棟が1本も無かった。
  const heightTier = buildingIndex % 4;
  const heightScale = heightTier === 0 ? 1.95 : (heightTier === 2 ? 1.5 : 1.15);
  const building = { ...sourceBuilding, p: [x, y, base] };
  const [width, depth, rawHeight] = building.s;
  const height = rawHeight * heightScale;
  skylineShells.push(t([x, y, base + height / 2], [width, depth, height]));
  const capTop = addSetbacksAndBands(
    skylineShells, skylineLattice, x, y, base, width, depth, height,
    heightTier === 0 ? 2 : (heightTier === 2 ? 1 : 0),
  );
  skylineRoofs.push(t(
    [x, y, capTop + building.roof / 2],
    [width * 0.9, depth * 0.9, building.roof],
    [0, 0, 0],
  ));

  const facesNorthSouth = Math.abs(y) >= 35;
  const faceSign = facesNorthSouth ? -Math.sign(y) : -Math.sign(x);
  const bayCount = Math.max(2, Math.floor((facesNorthSouth ? width : depth) / 2.5));
  const levelCount = Math.max(2, Math.floor(height / 3.4));
  for (let level = 0; level < levelCount; level++) {
    for (let bay = 0; bay < bayCount; bay++) {
      const along = ((bay + 0.5) / bayCount - 0.5)
        * (facesNorthSouth ? width * 0.76 : depth * 0.76);
      const z = base + 2.2 + level * Math.min(3.8, (height - 3) / levelCount);
      const windowPosition = facesNorthSouth
        ? [x + along, y + faceSign * (depth / 2 + 0.055), z]
        : [x + faceSign * (width / 2 + 0.055), y + along, z];
      // 窓の寸法を3段に振る（原則2の3スケール反復。従来は2種しかなかった）。
      const sizeTier = (bay * 3 + level * 2 + buildingIndex) % 3;
      const paneWide = [1.5, 1.15, 0.8][sizeTier];
      const paneTall = [1.65, 1.25, 0.75][sizeTier];
      const windowScale = facesNorthSouth
        ? [paneWide, 0.08, paneTall]
        : [0.08, paneWide, paneTall];
      const tone = (bay + level * 2 + buildingIndex * 3) % 5;
      const transform = t(windowPosition, windowScale);
      if (tone === 0) glowBright.push(transform);
      else if (tone === 1 || tone === 3) glowMid.push(transform);
      else glowDim.push(transform);
    }
  }

  // Cedar posts turn each mass into a readable workshop rather than a box.
  const postCount = Math.max(3, Math.floor((facesNorthSouth ? width : depth) / 2.8));
  for (let post = 0; post <= postCount; post++) {
    const along = (post / postCount - 0.5) * (facesNorthSouth ? width * 0.94 : depth * 0.94);
    const position = facesNorthSouth
      ? [x + along, y + faceSign * (depth / 2 + 0.08), base + height / 2]
      : [x + faceSign * (width / 2 + 0.08), y + along, base + height / 2];
    skylineLattice.push(t(position, facesNorthSouth
      ? [0.14, 0.12, height * 0.92]
      : [0.12, 0.14, height * 0.92]));
  }
}

const trusses = [];
const addBeam = (from, to, thickness = 0.22) => {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  const yaw = Math.atan2(dy, dx);
  const pitch = -Math.atan2(dz, Math.hypot(dx, dy));
  trusses.push(t(
    [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
    [length, thickness, thickness],
    [0, pitch, yaw],
  ));
};

// Original triangular tide gauges and dock cranes. All opaque members sit
// beyond the canonical boundary, so they never advertise false cover.
for (const [x, y, facing] of [
  [-82, 98, -1], [0, 98, -1], [82, 98, -1],
  [-82, -98, 1], [0, -98, 1], [82, -98, 1],
]) {
  const apex = [x, y, 17];
  const left = [x - 3.8, y + facing * 0.2, 0];
  const right = [x + 3.8, y + facing * 0.2, 0];
  addBeam(left, apex, 0.3);
  addBeam(right, apex, 0.3);
  addBeam([x - 3.1, y, 3], [x + 3.1, y, 3], 0.22);
  addBeam([x - 2.1, y, 8], [x + 2.1, y, 8], 0.18);
}
for (const [x, y, sign] of [[134, -64, 1], [-134, 64, -1], [134, 62, 1], [-134, -62, -1]]) {
  addBeam([x, y, 1], [x, y, 13], 0.42);
  addBeam([x, y, 12.5], [x + sign * 9, y, 15.5], 0.32);
  addBeam([x + sign * 1.4, y, 12.9], [x + sign * 8.4, y, 15.2], 0.13);
}

const trunks = [];
const crowns = [];
const treeSites = [];
for (let index = 0; index < 44; index++) {
  const side = index % 4;
  const offset = (index * 17 % 67) / 66;
  const x = side < 2 ? -110 + offset * 220 : (side === 2 ? -132 : 132);
  const y = side >= 2 ? -82 + offset * 164 : (side === 0 ? -97 : 97);
  const height = 3.2 + (index % 5) * 0.38;
  treeSites.push([x, y, height]);
  trunks.push(t([x, y, height / 2], [0.42, 0.42, height]));
  crowns.push(t(
    [x + ((index % 3) - 1) * 0.3, y, height + 1.25],
    [2.3 + (index % 4) * 0.28, 1.8 + (index % 3) * 0.3, 2.6 + (index % 2) * 0.45],
    [0.1 * (index % 2), 0.16 * (index % 3), index * 0.73],
  ));
}

const pylons = [];
const harborLights = [];
for (let index = 0; index < 32; index++) {
  const ratio = index / 31;
  const x = -110 + ratio * 220;
  for (const y of [-97, 97]) {
    const h = 2.2 + (index % 4) * 0.22;
    pylons.push(t([x, y, h / 2], [0.34, 0.34, h]));
    harborLights.push(t([x, y, h + 0.22], [0.34, 0.34, 0.34]));
  }
}

const sails = [];
for (const [x, y, z, sx, sz, rz] of [
  [-92, 97, 9, 5, 3.4, -0.16], [-48, 97, 7, 4.2, 2.8, 0.12],
  [50, 97, 8.5, 4.8, 3.2, -0.08], [94, 97, 6.5, 4, 2.5, 0.15],
  [-94, -97, 7, 4.3, 2.8, 0.11], [-42, -97, 9, 5, 3.4, -0.14],
  [46, -97, 6.8, 4, 2.6, 0.1], [92, -97, 8.7, 4.8, 3.2, -0.12],
]) {
  sails.push(t([x, y, z], [sx, sz, 1], [Math.PI / 2, 0, rz]));
}

// A full original harbor-city panorama. Near rows are human-scale workshops;
// middle rows step into apartment-like tide stores; far rows form a readable
// metropolitan silhouette. Placement deliberately follows a rectilinear
// industrial-tide language, not the reference map's motifs or topology.
const metropolisShell = [];
const metropolisIndigo = [];
const metropolisRoofs = [];
const metropolisBarrelRoofs = [];
const metropolisSawRoofs = [];
const metropolisDomes = [];
const metropolisFlatRoofs = [];
const metropolisLattice = [];
const metropolisTubes = [];
const citySites = [];

let cityState = 0x0a7105e;
const cityRandom = () => {
  cityState = (Math.imul(cityState, 1664525) + 1013904223) >>> 0;
  return cityState / 0x100000000;
};

// `siteIndex % 5` は、遠景をどの方向から見ても5棟ごとに同じ屋根が戻る
// 機械的な拍に見えた。ここは意図的にレビューした17棟の拍で循環させる。
// 既存の4屋根層へ振り分けるだけなので、draw call / instance 数は増えない。
const FAR_ROOF_STYLE_PERMUTATION = Object.freeze([
  'dome', 'hip', 'barrel', 'hip', 'saw', 'barrel', 'hip', 'saw', 'hip',
  'dome', 'barrel', 'hip', 'saw', 'hip', 'barrel', 'dome', 'saw',
]);
// tier 0（siteIndex % 8 === 0）だけに置く、遠景の控えめなランドマーク3棟。
// ランダム値を追加で消費しないため、都市全体の既存シード列は変えない。
const FAR_ROOF_OUTLIERS = Object.freeze({
  0: Object.freeze({ style: 'dome', heightScale: 1.70, footprintScale: 1.08 }),
  32: Object.freeze({ style: 'saw', heightScale: 1.85, footprintScale: 1.12 }),
  80: Object.freeze({ style: 'barrel', heightScale: 1.75, footprintScale: 0.94 }),
});

for (const y of [108, 124]) {
  const step = y < 120 ? 18 : 22;
  for (let x = -148; x <= 148; x += step) {
    citySites.push([x + (cityRandom() - 0.5) * 3.5, y, 'south']);
    citySites.push([-x + (cityRandom() - 0.5) * 3.5, -y, 'north']);
  }
}
for (const x of [142, 158]) {
  const step = x < 150 ? 20 : 24;
  for (let y = -100; y <= 100; y += step) {
    citySites.push([x, y + (cityRandom() - 0.5) * 3.5, 'west']);
    citySites.push([-x, -y + (cityRandom() - 0.5) * 3.5, 'east']);
  }
}

for (const [siteIndex, [x, y, face]] of citySites.entries()) {
  const near = Math.min(Math.abs(x) / 46, Math.abs(y) / 34);
  const width = 7.5 + cityRandom() * 7.5;
  const depth = 7 + cityRandom() * 7;
  // 高さの4階層。従来は 8〜21m に集中し、床上25m を超える遠景棟が実質ゼロで、
  // スカイラインがほぼ水平だった（原則1・原則3）。塔階層を 1/8 の頻度で入れる。
  const tier = siteIndex % 8;
  const tierHeight = tier === 0
    ? 30 + cityRandom() * 15
    : (tier === 1 || tier === 5
      ? 21 + cityRandom() * 8
      : (tier === 3 ? 14 + cityRandom() * 6 : 9 + cityRandom() * 7));
  const height = tierHeight + Math.max(0, near - 1.2) * 4.5;
  const base = cityRandom() * 1.2 - 0.4;
  const accent = siteIndex % 7;
  const shellTransform = t([x, y, base + height / 2], [width, depth, height]);
  // 寒色は indigo 1系のみ（原則4）。遠景の寒色塊はこの層だけが持つ。
  if (accent === 0 || accent === 4) metropolisIndigo.push(shellTransform);
  else metropolisShell.push(shellTransform);

  const upperHeight = height * (0.23 + cityRandom() * 0.16);
  const hasUpper = siteIndex % 3 !== 1;
  if (hasUpper) {
    metropolisShell.push(t(
      [x, y, base + height + upperHeight / 2],
      [width * (0.54 + cityRandom() * 0.18), depth * (0.52 + cityRandom() * 0.2), upperHeight],
    ));
  }
  // 後退段と水平帯。高い棟ほど段数を増やしてシルエットに刻みを作る。
  let roofBase = base + height + (hasUpper ? upperHeight : 0);
  if (height > 20) {
    roofBase = addSetbacksAndBands(
      metropolisShell, metropolisLattice, x, y,
      base, width, depth, roofBase - base, height > 28 ? 2 : 1,
    );
  } else {
    const bandZ = base + height * 0.58;
    metropolisLattice.push(t([x, y, bandZ], [width * 1.04, depth * 1.04, 0.36]));
  }
  const roofOutlier = FAR_ROOF_OUTLIERS[siteIndex] || null;
  const roofHeight = (2.4 + cityRandom() * 3.8) * (roofOutlier?.heightScale || 1);
  const roofFootprintScale = roofOutlier?.footprintScale || 1;
  const roofWidth = width * (hasUpper ? 0.72 : 1.13) * roofFootprintScale;
  const roofDepth = depth * (hasUpper ? 0.72 : 1.13) * roofFootprintScale;
  metropolisFlatRoofs.push(t([x, y, roofBase + 0.11], [roofWidth * 1.12, roofDepth * 1.12, 0.22]));
  const roofTransform = t(
    [x, y, roofBase + roofHeight / 2],
    [roofWidth, roofDepth, roofHeight],
    [0, 0, siteIndex % 2 ? Math.PI / 2 : 0],
  );
  const roofStyle = roofOutlier?.style
    || FAR_ROOF_STYLE_PERMUTATION[siteIndex % FAR_ROOF_STYLE_PERMUTATION.length];
  if (roofStyle === 'hip') metropolisRoofs.push(roofTransform);
  else if (roofStyle === 'barrel') metropolisBarrelRoofs.push(roofTransform);
  else if (roofStyle === 'saw') metropolisSawRoofs.push(roofTransform);
  else metropolisDomes.push(t(
    [x, y, roofBase + roofHeight * 0.42],
    [roofWidth * 0.82, roofDepth * 0.82, roofHeight * 0.84],
  ));

  const northSouth = face === 'north' || face === 'south';
  const faceSign = (face === 'south' || face === 'west') ? -1 : 1;
  const frontage = northSouth ? width : depth;
  const bayCount = Math.max(2, Math.floor(frontage / 2.25));
  const levelCount = Math.max(2, Math.min(11, Math.floor(height / 3.4)));
  for (let level = 0; level < levelCount; level++) {
    for (let bay = 0; bay < bayCount; bay++) {
      if ((bay + level + siteIndex) % 7 === 0) continue;
      const along = ((bay + 0.5) / bayCount - 0.5) * frontage * 0.78;
      const z = base + 2.1 + level * ((height - 2.8) / levelCount);
      const position = northSouth
        ? [x + along, y + faceSign * (depth / 2 + 0.065), z]
        : [x + faceSign * (width / 2 + 0.065), y + along, z];
      const sizeTier = (bay + level * 2 + siteIndex) % 3;
      const paneWide = [1.35, 1.0, 0.7][sizeTier];
      const paneTall = [1.45, 1.1, 0.68][sizeTier];
      const transform = t(position, northSouth
        ? [paneWide, 0.09, paneTall]
        : [0.09, paneWide, paneTall]);
      // 上層ほど明るい。遠景の明度が上がり、金の灯が上へ抜ける。
      const tone = (level * 2 + bay + siteIndex) % 5;
      if (tone === 0 || (level >= levelCount - 2 && tone === 2)) glowBright.push(transform);
      else if (tone === 1 || tone === 3) glowMid.push(transform);
      else glowDim.push(transform);
    }
  }

  const postCount = Math.max(3, bayCount);
  for (let post = 0; post <= postCount; post++) {
    const along = (post / postCount - 0.5) * frontage * 0.94;
    const position = northSouth
      ? [x + along, y + faceSign * (depth / 2 + 0.085), base + height / 2]
      : [x + faceSign * (width / 2 + 0.085), y + along, base + height / 2];
    metropolisLattice.push(t(position, northSouth
      ? [0.13, 0.12, height * 0.94]
      : [0.12, 0.13, height * 0.94]));
  }

  if (siteIndex % 2 === 0) {
    const balconyZ = base + height * (0.43 + cityRandom() * 0.2);
    const balconyPosition = northSouth
      ? [x, y + faceSign * (depth / 2 + 0.42), balconyZ]
      : [x + faceSign * (width / 2 + 0.42), y, balconyZ];
    metropolisLattice.push(t(balconyPosition, northSouth
      ? [width * 0.72, 0.8, 0.18]
      : [0.8, depth * 0.72, 0.18]));
  }

  const ventCount = 1 + siteIndex % 3;
  for (let vent = 0; vent < ventCount; vent++) {
    const vx = x + ((vent + 1) / (ventCount + 1) - 0.5) * roofWidth * 0.54;
    const vy = y + ((siteIndex + vent) % 3 - 1) * roofDepth * 0.14;
    const vh = 0.9 + cityRandom() * 1.8;
    metropolisTubes.push(t([vx, vy, roofBase + roofHeight * 0.72 + vh / 2], [0.34, 0.34, vh]));
  }
  if (siteIndex % 4 === 0) {
    const antennaHeight = 3.5 + cityRandom() * 5;
    metropolisTubes.push(t(
      [x + width * 0.18, y - depth * 0.12, roofBase + roofHeight * 0.82 + antennaHeight / 2],
      [0.09, 0.09, antennaHeight],
    ));
  }

  // Vertical tide pipes and cross-joints create readable functional detail.
  if (siteIndex % 3 === 0) {
    const pipePosition = northSouth
      ? [x + frontage * 0.29, y + faceSign * (depth / 2 + 0.12), base + height * 0.46]
      : [x + faceSign * (width / 2 + 0.12), y + frontage * 0.29, base + height * 0.46];
    metropolisTubes.push(t(pipePosition, [0.22, 0.22, height * 0.72]));
  }
}

const expandedTrunks = [];
const expandedCrowns = [];
const shorelineRocks = [];
for (let index = 0; index < 210; index++) {
  const side = index % 4;
  const ratio = ((index * 37) % 211) / 210;
  const x = side < 2 ? -118 + ratio * 236 : (side === 2 ? -133 : 133);
  const y = side >= 2 ? -84 + ratio * 168 : (side === 0 ? -99 : 99);
  const angle = index * 2.399963229728653;
  const height = 3.2 + (index % 7) * 0.36;
  expandedTrunks.push(t([x, y, height / 2], [0.36, 0.36, height]));
  for (let crown = 0; crown < 2; crown++) {
    expandedCrowns.push(t(
      [x + (crown ? 0.65 : -0.32), y + ((index + crown) % 3 - 1) * 0.35, height + 0.9 + crown * 0.58],
      [2.1 + (index % 5) * 0.25, 1.7 + ((index + crown) % 4) * 0.24, 2.2 + crown * 0.4],
      [index * 0.07, crown * 0.16, angle + crown * 0.8],
    ));
  }
}
for (let index = 0; index < 260; index++) {
  const side = index % 4;
  const ratio = ((index * 43) % 263) / 262;
  const x = side < 2 ? -121 + ratio * 242 : (side === 2 ? -133 : 133);
  const y = side >= 2 ? -86 + ratio * 172 : (side === 0 ? -96 : 96);
  const angle = index * 1.61803398875;
  const size = 0.55 + (index % 8) * 0.17;
  shorelineRocks.push(t(
    [x, y, -0.05 + size * 0.36],
    [size * 1.7, size, size * 0.78],
    [index * 0.13, index * 0.17, angle],
  ));
}

// ---- R の予算管理 ----
// ドローコールは層数で決まる（1層＝1 InstancedMesh＝1 draw call）ので、
// 密度は「層を増やす」のではなく「既存層に transforms を足す」ことで稼ぐ。
// maxPresentationInstances(24,000) は 7 担当で共有するので、
// 境界外（遠景）の合計をここで固定し、他担当の枠を侵さない。
// 反復2で 2,300 → 3,100 へ。検証で「5拠点全景だけ暖寒が反転（寒色53.2% / 暖色5.2%）」
// と出たので、遠景に金の灯（farGlowWarm）を増やして寒色の帯に暖色の点を通す。
// box(12三角形) なので +800 インスタンスでも +9,600 三角形にしかならない。
const FAR_INSTANCE_BUDGET = 3100;

const farShellMasses = [...skylineShells, ...metropolisShell];
const farAccentDetail = [...skylineLattice, ...metropolisLattice];
const farRoofPlates = outsideBounds(metropolisFlatRoofs);
const farHipRoofs = [...skylineRoofs, ...outsideBounds(metropolisRoofs)];
const farDomes = outsideBounds(metropolisDomes);
const farIndigoMasses = outsideBounds(metropolisIndigo);
const farTubes = outsideBounds(metropolisTubes);
const farTrunks = capTransforms([...trunks, ...outsideBounds(expandedTrunks)], 140);
const farCrowns = capTransforms(crowns, 44);
const farCrownsLight = capTransforms(outsideBounds(expandedCrowns), 150);
const farRocks = capTransforms(outsideBounds(shorelineRocks), 150);

const FAR_FIXED = farRoofPlates.length + farHipRoofs.length + farIndigoMasses.length
  + farTubes.length + farTrunks.length + farCrowns.length + farCrownsLight.length
  + farRocks.length + trusses.length + pylons.length + harborLights.length + sails.length
  + outsideBounds(metropolisBarrelRoofs).length + outsideBounds(metropolisSawRoofs).length
  + farDomes.length;
const FAR_ELASTIC = Math.max(0, FAR_INSTANCE_BUDGET - FAR_FIXED);
// 残りを「塊 : 細部 : 窓」= 30 : 22 : 48 で割る。窓が最も安く(12tri)、
// 金の差し色（原則4）と遠景の階調（原則1）の両方を担うので最大配分にする。
const farShells = capTransforms(outsideBounds(farShellMasses), Math.round(FAR_ELASTIC * 0.30));
const farAccents = capTransforms(outsideBounds(farAccentDetail), Math.round(FAR_ELASTIC * 0.22));
const glowBudget = FAR_ELASTIC - farShells.length - farAccents.length;
// 金の灯を最大配分にする（34% → 46%）。遠景の暗い窓は霧に沈んで見えないので、
// dim を削って warm へ回すのが最も効率がよい。
const farGlowBright = capTransforms(outsideBounds(glowBright), Math.round(glowBudget * 0.46));
const farGlowMid = capTransforms(outsideBounds(glowMid), Math.round(glowBudget * 0.38));
const farGlowDim = capTransforms(outsideBounds(glowDim), Math.round(glowBudget * 0.16));

export const OSHIOI_PRESENTATION = deepFreeze({
  schemaVersion: 1,
  id: 'oshioi-shiokagami-original-v1',
  title: '潮鏡 — 貝灰灯港',
  visualBoundsM: { x: [-180, 180], y: [-140, 140] },
  authorship: {
    origin: 'original-kagariai',
    externalRuntimeAssets: [],
    referencePolicy: 'abstract-quality-benchmark-only',
    prohibitedMotifs: ['suravasa-layout', 'suravasa-architecture', 'suravasa-textures', 'suravasa-meshes'],
  },
  palette: {
    shell: 0xd8ccb2,
    basalt: 0x26383a,
    cedar: 0x754833,
    indigo: 0x244f6a,
    copper: 0xb98249,
    tideGlow: 0x76e6df,
    foliage: 0x365f52,
    foliageLight: 0x5b8063,
    windowGlow: 0xf2b66d,
  },
  surfaceColors: {
    ground: 0x33484a,
    slab: 0xb9ad91,
    rim: 0xcfc3a7,
    stair: 0x8f8775,
    cover: 0x6f4936,
    wall: 0xc7bca1,
    spawnwall: 0x26383a,
    tower: 0x9b704a,
    solid: 0x8e826c,
  },
  facadeColors: [0xd8ccb2, 0x315f73, 0x9b6546, 0x657b78],
  navigationColors: {
    front: 0xf2b66d,
    cloister: 0x6ed7de,
    shallows: 0x789bc7,
  },
  performanceBudget: {
    // render.js は層数か instance 数がこの予算を超えると presentation 全体を null で返し、
    // console.warn 1行だけで全層が無音消滅する（_buildOriginalMapPresentation）。
    // 建築密度を上げる作業で層数が 28 を大きく超えるため、真の律速だったこの値を先に引き上げる。
    // 三角形数は 289k / 1.2M で 3.1 倍の余裕があり、ドローコールも実プレイ 72 / 250。
    maxPresentationDrawCalls: 128,
    maxPresentationInstances: 24000,
    maxDynamicLights: 0,
  },
  layers: [
    // ---- プレイ領域内の被覆（semantics: 'clad-existing-solid'）----
    // 宿主ソリッドの footprint 内に収まることを tests/map_site_cladding.test.js が
    // 保証する（偽の遮蔽を作らない）。各担当のモジュールをここで束ねる。
    ...SITE_CLADDING_LAYERS,
    ...GROUND_LAYERS,
    ...VEGETATION_LAYERS,
    ...LANDMARK_LAYERS,
    ...CORE_CLADDING_LAYERS,

    // ---- 境界外の遠景（semantics: 'outside-playable-bounds'）----
    // 28層 → 20層へ統合した。primitive + material + 影設定が一致する層は
    // 1つの InstancedMesh にまとめられる（1層＝1ドローコール）。
    // 統合しても semantics はまたがない（安全検査の対象集合を変えないため）。
    {
      // 遠景の淡い暖色の大質量。棟・上階・後退段を1層に集約。
      id: 'district-shells',
      primitive: 'box',
      material: 'farShell',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farShells,
    },
    {
      // 唯一の寒色（indigo 系）の遠景塊。他の寒色は持たせない（原則4）。
      id: 'metropolis-indigo-stores',
      primitive: 'box',
      material: 'farIndigo',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farIndigoMasses,
    },
    {
      // 柱・水平帯・バルコニー。縦の反復を横に割る細部を1層へ。
      id: 'district-far-accents',
      primitive: 'box',
      material: 'farAccent',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farAccents,
    },
    {
      id: 'district-hip-roofs',
      primitive: 'hipRoof',
      material: 'farRoof',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farHipRoofs,
    },
    {
      // 軒と陸屋根。chamferBox(620tri) から box(12tri) へ置換した。
      id: 'metropolis-eaves',
      primitive: 'box',
      material: 'farRoof',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farRoofPlates,
    },
    {
      id: 'metropolis-barrel-roofs',
      primitive: 'barrelRoof',
      material: 'farRoofWarm',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: outsideBounds(metropolisBarrelRoofs),
    },
    {
      id: 'metropolis-saw-roofs',
      primitive: 'sawRoof',
      material: 'farRoofLight',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: outsideBounds(metropolisSawRoofs),
    },
    {
      // 丸屋根は遠景だけに置く。競技領域の当たり判定へは一切加えず、
      // 上空から見た屋根のリズムだけを増やす。
      id: 'metropolis-dome-roofs',
      primitive: 'dome',
      material: 'farRoof',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farDomes,
    },
    {
      // 窓の明度3階調。上層ほど明るい金へ寄せ、遠景に金の差し色を通す（原則4）。
      id: 'district-windows-bright',
      primitive: 'box',
      material: 'farGlowWarm',
      semantics: 'outside-playable-bounds',
      castShadow: false,
      receiveShadow: false,
      transforms: farGlowBright,
    },
    {
      id: 'district-windows',
      primitive: 'box',
      material: 'farGlow',
      semantics: 'outside-playable-bounds',
      castShadow: false,
      receiveShadow: false,
      transforms: farGlowMid,
    },
    {
      id: 'district-windows-dim',
      primitive: 'box',
      material: 'farGlowDim',
      semantics: 'outside-playable-bounds',
      castShadow: false,
      receiveShadow: false,
      transforms: farGlowDim,
    },
    {
      id: 'tide-gauge-trusses',
      primitive: 'box',
      material: 'copper',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: trusses,
    },
    {
      id: 'windbreak-trunks',
      primitive: 'cylinder',
      material: 'cedar',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farTrunks,
    },
    {
      // dodeca(144tri) → dodecaLow(36tri)。遠景で面数の差は視認できない。
      id: 'windbreak-crowns',
      primitive: 'dodecaLow',
      material: 'foliage',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farCrowns,
    },
    {
      id: 'expanded-windbreak-crowns',
      primitive: 'dodecaLow',
      material: 'foliageLight',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farCrownsLight,
    },
    {
      id: 'tidal-pylons',
      primitive: 'cylinder',
      material: 'farRoof',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: pylons,
    },
    {
      // 灯の文化なので港灯は金。sphere(140tri) → dodecaLow(36tri)。
      // これで遠景から水色(tideGlow)が消え、寒色が indigo 1系に揃う。
      id: 'harbor-lights',
      primitive: 'dodecaLow',
      material: 'lanternGold',
      semantics: 'outside-playable-bounds',
      castShadow: false,
      receiveShadow: false,
      transforms: harborLights,
    },
    {
      id: 'indigo-signal-sails',
      primitive: 'plane',
      material: 'indigoCloth',
      semantics: 'outside-playable-bounds',
      castShadow: false,
      receiveShadow: false,
      transforms: sails,
    },
    {
      // 排気筒・潮管・アンテナを1層へ。
      id: 'metropolis-roof-vents',
      primitive: 'cylinder',
      material: 'farAccent',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farTubes,
    },
    {
      id: 'shoreline-rock-fields',
      primitive: 'dodecaLow',
      material: 'wetRock',
      semantics: 'outside-playable-bounds',
      castShadow: true,
      receiveShadow: true,
      transforms: farRocks,
    },
  ],
  materials: {
    // ---- 遠景（空気遠近: 明度を上げ彩度を落として後退させる）----
    // 大質量は淡い暖色。以前の 0xc9cbc4 は冷たい灰で、暖色の街との対比が出ていなかった。
    // 反復2: network（5拠点全景）だけ暖寒が反転していた（寒色53.2% / 暖色5.2%）。
    // 原因は遠景の大質量 farShell(0xd7d0c2) が空(0x9bcbd8)と霧(0xa9d0d5)に溶けて
    // 明度差のない灰色の帯になっていたこと。淡い暖色へ寄せて空との色相差を作る。
    farShell: { type: 'standard', color: 0xe6dcc6, roughness: 0.9, metalness: 0.01 },
    farRoof: { type: 'standard', color: 0x8a8377, roughness: 0.8, metalness: 0.06 },
    // 同じ屋根材だけが反復して見えないよう、錆色と淡い亜鉛色を既存屋根層へ割り当てる。
    // どちらも空気遠近の範囲に留め、前景の銅・金より強くしない。
    farRoofWarm: { type: 'standard', color: 0x9a8068, roughness: 0.82, metalness: 0.05 },
    farRoofLight: { type: 'standard', color: 0xa29a8c, roughness: 0.84, metalness: 0.04 },
    // 512インスタンス（全体の4.8%）の青灰。暖色中性へ寄せて寒色を indigo 1系へ戻す。
    farAccent: { type: 'standard', color: 0xa8a292, roughness: 0.85, metalness: 0.03 },
    // 寒色は indigo 1系のみ。遠景版は明度を上げ彩度を落とした indigo。
    farIndigo: { type: 'standard', color: 0x6f8ba3, roughness: 0.86, metalness: 0.03 },
    // 窓の明度3階調。additive は明るい空(0x9bcbd8)と霧に飽和して沈むため、
    // 遠景でも実体のある standard + emissive にして「金の灯」を残す。
    farGlowWarm: {
      type: 'standard', color: 0xf0c184, roughness: 0.42, metalness: 0.12,
      emissive: 0xc08236, emissiveIntensity: 0.85,
    },
    farGlow: {
      type: 'standard', color: 0xd8b184, roughness: 0.5, metalness: 0.1,
      emissive: 0x8a5f2c, emissiveIntensity: 0.45,
    },
    farGlowDim: {
      type: 'standard', color: 0x8d8577, roughness: 0.7, metalness: 0.06,
      emissive: 0x2a1e12, emissiveIntensity: 0.18,
    },
    lanternGold: {
      type: 'standard', color: 0xffd48f, roughness: 0.3, metalness: 0,
      emissive: 0xd4913a, emissiveIntensity: 1.1,
    },
    // metalness は「金属か否か」の二値であり、中間値は物理的に存在しない。
    // 中間値（0.15〜0.5）を置くと、非金属が金属的に光り、金属は金属に見えない、という
    // 「プラスチックっぽさ」の主因になる。石・漆喰・瓦は 0.0〜0.05、金属は 0.7 以上、
    // 発光面は 0 に寄せる。詳細は docs/AAA_MATERIAL_REALISM_PLAN_20260802.md §4。
    shell: { type: 'standard', color: 0xf0e4cc, roughness: 0.88, metalness: 0.02 },
    // 玄武岩は非金属。0.16 は石を金属的に光らせていた。
    basalt: { type: 'standard', color: 0x3e3a34, roughness: 0.73, metalness: 0.04 },
    cedar: { type: 'standard', color: 0x8a5233, roughness: 0.78, metalness: 0.03 },
    copper: {
      type: 'standard', color: 0xe0ac63, roughness: 0.38, metalness: 0.72,
      emissive: 0x24140b, emissiveIntensity: 0.12,
    },
    foliage: { type: 'standard', color: 0x365f52, roughness: 0.92, metalness: 0 },
    foliageLight: { type: 'standard', color: 0x53785f, roughness: 0.9, metalness: 0 },
    // 濡れ石も非金属。濡れは metalness ではなく roughness を下げて表現する。
    wetRock: { type: 'standard', color: 0x2c4249, roughness: 0.5, metalness: 0.04 },
    indigoWall: { type: 'standard', color: 0x2a5e8c, roughness: 0.82, metalness: 0.04 },
    // 設計書§15「東=橙硝子・西=藍硝子」。西の陣営灯は indigoWall（emissive 無し）に
    // 割り当てられていたため、灯ではなく暗い青い箱として描かれ、東 65 個だけが光る
    // 非対称になっていた。藍の**硝子**として発光する材質をここで持つ。
    indigoGlow: {
      type: 'standard', color: 0x4a86b8, roughness: 0.33, metalness: 0,
      emissive: 0x1a4a7a, emissiveIntensity: 0.7,
    },
    copperPlaster: { type: 'standard', color: 0xc2814f, roughness: 0.8, metalness: 0.06 },
    shellShade: { type: 'standard', color: 0xd8c5a2, roughness: 0.86, metalness: 0.03 },
    // 敷石の継ぎ目。実画面の検証で、床が「明るい面に置かれたテラコッタの貼り紙」に
    // 見えていた。継ぎ目は**色相を変えず明度だけ落とす**（貝灰の影色）。
    // cedar(0x8a5233) を使うと目地自体が暖色の線として主張し、貼り紙感が増える。
    // 逆に basalt(0x3e3a34) まで落とすと広場全体が黒い格子に見える（旧版の失敗）。
    stoneJoint: { type: 'standard', color: 0xa89877, roughness: 0.9, metalness: 0.02 },
    // 藍屋根は焼き物の瓦として扱う（非金属）。0.26 はどちらでもない中間値だった。
    roofBlue: { type: 'standard', color: 0x1e4667, roughness: 0.6, metalness: 0.05 },
    // 銅屋根は金属板として扱う。0.34 では銅に見えず、かつ瓦にも見えなかった。
    roofCopper: { type: 'standard', color: 0xa06b3a, roughness: 0.52, metalness: 0.7 },
    // 原則4「金の差し色」の主役。clad-ring-window だけで全インスタンスの約30%を
    // 占めるので、ここ1箇所が画面全体の金の量を決める。
    // 旧: basic + additive + opacity 0.82 + depthWrite:false。加算合成が明るい空
    // (0x9bcbd8) と霧(0xa9d0d5) に飽和し、実測色は R−B = −57〜+32 と金に見えなかった。
    // 新: 不透明の standard + emissive。背後の空に依存せず自分の色を出す。
    // 発光面（硝子・灯り）は金属ではない。metalness を残すと環境反射が無い現状では
    // ただ暗く濁るだけで、灯りの明度が損なわれる。
    windowGlow: {
      type: 'standard', color: 0xe8a94e, roughness: 0.33, metalness: 0,
      emissive: 0x9a5d14, emissiveIntensity: 0.75,
    },
    tideGlow: {
      type: 'basic', color: 0x76e6df, transparent: true, opacity: 0.78,
      blending: 'additive',
    },
    indigoCloth: {
      type: 'standard', color: 0x244f6a, roughness: 0.94, metalness: 0,
      transparent: true, opacity: 0.86, side: 'double',
    },
  },
});
