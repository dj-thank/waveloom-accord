// 入力管理: キーボード / マウス視点（Pointer Lock＋埋め込み用fallback）/ Gamepad
// yaw=0 が +x、反時計回り正（PROTOCOL.md 座標系）。pitch は上向き正 ±1.55rad。

const SENS_KEY = 'kagariai_sens';
const GAMEPAD_SENS_KEY = 'kagariai_gamepad_look_sens';
const SENS_MIN = 1;
const SENS_MAX = 200;
const PITCH_LIMIT = 1.55;
const GAMEPAD_DEADZONE = 0.2;
const DEFAULT_INPUT_DT = 1 / 63;
const DEFAULT_GAMEPAD_LOOK_SENSITIVITY = 0.045 / DEFAULT_INPUT_DT;
const GAMEPAD_LOOK_SENSITIVITY_MIN = 0.1;
const GAMEPAD_LOOK_SENSITIVITY_MAX = 20;
const ACTION_LATCH_BITS = Object.freeze({
  jump: 1 << 0,
  fire: 1 << 1,
  secondary: 1 << 2,
  ability1: 1 << 3,
  ability2: 1 << 4,
  ultimate: 1 << 5,
});
const KEY_ACTION_BY_CODE = Object.freeze({
  Space: 'jump',
  ShiftLeft: 'ability1',
  ShiftRight: 'ability1',
  KeyE: 'ability2',
  KeyQ: 'ultimate',
});

export class InputManager {
  constructor(canvas, callbacks = {}) {
    this.canvas = canvas;
    this.cb = callbacks; // { onScoreboard(shown), onLockChange(locked), onCaptureChange(captured) }
    this.locked = false;
    this.fallbackLocked = false;
    this.gamepadCaptured = false;
    this._enabled = false; // join完了後に有効化
    this.uiBlocked = false;

    this.yaw = Math.PI; // 東スポーンの初期向きに合わせておく（スポーンで上書きされる）
    this.pitch = 0;

    this.keys = new Set();       // e.code の集合
    this.fireHeld = false;
    this.secondaryHeld = false;
    this.scoreboardHeld = false;
    this.gamepadScoreboardHeld = false;
    this.gamepadStartHeld = false;
    this.gamepadStartNeedsRelease = false;
    this.gamepadReloadHeld = false;
    this.gamepadReloadNeedsRelease = false;
    this.reloadPending = false;
    this.pendingActionBits = 0;
    this.pointerLockRequestId = 0;
    this.pointerLockAttempt = null;

    // 感度: UI値(1.0〜200.0) × 0.0001 = rad/px
    const saved = Number(localStorage.getItem(SENS_KEY));
    this.sensValue = Number.isFinite(saved) && saved >= SENS_MIN && saved <= SENS_MAX ? saved : 25;
    const savedGamepad = localStorage.getItem(GAMEPAD_SENS_KEY);
    const savedGamepadNumber = savedGamepad === null ? Number.NaN : Number(savedGamepad);
    this.gamepadLookSensitivity = Number.isFinite(savedGamepadNumber)
      && savedGamepadNumber >= GAMEPAD_LOOK_SENSITIVITY_MIN
      && savedGamepadNumber <= GAMEPAD_LOOK_SENSITIVITY_MAX
      ? savedGamepadNumber
      : DEFAULT_GAMEPAD_LOOK_SENSITIVITY;
    if (callbacks.gamepadLookSensitivity !== undefined) {
      this.setGamepadLookSensitivity(callbacks.gamepadLookSensitivity);
    }

    this._bind();
  }

  get sensitivity() { return this.sensValue * 0.0001; }

  get captured() { return this.locked || this.gamepadCaptured; }

  get enabled() { return this._enabled; }

  set enabled(next) { this.setEnabled(next); }

  setEnabled(next) {
    this._enabled = !!next;
    if (!this._enabled) this.releaseLock();
  }

  setUiBlocked(next) {
    const blocked = !!next;
    if (this.uiBlocked === blocked) return;
    this.uiBlocked = blocked;
    if (blocked) this.releaseLock();
  }

  setSensValue(v) {
    const numeric = Number(v);
    const safe = Number.isFinite(numeric) ? numeric : this.sensValue;
    this.sensValue = Math.round(Math.max(SENS_MIN, Math.min(SENS_MAX, safe)) * 10) / 10;
    localStorage.setItem(SENS_KEY, String(this.sensValue));
  }

  setGamepadLookSensitivity(v) {
    const numeric = Number(v);
    if (!Number.isFinite(numeric)) return;
    this.gamepadLookSensitivity = Math.round(Math.max(
      GAMEPAD_LOOK_SENSITIVITY_MIN,
      Math.min(GAMEPAD_LOOK_SENSITIVITY_MAX, numeric),
    ) * 10) / 10;
    localStorage.setItem(GAMEPAD_SENS_KEY, String(this.gamepadLookSensitivity));
  }

  setView(yaw, pitch) {
    this.yaw = yaw;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));
  }

  requestLock() {
    if (!this._canRequestLock() || this.locked) return;
    this.canvas.focus?.({ preventScroll: true });
    if (typeof this.canvas.requestPointerLock !== 'function') {
      this._enableFallbackLock();
      return;
    }
    const requestId = ++this.pointerLockRequestId;
    this.pointerLockAttempt = { requestId, stage: 'raw', awaitsPromise: false };
    try {
      const pending = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (typeof pending?.catch === 'function') {
        this.pointerLockAttempt.awaitsPromise = true;
        pending.catch(() => this._handlePointerLockFailure(requestId, 'raw'));
      }
    } catch {
      this._handlePointerLockFailure(requestId, 'raw');
    }
  }

  _requestStandardLock(requestId) {
    if (!this._canRequestLock() || this.pointerLockAttempt?.requestId !== requestId) return;
    this.pointerLockAttempt = { requestId, stage: 'standard', awaitsPromise: false };
    try {
      const pending = this.canvas.requestPointerLock();
      if (typeof pending?.catch === 'function') {
        this.pointerLockAttempt.awaitsPromise = true;
        pending.catch(() => this._handlePointerLockFailure(requestId, 'standard'));
      }
    } catch {
      this._handlePointerLockFailure(requestId, 'standard');
    }
  }

  _handlePointerLockFailure(requestId, stage) {
    const attempt = this.pointerLockAttempt;
    if (!attempt || attempt.requestId !== requestId || attempt.stage !== stage) return;
    if (stage === 'raw') {
      this._requestStandardLock(requestId);
      return;
    }
    this.pointerLockAttempt = null;
    this._enableFallbackLock();
  }

  releaseLock() {
    this.pointerLockRequestId++;
    this.pointerLockAttempt = null;
    this.fallbackLocked = false;
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
    this._setLocked(false);
    this._setGamepadCaptured(false);
    this.gamepadStartNeedsRelease = true;
  }

  _enableFallbackLock() {
    if (!this._canRequestLock() || document.pointerLockElement === this.canvas) return;
    this.fallbackLocked = true;
    this._setLocked(true);
  }

  _setLocked(next) {
    const wasCaptured = this.captured;
    const changed = this.locked !== next;
    this.locked = next;
    if (!next) {
      this._clearActions();
      this.gamepadStartNeedsRelease = true;
    }
    if (changed) this.cb.onLockChange?.(next);
    if (wasCaptured !== this.captured) this.cb.onCaptureChange?.(this.captured);
  }

  _setGamepadCaptured(next) {
    const value = !!next;
    if (this.gamepadCaptured === value) return;
    const wasCaptured = this.captured;
    this.gamepadCaptured = value;
    if (!value) {
      this._clearActions();
      this.gamepadStartNeedsRelease = true;
    }
    if (wasCaptured !== this.captured) this.cb.onCaptureChange?.(this.captured);
  }

  _clearActions() {
    this.keys.clear();
    this.fireHeld = false;
    this.secondaryHeld = false;
    this.scoreboardHeld = false;
    this.gamepadScoreboardHeld = false;
    this.gamepadReloadHeld = false;
    this.gamepadReloadNeedsRelease = true;
    this.reloadPending = false;
    this.pendingActionBits = 0;
    this.cb.onScoreboard?.(false);
  }

  _keyboardActionHeld(action) {
    if (action === 'jump') return this.keys.has('Space');
    if (action === 'ability1') return this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    if (action === 'ability2') return this.keys.has('KeyE');
    if (action === 'ultimate') return this.keys.has('KeyQ');
    return false;
  }

  _latchAction(action) {
    this.pendingActionBits |= ACTION_LATCH_BITS[action] || 0;
  }

  _setScoreboardHeld(source, next) {
    const before = this.scoreboardHeld || this.gamepadScoreboardHeld;
    if (source === 'gamepad') this.gamepadScoreboardHeld = !!next;
    else this.scoreboardHeld = !!next;
    const after = this.scoreboardHeld || this.gamepadScoreboardHeld;
    if (before !== after) this.cb.onScoreboard?.(after);
  }

  _isGameplayActive() {
    return this._canRequestLock() && this.captured;
  }

  _isPointerGameplayActive() {
    return this._canRequestLock() && this.locked;
  }

  _canRequestLock() {
    return this.enabled && !this.uiBlocked && document.visibilityState !== 'hidden';
  }

  _bind() {
    this.canvas.addEventListener('click', () => this.requestLock());

    document.addEventListener('pointerlockchange', () => {
      const nativeLocked = document.pointerLockElement === this.canvas;
      const nativeLockLost = !nativeLocked && this.locked && !this.fallbackLocked;
      if (nativeLocked) {
        this.pointerLockAttempt = null;
        this.fallbackLocked = false;
      }
      if (nativeLockLost && this.gamepadCaptured) this._setGamepadCaptured(false);
      this._setLocked(nativeLocked || this.fallbackLocked);
    });
    document.addEventListener('pointerlockerror', () => {
      const attempt = this.pointerLockAttempt;
      if (attempt && !attempt.awaitsPromise) {
        this._handlePointerLockFailure(attempt.requestId, attempt.stage);
      }
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.releaseLock();
    });

    document.addEventListener('mousemove', (e) => {
      if (!this._isPointerGameplayActive()) return;
      if (this.fallbackLocked && e.target !== this.canvas) return;
      const movementX = Number.isFinite(e.movementX) ? e.movementX : 0;
      const movementY = Number.isFinite(e.movementY) ? e.movementY : 0;
      this.yaw -= movementX * this.sensitivity;          // マウス右 = 右旋回（yaw減少）
      this.pitch -= movementY * this.sensitivity;        // マウス下 = 見下ろし
      // yawを[-π, π]近傍に正規化（数値の暴走防止）
      if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) {
        this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
      }
      this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch));
    });

    document.addEventListener('mousedown', (e) => {
      if (!this._isPointerGameplayActive()) return;
      if (this.fallbackLocked && e.target !== this.canvas) return;
      if (e.button === 0) {
        if (!this.fireHeld) this._latchAction('fire');
        this.fireHeld = true;
      }
      if (e.button === 2) {
        if (!this.secondaryHeld) this._latchAction('secondary');
        this.secondaryHeld = true;
        e.preventDefault();
      }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.fireHeld = false;
      if (e.button === 2) this.secondaryHeld = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => {
      if (this.locked) e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.gamepadCaptured && !this.locked) {
        this.releaseLock();
        return;
      }
      if (!this._isPointerGameplayActive()) return;
      if (e.code === 'Escape' && this.fallbackLocked) {
        this.releaseLock();
        return;
      }
      if (e.code === 'Tab' && this.locked) {
        e.preventDefault();
        this._setScoreboardHeld('keyboard', true);
        return;
      }
      if (e.code === 'KeyR' && !e.repeat) this.reloadPending = true;
      if (e.code === 'ControlLeft' || e.code === 'ControlRight' || e.code === 'Space') e.preventDefault();
      const action = KEY_ACTION_BY_CODE[e.code];
      if (action && !e.repeat && !this._keyboardActionHeld(action)) this._latchAction(action);
      this.keys.add(e.code);
    });
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Tab' && this.scoreboardHeld) {
        e.preventDefault();
        this._setScoreboardHeld('keyboard', false);
      }
      this.keys.delete(e.code);
    });
    window.addEventListener('blur', () => {
      this.releaseLock();
    });
  }

  // 固定tick用の入力を構築（PROTOCOL.md input.d）
  buildInput(seq, interpMs, _allowReload, dt = DEFAULT_INPUT_DT) {
    const inputDt = Number.isFinite(dt) && dt >= 0 ? Math.min(dt, 0.25) : DEFAULT_INPUT_DT;
    const gamepad = this._readGamepad();
    this._updateGamepadCapture(gamepad);
    if (!this._isGameplayActive()) {
      return this._neutralInput(seq, interpMs);
    }
    const k = this.keys;
    const keyboardActive = this._isPointerGameplayActive();
    const pad = this._pollGamepad(inputDt, gamepad);
    let moveX = (keyboardActive && k.has('KeyD') ? 1 : 0)
      - (keyboardActive && k.has('KeyA') ? 1 : 0) + pad.moveX;
    let moveY = (keyboardActive && k.has('KeyW') ? 1 : 0)
      - (keyboardActive && k.has('KeyS') ? 1 : 0) + pad.moveY;
    const moveMagnitude = Math.hypot(moveX, moveY);
    if (moveMagnitude > 1) {
      moveX /= moveMagnitude;
      moveY /= moveMagnitude;
    }
    // Serverが弾数とreload可否を権威判定する。直前の射撃より古いsnapshotで
    // edgeを捨てると、正当なreload要求が永久に失われる。
    const reload = this.reloadPending;
    this.reloadPending = false;
    const pendingActions = this.pendingActionBits;
    this.pendingActionBits = 0;
    return {
      f: (keyboardActive && k.has('KeyW')) || pad.f,
      b: (keyboardActive && k.has('KeyS')) || pad.b,
      l: (keyboardActive && k.has('KeyA')) || pad.l,
      r: (keyboardActive && k.has('KeyD')) || pad.r,
      moveX,
      moveY,
      jump: (keyboardActive && k.has('Space')) || pad.jump || !!(pendingActions & ACTION_LATCH_BITS.jump),
      crouch: (keyboardActive && (k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC'))) || pad.crouch,
      fire: (keyboardActive && this.fireHeld) || pad.fire || !!(pendingActions & ACTION_LATCH_BITS.fire),
      secondary: (keyboardActive && this.secondaryHeld) || pad.secondary || !!(pendingActions & ACTION_LATCH_BITS.secondary),
      ability1: (keyboardActive && (k.has('ShiftLeft') || k.has('ShiftRight'))) || pad.ability1
        || !!(pendingActions & ACTION_LATCH_BITS.ability1),
      ability2: (keyboardActive && k.has('KeyE')) || pad.ability2
        || !!(pendingActions & ACTION_LATCH_BITS.ability2),
      ultimate: (keyboardActive && k.has('KeyQ')) || pad.ultimate
        || !!(pendingActions & ACTION_LATCH_BITS.ultimate),
      reload,
      yaw: this.yaw,
      pitch: this.pitch,
      seq,
      interpMs,
    };
  }

  _neutralInput(seq, interpMs) {
    return {
      f: false, b: false, l: false, r: false,
      moveX: 0, moveY: 0,
      jump: false, crouch: false,
      fire: false, secondary: false,
      ability1: false, ability2: false, ultimate: false,
      reload: false,
      yaw: this.yaw,
      pitch: this.pitch,
      seq,
      interpMs,
    };
  }

  _readGamepad() {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return null;
    let gamepads;
    try { gamepads = navigator.getGamepads(); } catch { return null; }
    const pad = Array.from(gamepads || []).find(item => item && item.connected !== false);
    if (!pad) return null;
    return {
      axis(index) {
        const value = Number(pad.axes?.[index]) || 0;
        const magnitude = Math.abs(value);
        if (magnitude <= GAMEPAD_DEADZONE) return 0;
        return Math.sign(value) * (magnitude - GAMEPAD_DEADZONE) / (1 - GAMEPAD_DEADZONE);
      },
      pressed(index) {
        const button = pad.buttons?.[index];
        return !!button && (button.pressed || Number(button.value) > 0.35);
      },
    };
  }

  _updateGamepadCapture(gamepad) {
    const startPressed = !!gamepad?.pressed(9); // Menu / Start
    if (!gamepad && this.gamepadCaptured) this._setGamepadCaptured(false);
    if (!this._canRequestLock()) {
      this.gamepadStartHeld = startPressed;
      return;
    }
    if (this.gamepadStartNeedsRelease) {
      if (!startPressed) {
        this.gamepadStartNeedsRelease = false;
        this.gamepadStartHeld = false;
      } else {
        this.gamepadStartHeld = true;
      }
      return;
    }
    if (startPressed && !this.gamepadStartHeld && !this.captured) {
      this.canvas.focus?.({ preventScroll: true });
      this._setGamepadCaptured(true);
    }
    this.gamepadStartHeld = startPressed;
  }

  _pollGamepad(dt, gamepad) {
    const none = {
      moveX: 0, moveY: 0,
      f: false, b: false, l: false, r: false, jump: false, crouch: false,
      fire: false, secondary: false, ability1: false, ability2: false, ultimate: false,
    };
    if (!gamepad) {
      this.gamepadReloadHeld = false;
      this._setScoreboardHeld('gamepad', false);
      return none;
    }
    const { axis, pressed } = gamepad;
    this._setScoreboardHeld('gamepad', pressed(8)); // View / Back

    const lookX = axis(2);
    const lookY = axis(3);
    this.yaw -= lookX * this.gamepadLookSensitivity * dt;
    this.pitch = Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, this.pitch - lookY * this.gamepadLookSensitivity * dt));
    if (this.yaw > Math.PI * 2 || this.yaw < -Math.PI * 2) {
      this.yaw = Math.atan2(Math.sin(this.yaw), Math.cos(this.yaw));
    }

    const reloadPressed = pressed(2); // X
    if (this.gamepadReloadNeedsRelease) {
      if (!reloadPressed) this.gamepadReloadNeedsRelease = false;
    } else if (reloadPressed && !this.gamepadReloadHeld) {
      this.reloadPending = true;
    }
    this.gamepadReloadHeld = reloadPressed;
    const moveX = axis(0);
    const moveY = axis(1);
    return {
      moveX,
      moveY: -moveY,
      f: moveY < 0,
      b: moveY > 0,
      l: moveX < 0,
      r: moveX > 0,
      jump: pressed(0),       // A
      crouch: pressed(1),     // B
      ultimate: pressed(3),   // Y
      ability1: pressed(4),   // LB
      ability2: pressed(5),   // RB
      secondary: pressed(6),  // LT
      fire: pressed(7),       // RT
    };
  }
}
