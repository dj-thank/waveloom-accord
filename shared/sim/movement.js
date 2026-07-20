// 一人称移動（サーバー権威。クライアント予測でも同一コードを使用）。
// 決定論: 固定dt・純粋算術のみ。入力→状態遷移は step() に閉じる。

export function makeMoveState(pos, yaw) {
  return {
    pos: [pos[0], pos[1], pos[2]],
    vel: [0, 0, 0],
    yaw: yaw || 0,
    pitch: 0,
    crouch: false,
    grounded: false,
  };
}

// input: { f,b,l,r,jump,crouch: bool, moveX?,moveY?: number, yaw,pitch: rad }
export function step(st, input, dt, collider, mv) {
  st.yaw = input.yaw;
  st.pitch = Math.max(-1.55, Math.min(1.55, input.pitch));
  const r = mv.capsuleRadiusM;
  if (input.crouch) {
    st.crouch = true;
  } else if (
    st.crouch
    && !collider.overlapsCylinder(st.pos[0], st.pos[1], st.pos[2], r, mv.standHeightM)
  ) {
    st.crouch = false;
  }
  const height = st.crouch ? mv.crouchHeightM : mv.standHeightM;

  // 希望方向（yaw=0で+xが前、ローカルmoveXは右+、moveYは前+）。
  // moveX/moveY は入力層でデッドゾーン適用済み。どちらも未指定なら従来boolへ戻す。
  let localRight = 0, localForward = 0;
  const hasAnalogMove = Number.isFinite(input.moveX) || Number.isFinite(input.moveY);
  if (hasAnalogMove) {
    localRight = Number.isFinite(input.moveX) ? input.moveX : 0;
    localForward = Number.isFinite(input.moveY) ? input.moveY : 0;
  } else {
    if (input.f) localForward += 1;
    if (input.b) localForward -= 1;
    if (input.l) localRight -= 1;
    if (input.r) localRight += 1;
  }
  const localLength = Math.hypot(localRight, localForward);
  const moveMagnitude = Math.min(1, localLength);
  if (localLength > 1) {
    localRight /= localLength;
    localForward /= localLength;
  }

  const cos = Math.cos(st.yaw), sin = Math.sin(st.yaw);
  let wx = localForward * cos + localRight * sin;
  let wy = localForward * sin - localRight * cos;
  const wlen = Math.hypot(wx, wy);
  if (wlen > 1e-6) { wx /= wlen; wy /= wlen; }

  const targetSpeed = mv.baseSpeedMps * (st.crouch ? mv.crouchSpeedMult : 1) * moveMagnitude;
  const accel = st.grounded ? mv.accelMps2 : mv.accelMps2 * mv.airControlMult;

  // 加速（希望方向へ）と摩擦（接地・無入力時）
  if (wlen > 1e-6) {
    st.vel[0] += wx * accel * dt;
    st.vel[1] += wy * accel * dt;
    const hs = Math.hypot(st.vel[0], st.vel[1]);
    if (hs > targetSpeed) {
      st.vel[0] *= targetSpeed / hs;
      st.vel[1] *= targetSpeed / hs;
    }
  } else if (st.grounded) {
    const hs = Math.hypot(st.vel[0], st.vel[1]);
    const drop = mv.frictionMps2 * dt;
    const ns = Math.max(0, hs - drop);
    if (hs > 1e-6) { st.vel[0] *= ns / hs; st.vel[1] *= ns / hs; }
    else { st.vel[0] = 0; st.vel[1] = 0; }
  }

  // ジャンプ・重力
  if (input.jump && st.grounded) {
    st.vel[2] = mv.jumpVelMps;
    st.grounded = false;
  }
  if (!st.grounded) st.vel[2] -= mv.gravityMps2 * dt;

  // 水平移動（軸ごとに押し出し）。低い段差(top<=feet+step)は壁とみなさない
  const feet = st.pos[2];
  const zLo = feet + (st.grounded ? mv.stepUpM : 0);
  const zHi = feet + height;
  const horizontalStart = [st.pos[0], st.pos[1]];
  const horizontalDelta = [st.vel[0] * dt, st.vel[1] * dt];
  let motion = collider.moveCylinder(
    horizontalStart[0], horizontalStart[1], r, zLo, zHi,
    horizontalDelta[0], horizontalDelta[1],
  );
  st.pos[0] = motion.position[0];
  st.pos[1] = motion.position[1];
  if (dt > 1e-9) {
    st.vel[0] = motion.clippedDelta[0] / dt;
    st.vel[1] = motion.clippedDelta[1] / dt;
  }

  // 垂直
  let newZ = st.pos[2] + st.vel[2] * dt;
  if (st.grounded) {
    // 接地の維持と段差スナップ。旧設定との互換値は0.3m。
    const stepDownM = Number.isFinite(mv.stepDownM)
      ? Math.max(0, mv.stepDownM)
      : 0.3;
    let g = collider.groundHeight(st.pos[0], st.pos[1], st.pos[2], r, mv.stepUpM);
    if (
      g > st.pos[2] + 1e-9
      && collider.overlapsCylinder(st.pos[0], st.pos[1], g, r, height)
    ) {
      // 段差上の姿勢が塞がる場合、段差を通常の壁として水平移動を安全にやり直す。
      motion = collider.moveCylinder(
        horizontalStart[0], horizontalStart[1], r, feet, feet + height,
        horizontalDelta[0], horizontalDelta[1],
      );
      st.pos[0] = motion.position[0];
      st.pos[1] = motion.position[1];
      if (dt > 1e-9) {
        st.vel[0] = motion.clippedDelta[0] / dt;
        st.vel[1] = motion.clippedDelta[1] / dt;
      }
      g = collider.groundHeight(st.pos[0], st.pos[1], st.pos[2], r, mv.stepUpM);
    }
    if (g > -Infinity && g >= st.pos[2] - stepDownM) {
      st.pos[2] = g;
      st.vel[2] = 0;
    } else {
      st.grounded = false;
    }
  }
  if (!st.grounded) {
    if (st.vel[2] <= 0) {
      // 落下: 通過した床に着地
      const g = collider.groundHeight(st.pos[0], st.pos[1], st.pos[2], r, 0.01);
      if (g > -Infinity && newZ <= g) {
        st.pos[2] = g;
        st.vel[2] = 0;
        st.grounded = true;
      } else {
        st.pos[2] = newZ;
      }
    } else {
      const vertical = collider.sweepVerticalCylinder(
        st.pos[0], st.pos[1], r, st.pos[2], height, newZ - st.pos[2],
      );
      st.pos[2] = vertical.z;
      if (vertical.hit) st.vel[2] = 0;
    }
  }

}

export function eyeHeight(st, mv) {
  return st.crouch ? mv.eyeCrouchM : mv.eyeStandM;
}

export function bodyHeight(st, mv) {
  return st.crouch ? mv.crouchHeightM : mv.standHeightM;
}
