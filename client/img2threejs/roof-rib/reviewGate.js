const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const SITES = new Set(['west', 'mid', 'east']);
const DISTANCES_M = new Set([12, 28, 45]);
const LIGHTING_MODES = new Set(['day', 'dusk', 'backlit']);

export function resolveKagariaiRoofRibReviewRequest(locationLike = {}) {
  const protocol = String(locationLike.protocol || '');
  const hostname = String(locationLike.hostname || '').toLowerCase();
  const params = new URLSearchParams(String(locationLike.search || ''));
  const site = SITES.has(params.get('roofRibSite')) ? params.get('roofRibSite') : 'west';
  const requestedDistance = Number(params.get('roofRibDistance'));
  const distanceM = DISTANCES_M.has(requestedDistance) ? requestedDistance : 12;
  const lighting = LIGHTING_MODES.has(params.get('roofRibLighting')) ? params.get('roofRibLighting') : 'day';
  let reason = 'explicit-local-review';
  let enabled = true;
  if (!LOCAL_HOSTS.has(hostname)) {
    enabled = false;
    reason = 'non-local-host';
  } else if (!['http:', 'https:'].includes(protocol)) {
    enabled = false;
    reason = 'invalid-protocol';
  } else if (params.get('roofRibReview') !== '1') {
    enabled = false;
    reason = 'not-requested';
  }
  return Object.freeze({ enabled, reason, site, distanceM, lighting });
}
