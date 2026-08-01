import test from 'node:test';
import assert from 'node:assert/strict';
import { OSHIOI_FLASHPOINT } from '../shared/data/map_oshioi_flashpoint.js';
import {
  FLASHPOINT_MAX_TRAVEL_BIAS,
  FLASHPOINT_SITE_IDS,
  advanceFlashpointObjectiveMode,
  completeFlashpointSite,
  createFlashpointObjectiveMode,
  selectNextFlashpointSite,
} from '../shared/sim/flashpoint_objective_mode.js';

test('opens shiogama from the five stable map-authored site ids', () => {
  const expectedSiteIds = OSHIOI_FLASHPOINT.sites.map(site => site.id);
  const state = createFlashpointObjectiveMode({ seed: 73 });

  assert.deepEqual(FLASHPOINT_SITE_IDS, expectedSiteIds);
  assert.deepEqual(expectedSiteIds, ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami']);
  assert.equal(state.mode, 'five-site-flashpoint');
  assert.equal(state.lifecycle, 'active');
  assert.equal(state.activeSiteId, 'shiogama');
  assert.equal(state.pendingSiteId, null);
  assert.deepEqual(state.completedSiteIds, []);
  assert.deepEqual(state.siteScores, [0, 0]);
  assert.equal(state.transitionRemainingSec, 0);
  assert.equal(state.winnerTeam, null);
});

test('a completed site creates an exactly twelve-second interval with no active site', () => {
  const opening = createFlashpointObjectiveMode({ seed: 73 });
  const transition = completeFlashpointSite(opening, 0);

  assert.equal(opening.lifecycle, 'active');
  assert.equal(opening.activeSiteId, 'shiogama');
  assert.deepEqual(opening.completedSiteIds, []);
  assert.deepEqual(opening.siteScores, [0, 0]);

  assert.equal(transition.lifecycle, 'transition');
  assert.equal(transition.activeSiteId, null);
  assert.notEqual(transition.pendingSiteId, null);
  assert.notEqual(transition.pendingSiteId, 'shiogama');
  assert.deepEqual(transition.completedSiteIds, ['shiogama']);
  assert.deepEqual(transition.siteScores, [1, 0]);
  assert.equal(transition.transitionRemainingSec, 12);

  const almostOpen = advanceFlashpointObjectiveMode(transition, 11.999);
  assert.equal(almostOpen.lifecycle, 'transition');
  assert.equal(almostOpen.activeSiteId, null);
  assert.ok(Math.abs(almostOpen.transitionRemainingSec - 0.001) < 1e-9);

  const opened = advanceFlashpointObjectiveMode(almostOpen, 0.001);
  assert.equal(opened.lifecycle, 'active');
  assert.equal(opened.activeSiteId, transition.pendingSiteId);
  assert.equal(opened.pendingSiteId, null);
  assert.equal(opened.transitionRemainingSec, 0);
});

test('the dedicated selector is repeatable and neutral while site scores are tied', () => {
  const input = {
    seed: 'match-203',
    selectionIndex: 0,
    completedSiteIds: ['shiogama'],
    siteScores: [1, 1],
    teamSides: ['east', 'west'],
  };

  const first = selectNextFlashpointSite(input);
  const replay = selectNextFlashpointSite(input);

  assert.deepEqual(replay, first);
  assert.equal(first.policy, 'dedicated-seeded-weighted-choice');
  assert.equal(first.selectorVersion, 1);
  assert.equal(first.selectionIndex, 0);
  assert.equal(first.previousSiteId, 'shiogama');
  assert.equal(first.losingTeam, null);
  assert.equal(first.losingSide, null);
  assert.equal(first.eligibleMeanTravelMeters, null);
  assert.ok(first.sample >= 0 && first.sample < 1);
  assert.ok(
    ['mizuichi', 'kado', 'ami', 'kazami'].includes(first.chosenSiteId),
    `unexpected site ${first.chosenSiteId}`,
  );
  assert.deepEqual(first.candidates.map(candidate => candidate.siteId), [
    'mizuichi',
    'kado',
    'ami',
    'kazami',
  ]);
  for (const candidate of first.candidates) {
    assert.equal(candidate.biasTravelMeters, null);
    assert.equal(candidate.rawTravelBias, 0);
    assert.equal(candidate.appliedTravelBias, 0);
    assert.equal(candidate.weight, 1);
  }

  const seededChoices = new Set(
    Array.from({ length: 12 }, (_, seed) => selectNextFlashpointSite({
      ...input,
      seed,
    }).chosenSiteId),
  );
  assert.ok(seededChoices.size > 1, 'selector ignored its dedicated seed');
});

test('a losing team receives only the recorded capped travel weighting', () => {
  const selection = selectNextFlashpointSite({
    seed: 9,
    selectionIndex: 1,
    completedSiteIds: ['shiogama'],
    siteScores: [0, 1],
    teamSides: ['east', 'west'],
  });

  assert.equal(selection.losingTeam, 0);
  assert.equal(selection.losingSide, 'east');
  assert.equal(selection.travelBiasCap, FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.equal(selection.travelBiasUnit, 'selection-weight-ratio');
  assert.ok(Math.abs(selection.eligibleMeanTravelMeters - 125.9715) < 1e-9);

  const nearerToLosingEast = selection.candidates.find(
    candidate => candidate.siteId === 'mizuichi',
  );
  const fartherFromLosingEast = selection.candidates.find(
    candidate => candidate.siteId === 'ami',
  );

  assert.ok(Math.abs(nearerToLosingEast.rawTravelAdvantageM - 51.5675) < 1e-9);
  assert.equal(nearerToLosingEast.biasTravelMeters, 74.404);
  assert.ok(Math.abs(nearerToLosingEast.rawTravelBias - 0.40935846600223064) < 1e-12);
  assert.equal(nearerToLosingEast.appliedTravelBias, FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.equal(nearerToLosingEast.weight, 1 + FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.ok(fartherFromLosingEast.rawTravelBias < -FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.equal(fartherFromLosingEast.appliedTravelBias, -FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.equal(fartherFromLosingEast.weight, 1 - FLASHPOINT_MAX_TRAVEL_BIAS);
  assert.ok(nearerToLosingEast.weight > fartherFromLosingEast.weight);
});

test('an opposite-corner transition is excluded unless it is the only site left', () => {
  const alternativesExist = selectNextFlashpointSite({
    seed: 31,
    completedSiteIds: ['shiogama', 'mizuichi'],
    siteScores: [1, 1],
  });

  assert.deepEqual(alternativesExist.excludedDiagonalSiteIds, ['kazami']);
  assert.deepEqual(
    alternativesExist.candidates.map(candidate => candidate.siteId),
    ['kado', 'ami'],
  );
  assert.notEqual(alternativesExist.chosenSiteId, 'kazami');

  const diagonalIsLast = selectNextFlashpointSite({
    seed: 31,
    selectionIndex: 3,
    completedSiteIds: ['shiogama', 'mizuichi', 'kado', 'ami'],
    siteScores: [2, 2],
  });
  assert.deepEqual(diagonalIsLast.excludedDiagonalSiteIds, []);
  assert.deepEqual(
    diagonalIsLast.candidates.map(candidate => candidate.siteId),
    ['kazami'],
  );
  assert.equal(diagonalIsLast.chosenSiteId, 'kazami');
});

test('completed sites never repeat and the third site point completes the mode', () => {
  let state = createFlashpointObjectiveMode({
    seed: 'five-site-round',
    teamSides: ['east', 'west'],
  });
  const winners = [0, 1, 0, 1, 0];
  const activeSites = [];

  for (const [captureIndex, winnerTeam] of winners.entries()) {
    activeSites.push(state.activeSiteId);
    const completed = completeFlashpointSite(state, winnerTeam);

    assert.deepEqual(
      completed.completedSiteIds,
      activeSites,
      `capture ${captureIndex + 1} did not record the active site`,
    );
    assert.equal(new Set(completed.completedSiteIds).size, completed.completedSiteIds.length);

    if (captureIndex === winners.length - 1) {
      assert.equal(completed.lifecycle, 'complete');
      assert.equal(completed.activeSiteId, null);
      assert.equal(completed.pendingSiteId, null);
      assert.equal(completed.transitionRemainingSec, 0);
      assert.deepEqual(completed.siteScores, [3, 2]);
      assert.equal(completed.winnerTeam, 0);
      assert.equal(completed.selectionIndex, 4, 'terminal capture must not draw another site');
      state = completed;
      continue;
    }

    assert.equal(completed.lifecycle, 'transition');
    assert.equal(completed.activeSiteId, null);
    assert.equal(completed.lastSelection.chosenSiteId, completed.pendingSiteId);
    assert.equal(completed.lastSelection.selectionIndex, captureIndex);
    assert.equal(completed.selectionIndex, captureIndex + 1);
    assert.equal(completed.completedSiteIds.includes(completed.pendingSiteId), false);
    state = advanceFlashpointObjectiveMode(completed, 12);
    assert.equal(state.lifecycle, 'active');
  }

  assert.deepEqual(new Set(activeSites), new Set(FLASHPOINT_SITE_IDS));
  assert.equal(state.lifecycle, 'complete');
});

test('a three-site sweep completes immediately with two sites still unplayed', () => {
  let state = createFlashpointObjectiveMode({ seed: 'sweep' });
  for (let point = 1; point <= 3; point++) {
    state = completeFlashpointSite(state, 1);
    if (point < 3) state = advanceFlashpointObjectiveMode(state, 12);
  }

  assert.equal(state.lifecycle, 'complete');
  assert.deepEqual(state.siteScores, [0, 3]);
  assert.equal(state.winnerTeam, 1);
  assert.equal(state.completedSiteIds.length, 3);
  assert.equal(
    FLASHPOINT_SITE_IDS.filter(siteId => !state.completedSiteIds.includes(siteId)).length,
    2,
  );
  assert.equal(state.activeSiteId, null);
  assert.equal(state.pendingSiteId, null);
  assert.equal(state.selectionIndex, 2);
});

test('invalid controller commands fail before they can corrupt objective state', () => {
  assert.throws(
    () => createFlashpointObjectiveMode({ teamSides: ['east', 'east'] }),
    /teamSides/,
  );
  assert.throws(
    () => selectNextFlashpointSite({ selectionIndex: -1 }),
    /selectionIndex/,
  );

  const opening = createFlashpointObjectiveMode();
  assert.throws(() => completeFlashpointSite(opening, 2), /winnerTeam/);
  assert.deepEqual(opening.completedSiteIds, []);
  assert.deepEqual(opening.siteScores, [0, 0]);

  const transition = completeFlashpointSite(opening, 0);
  assert.throws(() => completeFlashpointSite(transition, 1), /active/);
  assert.throws(
    () => advanceFlashpointObjectiveMode(transition, -0.001),
    /deltaSec/,
  );
  assert.equal(transition.transitionRemainingSec, 12);
});
