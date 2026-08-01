import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../server/runtime.js';

const HEROES = Object.freeze([
  'zairu', 'vesta', 'asagi', 'shirasagi', 'tsubakuro',
  'hokuchi', 'tsuzuri', 'koyomi', 'karakasa', 'shirabe',
]);

function rng(seed) {
  let value = seed >>> 0;
  return () => {
    value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
    return value / 0x100000000;
  };
}

export function buildImpairedSchedule({ seed = 42, clients = 10, ticks = 30 } = {}) {
  if (!Number.isSafeInteger(clients) || clients < 1 || !Number.isSafeInteger(ticks) || ticks < 1) throw new Error('clients and ticks must be positive integers');
  const matrix = [];
  for (const jitterMs of [20, 100]) for (const lossPercent of [1, 5, 10]) {
    const random = rng((seed ^ jitterMs ^ (lossPercent << 8)) >>> 0);
    const packets = [];
    for (let tick = 0; tick < ticks; tick++) for (let client = 0; client < clients; client++) {
      if (random() < lossPercent / 100) continue;
      const jitter = Math.floor(random() * (jitterMs * 2 + 1)) - jitterMs;
      const delayMs = Math.max(0, 40 + jitter);
      packets.push({ client, seq: tick + 1, generatedAtMs: tick * 16, deliverAtMs: tick * 16 + delayMs, delayMs });
    }
    packets.sort((a, b) => a.deliverAtMs - b.deliverAtMs || a.client - b.client || a.seq - b.seq);
    const lastSeq = Array(clients).fill(0);
    let reordered = 0;
    let clumps = 0;
    for (let index = 0; index < packets.length; index++) {
      const packet = packets[index];
      if (index > 0 && packet.deliverAtMs === packets[index - 1].deliverAtMs) clumps++;
      if (packet.seq < lastSeq[packet.client]) reordered++;
      lastSeq[packet.client] = packet.seq;
    }
    matrix.push({
      jitterMs,
      lossPercent,
      sent: clients * ticks,
      delivered: packets.length,
      dropped: clients * ticks - packets.length,
      reordered,
      clumps,
      packets,
    });
  }
  return matrix;
}

function connect(url, origin, timeoutMs) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { origin });
    const inbox = [];
    const waiters = [];
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error(`connect timeout: ${url}`));
    }, timeoutMs);
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once('open', () => {
      clearTimeout(timer);
      socket.on('message', raw => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        for (const listener of client.listeners) listener(message);
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index >= 0) {
          const [waiter] = waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else {
          inbox.push(message);
        }
      });
      const client = {
        socket,
        inbox,
        listeners: new Set(),
        send(message) { socket.send(JSON.stringify(message)); },
        waitFor(predicate, label, waitMs = timeoutMs) {
          const queuedIndex = inbox.findIndex(predicate);
          if (queuedIndex >= 0) return Promise.resolve(inbox.splice(queuedIndex, 1)[0]);
          return new Promise((resolveWait, rejectWait) => {
            const waiter = { predicate, resolve: resolveWait };
            waiter.timer = setTimeout(() => {
              const activeIndex = waiters.indexOf(waiter);
              if (activeIndex >= 0) waiters.splice(activeIndex, 1);
              rejectWait(new Error(`message timeout: ${label}`));
            }, waitMs);
            waiters.push(waiter);
          });
        },
      };
      resolve(client);
    });
  });
}

function input(seq) {
  return {
    t: 'input',
    d: {
      f: true, b: false, l: false, r: false,
      jump: false, crouch: false, fire: false, reload: false,
      secondary: false, ability1: false, ability2: false, ultimate: false,
      yaw: 0, pitch: 0, seq, interpMs: 100,
    },
  };
}

function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function dispatchScenario(clients, scenario, sequenceOffset) {
  const startedAt = Date.now();
  await Promise.all(scenario.packets.map(packet => new Promise(resolve => {
    const waitMs = Math.max(0, startedAt + packet.deliverAtMs - Date.now());
    setTimeout(() => {
      clients[packet.client].send(input(sequenceOffset + packet.seq));
      resolve();
    }, waitMs);
  })));
}

export async function runWsSmoke({ url = 'wss://127.0.0.1:8787', origin, seed = 42, ticks = 30, timeoutMs = 7000 } = {}) {
  const parsed = new URL(url);
  const actualOrigin = origin || `${parsed.protocol === 'wss:' ? 'https:' : 'http:'}//${parsed.host}`;
  const clients = [];
  const observations = Array.from({ length: 10 }, () => ({ ack: 0, retired: 0, ackMonotonic: true, retiredMonotonic: true, snapshots: 0, finitePositions: true, maxAbsCoordinate: 0 }));
  const schedule = buildImpairedSchedule({ seed, clients: 10, ticks });
  let staleRejected = false;
  let reconnectJoined = false;
  try {
    for (let index = 0; index < 10; index++) {
      const client = await connect(url, actualOrigin, timeoutMs);
      clients.push(client);
      client.listeners.add(message => {
        if (message.t !== 'snap') return;
        const player = message.snap?.players?.find(candidate => candidate.name === `impair-${index + 1}`);
        if (!player) return;
        const observation = observations[index];
        observation.snapshots++;
        if (Number.isSafeInteger(player.ack)) {
          if (player.ack < observation.ack) observation.ackMonotonic = false;
          observation.ack = player.ack;
        }
        if (Number.isSafeInteger(player.retired)) {
          if (player.retired < observation.retired) observation.retiredMonotonic = false;
          observation.retired = player.retired;
        }
        const coordinates = Array.isArray(player.pos)
          ? player.pos.slice(0, 3)
          : [player.pos?.x, player.pos?.y, player.pos?.z];
        if (!coordinates.every(Number.isFinite)) observation.finitePositions = false;
        else observation.maxAbsCoordinate = Math.max(observation.maxAbsCoordinate, ...coordinates.map(Math.abs));
      });
      client.send({ t: 'join', name: `impair-${index + 1}`, heroId: HEROES[index] });
      const welcome = await client.waitFor(message => message.t === 'welcome', `welcome ${index + 1}`);
      if (welcome.protocolVersion !== PROTOCOL_VERSION) throw new Error(`protocol mismatch for client ${index + 1}`);
      await client.waitFor(message => message.t === 'snap' && message.snap?.players?.some(player => player.name === `impair-${index + 1}`), `initial snapshot ${index + 1}`);
    }

    for (let scenarioIndex = 0; scenarioIndex < schedule.length; scenarioIndex++) {
      await dispatchScenario(clients, schedule[scenarioIndex], scenarioIndex * ticks);
      await delay(500);
    }
    await delay(1000);

    clients[0].send(input(1));
    await clients[0].waitFor(message => message.t === 'error' && message.code === 'stale_input', 'stale input rejection');
    staleRejected = true;

    await new Promise(resolve => {
      clients[0].socket.once('close', resolve);
      clients[0].socket.close();
      setTimeout(resolve, timeoutMs).unref?.();
    });
    await delay(150);
    const replacement = await connect(url, actualOrigin, timeoutMs);
    replacement.send({ t: 'join', name: 'impair-reconnect', heroId: HEROES[0] });
    const replacementWelcome = await replacement.waitFor(message => message.t === 'welcome', 'reconnect welcome');
    await replacement.waitFor(message => message.t === 'snap' && message.snap?.players?.some(player => player.name === 'impair-reconnect'), 'reconnect snapshot');
    reconnectJoined = replacementWelcome.protocolVersion === PROTOCOL_VERSION;
    replacement.socket.close();

    const progressed = observations.every(observation => observation.retired > 0 && observation.snapshots > 0);
    const monotonic = observations.every(observation => observation.ackMonotonic && observation.retiredMonotonic && observation.retired >= observation.ack);
    const finiteAndBounded = observations.every(observation => observation.finitePositions && observation.maxAbsCoordinate < 1000);
    const impairmentObserved = schedule.every(scenario => scenario.dropped > 0) && schedule.some(scenario => scenario.reordered > 0) && schedule.some(scenario => scenario.clumps > 0);
    return {
      schema: 'rc5.ws-impairment.v2',
      pass: progressed && monotonic && finiteAndBounded && staleRejected && reconnectJoined && impairmentObserved,
      url,
      origin: actualOrigin,
      clients: 10,
      ticksPerScenario: ticks,
      schedule: schedule.map(({ packets, ...summary }) => summary),
      observations,
      staleRejected,
      reconnectJoined,
      publicInternet: false,
      tlsVerificationDisabledByHarness: false,
    };
  } finally {
    for (const client of clients) client.socket.close();
  }
}

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/ws_impairment_smoke.js')) {
  const urlIndex = process.argv.indexOf('--url');
  const originIndex = process.argv.indexOf('--origin');
  const url = urlIndex >= 0 ? process.argv[urlIndex + 1] : process.env.KAGARIAI_WS_URL;
  const origin = originIndex >= 0 ? process.argv[originIndex + 1] : undefined;
  if (!url) {
    console.error('Set KAGARIAI_WS_URL or pass --url for a local server');
    process.exitCode = 2;
  } else {
    const result = await runWsSmoke({ url, origin });
    const target = path.resolve(process.cwd(), 'outputs/rc5-network-evidence/ws-impairment.json');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `${JSON.stringify(result, null, 2)}\n`);
    console.log(JSON.stringify(result, null, 2));
    if (!result.pass) process.exitCode = 1;
  }
}
