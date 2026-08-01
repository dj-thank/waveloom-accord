export const ROLE_SLOTS = Object.freeze({
  frontline: 1,
  damage: 2,
  support: 2,
});

// Shared by the server welcome payload, client validator, smoke verifier, and
// protocol documentation. Increment only when the roster payload contract
// changes incompatibly.
export const RUNTIME_ROSTER_VERSION = 4;

export const TEAM_ROLES = Object.freeze(Object.keys(ROLE_SLOTS));
export const SUSTAIN_FUNCTION = 'sustain';
// A cooldown zone, mitigation link, or one-shot burst is valuable utility,
// but cannot satisfy the mandatory primary-healer slot.  This tag is carried
// by the canonical hero definition and therefore survives selection/swap
// projections without maintaining a second roster list in the server.
export const CONTINUOUS_SUSTAIN_FUNCTION = 'continuous_sustain';
// One composition contract serves bots, human joins, hero selection, swaps,
// and rematches. Tactical formation can vary in play, but the roster itself
// is always one frontline, two damage, and two support heroes with a primary
// continuous healer.
export const RUNTIME_COMPOSITION_POLICY = Object.freeze({
  teamSize: 5,
  roleSlots: ROLE_SLOTS,
  requireContinuousSustain: true,
});

export function validateRuntimeComposition(players) {
  const roster = Array.isArray(players) ? players.filter(Boolean) : [];
  const teamSize = roster.length;
  const requiredTeamSize = RUNTIME_COMPOSITION_POLICY.teamSize;
  const sizeMatches = teamSize === requiredTeamSize;
  const roleCounts = countRoles(roster);
  const invalidRole = roster.some(player => !TEAM_ROLES.includes(player?.role));
  const missingRoles = TEAM_ROLES.filter(role => roleCounts[role] < ROLE_SLOTS[role]);
  const roleSlotsMatch = !invalidRole && TEAM_ROLES.every(role => (
    roleCounts[role] === ROLE_SLOTS[role]
  ));
  const hasContinuousSustain = roster.some(hasSustainSupport);
  const ok = sizeMatches && roleSlotsMatch && hasContinuousSustain;
  const code = !sizeMatches
    ? 'team_size_mismatch'
    : !roleSlotsMatch
      ? 'role_slots_required'
      : !hasContinuousSustain
        ? 'sustain_support_required'
        : null;
  return {
    ok,
    ...(code ? { code } : {}),
    teamSize,
    requiredTeamSize,
    roleCounts,
    roleSlots: ROLE_SLOTS,
    missingRoles,
    hasContinuousSustain,
    // Kept as an empty compatibility field for diagnostics emitted by older
    // connections; roster legality is no longer a capability-budget bypass.
    missingCapabilities: [],
  };
}

export function countRoles(players, excludePlayerId = null) {
  const counts = { frontline: 0, damage: 0, support: 0 };
  for (const player of Array.isArray(players) ? players : []) {
    if (!player || player.id === excludePlayerId || !Object.hasOwn(counts, player.role)) continue;
    counts[player.role]++;
  }
  return counts;
}

export function roleAvailability(players, slots = ROLE_SLOTS, excludePlayerId = null) {
  const counts = countRoles(players, excludePlayerId);
  return Object.fromEntries(TEAM_ROLES.map(role => {
    const limit = Math.max(0, Number(slots?.[role]) || 0);
    const used = counts[role];
    return [role, { used, limit, remaining: Math.max(0, limit - used) }];
  }));
}

export function validateRoleSelection(players, role, currentPlayerId = null, slots = ROLE_SLOTS) {
  if (!TEAM_ROLES.includes(role)) return { ok: false, code: 'invalid_role', role, remaining: 0 };
  const availability = roleAvailability(players, slots, currentPlayerId)[role];
  if (availability.remaining <= 0) {
    return { ok: false, code: 'role_full', role, remaining: 0 };
  }
  return { ok: true, role, remaining: availability.remaining };
}

export function validateSustainComposition(players, teams = null) {
  const roster = Array.isArray(players)
    ? (players.some(Array.isArray)
      ? players.flatMap((team, index) => (Array.isArray(team) ? team : []).map(player => ({ ...player, team: player?.team ?? index })))
      : players.filter(Boolean))
    : [];
  const teamIds = teams || [...new Set(roster.map(player => player.team).filter(team => team !== undefined))];
  const missing = teamIds.filter(team => !roster.some(player => player.team === team &&
    player.role === 'support' && Array.isArray(player.teamFunctions) &&
    player.teamFunctions.includes(CONTINUOUS_SUSTAIN_FUNCTION)));
  return missing.length === 0
    ? { ok: true, missingTeams: [] }
    : { ok: false, code: 'sustain_support_required', missingTeams: missing };
}

export const hasSustainSupport = player => player?.role === 'support' &&
  Array.isArray(player.teamFunctions) && player.teamFunctions.includes(CONTINUOUS_SUSTAIN_FUNCTION);

export function projectRuntimeHeroSelection(players, playerId, targetHero) {
  const roster = Array.isArray(players) ? players.filter(Boolean) : [];
  if (!targetHero || !roster.some(candidate => candidate.id === playerId)) return [];
  return roster.map(candidate => candidate.id === playerId
    ? {
      ...candidate,
      heroId: targetHero.id,
      role: targetHero.role,
      teamFunctions: targetHero.teamFunctions,
    }
    : candidate);
}

export function projectHeroSelection(players, playerId, targetHero, swapPlayerId = null) {
  const roster = Array.isArray(players) ? players.filter(Boolean) : [];
  const player = roster.find(candidate => candidate.id === playerId);
  if (!player || !targetHero || !TEAM_ROLES.includes(targetHero.role)) return [];
  return roster.map(candidate => {
    if (candidate.id === playerId) {
      return {
        ...candidate,
        heroId: targetHero.id,
        role: targetHero.role,
        teamFunctions: targetHero.teamFunctions,
      };
    }
    if (swapPlayerId && candidate.id === swapPlayerId) {
      return {
        ...candidate,
        heroId: player.heroId,
        role: player.role,
        teamFunctions: player.teamFunctions,
      };
    }
    return candidate;
  });
}

export function planRoleChange(players, playerId, targetRole) {
  const roster = Array.isArray(players) ? players.filter(Boolean) : [];
  const player = roster.find(candidate => candidate.id === playerId);
  if (!player || !TEAM_ROLES.includes(targetRole)) {
    return { ok: false, code: player ? 'invalid_role' : 'player_not_found', role: targetRole };
  }
  if (player.role === targetRole) {
    return { ok: true, role: targetRole, swapPlayerId: null, replacementRole: null };
  }
  const swap = roster.find(candidate => candidate.id !== playerId && candidate.isBot && candidate.role === targetRole);
  if (!swap) return { ok: false, code: 'role_full', role: targetRole };
  return {
    ok: true,
    role: targetRole,
    swapPlayerId: swap.id,
    replacementRole: player.role,
  };
}
