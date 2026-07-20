# Competitive map authoring

The runtime map is compiled by `shared/data/map_blueprint.js`. The blueprint is
the only source of gameplay geometry: every box or stair primitive is emitted as
both an authoritative collider (`solids`) and a visible gameplay surface
(`presentationSolids`). An imported GLB cannot hide, replace, or add collision.

## Minimal blueprint

```js
import { compileMapBlueprint } from '../shared/data/map_blueprint.js';

export const arena = compileMapBlueprint({
  id: 'arena_id',
  displayName: 'Arena name',
  boundsM: { x: [-46, 46], y: [-34, 34] },
  killZ: -8,
  geometry: [
    { id: 'floor', kind: 'box', min: [-46, -34, -1], max: [46, 34, 0], tag: 'ground' },
    { id: 'east-cover', kind: 'box', min: [12, -2, 0], max: [14, 2, 2.2], tag: 'cover', mirror180: true },
    {
      id: 'east-stairs', kind: 'stairs', axis: 'x', from: 8, to: 12,
      cross: [-2, 2], z: [0, 4], steps: 8, tag: 'stair', mirror180: true,
    },
  ],
  objective: { center: [0, 0, 0], radiusM: 7, heightM: 5 },
  spawns: {
    east: [{ pos: [42, 0, 0], yaw: Math.PI }],
    west: [{ pos: [-42, 0, 0], yaw: 0 }],
  },
  routes: {
    front: [[42, 0, 0], [0, 0, 0]],
    cloister: [[42, 8, 0], [0, 8, 0], [0, 0, 0]],
    shallows: [[42, -8, 0], [0, -8, 0], [0, 0, 0]],
  },
  pickups: [],
  setupDoors: [],
  decorations: [
    { id: 'city-backdrop', assetId: 'cc0-city', collision: false },
  ],
});
```

`mirror180` expands a primitive around the map origin and appends `@rot180` to
the generated id. A decoration must explicitly set `collision:false`; the
compiler rejects ambiguous decorative collision.

## Frontline layout checklist

- Give the shared objective one readable main approach and at least two usable
  angle routes. A side route must reconnect; it must not be a trap or a route
  only a high-mobility hero can exit.
- Place hard cover so the Tank can advance one decision at a time. From each
  cover island, at least one retreat path should remain visible to Support.
- Avoid a single uninterrupted choke. The defending team should need to choose
  which angle to watch, while attackers should need to coordinate before
  crossing exposed space.
- Spawns face a valid route and land on a compiled floor. Neither a render mesh
  nor a hard-coded Z value can be treated as proof of ground.
- `killZ` is below all valid walkable surfaces. Crossing it is an environmental
  death handled by the server; it is never a teleport to an invented floor.

## External assets

External models and PBR materials are welcome after license admission. They are
presentation-only until their gameplay proxy is deliberately authored in
`geometry`. See `docs/ASSET_LICENSES.md` for the required provenance fields and
current bundle hashes.

## Required checks

1. `node --test tests/map_authoring.test.js`
2. Spawn overlap, ground snap, and route traversal tests.
3. Renderer test proving `presentationSolids` stays visible after all optional
   assets load or fail.
4. Browser screenshots from the same viewport before and after a map change.
5. A 10-player headless match and a real browser walk through all three routes.
