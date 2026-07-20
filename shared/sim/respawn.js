// ウェーブ復帰（§6）: 基本10.0秒＋2.5秒周期のリスポーンtick。
// 個人タイマー満了後の「次のウェーブ境界」で出撃（実効10.0〜12.5秒）。
// 延長/サドンデス中は+3/+6秒の補正（補正値は評価時点の状態で動的に読む）。

export class RespawnSystem {
  constructor(cfg) {
    this.cfg = cfg; // { baseSec, waveIntervalSec }
    this.resetRound();
  }

  resetRound() {
    this.pending = new Map(); // playerId -> deathT（ラウンド時刻）
    this.prevT = 0;
  }

  onDeath(playerId, tRound) {
    this.pending.set(playerId, tRound);
  }

  cancel(playerId) {
    this.pending.delete(playerId);
  }

  // ウェーブ境界を跨いだtickで出撃者リストを返す。penaltySecは§7の延長補正。
  tick(tRound, penaltySec) {
    const w = this.cfg.waveIntervalSec;
    const prevWave = Math.floor(this.prevT / w);
    const curWave = Math.floor(tRound / w);
    this.prevT = tRound;
    if (curWave <= prevWave) return [];
    const boundary = curWave * w;
    const out = [];
    for (const [pid, deathT] of this.pending) {
      if (deathT + this.cfg.baseSec + penaltySec <= boundary) out.push(pid);
    }
    for (const pid of out) this.pending.delete(pid);
    return out;
  }

  // HUD用: 残り秒（次に出撃できるウェーブ境界まで）
  timeUntilSpawn(playerId, tRound, penaltySec) {
    const deathT = this.pending.get(playerId);
    if (deathT === undefined) return 0;
    const w = this.cfg.waveIntervalSec;
    const ready = deathT + this.cfg.baseSec + penaltySec;
    const wave = Math.ceil(Math.max(ready, tRound) / w) * w;
    return Math.max(0, wave - tRound);
  }
}
