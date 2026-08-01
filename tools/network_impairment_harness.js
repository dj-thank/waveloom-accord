import fs from 'node:fs';
import path from 'node:path';
import { receiveInputCommand, createLagCompensationTracker } from '../server/runtime.js';
import { retirePendingInputs } from '../client/prediction.js';

const DEFAULTS = {
  seed: 0x5eedc0de,
  clients: 10,
  ticks: 240,
  baseDelayMs: 40,
  baseDelaysMs: [0, 40, 100, 200],
  inputRatesHz: [30, 60, 120],
  jitterValuesMs: [20, 100],
  lossValuesPercent: [1, 5, 10],
  tickMs: 16,
  maxPositionError: 64,
};

function rng(seed) {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 0x100000000; };
}

function impair(messages, opts, random) {
  const queue = [];
  let dropped = 0;
  for (const m of messages) {
    if (random() < opts.lossPercent / 100) { dropped++; continue; }
    const jitter = opts.jitterMs ? Math.floor(random() * (opts.jitterMs * 2 + 1)) - opts.jitterMs : 0;
    let delay = Math.max(0, opts.baseDelayMs + jitter);
    if (opts.clump && m.seq % 5 === 0) delay = opts.baseDelayMs;
    queue.push({ ...m, deliverAt: m.sentAt + delay, delay });
  }
  // Deterministic clumping/reordering: stable sort, then swap selected adjacent pairs.
  queue.sort((a, b) => a.deliverAt - b.deliverAt || a.client - b.client || a.seq - b.seq);
  let reordered = 0, clumps = 0;
  for (let i = 1; i < queue.length; i++) {
    if (queue[i].deliverAt === queue[i - 1].deliverAt) clumps++;
    if (random() < (opts.reorder ? 0.12 : 0)) {
      [queue[i - 1], queue[i]] = [queue[i], queue[i - 1]]; reordered++;
    }
  }
  return { queue, dropped, reordered, clumps };
}

function scenario(options, jitterMs, lossPercent, baseDelayMs, inputRateHz) {
  const random = rng((options.seed ^ (jitterMs * 131) ^ (lossPercent * 977)
    ^ (baseDelayMs * 37) ^ (inputRateHz * 53)) >>> 0);
  const clients = Array.from({ length: options.clients }, () => ({ next: 1, pending: [], predicted: 0, reconnects: 0 }));
  const messages = [];
  for (let tick = 0; tick < options.ticks; tick++) {
    for (let client = 0; client < clients.length; client++) {
      const c = clients[client];
      if (tick === 120) { c.reconnects++; c.pending = []; }
      const direction = ((tick + client) % 7 < 3) ? 1 : -1;
      const seq = c.next++;
      c.pending.push({ seq, direction });
      c.predicted += direction;
      messages.push({ client, seq, direction, sentAt: tick * (1000 / inputRateHz) });
    }
  }
  const impaired = impair(messages, { jitterMs, lossPercent, baseDelayMs, clump: true, reorder: true }, random);
  const auth = clients.map(() => ({ pos: 0, ack: 0, lastReceive: -Infinity, leaseExpired: false }));
  const deliveries = [...impaired.queue].sort((a, b) => a.deliverAt - b.deliverAt);
  const ackHistory = Array.from({ length: clients.length }, () => []);
  let maxError = 0, converged = 0, leaseExpirations = 0;
  const queues = clients.map(() => []);
  const worlds = clients.map((_, i) => ({ queueInputResult: (_id, input) => { queues[i].push(input); return { ok: true }; } }));
  const conns = clients.map((_, i) => ({ playerId: `p${i}`, lagCompensation: createLagCompensationTracker({ now: () => 0 }) }));
  for (const m of deliveries) {
    const result = receiveInputCommand(worlds[m.client], conns[m.client], {
      f: m.direction > 0, b: m.direction < 0, moveX: m.direction, moveY: 0,
      yaw: 0, pitch: 0, seq: m.seq, interpMs: 100,
    }, m.deliverAt);
    if (result.ok) auth[m.client].lastReceive = m.deliverAt;
  }
  for (let i = 0; i < clients.length; i++) {
    const s = auth[i];
    const sorted = queues[i].sort((a, b) => a.seq - b.seq);
    let expected = 1;
    for (const input of sorted) {
      if (input.seq !== expected) break;
      s.pos += input.moveX || 0; s.ack = input.seq; expected++;
      ackHistory[i].push(s.ack);
    }
    const pendingAfterAck = retirePendingInputs(clients[i].pending, { ack: s.ack, retired: s.ack });
    clients[i].pending = pendingAfterAck;
  }
  const horizon = options.ticks * (1000 / inputRateHz) + baseDelayMs + jitterMs + 100;
  for (let i = 0; i < auth.length; i++) {
    const s = auth[i];
    if (horizon - s.lastReceive > 3 * options.tickMs) { s.leaseExpired = true; leaseExpirations++; }
    const err = Math.abs(clients[i].predicted - s.pos);
    maxError = Math.max(maxError, err);
    if (err <= options.maxPositionError) converged++;
  }
  const ackMonotonic = ackHistory.every(h => h.every((v, i) => i === 0 || v >= h[i - 1]));
  const delays = impaired.queue.map(m => m.delay);
  return { baseDelayMs, inputRateHz, jitterMs, lossPercent, sent: messages.length, delivered: impaired.queue.length, dropped: impaired.dropped,
    observedLossPercent: Number((impaired.dropped / messages.length * 100).toFixed(3)),
    delayMinMs: Math.min(...delays), delayMaxMs: Math.max(...delays), reordered: impaired.reordered, clumps: impaired.clumps,
    maxPositionError: maxError, convergedClients: converged, ackMonotonic, leaseExpirations, reconnects: clients.reduce((n, c) => n + c.reconnects, 0) };
}

export function runHarness(input = {}) {
  const options = { ...DEFAULTS, ...input };
  const baseDelaysMs = input.baseDelayMs !== undefined
    ? [input.baseDelayMs]
    : (input.baseDelaysMs ?? DEFAULTS.baseDelaysMs);
  const inputRatesHz = input.inputRateHz !== undefined
    ? [input.inputRateHz]
    : (input.inputRatesHz ?? DEFAULTS.inputRatesHz);
  const jitterValuesMs = input.jitterMs !== undefined
    ? [input.jitterMs]
    : (input.jitterValuesMs ?? DEFAULTS.jitterValuesMs);
  const lossValuesPercent = input.lossPercent !== undefined
    ? [input.lossPercent]
    : (input.lossValuesPercent ?? DEFAULTS.lossValuesPercent);
  const matrix = baseDelaysMs.flatMap(baseDelayMs => inputRatesHz.flatMap(inputRateHz => (
    jitterValuesMs.flatMap(jitterMs => lossValuesPercent.map(lossPercent => (
      scenario(options, jitterMs, lossPercent, baseDelayMs, inputRateHz)
    )))
  )));
  const metrics = {
    reordered: matrix.reduce((n, x) => n + x.reordered, 0), clumps: matrix.reduce((n, x) => n + x.clumps, 0),
    maxPositionError: Math.max(...matrix.map(x => x.maxPositionError)), ackMonotonic: matrix.every(x => x.ackMonotonic),
    reconnects: Math.max(...matrix.map(x => x.reconnects)), leaseExpirations: Math.max(...matrix.map(x => x.leaseExpirations)),
    baseDelaysMs: [...new Set(matrix.map(x => x.baseDelayMs))].sort((a, b) => a - b),
    inputRatesHz: [...new Set(matrix.map(x => x.inputRateHz))].sort((a, b) => a - b),
  };
  const pass = matrix.every(x => x.delayMinMs >= Math.max(0, x.baseDelayMs - x.jitterMs)
    && x.delayMaxMs <= x.baseDelayMs + x.jitterMs
    && x.ackMonotonic
    && x.maxPositionError <= options.maxPositionError
    && x.reconnects >= 1)
    && metrics.reordered > 0
    && metrics.clumps > 0;
  return { schema: 'rc5.network-impairment.v1', pass, seed: options.seed, clients: options.clients, ticks: options.ticks, thresholds: { maxPositionError: options.maxPositionError }, matrix, metrics };
}

export function stableEvidence(evidence) { return JSON.parse(JSON.stringify(evidence)); }

if (process.argv[1]?.replaceAll('\\', '/').endsWith('/network_impairment_harness.js')) {
  const out = runHarness();
  const outPath = path.resolve(process.cwd(), 'outputs/rc5-network-evidence/network-impairment.json');
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(out, null, 2));
  if (!out.pass) process.exitCode = 1;
}
