// 射撃（訓練灯銃・即着弾）。サーバー権威。
// ヒットスキャン: ソリッド遮蔽 → プレイヤー胴体円柱＋頭部球の最近ヒット。
// 距離減衰: falloffStart〜falloffEndで線形にfalloffMinMultまで低下。

import { raySphere, sweepSphereCylinder } from './collision.js';
import { eyeHeight, bodyHeight } from './movement.js';

export const DEFAULT_WEAPON_MUZZLE_FORWARD_M = 0.8;
export const DEFAULT_WEAPON_MUZZLE_DROP_M = 0.15;

export function makeWeaponState(w) {
  return { ammo: w.magSize, nextFireT: 0, reloadStartedAt: null, reloadUntil: 0, chargeStartedAt: null };
}

export function tickWeaponState(pl, w, t) {
  const ws = pl.weapon;
  if (ws.reloadStartedAt === null || t + 1e-9 < ws.reloadUntil) return false;
  if (w.reloadSec > 0 && w.magSize > 0) ws.ammo = w.magSize;
  ws.reloadStartedAt = null;
  ws.reloadUntil = 0;
  return true;
}

function beginReload(ws, w, t) {
  ws.reloadStartedAt = t;
  ws.reloadUntil = t + w.reloadSec;
}

// 発射可否とリロード処理。tは試合通算秒。
// wantReload=true は「リロードのみ」の意図。満弾時は何もしない（弾を消費しない）。
export function tryBeginFire(pl, w, t, wantReload) {
  const ws = pl.weapon;
  tickWeaponState(pl, w, t);
  if (t < ws.reloadUntil) return false;              // リロード中
  const infiniteAmmo = w.reloadSec === 0 || w.magSize <= 0;
  if (wantReload) {
    if (!infiniteAmmo && ws.ammo < w.magSize) {
      beginReload(ws, w, t);
    }
    return false;
  }
  if (!infiniteAmmo && ws.ammo <= 0) {
    beginReload(ws, w, t);
    return false;
  }
  if (t < ws.nextFireT) return false;
  // 固定tickの端数で連射間隔が毎発切り上がらないよう、予定時刻を基準に進める。
  ws.nextFireT = (ws.nextFireT > 0 ? ws.nextFireT : t) + 1 / w.rps;
  if (ws.nextFireT <= t) ws.nextFireT = t + 1 / w.rps;
  if (!infiniteAmmo) ws.ammo--;
  return true;
}

// 射撃方向（yaw/pitch＋スプレッド）
export function fireDirection(yaw, pitch, spreadDeg, rng) {
  const s = (spreadDeg * Math.PI) / 180;
  const dy = (rng() * 2 - 1) * s;
  const dp = (rng() * 2 - 1) * s;
  const cy = Math.cos(yaw + dy), sy = Math.sin(yaw + dy);
  const cp = Math.cos(pitch + dp), sp = Math.sin(pitch + dp);
  return [cy * cp, sy * cp, sp];
}

export function weaponMuzzlePosition(eye, yaw, pitch, weapon = {}) {
  const forwardM = finiteNonNegative(weapon.muzzleForwardM, DEFAULT_WEAPON_MUZZLE_FORWARD_M);
  const dropM = finiteNonNegative(weapon.muzzleDropM, DEFAULT_WEAPON_MUZZLE_DROP_M);
  const cp = Math.cos(pitch);
  return [
    eye[0] + Math.cos(yaw) * cp * forwardM,
    eye[1] + Math.sin(yaw) * cp * forwardM,
    eye[2] + Math.sin(pitch) * forwardM - dropM,
  ];
}

// shooter視点からのヒットスキャン。targetsは判定対象プレイヤー（遅延補償済み座標でも可）。
// target: { id, pos:[x,y,z](足元), crouch, team }
export function hitscan(collider, mv, headCfg, origin, dir, maxDist, targets, shooterId, shooterTeam, targetMode = 'enemy', radiusM = 0) {
  const radius = finiteRadius(radiusM);
  const wallDist = traceWorld(collider, origin, dir, maxDist, radius).dist;
  let best = { type: wallDist === Infinity ? 'none' : 'world', dist: wallDist === Infinity ? maxDist : wallDist, target: null, headshot: false };
  for (const tg of targets) {
    if (tg.id === shooterId) continue;
    const ally = tg.team === shooterTeam;
    if ((targetMode === 'enemy' && ally) || (targetMode === 'ally' && !ally)) continue;
    const h = tg.crouch ? mv.crouchHeightM : mv.standHeightM;
    const eyeZ = tg.pos[2] + (tg.crouch ? mv.eyeCrouchM : mv.eyeStandM);
    // 頭部球と胴体の両方を比較し、レイが先に入った部位だけを採用する。
    const headRadius = headCfg.radiusM + radius;
    const headOffset = [origin[0] - tg.pos[0], origin[1] - tg.pos[1], origin[2] - eyeZ - 0.05];
    const th = radius > 0 && headOffset.reduce((sum, value) => sum + value * value, 0) <= headRadius * headRadius
      ? 0
      : raySphere(origin[0], origin[1], origin[2], dir[0], dir[1], dir[2], tg.pos[0], tg.pos[1], eyeZ + 0.05, headRadius, best.dist);
    const tb = sweepSphereCylinder(
      origin[0], origin[1], origin[2], dir[0], dir[1], dir[2],
      tg.pos[0], tg.pos[1], tg.pos[2], tg.pos[2] + h,
      mv.capsuleRadiusM, radius, best.dist,
    );
    const headFirst = th >= 0 && (tb < 0 || th < tb);
    const targetDist = headFirst ? th : tb;
    if (targetDist >= 0 && targetDist < best.dist) {
      best = { type: 'player', dist: targetDist, target: tg, headshot: headFirst };
    }
  }
  return best;
}

export function traceWorld(collider, origin, dir, maxDist, radiusM = 0) {
  return collider.traceSphere(
    origin[0], origin[1], origin[2], dir[0], dir[1], dir[2],
    maxDist, finiteRadius(radiusM),
  );
}

function finiteRadius(value) {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function damageAtRange(w, dist, headshot) {
  let mult = 1;
  if (dist > w.falloffStartM) {
    const t = Math.min(1, (dist - w.falloffStartM) / (w.falloffEndM - w.falloffStartM));
    mult = 1 - t * (1 - w.falloffMinMult);
  }
  const base = w.damage * mult;
  return headshot ? base * w.headshotMult : base;
}

export function eyePosition(pl, mv) {
  return [pl.move.pos[0], pl.move.pos[1], pl.move.pos[2] + eyeHeight(pl.move, mv)];
}

export { bodyHeight };
