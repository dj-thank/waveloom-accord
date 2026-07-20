// 潮占（しおうら）目標ルールエンジン。
// 数値の唯一の正: docs/mode_shioura_rules_v0.2_FROZEN.md（§3〜§8）
// 状態: 封灯 → 中立 → 争奪中 → 確保 → 進行 → 延長
// 甕（スコア）は0.1%刻みの整数（0〜1000）で管理する（§8）。

export class ShiouraObjective {
  constructor(cfg) {
    this.cfg = cfg; // mode_shioura.json の capture/progress/overtime
    this.resetRound();
  }

  resetRound() {
    this.sealed = true;
    this.owner = -1;                 // -1=中立, 0/1=占有チーム
    this.gauge = [0, 0];             // 争奪ゲージ 0〜100pt
    this.absentSec = [0, 0];         // 各チームの有効関与が途切れてからの秒数
    this.pot = [0, 0];               // 甕。0.1%刻み整数 0〜1000
    this.potFrac = [0, 0];           // 端数アキュムレータ
    this.virtPot = [0, 0];           // 仮想甕（§7到達判定用。矛盾修正v0.2.1）
    this.virtFrac = [0, 0];
    this.time = 0;                   // ラウンド開放からの経過秒
    this.ot = { active: false, grace: 0, cap: 0, elapsed: 0 };
    this.otPenaltyStartT = -1;       // 延長/サドンデスの復帰補正の起点（ラウンド時刻）
    this.suddenDeath = false;
    this.roundWinner = -1;
    this.logicalState = 'sealed';
    this.lastPresence = [0, 0];
  }

  unseal(events = []) {
    if (!this.sealed) return;
    this.sealed = false;
    this.transitionTo('neutral', this.lastPresence, events);
  }

  hasFullPot() {
    return this.pot[0] >= 1000 || this.pot[1] >= 1000;
  }

  // 480秒上限到達時の解決（§4/§8）。match側から呼ぶ。
  resolveByCap(events = []) {
    if (this.roundWinner >= 0) return;
    if (this.pot[0] !== this.pot[1]) {
      this.win(this.pot[0] > this.pot[1] ? 0 : 1, 'time_cap', events);
    } else if (this.pot[0] >= 1000) {
      // 双方100%: §7の「確保＋敵の有効関与0を先に満たした陣が勝つ」を継続。
      // 追加タイマーは設けない（復帰補正で自然収束）。
      if (this.otPenaltyStartT < 0) this.otPenaltyStartT = this.time;
    } else {
      this.suddenDeath = true;
      if (this.otPenaltyStartT < 0) this.otPenaltyStartT = this.time;
      this.transitionTo('sudden_death', this.lastPresence, events);
    }
  }

  // 延長/サドンデス中のリスポーン補正（§7）。+3秒、開始30秒後から+6秒。
  respawnPenaltySec() {
    if (!this.ot.active && !this.suddenDeath) return 0;
    if (this.otPenaltyStartT < 0) return 0;
    const p = this.cfg.overtime.respawnPenaltySec;
    return (this.time - this.otPenaltyStartT) >= this.cfg.overtime.respawnPenaltyLateAfterSec ? p[1] : p[0];
  }

  rate(count) {
    const r = this.cfg.capture.ratePtPerSecByCount;
    if (count >= 3) return r['3'];
    if (count === 2) return r['2'];
    return r['1'];
  }

  // presence: [チーム0の有効関与人数, チーム1の...]（§5の判定はsim側で実施）
  tick(dt, presence, events) {
    if (this.sealed || this.roundWinner >= 0) return;
    this.time += dt;
    const cap = this.cfg.capture;
    const p = [presence[0] | 0, presence[1] | 0];
    this.lastPresence = p;

    // 不在タイマー（減衰用）
    for (let t = 0; t < 2; t++) {
      if (p[t] > 0) this.absentSec[t] = 0;
      else this.absentSec[t] += dt;
    }

    // 争奪ゲージ（非占有チームのみ上昇。両陣同時在圏は拮抗＝凍結）
    for (let t = 0; t < 2; t++) {
      if (t === this.owner) continue;
      const e = 1 - t;
      if (p[t] > 0 && p[e] === 0) {
        this.gauge[t] = Math.min(cap.gaugeMax, this.gauge[t] + this.rate(p[t]) * dt);
      } else if (p[t] === 0 && this.absentSec[t] > cap.decayDelaySec) {
        this.gauge[t] = Math.max(0, this.gauge[t] - cap.decayPtPerSec * dt);
      }
      // p[t]>0 && p[e]>0 → 拮抗。凍結。
    }

    // 確保判定。同tick両陣100は99へ差し戻し（§8・決定論）
    const full0 = this.owner !== 0 && this.gauge[0] >= cap.gaugeMax;
    const full1 = this.owner !== 1 && this.gauge[1] >= cap.gaugeMax;
    if (full0 && full1) {
      this.gauge[0] = cap.simultaneousFullSetbackPt;
      this.gauge[1] = cap.simultaneousFullSetbackPt;
      events.push({ type: 'obj_simultaneous_setback', t: this.time });
    } else if (full0 || full1) {
      this.capture(full0 ? 0 : 1, events);
    }

    // 甕進行（占有者がいて敵の有効関与0。占有側の在圏は不要 §3）
    // 矛盾修正v0.2.1（§7到達性）: 敵の有効関与「のみ」が満了を妨げている間、
    // 内部の仮想甕は進行を続ける。仮想甕が100%に達した時点で敵関与中なら
    // 甕を100%に固定し延長を発生させる（妨げが無ければ満了していた瞬間＝到達tick）。
    if (this.owner >= 0 && !this.ot.active && !this.suddenDeath) {
      const o = this.owner;
      const e = 1 - o;
      const ratePerSec = this.cfg.progress.ratePctPerSec * 10; // %/s → 0.1%刻み/s
      if (p[e] === 0 && this.pot[o] < 1000) {
        this.potFrac[o] += ratePerSec * dt;
        const add = Math.floor(this.potFrac[o]);
        if (add > 0) {
          this.potFrac[o] -= add;
          this.pot[o] = Math.min(1000, this.pot[o] + add);
        }
        // 妨げが無い間、仮想甕は実甕に同期（counterfactualは現在の妨害エピソードのみを対象）
        this.virtPot[o] = this.pot[o];
        this.virtFrac[o] = this.potFrac[o];
      } else if (p[e] > 0 && this.pot[o] < 1000) {
        this.virtFrac[o] += ratePerSec * dt;
        const add = Math.floor(this.virtFrac[o]);
        if (add > 0) {
          this.virtFrac[o] -= add;
          this.virtPot[o] = Math.min(1000, this.virtPot[o] + add);
        }
        if (this.virtPot[o] >= 1000) {
          this.pot[o] = 1000; // §7: 到達扱い。直後の判定ブロックで延長が発生する
        }
      }
    }

    // 勝利判定と延長（§7）
    if (!this.suddenDeath && this.owner >= 0 && this.pot[this.owner] >= 1000) {
      const e = 1 - this.owner;
      if (!this.ot.active) {
        if (p[e] > 0) {
          const otc = this.cfg.overtime;
          this.ot = { active: true, grace: otc.graceInitialSec, cap: otc.graceInitialSec, elapsed: 0 };
          if (this.otPenaltyStartT < 0) this.otPenaltyStartT = this.time;
          events.push({ type: 'obj_overtime_start', t: this.time, owner: this.owner });
        } else {
          this.win(this.owner, 'pot_full_no_contest', events);
        }
      } else {
        const otc = this.cfg.overtime;
        this.ot.elapsed += dt;
        const shrinks = Math.floor(this.ot.elapsed / otc.capShrinkEverySec);
        const newCap = Math.max(otc.capMinSec, otc.graceInitialSec - shrinks * otc.capShrinkAmountSec);
        if (newCap !== this.ot.cap) {
          this.ot.cap = newCap;
          if (this.ot.grace > newCap) this.ot.grace = newCap;
          events.push({ type: 'obj_overtime_cap_shrink', t: this.time, cap: newCap });
        }
        if (p[e] > 0) {
          this.ot.grace = Math.min(this.ot.cap, this.ot.grace + otc.regenPerSec * dt);
        } else {
          this.ot.grace -= otc.decayPerSec * dt;
          if (this.ot.grace <= 0) {
            this.ot.active = false;
            this.win(this.owner, 'overtime_expired', events);
          }
        }
      }
    }
    this.transitionTo(this.deriveLogicalState(p), p, events);
  }

  deriveLogicalState(p) {
    if (this.roundWinner >= 0) return 'complete';
    if (this.suddenDeath) return 'sudden_death';
    if (this.ot.active) return 'overtime';
    if (this.owner < 0) {
      if (p[0] > 0 && p[1] > 0) return 'contested';
      if (p[0] > 0 || p[1] > 0 || this.gauge[0] > 0 || this.gauge[1] > 0) return 'capturing';
      return 'neutral';
    }
    if (p[0] > 0 && p[1] > 0) return 'contested';
    if (p[1 - this.owner] > 0) return 'recapturing';
    return 'progressing';
  }

  transitionTo(next, presence, events) {
    if (next === this.logicalState) return;
    const prev = this.logicalState;
    this.logicalState = next;
    events.push({
      type: 'obj_state_transition',
      t: this.time,
      from: prev,
      to: next,
      owner: this.owner,
      presence: [...presence],
      gauge: this.gauge.map(v => Math.round(v * 10) / 10),
      pot: [...this.pot],
    });
  }

  capture(team, events) {
    const prev = this.owner;
    this.owner = team;
    this.gauge[team] = this.cfg.capture.gaugeMax;
    this.gauge[1 - team] = 0;
    // 仮想甕は実甕へ再同期（占有交代で妨害エピソードはリセット）
    this.virtPot = [this.pot[0], this.pot[1]];
    this.virtFrac = [this.potFrac[0], this.potFrac[1]];
    if (this.ot.active) {
      // 奪還: 延長解除、新占有陣の「進行」へ。旧占有陣の甕は保持（§7）
      this.ot.active = false;
      this.otPenaltyStartT = -1;
      events.push({ type: 'obj_retake', t: this.time, owner: team, prevOwner: prev });
    }
    events.push({ type: 'obj_captured', t: this.time, owner: team, prevOwner: prev });
    if (this.suddenDeath) {
      // サドンデス: 次に確保を成立させた陣が取得（§4）
      this.win(team, 'sudden_death_capture', events);
    }
    // 再確保時に自陣の甕が100%なら、次tickの勝利判定で「敵の有効関与0の瞬間に即勝利」となる（§7）
  }

  win(team, reason, events) {
    if (this.roundWinner >= 0) return;
    this.roundWinner = team;
    events.push({ type: 'obj_round_win', t: this.time, winner: team, reason });
    this.transitionTo('complete', this.lastPresence, events);
  }

  snapshot() {
    return {
      sealed: this.sealed,
      owner: this.owner,
      gauge: [Math.round(this.gauge[0] * 10) / 10, Math.round(this.gauge[1] * 10) / 10],
      pot: [this.pot[0], this.pot[1]], // 0.1%刻み整数
      ot: this.ot.active ? { grace: Math.round(this.ot.grace * 10) / 10, cap: this.ot.cap } : null,
      suddenDeath: this.suddenDeath,
      otPenaltyStartT: this.otPenaltyStartT,
      respawnPenaltySec: this.respawnPenaltySec(),
      state: this.logicalState,
      time: Math.round(this.time * 10) / 10,
    };
  }
}

// §5 有効関与判定＋§8 境界ヒステリシス0.2m。
// player: { alive, flags:{invulnerable,intangible}, move:{pos}, insideObjective }
export function updateEffectivePresence(players, objective, cfg, occupants = null) {
  const R = cfg.capture.radiusM;
  const H = cfg.capture.heightM;
  const hys = cfg.capture.hysteresisM;
  const [cx, cy, cz] = objective.center;
  const presence = [0, 0];
  for (const pl of players) {
    const dx = pl.move.pos[0] - cx, dy = pl.move.pos[1] - cy;
    const d = Math.hypot(dx, dy);
    const zOk = pl.move.pos[2] >= cz - 0.5 && pl.move.pos[2] <= cz + H;
    if (pl.insideObjective) {
      if (d > R + hys || !zOk || !pl.alive) pl.insideObjective = false;
    } else {
      if (d <= R && zOk && pl.alive) pl.insideObjective = true;
    }
    const effective = pl.insideObjective && pl.alive && !pl.flags.invulnerable && !pl.flags.intangible;
    if (pl.insideObjective && occupants) occupants.push({ id: pl.id, team: pl.team, effective });
    if (effective) presence[pl.team]++;
  }
  return presence;
}
