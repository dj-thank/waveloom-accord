const AXES = Object.freeze({ x: 0, y: 1, z: 2 });

function invariant(condition, message) {
  if (!condition) throw new TypeError(`Invalid map blueprint: ${message}`);
}

function finiteNumber(value, label) {
  invariant(Number.isFinite(value), `${label} must be finite`);
  return Number(value);
}

function vector(value, length, label) {
  invariant(Array.isArray(value) && value.length === length, `${label} must contain ${length} numbers`);
  return value.map((entry, index) => finiteNumber(entry, `${label}[${index}]`));
}

function cloneBox(box) {
  return {
    id: box.id,
    min: [...box.min],
    max: [...box.max],
    tag: box.tag,
  };
}

function validateBox(entry, id = entry.id) {
  const min = vector(entry.min, 3, `${id}.min`);
  const max = vector(entry.max, 3, `${id}.max`);
  invariant(min.every((value, axis) => value < max[axis]), `${id} must have positive volume`);
  return { id, min, max, tag: String(entry.tag || 'solid') };
}

function rotate180(box) {
  return {
    id: `${box.id}@rot180`,
    min: [-box.max[0], -box.max[1], box.min[2]],
    max: [-box.min[0], -box.min[1], box.max[2]],
    tag: box.tag,
  };
}

function compileStairs(entry) {
  const axis = AXES[entry.axis];
  invariant(axis === 0 || axis === 1, `${entry.id}.axis must be x or y`);
  const from = finiteNumber(entry.from, `${entry.id}.from`);
  const to = finiteNumber(entry.to, `${entry.id}.to`);
  const cross = vector(entry.cross, 2, `${entry.id}.cross`);
  const z = vector(entry.z, 2, `${entry.id}.z`);
  invariant(cross[0] < cross[1], `${entry.id}.cross must be ascending`);
  invariant(Number.isSafeInteger(entry.steps) && entry.steps > 0, `${entry.id}.steps must be a positive integer`);

  const boxes = [];
  for (let index = 0; index < entry.steps; index++) {
    const start = from + ((to - from) * index) / entry.steps;
    const end = from + ((to - from) * (index + 1)) / entry.steps;
    const top = z[0] + ((z[1] - z[0]) * (index + 1)) / entry.steps;
    // A descending staircase that terminates at the shared base plane has no
    // final solid volume. Omitting that slice avoids a zero-thickness collider
    // while the surrounding floor remains the walkable landing.
    if (Math.abs(top) <= 1e-12) continue;
    const min = axis === 0
      ? [Math.min(start, end), cross[0], Math.min(0, top)]
      : [cross[0], Math.min(start, end), Math.min(0, top)];
    const max = axis === 0
      ? [Math.max(start, end), cross[1], Math.max(0, top)]
      : [cross[1], Math.max(start, end), Math.max(0, top)];
    boxes.push(validateBox({
      id: `${entry.id}@step-${index + 1}`,
      min,
      max,
      tag: entry.tag || 'stair',
    }));
  }
  return boxes;
}

function compileGeometryEntry(entry, index) {
  invariant(entry && typeof entry === 'object' && !Array.isArray(entry), `geometry[${index}] must be an object`);
  invariant(typeof entry.id === 'string' && entry.id.trim(), `geometry[${index}].id is required`);
  const compiled = entry.kind === 'stairs'
    ? compileStairs(entry)
    : [validateBox(entry)];
  invariant(entry.kind === 'box' || entry.kind === 'stairs', `${entry.id}.kind must be box or stairs`);
  if (!entry.mirror180) return compiled;
  return [...compiled, ...compiled.map(rotate180)];
}

function clonePoint(point, label) {
  return vector(point, 3, label);
}

function cloneRoutes(routes = {}) {
  invariant(routes && typeof routes === 'object' && !Array.isArray(routes), 'routes must be an object');
  return Object.fromEntries(Object.entries(routes).map(([id, points]) => {
    invariant(Array.isArray(points) && points.length > 0, `route ${id} must contain points`);
    return [id, points.map((point, index) => clonePoint(point, `routes.${id}[${index}]`))];
  }));
}

function cloneSpawns(spawns = {}) {
  invariant(spawns && typeof spawns === 'object' && !Array.isArray(spawns), 'spawns must be an object');
  return Object.fromEntries(Object.entries(spawns).map(([side, entries]) => {
    invariant(Array.isArray(entries) && entries.length > 0, `spawns.${side} must contain entries`);
    return [side, entries.map((spawn, index) => ({
      ...spawn,
      pos: clonePoint(spawn.pos, `spawns.${side}[${index}].pos`),
      yaw: finiteNumber(spawn.yaw, `spawns.${side}[${index}].yaw`),
    }))];
  }));
}

/**
 * Compile the editable authoring format into the runtime map contract.
 * Gameplay surfaces are emitted twice from the same primitives: once for the
 * authoritative collider and once for rendering. Imported assets stay purely
 * decorative unless their collision is authored as explicit geometry above.
 */
export function compileMapBlueprint(blueprint) {
  invariant(blueprint && typeof blueprint === 'object' && !Array.isArray(blueprint), 'root must be an object');
  invariant(typeof blueprint.id === 'string' && blueprint.id.trim(), 'id is required');
  invariant(typeof blueprint.displayName === 'string' && blueprint.displayName.trim(), 'displayName is required');
  invariant(Array.isArray(blueprint.geometry), 'geometry must be an array');

  const boundsX = vector(blueprint.boundsM?.x, 2, 'boundsM.x');
  const boundsY = vector(blueprint.boundsM?.y, 2, 'boundsM.y');
  invariant(boundsX[0] < boundsX[1] && boundsY[0] < boundsY[1], 'bounds must be ascending');

  const solids = blueprint.geometry.flatMap(compileGeometryEntry);
  const ids = new Set();
  for (const solid of solids) {
    invariant(!ids.has(solid.id), `duplicate geometry id ${solid.id}`);
    ids.add(solid.id);
  }

  const decorations = (blueprint.decorations || []).map((decoration, index) => {
    invariant(decoration && typeof decoration === 'object', `decorations[${index}] must be an object`);
    invariant(decoration.collision === false, `decoration ${decoration.id || index} must set collision:false`);
    return { ...decoration, collision: false };
  });

  return {
    ...blueprint,
    boundsM: { x: boundsX, y: boundsY },
    killZ: finiteNumber(blueprint.killZ ?? -12, 'killZ'),
    solids: solids.map(cloneBox),
    presentationSolids: solids.map(cloneBox),
    setupDoors: (blueprint.setupDoors || []).map((door, index) => validateBox({
      ...door,
      id: door.id || `setup-door-${index + 1}`,
    })),
    objective: blueprint.objective ? {
      ...blueprint.objective,
      center: clonePoint(blueprint.objective.center, 'objective.center'),
      radiusM: finiteNumber(blueprint.objective.radiusM, 'objective.radiusM'),
      heightM: finiteNumber(blueprint.objective.heightM, 'objective.heightM'),
    } : undefined,
    spawns: cloneSpawns(blueprint.spawns),
    routes: cloneRoutes(blueprint.routes),
    pickups: (blueprint.pickups || []).map((pickup, index) => ({
      ...pickup,
      pos: clonePoint(pickup.pos, `pickups[${index}].pos`),
    })),
    decorations,
    geometry: blueprint.geometry.map(entry => ({ ...entry })),
  };
}
