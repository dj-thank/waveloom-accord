function distanceBetween(left, right) {
  return Math.hypot(
    left[0] - right[0],
    left[1] - right[1],
    left[2] - right[2],
  );
}

function compareIds(left, right) {
  const a = String(left);
  const b = String(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function isPosition(value) {
  return Array.isArray(value)
    && value.length >= 3
    && value.slice(0, 3).every(Number.isFinite);
}

function normalizedNodes(navigationGraph) {
  const source = Array.isArray(navigationGraph?.nodes)
    ? navigationGraph.nodes
    : Array.isArray(navigationGraph?.anchors) ? navigationGraph.anchors : [];
  return source
    .map((node) => {
      const pos = node?.pos ?? node?.position;
      if (node?.id === undefined || node?.id === null || !isPosition(pos)) return null;
      return { ...node, pos: [...pos.slice(0, 3)] };
    })
    .filter(Boolean);
}

function normalizedEdges(navigationGraph, blockedEdgeIds) {
  const blocked = new Set(blockedEdgeIds);
  const source = Array.isArray(navigationGraph?.edges) ? navigationGraph.edges : [];
  const result = [];
  for (const edge of source) {
    const id = edge?.id;
    const from = edge?.from ?? edge?.fromAnchorId;
    const to = edge?.to ?? edge?.toAnchorId;
    if (id === undefined || id === null || from === undefined || to === undefined) continue;
    if (blocked.has(id)
      || edge.safe === false
      || edge.enabled === false
      || edge.traversable === false
      || edge.unsafe === true) continue;
    const points = edge.points ?? edge.waypoints ?? [];
    if (!Array.isArray(points) || !points.every(isPosition)) continue;
    const forward = {
      ...edge,
      id,
      from,
      to,
      points: points.map(point => [...point.slice(0, 3)]),
      searchId: `${String(id)}:forward`,
    };
    result.push(forward);
    if (edge.bidirectional === true && from !== to) {
      result.push({
        ...forward,
        from: to,
        to: from,
        points: [...forward.points].reverse().map(point => [...point]),
        cost: Number.isFinite(edge.reverseCost) ? edge.reverseCost : edge.cost,
        searchId: `${String(id)}:reverse`,
      });
    }
  }
  return result;
}

function exactTacticalRule(tacticalMetadata, activeSiteId, side, phase, duty) {
  const sites = tacticalMetadata?.sites;
  const site = Array.isArray(sites)
    ? sites.find(candidate => candidate?.id === activeSiteId)
    : sites?.[activeSiteId];
  const sideMetadata = (site?.tactical?.bySide || site?.bySide)?.[side];
  return sideMetadata
    ?.phases?.[phase]
    ?.duties?.[duty] || null;
}

function edgeCost(edge, from, to) {
  if (Number.isFinite(edge.cost) && edge.cost >= 0) return edge.cost;
  const points = [from.pos, ...(Array.isArray(edge.points) ? edge.points : []), to.pos];
  let cost = 0;
  for (let index = 1; index < points.length; index++) {
    cost += distanceBetween(points[index - 1], points[index]);
  }
  return cost;
}

function edgeIntentPenalty(edge, preferredIntents) {
  if (!Array.isArray(preferredIntents) || preferredIntents.length === 0) return 0;
  const intents = (Array.isArray(edge.intent) ? edge.intent : [edge.intent])
    .filter(intent => typeof intent === 'string' && intent.length > 0);
  if (intents.length === 0) return 0;
  let bestRank = Infinity;
  for (const intent of intents) {
    const rank = preferredIntents.indexOf(intent);
    if (rank >= 0) bestRank = Math.min(bestRank, rank);
  }
  return Number.isFinite(bestRank) ? bestRank : preferredIntents.length + 1;
}

function compareSearchState(left, right) {
  const preferenceDifference = left.preference - right.preference;
  if (preferenceDifference !== 0) return preferenceDifference;
  const costDifference = left.cost - right.cost;
  if (Math.abs(costDifference) > 1e-9) return costDifference;
  const pathDifference = compareIds(left.pathKey, right.pathKey);
  return pathDifference || compareIds(left.nodeId, right.nodeId);
}

function searchGoalPaths(
  nodesById,
  edges,
  startId,
  goalIds,
  preferredIntents,
  maxExpandedNodes,
) {
  const goalSet = new Set(goalIds);
  const outgoing = new Map();
  for (const edge of edges) {
    if (!outgoing.has(edge.from)) outgoing.set(edge.from, []);
    outgoing.get(edge.from).push(edge);
  }
  for (const candidates of outgoing.values()) {
    candidates.sort((left, right) => compareIds(left.id, right.id));
  }

  const initial = {
    nodeId: startId,
    preference: 0,
    cost: 0,
    pathKey: '',
    edges: [],
  };
  const open = new Map([[startId, initial]]);
  const best = new Map([[startId, initial]]);
  const pathsByGoal = new Map();
  let expandedNodes = 0;
  while (open.size > 0) {
    if (expandedNodes >= maxExpandedNodes) {
      return { pathsByGoal, budgetExhausted: true };
    }
    const current = [...open.values()].sort(compareSearchState)[0];
    open.delete(current.nodeId);
    expandedNodes++;
    if (goalSet.has(current.nodeId)) {
      pathsByGoal.set(current.nodeId, current.edges);
      if (current.nodeId === goalIds[0] || pathsByGoal.size === goalSet.size) {
        return { pathsByGoal, budgetExhausted: false };
      }
    }

    for (const edge of outgoing.get(current.nodeId) || []) {
      const from = nodesById.get(edge.from);
      const to = nodesById.get(edge.to);
      if (!from || !to) continue;
      const pathKey = current.pathKey
        ? `${current.pathKey}>${edge.searchId || String(edge.id)}`
        : edge.searchId || String(edge.id);
      const candidate = {
        nodeId: edge.to,
        preference: Math.max(
          current.preference,
          edgeIntentPenalty(edge, preferredIntents),
        ),
        cost: current.cost + edgeCost(edge, from, to),
        pathKey,
        edges: [...current.edges, edge],
      };
      const previous = best.get(candidate.nodeId);
      if (!previous || compareSearchState(candidate, previous) < 0) {
        best.set(candidate.nodeId, candidate);
        open.set(candidate.nodeId, candidate);
      }
    }
  }
  return { pathsByGoal, budgetExhausted: false };
}

function pathRouteId(edges) {
  const routeIds = [...new Set(edges.map(edge => edge.routeId).filter(Boolean))];
  if (routeIds.length === 1) return routeIds[0];
  return edges.map(edge => edge.routeId || edge.id).join('>');
}

function pathWaypoints(edges, nodesById) {
  const result = [];
  const append = (point) => {
    const previous = result.at(-1);
    if (previous && previous.every((value, index) => value === point[index])) return;
    result.push([...point]);
  };
  for (const edge of edges) {
    for (const point of Array.isArray(edge.points) ? edge.points : []) append(point);
    append(nodesById.get(edge.to).pos);
  }
  return result;
}

export function planFlashpointNavigation({
  position,
  activeSiteId,
  siteEpoch,
  side,
  duty,
  phase,
  blockedEdgeIds = [],
  navigationGraph,
  tacticalMetadata,
  maxExpandedNodes = 4096,
}) {
  const rule = exactTacticalRule(tacticalMetadata, activeSiteId, side, phase, duty);
  const authoredGoalIds = Array.isArray(rule?.goalAnchorIds)
    ? rule.goalAnchorIds
    : rule?.goalAnchorId ? [rule.goalAnchorId] : [];
  const goalAnchorIds = [...new Set(authoredGoalIds.filter(Boolean))];
  const preferredGoalAnchorId = goalAnchorIds[0] || null;
  const nodes = normalizedNodes(navigationGraph);
  const nodesById = new Map(nodes.map(node => [node.id, node]));
  const validGoalAnchorIds = goalAnchorIds.filter(goalId => nodesById.has(goalId));
  for (const goalAnchorId of validGoalAnchorIds) {
    const goal = nodesById.get(goalAnchorId);
    const configuredArrivalRadius = rule?.arrivalRadiusM
      ?? goal?.arrivalRadiusM
      ?? navigationGraph?.goalToleranceM;
    const arrivalRadiusM = Number.isFinite(configuredArrivalRadius) && configuredArrivalRadius >= 0
      ? configuredArrivalRadius
      : 0.5;
    if (distanceBetween(position, goal.pos) <= arrivalRadiusM) {
      return {
        status: 'at_goal',
        routeId: null,
        goalAnchorId,
        waypoints: [],
        reason: 'already_at_goal',
        siteEpoch,
      };
    }
  }
  const start = [...nodes].sort((left, right) => {
    const distance = distanceBetween(left.pos, position) - distanceBetween(right.pos, position);
    return distance || compareIds(left.id, right.id);
  })[0];
  const edges = normalizedEdges(navigationGraph, blockedEdgeIds);
  const searchBudget = Number.isInteger(maxExpandedNodes) && maxExpandedNodes >= 0
    ? maxExpandedNodes
    : 4096;
  const search = start && validGoalAnchorIds.length > 0
    ? searchGoalPaths(
      nodesById,
      edges,
      start.id,
      validGoalAnchorIds,
      rule?.preferredIntents,
      searchBudget,
    )
    : { pathsByGoal: new Map(), budgetExhausted: false };
  if (search.budgetExhausted) {
    return {
      status: 'budget_exhausted',
      routeId: null,
      goalAnchorId: preferredGoalAnchorId,
      waypoints: [],
      reason: 'search_budget_exhausted',
      siteEpoch,
    };
  }
  const goalAnchorId = validGoalAnchorIds.find(goalId => {
    const candidate = search.pathsByGoal.get(goalId);
    return candidate && candidate.length > 0;
  }) || null;
  const path = goalAnchorId ? search.pathsByGoal.get(goalAnchorId) : null;
  const goal = goalAnchorId ? nodesById.get(goalAnchorId) : null;

  if (!path || path.length === 0 || !goal) {
    return {
      status: 'unreachable',
      routeId: null,
      goalAnchorId: preferredGoalAnchorId,
      waypoints: [],
      reason: 'no_safe_route',
      siteEpoch,
    };
  }

  return {
    status: 'ok',
    routeId: pathRouteId(path),
    goalAnchorId,
    waypoints: pathWaypoints(path, nodesById),
    reason: 'route_planned',
    siteEpoch,
  };
}

export const planRoute = planFlashpointNavigation;
