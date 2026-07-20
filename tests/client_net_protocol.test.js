import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Net } from '../client/net.js';
import { PROTOCOL_VERSION } from '../shared/protocol.js';

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 1;
    this.closed = null;
    FakeWebSocket.instances.push(this);
  }

  close(code, reason) {
    this.closed = { code, reason };
    this.readyState = 3;
  }

  send() {}
}

test('Net rejects an incompatible welcome before exposing it to the client', () => {
  const originalLocation = globalThis.location;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.location = { protocol: 'http:', host: 'example.test' };
  globalThis.WebSocket = FakeWebSocket;
  try {
    const net = new Net();
    const mismatches = [];
    const welcomes = [];
    const snaps = [];
    const selections = [];
    const serverErrors = [];
    net.onProtocolMismatch = value => mismatches.push(value);
    net.onWelcome = value => welcomes.push(value);
    net.onSnap = (...value) => snaps.push(value);
    net.onSelectResult = value => selections.push(value);
    net.onServerError = value => serverErrors.push(value);
    net.connect('player', 'asagi');
    const socket = FakeWebSocket.instances.at(-1);

    socket.onmessage({ data: JSON.stringify({ t: 'welcome', protocolVersion: PROTOCOL_VERSION - 1 }) });
    socket.onmessage({ data: JSON.stringify({ t: 'snap', snap: { tick: 1 }, events: [{ type: 'shot' }] }) });
    socket.onmessage({ data: JSON.stringify({ t: 'select_result', ok: true, heroId: 'asagi' }) });
    socket.onmessage({ data: JSON.stringify({ t: 'error', code: 'server_error' }) });

    assert.deepEqual(mismatches, [{ expected: PROTOCOL_VERSION, received: PROTOCOL_VERSION - 1 }]);
    assert.deepEqual(welcomes, []);
    assert.deepEqual(snaps, [], 'queued snapshots from an incompatible server stay hidden');
    assert.deepEqual(selections, [], 'queued selection results from an incompatible server stay hidden');
    assert.deepEqual(serverErrors, [], 'queued errors from an incompatible server stay hidden');
    assert.deepEqual(socket.closed, { code: 1002, reason: 'unsupported protocol version' });
  } finally {
    globalThis.location = originalLocation;
    globalThis.WebSocket = originalWebSocket;
  }
});

test('Net accepts the shared protocol version', () => {
  const originalLocation = globalThis.location;
  const originalWebSocket = globalThis.WebSocket;
  globalThis.location = { protocol: 'http:', host: 'example.test' };
  globalThis.WebSocket = FakeWebSocket;
  try {
    const net = new Net();
    const welcomes = [];
    const snaps = [];
    const selections = [];
    const serverErrors = [];
    net.onWelcome = value => welcomes.push(value);
    net.onSnap = (...value) => snaps.push(value);
    net.onSelectResult = value => selections.push(value);
    net.onServerError = value => serverErrors.push(value);
    net.connect('player', 'asagi');
    const socket = FakeWebSocket.instances.at(-1);
    const welcome = { t: 'welcome', protocolVersion: PROTOCOL_VERSION };
    const snapshot = { tick: 1 };
    const events = [{ type: 'shot' }];
    const selection = { t: 'select_result', ok: true, heroId: 'asagi' };
    const serverError = { t: 'error', code: 'server_error' };

    socket.onmessage({ data: JSON.stringify(welcome) });
    socket.onmessage({ data: JSON.stringify({ t: 'snap', snap: snapshot, events }) });
    socket.onmessage({ data: JSON.stringify(selection) });
    socket.onmessage({ data: JSON.stringify(serverError) });

    assert.deepEqual(welcomes, [welcome]);
    assert.deepEqual(snaps, [[snapshot, events]]);
    assert.deepEqual(selections, [selection]);
    assert.deepEqual(serverErrors, [serverError]);
    assert.equal(socket.closed, null);
  } finally {
    globalThis.location = originalLocation;
    globalThis.WebSocket = originalWebSocket;
  }
});
