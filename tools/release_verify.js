import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const startupTimeoutMs = 12_000;

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout = `${stdout}${chunk}`.slice(-64_000); });
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk}`.slice(-64_000); });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

async function waitReady(url, child) {
  const deadline = Date.now() + startupTimeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited before ready (${child.exitCode})`);
    try {
      const response = await fetch(url, { cache: 'no-store' });
      const body = await response.json();
      if (response.ok && body.ready === true) return body;
    } catch {
      // The listening socket may not exist yet.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`server did not become ready within ${startupTimeoutMs}ms`);
}

function openWebSocket(url, origin, timeoutMs = 5_000) {
  const socket = new WebSocket(url, { origin });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.terminate();
      reject(new Error(`WebSocket did not open within ${timeoutMs}ms`));
    }, timeoutMs);
    const onError = (error) => {
      clearTimeout(timer);
      reject(error);
    };
    socket.once('error', onError);
    socket.once('open', () => {
      clearTimeout(timer);
      socket.off('error', onError);
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

function openStubbornWebSocket({ host, port, origin }, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port });
    let response = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      reject(new Error(`raw WebSocket did not upgrade within ${timeoutMs}ms`));
    }, timeoutMs);
    const fail = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const onData = (chunk) => {
      response += chunk.toString('latin1');
      const headerEnd = response.indexOf('\r\n\r\n');
      if (headerEnd < 0) return;
      const statusLine = response.slice(0, response.indexOf('\r\n'));
      if (!/^HTTP\/1\.1 101\b/.test(statusLine)) {
        fail(new Error(`raw WebSocket upgrade failed: ${statusLine}`));
        socket.destroy();
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.on('data', () => {});
      resolve(socket);
    };
    socket.on('error', fail);
    socket.on('data', onData);
    socket.once('connect', () => {
      const key = randomBytes(16).toString('base64');
      socket.write([
        'GET / HTTP/1.1',
        `Host: ${host}:${port}`,
        'Upgrade: websocket',
        'Connection: Upgrade',
        `Sec-WebSocket-Key: ${key}`,
        'Sec-WebSocket-Version: 13',
        `Origin: ${origin}`,
        '',
        '',
      ].join('\r\n'));
    });
  });
}

function waitForWebSocketClose(socket, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`WebSocket did not close within ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once('close', (code, reason) => {
      clearTimeout(timer);
      resolve({ code, reason: reason.toString() });
    });
  });
}

function waitForSocketClose(socket, timeoutMs) {
  if (socket.destroyed) return Promise.resolve(true);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`stubborn WebSocket peer stayed open beyond ${timeoutMs}ms`));
    }, timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

async function waitForUnready(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Connection: 'close' },
        signal: AbortSignal.timeout(250),
      });
      const body = await response.json();
      if (response.status === 503 && body.ready === false) {
        return { status: response.status, ready: body.ready };
      }
    } catch {
      // A request can race the listener startup or final HTTP close; keep polling.
    }
    if (child.exitCode !== null || child.signalCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('never observed /readyz return 503 while shutdown was in progress');
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ timedOut: false, code: child.exitCode, signal: child.signalCode });
  }
  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.off('exit', onExit);
      resolve({ timedOut: true, code: null, signal: null });
    }, timeoutMs);
    const onExit = (code, signal) => {
      clearTimeout(timer);
      resolve({ timedOut: false, code, signal });
    };
    child.once('exit', onExit);
  });
}

async function triggerGracefulShutdown(child) {
  if (process.platform !== 'win32') {
    if (!child.kill('SIGTERM')) throw new Error('failed to send SIGTERM to server');
    return 'SIGTERM';
  }
  if (!child.connected) throw new Error('release-verifier IPC channel is not connected');
  await new Promise((resolve, reject) => {
    child.send({ type: 'kagariai.release.verify.shutdown' }, error => error ? reject(error) : resolve());
  });
  return 'IPC';
}

async function stopServer(child) {
  let result = await waitForExit(child, 0);
  if (!result.timedOut) return result;

  if (process.platform === 'win32' && child.connected) {
    try {
      await new Promise((resolve, reject) => {
        child.send({ type: 'kagariai.release.verify.shutdown' }, error => error ? reject(error) : resolve());
      });
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  result = await waitForExit(child, 5_000);
  if (!result.timedOut) return result;

  child.kill('SIGKILL');
  result = await waitForExit(child, 5_000);
  if (!result.timedOut) return result;
  throw new Error('server did not exit after SIGKILL');
}

async function httpEndpointIsClosed(url) {
  try {
    await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(500) });
    return false;
  } catch {
    return true;
  }
}

function webSocketEndpointIsClosed(url, origin, timeoutMs = 1_000) {
  return new Promise(resolve => {
    const socket = new WebSocket(url, { origin });
    let opened = false;
    const timer = setTimeout(() => {
      socket.terminate();
      resolve(false);
    }, timeoutMs);
    socket.once('open', () => {
      opened = true;
      clearTimeout(timer);
      socket.terminate();
      resolve(false);
    });
    socket.once('error', () => {
      if (opened) return;
      clearTimeout(timer);
      resolve(true);
    });
  });
}

const port = await reservePort();
const origin = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/index.js'], {
  cwd: root,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    KAGARIAI_HOST: '127.0.0.1',
    KAGARIAI_PORT: String(port),
    KAGARIAI_PUBLIC_ORIGIN: origin,
    KAGARIAI_SHUTDOWN_GRACE_MS: '2000',
    KAGARIAI_RELEASE_VERIFY_IPC: '1',
  },
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});
let serverStdout = '';
let serverStderr = '';
server.stdout.on('data', chunk => { serverStdout = `${serverStdout}${chunk}`.slice(-64_000); });
server.stderr.on('data', chunk => { serverStderr = `${serverStderr}${chunk}`.slice(-64_000); });

let failure;
let report;
let gracefulShutdownStarted = false;
let closingSocket;
let stubbornSocket;
try {
  const ready = await waitReady(`${origin}/readyz`, server);
  const smoke = await run(process.execPath, ['tools/ws_smoke.js', '--url', `ws://127.0.0.1:${port}`], { cwd: root });
  if (smoke.code !== 0) throw new Error(`WebSocket smoke failed\n${smoke.stdout}\n${smoke.stderr}`);
  const summaryLine = smoke.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
  const summary = JSON.parse(summaryLine);
  if (summary.ok !== true) throw new Error(`WebSocket smoke did not report ok: ${summaryLine}`);

  const webSocketUrl = `ws://127.0.0.1:${port}`;
  closingSocket = await openWebSocket(webSocketUrl, origin);
  stubbornSocket = await openStubbornWebSocket({ host: '127.0.0.1', port, origin });
  const closing = waitForWebSocketClose(closingSocket, 5_000);
  const stubbornClosed = waitForSocketClose(stubbornSocket, 5_000);
  const becameUnready = waitForUnready(`${origin}/readyz`, server, 2_000);
  const exited = waitForExit(server, 5_000);

  const trigger = await triggerGracefulShutdown(server);
  gracefulShutdownStarted = true;
  const [unready, webSocketClose, rawPeerClosed, exit] = await Promise.all([
    becameUnready, closing, stubbornClosed, exited,
  ]);
  if (webSocketClose.code !== 1012) {
    throw new Error(`shutdown WebSocket close code was ${webSocketClose.code}, expected 1012`);
  }
  if (!rawPeerClosed) throw new Error('stubborn WebSocket peer was not terminated');
  if (exit.timedOut || exit.code !== 0 || exit.signal !== null) {
    throw new Error(`server shutdown was not clean: ${JSON.stringify(exit)}`);
  }
  const [httpClosed, webSocketClosed] = await Promise.all([
    httpEndpointIsClosed(`${origin}/healthz`),
    webSocketEndpointIsClosed(webSocketUrl, origin),
  ]);
  if (!httpClosed || !webSocketClosed) {
    throw new Error(`server endpoints remained open: ${JSON.stringify({ httpClosed, webSocketClosed })}`);
  }
  report = {
    ok: true,
    port,
    ready,
    smoke: summary,
    shutdown: {
      trigger,
      readyStatus: unready.status,
      ready: unready.ready,
      websocketCloseCode: webSocketClose.code,
      stubbornPeerClosed: rawPeerClosed,
      httpClosed,
      webSocketClosed,
      exit: { code: exit.code, signal: exit.signal },
    },
  };
} catch (error) {
  failure = error;
} finally {
  closingSocket?.terminate();
  stubbornSocket?.destroy();
  try {
    const exit = await stopServer(server);
    if (!failure && !gracefulShutdownStarted && (exit.code !== 0 || exit.signal !== null)) {
      failure = new Error(`server cleanup was not clean: ${JSON.stringify(exit)}`);
    }
  } catch (error) {
    failure ||= error;
  }
}

if (failure) {
  console.error(failure.stack || failure.message || failure);
  if (serverStdout) console.error(serverStdout);
  if (serverStderr) console.error(serverStderr);
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(report));
}
