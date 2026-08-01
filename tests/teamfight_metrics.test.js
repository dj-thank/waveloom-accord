import test from 'node:test';
import assert from 'node:assert/strict';
import {
  captureTeamfightSnapshot,
  TeamfightMetrics,
  aggregateTeamfightMetrics,
  heroProvidesSustain,
} from '../shared/telemetry/teamfight_metrics.js';
import { HERO_BY_ID } from '../shared/data/heroes.js';

function player(id, team, role, heroId, pos = [0, 0, 0]) {
  return {
    id,
    team,
    role,
    heroId,
    alive: true,
    insideObjective: true,
    flags: { invulnerable: false, intangible: false },
    move: { pos: [...pos] },
    input: { f: false, b: false, l: false, r: false },
  };
}

function world(players, t, state = 'ACTIVE') {
  return {
    t,
    dt: 1,
    flow: { state },
    map: { objective: { center: [0, 0, 0] } },
    players: new Map(players.map(candidate => [candidate.id, candidate])),
  };
}

function controller(candidate, mode = 'fight', route = 'front') {
  return { pl: candidate, mode, route };
}

function fullTeams() {
  return [
    player('f0', 0, 'frontline', 'zairu'),
    player('d0', 0, 'damage', 'asagi'),
    player('d0b', 0, 'damage', 'shirasagi'),
    player('s0', 0, 'support', 'tsuzuri'),
    player('u0', 0, 'support', 'karakasa'),
    player('f1', 1, 'frontline', 'baraga'),
    player('d1', 1, 'damage', 'tsubakuro'),
    player('d1b', 1, 'damage', 'hokuchi'),
    player('s1', 1, 'support', 'hibari'),
    player('u1', 1, 'support', 'shirabe'),
  ];
}

test('frontline sustain requires the canonical continuous-healer tag', () => {
  assert.equal(heroProvidesSustain(HERO_BY_ID.tsuzuri), true);
  assert.equal(heroProvidesSustain(HERO_BY_ID.koyomi), false);
  assert.equal(heroProvidesSustain(HERO_BY_ID.hibari), true);
  assert.equal(heroProvidesSustain(HERO_BY_ID.kazura), false);
  assert.equal(heroProvidesSustain(HERO_BY_ID.karakasa), false);
  assert.equal(heroProvidesSustain(HERO_BY_ID.shirabe), false);
});

test('all frontlines remain visible in the report when one team receives zero healing', () => {
  const players = fullTeams();
  const metrics = new TeamfightMetrics();
  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 25 }],
    dt: 1,
  });
  const result = metrics.summary();
  assert.equal(result.frontlineHealing.f0.amount, 25);
  assert.equal(result.frontlineHealing.f0.windows.length, 1);
  assert.equal(result.frontlineHealing.f0.atFrontAmount, 25);
  assert.equal(result.frontlineHealing.f0.atFrontWindows.length, 1);
  assert.equal(result.frontlineHealing.f1.amount, 0);
  assert.equal(result.frontlineHealing.f1.windows.length, 0);
  assert.deepEqual(result.frontlineHealingByTeam.map(team => team.amount), [25, 0]);
});

test('one continuous front-recovery window reports its real duration instead of looking like one pulse', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics();
  for (const t of [1, 4, 7, 9]) {
    metrics.observe({
      world: world(players, t),
      controllers,
      events: [{ type: 'heal', source: 's0', target: 'f0', amount: 30 }],
      dt: 1,
    });
  }

  const result = metrics.summary();
  assert.equal(result.pressureAnchorHealing.f0.atFrontWindows.length, 1);
  assert.equal(result.pressureAnchorHealing.f0.atFrontWindows[0].durationSec, 8);
  assert.equal(result.pressureAnchorHealingByTeam[0].longestAtFrontWindowSec, 8);
  assert.equal(result.pressureAnchorHealingByTeam[0].atFrontActiveSec, 8);
});

test('damage recovery provider Asagi can heal the selected support pressure anchor', () => {
  const players = [
    player('anchor0', 0, 'support', 'karakasa'),
    player('asagi0', 0, 'damage', 'asagi', [2, 0, 0]),
    player('f1', 1, 'frontline', 'baraga'),
    player('s1', 1, 'support', 'hibari'),
  ];
  const metrics = new TeamfightMetrics();

  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [{ type: 'heal', source: 'asagi0', target: 'anchor0', amount: 35 }],
    dt: 1,
  });

  const result = metrics.summary();
  assert.deepEqual({
    amount: result.pressureAnchorHealing.anchor0.amount,
    atFrontAmount: result.pressureAnchorHealing.anchor0.atFrontAmount,
    byTeamAmount: result.pressureAnchorHealingByTeam[0].amount,
    pressureAnchors: result.pressureAnchorHealingByTeam[0].pressureAnchors,
    compatibilityAmount: result.frontlineHealing.anchor0.amount,
    anchorId: result.objective.timeline[0].pressureAnchorIds[0],
    providerId: result.objective.timeline[0].recoveryProviderIds[0],
  }, {
    amount: 35,
    atFrontAmount: 35,
    byTeamAmount: 35,
    pressureAnchors: ['anchor0'],
    compatibilityAmount: 35,
    anchorId: 'anchor0',
    providerId: 'asagi0',
  });
});

test('healing a tank away from the contested front does not satisfy frontline sustain', () => {
  const players = fullTeams();
  players.find(candidate => candidate.id === 'f0').move.pos = [40, 0, 0];
  players.find(candidate => candidate.id === 'u0').move.pos = [40, 0, 0];
  const metrics = new TeamfightMetrics({ nearObjectiveM: 18 });
  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 25 }],
    dt: 1,
  });
  const result = metrics.summary();
  assert.equal(result.frontlineHealing.f0.amount, 25);
  assert.equal(result.frontlineHealing.f0.atFrontAmount, 0);
  assert.equal(result.frontlineHealing.f0.atFrontWindows.length, 0);
});

test('pressure-anchor healing rejects PREP, ghosts, cross-team, non-anchor, invalid amounts, and dead participants', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics();

  metrics.observe({
    world: world(players, 1, 'PREP'),
    controllers,
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 10 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [
      { type: 'heal', source: 'ghost', target: 'f0', amount: 20 },
      { type: 'heal', source: 's1', target: 'f0', amount: 40 },
      { type: 'heal', source: 's0', target: 'd0', amount: 50 },
      { type: 'heal', source: 's0', target: 'f0', amount: 0 },
      { type: 'heal', source: 's0', target: 'f0', amount: Infinity },
    ],
    dt: 1,
  });

  players.find(candidate => candidate.id === 's0').alive = false;
  metrics.observe({
    world: world(players, 3),
    controllers,
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 60 }],
    dt: 1,
  });

  players.find(candidate => candidate.id === 's0').alive = true;
  players.find(candidate => candidate.id === 'f0').alive = false;
  metrics.observe({
    world: world(players, 4),
    controllers,
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 70 }],
    dt: 1,
  });

  players.find(candidate => candidate.id === 'f0').alive = true;
  metrics.observe({
    world: world(players, 5),
    controllers,
    events: [{ type: 'heal', source: 's0', target: 'f0', amount: 25 }],
    dt: 1,
  });

  assert.deepEqual(metrics.summary().pressureAnchorHealing.f0, {
    playerId: 'f0',
    team: 0,
    heroId: 'zairu',
    amount: 25,
    windows: [{ start: 5, end: 5, durationSec: 0, amount: 25 }],
    atFrontAmount: 25,
    atFrontWindows: [{ start: 5, end: 5, durationSec: 0, amount: 25 }],
  });
});

test('objective duration rejects PREP, invulnerable, and vertically distant actors', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ nearObjectiveM: 18 });

  metrics.observe({ world: world(players, 1, 'PREP'), controllers, events: [], dt: 1 });

  for (const candidate of players.filter(candidate => candidate.team === 0)) {
    candidate.flags.invulnerable = true;
  }
  metrics.observe({ world: world(players, 2), controllers, events: [], dt: 1 });

  for (const candidate of players.filter(candidate => candidate.team === 0)) {
    candidate.flags.invulnerable = false;
    candidate.move.pos = [0, 0, 100];
  }
  metrics.observe({ world: world(players, 3), controllers, events: [], dt: 1 });

  for (const candidate of players.filter(candidate => candidate.team === 0)) {
    candidate.move.pos = [0, 0, 0];
  }
  metrics.observe({ world: world(players, 4), controllers, events: [], dt: 1 });

  const result = metrics.summary();
  assert.deepEqual({
    twoSidedNearObjectiveSec: result.objective.twoSidedNearObjectiveSec,
    frontlineNearObjectiveSec: result.objective.frontlineNearObjectiveSec,
    nearObjectiveSec: result.teamPresence.nearObjectiveSec,
    teamZeroNearByTick: result.objective.timeline.map(tick => tick.near[0]),
  }, {
    twoSidedNearObjectiveSec: 1,
    frontlineNearObjectiveSec: [1, 3],
    nearObjectiveSec: [1, 3],
    teamZeroNearByTick: [5, 0, 0, 5],
  });
});

test('one joint engagement records role participation for both teams', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });
  metrics.observe({
    world: world(players, 1),
    controllers,
    events: [
      { type: 'shot', source: 'd0' },
      { type: 'hit', source: 'd0', target: 'f1', amount: 5 },
      { type: 'ability_used', player: 'f0', slot: 'ability1' },
      { type: 'heal', source: 's0', target: 'f0', amount: 10 },
      { type: 'shot', source: 'd1' },
      { type: 'hit', source: 'd1', target: 'f0', amount: 5 },
      { type: 'ability_used', player: 'f1', slot: 'ability1' },
      { type: 'heal', source: 's1', target: 'f1', amount: 10 },
    ],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 4),
    controllers,
    events: [],
    dt: 1,
  });
  const result = metrics.summary();
  assert.equal(result.engagements.length, 1);
  assert.deepEqual(result.engagements[0].fullRoleParticipationByTeam, [true, true]);
  assert.deepEqual(result.engagements[0].primaryEventsByTeam, [1, 1]);
  assert.equal(result.engagementSummary.fullRoleParticipationCount, 1);
  assert.equal(result.objective.twoSidedNearObjectiveSec, 2);
});

test('one-sided hostile contact does not qualify as a resolved teamfight', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });

  metrics.observe({
    world: world(players, 1),
    controllers,
    events: [
      ...Array.from({ length: 8 }, () => (
        { type: 'hit', source: 'd0', target: 'f1', amount: 5 }
      )),
      { type: 'ability_used', player: 'f0', slot: 'ability1' },
      { type: 'heal', source: 's0', target: 'f0', amount: 10 },
      { type: 'shot', source: 'd1' },
      { type: 'ability_used', player: 'f1', slot: 'ability1' },
      { type: 'heal', source: 's1', target: 'f1', amount: 10 },
    ],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });
  metrics.observe({ world: world(players, 5), controllers, events: [], dt: 1 });

  const result = metrics.summary();
  assert.deepEqual({
    hostileEventsByTeam: result.engagements[0].hostileEventsByTeam,
    bilateralHostileContact: result.engagements[0].bilateralHostileContact,
    fullRoleParticipationByTeam: result.engagements[0].fullRoleParticipationByTeam,
    fullRoleParticipationCount: result.engagementSummary.fullRoleParticipationCount,
    resolvedTeamfightCount: result.engagementSummary.resolvedTeamfightCount,
  }, {
    hostileEventsByTeam: [9, 0],
    bilateralHostileContact: false,
    fullRoleParticipationByTeam: [true, true],
    fullRoleParticipationCount: 1,
    resolvedTeamfightCount: 0,
  });
});

test('a living space-capable damage anchor can start an engagement while its tank is dead', () => {
  const deadTank = player('f0', 0, 'frontline', 'zairu');
  deadTank.alive = false;
  const players = [
    deadTank,
    player('d0', 0, 'damage', 'botan'),
    player('s0', 0, 'support', 'tsuzuri'),
    player('f1', 1, 'frontline', 'baraga'),
    player('d1', 1, 'damage', 'asagi'),
    player('s1', 1, 'support', 'hibari'),
  ];
  const metrics = new TeamfightMetrics();

  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });

  assert.equal(metrics.summary().engagements.length, 1);
});

test('two-sided objective contest follows effective pressure anchors and reports compatibility aliases', () => {
  const deadTank = player('f0', 0, 'frontline', 'zairu');
  deadTank.alive = false;
  const players = [
    deadTank,
    player('d0', 0, 'damage', 'botan'),
    player('d0b', 0, 'damage', 'asagi'),
    player('s0', 0, 'support', 'tsuzuri'),
    player('f1', 1, 'frontline', 'baraga'),
    player('d1', 1, 'damage', 'asagi'),
    player('s1', 1, 'support', 'hibari'),
  ];
  const metrics = new TeamfightMetrics();

  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [],
    dt: 1,
  });

  const result = metrics.summary();
  assert.deepEqual({
    twoSidedNearObjectiveSec: result.objective.twoSidedNearObjectiveSec,
    pressureAnchorNearObjectiveSec: result.objective.pressureAnchorNearObjectiveSec,
    frontlineNearObjectiveSec: result.objective.frontlineNearObjectiveSec,
    pressureAnchorIds: result.objective.timeline[0].pressureAnchorIds,
  }, {
    twoSidedNearObjectiveSec: 1,
    pressureAnchorNearObjectiveSec: [1, 1],
    frontlineNearObjectiveSec: [1, 1],
    pressureAnchorIds: ['d0', 'f1'],
  });
});

test('only ACTIVE contact with a validated enemy barrier can start or extend a fight', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });

  metrics.observe({
    world: world(players, 1, 'PREP'),
    controllers,
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [{ type: 'barrier_hit', source: 'd0', barrier: 'missing', amount: 5 }],
    dt: 1,
  });
  const friendlyBarrierWorld = world(players, 3);
  friendlyBarrierWorld.barriers = [{ id: 'friendly', ownerId: 'f0', team: 0 }];
  metrics.observe({
    world: friendlyBarrierWorld,
    controllers,
    events: [{ type: 'barrier_hit', source: 'd0', barrier: 'friendly', amount: 5 }],
    dt: 1,
  });
  const enemyBarrierWorld = world(players, 4);
  enemyBarrierWorld.barriers = [{ id: 'enemy', ownerId: 'f1', team: 1 }];
  metrics.observe({
    world: enemyBarrierWorld,
    controllers,
    events: [{ type: 'barrier_hit', source: 'd0', barrier: 'enemy', amount: 5 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 5),
    controllers,
    events: [{ type: 'hit', source: 'd1', target: 'f0', amount: 5 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 7),
    controllers,
    events: [{ type: 'barrier_hit', source: 'd0', barrier: 'missing', amount: 5 }],
    dt: 1,
  });
  metrics.observe({ world: world(players, 8), controllers, events: [], dt: 1 });

  const result = metrics.summary();
  assert.deepEqual(result.engagements.map(engagement => ({
    start: engagement.start,
    end: engagement.end,
    durationSec: engagement.durationSec,
    eventCount: engagement.eventCount,
    hostileEventsByTeam: engagement.hostileEventsByTeam,
    bilateralHostileContact: engagement.bilateralHostileContact,
  })), [{
    start: 4,
    end: 5,
    durationSec: 1,
    eventCount: 2,
    hostileEventsByTeam: [1, 1],
    bilateralHostileContact: true,
  }]);
});

test('engagement counts and kills ignore unknown actors and invalid enemy targets', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });

  metrics.observe({
    world: world(players, 1),
    controllers,
    events: [
      { type: 'hit', source: 'd0', target: 'f1', amount: 5 },
      { type: 'ability_used', player: 'ghost', slot: 'ability1' },
      { type: 'heal', source: 'ghost', target: 'f0', amount: 999 },
      { type: 'hit', source: 'd0', target: 's0', amount: 5 },
      { type: 'kill', source: 'd0', target: 's0' },
      { type: 'kill', source: 'd0', target: 'ghost' },
      { type: 'shot', source: 'd0' },
    ],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [{ type: 'kill', source: 'd1', target: 'd0' }],
    dt: 1,
  });
  metrics.observe({ world: world(players, 5), controllers, events: [], dt: 1 });

  const [engagement] = metrics.summary().engagements;
  assert.deepEqual({
    eventCount: engagement.eventCount,
    roleEventCountsByTeam: engagement.roleEventCountsByTeam,
    roleParticipantsByTeam: engagement.roleParticipantsByTeam,
    killsByTeam: engagement.killsByTeam,
    deathsByTeam: engagement.deathsByTeam,
    firstCasualtyAt: engagement.firstCasualtyAt,
  }, {
    eventCount: 3,
    roleEventCountsByTeam: [
      { frontline: 0, damage: 2, support: 0, unknown: 0 },
      { frontline: 0, damage: 1, support: 0, unknown: 0 },
    ],
    roleParticipantsByTeam: [
      { frontline: [], damage: ['d0'], support: [], unknown: [] },
      { frontline: [], damage: ['d1'], support: [], unknown: [] },
    ],
    killsByTeam: [0, 1],
    deathsByTeam: [1, 0],
    firstCasualtyAt: 2,
  });
});

test('a trade after first casualty stays in one fight while regroup healing cannot extend it', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });
  metrics.observe({
    world: world(players, 1),
    controllers,
    events: [
      { type: 'shot', source: 'd0' },
      { type: 'hit', source: 'd0', target: 'f1', amount: 5 },
      { type: 'shot', source: 'd1' },
      { type: 'hit', source: 'd1', target: 'f0', amount: 5 },
    ],
    dt: 1,
  });
  players.find(candidate => candidate.id === 'd0').alive = false;
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [{ type: 'kill', source: 'd1', target: 'd0' }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 3),
    controllers,
    events: [{ type: 'heal', source: 's1', target: 'f1', amount: 30 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 4),
    controllers,
    events: [{ type: 'shot', source: 'd0b' }, { type: 'hit', source: 'd0b', target: 'f1', amount: 20 }],
    dt: 1,
  });
  metrics.observe({ world: world(players, 7), controllers, events: [], dt: 1 });

  const [engagement] = metrics.summary().engagements;
  assert.equal(engagement.endReason, 'inactivity');
  assert.equal(engagement.durationSec, 3);
  assert.equal(engagement.timeToFirstCasualtySec, 1);
  assert.equal(engagement.postFirstCasualtySec, 2);
  assert.deepEqual(engagement.killsByTeam, [0, 1]);
});

test('a first-contact lethal uses the pre-tick roster and assigns the wipe kill before closing', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const before = captureTeamfightSnapshot(world(players, 0));
  for (const candidate of players.filter(candidate => candidate.team === 1)) {
    candidate.alive = false;
  }
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });

  metrics.observe({
    world: world(players, 1),
    preTickSnapshot: before,
    controllers,
    events: [{ type: 'kill', source: 'd0', target: 'f1' }],
    dt: 1,
  });

  const result = metrics.summary();
  assert.equal(result.engagements.length, 1);
  assert.deepEqual({
    engagementId: result.engagements[0].engagementId,
    endReason: result.engagements[0].endReason,
    killsByTeam: result.engagements[0].killsByTeam,
    lastHostileAt: result.engagements[0].lastHostileAt,
    closedAt: result.engagements[0].closedAt,
    contactSpanSec: result.engagements[0].contactSpanSec,
    trackerOpenSec: result.engagements[0].trackerOpenSec,
  }, {
    engagementId: 'engagement-1',
    endReason: 'team_wipe',
    killsByTeam: [1, 0],
    lastHostileAt: 1,
    closedAt: 1,
    contactSpanSec: 0,
    trackerOpenSec: 0,
  });
  assert.deepEqual(result.killAttributions, [{
    killId: 'kill-1',
    t: 1,
    source: 'd0',
    target: 'f1',
    sourceTeam: 0,
    targetTeam: 1,
    engagementId: 'engagement-1',
    outsideReason: null,
  }]);
});

test('all resolved contact spans retain a zero-span wipe in their distribution and median', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const beforeWipe = captureTeamfightSnapshot(world(players, 0));
  const metrics = new TeamfightMetrics({ engagementGapSec: 20 });

  for (const candidate of players.filter(candidate => candidate.team === 1)) {
    candidate.alive = false;
  }
  metrics.observe({
    world: world(players, 1),
    preTickSnapshot: beforeWipe,
    controllers,
    events: [{ type: 'kill', source: 'd0', target: 'f1' }],
    dt: 1,
  });

  for (const candidate of players.filter(candidate => candidate.team === 1)) {
    candidate.alive = true;
  }
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 12),
    controllers,
    events: [{ type: 'hit', source: 'd1', target: 'f0', amount: 5 }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 13, 'ROUND_END'),
    controllers,
    events: [],
    dt: 1,
  });

  const result = metrics.summary();
  assert.deepEqual({
    engagementContactSpansSec: result.engagements.map(engagement => engagement.contactSpanSec),
    resolvedContactSpansSec: result.engagementSummary.resolvedContactSpansSec,
    medianResolvedContactSpanSec: result.engagementSummary.medianResolvedContactSpanSec,
    medianResolvedDurationSec: result.engagementSummary.medianResolvedDurationSec,
  }, {
    engagementContactSpansSec: [0, 10],
    resolvedContactSpansSec: [0, 10],
    medianResolvedContactSpanSec: 5,
    medianResolvedDurationSec: 5,
  });
});

test('events from the ACTIVE portion of a state-change tick are assigned before closing', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });
  metrics.observe({
    world: world(players, 1),
    preTickSnapshot: captureTeamfightSnapshot(world(players, 0)),
    controllers,
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });

  const beforeTransition = captureTeamfightSnapshot(world(players, 1));
  players.find(candidate => candidate.id === 'd1').alive = false;
  metrics.observe({
    world: world(players, 2, 'ROUND_END'),
    preTickSnapshot: beforeTransition,
    controllers,
    events: [
      { type: 'kill', source: 'd0', target: 'd1' },
      { type: 'round_end', round: 1, winner: 0 },
    ],
    dt: 1,
  });

  const result = metrics.summary();
  assert.deepEqual({
    endReason: result.engagements[0].endReason,
    killsByTeam: result.engagements[0].killsByTeam,
    lastHostileAt: result.engagements[0].lastHostileAt,
    closedAt: result.engagements[0].closedAt,
    contactSpanSec: result.engagements[0].contactSpanSec,
    trackerOpenSec: result.engagements[0].trackerOpenSec,
    globalKills: result.combatTotals.killsByTeam,
  }, {
    endReason: 'state_change',
    killsByTeam: [1, 0],
    lastHostileAt: 2,
    closedAt: 2,
    contactSpanSec: 1,
    trackerOpenSec: 1,
    globalKills: [1, 0],
  });
});

test('inactivity reports contact span separately from tracker-open time and bounds contest time', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics({ engagementGapSec: 2 });
  metrics.observe({
    world: world(players, 1),
    controllers,
    events: [{ type: 'hit', source: 'd0', target: 'f1', amount: 5 }],
    dt: 1,
  });
  for (const t of [2, 3, 4]) {
    metrics.observe({ world: world(players, t), controllers, events: [], dt: 1 });
  }

  const engagement = metrics.summary().engagements[0];
  assert.deepEqual({
    lastHostileAt: engagement.lastHostileAt,
    closedAt: engagement.closedAt,
    contactSpanSec: engagement.contactSpanSec,
    trackerOpenSec: engagement.trackerOpenSec,
    durationSec: engagement.durationSec,
    fullFrontlineContestSec: engagement.fullFrontlineContestSec,
  }, {
    lastHostileAt: 1,
    closedAt: 4,
    contactSpanSec: 0,
    trackerOpenSec: 3,
    durationSec: 0,
    fullFrontlineContestSec: 3,
  });
  assert.ok(engagement.fullFrontlineContestSec <= engagement.trackerOpenSec);
});

test('global combat totals count only known hostile ACTIVE kills, including outside engagements', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  const metrics = new TeamfightMetrics();
  players.find(candidate => candidate.id === 'f0').move.pos = [40, 0, 0];
  players.find(candidate => candidate.id === 'f1').move.pos = [-40, 0, 0];
  players.find(candidate => candidate.id === 'u0').move.pos = [40, 0, 0];
  players.find(candidate => candidate.id === 'd1').move.pos = [-40, 0, 0];

  metrics.observe({
    world: world(players, 1, 'PREP'),
    controllers,
    events: [{ type: 'kill', source: 'd0', target: 'd1' }],
    dt: 1,
  });
  metrics.observe({
    world: world(players, 2),
    controllers,
    events: [
      { type: 'kill', source: 'd0', target: 'd1' },
      { type: 'kill', source: 'ghost-source', target: 'd0' },
      { type: 'kill', source: 'd0', target: 'ghost-target' },
      { type: 'kill', source: 'd0', target: 's0' },
    ],
    dt: 1,
  });

  players.find(candidate => candidate.id === 'f0').move.pos = [0, 0, 0];
  players.find(candidate => candidate.id === 'f1').move.pos = [0, 0, 0];
  metrics.observe({
    world: world(players, 3),
    controllers,
    events: [{ type: 'kill', source: 'd1', target: 'd0' }],
    dt: 1,
  });

  assert.deepEqual(metrics.summary().combatTotals, {
    killsByTeam: [1, 1],
    deathsByTeam: [1, 1],
    engagementKillsByTeam: [0, 1],
    outsideEngagementKillsByTeam: [1, 0],
    attributionConsistent: true,
  });
  assert.deepEqual(metrics.summary().killAttributions.map(attribution => ({
    sourceTeam: attribution.sourceTeam,
    engagementId: attribution.engagementId,
    outsideReason: attribution.outsideReason,
  })), [
    { sourceTeam: 0, engagementId: null, outsideReason: 'joint_front_not_ready' },
    { sourceTeam: 1, engagementId: 'engagement-1', outsideReason: null },
  ]);
});

test('duplicate and reverse-order observations cannot double-count a valid kill', () => {
  const players = fullTeams();
  const controllers = players.map(candidate => controller(candidate));
  players.find(candidate => candidate.id === 'f0').move.pos = [40, 0, 0];
  players.find(candidate => candidate.id === 'f1').move.pos = [-40, 0, 0];
  const metrics = new TeamfightMetrics();
  const observation = {
    world: world(players, 2),
    controllers,
    events: [
      { type: 'kill', source: 'd0', target: 'd1' },
      { type: 'kill', source: 'd0', target: 'd1' },
    ],
    dt: 1,
  };

  metrics.observe(observation);
  metrics.observe(observation);
  metrics.observe({ ...observation, world: world(players, 1) });

  const result = metrics.summary();
  assert.deepEqual(result.combatTotals.killsByTeam, [1, 0]);
  assert.equal(result.killAttributions.length, 1);
  assert.deepEqual(result.observationIntegrity, {
    accepted: 1,
    preTickSnapshotsAccepted: 0,
    duplicateRejected: 1,
    reverseOrderRejected: 1,
    duplicateKillsRejected: 1,
  });
});

test('DPS route aggregates use the effective route and its own tank engagement state', () => {
  const players = fullTeams();
  const dps = players.find(candidate => candidate.id === 'd0');
  dps.input.f = true;
  const controllers = players.map(candidate => controller(
    candidate,
    candidate.id === 'f0' ? 'fight' : 'advance',
    candidate.id === 'd0' ? 'cloister' : 'front',
  ));
  const dpsController = controllers.find(candidate => candidate.pl.id === 'd0');
  dpsController.activeRouteName = () => 'front';
  const metrics = new TeamfightMetrics();
  metrics.observe({ world: world(players, 1), controllers, events: [], dt: 1 });
  controllers.find(candidate => candidate.pl.id === 'f0').mode = 'advance';
  dpsController.route = 'front';
  dpsController.activeRouteName = () => 'cloister';
  metrics.observe({ world: world(players, 2), controllers, events: [], dt: 1 });
  const record = metrics.summary().dps.d0;
  assert.deepEqual(record.activeSec, { front: 1, side: 1 });
  assert.deepEqual(record.duringTankEngagedSec, { front: 1, side: 0 });
  assert.deepEqual(record.outsideTankEngagedSec, { front: 0, side: 1 });
});

test('DPS engagement time and combat events follow a damage pressure anchor with tank aliases intact', () => {
  const deadTank = player('f0', 0, 'frontline', 'zairu');
  deadTank.alive = false;
  const anchor = player('anchor0', 0, 'damage', 'botan');
  const dps = player('d0', 0, 'damage', 'asagi');
  dps.input.f = true;
  const players = [
    deadTank,
    anchor,
    dps,
    player('f1', 1, 'frontline', 'baraga'),
    player('d1', 1, 'damage', 'shirasagi'),
  ];
  const metrics = new TeamfightMetrics();

  metrics.observe({
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [
      { type: 'shot', source: 'd0' },
      { type: 'hit', source: 'd0', target: 'f1', amount: 5 },
    ],
    dt: 1,
  });

  const record = metrics.summary().dps.d0;
  assert.deepEqual({
    duringAnchorEngagedSec: record.duringAnchorEngagedSec,
    outsideAnchorEngagedSec: record.outsideAnchorEngagedSec,
    duringTankEngagedSec: record.duringTankEngagedSec,
    outsideTankEngagedSec: record.outsideTankEngagedSec,
    combatEvents: record.combatEvents,
    offensiveEvents: record.offensiveEvents,
  }, {
    duringAnchorEngagedSec: { front: 1, side: 0 },
    outsideAnchorEngagedSec: { front: 0, side: 0 },
    duringTankEngagedSec: { front: 1, side: 0 },
    outsideTankEngagedSec: { front: 0, side: 0 },
    combatEvents: {
      duringAnchorEngaged: 2,
      outsideAnchorEngaged: 0,
      duringTankEngaged: 2,
      outsideTankEngaged: 0,
    },
    offensiveEvents: {
      duringAnchorEngaged: { shots: 1, hostileContacts: 1, damage: 5, total: 2 },
      outsideAnchorEngaged: { shots: 0, hostileContacts: 0, damage: 0, total: 0 },
      duringTankEngaged: { shots: 1, hostileContacts: 1, damage: 5, total: 2 },
      outsideTankEngaged: { shots: 0, hostileContacts: 0, damage: 0, total: 0 },
    },
  });
});

test('regroup exit with three living players is classified as staggered', () => {
  const players = fullTeams();
  players.find(candidate => candidate.id === 'd0b').alive = false;
  players.find(candidate => candidate.id === 'u0').alive = false;
  const tank = players.find(candidate => candidate.id === 'f0');
  const tankController = controller(tank, 'regroup');
  const metrics = new TeamfightMetrics();
  metrics.observe({ world: world(players, 1), controllers: [tankController], events: [], dt: 1 });
  tankController.mode = 'advance';
  metrics.observe({ world: world(players, 2), controllers: [tankController], events: [], dt: 1 });
  const result = metrics.summary();
  assert.equal(result.regroup.exits.length, 1);
  assert.equal(result.regroup.exits[0].alive, 3);
  assert.equal(result.regroup.exits[0].staggered, true);
});

test('pure aggregate remains deterministic', () => {
  const players = fullTeams();
  const observations = [{
    world: world(players, 1),
    controllers: players.map(candidate => controller(candidate)),
    events: [{ type: 'shot', source: 'd0' }, { type: 'shot', source: 'd1' }],
    dt: 1,
  }];
  assert.deepEqual(
    aggregateTeamfightMetrics(observations),
    aggregateTeamfightMetrics(observations),
  );
});

test('summary metadata cannot override the telemetry schema version', () => {
  const aggregate = aggregateTeamfightMetrics([], {
    meta: { schemaVersion: 'forged', runId: 'kept' },
  });
  assert.deepEqual({
    direct: new TeamfightMetrics().summary({ schemaVersion: 999 }).schemaVersion,
    aggregate: aggregate.schemaVersion,
    runId: aggregate.runId,
  }, {
    direct: 2,
    aggregate: 2,
    runId: 'kept',
  });
});
