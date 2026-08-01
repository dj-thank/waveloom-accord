const UINT32_RANGE = 0x1_0000_0000;

export const BOT_RNG_SCHEME = Object.freeze({
  id: 'kagariai.bot-rng.counter-domain.v1',
  defaultDomain: 'bot-controller',
  sideDrawDomain: 'match-side-draw',
  matchSeedDomain: 'match-world-seed',
  physicalTeamInIdentity: false,
});

function stringHash(value) {
  let hash = 0x811c9dc5;
  for (const character of String(value)) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function mix32(value) {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

function logicalBotKey(player, roster, logicalLineupSlot) {
  const heroId = String(player?.heroId ?? 'training');
  if (logicalLineupSlot !== undefined && logicalLineupSlot !== null) {
    const normalizedSlot = String(logicalLineupSlot).trim();
    if (!normalizedSlot) throw new TypeError('logicalLineupSlot must not be empty');
    return `${normalizedSlot}|hero:${heroId}`;
  }

  const baseKey = `hero:${heroId}`;
  const duplicates = [...roster].filter(candidate => (
    String(candidate?.heroId ?? 'training') === heroId
  ));
  if (duplicates.length <= 1) return baseKey;
  return `${baseKey}|player:${String(player?.id ?? 'unknown')}`;
}

function normalizeDomain(domain) {
  const normalized = String(domain ?? '').trim();
  if (!normalized) throw new TypeError('RNG domain must not be empty');
  return normalized;
}

function counterRandom(matchSeed, identity, domain, counter) {
  let mixed = mix32(
    (Number(matchSeed) >>> 0) ^ stringHash(`seed-domain:${BOT_RNG_SCHEME.matchSeedDomain}`),
  );
  mixed = mix32(mixed ^ stringHash(`identity:${identity}`));
  mixed = mix32(mixed ^ stringHash(`stream-domain:${domain}`));
  mixed = mix32(mixed ^ mix32(counter));
  return mixed / UINT32_RANGE;
}

/**
 * Returns a deterministic, domain-keyed counter stream for one logical bot.
 * A supplied logical lineup slot is stable across physical team reversal.
 * Existing BotController callers remain compatible because calling rng()
 * advances the default bot-controller domain.
 */
export function makeBotRng(matchSeed, player, roster = [player], {
  logicalLineupSlot,
  domain = BOT_RNG_SCHEME.defaultDomain,
} = {}) {
  const identity = logicalBotKey(player, roster, logicalLineupSlot);
  const defaultDomain = normalizeDomain(domain);
  const counters = new Map();
  const random = (requestedDomain = defaultDomain) => {
    const streamDomain = normalizeDomain(requestedDomain);
    const counter = counters.get(streamDomain) ?? 0;
    counters.set(streamDomain, counter + 1);
    return counterRandom(matchSeed, identity, streamDomain, counter);
  };
  const normalizedSlot = logicalLineupSlot === undefined || logicalLineupSlot === null
    ? null
    : String(logicalLineupSlot).trim();
  Object.defineProperty(random, 'metadata', {
    enumerable: true,
    value: Object.freeze({
      schemeId: BOT_RNG_SCHEME.id,
      matchSeed: Number(matchSeed) >>> 0,
      logicalLineupSlot: normalizedSlot,
      heroId: String(player?.heroId ?? 'training'),
      identity,
      defaultDomain,
      physicalTeamInIdentity: BOT_RNG_SCHEME.physicalTeamInIdentity,
    }),
  });
  return random;
}

function compareKeys(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rotate(values, offset) {
  if (values.length < 2) return [...values];
  const start = offset % values.length;
  return [...values.slice(start), ...values.slice(0, start)];
}

/**
 * Purely chooses bot decision order for a simulation tick. This does not
 * change World.tick() or authoritative action resolution; same-tick human
 * trade semantics remain a separate concern owned by World.
 */
export function scheduleBotThinkOrder(controllers, tick) {
  const controllerList = [...controllers];
  if (controllerList.length === 0) return [];
  if (!Number.isInteger(tick) || tick < 0) throw new TypeError('tick must be a non-negative integer');

  const players = controllerList.map(controller => controller?.pl);
  const groups = new Map();
  const identities = new Set();
  for (const controller of controllerList) {
    const player = controller?.pl;
    const teamKey = String(player?.team ?? 'unknown');
    const identity = logicalBotKey(player, players);
    const scheduledIdentity = `${teamKey}|${identity}`;
    if (identities.has(scheduledIdentity)) throw new Error(`duplicate bot identity: ${scheduledIdentity}`);
    identities.add(scheduledIdentity);
    const team = groups.get(teamKey) || [];
    team.push({ controller, identity });
    groups.set(teamKey, team);
  }

  const teamGroups = [...groups.entries()]
    .sort(([left], [right]) => compareKeys(left, right))
    .map(([, team]) => rotate(
      team.sort((left, right) => compareKeys(left.identity, right.identity)),
      tick,
    ));
  const interleavedTeams = rotate(teamGroups, tick);
  const scheduled = [];
  const longestTeam = Math.max(...interleavedTeams.map(team => team.length));
  for (let teamIndex = 0; teamIndex < longestTeam; teamIndex++) {
    for (const team of interleavedTeams) {
      if (team[teamIndex]) scheduled.push(team[teamIndex].controller);
    }
  }
  return scheduled;
}
