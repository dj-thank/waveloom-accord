// 専用サーバーの接続・時間駆動・静的配信境界。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  bindConnection, unbindConnection, canRequestRestart, clampAccumulator,
  createLagCompensationTracker, receiveInputCommand,
  createMessageTokenBucket, consumeMessageToken,
  buildRuntimeDiagnostics, shouldExitOnInitialListenError,
  claimedSlotSpawnOptions,
  canAdmitWebSocketConnection, shouldCloseUnjoinedConnection,
  WS_CONNECTION_LIMIT, WS_JOIN_DEADLINE_MS,
} from '../server/runtime.js';
import { resolvePublicAsset, resolveVendorAddon } from '../server/static.js';
import { World } from '../shared/sim/sim.js';
import { buildMap } from '../shared/data/map_oshioi.js';
import { MODE, COMBAT } from './helpers.js';

test('runtime separates accepted input sequence from applied snapshot ACK and reports overflow', () => {
  const world = new World(buildMap(), MODE, COMBAT, 41);
  const player = world.addPlayer('human', false, 0, 'asagi');
  const conn = { playerId: player.id, lastAcceptedInputSeq: 0 };
  const payload = seq => ({
    f: false, b: false, l: false, r: false, jump: false, crouch: false,
    fire: false, reload: false, secondary: false, ability1: false,
    ability2: false, ultimate: false, yaw: 0, pitch: 0, seq, interpMs: 100,
  });

  assert.equal(receiveInputCommand(world, conn, payload(1)).ok, true);
  assert.equal(conn.lastAcceptedInputSeq, 1);
  assert.equal(player.lastAckSeq, 0);
  assert.deepEqual(receiveInputCommand(world, conn, payload(1)), {
    ok: false, code: 'stale_input',
  });

  for (let seq = 2; seq <= 32; seq++) {
    assert.equal(receiveInputCommand(world, conn, payload(seq)).ok, true);
  }
  assert.deepEqual(receiveInputCommand(world, conn, payload(33)), {
    ok: false, code: 'input_queue_full',
  });
  assert.equal(conn.lastAcceptedInputSeq, 32, 'rejected seq is not accepted');
  assert.equal(player.lastAckSeq, 0, 'queued seq is not applied');

  world.tick();
  assert.equal(player.lastAckSeq, 32, 'one tick coalesces the contiguous command batch');
  assert.equal(receiveInputCommand(world, conn, payload(33)).ok, true);
  assert.equal(conn.lastAcceptedInputSeq, 33);
});

test('runtime input lease uses monotonic receive time even when simulation time barely advances', () => {
  const world = new World(buildMap(), MODE, COMBAT, 42);
  const player = world.addPlayer('human', false, 0, 'asagi');
  const conn = { playerId: player.id, lastAcceptedInputSeq: 0 };
  const payload = {
    f: true, b: false, l: false, r: false, jump: false, crouch: false,
    fire: true, reload: false, secondary: false, ability1: false,
    ability2: false, ultimate: false, yaw: 0, pitch: 0, seq: 1, interpMs: 100,
  };

  assert.equal(receiveInputCommand(world, conn, payload, 1_000).ok, true);
  world.tick(1_001);
  assert.equal(player.input.f, true);
  assert.equal(player.input.fire, true);

  world.tick(1_250);
  assert.equal(player.input.f, false);
  assert.equal(player.input.fire, false);
  assert.equal(player.lastAckSeq, 1);
  assert.equal(world.inputCommandHealth().leaseExpirations, 1);
});

test('server observed RTT caps claimed interpolation deterministically', () => {
  let now = 1_000;
  const tracker = createLagCompensationTracker({ now: () => now, absoluteMaxMs: 220 });
  assert.equal(tracker.apply(0), 0);
  assert.equal(tracker.apply(100), 100);
  assert.equal(tracker.apply(220), 100, 'the server-owned display interpolation applies before RTT sampling');
  tracker.markPing();
  now += 40;
  assert.equal(tracker.observePong(), true);
  assert.equal(tracker.apply(0), 0);
  assert.equal(tracker.apply(100), 100);
  assert.equal(tracker.apply(220), 100, 'one sample is not enough to earn rewind credit');
  for (let sample = 0; sample < 3; sample++) {
    tracker.markPing();
    now += 40;
    assert.equal(tracker.observePong(), true);
  }
  assert.equal(tracker.apply(220), 120);
  assert.equal(tracker.metrics().capMs, 120);
  assert.equal(tracker.metrics().minimumRttMs, 40);
  assert.equal(tracker.metrics().compensationReady, true);

  const world = new World(buildMap(), MODE, COMBAT, 43);
  const human = world.addPlayer('human', false, 0, 'asagi');
  const bot = world.addPlayer('bot', true, 1, 'asagi');
  const payload = {
    f: false, b: false, l: false, r: false, jump: false, crouch: false,
    fire: false, reload: false, secondary: false, ability1: false, ability2: false, ultimate: false,
    yaw: 0, pitch: 0, seq: 1, interpMs: 220,
  };
  assert.equal(receiveInputCommand(world, { playerId: human.id, lastAcceptedInputSeq: 0, lagCompensation: tracker }, payload, now).ok, true);
  world.tick(now);
  assert.equal(human.appliedRewindMs, 120);
  assert.equal(bot.appliedRewindMs, 0);
  assert.equal(world.snapshot().players.find(player => player.id === human.id).rewindMs, 120);
});

test('lag compensation fails closed when observed RTT exceeds the 220ms absolute cap', () => {
  const atBoundary = createLagCompensationTracker({ absoluteMaxMs: 220 });
  for (let sample = 0; sample < 4; sample++) {
    atBoundary.markPing(sample * 1_000);
    assert.equal(atBoundary.observePong(sample * 1_000 + 220), true);
  }
  assert.equal(atBoundary.metrics().capMs, 210);
  assert.equal(atBoundary.apply(220), 210);

  const aboveBoundary = createLagCompensationTracker({ absoluteMaxMs: 220 });
  aboveBoundary.markPing(2_000);
  assert.equal(aboveBoundary.observePong(2_221), true);
  assert.equal(aboveBoundary.metrics().rttEmaMs, 221);
  assert.equal(aboveBoundary.metrics().capMs, 0);
  assert.equal(aboveBoundary.metrics().aboveAbsoluteCapSamples, 1);
  assert.equal(aboveBoundary.apply(220), 0);
});

test('lag compensation does not reward deliberately delayed or alternating pong samples', () => {
  const tracker = createLagCompensationTracker({ absoluteMaxMs: 220 });
  const samples = [20, 200, 20, 200];
  let at = 0;
  for (const rtt of samples) {
    tracker.markPing(at);
    at += rtt;
    assert.equal(tracker.observePong(at), true);
    at += 10;
  }

  const metrics = tracker.metrics();
  assert.equal(metrics.minimumRttMs, 20);
  assert.equal(metrics.compensationReady, true);
  assert.equal(metrics.capMs, 110, 'jitter and slow pong delay cannot increase rewind credit');
  assert.ok(metrics.jitterEmaMs > 0, 'jitter remains available for diagnostics');
  assert.equal(metrics.slowPongOutliers, 2);
  assert.equal(tracker.apply(220), 110);
});

test('message token bucket prevents a fixed-window boundary burst', () => {
  const initial = createMessageTokenBucket(0);
  let bucket = initial;
  for (let count = 0; count < 180; count++) {
    const result = consumeMessageToken(bucket, 999);
    assert.equal(result.allowed, true, `initial capacity token ${count + 1}`);
    bucket = result.bucket;
  }
  assert.deepEqual(initial, { capacity: 180, tokens: 180, refillPerMs: 0.18, updatedAtMs: 0 },
    'the pure helper does not mutate its input state');
  assert.equal(consumeMessageToken(bucket, 999).allowed, false);

  const oneMillisecondLater = consumeMessageToken(bucket, 1_000);
  assert.equal(oneMillisecondLater.allowed, false, 'the second fixed window does not grant another burst');
  assert.equal(oneMillisecondLater.bucket.tokens, 0.18);

  const oneTokenLater = consumeMessageToken(oneMillisecondLater.bucket, 1_006);
  assert.equal(oneTokenLater.allowed, true);
  assert.ok(oneTokenLater.bucket.tokens < 1);
});

test('runtime health diagnostics count and report unjoined connections', () => {
  const unjoinedTracker = createLagCompensationTracker();
  const joinedTracker = createLagCompensationTracker();
  joinedTracker.markPing(1_000);
  joinedTracker.observePong(1_120);
  const joinedSocket = {};
  const connections = new Map([
    [{}, { playerId: null, lagCompensation: unjoinedTracker }],
    [joinedSocket, { playerId: 'p1', lagCompensation: joinedTracker }],
  ]);
  const sockets = new Map([['p1', joinedSocket]]);
  const inputCommands = { queued: 3, discardedOnNeutralize: 2 };
  const world = {
    players: new Map([['p1', { appliedRewindMs: 45 }]]),
    inputCommandHealth: () => inputCommands,
  };

  assert.deepEqual(buildRuntimeDiagnostics(connections, sockets, world), {
    connections: 2,
    joinedPlayers: 1,
    unjoinedConnections: 1,
    inputCommands,
    lagCompensation: [
      {
        playerId: null, appliedRewindMs: 0, samples: 0,
        rttEmaMs: null, jitterEmaMs: 0, capMs: 100, absoluteCapMs: 220,
        displayInterpolationBaseMs: 100, minimumRttMs: null,
        compensationReady: false, requiredSamples: 4, sampleWindowSize: 20,
        slowPongOutliers: 0, aboveAbsoluteCapSamples: 0,
      },
      {
        playerId: 'p1', appliedRewindMs: 45, samples: 1,
        rttEmaMs: 120, jitterEmaMs: 0, capMs: 100, absoluteCapMs: 220,
        displayInterpolationBaseMs: 100, minimumRttMs: 120,
        compensationReady: false, requiredSamples: 4, sampleWindowSize: 20,
        slowPongOutliers: 0, aboveAbsoluteCapSamples: 0,
      },
    ],
  });
});

test('every initial HTTP listen error exits once while shutdown errors do not', () => {
  for (const code of ['EADDRINUSE', 'EACCES', 'ENOTFOUND', 'UNKNOWN', undefined]) {
    assert.equal(shouldExitOnInitialListenError({
      error: { code }, hasListened: false, shuttingDown: false,
    }), true, String(code));
  }
  assert.equal(shouldExitOnInitialListenError({
    error: { code: 'ENOTFOUND' }, hasListened: false, shuttingDown: true,
  }), false);
  assert.equal(shouldExitOnInitialListenError({
    error: { code: 'ECONNRESET' }, hasListened: true, shuttingDown: false,
  }), false);
});

test('ACTIVE bot claims use a safe protected spawn while SETUP keeps its current spawn contract', () => {
  assert.deepEqual(claimedSlotSpawnOptions('SETUP'), {});
  assert.deepEqual(claimedSlotSpawnOptions('ACTIVE'), { safe: true, protect: true });
  assert.deepEqual(claimedSlotSpawnOptions('ROUND_END'), {});
});

test('global WebSocket ceiling and unjoined deadline fail closed at their boundaries', () => {
  assert.equal(WS_CONNECTION_LIMIT, 32);
  assert.equal(WS_JOIN_DEADLINE_MS, 5_000);
  assert.equal(canAdmitWebSocketConnection(31), true);
  assert.equal(canAdmitWebSocketConnection(32), false);
  assert.equal(canAdmitWebSocketConnection(33), false);
  assert.equal(shouldCloseUnjoinedConnection({
    connectedAtMs: 1_000, nowMs: 5_999, playerId: null,
  }), false);
  assert.equal(shouldCloseUnjoinedConnection({
    connectedAtMs: 1_000, nowMs: 6_000, playerId: null,
  }), true);
  assert.equal(shouldCloseUnjoinedConnection({
    connectedAtMs: 1_000, nowMs: 9_000, playerId: 'p1',
  }), false);
});

test('再試合のID再割当は接続状態とsocket索引を原子的に更新する', () => {
  const ws = {};
  const conn = { ws, playerId: 'p2' };
  const sockets = new Map([['p2', ws]]);

  bindConnection(conn, 'p1', sockets);

  assert.equal(conn.playerId, 'p1');
  assert.equal(sockets.has('p2'), false);
  assert.equal(sockets.get('p1'), ws);
  unbindConnection(conn, sockets);
  assert.equal(conn.playerId, null);
  assert.equal(sockets.size, 0);
});

test('再試合要求は参加済み接続かつMATCH_ENDでのみ許可する', () => {
  assert.equal(canRequestRestart({ playerId: null }, 'MATCH_END'), false);
  assert.equal(canRequestRestart({ playerId: 'p1' }, 'ACTIVE'), false);
  assert.equal(canRequestRestart({ playerId: 'p1' }, 'MATCH_END'), true);
});

test('長時間停止後のaccumulatorは最大8tick分へ制限して余剰時間を捨てる', () => {
  const result = clampAccumulator(1000, 1000 / 63, 8);
  assert.ok(Math.abs(result.acc - (8000 / 63)) < 1e-9);
  assert.ok(result.droppedMs > 800);
  assert.deepEqual(clampAccumulator(10, 1000 / 63, 8), { acc: 10, droppedMs: 0 });
});

test('静的配信はclient/shared配下だけを許可し..によるROOT内横断も拒否する', () => {
  const root = path.resolve('C:/srv/kagariai');
  assert.equal(resolvePublicAsset(root, '/client/index.html'), path.join(root, 'client', 'index.html'));
  assert.equal(resolvePublicAsset(root, '/shared/data/combat.json'), path.join(root, 'shared', 'data', 'combat.json'));
  assert.equal(resolvePublicAsset(root, '/client/../server/index.js'), null);
  assert.equal(resolvePublicAsset(root, '/client/../package.json'), null);
  assert.equal(resolvePublicAsset(root, '/client/../../kagariai2/secret.txt'), null);
});

test('Three addon配信はexamples/jsm内のJavaScriptだけを許可する', () => {
  const root = path.resolve('C:/srv/kagariai');
  assert.equal(
    resolveVendorAddon(root, '/vendor/addons/loaders/GLTFLoader.js'),
    path.join(root, 'node_modules', 'three', 'examples', 'jsm', 'loaders', 'GLTFLoader.js'),
  );
  assert.equal(resolveVendorAddon(root, '/vendor/addons/../package.json'), null);
  assert.equal(resolveVendorAddon(root, '/vendor/addons/loaders/GLTFLoader.js%00'), null);
});
