// ブラウザ非依存で検証できるクライアント駆動・補間境界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installPerformanceDiagnostics } from '../client/diagnostics.js';
import { FrameDriver } from '../client/frame_driver.js';
import {
  buildAbilityHudModel,
  formatReloadStatus,
  interpolateRemotePlayer,
  resolveDamageIndicatorAngle,
  resolveDirectionalDamageAngle,
  resolveHeroSelectionContext,
  resolveRespawnPenalty,
  isHeroRoleSelectable,
  resolveAbilityAttemptFeedback,
} from '../client/presentation.js';
import { pushBounded } from '../client/bounded_pool.js';

const mainSource = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');

test('performance diagnosticsはimmutable snapshotだけを公開しcleanupできる', () => {
  const target = {};
  const snapshot = Object.freeze({ quality: 'high', frameMs: Object.freeze({ p95: 12 }) });
  const cleanup = installPerformanceDiagnostics(target, () => snapshot);
  const diagnostics = target.__KAGARIAI_DIAGNOSTICS__;

  assert.ok(Object.isFrozen(diagnostics));
  assert.strictEqual(diagnostics.performance(), snapshot);
  assert.deepEqual(Object.keys(diagnostics), ['performance']);
  assert.equal(Object.getOwnPropertyDescriptor(target, '__KAGARIAI_DIAGNOSTICS__').writable, false);

  cleanup();
  assert.equal('__KAGARIAI_DIAGNOSTICS__' in target, false);
});

test('performance diagnosticsは既存globalを上書きせずcleanupでも削除しない', () => {
  const existing = Object.freeze({ performance: () => 'owner' });
  const target = { __KAGARIAI_DIAGNOSTICS__: existing };
  const cleanup = installPerformanceDiagnostics(target, () => Object.freeze({ quality: 'low' }));

  assert.strictEqual(target.__KAGARIAI_DIAGNOSTICS__, existing);
  cleanup();
  assert.strictEqual(target.__KAGARIAI_DIAGNOSTICS__, existing);
});

test('mainはperformance diagnosticsを登録し、非BFCache終了時にcleanupする', () => {
  assert.match(mainSource, /installPerformanceDiagnostics\(\s*globalThis,\s*\(\)\s*=>\s*renderer\.getPerformanceSnapshot\(\)/);
  assert.match(mainSource, /window\.addEventListener\('pagehide',\s*disposeClient\)/);
  assert.match(mainSource, /if\s*\(event\?\.persisted\s*\|\|\s*clientDisposed\)\s*return/);
  assert.match(mainSource, /removePerformanceDiagnostics\(\)/);
});

test('render telemetry records raw frame stalls while simulation catch-up stays bounded', () => {
  assert.match(mainSource, /const rawDt = Math\.max\(0, \(now - lastFrame\) \/ 1000\)/);
  assert.match(mainSource, /const dt = Math\.min\(0\.1, rawDt\)/);
  assert.match(mainSource, /renderer\.update\(rawDt\)/);
});

test('表示→非表示でRAFを止めてintervalを開始し、復帰時にRAFへ戻す', () => {
  let visibilityListener;
  const document = {
    visibilityState: 'visible',
    addEventListener: (_name, fn) => { visibilityListener = fn; },
    removeEventListener: () => {},
  };
  const rafCalls = [], cancelledRaf = [], intervals = [], clearedIntervals = [];
  const driver = new FrameDriver({
    document,
    onFrame: () => {},
    requestAnimationFrame: fn => { rafCalls.push(fn); return rafCalls.length; },
    cancelAnimationFrame: id => cancelledRaf.push(id),
    setInterval: fn => { intervals.push(fn); return intervals.length; },
    clearInterval: id => clearedIntervals.push(id),
  });

  driver.start();
  assert.equal(rafCalls.length, 1);
  document.visibilityState = 'hidden';
  visibilityListener();
  assert.deepEqual(cancelledRaf, [1]);
  assert.equal(intervals.length, 1);

  document.visibilityState = 'visible';
  visibilityListener();
  assert.deepEqual(clearedIntervals, [1]);
  assert.equal(rafCalls.length, 2);
  driver.stop();
});

test('リスポーン等の5m超テレポートは補間せず新位置へ即スナップする', () => {
  const prev = { pos: [40, 0, 4], yaw: 0, alive: false };
  const current = { pos: [-40, 0, 4], yaw: Math.PI, alive: true };
  const shown = interpolateRemotePlayer(prev, current, 0.25, 5);
  assert.deepEqual(shown.pos, current.pos);
  assert.equal(shown.yaw, current.yaw);
});

test('通常移動は従来どおりスナップショット間を線形補間する', () => {
  const prev = { pos: [0, 0, 0], yaw: 0, alive: true };
  const current = { pos: [2, 4, 0], yaw: 1, alive: true };
  const shown = interpolateRemotePlayer(prev, current, 0.25, 5);
  assert.deepEqual(shown.pos, [0.5, 1, 0]);
  assert.equal(shown.yaw, 0.25);
});

test('remote character presentation preserves animation-driving snapshot state', () => {
  const previous = {
    pos: [0, 0, 0], vel: [0, 0, 0], yaw: 0, pitch: 0, alive: true,
    grounded: true, crouch: false, reloading: false, cast: null,
  };
  const current = {
    pos: [2, 0, 0], vel: [4, 2, -1], yaw: 0.4, pitch: 0.2, alive: true,
    grounded: false, crouch: true, reloading: true, cast: { abilityId: 'test-cast' },
  };

  const shown = interpolateRemotePlayer(previous, current, 0.25, 5);

  assert.deepEqual(shown.vel, [1, 0.5, -0.25]);
  assert.equal(shown.pitch, 0.05);
  assert.equal(shown.grounded, false);
  assert.equal(shown.crouch, true);
  assert.equal(shown.reloading, true);
  assert.deepEqual(shown.cast, current.cast);
});

test('途中参加時もサーバースナップショットの復帰補正値を表示する', () => {
  const objective = { ot: { grace: 3, cap: 5 }, suddenDeath: false, respawnPenaltySec: 6, otPenaltyStartT: 100 };
  assert.equal(resolveRespawnPenalty(objective, null, 140, -1), 6);
});

test('被弾方向は視点正面を0、右側を時計回りの正角として返す', () => {
  assert.equal(resolveDirectionalDamageAngle([10, 0, 0], [0, 0, 0], 0), 0);
  assert.ok(Math.abs(resolveDirectionalDamageAngle([0, -10, 0], [0, 0, 0], 0) - Math.PI / 2) < 1e-12);
});

test('被弾方向は±π境界を跨いでも最短角へ正規化する', () => {
  const sourceBearing = Math.PI - 0.1;
  const source = [Math.cos(sourceBearing) * 10, Math.sin(sourceBearing) * 10, 0];
  assert.ok(Math.abs(resolveDirectionalDamageAngle(source, [0, 0, 0], -Math.PI + 0.1) - 0.2) < 1e-12);
});

test('攻撃元が不明または同位置なら方向なしとしてvignetteへfallbackできる', () => {
  assert.equal(resolveDirectionalDamageAngle(undefined, [0, 0, 0], 0), null);
  assert.equal(resolveDirectionalDamageAngle([1, 1, 0], [1, 1, 0], 0), null);
});

test('被弾表示はeventのauthoritative damageOriginを現在のsource位置より優先する', () => {
  const event = { damageOrigin: [0, -10, 0], damageDirection: [1, 0, 0] };
  const angle = resolveDamageIndicatorAngle(event, [0, 0, 0], 0, [10, 0, 0]);
  assert.ok(Math.abs(angle - Math.PI / 2) < 1e-12);
});

test('damageOriginがなければtargetからoriginを向くdamageDirection、最後にlegacy sourceへfallbackする', () => {
  assert.ok(Math.abs(resolveDamageIndicatorAngle(
    { damageDirection: [0, -1, 0] },
    [0, 0, 0],
    0,
    [10, 0, 0],
  ) - Math.PI / 2) < 1e-12);
  assert.equal(resolveDamageIndicatorAngle({}, [0, 0, 0], 0, [10, 0, 0]), 0);
  assert.equal(resolveDamageIndicatorAngle({}, [0, 0, 0], 0, undefined), null);
});

test('hero選択はSETUP中とACTIVEの死亡中だけ再度開ける', () => {
  assert.equal(resolveHeroSelectionContext(true, 'SETUP', true), 'setup');
  assert.equal(resolveHeroSelectionContext(true, 'ACTIVE', false), 'respawn');
  assert.equal(resolveHeroSelectionContext(true, 'ACTIVE', true), null);
  assert.equal(resolveHeroSelectionContext(true, 'ROUND_END', false), null);
  assert.equal(resolveHeroSelectionContext(false, 'SETUP', true), null);
});

test('hero選択可能期間はロールを越えた全heroを候補にできる', () => {
  assert.equal(isHeroRoleSelectable('respawn', 'damage', 'damage', 2, 2), true);
  assert.equal(isHeroRoleSelectable('respawn', 'support', 'damage', 2, 2), true);
  assert.equal(isHeroRoleSelectable('setup', 'support', 'damage', 1, 2), true);
  assert.equal(isHeroRoleSelectable('setup', 'support', 'damage', 2, 2), true);
  assert.equal(isHeroRoleSelectable('join', 'frontline', null, 1, 1), true);
  assert.equal(isHeroRoleSelectable(null, 'frontline', null, 0, 0), false);
});

test('reload表示は残り秒と進捗を示し、旧snapshotでは従来文言へfallbackする', () => {
  assert.equal(formatReloadStatus(true, 1.24, 0.49), 'リロード 1.2秒（49%）');
  assert.equal(formatReloadStatus(true, undefined, undefined), 'リロード中…');
  assert.equal(formatReloadStatus(false, 1, 0.5), '');
});

test('戦術HUDは能力の入力・効果・射程・CTと使用可否を一つの公開モデルで説明する', () => {
  const definition = {
    name: '投錨', behavior: 'anchor_launch', rangeM: 28, cooldownSec: 11, resourceCost: 35,
  };
  const ready = buildAbilityHudModel(definition, {}, {
    input: 'Shift / LB', effect: '錨を投げ、着地点を制圧する',
    alive: true, matchState: 'ACTIVE', resource: { name: '鎖長', value: 45, max: 100 },
  });
  assert.deepEqual({
    input: ready.input,
    name: ready.name,
    effect: ready.effect,
    rangeText: ready.rangeText,
    cooldownText: ready.cooldownText,
    state: ready.state,
    stateText: ready.stateText,
    blocked: ready.blocked,
  }, {
    input: 'Shift / LB',
    name: '投錨',
    effect: '錨を投げ、着地点を制圧する',
    rangeText: '射程 28m',
    cooldownText: 'CT 11秒',
    state: 'ready',
    stateText: '使用可',
    blocked: false,
  });

  const coolingDown = buildAbilityHudModel(definition, { cooldownRemaining: 4.24 }, {
    input: 'Shift / LB', effect: '錨を投げ、着地点を制圧する',
    alive: true, matchState: 'ACTIVE', resource: { name: '鎖長', value: 45, max: 100 },
  });
  assert.equal(coolingDown.state, 'cooldown');
  assert.equal(coolingDown.stateText, '使用不可：CT 4.2秒');
  assert.equal(coolingDown.blocked, true);
  assert.deepEqual(resolveAbilityAttemptFeedback(coolingDown), {
    tone: 'blocked',
    text: 'Shift / LB 投錨：クールダウン残り4.2秒。CT終了まで待ち、再入力',
  });
});

test('snapshotが理由を持つ場合だけ対象・射程・遮蔽の失敗を即時行動へ変換する', () => {
  const definition = { name: '影縫い', rangeM: 24, cooldownSec: 9 };
  const context = {
    input: 'E / RB', effect: '単体の敵へ弱体効果を付与する', alive: true, matchState: 'ACTIVE',
  };
  const expected = [
    ['no_target', '対象が照準内にいない', '対象を照準に入れて再入力'],
    ['out_of_range', '対象が射程外', '24m以内へ移動して再入力'],
    ['line_of_sight', '対象への射線が遮られている', '射線が通る位置へ移動して再入力'],
  ];
  for (const [state, reason, action] of expected) {
    const model = buildAbilityHudModel(definition, { state }, context);
    assert.equal(model.blocked, true);
    assert.equal(model.blockedReason, reason);
    assert.equal(model.immediateAction, action);
    assert.match(resolveAbilityAttemptFeedback(model).text, new RegExp(`${reason}。${action}$`));
  }

  const genericallyBlocked = buildAbilityHudModel(definition, { state: 'blocked' }, context);
  assert.equal(genericallyBlocked.blockedReason, '現在は使用できない');
  assert.equal(genericallyBlocked.immediateAction, '状態が解除されてから再入力');

  const unspecified = buildAbilityHudModel(definition, { state: 'future_state' }, context);
  assert.equal(unspecified.blockedReason, '');
  assert.equal(resolveAbilityAttemptFeedback(unspecified), null);
});

test('死亡・必殺ゲージ・固有資源も色だけに頼らない使用不可理由になる', () => {
  const baseContext = { input: 'Q / Y', effect: '円環状の障壁で範囲を封鎖する', matchState: 'ACTIVE' };
  const ultimate = { name: '大錨「繋留環」', ultCost: 100, rangeM: 20 };
  const charging = buildAbilityHudModel(ultimate, {}, { ...baseContext, alive: true, ultGauge: 64 });
  assert.equal(charging.state, 'blocked');
  assert.equal(charging.stateText, '使用不可：必殺 64% / 100%');
  assert.equal(charging.cooldownText, 'CT 必殺ゲージ100%');
  assert.match(resolveAbilityAttemptFeedback(charging).text, /必殺ゲージが36%不足。100%までためてから再入力$/);

  const resourceAbility = { name: '鋳造壁', resourceCost: 35, cooldownSec: 12 };
  const resourceBlocked = buildAbilityHudModel(resourceAbility, {}, {
    input: 'Shift / LB', effect: '耐久値を持つ障壁を設置する', alive: true,
    matchState: 'ACTIVE', resource: { name: '鋳金', value: 20, max: 100 },
  });
  assert.equal(resourceBlocked.stateText, '使用不可：鋳金 20 / 35');
  assert.match(resolveAbilityAttemptFeedback(resourceBlocked).text, /鋳金が15不足。35まで補充して再入力$/);

  const dead = buildAbilityHudModel(resourceAbility, {}, {
    input: 'Shift / LB', effect: '耐久値を持つ障壁を設置する', alive: false,
    matchState: 'ACTIVE', resource: { name: '鋳金', value: 100, max: 100 },
  });
  assert.equal(dead.stateText, '使用不可：復帰待ち');
  assert.match(resolveAbilityAttemptFeedback(dead).text, /復帰待ち。復帰してから再入力$/);
});

test('トレーサーは上限を超えると古いものから破棄する', () => {
  const items = [];
  const disposed = [];
  for (let i = 0; i < 5; i++) pushBounded(items, i, 3, item => disposed.push(item));
  assert.deepEqual(items, [2, 3, 4]);
  assert.deepEqual(disposed, [0, 1]);
});
