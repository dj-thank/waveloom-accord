import { HERO_BY_ID } from '../data/heroes.js';

const SPACE_TEAM_FUNCTIONS = Object.freeze(['space']);
const RECOVERY_TEAM_FUNCTIONS = Object.freeze(['sustain', 'continuous_sustain']);
const CAPABILITY_TEAM_FUNCTIONS = Object.freeze({
  space: SPACE_TEAM_FUNCTIONS,
  recovery: RECOVERY_TEAM_FUNCTIONS,
});
export const TEAM_CAPABILITY_BUDGET = Object.freeze({ space: 1, recovery: 1 });
const ANCHOR_FUNCTIONS = new Set(['space', 'mitigation']);
const RECOVERY_FUNCTIONS = new Set(RECOVERY_TEAM_FUNCTIONS);

function functionsOf(hero) {
  return Array.isArray(hero?.teamFunctions) ? hero.teamFunctions : [];
}

export function summarizeTeamCapabilities(heroes) {
  const summary = Object.fromEntries(
    Object.keys(TEAM_CAPABILITY_BUDGET).map(capability => [capability, 0]),
  );
  for (const hero of heroes || []) {
    const teamFunctions = functionsOf(hero);
    for (const [capability, acceptedFunctions] of Object.entries(CAPABILITY_TEAM_FUNCTIONS)) {
      if (acceptedFunctions.some(value => teamFunctions.includes(value))) {
        summary[capability]++;
      }
    }
  }
  return summary;
}

export function validateTeamCapabilities(heroes) {
  const summary = summarizeTeamCapabilities(heroes);
  const missingCapabilities = Object.entries(TEAM_CAPABILITY_BUDGET)
    .filter(([capability, minimum]) => summary[capability] < minimum)
    .map(([capability]) => capability);
  return {
    ok: missingCapabilities.length === 0,
    missingCapabilities,
    summary,
  };
}

export function heroCanAnchorPressure(hero) {
  return hero?.role === 'frontline'
    || functionsOf(hero).some(value => ANCHOR_FUNCTIONS.has(value));
}

export function heroCanRecoverAllies(hero) {
  return functionsOf(hero).some(value => RECOVERY_FUNCTIONS.has(value));
}

function heroFor(player, heroById) {
  if (heroById instanceof Map) return heroById.get(player?.heroId);
  return heroById?.[player?.heroId];
}

function positionOf(player) {
  return player?.pos || player?.move?.pos || null;
}

function distance3d(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return Infinity;
  return Math.hypot(
    Number(left[0] || 0) - Number(right[0] || 0),
    Number(left[1] || 0) - Number(right[1] || 0),
    Number(left[2] || 0) - Number(right[2] || 0),
  );
}

function effective(player) {
  return !!player?.alive
    && !player?.flags?.invulnerable
    && !player?.flags?.intangible;
}

function compareText(left, right) {
  const a = String(left || '');
  const b = String(right || '');
  return a < b ? -1 : a > b ? 1 : 0;
}

function logicalPlayerIdentity(player) {
  return player?.logicalIdentity
    || player?.rngIdentity
    || player?.name
    || player?.heroId
    || '';
}

function stableNearest(players, point) {
  return [...players].sort((left, right) => {
    const distanceDelta = distance3d(positionOf(left), point)
      - distance3d(positionOf(right), point);
    if (Math.abs(distanceDelta) > 1e-9) return distanceDelta;
    // Hero identity is preserved when canonical lineups swap physical teams;
    // player ids are allocation details and must not decide an equal-distance
    // pressure/recovery duty in mirrored simulations.
    const heroDelta = compareText(left?.heroId, right?.heroId);
    return heroDelta || compareText(logicalPlayerIdentity(left), logicalPlayerIdentity(right));
  })[0] || null;
}

export function selectPressureAnchor(players, objectiveCenter, {
  heroById = HERO_BY_ID,
  frontlinePreferenceM = 6,
} = {}) {
  const candidates = (players || []).filter(player => (
    effective(player) && heroCanAnchorPressure(heroFor(player, heroById))
  ));
  const nearest = stableNearest(candidates, objectiveCenter);
  if (!nearest) return null;

  const frontlines = candidates.filter(player => heroFor(player, heroById)?.role === 'frontline');
  const frontline = stableNearest(frontlines, objectiveCenter);
  if (!frontline) return nearest;
  const frontlineDistance = distance3d(positionOf(frontline), objectiveCenter);
  const nearestDistance = distance3d(positionOf(nearest), objectiveCenter);
  return frontlineDistance < nearestDistance + Math.max(0, Number(frontlinePreferenceM) || 0)
    ? frontline
    : nearest;
}

export function selectRecoveryProvider(players, anchor, {
  heroById = HERO_BY_ID,
  continuousPreferenceM = 6,
} = {}) {
  const anchorPosition = positionOf(anchor);
  if (!anchorPosition) return null;
  const candidates = (players || []).filter(player => (
    effective(player) && heroCanRecoverAllies(heroFor(player, heroById))
  ));
  const nearest = stableNearest(candidates, anchorPosition);
  if (!nearest) return null;

  // A connected high-throughput provider should keep the live duty.  Without
  // this small hysteresis, an equally close sustain-capable DPS displaced the
  // primary provider and abandoned its side assignment even while the healer
  // was healthy.  The preference follows capability, not the support role;
  // a meaningfully closer fallback still takes over.
  const continuous = stableNearest(candidates.filter(player => (
    functionsOf(heroFor(player, heroById)).includes('continuous_sustain')
  )), anchorPosition);
  if (!continuous) return nearest;
  return distance3d(positionOf(continuous), anchorPosition) <=
    distance3d(positionOf(nearest), anchorPosition) + Math.max(0, continuousPreferenceM)
    ? continuous
    : nearest;
}
