export const ROLE_SLOTS = Object.freeze({
  frontline: 1,
  damage: 2,
  support: 2,
});

export const TEAM_ROLES = Object.freeze(Object.keys(ROLE_SLOTS));

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
