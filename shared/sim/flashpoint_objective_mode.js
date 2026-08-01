import { OSHIOI_FLASHPOINT } from '../data/map_oshioi_flashpoint.js';

export const FLASHPOINT_SITE_IDS = Object.freeze(
  OSHIOI_FLASHPOINT.sites.map(site => site.id),
);
export const FLASHPOINT_MAX_TRAVEL_BIAS = 0.25;

const OPPOSITE_CORNER_SITE_ID = Object.freeze({
  mizuichi: 'kazami',
  kazami: 'mizuichi',
  kado: 'ami',
  ami: 'kado',
});

function validateTeamSides(teamSides) {
  if (
    !Array.isArray(teamSides)
    || teamSides.length !== 2
    || new Set(teamSides).size !== 2
    || !teamSides.includes('east')
    || !teamSides.includes('west')
  ) {
    throw new RangeError('teamSides must be an east/west permutation');
  }
}

function seedToUint32(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  let hash = 0x811c9dc5;
  for (const character of String(seed)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function dedicatedSelectorSample(seed, selectionIndex) {
  let value = seedToUint32(seed) ^ Math.imul(selectionIndex + 1, 0x9e3779b9);
  value ^= value >>> 16;
  value = Math.imul(value, 0x21f0aaad);
  value ^= value >>> 15;
  value = Math.imul(value, 0x735a2d97);
  value ^= value >>> 15;
  return (value >>> 0) / 4294967296;
}

function authoredTravelMeters(siteId) {
  const routes = OSHIOI_FLASHPOINT.routesBySite[siteId];
  return {
    east: routes.east.front.measuredLengthM,
    west: routes.west.front.measuredLengthM,
  };
}

export function selectNextFlashpointSite({
  seed = 0,
  selectionIndex = 0,
  completedSiteIds = [],
  siteScores = [0, 0],
  teamSides = ['east', 'west'],
}) {
  if (!Number.isInteger(selectionIndex) || selectionIndex < 0) {
    throw new RangeError('selectionIndex must be a non-negative integer');
  }
  validateTeamSides(teamSides);
  const losingTeam = siteScores[0] === siteScores[1]
    ? null
    : siteScores[0] < siteScores[1] ? 0 : 1;
  const losingSide = losingTeam === null ? null : teamSides[losingTeam];
  const previousSiteId = completedSiteIds.at(-1) ?? null;
  const eligibleSiteIdsBeforeDiagonal = FLASHPOINT_SITE_IDS.filter(
    siteId => !completedSiteIds.includes(siteId),
  );
  const oppositeCornerSiteId = OPPOSITE_CORNER_SITE_ID[previousSiteId] ?? null;
  const shouldExcludeDiagonal = eligibleSiteIdsBeforeDiagonal.length > 1
    && eligibleSiteIdsBeforeDiagonal.includes(oppositeCornerSiteId);
  const excludedDiagonalSiteIds = shouldExcludeDiagonal
    ? [oppositeCornerSiteId]
    : [];
  const eligible = eligibleSiteIdsBeforeDiagonal
    .filter(siteId => !excludedDiagonalSiteIds.includes(siteId))
    .map(siteId => ({ siteId, travelMeters: authoredTravelMeters(siteId) }));
  const eligibleMeanTravelMeters = losingTeam === null
    ? null
    : eligible.reduce(
      (sum, candidate) => sum + candidate.travelMeters[losingSide],
      0,
    ) / eligible.length;
  const candidates = eligible.map(({ siteId, travelMeters }) => {
    const biasTravelMeters = losingTeam === null
      ? null
      : travelMeters[losingSide];
    const rawTravelAdvantageM = losingTeam === null
      ? 0
      : eligibleMeanTravelMeters - biasTravelMeters;
    const rawTravelBias = losingTeam === null
      ? 0
      : rawTravelAdvantageM / eligibleMeanTravelMeters;
    const appliedTravelBias = Math.max(
      -FLASHPOINT_MAX_TRAVEL_BIAS,
      Math.min(FLASHPOINT_MAX_TRAVEL_BIAS, rawTravelBias),
    );
    return {
      siteId,
      travelMeters,
      biasTravelMeters,
      rawTravelAdvantageM,
      rawTravelBias,
      appliedTravelBias,
      weight: 1 + appliedTravelBias,
    };
  });
  const totalWeight = candidates.reduce(
    (sum, candidate) => sum + candidate.weight,
    0,
  );
  const sample = dedicatedSelectorSample(seed, selectionIndex);
  const targetWeight = sample * totalWeight;
  let cumulativeWeight = 0;
  const chosen = candidates.find((candidate) => {
    cumulativeWeight += candidate.weight;
    return targetWeight < cumulativeWeight;
  }) ?? candidates.at(-1);

  return {
    policy: 'dedicated-seeded-weighted-choice',
    selectorVersion: 1,
    selectionIndex,
    previousSiteId,
    losingTeam,
    losingSide,
    eligibleSiteIdsBeforeDiagonal,
    excludedDiagonalSiteIds,
    eligibleMeanTravelMeters,
    travelBiasCap: FLASHPOINT_MAX_TRAVEL_BIAS,
    travelBiasUnit: 'selection-weight-ratio',
    sample,
    totalWeight,
    candidates,
    chosenSiteId: chosen?.siteId ?? null,
  };
}

export function createFlashpointObjectiveMode({
  seed = 0,
  teamSides = ['east', 'west'],
} = {}) {
  validateTeamSides(teamSides);
  return {
    mode: OSHIOI_FLASHPOINT.mode,
    lifecycle: 'active',
    activeSiteId: OSHIOI_FLASHPOINT.layout.openingSiteId,
    pendingSiteId: null,
    completedSiteIds: [],
    siteScores: [0, 0],
    transitionRemainingSec: 0,
    winnerTeam: null,
    teamSides: [...teamSides],
    selectorSeed: seed,
    selectionIndex: 0,
    lastSelection: null,
  };
}

export function completeFlashpointSite(state, winnerTeam) {
  if (winnerTeam !== 0 && winnerTeam !== 1) {
    throw new RangeError('winnerTeam must be 0 or 1');
  }
  if (
    state?.lifecycle !== 'active'
    || !FLASHPOINT_SITE_IDS.includes(state.activeSiteId)
    || state.completedSiteIds.includes(state.activeSiteId)
  ) {
    throw new Error('a site can be completed only while it is active');
  }
  const completedSiteIds = [...state.completedSiteIds, state.activeSiteId];
  const siteScores = [...state.siteScores];
  siteScores[winnerTeam] += 1;
  if (siteScores[winnerTeam] >= OSHIOI_FLASHPOINT.progression.pointsToWin) {
    return {
      ...state,
      lifecycle: 'complete',
      activeSiteId: null,
      pendingSiteId: null,
      completedSiteIds,
      siteScores,
      transitionRemainingSec: 0,
      winnerTeam,
    };
  }
  const lastSelection = selectNextFlashpointSite({
    seed: state.selectorSeed,
    selectionIndex: state.selectionIndex,
    completedSiteIds,
    siteScores,
    teamSides: state.teamSides,
  });

  return {
    ...state,
    lifecycle: 'transition',
    activeSiteId: null,
    pendingSiteId: lastSelection.chosenSiteId,
    completedSiteIds,
    siteScores,
    transitionRemainingSec: OSHIOI_FLASHPOINT.progression.transitionSec,
    selectionIndex: state.selectionIndex + 1,
    lastSelection,
  };
}

export function advanceFlashpointObjectiveMode(state, deltaSec) {
  if (!Number.isFinite(deltaSec) || deltaSec < 0) {
    throw new RangeError('deltaSec must be a finite non-negative number');
  }
  if (state.lifecycle !== 'transition') return state;
  const transitionRemainingSec = Math.max(
    0,
    state.transitionRemainingSec - deltaSec,
  );
  if (transitionRemainingSec > 1e-9) {
    return { ...state, transitionRemainingSec };
  }
  return {
    ...state,
    lifecycle: 'active',
    activeSiteId: state.pendingSiteId,
    pendingSiteId: null,
    transitionRemainingSec: 0,
  };
}
