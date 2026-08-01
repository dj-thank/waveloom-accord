/**
 * Resolve the side-authored Flashpoint route consumed by BotController.
 *
 * siteEpoch is intentionally opaque to callers. activationIndex is the
 * authoritative lifetime when supplied; the fallback combines completed-site
 * count and site identity. selectionIndex is deliberately not used because it
 * counts selector draws, not site activations.
 */
export function resolveFlashpointBotRoute(world, team, lane) {
  const state = world?.flashpointState || world || {};
  const siteId = state.activeSiteId
    ?? state.activeObjectiveId
    ?? world?.activeObjectiveId
    ?? state.pendingSiteId
    ?? state.pendingObjectiveId
    ?? world?.pendingObjectiveId
    ?? null;
  const side = world?.sideOf?.(team) ?? null;
  const siteEpoch = Number.isInteger(state.activationIndex)
    ? `activation:${state.activationIndex}:${siteId}`
    : `completed:${state.completedSiteIds?.length || 0}:${siteId}`;
  const noPlan = (reason) => ({
    status: 'no_plan',
    reason,
    siteId,
    siteEpoch,
    side,
    lane,
    routeId: null,
    intent: null,
    points: [],
  });

  // A terminal lifecycle must not keep following a stale route that happened
  // to be in the last snapshot. The next match creates a fresh World instead.
  if (state.lifecycle === 'complete' || state.phase === 'complete') return noPlan('match_complete');
  if (typeof siteId !== 'string' || !siteId || (side !== 'east' && side !== 'west')) {
    return noPlan('route_not_found');
  }

  const flashpoint = world?.map?.flashpoint;
  // If a runtime route table is present, it is authoritative even when empty:
  // falling back to authoring data would let an unvalidated route drive a bot.
  const routesBySite = flashpoint?.runtime?.routesBySite ?? flashpoint?.routesBySite;
  const route = routesBySite?.[siteId]?.[side]?.[lane];
  if (!route) return noPlan('route_not_found');

  const validPoints = Array.isArray(route.points) && route.points.length > 0
    && route.points.every(point => Array.isArray(point) && point.length >= 3
      && point.slice(0, 3).every(Number.isFinite));
  if (typeof route.id !== 'string' || !route.id || !validPoints) return noPlan('malformed_route');

  return {
    status: 'ok',
    reason: 'route_resolved',
    siteId,
    siteEpoch,
    side,
    lane,
    routeId: route.id,
    intent: route.intent ?? null,
    points: route.points.map(point => [...point]),
  };
}
