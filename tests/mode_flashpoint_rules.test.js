import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { OSHIOI_FLASHPOINT } from '../shared/data/map_oshioi_flashpoint.js';

const mode = JSON.parse(readFileSync(
  new URL('../shared/data/mode_flashpoint.json', import.meta.url),
  'utf8',
));
const shioura = JSON.parse(readFileSync(
  new URL('../shared/data/mode_shioura.json', import.meta.url),
  'utf8',
));
const rules = readFileSync(
  new URL('../docs/mode_flashpoint_rules_v0.1.md', import.meta.url),
  'utf8',
);

const SITE_IDS = ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami'];

test('defines a separate five-site, first-to-three continuous match', () => {
  assert.equal(mode.schemaVersion, '0.1.0');
  assert.equal(mode.id, 'mode_flashpoint');
  assert.equal(mode.sourceOfTruth, 'docs/mode_flashpoint_rules_v0.1.md');
  assert.equal(mode.captureSemanticsSource, 'mode_shioura@1.0.0');
  assert.equal(mode.teamSize, 5);
  assert.deepEqual(mode.roleSlots, { frontline: 1, damage: 2, support: 2 });

  assert.equal(mode.map.id, OSHIOI_FLASHPOINT.id);
  assert.equal(mode.map.siteCount, 5);
  assert.deepEqual(mode.map.siteIds, SITE_IDS);
  assert.deepEqual(
    OSHIOI_FLASHPOINT.sites.map(site => site.id),
    SITE_IDS,
  );
  assert.equal(mode.map.openingSiteId, 'shiogama');

  assert.equal(mode.match.structure, 'single_continuous_match');
  assert.equal(mode.match.nestedBestOf, false);
  assert.equal(mode.match.pointsToWin, 3);
  assert.equal(mode.match.maxCompletedSites, 5);
  assert.equal(mode.match.setupSec, 30);
  assert.equal(mode.match.setupCaptureLocked, true);
  assert.equal(mode.match.siteCapSec, 480);
  assert.equal(mode.match.sideSwapBetweenSites, false);
  assert.equal(mode.match.endsImmediatelyAtPointsToWin, true);
  assert.equal(Object.hasOwn(mode, 'roundsToWin'), false);
  assert.equal(Object.hasOwn(mode, 'maxRounds'), false);

  // The frozen single-site mode remains a separate BO3 contract.
  assert.equal(shioura.id, 'mode_shioura');
  assert.equal(shioura.roundsToWin, 2);
  assert.equal(shioura.maxRounds, 3);
  assert.equal(shioura.areaPolicy, 'single_area_repeat');
});

test('reuses the frozen site-local capture, progress, overtime, and respawn values', () => {
  assert.deepEqual(mode.capture, shioura.capture);
  assert.deepEqual(mode.progress, shioura.progress);
  assert.deepEqual(mode.overtime, shioura.overtime);
  assert.deepEqual(mode.respawn, shioura.respawn);
  assert.equal(mode.match.siteCapSec, shioura.roundCapSec);
  assert.equal(mode.siteCapture.scope, 'active_site_only');
  assert.equal(mode.siteCapture.requiresMatchState, 'ACTIVE');
  assert.equal(mode.siteCapture.pendingAndCompletedSitesLocked, true);
  assert.equal(mode.siteCapture.membershipKey, 'siteId');
  assert.equal(mode.siteCapture.clearMembershipOnActivation, true);
  assert.equal(mode.siteCapture.verticalFloorOffsetM, -0.5);
  assert.equal(mode.siteCapture.aliveRequired, true);
  assert.deepEqual(mode.siteCapture.excludedEffectivePresenceFlags, [
    'invulnerable',
    'intangible',
  ]);

  for (const site of OSHIOI_FLASHPOINT.sites) {
    assert.equal(site.radiusM, mode.capture.radiusM, `${site.id} radius`);
    assert.equal(site.heightM, mode.capture.heightM, `${site.id} height`);
  }
});

test('makes active, pending, and completed state exclusive and preserves one simulation', () => {
  assert.deepEqual(mode.lifecycle.phaseValues, ['active', 'transition', 'complete']);
  assert.deepEqual(mode.lifecycle.initial, {
    phase: 'active',
    activeSiteId: 'shiogama',
    pendingSiteId: null,
    completedSiteIds: [],
    siteScores: [0, 0],
  });
  assert.equal(mode.lifecycle.completedSitePolicy, 'no_repeat_in_match');
  assert.equal(mode.lifecycle.transition.durationSec, 12);
  assert.equal(mode.lifecycle.transition.captureEnabled, false);
  assert.equal(mode.lifecycle.transition.activeSiteId, null);
  assert.equal(mode.lifecycle.transition.pendingSiteId, 'selector_result');
  assert.equal(mode.lifecycle.terminal.activeSiteId, null);
  assert.equal(mode.lifecycle.terminal.pendingSiteId, null);
  assert.equal(mode.lifecycle.terminal.selectNextSite, false);

  assert.equal(mode.continuity.simulationContinuesDuringTransition, true);
  assert.equal(mode.continuity.teleportPlayers, false);
  assert.equal(mode.continuity.clearProjectiles, false);
  assert.equal(mode.continuity.resetRespawnQueue, false);
  assert.equal(mode.continuity.ultimateChargeMultiplier, 1);
  assert.deepEqual(new Set(mode.continuity.preserve), new Set([
    'players',
    'playerTransforms',
    'playerHealthAliveAndStatuses',
    'ultimateCharge',
    'abilityCooldowns',
    'weaponState',
    'projectiles',
    'zones',
    'barriers',
    'respawnQueue',
    'teamSides',
  ]));
  assert.deepEqual(new Set(mode.continuity.reset), new Set([
    'siteOwner',
    'siteCaptureGauges',
    'siteProgress',
    'siteOvertime',
    'sitePresenceMembership',
    'siteClock',
  ]));

  assert.equal(mode.clocks.matchClock.monotonic, true);
  assert.equal(mode.clocks.matchClock.resetAtSiteTransition, false);
  assert.equal(mode.clocks.respawnClock.monotonic, true);
  assert.equal(mode.clocks.respawnClock.resetAtSiteTransition, false);
  assert.equal(mode.clocks.siteClock.resetAtSiteActivation, true);
  assert.deepEqual(mode.clocks.eventTimeFields, [
    'matchTick',
    'matchTimeSec',
    'siteTimeSec',
  ]);
});

test('specifies a deterministic capped travel selector with diagonal avoidance', () => {
  const selector = mode.selector;
  assert.equal(selector.authority, 'server');
  assert.equal(selector.policy, 'dedicated-seeded-weighted-choice');
  assert.equal(selector.selectorVersion, 1);
  assert.equal(selector.candidateOrder, 'map_site_order');
  assert.equal(selector.completedSiteFilter, 'exclude');
  assert.deepEqual(selector.diagonalAvoidance.pairs, [
    ['mizuichi', 'kazami'],
    ['kado', 'ami'],
  ]);
  assert.equal(
    selector.diagonalAvoidance.policy,
    'exclude_opposite_when_non_diagonal_alternative_exists',
  );
  assert.equal(
    selector.diagonalAvoidance.fallback,
    'allow_opposite_when_only_eligible_candidate',
  );

  assert.equal(selector.travelBias.trailingTeamBasis, 'scores_after_site_award');
  assert.equal(selector.travelBias.tiedScorePolicy, 'neutral_weights');
  assert.equal(
    selector.travelBias.metric,
    'routesBySite.<siteId>.<side>.front.measuredLengthM',
  );
  assert.equal(
    selector.travelBias.normalization,
    'post_diagonal_eligible_mean_for_losing_side',
  );
  assert.equal(
    selector.travelBias.rawFormula,
    '(eligibleMeanTravelMeters - biasTravelMeters) / eligibleMeanTravelMeters',
  );
  assert.equal(selector.travelBias.maxAbsolute, 0.25);
  assert.deepEqual(selector.travelBias.appliedClamp, [-0.25, 0.25]);
  assert.equal(selector.travelBias.weightFormula, '1 + appliedTravelBias');
  assert.deepEqual(selector.travelBias.weightRange, [0.75, 1.25]);

  assert.equal(selector.rng.source, 'dedicated_selector_prng');
  assert.deepEqual(selector.rng.keyFields, ['matchSeed', 'selectionIndex']);
  assert.equal(selector.rng.sharedWithCombat, false);
  assert.equal(selector.rng.draw, 'stable_order_cumulative_weighted');
  assert.deepEqual(selector.selectionAuditFields, [
    'policy',
    'selectorVersion',
    'selectionIndex',
    'previousSiteId',
    'losingTeam',
    'losingSide',
    'travelBiasCap',
    'eligibleSiteIdsBeforeDiagonal',
    'excludedDiagonalSiteIds',
    'eligibleMeanTravelMeters',
    'sample',
    'totalWeight',
    'candidates',
    'chosenSiteId',
  ]);
  assert.deepEqual(selector.candidateAuditFields, [
    'siteId',
    'travelMeters',
    'biasTravelMeters',
    'rawTravelBias',
    'appliedTravelBias',
    'weight',
  ]);

  const remaining = SITE_IDS.filter(id => id !== 'shiogama');
  const eastMeters = remaining.map(
    id => OSHIOI_FLASHPOINT.routesBySite[id].east.front.measuredLengthM,
  );
  const mean = eastMeters.reduce((sum, value) => sum + value, 0) / eastMeters.length;
  const weights = eastMeters.map((meters) => {
    const raw = (mean - meters) / mean;
    const applied = Math.max(-0.25, Math.min(0.25, raw));
    return 1 + applied;
  });
  assert.ok(weights.every(weight => weight >= 0.75 && weight <= 1.25));
  assert.equal(weights[0], 1.25, 'east-losing mizuichi bias must be capped');
  assert.equal(weights[2], 0.75, 'east-losing ami bias must be capped');
});

test('requires canonical full snapshots and site-qualified events for recovery', () => {
  assert.equal(mode.protocol.minimumProtocolVersion, 6);
  assert.equal(mode.protocol.snapshotSchemaVersion, 1);
  assert.equal(mode.protocol.serverAuthoritative, true);
  assert.equal(mode.protocol.fullSnapshotCanonical, true);
  assert.equal(mode.protocol.eventsSupplemental, true);
  assert.equal(mode.protocol.rejectLegacyProtocolBeforeSnapshot, true);
  assert.deepEqual(mode.protocol.requiredMatchSnapshotFields, [
    'state',
    'stateT',
    'matchClockSec',
    'respawnClockSec',
  ]);
  assert.deepEqual(mode.protocol.requiredFlashpointSnapshotFields, [
    'phase',
    'activeSiteId',
    'pendingSiteId',
    'completedSiteIds',
    'siteScores',
    'transitionRemainingSec',
    'activationIndex',
    'selectionIndex',
    'winnerTeam',
    'lastSelection',
    'sites',
  ]);
  assert.deepEqual(mode.protocol.requiredSiteStateFields, [
    'siteId',
    'phase',
    'capture',
    'result',
  ]);
  assert.deepEqual(mode.protocol.playerObjectiveFields, ['onPoint', 'onObjectiveId']);
  assert.equal(
    mode.protocol.compatibilityProjection.objective,
    'active_site_capture_or_null',
  );
  assert.equal(
    mode.protocol.compatibilityProjection.onPoint,
    'onObjectiveId_equals_activeSiteId',
  );
  assert.deepEqual(mode.protocol.events.requiredObjectiveEventFields, [
    'siteId',
    'activationIndex',
    'matchTick',
    'matchTimeSec',
    'siteTimeSec',
  ]);
  assert.deepEqual(mode.protocol.events.flashpointEventTypes, [
    'flashpoint_site_completed',
    'flashpoint_site_selected',
    'flashpoint_transition_started',
    'flashpoint_site_activated',
    'flashpoint_match_completed',
  ]);
  assert.equal(mode.protocol.recovery.joinUsesFullSnapshot, true);
  assert.equal(mode.protocol.recovery.resyncUsesFullSnapshot, true);
  assert.equal(mode.protocol.recovery.requiresPriorEvents, false);
});

test('the human-readable rules point back to the JSON contract and cover every hard boundary', () => {
  assert.match(rules, /^# Kagariai Flashpoint Rules v0\.1/m);
  assert.match(rules, /shared\/data\/mode_flashpoint\.json/);
  assert.match(rules, /single continuous match/i);
  assert.match(rules, /not a BO3/i);
  assert.match(rules, /shiogama/);
  assert.match(rules, /12\.0 seconds/);
  assert.match(rules, /no_repeat_in_match/);
  assert.match(rules, /0\.25/);
  assert.match(rules, /activeSiteId/);
  assert.match(rules, /pendingSiteId/);
  assert.match(rules, /completedSiteIds/);
  assert.match(rules, /matchClock/);
  assert.match(rules, /respawnClock/);
  assert.match(rules, /protocol v6/i);
  assert.match(rules, /mode_shioura_rules_v0\.2_FROZEN\.md/);
  assert.match(rules, /MUST NOT modify the frozen Shioura contract/);
});
