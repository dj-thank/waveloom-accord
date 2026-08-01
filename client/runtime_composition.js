export { RUNTIME_ROSTER_VERSION } from '../shared/rules/team_composition.js';
import { RUNTIME_ROSTER_VERSION } from '../shared/rules/team_composition.js';

const EXPECTED_POLICY = Object.freeze({
  teamSize: 5,
  roleSlots: Object.freeze({ frontline: 1, damage: 2, support: 2 }),
  requireContinuousSustain: true,
});

const RECOVERY_FUNCTIONS = new Set(['recovery', 'sustain', 'continuous_sustain']);
const MISSING_CAPABILITY_LABELS = Object.freeze({
  space: '空間（入口・遮蔽・敵の注意を作る担当）',
  recovery: '回復（味方を回復し接続を維持する担当）',
});

function policyMatchesContract(policy) {
  return policy?.teamSize === EXPECTED_POLICY.teamSize
    && policy?.requireContinuousSustain === true
    && Object.keys(EXPECTED_POLICY.roleSlots).every(role => (
      policy?.roleSlots?.[role] === EXPECTED_POLICY.roleSlots[role]
    ))
    && Object.keys(policy?.roleSlots || {}).length === Object.keys(EXPECTED_POLICY.roleSlots).length;
}

export function validateRuntimeRosterContract(roster) {
  const heroesValid = Array.isArray(roster?.heroes)
    && roster.heroes.length > 0
    && roster.heroes.every(hero => (
      typeof hero?.id === 'string' && Array.isArray(hero.teamFunctions)
    ));
  const ok = roster?.version === RUNTIME_ROSTER_VERSION
    && policyMatchesContract(roster.runtimeCompositionPolicy)
    && heroesValid;
  return {
    ok,
    policy: ok
      ? {
        teamSize: roster.runtimeCompositionPolicy.teamSize,
        roleSlots: { ...roster.runtimeCompositionPolicy.roleSlots },
        requireContinuousSustain: true,
      }
      : null,
  };
}

export function formatRuntimeCompositionPolicy(policy = EXPECTED_POLICY) {
  const teamSize = Number(policy?.teamSize) || EXPECTED_POLICY.teamSize;
  const slots = policy?.roleSlots || EXPECTED_POLICY.roleSlots;
  const frontline = Number(slots.frontline) || EXPECTED_POLICY.roleSlots.frontline;
  const damage = Number(slots.damage) || EXPECTED_POLICY.roleSlots.damage;
  const support = Number(slots.support) || EXPECTED_POLICY.roleSlots.support;
  return `${teamSize}人固定編成：篝手 ${frontline}・焔手 ${damage}・灯手 ${support}。継続回復を担当できる灯手を最低1人含みます。`;
}

export function heroCapabilityContribution(teamFunctions = []) {
  const functions = Array.isArray(teamFunctions) ? teamFunctions : [];
  const space = functions.includes('space');
  const recovery = functions.some(value => RECOVERY_FUNCTIONS.has(value));
  return {
    space,
    recovery,
    label: `戦術機能: 空間 ${space ? '○' : '－'} / 回復 ${recovery ? '○' : '－'}`,
  };
}

export function formatMissingCapabilities(missingCapabilities = []) {
  const missing = [...new Set(Array.isArray(missingCapabilities) ? missingCapabilities : [])]
    .map(value => MISSING_CAPABILITY_LABELS[value] || String(value || '').trim())
    .filter(Boolean);
  if (missing.length === 0) {
    return 'その選択では5人チームの必須能力を満たせません。別のヒーローを選んでください。';
  }
  return `チームに必要な能力が不足しています：${missing.join('、')}。別のヒーローを選んでください。`;
}
