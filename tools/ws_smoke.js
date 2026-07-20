// 実HTTP/WebSocket境界の反復可能なスモーク検証。
// 起動済みサーバーに対して join/select/input/ping/10人上限を確認する。

import WebSocket from 'ws';
import { PROTOCOL_VERSION } from '../server/runtime.js';

const args = process.argv.slice(2);
const urlIndex = args.indexOf('--url');
const WS_URL = urlIndex >= 0 ? args[urlIndex + 1] : 'ws://127.0.0.1:8787';
const originIndex = args.indexOf('--origin');
const parsedUrl = new URL(WS_URL);
const ORIGIN = originIndex >= 0
  ? args[originIndex + 1]
  : `${parsedUrl.protocol === 'wss:' ? 'https:' : 'http:'}//${parsedUrl.host}`;
const TIMEOUT_MS = 5000;

function connect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { origin: ORIGIN });
    const timer = setTimeout(() => reject(new Error(`connect timeout: ${WS_URL}`)), TIMEOUT_MS);
    ws.once('open', () => {
      clearTimeout(timer);
      const inbox = [];
      const waiters = [];
      ws.on('message', raw => {
        let message;
        try { message = JSON.parse(raw.toString()); } catch { return; }
        const index = waiters.findIndex(waiter => waiter.predicate(message));
        if (index >= 0) {
          const [waiter] = waiters.splice(index, 1);
          clearTimeout(waiter.timer);
          waiter.resolve(message);
        } else {
          inbox.push(message);
        }
      });
      resolve({
        ws,
        send(message) { ws.send(JSON.stringify(message)); },
        waitFor(predicate, label) {
          const queuedIndex = inbox.findIndex(predicate);
          if (queuedIndex >= 0) return Promise.resolve(inbox.splice(queuedIndex, 1)[0]);
          return new Promise((resolveWait, rejectWait) => {
            const waiter = {
              predicate,
              resolve: resolveWait,
              timer: setTimeout(() => {
                const activeIndex = waiters.indexOf(waiter);
                if (activeIndex >= 0) waiters.splice(activeIndex, 1);
                rejectWait(new Error(`message timeout: ${label}`));
              }, TIMEOUT_MS),
            };
            waiters.push(waiter);
          });
        },
      });
    });
    ws.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const clients = [];
try {
  const legalHeroes = [
    'zairu', 'vesta',
    'asagi', 'shirasagi', 'tsubakuro', 'hokuchi',
    'tsuzuri', 'koyomi', 'karakasa', 'shirabe',
  ];
  let roleFullRejected = false;
  let primaryInitialState = null;
  for (let i = 0; i < legalHeroes.length; i++) {
    const client = await connect();
    clients.push(client);
    if (i === 2) {
      client.send({ t: 'join', name: `smoke-${i + 1}`, heroId: 'baraga' });
      const roleFull = await client.waitFor(
        message => message.t === 'error' && message.code === 'role_full',
        'role_full',
      );
      roleFullRejected = roleFull.code === 'role_full';
    }
    client.send({ t: 'join', name: `smoke-${i + 1}`, heroId: legalHeroes[i] });
    const welcome = await client.waitFor(message => message.t === 'welcome', `welcome ${i + 1}`);
    assert(welcome.protocolVersion === PROTOCOL_VERSION,
      `protocolVersion must be ${PROTOCOL_VERSION}`);
    assert(welcome.roster?.heroes?.length === 18, 'welcome roster must expose 18 heroes');
    assert(JSON.stringify(welcome.roster?.roleSlots) === JSON.stringify({ frontline: 1, damage: 2, support: 2 }), 'welcome must expose 1/2/2 role slots');
    const initial = await client.waitFor(message => message.t === 'snap', `initial snap ${i + 1}`);
    assert(initial.snap?.players?.length === 10, 'initial snapshot must contain 10 player slots');
    if (i === 0) primaryInitialState = initial.snap?.match?.state || null;
  }

  const overflow = await connect();
  clients.push(overflow);
  overflow.send({ t: 'join', name: 'smoke-overflow', heroId: 'zairu' });
  const full = await overflow.waitFor(
    message => message.t === 'error' && message.code === 'server_full',
    'server_full',
  );
  assert(full.code === 'server_full', '11th client must be rejected');

  const primary = clients[0];
  primary.send({ t: 'select', heroId: 'vesta' });
  const selected = await primary.waitFor(message => message.t === 'select_result', 'select_result');
  if (primaryInitialState === 'SETUP') {
    assert(selected.ok === true && selected.heroId === 'vesta', 'SETUP selection must succeed');
  } else if (!selected.ok) {
    assert(selected.code === 'selection_locked',
      `live-match selection must fail closed, got ${selected.code}`);
  } else {
    assert(selected.heroId === 'vesta', 'respawn-window selection must choose vesta');
  }
  const selectedHero = selected.ok ? 'vesta' : legalHeroes[0];

  const input = {
    f: true, b: false, l: false, r: false,
    jump: false, crouch: false, fire: false, reload: false,
    secondary: false, ability1: false, ability2: false, ultimate: false,
    yaw: 0, pitch: 0, seq: 1, interpMs: 100,
  };
  primary.send({ t: 'input', d: input });
  const acknowledged = await primary.waitFor(
    message => message.t === 'snap' && message.snap?.players?.some(player => player.name === 'smoke-1' && player.ack === 1),
    'input ack',
  );
  assert(acknowledged.snap.players.some(player => player.name === 'smoke-1' && player.heroId === selectedHero),
    'accepted or phase-locked hero selection must replicate consistently');

  primary.send({ t: 'input', d: input });
  await primary.waitFor(
    message => message.t === 'error' && message.code === 'stale_input',
    'stale_input',
  );

  primary.send({ t: 'ping', id: 'smoke' });
  await primary.waitFor(message => message.t === 'pong' && message.id === 'smoke', 'pong');

  console.log(JSON.stringify({
    ok: true,
    url: WS_URL,
    origin: ORIGIN,
    clientsAccepted: 10,
    overflowRejected: true,
    roleFullRejected,
    rosterHeroes: 18,
    selectionState: primaryInitialState,
    selectionOutcome: selected.ok ? 'accepted' : selected.code,
    selectedHero,
    inputAck: 1,
    staleInputRejected: true,
    pong: true,
  }));
} finally {
  for (const client of clients) client.ws.close();
}
