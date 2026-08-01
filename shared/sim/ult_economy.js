export const DEFAULT_ULT_ECONOMY = Object.freeze({
  gaugeMax: 100,
  damagePerGauge: 80,
  healingPerGauge: 64,
  passiveGaugePerSec: 1.25,
  passiveCombatGraceSec: 8,
  carryoverMult: 0.5,
  interruptRefundPct: 0.5,
});
export function economyConfig(config = {}) { return { ...DEFAULT_ULT_ECONOMY, ...config }; }
export function gainFromDamage(amount, config) { return Math.max(0, Number(amount) || 0) / economyConfig(config).damagePerGauge; }
export function gainFromHealing(amount, config) { return Math.max(0, Number(amount) || 0) / economyConfig(config).healingPerGauge; }
export function gainFromPassive(seconds, config) {
  return Math.max(0, Number(seconds) || 0) * Math.max(0, Number(economyConfig(config).passiveGaugePerSec) || 0);
}
export function addGauge(current, gain, config) { const max = economyConfig(config).gaugeMax; return Math.max(0, Math.min(max, (Number(current) || 0) + Math.max(0, Number(gain) || 0))); }
export function spendGauge(current, cost = 100, config) { const c = economyConfig(config), paid = Math.max(0, Number(cost) || 0), value = Number(current) || 0; return value < paid ? { ok: false, gauge: Math.max(0, value), paid: 0 } : { ok: true, gauge: Math.max(0, Math.min(c.gaugeMax, value - paid)), paid }; }
export function refundGauge(current, spent, pct, config) { return addGauge(current, (Number(spent) || 0) * Math.max(0, Math.min(1, Number(pct) || 0)), config); }
export function carryoverGauge(current, config) { const c = economyConfig(config); return Math.max(0, Math.min(c.gaugeMax, (Number(current) || 0) * c.carryoverMult)); }

export function summarizeUltimateUses(matchDistributions = []) {
  const uses = matchDistributions
    .flatMap(match => Object.values(match || {}))
    .map(entry => Math.max(0, Number(entry?.uses) || 0))
    .sort((a, b) => a - b);
  if (uses.length === 0) {
    return { playerMatches: 0, averageUses: 0, medianUses: 0, minUses: 0, maxUses: 0, zeroUseRate: 0 };
  }
  const middle = Math.floor(uses.length / 2);
  const median = uses.length % 2 === 0 ? (uses[middle - 1] + uses[middle]) / 2 : uses[middle];
  const rounded = value => Math.round(value * 1000) / 1000;
  return {
    playerMatches: uses.length,
    averageUses: rounded(uses.reduce((sum, value) => sum + value, 0) / uses.length),
    medianUses: rounded(median),
    minUses: uses[0],
    maxUses: uses.at(-1),
    zeroUseRate: rounded(uses.filter(value => value === 0).length / uses.length),
  };
}
