import { test } from 'node:test';
import assert from 'node:assert/strict';
import { InputManager } from '../client/input.js';

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

function installBrowserEnvironment(gamepads = [], storage = new Map()) {
  const originals = {
    document: globalThis.document,
    window: globalThis.window,
    localStorage: globalThis.localStorage,
    navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'),
  };
  const document = new FakeTarget();
  document.visibilityState = 'visible';
  const window = new FakeTarget();
  const canvas = new FakeTarget();
  canvas.focus = () => {};
  canvas.requestPointerLock = () => {};
  globalThis.document = document;
  globalThis.window = window;
  globalThis.localStorage = {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, value),
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => gamepads },
  });
  return {
    document,
    window,
    canvas,
    storage,
    restore() {
      globalThis.document = originals.document;
      globalThis.window = originals.window;
      globalThis.localStorage = originals.localStorage;
      if (originals.navigator) Object.defineProperty(globalThis, 'navigator', originals.navigator);
      else delete globalThis.navigator;
    },
  };
}

function standardPad({ axes = [0, 0, 0, 0], pressed = [] } = {}) {
  return {
    connected: true,
    mapping: 'standard',
    axes,
    buttons: Array.from({ length: 10 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: pressed.includes(index) ? 1 : 0,
    })),
  };
}

function touch(identifier, clientX, clientY) {
  return { identifier, clientX, clientY };
}

function assertNeutralActions(built) {
  assert.deepEqual({
    f: built.f, b: built.b, l: built.l, r: built.r,
    moveX: built.moveX, moveY: built.moveY,
    jump: built.jump, crouch: built.crouch,
    fire: built.fire, secondary: built.secondary,
    ability1: built.ability1, ability2: built.ability2, ultimate: built.ultimate,
    reload: built.reload,
  }, {
    f: false, b: false, l: false, r: false,
    moveX: 0, moveY: 0,
    jump: false, crouch: false,
    fire: false, secondary: false,
    ability1: false, ability2: false, ultimate: false,
    reload: false,
  });
}

test('pointer lock外では全デバイスのゲーム入力を中立化する', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [0.8, -0.9, 0.6, -0.5], pressed: [0, 2, 4, 5, 6, 7] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.enabled = true;
    env.document.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });
    env.document.dispatch('keydown', { code: 'ShiftLeft', repeat: false, preventDefault() {} });
    env.document.dispatch('mousedown', { button: 0, target: env.canvas });

    const built = input.buildInput(1, 100, true, 1 / 63);

    assertNeutralActions(built);
  } finally {
    env.restore();
  }
});

test('documentがhiddenの間は保持中の入力とgamepad視点を中立化する', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [0.8, -0.9, 0.6, -0.5], pressed: [2, 7] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.enabled = true;
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.document.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
    const yawBefore = input.yaw;

    env.document.visibilityState = 'hidden';
    env.document.dispatch('visibilitychange');
    const built = input.buildInput(2, 100, true, 1 / 63);

    assertNeutralActions(built);
    assert.equal(built.yaw, yawBefore);
  } finally {
    env.restore();
  }
});

test('window blur後はnative pointer lockが残ってもgamepadを中立化する', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [0.8, -0.9, 0.6, -0.5], pressed: [4, 7] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.enabled = true;
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.window.dispatch('blur');

    const built = input.buildInput(3, 100, true, 1 / 63);

    assertNeutralActions(built);
  } finally {
    env.restore();
  }
});

test('UI blocking中はlockを解除し、解除後も自動でlockし直さない', () => {
  const env = installBrowserEnvironment();
  let lockRequests = 0;
  env.canvas.requestPointerLock = () => { lockRequests++; };
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    input.setUiBlocked(true);
    input.requestLock();
    assert.equal(input.locked, false);
    assert.equal(lockRequests, 0);

    input.setUiBlocked(false);
    assert.equal(input.locked, false);
    assert.equal(lockRequests, 0);
  } finally {
    env.restore();
  }
});

test('raw pointer lock非対応時は通常のnative lockへfallbackする', async () => {
  const env = installBrowserEnvironment();
  const requests = [];
  env.canvas.requestPointerLock = (...args) => {
    requests.push(args);
    if (args.length > 0) return Promise.reject(Object.assign(new Error('raw unsupported'), { name: 'NotSupportedError' }));
    return Promise.resolve();
  };
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);

    input.requestLock();
    await Promise.resolve();
    await Promise.resolve();

    assert.deepEqual(requests, [[{ unadjustedMovement: true }], []]);
    assert.equal(input.fallbackLocked, false);
  } finally {
    env.restore();
  }
});

test('要求中でないpointerlockerrorはsoft lockを自動開始しない', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);

    env.document.dispatch('pointerlockerror');

    assert.equal(input.locked, false);
    assert.equal(input.fallbackLocked, false);
  } finally {
    env.restore();
  }
});

test('left stickはdeadzone後の連続値を右正・前正でmoveXとmoveYへ保持する', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [0.6, -0.6, 0, 0] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    const built = input.buildInput(4, 100, false, 1 / 63);

    assert.ok(Math.abs(built.moveX - 0.5) < 1e-12);
    assert.ok(Math.abs(built.moveY - 0.5) < 1e-12);
    assert.equal(built.r, true);
    assert.equal(built.f, true);
  } finally {
    env.restore();
  }
});

test('keyboardの斜め移動はmoveXとmoveYを単位長へ正規化する', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.document.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
    env.document.dispatch('keydown', { code: 'KeyD', repeat: false, preventDefault() {} });

    const built = input.buildInput(5, 100, false, 1 / 63);

    assert.ok(Math.abs(built.moveX - Math.SQRT1_2) < 1e-12);
    assert.ok(Math.abs(built.moveY - Math.SQRT1_2) < 1e-12);
    assert.equal(built.f, true);
    assert.equal(built.r, true);
  } finally {
    env.restore();
  }
});

test('タッチ操作はPointer Lockなしでも移動・照準・射撃を入力パケットへ反映する', () => {
  const env = installBrowserEnvironment();
  env.canvas.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1000, height: 600 });
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    const movementStart = touch(1, 140, 500);
    const movementEnd = touch(1, 220, 420);
    const lookStart = touch(2, 760, 280);
    const lookEnd = touch(2, 820, 240);
    env.canvas.dispatch('touchstart', {
      changedTouches: [movementStart], touches: [movementStart], preventDefault() {},
    });
    env.canvas.dispatch('touchmove', {
      changedTouches: [movementEnd], touches: [movementEnd], preventDefault() {},
    });
    env.canvas.dispatch('touchstart', {
      changedTouches: [lookStart], touches: [movementEnd, lookStart], preventDefault() {},
    });
    env.canvas.dispatch('touchmove', {
      changedTouches: [lookEnd], touches: [movementEnd, lookEnd], preventDefault() {},
    });

    const moving = input.buildInput(61, 100, false, 1 / 63);
    assert.ok(moving.moveX > 0.25);
    assert.ok(moving.moveY > 0.25);
    assert.ok(moving.yaw < Math.PI);
    assert.ok(moving.pitch > 0);

    env.document.dispatch('touchstart', {
      target: { dataset: { touchAction: 'fire' } },
      changedTouches: [touch(3, 900, 480)],
      touches: [movementEnd, lookEnd, touch(3, 900, 480)],
      preventDefault() {},
    });
    assert.equal(input.buildInput(62, 100, false, 1 / 63).fire, true);

    env.document.dispatch('touchend', {
      target: { dataset: { touchAction: 'fire' } }, changedTouches: [touch(3, 900, 480)],
      touches: [movementEnd, lookEnd], preventDefault() {},
    });
    env.canvas.dispatch('touchend', {
      changedTouches: [movementEnd, lookEnd], touches: [], preventDefault() {},
    });
    assertNeutralActions(input.buildInput(63, 100, false, 1 / 63));
  } finally {
    env.restore();
  }
});

test('disabledへ切り替えると保持中の全入力を破棄してlockも解除する', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [1, -1, 1, 1], pressed: [2, 4, 7] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.document.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });

    input.setEnabled(false);
    const built = input.buildInput(6, 100, true, 1 / 63);

    assert.equal(input.locked, false);
    assertNeutralActions(built);
  } finally {
    env.restore();
  }
});

test('keyboard reloadは押下edgeごとに1 packetだけtrueになる', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });
    const heldPackets = [
      input.buildInput(5, 100, true, 1 / 63).reload,
      input.buildInput(6, 100, true, 1 / 63).reload,
      input.buildInput(7, 100, true, 1 / 63).reload,
    ];
    env.document.dispatch('keyup', { code: 'KeyR' });
    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });
    const pressedAgain = input.buildInput(8, 100, true, 1 / 63).reload;

    assert.deepEqual(heldPackets, [true, false, false]);
    assert.equal(pressedAgain, true);
  } finally {
    env.restore();
  }
});

test('gamepad reloadをlock解除中も保持した場合は再押下までedgeを再発火しない', () => {
  const pad = standardPad();
  const env = installBrowserEnvironment([pad]);
  const setReload = pressed => {
    pad.buttons[2] = { pressed, value: pressed ? 1 : 0 };
  };
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    input.buildInput(9, 100, true, 1 / 63);

    setReload(true);
    assert.equal(input.buildInput(10, 100, true, 1 / 63).reload, true);
    assert.equal(input.buildInput(11, 100, true, 1 / 63).reload, false);

    env.document.pointerLockElement = null;
    env.document.dispatch('pointerlockchange');
    input.buildInput(12, 100, true, 1 / 63);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    assert.equal(input.buildInput(13, 100, true, 1 / 63).reload, false);

    setReload(false);
    assert.equal(input.buildInput(14, 100, true, 1 / 63).reload, false);
    setReload(true);
    assert.equal(input.buildInput(15, 100, true, 1 / 63).reload, true);
  } finally {
    env.restore();
  }
});

test('gamepad lookは設定したrad毎秒とdtで積分される', () => {
  const env = installBrowserEnvironment([
    standardPad({ axes: [0, 0, 1, -0.5] }),
  ]);
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    input.setGamepadLookSensitivity(3);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    input.setView(0, 0);
    input.buildInput(16, 100, false, 0.1);
    const oneStep = { yaw: input.yaw, pitch: input.pitch };

    input.setView(0, 0);
    for (let i = 0; i < 4; i++) input.buildInput(17 + i, 100, false, 0.025);
    const fourSteps = { yaw: input.yaw, pitch: input.pitch };

    assert.ok(Math.abs(oneStep.yaw + 0.3) < 1e-12);
    assert.ok(Math.abs(oneStep.pitch - 0.1125) < 1e-12);
    assert.ok(Math.abs(fourSteps.yaw - oneStep.yaw) < 1e-12);
    assert.ok(Math.abs(fourSteps.pitch - oneStep.pitch) < 1e-12);
  } finally {
    env.restore();
  }
});

test('Startの押下edgeでpointer lockなしのgamepad専用captureを開始する', () => {
  const pad = standardPad({ axes: [0, -1, 0, 0], pressed: [7] });
  const env = installBrowserEnvironment([pad]);
  const captureStates = [];
  try {
    const input = new InputManager(env.canvas, { onCaptureChange: captured => captureStates.push(captured) });
    input.setEnabled(true);
    assertNeutralActions(input.buildInput(30, 100, false, 1 / 63));

    pad.buttons[9] = { pressed: true, value: 1 };
    const captured = input.buildInput(31, 100, false, 1 / 63);
    assert.equal(input.gamepadCaptured, true);
    assert.equal(input.captured, true);
    assert.equal(input.locked, false);
    assert.equal(captured.f, true);
    assert.equal(captured.fire, true);
    assert.deepEqual(captureStates, [true]);

    pad.axes = [0, 0, 0, 0];
    pad.buttons[7] = { pressed: false, value: 0 };
    const yawBefore = input.yaw;
    env.document.dispatch('mousemove', { movementX: 50, movementY: 0, target: env.canvas });
    env.document.dispatch('mousedown', { button: 0, target: env.canvas });
    env.document.dispatch('keydown', { code: 'KeyW', repeat: false, preventDefault() {} });
    const gamepadOnly = input.buildInput(32, 100, false, 1 / 63);
    assert.equal(gamepadOnly.f, false);
    assert.equal(gamepadOnly.fire, false);
    assert.equal(gamepadOnly.yaw, yawBefore);
  } finally {
    env.restore();
  }
});

test('capture解除後にStartを保持していてもreleaseして再押下するまでrecaptureしない', () => {
  const pad = standardPad({ pressed: [9] });
  const env = installBrowserEnvironment([pad]);
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    input.buildInput(33, 100, false, 1 / 63);
    assert.equal(input.gamepadCaptured, true);

    input.setUiBlocked(true);
    input.setUiBlocked(false);
    input.buildInput(34, 100, false, 1 / 63);
    assert.equal(input.gamepadCaptured, false);

    pad.buttons[9] = { pressed: false, value: 0 };
    input.buildInput(35, 100, false, 1 / 63);
    pad.buttons[9] = { pressed: true, value: 1 };
    input.buildInput(36, 100, false, 1 / 63);
    assert.equal(input.gamepadCaptured, true);
  } finally {
    env.restore();
  }
});

test('View/Backはscoreboardをedge更新し、Tabとの同時保持中は片方のreleaseで閉じない', () => {
  const pad = standardPad();
  const env = installBrowserEnvironment([pad]);
  const scoreboardStates = [];
  try {
    const input = new InputManager(env.canvas, { onScoreboard: shown => scoreboardStates.push(shown) });
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.document.dispatch('keydown', { code: 'Tab', repeat: false, preventDefault() {} });

    pad.buttons[8] = { pressed: true, value: 1 };
    input.buildInput(37, 100, false, 1 / 63);
    input.buildInput(38, 100, false, 1 / 63);
    env.document.dispatch('keyup', { code: 'Tab', preventDefault() {} });
    assert.deepEqual(scoreboardStates, [true]);

    pad.buttons[8] = { pressed: false, value: 0 };
    input.buildInput(39, 100, false, 1 / 63);
    assert.deepEqual(scoreboardStates, [true, false]);
  } finally {
    env.restore();
  }
});

test('gamepad視点感度はmouse感度と別keyから復元・数値保存・範囲制限する', () => {
  const storage = new Map([
    ['kagariai_sens', '42.5'],
    ['kagariai_gamepad_look_sens', '4.2'],
  ]);
  const env = installBrowserEnvironment([], storage);
  try {
    const input = new InputManager(env.canvas);
    assert.equal(input.sensValue, 42.5);
    assert.equal(input.gamepadLookSensitivity, 4.2);

    input.setGamepadLookSensitivity(5.26);
    assert.equal(input.gamepadLookSensitivity, 5.3);
    assert.equal(storage.get('kagariai_gamepad_look_sens'), '5.3');
    assert.equal(storage.get('kagariai_sens'), '42.5');
    input.setGamepadLookSensitivity(99);
    assert.equal(input.gamepadLookSensitivity, 20);
    input.setGamepadLookSensitivity(Number.NaN);
    assert.equal(input.gamepadLookSensitivity, 20);
  } finally {
    env.restore();
  }
});

test('reload edgeは発砲直後の古い満弾snapshotでも次のcommandへ一度だけ送る', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });
    const staleFullSnapshot = input.buildInput(40, 100, false, 1 / 63).reload;
    const followingCommand = input.buildInput(41, 100, true, 1 / 63).reload;

    assert.equal(staleFullSnapshot, true);
    assert.equal(followingCommand, false);
  } finally {
    env.restore();
  }
});

test('UI blockは未送信reload edgeを破棄し、解除後へ持ち越さない', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    env.document.dispatch('keydown', { code: 'KeyR', repeat: false, preventDefault() {} });

    input.setUiBlocked(true);
    assertNeutralActions(input.buildInput(42, 100, true, 1 / 63));

    input.setUiBlocked(false);
    env.document.dispatch('pointerlockchange');
    assert.equal(input.buildInput(43, 100, true, 1 / 63).reload, false);
  } finally {
    env.restore();
  }
});

test('native pointer unlockは重複中のgamepad captureとRT入力も即座に解除する', () => {
  const pad = standardPad();
  const env = installBrowserEnvironment([pad]);
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);

    pad.buttons[9] = { pressed: true, value: 1 };
    input.buildInput(44, 100, false, 1 / 63);
    assert.equal(input.gamepadCaptured, true);

    env.canvas.dispatch('click');
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');
    assert.equal(input.locked, true);
    assert.equal(input.gamepadCaptured, true);

    pad.buttons[7] = { pressed: true, value: 1 };
    env.document.pointerLockElement = null;
    env.document.dispatch('pointerlockchange');

    assert.equal(input.locked, false);
    assert.equal(input.gamepadCaptured, false);
    assert.equal(input.captured, false);
    assertNeutralActions(input.buildInput(45, 100, false, 1 / 63));
  } finally {
    env.restore();
  }
});

test('buildInput間の短いaction press-releaseは次の1 packetへlatchedされる', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    for (const code of ['Space', 'ShiftLeft', 'KeyE', 'KeyQ']) {
      env.document.dispatch('keydown', { code, repeat: false, preventDefault() {} });
      env.document.dispatch('keyup', { code });
    }
    for (const button of [0, 2]) {
      env.document.dispatch('mousedown', { button, target: env.canvas, preventDefault() {} });
      env.document.dispatch('mouseup', { button });
    }

    const latched = input.buildInput(46, 100, false, 1 / 63);
    assert.deepEqual({
      fire: latched.fire,
      jump: latched.jump,
      secondary: latched.secondary,
      ability1: latched.ability1,
      ability2: latched.ability2,
      ultimate: latched.ultimate,
    }, {
      fire: true,
      jump: true,
      secondary: true,
      ability1: true,
      ability2: true,
      ultimate: true,
    });
    assertNeutralActions(input.buildInput(47, 100, false, 1 / 63));
  } finally {
    env.restore();
  }
});

test('held actionは毎packet維持し、release後の再押下edgeも再びlatchedされる', () => {
  const env = installBrowserEnvironment();
  try {
    const input = new InputManager(env.canvas);
    input.setEnabled(true);
    env.document.pointerLockElement = env.canvas;
    env.document.dispatch('pointerlockchange');

    env.document.dispatch('mousedown', { button: 0, target: env.canvas });
    env.document.dispatch('keydown', { code: 'ShiftLeft', repeat: false, preventDefault() {} });
    for (const seq of [48, 49]) {
      const held = input.buildInput(seq, 100, false, 1 / 63);
      assert.equal(held.fire, true);
      assert.equal(held.ability1, true);
    }
    env.document.dispatch('mouseup', { button: 0 });
    env.document.dispatch('keyup', { code: 'ShiftLeft' });
    assertNeutralActions(input.buildInput(50, 100, false, 1 / 63));

    env.document.dispatch('mousedown', { button: 0, target: env.canvas });
    env.document.dispatch('mouseup', { button: 0 });
    assert.equal(input.buildInput(51, 100, false, 1 / 63).fire, true);
    assert.equal(input.buildInput(52, 100, false, 1 / 63).fire, false);
  } finally {
    env.restore();
  }
});

test('pointer unlock・UI block・hiddenは未送信action latchを破棄する', () => {
  for (const release of ['pointer', 'ui', 'hidden']) {
    const env = installBrowserEnvironment();
    try {
      const input = new InputManager(env.canvas);
      input.setEnabled(true);
      env.document.pointerLockElement = env.canvas;
      env.document.dispatch('pointerlockchange');

      for (const code of ['Space', 'ShiftLeft', 'KeyE', 'KeyQ']) {
        env.document.dispatch('keydown', { code, repeat: false, preventDefault() {} });
        env.document.dispatch('keyup', { code });
      }
      for (const button of [0, 2]) {
        env.document.dispatch('mousedown', { button, target: env.canvas, preventDefault() {} });
        env.document.dispatch('mouseup', { button });
      }

      if (release === 'pointer') {
        env.document.pointerLockElement = null;
        env.document.dispatch('pointerlockchange');
      } else if (release === 'ui') {
        input.setUiBlocked(true);
        input.setUiBlocked(false);
      } else {
        env.document.visibilityState = 'hidden';
        env.document.dispatch('visibilitychange');
        env.document.visibilityState = 'visible';
      }

      env.document.pointerLockElement = env.canvas;
      env.document.dispatch('pointerlockchange');
      assertNeutralActions(input.buildInput(53, 100, false, 1 / 63));
    } finally {
      env.restore();
    }
  }
});
