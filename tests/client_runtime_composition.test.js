import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatRuntimeCompositionPolicy,
  heroCapabilityContribution,
  validateRuntimeRosterContract,
} from '../client/runtime_composition.js';

const fixedPolicy = {
  teamSize: 5,
  roleSlots: { frontline: 1, damage: 2, support: 2 },
  requireContinuousSustain: true,
};

const roster = {
  version: 4,
  runtimeCompositionPolicy: fixedPolicy,
  heroes: [
    { id: 'asagi', teamFunctions: ['pressure', 'sustain'] },
    { id: 'tsuzuri', teamFunctions: ['sustain', 'continuous_sustain'] },
  ],
};

test('welcome roster v4 requires the fixed 1/2/2 and continuous-sustain contract', () => {
  const result = validateRuntimeRosterContract(roster);
  assert.equal(result.ok, true);
  assert.deepEqual(result.policy, fixedPolicy);
  assert.match(formatRuntimeCompositionPolicy(result.policy), /1.*2.*2/);
  assert.match(formatRuntimeCompositionPolicy(result.policy), /継続回復/);
});

test('stale role-open and malformed welcome contracts fail closed', () => {
  assert.equal(validateRuntimeRosterContract({ version: 3, heroes: roster.heroes }).ok, false);
  assert.equal(validateRuntimeRosterContract({ version: 4, heroes: [] }).ok, false);
  assert.equal(validateRuntimeRosterContract({
    version: 4,
    runtimeCompositionPolicy: { teamSize: 5, roleSlots: { frontline: 0, damage: 3, support: 2 } },
    heroes: roster.heroes,
  }).ok, false);
});

test('hero tactical contribution remains descriptive rather than a role-queue bypass', () => {
  assert.deepEqual(heroCapabilityContribution(['pressure', 'sustain']), {
    space: false,
    recovery: true,
    label: '戦術機能: 空間 － / 回復 ○',
  });
  assert.deepEqual(heroCapabilityContribution(['pressure', 'space']), {
    space: true,
    recovery: false,
    label: '戦術機能: 空間 ○ / 回復 －',
  });
});
