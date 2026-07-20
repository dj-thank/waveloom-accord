// 試合フロー: SETUP(30s) → ACTIVE(≤480s) → ROUND_END(5s) → 次ラウンド or MATCH_END
// BO3・2本先取。サイド割当: R1シードランダム / R2左右入替 / R3再抽選（§1）。
// 延長（OVERTIME）はobjective内部状態として表現し、スナップショットで公開する。

export class MatchFlow {
  constructor(mode, rng) {
    this.mode = mode;
    this.rng = rng;
    this.round = 1;
    this.score = [0, 0];
    this.state = 'SETUP';
    this.stateT = 0;
    this.matchWinner = -1;
    this.sides = this.drawSides(); // sides[team] = 'east' | 'west'
  }

  drawSides() {
    const eastTeam = this.rng() < 0.5 ? 0 : 1;
    return eastTeam === 0 ? ['east', 'west'] : ['west', 'east'];
  }

  // world側フック: onRoundStart(), onRoundEnd(winner), onMatchEnd(winner), onNewRound()
  tick(dt, objective, events, hooks) {
    this.stateT += dt;
    switch (this.state) {
      case 'SETUP':
        if (this.stateT >= this.mode.setupSec) {
          this.state = 'ACTIVE';
          this.stateT = 0;
          objective.unseal(events);
          events.push({ type: 'round_active', round: this.round });
          hooks.onRoundStart?.();
        }
        break;
      case 'ACTIVE':
        // 延長中は480秒上限で打ち切らない（§7: 敵が有効関与する限り延長規則が優先）
        if (objective.roundWinner < 0 && !objective.suddenDeath && !objective.ot.active && !objective.hasFullPot() && objective.time + 1e-9 >= this.mode.roundCapSec) {
          objective.resolveByCap(events);
          if (objective.suddenDeath) events.push({ type: 'sudden_death', round: this.round });
        }
        if (objective.roundWinner >= 0) {
          const w = objective.roundWinner;
          this.score[w]++;
          this.state = 'ROUND_END';
          this.stateT = 0;
          events.push({ type: 'round_end', round: this.round, winner: w, score: [...this.score] });
          hooks.onRoundEnd?.(w);
        }
        break;
      case 'ROUND_END':
        if (this.stateT >= this.mode.resultSec) {
          const leader = this.score[0] >= this.mode.roundsToWin ? 0 : this.score[1] >= this.mode.roundsToWin ? 1 : -1;
          if (leader >= 0 || this.round >= this.mode.maxRounds) {
            this.matchWinner = leader >= 0 ? leader : (this.score[0] > this.score[1] ? 0 : 1);
            this.state = 'MATCH_END';
            this.stateT = 0;
            events.push({ type: 'match_end', winner: this.matchWinner, score: [...this.score] });
            hooks.onMatchEnd?.(this.matchWinner);
          } else {
            this.round++;
            // サイド: R2は入替、R3は再抽選（§1）
            if (this.round === 2) this.sides = [this.sides[1], this.sides[0]];
            else this.sides = this.drawSides();
            this.state = 'SETUP';
            this.stateT = 0;
            events.push({ type: 'round_setup', round: this.round, sides: [...this.sides] });
            hooks.onNewRound?.();
          }
        }
        break;
      case 'MATCH_END':
        break;
    }
  }

  snapshot() {
    return {
      state: this.state,
      stateT: Math.round(this.stateT * 10) / 10,
      round: this.round,
      score: [...this.score],
      sides: [...this.sides],
      matchWinner: this.matchWinner,
      setupSec: this.mode.setupSec,
      roundCapSec: this.mode.roundCapSec,
    };
  }
}
