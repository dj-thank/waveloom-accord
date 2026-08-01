import { HEROES } from '../data/heroes.js';
import {
  ROLE_SLOTS, TEAM_ROLES, countRoles, CONTINUOUS_SUSTAIN_FUNCTION,
  validateSustainComposition,
} from './team_composition.js';
import { acceptanceSeedForMatch } from '../telemetry/teamfight_acceptance.js';

const TEAM_COUNT = 2;

// Whole-composition matchups are fixed together.  Pairing tanks, damage and
// supports in separate procedural passes produced legal 1/2/2 rosters but
// also deterministic steamrolls.  IDs are the only authored values here;
// role, HP, sustain and mitigation remain derived from the hero SSOT.
const AUTHORED_COMPETITIVE_ROSTER_IDS = Object.freeze([
  Object.freeze([
    Object.freeze(['zairu', 'shirasagi', 'hokuchi', 'tsuzuri', 'shirabe']),
    Object.freeze(['shiomaneki', 'asagi', 'ankou', 'hibari', 'karakasa']),
  ]),
  Object.freeze([
    Object.freeze(['vesta', 'botan', 'ankou', 'tsuzuri', 'kazura']),
    Object.freeze(['nuedori', 'shirasagi', 'asagi', 'hibari', 'shirabe']),
  ]),
  Object.freeze([
    Object.freeze(['baraga', 'tsubakuro', 'botan', 'tsuzuri', 'karakasa']),
    Object.freeze(['sedora', 'hokuchi', 'ankou', 'hibari', 'koyomi']),
  ]),
]);

// Every authored matchup is played once in each team-index/physical-side
// direction.  Deriving the reverse half here keeps the composition itself as
// one SSOT and prevents a later balance edit from drifting between sides.
const COMPETITIVE_ROSTER_IDS = Object.freeze([
  ...AUTHORED_COMPETITIVE_ROSTER_IDS,
  ...AUTHORED_COMPETITIVE_ROSTER_IDS.map(teams => Object.freeze([
    teams[1],
    teams[0],
  ])),
]);

export const COMPETITIVE_FRONTLINE_MATCHUPS = Object.freeze(
  COMPETITIVE_ROSTER_IDS.map(teams => Object.freeze(teams.map(team => team[0]))),
);

function positiveModulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function hasSustain(hero) {
  return hero?.role === 'support' && hero.teamFunctions?.includes(CONTINUOUS_SUSTAIN_FUNCTION);
}

export const MIN_COMPETITIVE_ROSTER_MATCHES = COMPETITIVE_ROSTER_IDS.length;

export function pairedBotSeedForMatch(baseSeed, matchIndex) {
  if (!Number.isInteger(matchIndex) || matchIndex < 0) {
    throw new Error(`matchIndex must be a non-negative integer: ${matchIndex}`);
  }
  if (!Number.isSafeInteger(baseSeed)) {
    throw new Error(`baseSeed must be a safe integer: ${baseSeed}`);
  }
  const seedStride = acceptanceSeedForMatch(1) - acceptanceSeedForMatch(0);
  const mirrorCycle = Math.floor(matchIndex / COMPETITIVE_ROSTER_IDS.length);
  const canonicalLineupIndex = positiveModulo(
    matchIndex,
    AUTHORED_COMPETITIVE_ROSTER_IDS.length,
  );
  const seedIndex = mirrorCycle * AUTHORED_COMPETITIVE_ROSTER_IDS.length
    + canonicalLineupIndex;
  return (baseSeed + seedIndex * seedStride) >>> 0;
}

export function competitiveBotTeams(matchIndex, heroes = HEROES) {
  if (!Number.isInteger(matchIndex) || matchIndex < 0) {
    throw new Error(`matchIndex must be a non-negative integer: ${matchIndex}`);
  }
  const knownHeroes = new Map(heroes.map(hero => [hero.id, hero]));
  const teams = COMPETITIVE_ROSTER_IDS[
    positiveModulo(matchIndex, COMPETITIVE_ROSTER_IDS.length)
  ].map(team => team.map(heroId => {
    const hero = knownHeroes.get(heroId);
    if (!hero) throw new Error(`canonical competitive roster references missing hero: ${heroId}`);
    return { heroId, role: hero.role };
  }));
  assertCompetitiveBotTeams(teams, heroes);
  return teams;
}

/**
 * Describes one position in the six-match mirror rotation without treating a
 * physical team index as bot identity. The authored lineup side and slot are
 * stable for 0<->3, 1<->4 and 2<->5.
 */
export function competitiveBotRotation(matchIndex, heroes = HEROES) {
  if (!Number.isInteger(matchIndex) || matchIndex < 0) {
    throw new Error(`matchIndex must be a non-negative integer: ${matchIndex}`);
  }
  const rotationIndex = positiveModulo(matchIndex, COMPETITIVE_ROSTER_IDS.length);
  const canonicalLineupIndex = rotationIndex % AUTHORED_COMPETITIVE_ROSTER_IDS.length;
  const mirrored = rotationIndex >= AUTHORED_COMPETITIVE_ROSTER_IDS.length;
  const teams = competitiveBotTeams(matchIndex, heroes);
  const logicalSlotsByHero = new Map();
  for (let authoredSideIndex = 0; authoredSideIndex < TEAM_COUNT; authoredSideIndex++) {
    const lineupSide = authoredSideIndex === 0 ? 'a' : 'b';
    AUTHORED_COMPETITIVE_ROSTER_IDS[canonicalLineupIndex][authoredSideIndex]
      .forEach((heroId, slotIndex) => {
        logicalSlotsByHero.set(heroId, Object.freeze({
          heroId,
          canonicalLineupIndex,
          lineupSide,
          slotIndex,
          logicalLineupSlot: `lineup:${canonicalLineupIndex}|side:${lineupSide}|slot:${slotIndex}`,
        }));
      });
  }
  const rngSlots = Object.freeze(teams.map(team => Object.freeze(team.map(slot => {
    const metadata = logicalSlotsByHero.get(slot.heroId);
    if (!metadata) throw new Error(`missing logical lineup slot for hero: ${slot.heroId}`);
    return metadata;
  }))));

  return Object.freeze({
    matchIndex,
    rotationIndex,
    canonicalLineupIndex,
    mirrored,
    mirrorMatchIndex: matchIndex + (mirrored ? -3 : 3),
    acceptanceSeed: acceptanceSeedForMatch(matchIndex),
    teams,
    rngSlots,
  });
}

// Server matches may contain humans, but the remaining bot slots must still
// be a projection of the same canonical rotation used by headless play.  A
// human-held role occupies one canonical slot; it does not create a second
// runtime-only roster policy.
export function competitiveBotFillSlots(matchIndex, team, occupiedPlayers = [], heroes = HEROES) {
  if (!Number.isInteger(team) || team < 0 || team >= TEAM_COUNT) {
    throw new Error(`team must be between 0 and ${TEAM_COUNT - 1}: ${team}`);
  }
  const knownHeroes = new Map(heroes.map(hero => [hero.id, hero]));
  const occupied = Array.isArray(occupiedPlayers) ? occupiedPlayers.filter(Boolean) : [];
  for (const player of occupied) {
    if (player.team !== undefined && player.team !== team) {
      throw new Error(`player ${player.id || player.heroId} belongs to team ${player.team}, not ${team}`);
    }
    const hero = knownHeroes.get(player.heroId);
    if (!hero || hero.role !== player.role) {
      throw new Error(`occupied player has invalid hero role: ${player.heroId}/${player.role}`);
    }
  }

  const occupiedCounts = countRoles(occupied);
  for (const role of TEAM_ROLES) {
    if (occupiedCounts[role] > ROLE_SLOTS[role]) {
      throw new Error(`team ${team} overfills ${role}: ${occupiedCounts[role]}/${ROLE_SLOTS[role]}`);
    }
  }

  const canonical = competitiveBotTeams(matchIndex, heroes)[team];
  const occupiedHeroIds = new Set(occupied.map(player => player.heroId));
  const fills = [];
  for (const role of TEAM_ROLES) {
    let remaining = ROLE_SLOTS[role] - occupiedCounts[role];
    if (remaining <= 0) continue;
    const canonicalRole = canonical.filter(slot => slot.role === role);
    const preferUnused = slots => [
      ...slots.filter(slot => !occupiedHeroIds.has(slot.heroId)),
      ...slots.filter(slot => occupiedHeroIds.has(slot.heroId)),
    ];
    let candidates = preferUnused(canonicalRole);
    const existingSustain = occupied.some(player => hasSustain(knownHeroes.get(player.heroId)));
    if (role === 'support') {
      if (!existingSustain) {
        const sustain = candidates.find(slot => hasSustain(knownHeroes.get(slot.heroId)));
        if (!sustain) throw new Error(`canonical team ${team} has no sustain support`);
        fills.push(sustain);
        occupiedHeroIds.add(sustain.heroId);
        remaining--;
        candidates = candidates.filter(slot => slot !== sustain);
      } else {
        candidates = [
          ...candidates.filter(slot => !hasSustain(knownHeroes.get(slot.heroId))),
          ...candidates.filter(slot => hasSustain(knownHeroes.get(slot.heroId))),
        ];
      }
    }
    for (const slot of candidates) {
      if (remaining <= 0) break;
      fills.push(slot);
      occupiedHeroIds.add(slot.heroId);
      remaining--;
    }
    if (remaining > 0) throw new Error(`canonical team ${team} cannot fill ${role}`);
  }

  const projected = [
    ...occupied.map(player => ({
      ...player,
      team,
      teamFunctions: knownHeroes.get(player.heroId).teamFunctions,
    })),
    ...fills.map(slot => ({
      ...slot,
      team,
      teamFunctions: knownHeroes.get(slot.heroId).teamFunctions,
    })),
  ];
  const counts = countRoles(projected);
  for (const role of TEAM_ROLES) {
    if (counts[role] !== ROLE_SLOTS[role]) {
      throw new Error(`team ${team} ${role} mismatch after bot fill: ${counts[role]}/${ROLE_SLOTS[role]}`);
    }
  }
  const sustain = validateSustainComposition(projected, [team]);
  if (!sustain.ok) throw new Error(`team ${team} has no sustain support after bot fill`);
  return fills.map(slot => ({ ...slot }));
}

export function assertCompetitiveBotTeams(teams, heroes = HEROES) {
  const knownHeroes = new Map(heroes.map(hero => [hero.id, hero]));
  if (!Array.isArray(teams) || teams.length !== TEAM_COUNT) {
    throw new Error(`competitive roster must contain ${TEAM_COUNT} teams`);
  }
  for (let team = 0; team < TEAM_COUNT; team++) {
    const roster = teams[team];
    const expectedSize = Object.values(ROLE_SLOTS).reduce((sum, count) => sum + count, 0);
    if (!Array.isArray(roster) || roster.length !== expectedSize) {
      throw new Error(`team ${team} size mismatch: ${roster?.length}/${expectedSize}`);
    }
    const ids = new Set();
    for (const slot of roster) {
      const hero = knownHeroes.get(slot?.heroId);
      if (!hero || hero.role !== slot.role) {
        throw new Error(`team ${team} has invalid hero slot: ${slot?.heroId}/${slot?.role}`);
      }
      if (ids.has(slot.heroId)) throw new Error(`team ${team} duplicates hero ${slot.heroId}`);
      ids.add(slot.heroId);
    }
    const counts = countRoles(roster);
    for (const role of TEAM_ROLES) {
      if (counts[role] !== ROLE_SLOTS[role]) {
        throw new Error(`team ${team} ${role} mismatch: ${counts[role]}/${ROLE_SLOTS[role]}`);
      }
    }
    const sustainValidation = validateSustainComposition(roster.map(slot => ({
      ...slot,
      team,
      teamFunctions: knownHeroes.get(slot.heroId)?.teamFunctions,
    })), [team]);
    if (!sustainValidation.ok) throw new Error(`team ${team} has no sustain support`);
  }
  return true;
}
