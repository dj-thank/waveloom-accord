function lerp(a, b, t) { return a + (b - a) * t; }

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function interpolateRemotePlayer(previous, current, alpha, teleportThresholdM = 5) {
  const q = previous || current;
  const distance = Math.hypot(
    current.pos[0] - q.pos[0],
    current.pos[1] - q.pos[1],
    current.pos[2] - q.pos[2],
  );
  const t = distance > teleportThresholdM || q.alive !== current.alive ? 1 : alpha;
  const qVel = Array.isArray(q.vel) ? q.vel : (Array.isArray(current.vel) ? current.vel : [0, 0, 0]);
  const currentVel = Array.isArray(current.vel) ? current.vel : qVel;
  const qPitch = Number.isFinite(q.pitch) ? q.pitch : (Number.isFinite(current.pitch) ? current.pitch : 0);
  const currentPitch = Number.isFinite(current.pitch) ? current.pitch : qPitch;
  return {
    pos: [
      lerp(q.pos[0], current.pos[0], t),
      lerp(q.pos[1], current.pos[1], t),
      lerp(q.pos[2], current.pos[2], t),
    ],
    yaw: lerpAngle(q.yaw, current.yaw, t),
    vel: [
      lerp(qVel[0] || 0, currentVel[0] || 0, t),
      lerp(qVel[1] || 0, currentVel[1] || 0, t),
      lerp(qVel[2] || 0, currentVel[2] || 0, t),
    ],
    pitch: lerpAngle(qPitch, currentPitch, t),
    grounded: current.grounded !== false,
    crouch: !!current.crouch,
    reloading: !!current.reloading,
    reloadProgress: Number(current.reloadProgress) || 0,
    cast: current.cast || null,
    alive: current.alive !== false,
  };
}

export function resolveRespawnPenalty(objective, mode, objectiveTime, localStartT) {
  if (!objective.ot && !objective.suddenDeath) return 0;
  if (Number.isFinite(objective.respawnPenaltySec)) return objective.respawnPenaltySec;
  if (!mode) return 0;
  const serverStart = Number.isFinite(objective.otPenaltyStartT) ? objective.otPenaltyStartT : -1;
  const start = serverStart >= 0 ? serverStart : localStartT;
  if (start < 0) return 0;
  const late = (objectiveTime - start) > mode.overtime.respawnPenaltyLateAfterSec;
  return mode.overtime.respawnPenaltySec[late ? 1 : 0];
}

// CSSの時計回りを正として、視点正面から見た攻撃元の相対角を返す。
export function resolveDirectionalDamageAngle(sourcePos, playerPos, playerYaw) {
  if (!sourcePos || !playerPos || !Number.isFinite(playerYaw)) return null;
  const dx = Number(sourcePos[0]) - Number(playerPos[0]);
  const dy = Number(sourcePos[1]) - Number(playerPos[1]);
  return resolveWorldDirectionAngle(dx, dy, playerYaw);
}

// damageDirection は被弾targetから実際のdamage originを向くworld-space vector。
// authoritative情報がない旧server eventだけ、現在のsource snapshot位置へfallbackする。
export function resolveDamageIndicatorAngle(event, playerPos, playerYaw, legacySourcePos) {
  const originAngle = resolveDirectionalDamageAngle(event?.damageOrigin, playerPos, playerYaw);
  if (originAngle !== null) return originAngle;

  const direction = event?.damageDirection;
  const directionAngle = resolveWorldDirectionAngle(
    Number(direction?.[0]),
    Number(direction?.[1]),
    playerYaw,
  );
  if (directionAngle !== null) return directionAngle;
  return resolveDirectionalDamageAngle(legacySourcePos, playerPos, playerYaw);
}

function resolveWorldDirectionAngle(dx, dy, playerYaw) {
  if (!Number.isFinite(playerYaw) || !Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 1e-6) return null;
  const relative = playerYaw - Math.atan2(dy, dx);
  return Math.atan2(Math.sin(relative), Math.cos(relative));
}

export function resolveHeroSelectionContext(joined, matchState, alive) {
  if (!joined) return null;
  if (matchState === 'SETUP') return 'setup';
  if (matchState === 'ACTIVE' && alive === false) return 'respawn';
  return null;
}

export function isHeroRoleSelectable(context, candidateRole, currentRole, roleCount = 0, roleLimit = 0) {
  if (context === 'respawn') return !!currentRole && candidateRole === currentRole;
  if (context === 'setup') {
    return candidateRole === currentRole || Number(roleCount) < Number(roleLimit);
  }
  return context === 'join';
}

export function formatReloadStatus(reloading, remainingSec, progress) {
  if (!reloading) return '';
  const hasRemaining = Number.isFinite(remainingSec) && remainingSec >= 0;
  const hasProgress = Number.isFinite(progress);
  if (!hasRemaining && !hasProgress) return 'リロード中…';
  const remaining = hasRemaining ? ` ${remainingSec.toFixed(1)}秒` : '';
  const percent = hasProgress
    ? `（${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%）`
    : '';
  return `リロード${remaining}${percent}`;
}

function formatHudNumber(value) {
  const numeric = Math.max(0, Number(value) || 0);
  return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1);
}

function reportedAbilityFailure(reportedState, range) {
  if (reportedState === 'no_target' || reportedState === 'target_required') {
    return ['対象が照準内にいない', '対象を照準に入れて再入力'];
  }
  if (reportedState === 'out_of_range') {
    return ['対象が射程外', range > 0 ? `${formatHudNumber(range)}m以内へ移動して再入力` : '射程内へ移動して再入力'];
  }
  if (reportedState === 'line_of_sight' || reportedState === 'occluded') {
    return ['対象への射線が遮られている', '射線が通る位置へ移動して再入力'];
  }
  if (reportedState === 'blocked') {
    return ['現在は使用できない', '状態が解除されてから再入力'];
  }
  return null;
}

function resolveAbilityHudState({
  alive, matchState, reportedState, reportedFailure,
  cooldownRemaining, castRemaining, activeRemaining,
  ultCost, ultGauge, resourceKnown, resourceCost, resourceValue, resourceName,
}) {
  if (alive === false) {
    return { state: 'blocked', stateText: '使用不可：復帰待ち', blockedReason: '復帰待ち', immediateAction: '復帰してから再入力' };
  }
  if (matchState && matchState !== 'ACTIVE' && matchState !== 'SETUP') {
    return { state: 'blocked', stateText: '使用不可：戦闘停止中', blockedReason: '戦闘停止中', immediateAction: '次の開戦を待つ' };
  }
  if (castRemaining > 0 || reportedState === 'windup' || reportedState === 'casting' || reportedState === 'cast') {
    return { state: 'casting', stateText: `発動中 ${castRemaining.toFixed(1)}秒`, blockedReason: '発動処理中', immediateAction: '発動完了を待つ' };
  }
  if (activeRemaining > 0 || reportedState === 'active') {
    return { state: 'active', stateText: `効果中 ${activeRemaining.toFixed(1)}秒`, blockedReason: '効果発動中', immediateAction: '効果終了後に再入力' };
  }
  if (cooldownRemaining > 0 || reportedState === 'cooldown' || reportedState === 'cd') {
    return {
      state: 'cooldown',
      stateText: `使用不可：CT ${cooldownRemaining.toFixed(1)}秒`,
      blockedReason: `クールダウン残り${cooldownRemaining.toFixed(1)}秒`,
      immediateAction: 'CT終了まで待ち、再入力',
    };
  }
  if (reportedFailure) {
    return { state: 'blocked', stateText: `使用不可：${reportedFailure[0]}`, blockedReason: reportedFailure[0], immediateAction: reportedFailure[1] };
  }
  if (ultCost > 0 && ultGauge < ultCost) {
    const missing = Math.max(0, ultCost - ultGauge);
    return {
      state: 'blocked',
      stateText: `使用不可：必殺 ${formatHudNumber(ultGauge)}% / ${formatHudNumber(ultCost)}%`,
      blockedReason: `必殺ゲージが${formatHudNumber(missing)}%不足`,
      immediateAction: `${formatHudNumber(ultCost)}%までためてから再入力`,
    };
  }
  if (resourceKnown && resourceCost > resourceValue) {
    const missing = resourceCost - resourceValue;
    return {
      state: 'blocked',
      stateText: `使用不可：${resourceName} ${formatHudNumber(resourceValue)} / ${formatHudNumber(resourceCost)}`,
      blockedReason: `${resourceName}が${formatHudNumber(missing)}不足`,
      immediateAction: `${formatHudNumber(resourceCost)}まで補充して再入力`,
    };
  }
  if (reportedState === 'locked' || reportedState === 'disabled') {
    return { state: 'blocked', stateText: '使用不可：状態ロック', blockedReason: '現在は使用できない', immediateAction: '状態解除後に再入力' };
  }
  return { state: 'ready', stateText: '使用可', blockedReason: '', immediateAction: '' };
}

export function buildAbilityHudModel(definition = {}, current = {}, context = {}) {
  const cooldownRemaining = Math.max(0, Number(current.cooldownRemaining) || 0);
  const cooldownTotal = Math.max(0, Number(definition.cooldownSec) || 0);
  const castRemaining = Math.max(0, Number(current.castRemaining) || 0);
  const activeRemaining = Math.max(0, Number(current.activeRemaining) || 0);
  const range = Math.max(0, Number(definition.rangeM) || 0);
  const radius = Math.max(0, Number(definition.radiusM) || 0);
  const resourceCost = Math.max(0, Number(definition.resourceCost) || 0);
  const resourceValue = Math.max(0, Number(context.resource?.value) || 0);
  const resourceKnown = context.resource && Number.isFinite(Number(context.resource.value));
  const resourceName = context.resource?.name || '固有資源';
  const ultCost = Math.max(0, Number(definition.ultCost) || 0);
  const ultGauge = Math.max(0, Number(context.ultGauge) || 0);
  const reportedState = String(current.state || '').toLowerCase();
  const reportedFailure = reportedAbilityFailure(reportedState, range);
  const availability = resolveAbilityHudState({
    alive: context.alive,
    matchState: context.matchState,
    reportedState,
    reportedFailure,
    cooldownRemaining,
    castRemaining,
    activeRemaining,
    ultCost,
    ultGauge,
    resourceKnown,
    resourceCost,
    resourceValue,
    resourceName,
  });
  return {
    input: context.input || '入力未設定',
    name: definition.name || current.name || '能力',
    effect: context.effect || definition.description || '効果説明なし',
    rangeText: range > 0 ? `射程 ${formatHudNumber(range)}m`
      : radius > 0 ? `範囲 半径${formatHudNumber(radius)}m` : '射程 —',
    cooldownText: cooldownTotal > 0 ? `CT ${formatHudNumber(cooldownTotal)}秒`
      : ultCost > 0 ? `CT 必殺ゲージ${formatHudNumber(ultCost)}%` : 'CT なし',
    ...availability,
    blocked: availability.state !== 'ready',
    cooldownRemaining,
    cooldownTotal,
    castRemaining,
    castTotal: Math.max(0, Number(definition.castSec) || 0),
    activeRemaining,
    activeTotal: Math.max(0, Number(definition.durationSec) || 0),
  };
}

export function resolveAbilityAttemptFeedback(ability) {
  if (!ability?.blocked || !ability.blockedReason) return null;
  return {
    tone: 'blocked',
    text: `${ability.input} ${ability.name}：${ability.blockedReason}。${ability.immediateAction}`,
  };
}
