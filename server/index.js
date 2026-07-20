// 『篝合』Production Candidate 専用サーバー
// - サーバー権威 63Hz tick / スナップショット21Hz
// - WebSocketで入力受信・状態配信。静的ファイル（client/・shared/・vendor）も配信
// - 人間が接続するとボットと交代。切断3秒でボットが引き継ぐ（§8）
// 起動: node server/index.js [--port 8787]

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import {
  HEROES, HERO_BY_ID, DEFAULT_HERO_ID, heroesForRole,
} from '../shared/data/heroes.js';
import { BotController } from './bots.js';
import { makeRng } from '../shared/sim/rng.js';
import {
  bindConnection, unbindConnection, canRequestRestart, clampAccumulator,
  resolveHeroId, receiveInputCommand, isOpenSocket, connectedTeamCounts,
  chooseJoinTeam, canSendSnapshot, canSelectHero, createLagCompensationTracker,
  createMessageTokenBucket, consumeMessageToken, buildRuntimeDiagnostics,
  shouldExitOnInitialListenError, claimedSlotSpawnOptions, PROTOCOL_VERSION,
  LAG_COMPENSATION_POLICY,
  canAdmitWebSocketConnection, shouldCloseUnjoinedConnection,
  WS_CONNECTION_LIMIT, WS_JOIN_DEADLINE_MS, WS_FORCE_CLOSE_MS,
} from './runtime.js';
import { resolvePublicAsset, resolveVendorAddon } from './static.js';
import { createStaticFileResponder } from './http_static.js';
import {
  createEventRing, appendEventRing, readEventRing, eventDeliveryHealth,
} from './event_ring.js';
import { ROLE_SLOTS, TEAM_ROLES, countRoles, planRoleChange } from '../shared/rules/team_composition.js';
import {
  readProductionConfig, securityHeaders, isOriginAllowed, buildHealthPayload,
} from './production.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const staticFiles = createStaticFileResponder({ root: ROOT, maxConcurrentStreams: 32 });
const mode = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/mode_shioura.json'), 'utf8'));
const combat = JSON.parse(fs.readFileSync(path.join(ROOT, 'shared/data/combat.json'), 'utf8'));
if (JSON.stringify(mode.roleSlots) !== JSON.stringify(ROLE_SLOTS)) {
  throw new Error('mode.roleSlots must match the frozen 1/2/2 team composition');
}

const args = process.argv.slice(2);
const production = readProductionConfig(process.env, args);
const { port: PORT, host: HOST } = production;
const MAX_MESSAGE_BYTES = 64 * 1024;
const MAX_BUFFERED_SNAPSHOT_BYTES = 256 * 1024;
const ROSTER = Object.freeze({
  version: 1,
  defaultHeroId: DEFAULT_HERO_ID,
  roleSlots: ROLE_SLOTS,
  heroes: HEROES.map(({ id, name, role, roleLabel, subtype, color, maxHp }) => ({
    id, name, role, roleLabel, subtype, color, maxHp,
  })),
});

function monotonicNowMs() {
  return Number(process.hrtime.bigint()) / 1e6;
}

// ---- 静的配信 ----
const startedAt = Date.now();
let ready = false;
let tickDrops = 0;
let shuttingDown = false;
let hasListened = false;
const httpServer = http.createServer((req, res) => {
  const method = String(req.method || 'GET').toUpperCase();
  let url = (req.url || '/').split('?')[0];
  const headers = securityHeaders(production, url);
  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD', 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(method === 'HEAD' ? undefined : 'method not allowed');
  }
  if (url === '/healthz' || url === '/readyz') {
    const diagnostics = buildRuntimeDiagnostics(connections, sockets, world);
    const payload = {
      ...buildHealthPayload({
        ready, startedAt, now: Date.now(), connections: diagnostics.connections,
        matchOrdinal, tickDrops, protocolVersion: PROTOCOL_VERSION,
      }),
      ...diagnostics,
      eventDelivery: eventDeliveryHealth(eventRing, connections, eventDeliveryMetrics),
      connectionAdmission: {
        limit: WS_CONNECTION_LIMIT,
        joinDeadlineMs: WS_JOIN_DEADLINE_MS,
        forceCloseMs: WS_FORCE_CLOSE_MS,
        rejected: connectionAdmissionMetrics.rejected,
        originRejected: connectionAdmissionMetrics.originRejected,
        preUpgradeRejected: connectionAdmissionMetrics.preUpgradeRejected,
        postUpgradeRejected: connectionAdmissionMetrics.postUpgradeRejected,
        joinTimeouts: connectionAdmissionMetrics.joinTimeouts,
        forcedTerminations: connectionAdmissionMetrics.forcedTerminations,
        messageRateExceeded: connectionAdmissionMetrics.messageRateExceeded,
      },
      webSocketCloses: {
        total: webSocketCloseMetrics.total,
        byCode: { ...webSocketCloseMetrics.byCode },
      },
      lagCompensationTotals: { ...lagCompensationTotals },
      staticDelivery: staticFiles.health(),
    };
    const status = url === '/readyz' && !ready ? 503 : 200;
    const body = JSON.stringify(payload);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    return res.end(method === 'HEAD' ? undefined : body);
  }
  if (url === '/') url = '/client/index.html';
  if (url === '/vendor/three.module.js') {
    return staticFiles.sendFile(req, res, path.join(ROOT, 'node_modules/three/build/three.module.js'), { method, pathname: url });
  }
  const addonFile = resolveVendorAddon(ROOT, url);
  if (addonFile) return staticFiles.sendFile(req, res, addonFile, { method, pathname: url });
  const file = resolvePublicAsset(ROOT, url);
  if (!file) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end(method === 'HEAD' ? undefined : 'not found');
  }
  staticFiles.sendFile(req, res, file, { method, pathname: url });
});

// ---- 試合 ----
const seed = (Date.now() % 2147483647) | 0;
const botRng = makeRng(seed ^ 0x5eed);
let world, bots, sockets;
const connections = new Map();
let eventRing = createEventRing();
const eventDeliveryMetrics = {
  backpressureSkips: 0,
  sendFailures: 0,
  overflowResyncs: 0,
  droppedDeliveries: 0,
};
const connectionAdmissionMetrics = {
  rejected: 0,
  originRejected: 0,
  preUpgradeRejected: 0,
  postUpgradeRejected: 0,
  joinTimeouts: 0,
  forcedTerminations: 0,
  messageRateExceeded: 0,
};
const webSocketCloseMetrics = { total: 0, byCode: Object.create(null) };
const lagCompensationTotals = { samples: 0, slowPongOutliers: 0, aboveAbsoluteCapSamples: 0 };
const BOT_HERO_POOLS = Object.freeze({
  frontline: heroesForRole('frontline'),
  damage: heroesForRole('damage'),
  support: heroesForRole('support'),
});
let matchOrdinal = 0;

function playerRole(player) {
  return HERO_BY_ID[player?.heroId]?.role || null;
}

function newMatch(keepHumans = []) {
  const heroRotation = matchOrdinal++;
  world = new World(buildMap(), mode, combat, seed + Math.floor(Math.random() * 1e6));
  bots = new Map();
  sockets = sockets || new Map(); // playerId -> ws
  const humansByTeam = [[], []];
  const remaps = [];
  for (const h of keepHumans) {
    const team = h.team === 1 ? 1 : 0;
    if (humansByTeam[team].length < mode.teamSize) humansByTeam[team].push(h);
  }
  for (let team = 0; team < 2; team++) {
    for (const h of humansByTeam[team]) {
      const pl = world.addPlayer(h.name, false, team, h.heroId);
      remaps.push({ human: h, player: pl });
    }
    const teamPlayers = [...world.players.values()]
      .filter(player => player.team === team)
      .map(player => ({ ...player, role: playerRole(player) }));
    const roleCounts = countRoles(teamPlayers);
    let botOrdinal = teamPlayers.length;
    for (const role of TEAM_ROLES) {
      const missing = Math.max(0, ROLE_SLOTS[role] - roleCounts[role]);
      const pool = BOT_HERO_POOLS[role];
      for (let index = 0; index < missing; index++) {
        const hero = pool[(heroRotation * 2 + team * 3 + botOrdinal) % pool.length];
        const pl = world.addPlayer(botName(), true, team, hero.id);
        bots.set(pl.id, new BotController(world, pl, botRng));
        botOrdinal++;
      }
    }
  }
  for (const { human, player } of remaps) human.remap(player);
  console.log(`[match] 新しい試合を開始 seed=${world.seed} (${mode.displayName} / ${world.map.displayName})`);
}

const BOT_NAMES = ['アオサギ', 'イソナミ', 'ウミボタル', 'カザハヤ', 'シラナミ', 'タマモ', 'ナギサ', 'ヒトデマル', 'フナムシ', 'ミナモ', 'ヤドカリ', 'ワタツミ'];
let botIdx = 0;
function botName() { return `B-${BOT_NAMES[botIdx++ % BOT_NAMES.length]}`; }

newMatch();

// ---- WebSocket ----
function sanitizePlayerName(value) {
  if (typeof value !== 'string') return 'guest';
  return value.trim().slice(0, 16) || 'guest';
}

function safeSendSerialized(ws, payload) {
  if (!isOpenSocket(ws)) return false;
  try {
    ws.send(payload);
    return true;
  } catch (error) {
    console.warn(`[ws] send failed: ${error?.message || error}`);
    return false;
  }
}

function safeSend(ws, message) {
  try {
    return safeSendSerialized(ws, JSON.stringify(message));
  } catch (error) {
    console.warn(`[ws] serialize failed: ${error?.message || error}`);
    return false;
  }
}

function sendError(ws, code, message = code) {
  safeSend(ws, { t: 'error', code, message });
}

function sendWelcomeAndSnapshot(ws, player) {
  safeSend(ws, {
    t: 'welcome', protocolVersion: PROTOCOL_VERSION,
    id: player.id, team: player.team, heroId: player.heroId,
    roster: ROSTER,
    lagCompensationPolicy: LAG_COMPENSATION_POLICY,
    tickRateHz: combat.tickRateHz, mode, combat, seed: world.seed,
  });
  safeSend(ws, { t: 'snap', snap: world.snapshot(), events: [] });
}

function captureWorldEvents(atMs = monotonicNowMs()) {
  eventRing = appendEventRing(eventRing, world?.drainEvents?.() || [], atMs);
}

function clearJoinDeadline(conn) {
  if (!conn?.joinDeadlineTimer) return;
  clearTimeout(conn.joinDeadlineTimer);
  conn.joinDeadlineTimer = null;
}

function closeSocketWithDeadline(ws, code, reason) {
  try {
    ws.close(code, reason);
  } catch {
    ws.terminate();
    return null;
  }
  const forceCloseTimer = setTimeout(() => {
    if (ws.readyState !== WebSocket.CLOSED) {
      connectionAdmissionMetrics.forcedTerminations++;
      ws.terminate();
    }
  }, WS_FORCE_CLOSE_MS);
  forceCloseTimer.unref?.();
  ws.once('close', () => clearTimeout(forceCloseTimer));
  return forceCloseTimer;
}

function findClaimableSlot(team, role) {
  for (const playerId of bots.keys()) {
    const player = world.players.get(playerId);
    if (player?.team === team && playerRole(player) === role && !isOpenSocket(sockets.get(playerId))) return player;
  }
  for (const player of world.players.values()) {
    if (player.team === team && playerRole(player) === role && !isOpenSocket(sockets.get(player.id))) return player;
  }
  return null;
}

function initializeClaimedSlot(player, name, heroId) {
  const wasAlive = player.alive;
  if (world.flow.state !== 'SETUP' && player.alive) player.alive = false;
  if (!world.selectHero(player.id, heroId)) {
    player.alive = wasAlive;
    throw new Error(`failed to initialize ${player.id} as ${heroId}`);
  }

  bots.delete(player.id);
  world.respawn.cancel(player.id);
  player.isBot = false;
  player.name = name;
  player.flags = { invulnerable: false, intangible: false };
  player.ultGauge = 0;
  player.stats = { kills: 0, deaths: 0, dmg: 0, healing: 0, objectiveSec: 0 };
  world.spawnAtBase(player, claimedSlotSpawnOptions(world.flow.state));
  world.neutralizeInput(player.id, { resetSequence: true });
  return player;
}

function handleJoin(ws, conn, msg) {
  if (conn.playerId) {
    sendError(ws, 'already_joined', 'This connection has already joined.');
    return;
  }

  const name = sanitizePlayerName(msg.name);
  const heroId = resolveHeroId(msg.heroId, HERO_BY_ID, DEFAULT_HERO_ID);
  const requestedRole = HERO_BY_ID[heroId].role;
  const counts = connectedTeamCounts(world.players, sockets);
  const slots = [findClaimableSlot(0, requestedRole), findClaimableSlot(1, requestedRole)];
  const claimable = slots.map(Boolean);
  const team = chooseJoinTeam(counts, claimable, mode.teamSize);
  if (team < 0) {
    const full = counts.every(count => count >= mode.teamSize);
    sendError(ws, full ? 'server_full' : 'role_full', full
      ? `The match is full (${mode.teamSize} players per team).`
      : `The ${requestedRole} role is full on both teams.`);
    return;
  }

  captureWorldEvents();
  conn.eventCursor = readEventRing(eventRing, null).nextCursor;
  const player = initializeClaimedSlot(slots[team], name, heroId);
  conn.lastAcceptedInputSeq = 0;
  bindConnection(conn, player.id, sockets);
  clearJoinDeadline(conn);
  sendWelcomeAndSnapshot(ws, player);
  console.log(`[join] ${name} → ${player.id} (team ${team}, hero ${player.heroId})`);
}

function handleSelect(ws, conn, msg) {
  if (!conn.playerId) {
    safeSend(ws, { t: 'select_result', ok: false, code: 'not_joined' });
    return;
  }
  if (typeof msg.heroId !== 'string' || !Object.hasOwn(HERO_BY_ID, msg.heroId)) {
    safeSend(ws, { t: 'select_result', ok: false, code: 'invalid_hero' });
    return;
  }
  const player = world.players.get(conn.playerId);
  if (!player) {
    safeSend(ws, { t: 'select_result', ok: false, code: 'not_joined' });
    return;
  }
  const isRespawnPending = world.respawn.pending.has(player.id);
  if (!canSelectHero(world.flow.state, player.alive, isRespawnPending)) {
    safeSend(ws, { t: 'select_result', ok: false, heroId: msg.heroId, code: 'selection_locked' });
    return;
  }
  const targetHero = HERO_BY_ID[msg.heroId];
  const teamPlayers = [...world.players.values()]
    .filter(candidate => candidate.team === player.team)
    .map(candidate => ({ ...candidate, role: playerRole(candidate) }));
  const rolePlan = planRoleChange(teamPlayers, player.id, targetHero.role);
  if (!rolePlan.ok) {
    safeSend(ws, { t: 'select_result', ok: false, heroId: msg.heroId, code: rolePlan.code });
    return;
  }
  if (rolePlan.swapPlayerId && world.flow.state !== 'SETUP') {
    safeSend(ws, { t: 'select_result', ok: false, heroId: msg.heroId, code: 'role_change_locked' });
    return;
  }
  if (rolePlan.swapPlayerId) {
    const swapPlayer = world.players.get(rolePlan.swapPlayerId);
    if (!swapPlayer || !swapPlayer.isBot || !world.selectHero(swapPlayer.id, player.heroId)) {
      safeSend(ws, { t: 'select_result', ok: false, heroId: msg.heroId, code: 'role_full' });
      return;
    }
  }
  if (!world.selectHero(player.id, msg.heroId)) {
    safeSend(ws, { t: 'select_result', ok: false, heroId: msg.heroId, code: 'selection_locked' });
    return;
  }
  world.neutralizeInput(player.id);
  safeSend(ws, { t: 'select_result', ok: true, heroId: player.heroId });
}

function handleInput(ws, conn, msg) {
  if (!conn.playerId || !world.players.has(conn.playerId)) {
    sendError(ws, 'not_joined', 'Join before sending input.');
    return;
  }
  const result = receiveInputCommand(world, conn, msg.d, monotonicNowMs());
  if (!result.ok) {
    const message = result.code === 'stale_input'
      ? 'Input seq was already resolved or duplicated.'
      : result.code === 'input_queue_full'
        ? 'Input command queue is full; this command was not accepted.'
        : result.code === 'input_seq_out_of_window'
          ? 'Input seq exceeds the bounded reorder window.'
          : 'Input payload failed validation.';
    sendError(ws, result.code, message);
    return;
  }
}

function handleMessage(ws, conn, msg) {
  if (msg === null || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.t !== 'string') {
    sendError(ws, 'invalid_message', 'Message must be a JSON object with a string t field.');
    return;
  }
  if (msg.t === 'join') handleJoin(ws, conn, msg);
  else if (msg.t === 'select') handleSelect(ws, conn, msg);
  else if (msg.t === 'input') handleInput(ws, conn, msg);
  else if (msg.t === 'ping') {
    const id = typeof msg.id === 'string' || typeof msg.id === 'number' ? msg.id : null;
    safeSend(ws, { t: 'pong', id });
  } else if (msg.t === 'restart') {
    if (canRequestRestart(conn, world.flow.state)) restart();
    else sendError(ws, 'restart_not_allowed', 'Restart is only available after MATCH_END.');
  } else {
    sendError(ws, 'invalid_message', `Unknown message type: ${msg.t}`);
  }
}

function neutralizePlayerInput(targetWorld, player, options = {}) {
  targetWorld.neutralizeInput(player.id, options);
}

let wss;
wss = new WebSocketServer({
  server: httpServer,
  maxPayload: MAX_MESSAGE_BYTES,
  verifyClient: (info, done) => {
    if (!isOriginAllowed(info.origin, production)) {
      connectionAdmissionMetrics.originRejected++;
      done(false, 403, 'Forbidden');
      return;
    }
    // The callback completes synchronously, so each accepted upgrade is added
    // to wss.clients before the next upgrade is admitted.
    if (!canAdmitWebSocketConnection(wss.clients.size)) {
      connectionAdmissionMetrics.rejected++;
      connectionAdmissionMetrics.preUpgradeRejected++;
      done(false, 503, 'Service Unavailable', { 'Retry-After': '1' });
      return;
    }
    done(true);
  },
});
wss.on('connection', (ws) => {
  // `wss.clients` includes the just-upgraded socket and sockets whose peers
  // ignore the close handshake. Count both so raw peers cannot bypass the cap.
  if (!canAdmitWebSocketConnection(wss.clients.size - 1)) {
    connectionAdmissionMetrics.rejected++;
    connectionAdmissionMetrics.postUpgradeRejected++;
    closeSocketWithDeadline(ws, 1013, 'server connection limit reached');
    return;
  }
  const connectedAtMs = monotonicNowMs();
  const conn = {
    ws, playerId: null, lastAcceptedInputSeq: 0,
    eventCursor: null,
    connectedAtMs,
    joinDeadlineTimer: null,
    messageTokenBucket: createMessageTokenBucket(connectedAtMs),
    lagCompensation: createLagCompensationTracker({ now: monotonicNowMs }),
  };
  connections.set(ws, conn);
  conn.joinDeadlineTimer = setTimeout(() => {
    if (
      connections.get(ws) === conn
      && shouldCloseUnjoinedConnection({
        connectedAtMs: conn.connectedAtMs, nowMs: monotonicNowMs(), playerId: conn.playerId,
      })
    ) {
      connectionAdmissionMetrics.joinTimeouts++;
      conn.forceCloseTimer = closeSocketWithDeadline(ws, 1008, 'join deadline exceeded');
    }
  }, WS_JOIN_DEADLINE_MS);
  conn.joinDeadlineTimer.unref?.();
  ws.isAlive = true;
  ws.on('pong', () => {
    ws.isAlive = true;
    const before = conn.lagCompensation.metrics();
    if (conn.lagCompensation.observePong()) {
      const after = conn.lagCompensation.metrics();
      lagCompensationTotals.samples += after.samples - before.samples;
      lagCompensationTotals.slowPongOutliers += after.slowPongOutliers - before.slowPongOutliers;
      lagCompensationTotals.aboveAbsoluteCapSamples += (
        after.aboveAbsoluteCapSamples - before.aboveAbsoluteCapSamples
      );
    }
  });
  ws.on('message', (buf) => {
    const rateLimit = consumeMessageToken(conn.messageTokenBucket, monotonicNowMs());
    conn.messageTokenBucket = rateLimit.bucket;
    if (!rateLimit.allowed) {
      connectionAdmissionMetrics.messageRateExceeded++;
      conn.forceCloseTimer = closeSocketWithDeadline(ws, 1008, 'message rate exceeded');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(buf.toString());
    } catch {
      sendError(ws, 'invalid_message', 'Message is not valid JSON.');
      return;
    }
    try {
      handleMessage(ws, conn, msg);
    } catch (error) {
      console.error(`[ws] message handler failed: ${error?.stack || error}`);
      sendError(ws, 'server_error', 'The message could not be processed.');
    }
  });
  ws.on('close', (code) => {
    webSocketCloseMetrics.total++;
    const codeKey = String(code);
    webSocketCloseMetrics.byCode[codeKey] = (webSocketCloseMetrics.byCode[codeKey] || 0) + 1;
    clearJoinDeadline(conn);
    if (conn.forceCloseTimer) clearTimeout(conn.forceCloseTimer);
    connections.delete(ws);
    if (!conn.playerId) return;
    const pid = conn.playerId;
    const disconnectedWorld = world;
    unbindConnection(conn, sockets);
    if (isOpenSocket(sockets.get(pid))) return;
    const pl = disconnectedWorld.players.get(pid);
    if (pl && !pl.isBot) {
      neutralizePlayerInput(disconnectedWorld, pl, { acceptedToApplied: true });
      // §8: 離脱後3秒でボットが同位置・同体力で引き継ぐ
      setTimeout(() => {
        if (world !== disconnectedWorld) return;
        const p = disconnectedWorld.players.get(pid);
        if (p && !p.isBot && !isOpenSocket(sockets.get(pid))) {
          p.isBot = true;
          p.name = p.name + '(bot)';
          neutralizePlayerInput(disconnectedWorld, p, { acceptedToApplied: true });
          bots.set(pid, new BotController(world, p, botRng));
          console.log(`[leave] ${pid} をボットが引き継ぎ`);
        }
      }, mode.leaverBotTakeoverSec * 1000);
    }
  });
  ws.on('error', (error) => {
    console.warn(`[ws] socket error: ${error?.message || error}`);
  });
});

function restart() {
  autoRestartAt = 0;
  const humans = [];
  const staleConnections = [];
  for (const [pid, ws] of [...sockets]) {
    const conn = connections.get(ws);
    if (!isOpenSocket(ws) || !conn) {
      if (conn) staleConnections.push(conn);
      continue;
    }
    const pl = world.players.get(pid);
    if (!pl) {
      staleConnections.push(conn);
      continue;
    }
    humans.push({
      name: pl.name,
      team: pl.team,
      heroId: resolveHeroId(pl.heroId, HERO_BY_ID, DEFAULT_HERO_ID),
      remap: (newPlayer) => {
        world.neutralizeInput(newPlayer.id, {
          resetSequence: true,
          sequenceBase: conn.lastAcceptedInputSeq,
        });
        conn.eventCursor = readEventRing(eventRing, null).nextCursor;
        bindConnection(conn, newPlayer.id, sockets);
        sendWelcomeAndSnapshot(ws, newPlayer);
      },
    });
  }
  for (const conn of staleConnections) unbindConnection(conn, sockets);
  eventRing = createEventRing();
  newMatch(humans);
}

// ---- tickループ（63Hz、ドリフト補正付き） ----
const dtMs = 1000 / combat.tickRateHz;
let last = process.hrtime.bigint();
let acc = 0;
let autoRestartAt = 0;

const tickTimer = setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Number(now - last) / 1e6;
  last = now;
  const limited = clampAccumulator(acc, dtMs, 8);
  acc = limited.acc;
  if (limited.droppedMs > 0) {
    tickDrops++;
    console.warn(`[tick] ${limited.droppedMs.toFixed(1)}msをスキップ`);
  }
  let steps = 0;
  while (acc >= dtMs && steps < 8) {
    for (const bc of bots.values()) bc.think(world.dt);
    world.tick(monotonicNowMs());
    acc -= dtMs;
    steps++;
    if (world.tickCount % combat.snapshotEveryTicks === 0) broadcast();
    if (world.flow.state === 'MATCH_END') {
      if (!autoRestartAt) autoRestartAt = Date.now() + 15000;
      else if (Date.now() > autoRestartAt) { autoRestartAt = 0; restart(); }
    }
  }
}, 4);

const heartbeatTimer = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try {
      const connection = connections.get(ws);
      connection?.lagCompensation.markPing();
      ws.ping();
    } catch { ws.terminate(); }
  }
}, 15000);

function broadcast() {
  captureWorldEvents();
  const snap = world.snapshot();
  for (const ws of sockets.values()) {
    const conn = connections.get(ws);
    if (!conn) continue;
    if (!canSendSnapshot(ws, MAX_BUFFERED_SNAPSHOT_BYTES)) {
      eventDeliveryMetrics.backpressureSkips++;
      continue;
    }
    const delivery = readEventRing(eventRing, conn.eventCursor);
    const message = {
      t: 'snap', snap, events: delivery.events,
      eventStream: {
        cursor: delivery.nextCursor,
        remaining: delivery.remaining,
        ...(delivery.kind === 'resync' ? {
          resync: true, dropped: delivery.dropped, reason: delivery.reason,
        } : {}),
      },
    };
    if (!safeSendSerialized(ws, JSON.stringify(message))) {
      eventDeliveryMetrics.sendFailures++;
      continue;
    }
    conn.eventCursor = delivery.nextCursor;
    if (delivery.kind === 'resync') {
      eventDeliveryMetrics.overflowResyncs++;
      eventDeliveryMetrics.droppedDeliveries += delivery.dropped;
    }
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  ready = false;
  console.log(`[shutdown] ${signal} — 接続を安全に終了します`);
  clearInterval(tickTimer);
  clearInterval(heartbeatTimer);
  for (const conn of connections.values()) clearJoinDeadline(conn);
  for (const ws of wss.clients) closeSocketWithDeadline(ws, 1012, 'server restart');

  let finished = false;
  const finish = (error) => {
    if (finished) return;
    finished = true;
    clearTimeout(forceTimer);
    clearTimeout(abortTimer);
    if (error) {
      console.error(`[shutdown-error] ${error?.code || 'SHUTDOWN_ERROR'}: ${error?.message || error}`);
      process.exit(1);
      return;
    }
    process.exit(0);
  };
  const forceTimer = setTimeout(() => {
    for (const ws of wss.clients) {
      try { ws.terminate(); } catch { /* The socket is already gone. */ }
    }
    httpServer.closeAllConnections?.();
  }, production.shutdownGraceMs);
  forceTimer.unref?.();
  const abortTimer = setTimeout(() => {
    finish(new Error('servers did not close within the shutdown deadline'));
  }, production.shutdownGraceMs + WS_FORCE_CLOSE_MS + 1_000);
  abortTimer.unref?.();

  wss.close((webSocketError) => {
    if (webSocketError) {
      finish(webSocketError);
      return;
    }
    httpServer.close((httpError) => finish(httpError));
  });
}

httpServer.on('error', (error) => {
  ready = false;
  const code = error?.code || 'SERVER_ERROR';
  console.error(`[server-error] ${code}: ${error?.message || 'HTTP server failed'}`);
  if (shouldExitOnInitialListenError({ error, hasListened, shuttingDown })) {
    shuttingDown = true;
    clearInterval(tickTimer);
    clearInterval(heartbeatTimer);
    for (const conn of connections.values()) clearJoinDeadline(conn);
    for (const ws of wss.clients) ws.terminate();
    process.exitCode = 1;
    setImmediate(() => process.exit(1));
  }
});

wss.on('error', (error) => {
  console.error(`[websocket-error] ${error?.code || 'WS_ERROR'}: ${error?.message || 'WebSocket server failed'}`);
});

process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
if (process.env.KAGARIAI_RELEASE_VERIFY_IPC === '1' && typeof process.send === 'function') {
  process.on('message', (message) => {
    if (message?.type === 'kagariai.release.verify.shutdown') shutdown('RELEASE_VERIFY_IPC');
  });
}

httpServer.listen(PORT, HOST, () => {
  hasListened = true;
  ready = true;
  console.log(`『篝合』サーバー起動: http://${HOST}:${PORT} (WS同上 / tick ${combat.tickRateHz}Hz / ${production.nodeEnv})`);
});
