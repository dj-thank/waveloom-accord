import { buildMap } from '../shared/data/map_oshioi.js';
import { buildOshioiFlashpointGeometry } from '../shared/data/map_oshioi_flashpoint_geometry.js';
import { Collider } from '../shared/sim/collision.js';
import { canTraverseGroundSegment } from '../server/bot_navigation.js';
import { COMBAT } from '../tests/helpers.js';

const map = buildMap();
const fp = buildOshioiFlashpointGeometry();
const collider = new Collider(map.solids);
const world = { map, collider, mv: COMBAT.movement, combat: COMBAT };

let unsafe = 0;
let total = 0;
for (const site of fp.sites) {
  for (const side of ['east', 'west']) {
    for (const lane of ['front', 'cloister', 'shallows']) {
      const route = fp.routesBySite[site.id]?.[side]?.[lane];
      if (!route) continue;
      total += 1;
      for (let i = 1; i < route.points.length; i++) {
        if (!canTraverseGroundSegment(world, route.points[i - 1], route.points[i])) {
          unsafe += 1;
          console.log(`UNSAFE ${route.id} @${i - 1}->${i}`,
            JSON.stringify(route.points[i - 1]), '->', JSON.stringify(route.points[i]));
        }
      }
    }
  }
}
let highUnsafe = 0;
for (const site of fp.sites) {
  for (const route of Object.values(fp.highGroundRoutesBySite[site.id] || {})) {
    for (let i = 1; i < route.points.length; i++) {
      if (!canTraverseGroundSegment(world, route.points[i - 1], route.points[i])) {
        highUnsafe += 1;
        console.log(`UNSAFE-HIGH ${route.id} @${i - 1}->${i}`);
      }
    }
  }
}
console.log(`routes ${total} / unsafe segments ${unsafe} / high unsafe ${highUnsafe}`);
console.log('solids', map.solids.length);
