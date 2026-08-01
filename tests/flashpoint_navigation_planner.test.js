import test from 'node:test';
import assert from 'node:assert/strict';
import { planFlashpointNavigation } from '../server/flashpoint_navigation_planner.js';

function tacticalGoal(anchorId, preferredIntents = ['main']) {
  return {
    sites: {
      tidegate: {
        bySide: {
          east: {
            phases: {
              pressure: {
                duties: {
                  frontline: {
                    goalAnchorIds: [anchorId],
                    preferredIntents,
                  },
                },
              },
            },
          },
        },
      },
    },
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test('plans an authored route to the duty goal and carries the site epoch', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'front-goal', pos: [3, 0, 0] },
    ],
    edges: [{
      id: 'spawn-to-front',
      routeId: 'front-safe',
      from: 'spawn',
      to: 'front-goal',
      points: [[1, 0, 0], [2, 0, 0]],
      intent: 'main',
    }],
  };

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 7,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata: tacticalGoal('front-goal'),
  }), {
    status: 'ok',
    routeId: 'front-safe',
    goalAnchorId: 'front-goal',
    waypoints: [[1, 0, 0], [2, 0, 0], [3, 0, 0]],
    reason: 'route_planned',
    siteEpoch: 7,
  });
});

test('chooses the deterministic shortest safe route instead of edge insertion order', () => {
  const nodes = [
    { id: 'spawn', pos: [0, 0, 0] },
    { id: 'long-turn', pos: [0, 4, 0] },
    { id: 'short-turn', pos: [2, 0, 0] },
    { id: 'front-goal', pos: [4, 0, 0] },
  ];
  const edges = [
    { id: 'z-long-start', routeId: 'long-route', from: 'spawn', to: 'long-turn', intent: 'main' },
    { id: 'z-long-finish', routeId: 'long-route', from: 'long-turn', to: 'front-goal', intent: 'main' },
    { id: 'a-short-start', routeId: 'short-route', from: 'spawn', to: 'short-turn', intent: 'main' },
    { id: 'a-short-finish', routeId: 'short-route', from: 'short-turn', to: 'front-goal', intent: 'main' },
  ];
  const input = {
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 8,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    tacticalMetadata: tacticalGoal('front-goal'),
  };

  for (const orderedEdges of [edges, [...edges].reverse()]) {
    assert.deepEqual(planFlashpointNavigation({
      ...input,
      navigationGraph: { nodes, edges: orderedEdges },
    }), {
      status: 'ok',
      routeId: 'short-route',
      goalAnchorId: 'front-goal',
      waypoints: [[2, 0, 0], [4, 0, 0]],
      reason: 'route_planned',
      siteEpoch: 8,
    });
  }
});

test('honors the duty-authored intent preference before choosing distance', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'main-turn', pos: [2, 0, 0] },
      { id: 'off-angle-turn', pos: [0, 3, 0] },
      { id: 'damage-goal', pos: [4, 0, 0] },
    ],
    edges: [
      {
        id: 'main-start',
        routeId: 'main-route',
        from: 'spawn',
        to: 'main-turn',
        intent: 'main',
      },
      {
        id: 'main-finish',
        routeId: 'main-route',
        from: 'main-turn',
        to: 'damage-goal',
        intent: 'main',
      },
      {
        id: 'off-angle-start',
        routeId: 'off-angle-route',
        from: 'spawn',
        to: 'off-angle-turn',
        intent: 'off_angle',
      },
      {
        id: 'off-angle-finish',
        routeId: 'off-angle-route',
        from: 'off-angle-turn',
        to: 'damage-goal',
        intent: 'off_angle',
      },
    ],
  };
  const tacticalMetadata = tacticalGoal('damage-goal', ['off_angle', 'main']);
  tacticalMetadata.sites.tidegate.bySide.east.phases.pressure.duties.damage =
    tacticalMetadata.sites.tidegate.bySide.east.phases.pressure.duties.frontline;

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 9,
    side: 'east',
    duty: 'damage',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata,
  }), {
    status: 'ok',
    routeId: 'off-angle-route',
    goalAnchorId: 'damage-goal',
    waypoints: [[0, 3, 0], [4, 0, 0]],
    reason: 'route_planned',
    siteEpoch: 9,
  });
});

test('rejects unsafe edges and uses an alternate route when the primary edge is blocked', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'primary-turn', pos: [2, 0, 0] },
      { id: 'alternate-turn', pos: [2, 2, 0] },
      { id: 'front-goal', pos: [4, 0, 0] },
    ],
    edges: [
      {
        id: 'unsafe-shortcut',
        routeId: 'unsafe-shortcut',
        from: 'spawn',
        to: 'front-goal',
        intent: 'main',
        safe: false,
        cost: 0.25,
      },
      {
        id: 'primary-start',
        routeId: 'primary-route',
        from: 'spawn',
        to: 'primary-turn',
        intent: 'main',
        safe: true,
      },
      {
        id: 'primary-finish',
        routeId: 'primary-route',
        from: 'primary-turn',
        to: 'front-goal',
        intent: 'main',
        safe: true,
      },
      {
        id: 'alternate-start',
        routeId: 'alternate-route',
        from: 'spawn',
        to: 'alternate-turn',
        intent: 'main',
        safe: true,
      },
      {
        id: 'alternate-finish',
        routeId: 'alternate-route',
        from: 'alternate-turn',
        to: 'front-goal',
        intent: 'main',
        safe: true,
      },
    ],
  };
  const input = {
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 10,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    navigationGraph,
    tacticalMetadata: tacticalGoal('front-goal'),
  };

  assert.equal(planFlashpointNavigation({
    ...input,
    blockedEdgeIds: [],
  }).routeId, 'primary-route');

  assert.deepEqual(planFlashpointNavigation({
    ...input,
    blockedEdgeIds: ['primary-finish'],
  }), {
    status: 'ok',
    routeId: 'alternate-route',
    goalAnchorId: 'front-goal',
    waypoints: [[2, 2, 0], [4, 0, 0]],
    reason: 'route_planned',
    siteEpoch: 10,
  });
});

test('reports at_goal separately from an unreachable goal', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'front-goal', pos: [4, 1, 0] },
    ],
    edges: [{
      id: 'only-ingress',
      routeId: 'only-route',
      from: 'spawn',
      to: 'front-goal',
      intent: 'main',
    }],
  };
  const input = {
    activeSiteId: 'tidegate',
    siteEpoch: 11,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    navigationGraph,
    tacticalMetadata: tacticalGoal('front-goal'),
  };

  assert.deepEqual(planFlashpointNavigation({
    ...input,
    position: [4, 1, 0],
    blockedEdgeIds: [],
  }), {
    status: 'at_goal',
    routeId: null,
    goalAnchorId: 'front-goal',
    waypoints: [],
    reason: 'already_at_goal',
    siteEpoch: 11,
  });

  assert.deepEqual(planFlashpointNavigation({
    ...input,
    position: [0, 0, 0],
    blockedEdgeIds: ['only-ingress'],
  }), {
    status: 'unreachable',
    routeId: null,
    goalAnchorId: 'front-goal',
    waypoints: [],
    reason: 'no_safe_route',
    siteEpoch: 11,
  });
});

test('reports budget_exhausted when the bounded search cannot settle the goal', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'junction', pos: [1, 0, 0] },
      { id: 'front-goal', pos: [2, 0, 0] },
    ],
    edges: [
      {
        id: 'first',
        routeId: 'front-route',
        from: 'spawn',
        to: 'junction',
        intent: 'main',
      },
      {
        id: 'second',
        routeId: 'front-route',
        from: 'junction',
        to: 'front-goal',
        intent: 'main',
      },
    ],
  };

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 12,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    maxExpandedNodes: 1,
    navigationGraph,
    tacticalMetadata: tacticalGoal('front-goal'),
  }), {
    status: 'budget_exhausted',
    routeId: null,
    goalAnchorId: 'front-goal',
    waypoints: [],
    reason: 'search_budget_exhausted',
    siteEpoch: 12,
  });
});

test('uses the explicitly authored west goal without global-X inference or mirroring', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'east-goal', pos: [5, 0, 0] },
      { id: 'west-goal', pos: [3, 7, 0] },
    ],
    edges: [
      {
        id: 'east-authored-edge',
        routeId: 'east-authored',
        from: 'spawn',
        to: 'east-goal',
        intent: 'main',
      },
      {
        id: 'west-authored-edge',
        routeId: 'west-authored',
        from: 'spawn',
        to: 'west-goal',
        intent: 'main',
      },
    ],
  };
  const rule = goalAnchorId => ({
    phases: {
      pressure: {
        duties: {
          frontline: {
            goalAnchorIds: [goalAnchorId],
            preferredIntents: ['main'],
          },
        },
      },
    },
  });
  const tacticalMetadata = {
    sites: [{
      id: 'tidegate',
      tactical: {
        bySide: {
          east: rule('east-goal'),
          west: rule('west-goal'),
        },
      },
    }],
  };

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 13,
    side: 'west',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata,
  }), {
    status: 'ok',
    routeId: 'west-authored',
    goalAnchorId: 'west-goal',
    waypoints: [[3, 7, 0]],
    reason: 'route_planned',
    siteEpoch: 13,
  });
});

test('falls back to the next authored duty goal when the preferred anchor is unreachable', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'preferred-goal', pos: [4, 0, 0] },
      { id: 'fallback-goal', pos: [3, 2, 0] },
    ],
    edges: [{
      id: 'fallback-ingress',
      routeId: 'fallback-route',
      from: 'spawn',
      to: 'fallback-goal',
      intent: 'main',
    }],
  };
  const tacticalMetadata = tacticalGoal('preferred-goal');
  tacticalMetadata.sites.tidegate.bySide.east.phases.pressure
    .duties.frontline.goalAnchorIds.push('fallback-goal');

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 14,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata,
  }), {
    status: 'ok',
    routeId: 'fallback-route',
    goalAnchorId: 'fallback-goal',
    waypoints: [[3, 2, 0]],
    reason: 'route_planned',
    siteEpoch: 14,
  });
});

test('applies intent rank per path rather than penalizing a route for having more segments', () => {
  const navigationGraph = {
    nodes: [
      { id: 'spawn', pos: [0, 0, 0] },
      { id: 'main-a', pos: [1, 0, 0] },
      { id: 'main-b', pos: [2, 0, 0] },
      { id: 'damage-goal', pos: [3, 0, 0] },
    ],
    edges: [
      {
        id: 'main-1',
        routeId: 'segmented-main',
        from: 'spawn',
        to: 'main-a',
        intent: 'main',
      },
      {
        id: 'main-2',
        routeId: 'segmented-main',
        from: 'main-a',
        to: 'main-b',
        intent: 'main',
      },
      {
        id: 'main-3',
        routeId: 'segmented-main',
        from: 'main-b',
        to: 'damage-goal',
        intent: 'main',
      },
      {
        id: 'recovery-shortcut',
        routeId: 'recovery-shortcut',
        from: 'spawn',
        to: 'damage-goal',
        intent: 'recovery',
        cost: 0.5,
      },
    ],
  };
  const tacticalMetadata = tacticalGoal(
    'damage-goal',
    ['off_angle', 'main', 'recovery'],
  );

  assert.deepEqual(planFlashpointNavigation({
    position: [0, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 15,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata,
  }), {
    status: 'ok',
    routeId: 'segmented-main',
    goalAnchorId: 'damage-goal',
    waypoints: [[1, 0, 0], [2, 0, 0], [3, 0, 0]],
    reason: 'route_planned',
    siteEpoch: 15,
  });
});

test('supports explicit bidirectional edges and clones frozen position/waypoint data', () => {
  const navigationGraph = deepFreeze({
    nodes: [
      { id: 'front-goal', position: [0, 0, 0] },
      { id: 'spawn', position: [3, 0, 0] },
    ],
    edges: [{
      id: 'two-way-main',
      routeId: 'bidirectional-main',
      from: 'front-goal',
      to: 'spawn',
      waypoints: [[1, 1, 0], [2, 1, 0]],
      intent: 'main',
      bidirectional: true,
    }],
  });
  const before = JSON.stringify(navigationGraph);
  const result = planFlashpointNavigation({
    position: [3, 0, 0],
    activeSiteId: 'tidegate',
    siteEpoch: 16,
    side: 'east',
    duty: 'frontline',
    phase: 'pressure',
    blockedEdgeIds: [],
    navigationGraph,
    tacticalMetadata: tacticalGoal('front-goal'),
  });

  assert.deepEqual(result, {
    status: 'ok',
    routeId: 'bidirectional-main',
    goalAnchorId: 'front-goal',
    waypoints: [[2, 1, 0], [1, 1, 0], [0, 0, 0]],
    reason: 'route_planned',
    siteEpoch: 16,
  });
  assert.equal(JSON.stringify(navigationGraph), before);
  assert.notEqual(result.waypoints[0], navigationGraph.edges[0].waypoints[1]);
});
