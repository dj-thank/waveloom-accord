import test from 'node:test';
import assert from 'node:assert/strict';
import { runTeamfightAudit } from '../tools/teamfight_audit.js';
import { MIN_COMPETITIVE_ROSTER_MATCHES } from '../shared/rules/bot_roster.js';
import {
  acceptanceSeedForMatch,
  evaluateTeamfightAcceptance,
} from '../shared/telemetry/teamfight_acceptance.js';

test('three competitive matchups pass on both mirrored sides with paired seeds', {
  timeout: 360_000,
}, () => {
  assert.equal(MIN_COMPETITIVE_ROSTER_MATCHES, 6);
  const results = Array.from({ length: MIN_COMPETITIVE_ROSTER_MATCHES }, (_, matchIndex) => (
    runTeamfightAudit({
      seed: acceptanceSeedForMatch(matchIndex),
      matchIndex,
      durationSec: 180,
    })
  ));
  const evaluation = evaluateTeamfightAcceptance(results);

  assert.deepEqual(evaluation.violations, [], JSON.stringify(evaluation, null, 2));
});
