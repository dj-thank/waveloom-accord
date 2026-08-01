import { spawn } from 'node:child_process';
import net from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForReady(port, child, stderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${stderr.join('')}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/readyz`);
      if (response.ok) return;
    } catch {
      // The listener is not ready yet.
    }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`server did not become ready: ${stderr.join('')}`);
}

function connectClient(port) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`);
  const inbox = [];
  const waiters = [];
  socket.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const waiterIndex = waiters.findIndex(waiter => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const [waiter] = waiters.splice(waiterIndex, 1);
      clearTimeout(waiter.timer);
      waiter.resolve(message);
    } else {
      inbox.push(message);
    }
  });
  const waitFor = (predicate, label) => {
    const index = inbox.findIndex(predicate);
    if (index >= 0) return Promise.resolve(inbox.splice(index, 1)[0]);
    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve, timer: null };
      waiter.timer = setTimeout(() => {
        const waiterIndex = waiters.indexOf(waiter);
        if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
        reject(new Error(`timed out waiting for ${label}`));
      }, 5_000);
      waiters.push(waiter);
    });
  };
  return { socket, waitFor };
}

function teamRoleCounts(snapshot, team) {
  return snapshot.players
    .filter(player => player.team === team)
    .reduce((counts, player) => ({ ...counts, [player.role]: counts[player.role] + 1 }), {
      frontline: 0, damage: 0, support: 0,
    });
}

function hasContinuousSustain(snapshot, team) {
  return snapshot.players.some(player => (
    player.team === team
    && player.role === 'support'
    && player.teamFunctions?.includes('continuous_sustain')
  ));
}

test('Flashpoint runtime exposes protocol v6 and preserves the fixed 1/2/2 roster through a real bot swap', async (t) => {
  const port = await reservePort();
  const stderr = [];
  const child = spawn(process.execPath, ['server/index.js', '--host', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', KAGARIAI_RELEASE_VERIFY_IPC: '1' },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  child.stderr.on('data', bytes => stderr.push(bytes.toString()));
  t.after(async () => {
    if (child.exitCode === null) {
      child.send({ type: 'kagariai.release.verify.shutdown' });
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('server shutdown timed out')), 5_000);
        child.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  });
  await waitForReady(port, child, stderr);

  const clients = [];
  t.after(() => {
    for (const { socket } of clients) socket.close();
  });
  const client = connectClient(port);
  clients.push(client);
  await once(client.socket, 'open');
  client.socket.send(JSON.stringify({ t: 'join', name: 'runtime-test', heroId: 'botan' }));
  const welcome = await client.waitFor(message => message.t === 'welcome', 'welcome');
  assert.equal(welcome.protocolVersion, 6);
  assert.equal(welcome.mode.id, 'mode_flashpoint');
  assert.equal(welcome.roster.version, 4);
  assert.deepEqual(welcome.roster.roleSlots, { frontline: 1, damage: 2, support: 2 });
  assert.deepEqual(welcome.roster.runtimeCompositionPolicy, {
    teamSize: 5,
    roleSlots: { frontline: 1, damage: 2, support: 2 },
    requireContinuousSustain: true,
  });
  const initial = await client.waitFor(message => message.t === 'snap', 'initial snapshot');
  assert.equal(initial.snap.activeObjectiveId, 'shiogama');
  assert.equal(initial.snap.pendingObjectiveId, null);
  assert.equal(initial.snap.flashpoint.lifecycle, 'active');
  assert.deepEqual(
    initial.snap.objectives.map(objective => objective.id),
    ['shiogama', 'mizuichi', 'kado', 'ami', 'kazami'],
  );
  assert.deepEqual(teamRoleCounts(initial.snap, welcome.team), { frontline: 1, damage: 2, support: 2 });
  assert.equal(hasContinuousSustain(initial.snap, welcome.team), true);

  client.socket.send(JSON.stringify({ t: 'select', heroId: 'zairu' }));
  const swapped = await client.waitFor(message => message.t === 'select_result', 'cross-role select_result');
  assert.deepEqual(swapped, { t: 'select_result', ok: true, heroId: 'zairu' });
  const afterTankSwap = await client.waitFor(message => (
    message.t === 'snap' && message.snap?.players?.some(player => (
      player.id === welcome.id && player.heroId === 'zairu'
    ))
  ), 'tank-swap snapshot');
  assert.deepEqual(teamRoleCounts(afterTankSwap.snap, welcome.team), { frontline: 1, damage: 2, support: 2 });
  assert.equal(afterTankSwap.snap.players.some(player => (
    player.id !== welcome.id && player.team === welcome.team && player.heroId === 'botan'
  )), true, 'the displaced bot must receive the human previous hero');

  client.socket.send(JSON.stringify({ t: 'select', heroId: 'karakasa' }));
  const sustainSafeSwap = await client.waitFor(message => message.t === 'select_result', 'sustain-safe select_result');
  assert.deepEqual(sustainSafeSwap, { t: 'select_result', ok: true, heroId: 'karakasa' });
  const afterSupportSwap = await client.waitFor(message => (
    message.t === 'snap' && message.snap?.players?.some(player => (
      player.id === welcome.id && player.heroId === 'karakasa'
    ))
  ), 'support-swap snapshot');
  assert.deepEqual(teamRoleCounts(afterSupportSwap.snap, welcome.team), { frontline: 1, damage: 2, support: 2 });
  assert.equal(hasContinuousSustain(afterSupportSwap.snap, welcome.team), true);

  for (let index = 0; index < 4; index++) {
    const joining = connectClient(port);
    clients.push(joining);
    await once(joining.socket, 'open');
    joining.socket.send(JSON.stringify({ t: 'join', name: `fill-${index}`, heroId: 'hokuchi' }));
    await joining.waitFor(message => message.t === 'welcome', `fill-${index} welcome`);
  }

  const blocked = connectClient(port);
  clients.push(blocked);
  await once(blocked.socket, 'open');
  blocked.socket.send(JSON.stringify({ t: 'join', name: 'blocked', heroId: 'hokuchi' }));
  const joinError = await blocked.waitFor(message => message.t === 'error', 'join role error');
  assert.equal(joinError.code, 'role_full');
  assert.equal(joinError.role, 'damage');
});
