import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { InputManager } from '../client/input.js';
import { Net } from '../client/net.js';

class FakeTarget {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(name, listener) {
    const listeners = this.listeners.get(name) || [];
    listeners.push(listener);
    this.listeners.set(name, listeners);
  }

  dispatch(name, event = {}) {
    for (const listener of this.listeners.get(name) || []) listener(event);
  }
}

test('右クリック・Shift・E・Qを能力入力として送り、非ロック時のTab移動は妨げない', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const fakeDocument = new FakeTarget();
  const fakeWindow = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.requestPointerLock = () => {};
  const scoreboardStates = [];

  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };

  try {
    const input = new InputManager(canvas, { onScoreboard: shown => scoreboardStates.push(shown) });
    input.enabled = true;
    fakeDocument.pointerLockElement = canvas;
    fakeDocument.dispatch('pointerlockchange');
    fakeDocument.dispatch('mousedown', { button: 2, preventDefault() {} });
    fakeDocument.dispatch('keydown', { code: 'ShiftLeft', repeat: false, preventDefault() {} });
    fakeDocument.dispatch('keydown', { code: 'KeyE', repeat: false, preventDefault() {} });
    fakeDocument.dispatch('keydown', { code: 'KeyQ', repeat: false, preventDefault() {} });

    const built = input.buildInput(7, 100, false);
    assert.equal(built.secondary, true);
    assert.equal(built.ability1, true);
    assert.equal(built.ability2, true);
    assert.equal(built.ultimate, true);

    fakeDocument.pointerLockElement = null;
    fakeDocument.dispatch('pointerlockchange');
    let tabPrevented = false;
    fakeDocument.dispatch('keydown', {
      code: 'Tab', repeat: false, preventDefault: () => { tabPrevented = true; },
    });
    assert.equal(tabPrevented, false);
    assert.deepEqual(scoreboardStates, [false]);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('標準Gamepadのスティックと各ボタンを移動・視点・戦闘入力へ統合する', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const fakeDocument = new FakeTarget();
  const fakeWindow = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.requestPointerLock = () => {};
  const buttons = Array.from({ length: 8 }, () => ({ pressed: true, value: 1 }));

  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => [{ connected: true, mapping: 'standard', axes: [0.8, -0.9, 0.5, -0.5], buttons }] },
  });

  try {
    const input = new InputManager(canvas);
    input.enabled = true;
    fakeDocument.pointerLockElement = canvas;
    fakeDocument.dispatch('pointerlockchange');
    const initialYaw = input.yaw;
    const built = input.buildInput(8, 100, true);
    assert.equal(built.f, true);
    assert.equal(built.r, true);
    assert.equal(built.fire, true);
    assert.equal(built.secondary, true);
    assert.equal(built.ability1, true);
    assert.equal(built.ability2, true);
    assert.equal(built.ultimate, true);
    assert.equal(built.jump, true);
    assert.equal(built.crouch, true);
    assert.equal(built.reload, true);
    assert.notEqual(built.yaw, initialYaw);
    assert.ok(built.pitch > 0);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
    else delete globalThis.navigator;
  }
});

test('Pointer Lockを使えない埋め込みブラウザではソフト照準へ自動フォールバックする', async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const fakeDocument = new FakeTarget();
  const fakeWindow = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.focus = () => {};
  canvas.requestPointerLock = () => Promise.reject(new Error('not available'));

  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };

  try {
    const input = new InputManager(canvas);
    input.enabled = true;
    input.requestLock();
    await Promise.resolve();
    await Promise.resolve();

    assert.equal(input.locked, true);
    assert.equal(input.fallbackLocked, true);
    const initialYaw = input.yaw;
    fakeDocument.dispatch('mousemove', { movementX: 20, movementY: -10, target: canvas });
    fakeDocument.dispatch('mousedown', { button: 0, target: canvas });
    fakeDocument.dispatch('keydown', { code: 'ShiftLeft', repeat: false, preventDefault() {} });
    const built = input.buildInput(9, 100, false);
    assert.notEqual(built.yaw, initialYaw);
    assert.equal(built.fire, true);
    assert.equal(built.ability1, true);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('マウス感度は0.1刻みの数値を保存し、安全な範囲へ制限する', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const fakeDocument = new FakeTarget();
  const fakeWindow = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.requestPointerLock = () => {};
  const saved = new Map();
  globalThis.document = fakeDocument;
  globalThis.window = fakeWindow;
  globalThis.localStorage = {
    getItem: key => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };

  try {
    const input = new InputManager(canvas);
    input.setSensValue(37.56);
    assert.equal(input.sensValue, 37.6);
    assert.equal(saved.get('kagariai_sens'), '37.6');
    input.setSensValue(-20);
    assert.equal(input.sensValue, 1);
    input.setSensValue(999);
    assert.equal(input.sensValue, 200);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
  }
});

test('joinとSETUP中のselectにheroIdを含め、サーバーerrorを通知する', () => {
  const originals = {
    location: globalThis.location,
    WebSocket: globalThis.WebSocket,
    setInterval: globalThis.setInterval,
    clearInterval: globalThis.clearInterval,
  };

  class FakeWebSocket {
    static instances = [];

    constructor(url) {
      this.url = url;
      this.readyState = 0;
      this.sent = [];
      FakeWebSocket.instances.push(this);
    }

    send(data) {
      this.sent.push(JSON.parse(data));
    }
  }

  globalThis.location = { protocol: 'http:', host: 'game.example' };
  globalThis.WebSocket = FakeWebSocket;
  globalThis.setInterval = () => 1;
  globalThis.clearInterval = () => {};

  try {
    const net = new Net();
    let rejected = null;
    let selection = null;
    net.onServerError = msg => { rejected = msg; };
    net.onSelectResult = msg => { selection = msg; };
    net.connect('灯匠', 'zairu');
    const ws = FakeWebSocket.instances[0];
    ws.readyState = 1;
    ws.onopen();

    assert.deepEqual(ws.sent[0], { t: 'join', name: '灯匠', heroId: 'zairu' });
    net.sendSelect('koyomi');
    assert.deepEqual(ws.sent.at(-1), { t: 'select', heroId: 'koyomi' });
    net.rttEma = 1000;
    assert.equal(net.interpMs(), 220, 'サーバー許容上限と同じ220msに制限する');

    ws.onmessage({ data: JSON.stringify({ t: 'error', message: 'その篝手は選べません' }) });
    assert.deepEqual(rejected, { t: 'error', message: 'その篝手は選べません' });
    ws.onmessage({ data: JSON.stringify({ t: 'select_result', ok: true, heroId: 'koyomi' }) });
    assert.deepEqual(selection, { t: 'select_result', ok: true, heroId: 'koyomi' });
  } finally {
    globalThis.location = originals.location;
    globalThis.WebSocket = originals.WebSocket;
    globalThis.setInterval = originals.setInterval;
    globalThis.clearInterval = originals.clearInterval;
  }
});

test('キャラクター選択と戦闘HUDの公開DOM・通信契約を備える', () => {
  const html = readFileSync(new URL('../client/index.html', import.meta.url), 'utf8');
  const main = readFileSync(new URL('../client/main.js', import.meta.url), 'utf8');
  const hud = readFileSync(new URL('../client/hud.js', import.meta.url), 'utf8');

  assert.match(html, /<canvas\s+id="gl"[^>]+aria-label=/);
  assert.match(html, /<label[^>]+for="nameInput"/);
  for (const id of [
    'heroRoster', 'heroDetail', 'heroChangeBtn', 'teamPanel', 'heroName', 'heroRole',
    'shieldNum', 'resourceBlock', 'weaponTrait', 'abilitySecondary', 'abilityAbility1',
    'abilityAbility2', 'abilityUltimate', 'sensNumber', 'audioToggle', 'masterVolume',
    'guidancePanel', 'guidanceRolePurpose', 'guidancePhase', 'guidanceInstruction',
    'guidanceChecklist', 'roleRule', 'mapStatus', 'mapCredit', 'cinematicOverlay', 'damageVignette',
    'damageIndicator', 'respawnContext', 'respawnHeroBtn', 'gamepadSensNumber',
    'tacticalPrompt', 'tacticalPromptLabel', 'tacticalPromptText',
    'hudDetailToggle', 'settingsToggle',
  ]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id} が必要`);
  }
  assert.match(html, /id="joinStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(html, /@media\s*\(max-width:\s*600px\)/);
  assert.match(html, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(html, /id="sensNumber"[^>]+type="number"[^>]+min="1"[^>]+max="200"[^>]+step="0\.1"/);
  assert.match(html, /id="gamepadSensNumber"[^>]+type="number"[^>]+min="0\.1"[^>]+max="20"[^>]+step="0\.1"/);
  assert.match(html, /id="respawnHeroBtn"[^>]+type="button"[^>]+hidden/);
  assert.match(html, /id="tacticalPrompt"[^>]+role="status"[^>]+aria-live="polite"[^>]+aria-atomic="true"/);
  assert.equal([...html.matchAll(/class="abilityEffect"/g)].length, 4);
  assert.equal([...html.matchAll(/class="abilityMeta"/g)].length, 4);
  assert.match(html, /id="hudDetailToggle"[^>]+aria-controls="guidancePanel"[^>]+aria-expanded="false"/);
  assert.match(html, /id="settings"[^>]+class="panel"[^>]*>\s*<summary\s+id="settingsToggle"/);
  assert.match(html, /body\.hud-expanded\s+#guidancePanel/);
  assert.match(html, /body\.hud-expanded\s+#hudDetailToggle\s*\{[^}]*top:\s*4px/);
  assert.match(html, /body\.hud-expanded\s+#lockHint\s*\{[^}]*bottom:\s*min\(45dvh,\s*390px\)/);
  assert.match(html, /body:not\(\.hud-expanded\)\s+\.abilityEffect/);

  assert.match(main, /import\s*\{[^}]*HEROES[^}]*DEFAULT_HERO_ID[^}]*\}\s*from\s*['"]\/shared\/data\/heroes\.js['"]/);
  assert.match(main, /buildCombatGuidance/);
  assert.match(main, /CombatAudio/);
  assert.match(main, /from\s*['"]\/shared\/data\/hero_assets\.js['"]/);
  assert.match(main, /createVerifiedObjectUrl/);
  assert.match(main, /assetIntegrity\s*=\s*'verified'/);
  assert.match(main, /getHeroAsset/);
  assert.match(main, /audio\.preloadHero\(hero\.id\)/);
  assert.match(main, /renderer\.preloadHeroAssets\(hero\.id\)/);
  assert.match(main, /heroOptionArt/);
  assert.match(main, /detailHeroArt/);
  assert.match(html, /\.heroOptionArt\s*\{/);
  assert.match(html, /\.detailHeroArt\s*\{/);
  assert.match(main, /net\.connect\(name,\s*selectedHeroId\)/);
  assert.match(main, /net\.sendSelect\(selectedHeroId\)/);
  assert.match(main, /renderer\.setWorldEffects\(/);
  assert.match(main, /renderer\.spawnAbilityCue\(e,\s*myTeam\)/);
  assert.match(main, /resolveDirectionalDamageAngle/);
  assert.match(main, /hud\.damagePulse\(direction\)/);
  assert.match(main, /resolveHeroSelectionContext/);
  assert.match(main, /isHeroRoleSelectable/);
  assert.match(main, /buildAbilityHudModel/);
  assert.match(main, /resolveAbilityAttemptFeedback/);
  assert.match(main, /setGamepadLookSensitivity/);
  assert.match(main, /audio\.handleEvent\(e,\s*\{\s*myId,\s*rttMs:\s*net\.rtt,\s*interpMs:\s*net\.interpMs\(\)\s*\}\)/);
  assert.match(main, /e\.source\s*!==\s*myId\s*&&\s*!e\.projectile/);
  assert.match(main, /event\.code\s*===\s*['"]F1['"]/);
  assert.match(hud, /toggleDetails\(/);
  assert.match(hud, /healing/);
  assert.match(hud, /abilityId/);
  assert.match(hud, /shield/);
  assert.match(hud, /resource/);
});
