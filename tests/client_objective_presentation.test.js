import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LEGACY_OBJECTIVE_ID,
  normalizeObjectivePresentation,
} from '../client/objective_presentation.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { World } from '../shared/sim/sim.js';
import { COMBAT } from './helpers.js';

const flashpointMap = {
  objectives: [
    { id: 'shiogama', displayName: 'Shiogama' },
    { id: 'mizuichi', displayName: 'Mizuichi' },
    { id: 'kado', displayName: 'Kado' },
    { id: 'ami', displayName: 'Ami' },
    { id: 'kazami', displayName: 'Kazami' },
  ],
};

const FLASHPOINT_MODE = JSON.parse(readFileSync(
  new URL('../shared/data/mode_flashpoint.json', import.meta.url),
  'utf8',
));

test('legacy scalar objective is normalized as one legacy point without inventing five sites', () => {
  const objective = {
    sealed: false,
    state: 'capturing',
    owner: 0,
    gauge: [25, 0],
    pot: [0, 0],
    ot: null,
    suddenDeath: false,
    time: 4.2,
  };
  const snapshot = {
    tick: 42,
    objective,
    players: [
      { id: 'inside', alive: true, onPoint: true },
      { id: 'outside', alive: true, onPoint: false },
    ],
  };

  const normalized = normalizeObjectivePresentation(snapshot, {
    objective: { center: [0, 0, 2.5], radiusM: 7, heightM: 5 },
    objectives: Array.from({ length: 5 }, (_, index) => ({ id: `site-${index}` })),
  });

  assert.equal(normalized.valid, true);
  assert.equal(normalized.legacy, true);
  assert.equal(normalized.activeObjectiveId, LEGACY_OBJECTIVE_ID);
  assert.equal(normalized.pendingObjectiveId, null);
  assert.equal(normalized.objectives.length, 1);
  assert.equal(normalized.objectives[0].id, LEGACY_OBJECTIVE_ID);
  assert.equal(normalized.objectives[0].activation, 'active');
  assert.deepEqual(normalized.objective, objective);
  assert.notEqual(normalized.objective, objective);
  assert.equal(normalized.objectiveById.get(LEGACY_OBJECTIVE_ID), normalized.objectives[0]);
  assert.deepEqual(
    normalized.players.map(player => ({
      id: player.id,
      onObjectiveId: player.onObjectiveId,
      onPoint: player.onPoint,
    })),
    [
      { id: 'inside', onObjectiveId: LEGACY_OBJECTIVE_ID, onPoint: true },
      { id: 'outside', onObjectiveId: null, onPoint: false },
    ],
  );
  assert.equal(snapshot.players[0].onObjectiveId, undefined);
  assert.equal(snapshot.objectives, undefined);
});

test('Flashpoint objectives use stable map IDs and project only the active point to legacy consumers', () => {
  const snapshot = {
    tick: 80,
    activeObjectiveId: 'ami',
    pendingObjectiveId: null,
    objectives: [
      { id: 'kado', activation: 'locked', sealed: true, state: 'sealed', owner: -1 },
      { id: 'ami', activation: 'active', sealed: false, state: 'progressing', owner: 1, gauge: [0, 100], pot: [0, 240], time: 17 },
      { id: 'kazami', activation: 'locked', sealed: true, state: 'sealed', owner: -1 },
      { id: 'shiogama', activation: 'resolved', sealed: true, state: 'complete', owner: 0, result: { winner: 0 } },
      { id: 'mizuichi', activation: 'resolved', sealed: true, state: 'complete', owner: 1, result: { winner: 1 } },
    ],
    objective: { sealed: true, owner: -1, time: 999 },
    players: [
      { id: 'active', alive: true, onObjectiveId: 'ami', onPoint: false },
      { id: 'inactive', alive: true, onObjectiveId: 'shiogama', onPoint: true },
      { id: 'unknown', alive: true, onObjectiveId: 'not-a-site', onPoint: true },
      { id: 'missing-id', alive: true, onPoint: true },
      { id: 'dead', alive: false, onObjectiveId: 'ami', onPoint: true },
    ],
  };

  const normalized = normalizeObjectivePresentation(snapshot, flashpointMap);

  assert.equal(normalized.valid, true);
  assert.equal(normalized.legacy, false);
  assert.deepEqual(
    normalized.objectives.map(point => point.id),
    flashpointMap.objectives.map(point => point.id),
  );
  assert.deepEqual(
    normalized.objectives.map(point => point.activation),
    ['resolved', 'resolved', 'locked', 'active', 'locked'],
  );
  assert.equal(normalized.objectiveById.get('ami'), normalized.objectives[3]);
  assert.equal(normalized.objectiveById.get('ami').definition, flashpointMap.objectives[3]);
  assert.equal(normalized.objectiveById.get('ami').isActive, true);
  assert.equal(normalized.objectiveById.get('shiogama').isActive, false);
  assert.deepEqual(normalized.objective, {
    sealed: false,
    state: 'progressing',
    owner: 1,
    gauge: [0, 100],
    pot: [0, 240],
    time: 17,
  });
  assert.deepEqual(
    normalized.players.map(player => [player.id, player.onObjectiveId, player.onPoint]),
    [
      ['active', 'ami', true],
      ['inactive', 'shiogama', false],
      ['unknown', null, false],
      ['missing-id', null, false],
      ['dead', null, false],
    ],
  );
  assert.equal(snapshot.objective.time, 999);
  assert.equal(snapshot.objectives[1].isActive, undefined);
});

test('Flashpoint snapshots with 0, 4, or 6 points fail closed and clear stale highlights', () => {
  for (const count of [0, 4, 6]) {
    const objectives = Array.from({ length: count }, (_, index) => ({
      id: flashpointMap.objectives[index % flashpointMap.objectives.length]?.id || `extra-${index}`,
      activation: index === 0 ? 'active' : 'locked',
      owner: index === 0 ? 0 : -1,
    }));
    if (count === 6) objectives[5].id = 'extra-site';
    const normalized = normalizeObjectivePresentation({
      activeObjectiveId: objectives[0]?.id || 'shiogama',
      pendingObjectiveId: null,
      objectives,
      objective: { owner: 0, sealed: false },
      players: [{ id: 'stale', alive: true, onObjectiveId: 'shiogama', onPoint: true }],
    }, flashpointMap);

    assert.equal(normalized.valid, false, `count=${count}`);
    assert.equal(normalized.errors.includes('objective_count'), true, `count=${count}`);
    assert.equal(normalized.activeObjectiveId, null, `count=${count}`);
    assert.equal(normalized.pendingObjectiveId, null, `count=${count}`);
    assert.deepEqual(normalized.objectives, [], `count=${count}`);
    assert.equal(normalized.objectiveById.size, 0, `count=${count}`);
    assert.equal(normalized.objective, null, `count=${count}`);
    assert.deepEqual(
      normalized.players.map(player => [player.onObjectiveId, player.onPoint]),
      [[null, false]],
      `count=${count}`,
    );
  }
});

test('duplicate and unknown Flashpoint IDs are rejected instead of being matched by array position', () => {
  const cases = [
    {
      name: 'duplicate',
      ids: ['shiogama', 'shiogama', 'kado', 'ami', 'kazami'],
      error: 'duplicate_objective_id',
    },
    {
      name: 'unknown',
      ids: ['shiogama', 'mizuichi', 'kado', 'ami', 'not-in-map'],
      error: 'unknown_objective_id',
    },
  ];

  for (const fixture of cases) {
    const normalized = normalizeObjectivePresentation({
      activeObjectiveId: 'ami',
      pendingObjectiveId: null,
      objectives: fixture.ids.map(id => ({
        id,
        activation: id === 'ami' ? 'active' : 'locked',
      })),
      objective: { owner: 1 },
      players: [{ id: 'stale', alive: true, onObjectiveId: 'ami', onPoint: true }],
    }, flashpointMap);

    assert.equal(normalized.valid, false, fixture.name);
    assert.equal(normalized.errors.includes(fixture.error), true, fixture.name);
    assert.equal(normalized.activeObjectiveId, null, fixture.name);
    assert.equal(normalized.objective, null, fixture.name);
    assert.equal(normalized.players[0].onPoint, false, fixture.name);
  }
});

test('Flashpoint lifecycle accepts only locked, active, and resolved activation states', () => {
  const normalized = normalizeObjectivePresentation({
    activeObjectiveId: 'ami',
    pendingObjectiveId: null,
    objectives: flashpointMap.objectives.map(definition => ({
      id: definition.id,
      activation: definition.id === 'ami' ? 'capturing' : 'locked',
    })),
    objective: { owner: 1 },
    players: [{ id: 'stale', alive: true, onObjectiveId: 'ami', onPoint: true }],
  }, flashpointMap);

  assert.equal(normalized.valid, false);
  assert.equal(normalized.errors.includes('invalid_objective_activation'), true);
  assert.equal(normalized.activeObjectiveId, null);
  assert.equal(normalized.objective, null);
  assert.equal(normalized.players[0].onPoint, false);
});

test('unknown or inconsistent active and pending IDs fail closed without a stale active projection', () => {
  const basePoints = flashpointMap.objectives.map(definition => ({
    id: definition.id,
    activation: definition.id === 'ami' ? 'active' : 'locked',
    owner: definition.id === 'ami' ? 1 : -1,
  }));
  const cases = [
    {
      name: 'unknown active',
      activeObjectiveId: 'not-in-map',
      pendingObjectiveId: null,
      points: basePoints,
      error: 'unknown_active_objective_id',
    },
    {
      name: 'unknown pending',
      activeObjectiveId: null,
      pendingObjectiveId: 'not-in-map',
      points: basePoints.map(point => ({ ...point, activation: 'locked' })),
      error: 'unknown_pending_objective_id',
    },
    {
      name: 'same active and pending',
      activeObjectiveId: 'ami',
      pendingObjectiveId: 'ami',
      points: basePoints,
      error: 'invalid_objective_lifecycle',
    },
    {
      name: 'active ID does not match active state',
      activeObjectiveId: 'ami',
      pendingObjectiveId: null,
      points: basePoints.map(point => ({
        ...point,
        activation: point.id === 'kado' ? 'active' : 'locked',
      })),
      error: 'invalid_objective_lifecycle',
    },
    {
      name: 'multiple active states',
      activeObjectiveId: 'ami',
      pendingObjectiveId: null,
      points: basePoints.map(point => ({
        ...point,
        activation: point.id === 'ami' || point.id === 'kado' ? 'active' : 'locked',
      })),
      error: 'invalid_objective_lifecycle',
    },
    {
      name: 'pending ID is already resolved',
      activeObjectiveId: null,
      pendingObjectiveId: 'mizuichi',
      points: basePoints.map(point => ({
        ...point,
        activation: point.id === 'mizuichi' ? 'resolved' : 'locked',
      })),
      error: 'invalid_objective_lifecycle',
    },
    {
      name: 'active state remains after active ID is cleared',
      activeObjectiveId: null,
      pendingObjectiveId: null,
      points: basePoints,
      error: 'invalid_objective_lifecycle',
    },
  ];

  for (const fixture of cases) {
    const normalized = normalizeObjectivePresentation({
      activeObjectiveId: fixture.activeObjectiveId,
      pendingObjectiveId: fixture.pendingObjectiveId,
      objectives: fixture.points,
      objective: { owner: 1, sealed: false },
      players: [{ id: 'stale', alive: true, onObjectiveId: 'ami', onPoint: true }],
    }, flashpointMap);

    assert.equal(normalized.valid, false, fixture.name);
    assert.equal(normalized.errors.includes(fixture.error), true, fixture.name);
    assert.equal(normalized.activeObjectiveId, null, fixture.name);
    assert.equal(normalized.pendingObjectiveId, null, fixture.name);
    assert.equal(normalized.objective, null, fixture.name);
    assert.equal(normalized.objectiveById.size, 0, fixture.name);
    assert.equal(normalized.players[0].onPoint, false, fixture.name);
  }
});

test('a malformed new envelope never falls back to the legacy scalar objective', () => {
  const normalized = normalizeObjectivePresentation({
    activeObjectiveId: 'ami',
    pendingObjectiveId: null,
    objective: { sealed: false, owner: 1 },
    players: [{ id: 'stale', alive: true, onPoint: true }],
  }, flashpointMap);

  assert.equal(normalized.valid, false);
  assert.equal(normalized.legacy, false);
  assert.equal(normalized.errors.includes('invalid_objectives'), true);
  assert.equal(normalized.activeObjectiveId, null);
  assert.equal(normalized.objective, null);
  assert.deepEqual(normalized.objectives, []);
  assert.equal(normalized.players[0].onPoint, false);
});

test('legacy mode requires a scalar objective record', () => {
  for (const objective of [undefined, null, 42, []]) {
    const normalized = normalizeObjectivePresentation({
      objective,
      players: [{ id: 'stale', alive: true, onPoint: true }],
    }, flashpointMap);

    assert.equal(normalized.valid, false, `objective=${String(objective)}`);
    assert.equal(normalized.errors.includes('invalid_legacy_objective'), true);
    assert.equal(normalized.activeObjectiveId, null);
    assert.equal(normalized.objective, null);
    assert.equal(normalized.players[0].onPoint, false);
  }
});

test('a 3-0 terminal snapshot may leave unused sites locked while clearing the active projection', () => {
  const normalized = normalizeObjectivePresentation({
    lifecycle: 'complete',
    activeObjectiveId: null,
    pendingObjectiveId: null,
    siteScores: [3, 0],
    winnerTeam: 0,
    objectives: flashpointMap.objectives.map((definition, index) => ({
      id: definition.id,
      activation: index < 3 ? 'resolved' : 'locked',
      result: index < 3 ? { winner: 0 } : null,
    })),
    objective: { objectiveId: 'kado', owner: 0, state: 'complete' },
    players: [{ id: 'old-site', alive: true, onObjectiveId: 'kado', onPoint: true }],
  }, flashpointMap);

  assert.equal(normalized.valid, true);
  assert.equal(normalized.legacy, false);
  assert.equal(normalized.activeObjectiveId, null);
  assert.equal(normalized.pendingObjectiveId, null);
  assert.equal(normalized.objective, null);
  assert.equal(normalized.objectives.filter(point => point.isActive).length, 0);
  assert.deepEqual(
    [normalized.players[0].onObjectiveId, normalized.players[0].onPoint],
    ['kado', false],
  );
});

test('transition snapshots expose only the pending marker and clear the legacy active view', () => {
  const normalized = normalizeObjectivePresentation({
    lifecycle: 'transition',
    activeObjectiveId: null,
    pendingObjectiveId: 'mizuichi',
    objectives: flashpointMap.objectives.map(definition => ({
      id: definition.id,
      activation: definition.id === 'shiogama' ? 'resolved' : 'locked',
    })),
    objective: { objectiveId: 'shiogama', owner: 0, state: 'complete' },
    players: [{ id: 'moving', alive: true, onObjectiveId: 'shiogama', onPoint: true }],
  }, flashpointMap);

  assert.equal(normalized.valid, true);
  assert.equal(normalized.activeObjectiveId, null);
  assert.equal(normalized.pendingObjectiveId, 'mizuichi');
  assert.equal(normalized.objective, null);
  assert.equal(normalized.objectives.filter(point => point.isActive).length, 0);
  assert.equal(normalized.objectiveById.get('mizuichi').isPending, true);
  assert.deepEqual(
    [normalized.players[0].onObjectiveId, normalized.players[0].onPoint],
    ['shiogama', false],
  );
});

test('malformed snapshot roots and player collections fail closed instead of throwing', () => {
  const fixtures = [
    null,
    42,
    [],
    { objective: { sealed: true }, players: {} },
    { objective: { sealed: true }, players: [null] },
  ];

  for (const fixture of fixtures) {
    const normalized = normalizeObjectivePresentation(fixture, flashpointMap);
    assert.equal(normalized.valid, false);
    assert.equal(normalized.objective, null);
    assert.deepEqual(normalized.players, []);
  }
});

test('a real Flashpoint World transition snapshot reaches the client as pending-only', () => {
  const map = buildMap();
  const world = new World(map, structuredClone(FLASHPOINT_MODE), COMBAT, 20260729);
  world.flow.state = 'ACTIVE';
  world.flow.stateT = 0;
  world.objective.unseal();
  world.drainEvents();

  world.objective.win(0, 'client_contract_test', world.events);
  world.tick();
  const snapshot = world.snapshot();
  const normalized = normalizeObjectivePresentation(snapshot, map);

  assert.equal(snapshot.flashpoint.lifecycle, 'transition');
  assert.equal(snapshot.activeObjectiveId, null);
  assert.ok(snapshot.pendingObjectiveId);
  assert.equal(normalized.valid, true);
  assert.equal(normalized.activeObjectiveId, null);
  assert.equal(normalized.pendingObjectiveId, snapshot.pendingObjectiveId);
  assert.equal(normalized.objective, null);
  assert.equal(normalized.objectives.length, 5);
  assert.equal(normalized.objectiveById.get(snapshot.pendingObjectiveId).isPending, true);
});
