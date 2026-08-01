import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFlashpointBotRoute } from '../server/flashpoint_bot_route_adapter.js';

test('returns the explicitly authored east route for the active site', () => {
  const world = {
    map: {
      flashpoint: {
        runtime: {
          routesBySite: {
            tidegate: {
              east: {
                front: {
                  id: 'tidegate-east-front-runtime',
                  lane: 'front',
                  intent: 'main',
                  points: [[10, 1, 3], [2, 4, 3]],
                },
              },
            },
          },
        },
      },
    },
    sideOf: () => 'east',
    flashpointState: {
      lifecycle: 'active',
      activeSiteId: 'tidegate',
      pendingSiteId: null,
      activationIndex: 4,
      completedSiteIds: [],
    },
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 0, 'front'), {
    status: 'ok',
    reason: 'route_resolved',
    siteId: 'tidegate',
    siteEpoch: 'activation:4:tidegate',
    side: 'east',
    lane: 'front',
    routeId: 'tidegate-east-front-runtime',
    intent: 'main',
    points: [[10, 1, 3], [2, 4, 3]],
  });
});

test('uses explicit west coordinates without implicitly mirroring the east route', () => {
  const world = {
    map: {
      flashpoint: {
        routesBySite: {
          foundry: {
            east: {
              front: {
                id: 'foundry-east-front',
                lane: 'front',
                points: [[9, -7, 2], [1, -3, 2]],
              },
            },
            west: {
              front: {
                id: 'foundry-west-front',
                lane: 'front',
                intent: 'safe_recontest',
                points: [[-8, 6, 2], [-2, 5, 2]],
              },
            },
          },
        },
      },
    },
    sideOf: () => 'west',
    activeObjectiveId: 'foundry',
    pendingObjectiveId: null,
    completedSiteIds: [],
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 1, 'front'), {
    status: 'ok',
    reason: 'route_resolved',
    siteId: 'foundry',
    siteEpoch: 'completed:0:foundry',
    side: 'west',
    lane: 'front',
    routeId: 'foundry-west-front',
    intent: 'safe_recontest',
    points: [[-8, 6, 2], [-2, 5, 2]],
  });
});

test('plans to the pending site during transition', () => {
  const world = {
    map: {
      flashpoint: {
        runtime: {
          routesBySite: {
            garden: {
              east: {
                cloister: {
                  id: 'garden-east-cloister-runtime',
                  lane: 'cloister',
                  points: [[12, 8, 4], [3, 6, 4]],
                },
              },
            },
          },
        },
      },
    },
    sideOf: () => 'east',
    flashpointState: {
      lifecycle: 'transition',
      activeObjectiveId: null,
      pendingObjectiveId: 'garden',
      completedSiteIds: ['tidegate'],
      selectionIndex: 99,
    },
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 0, 'cloister'), {
    status: 'ok',
    reason: 'route_resolved',
    siteId: 'garden',
    siteEpoch: 'completed:1:garden',
    side: 'east',
    lane: 'cloister',
    routeId: 'garden-east-cloister-runtime',
    intent: null,
    points: [[12, 8, 4], [3, 6, 4]],
  });
});

test('changes route identity when the site changes', () => {
  const routesBySite = Object.fromEntries(['alpha', 'beta'].map(siteId => [
    siteId,
    {
      east: {
        front: {
          id: `${siteId}-east-front`,
          lane: 'front',
          points: [[1, 0, 0]],
        },
      },
    },
  ]));
  const base = {
    map: { flashpoint: { routesBySite } },
    sideOf: () => 'east',
  };

  const alpha = resolveFlashpointBotRoute({
    ...base,
    flashpointState: {
      activeSiteId: 'alpha',
      activationIndex: 7,
      completedSiteIds: [],
    },
  }, 0, 'front');
  const beta = resolveFlashpointBotRoute({
    ...base,
    flashpointState: {
      activeSiteId: 'beta',
      activationIndex: 7,
      completedSiteIds: [],
    },
  }, 0, 'front');

  assert.equal(alpha.siteEpoch, 'activation:7:alpha');
  assert.equal(beta.siteEpoch, 'activation:7:beta');
  assert.notEqual(alpha.siteEpoch, beta.siteEpoch);
  assert.notEqual(alpha.routeId, beta.routeId);
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

test('does not mutate frozen input and returns fresh cloned waypoints', () => {
  const world = deepFreeze({
    map: {
      flashpoint: {
        routesBySite: {
          tidegate: {
            east: {
              front: {
                id: 'immutable-route',
                lane: 'front',
                points: [[5, 4, 3], [2, 1, 0]],
              },
            },
          },
        },
      },
    },
    sideOf: () => 'east',
    flashpointState: {
      activeSiteId: 'tidegate',
      completedSiteIds: [],
    },
  });

  const first = resolveFlashpointBotRoute(world, 0, 'front');
  const second = resolveFlashpointBotRoute(world, 0, 'front');

  assert.notEqual(first.points, second.points);
  assert.notEqual(first.points[0], second.points[0]);
  assert.notEqual(first.points, world.map.flashpoint.routesBySite.tidegate.east.front.points);
  assert.notEqual(first.points[0], world.map.flashpoint.routesBySite.tidegate.east.front.points[0]);
  first.points[0][0] = 500;
  assert.deepEqual(second.points, [[5, 4, 3], [2, 1, 0]]);
  assert.deepEqual(
    world.map.flashpoint.routesBySite.tidegate.east.front.points,
    [[5, 4, 3], [2, 1, 0]],
  );
});

test('fails closed when the authoritative runtime route is unknown', () => {
  const world = {
    map: {
      flashpoint: {
        runtime: { routesBySite: {} },
        routesBySite: {
          tidegate: {
            east: {
              front: {
                id: 'must-not-fall-back',
                lane: 'front',
                points: [[1, 2, 3]],
              },
            },
          },
        },
      },
    },
    sideOf: () => 'east',
    flashpointState: {
      activeSiteId: 'tidegate',
      completedSiteIds: [],
    },
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 0, 'front'), {
    status: 'no_plan',
    reason: 'route_not_found',
    siteId: 'tidegate',
    siteEpoch: 'completed:0:tidegate',
    side: 'east',
    lane: 'front',
    routeId: null,
    intent: null,
    points: [],
  });
});

test('fails closed for complete state even if a stale active route remains', () => {
  const world = {
    map: {
      flashpoint: {
        routesBySite: {
          tidegate: {
            east: {
              front: {
                id: 'stale-route',
                lane: 'front',
                points: [[1, 2, 3]],
              },
            },
          },
        },
      },
    },
    sideOf: () => 'east',
    flashpointState: {
      lifecycle: 'complete',
      activeSiteId: 'tidegate',
      activationIndex: 5,
      completedSiteIds: ['tidegate'],
    },
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 0, 'front'), {
    status: 'no_plan',
    reason: 'match_complete',
    siteId: 'tidegate',
    siteEpoch: 'activation:5:tidegate',
    side: 'east',
    lane: 'front',
    routeId: null,
    intent: null,
    points: [],
  });
});

test('fails closed when an authored route is malformed', () => {
  const world = {
    map: {
      flashpoint: {
        routesBySite: {
          tidegate: {
            west: {
              shallows: {
                id: 'bad-route',
                lane: 'shallows',
                points: [[-1, 2, Number.NaN]],
              },
            },
          },
        },
      },
    },
    sideOf: () => 'west',
    flashpointState: {
      activeSiteId: 'tidegate',
      completedSiteIds: [],
    },
  };

  assert.deepEqual(resolveFlashpointBotRoute(world, 1, 'shallows'), {
    status: 'no_plan',
    reason: 'malformed_route',
    siteId: 'tidegate',
    siteEpoch: 'completed:0:tidegate',
    side: 'west',
    lane: 'shallows',
    routeId: null,
    intent: null,
    points: [],
  });
});
