export const LEGACY_OBJECTIVE_ID = 'legacy-objective';

const OBJECTIVE_ACTIVATIONS = new Set(['locked', 'active', 'resolved']);
const POINT_PRESENTATION_KEYS = new Set([
  'id',
  'activation',
  'definition',
  'isActive',
  'isPending',
  'objective',
  'result',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cloneValue(value) {
  if (Array.isArray(value)) return value.map(cloneValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [key, cloneValue(child)]),
  );
}

function legacyProjection(point) {
  if (point.objective && typeof point.objective === 'object') {
    return cloneValue(point.objective);
  }
  return Object.fromEntries(
    Object.entries(point)
      .filter(([key]) => !POINT_PRESENTATION_KEYS.has(key))
      .map(([key, value]) => [key, cloneValue(value)]),
  );
}

function clearPlayerMembership(players) {
  return (Array.isArray(players) ? players : []).filter(isRecord).map(player => ({
    ...player,
    onObjectiveId: null,
    onPoint: false,
  }));
}

function invalidPresentation(snapshot, errors) {
  return {
    ...snapshot,
    valid: false,
    legacy: false,
    errors,
    activeObjectiveId: null,
    pendingObjectiveId: null,
    objectives: [],
    objectiveById: new Map(),
    objective: null,
    players: clearPlayerMembership(snapshot.players),
  };
}

function hasTerminalEvidence(snapshot) {
  const lifecycle = snapshot.lifecycle ?? snapshot.flashpoint?.lifecycle;
  const siteScores = snapshot.siteScores ?? snapshot.flashpoint?.siteScores;
  const winnerTeam = snapshot.winnerTeam ?? snapshot.flashpoint?.winnerTeam;
  return (lifecycle === 'terminal' || lifecycle === 'complete')
    && (winnerTeam === 0 || winnerTeam === 1)
    && Array.isArray(siteScores)
    && Number.isInteger(siteScores[winnerTeam])
    && siteScores[winnerTeam] >= 3;
}

function normalizeFlashpoint(snapshot, map) {
  if (snapshot.objectives.length !== 5) {
    return invalidPresentation(snapshot, ['objective_count']);
  }
  const definitions = Array.isArray(map?.objectives) ? map.objectives : [];
  const definitionIds = definitions.map(definition => definition?.id);
  const mapIdsValid = definitions.length === 5
    && definitionIds.every(id => typeof id === 'string' && id.length > 0)
    && new Set(definitionIds).size === 5;
  if (!mapIdsValid) {
    return invalidPresentation(snapshot, ['invalid_map_objectives']);
  }
  const sourceIds = snapshot.objectives.map(point => point?.id);
  if (sourceIds.some(id => typeof id !== 'string' || id.length === 0)) {
    return invalidPresentation(snapshot, ['unknown_objective_id']);
  }
  if (new Set(sourceIds).size !== sourceIds.length) {
    return invalidPresentation(snapshot, ['duplicate_objective_id']);
  }
  const knownIds = new Set(definitionIds);
  if (sourceIds.some(id => !knownIds.has(id))) {
    return invalidPresentation(snapshot, ['unknown_objective_id']);
  }
  if (snapshot.objectives.some(point => !OBJECTIVE_ACTIVATIONS.has(point.activation))) {
    return invalidPresentation(snapshot, ['invalid_objective_activation']);
  }
  const sourceById = new Map(snapshot.objectives.map(point => [point.id, point]));
  const activeId = snapshot.activeObjectiveId;
  const pendingId = snapshot.pendingObjectiveId;
  if (activeId !== null && !knownIds.has(activeId)) {
    return invalidPresentation(snapshot, ['unknown_active_objective_id']);
  }
  if (pendingId !== null && !knownIds.has(pendingId)) {
    return invalidPresentation(snapshot, ['unknown_pending_objective_id']);
  }
  const activePoints = snapshot.objectives.filter(point => point.activation === 'active');
  const activeLifecycleValid = activeId === null
    ? activePoints.length === 0
    : pendingId === null
      && activePoints.length === 1
      && activePoints[0].id === activeId;
  const pendingLifecycleValid = pendingId === null
    ? activeId !== null
      || snapshot.objectives.every(point => point.activation === 'resolved')
      || hasTerminalEvidence(snapshot)
    : activeId === null && sourceById.get(pendingId)?.activation === 'locked';
  if (!activeLifecycleValid || !pendingLifecycleValid
    || (activeId !== null && activeId === pendingId)) {
    return invalidPresentation(snapshot, ['invalid_objective_lifecycle']);
  }
  const objectives = definitions.map(definition => {
    const source = sourceById.get(definition.id);
    return {
      ...cloneValue(source),
      definition,
      isActive: definition.id === snapshot.activeObjectiveId,
      isPending: definition.id === snapshot.pendingObjectiveId,
    };
  });
  const objectiveById = new Map(objectives.map(point => [point.id, point]));
  const active = objectiveById.get(snapshot.activeObjectiveId) || null;
  const players = (snapshot.players || []).map(player => {
    const onObjectiveId = player.alive !== false && knownIds.has(player.onObjectiveId)
      ? player.onObjectiveId
      : null;
    const onPoint = player.alive !== false
      && active !== null
      && onObjectiveId === snapshot.activeObjectiveId;
    return {
      ...player,
      onObjectiveId,
      onPoint,
    };
  });

  return {
    ...snapshot,
    valid: true,
    legacy: false,
    errors: [],
    objectives,
    objectiveById,
    objective: active ? legacyProjection(active) : null,
    players,
  };
}

export function normalizeObjectivePresentation(snapshot, map = {}) {
  if (!isRecord(snapshot)) {
    return invalidPresentation({}, ['invalid_snapshot']);
  }
  if (Object.hasOwn(snapshot, 'players')
    && (!Array.isArray(snapshot.players) || snapshot.players.some(player => !isRecord(player)))) {
    return invalidPresentation(snapshot, ['invalid_players']);
  }
  const hasNewEnvelope = Object.hasOwn(snapshot, 'objectives')
    || Object.hasOwn(snapshot, 'activeObjectiveId')
    || Object.hasOwn(snapshot, 'pendingObjectiveId');
  if (hasNewEnvelope && !Array.isArray(snapshot.objectives)) {
    return invalidPresentation(snapshot, ['invalid_objectives']);
  }
  if (hasNewEnvelope) {
    return normalizeFlashpoint(snapshot, map);
  }
  if (!isRecord(snapshot.objective)) {
    return invalidPresentation(snapshot, ['invalid_legacy_objective']);
  }
  const objective = cloneValue(snapshot.objective);
  const point = {
    ...cloneValue(snapshot.objective),
    id: LEGACY_OBJECTIVE_ID,
    activation: 'active',
    definition: map?.objective || null,
  };
  const objectives = [point];
  const players = (snapshot.players || []).map(player => {
    const onPoint = player.alive !== false && player.onPoint === true;
    return {
      ...player,
      onObjectiveId: onPoint ? LEGACY_OBJECTIVE_ID : null,
      onPoint,
    };
  });

  return {
    ...snapshot,
    valid: true,
    legacy: true,
    errors: [],
    activeObjectiveId: LEGACY_OBJECTIVE_ID,
    pendingObjectiveId: null,
    objectives,
    objectiveById: new Map([[LEGACY_OBJECTIVE_ID, point]]),
    objective,
    players,
  };
}
