#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
} from 'node:path';

function flag(name, fallback = undefined) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const url = flag('url');
if (!url) {
  console.error('Usage: node tools/cdp_preview_audit.mjs --url <http-url> [--mode model|map] [--hero <id>] [--module <url> --factory <export>] [--screenshot <png>] [--out <json>] [--width 660] [--height 660]');
  process.exit(2);
}

const chromeCandidates = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
].filter(Boolean);
const chromePath = chromeCandidates.find(existsSync);
if (!chromePath) throw new Error('CDP_CHROME_NOT_FOUND');

const width = Number(flag('width', '660'));
const height = Number(flag('height', '660'));
const timeoutMs = Number(flag('timeout', '15000'));
const screenshotPath = flag('screenshot');
const outputPath = flag('out');
const expectedHeroId = flag('hero');
const reviewMode = flag('mode', 'model');
if (!['model', 'map'].includes(reviewMode)) {
  console.error('--mode must be model or map');
  process.exit(2);
}
const moduleUrl = flag('module');
const factoryExport = flag('factory');
if (Boolean(moduleUrl) !== Boolean(factoryExport)) {
  console.error('--module and --factory must be provided together');
  process.exit(2);
}

function portableWorkspacePath(input) {
  const workspaceRelative = relative(process.cwd(), resolve(input));
  if (!workspaceRelative
    || isAbsolute(workspaceRelative)
    || /^\.\.(?:[\\/]|$)/.test(workspaceRelative)) {
    throw new Error(`EVIDENCE_PATH_OUTSIDE_WORKSPACE:${input}`);
  }
  return workspaceRelative.replaceAll('\\', '/');
}
mkdirSync(resolve('work'), { recursive: true });
const profilePath = mkdtempSync(resolve('work/cdp-preview-'));

async function freePort() {
  const server = createServer();
  await new Promise((accept, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', accept);
  });
  const { port } = server.address();
  await new Promise((accept) => server.close(accept));
  return port;
}

const port = await freePort();
const chrome = spawn(chromePath, [
  '--headless=new',
  '--no-first-run',
  '--disable-background-networking',
  '--disable-extensions',
  '--disable-features=TranslateUI',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profilePath}`,
  `--window-size=${width},${height}`,
  '--hide-scrollbars',
  'about:blank',
], {
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

const chromeStderr = [];
chrome.stderr.on('data', (chunk) => chromeStderr.push(String(chunk)));

const deadline = Date.now() + timeoutMs;
async function waitFor(fn, label) {
  let lastError;
  while (Date.now() < deadline) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 80));
  }
  throw new Error(`${label}_TIMEOUT${lastError ? `: ${lastError.message}` : ''}`);
}

let socket;
try {
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`);
    if (!response.ok) return null;
    const targets = await response.json();
    return targets.find((target) => target.type === 'page');
  }, 'CDP_TARGET');

  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((accept, reject) => {
    socket.addEventListener('open', accept, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });

  let nextId = 1;
  const pending = new Map();
  const exceptions = [];
  const consoleMessages = [];
  const logEntries = [];
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(String(data));
    if (message.id) {
      const waiter = pending.get(message.id);
      if (!waiter) return;
      pending.delete(message.id);
      if (message.error) waiter.reject(new Error(`${message.error.code}: ${message.error.message}`));
      else waiter.resolve(message.result);
      return;
    }
    if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails);
    if (message.method === 'Runtime.consoleAPICalled') consoleMessages.push(message.params);
    if (message.method === 'Log.entryAdded') logEntries.push(message.params.entry);
  });

  const send = (method, params = {}) => new Promise((accept, reject) => {
    const id = nextId++;
    pending.set(id, { resolve: accept, reject });
    socket.send(JSON.stringify({ id, method, params }));
  });

  await Promise.all([
    send('Runtime.enable'),
    send('Page.enable'),
    send('Log.enable'),
    send('Emulation.setDeviceMetricsOverride', {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false,
    }),
  ]);
  await send('Page.navigate', { url });

  const review = await waitFor(async () => {
    const result = await send('Runtime.evaluate', {
      expression: `(async () => {
        const reviewMode = ${JSON.stringify(reviewMode)};
        const expectedHeroId = ${JSON.stringify(expectedHeroId || null)};
        const moduleUrl = ${JSON.stringify(moduleUrl || null)};
        const factoryExport = ${JSON.stringify(factoryExport || null)};
        // Page.navigate() returns before the replacement document necessarily
        // has a documentElement. Treat that transient as "not ready" rather
        // than recording an audit exception and ending the evidence run.
        if (!document.documentElement) return null;
        if (reviewMode === 'map') {
          const data = { ...document.documentElement.dataset };
          const diagnostics = window.__KAGARIAI_MAP_PREVIEW__ || null;
          let performance = null;
          try { performance = diagnostics?.performance || null; } catch {}
          const contractValid = Boolean(
            data.mapPresentation === 'ready'
            && diagnostics
            && diagnostics.mapId
            && diagnostics.presentationId
            && Number.isFinite(diagnostics.instanceCount)
            && diagnostics.instanceCount > 0
            && Number.isFinite(diagnostics.layerCount)
            && diagnostics.layerCount > 0
            && document.querySelector('canvas')
          );
          return {
            readyState: document.readyState,
            data,
            map: diagnostics ? {
              mapId: diagnostics.mapId,
              presentationId: diagnostics.presentationId,
              instanceCount: diagnostics.instanceCount,
              layerCount: diagnostics.layerCount,
              performance,
            } : null,
            contract: {
              valid: contractValid,
              expectedHeroId: null,
              missingPivots: [],
              missingSockets: [],
            },
            hasCanvas: Boolean(document.querySelector('canvas')),
          };
        }
        const requiredPivots = [
          'root', 'head', 'torso', 'pelvis',
          'leftShoulder', 'rightShoulder', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg',
        ];
        const requiredSockets = ['weapon_primary', 'hand_off', 'back_accessory', 'vfx_origin'];
        const data = { ...document.documentElement.dataset };
        let root = window.reviewModel || null;
        if (!root && moduleUrl && factoryExport) {
          const module = await import(moduleUrl);
          const factory = module[factoryExport];
          if (typeof factory !== 'function') {
            throw new Error(\`MODEL_FACTORY_NOT_FOUND:\${factoryExport}\`);
          }
          root = factory();
          root.updateMatrixWorld?.(true);
        }
        const metadata = root?.userData?.characterModel || root?.userData?.sculptRuntime || null;
        const missingPivots = requiredPivots.filter((key) => {
          const objectName = metadata?.pivots?.[key];
          return !objectName || !root?.getObjectByName?.(objectName);
        });
        const missingSockets = requiredSockets.filter((key) => {
          const objectName = metadata?.sockets?.[key];
          return !objectName || !root?.getObjectByName?.(objectName);
        });
        const rootHeroId = root?.userData?.heroId || metadata?.heroId || null;
        const performance = metadata?.performance || null;
        const contractValid = Boolean(
          root?.isObject3D &&
          metadata &&
          (!expectedHeroId || rootHeroId === expectedHeroId) &&
          metadata.coordinateSystem === 'three-y-up-front-positive-z' &&
          missingPivots.length === 0 &&
          missingSockets.length === 0 &&
          metadata.colliderHints &&
          Object.keys(metadata.colliderHints).length > 0 &&
          Number.isFinite(performance?.triangles) &&
          Number.isFinite(performance?.drawCalls) &&
          Number.isFinite(performance?.textures)
        );
        return {
          readyState: document.readyState,
          data,
          heroId: rootHeroId,
          rootName: root?.name || null,
          metadata,
          contract: {
            valid: contractValid,
            expectedHeroId,
            missingPivots,
            missingSockets,
          },
          hasCanvas: Boolean(document.querySelector('canvas')),
        };
      })()`,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      exceptions.push(result.exceptionDetails);
      return {
        readyState: 'evaluation-error',
        data: {},
        heroId: null,
        rootName: null,
        metadata: null,
        contract: {
          valid: false,
          expectedHeroId,
          missingPivots: [],
          missingSockets: [],
        },
        hasCanvas: false,
      };
    }
    const value = result.result?.value;
    if (!value) return null;
    if (value.contract?.valid === true) return value;
    if (value.data?.reviewReady === 'true') return value;
    if (exceptions.length > 0) return value;
    return null;
  }, 'CDP_REVIEW');

  await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  if (screenshotPath) {
    const capture = await send('Page.captureScreenshot', {
      format: 'png',
      captureBeyondViewport: false,
      fromSurface: true,
    });
    const absoluteScreenshot = resolve(screenshotPath);
    mkdirSync(dirname(absoluteScreenshot), { recursive: true });
    writeFileSync(absoluteScreenshot, Buffer.from(capture.data, 'base64'));
  }

  const simplifyStack = (details) => ({
    text: details.text,
    description: details.exception?.description,
    url: details.url,
    lineNumber: details.lineNumber,
    columnNumber: details.columnNumber,
    stack: details.stackTrace?.callFrames?.slice(0, 12),
  });
  const output = {
    ok: exceptions.length === 0
      && !consoleMessages.some((entry) => entry.type === 'error')
      && review.contract?.valid === true
      && review.data?.reviewContract !== 'invalid',
    url,
    viewport: { width, height },
    review,
    exceptions: exceptions.map(simplifyStack),
    console: consoleMessages.map((entry) => ({
      type: entry.type,
      args: entry.args?.map((arg) => arg.value ?? arg.description),
      stack: entry.stackTrace?.callFrames?.slice(0, 6),
    })),
    logs: logEntries,
    screenshot: screenshotPath ? portableWorkspacePath(screenshotPath) : null,
    output: outputPath ? portableWorkspacePath(outputPath) : null,
  };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;
  if (outputPath) {
    const absoluteOutput = resolve(outputPath);
    mkdirSync(dirname(absoluteOutput), { recursive: true });
    writeFileSync(absoluteOutput, serialized);
  }
  process.stdout.write(serialized);
  process.exitCode = output.ok ? 0 : 1;
} finally {
  try { socket?.close(); } catch {}
  if (chrome.exitCode === null) chrome.kill();
  await new Promise((resolveWait) => {
    if (chrome.exitCode !== null) resolveWait();
    else {
      chrome.once('exit', resolveWait);
      setTimeout(resolveWait, 1500).unref();
    }
  });
  if (flag('keep-profile', '0') !== '1') {
    try { rmSync(profilePath, { recursive: true, force: true }); } catch {}
  }
  if (process.exitCode && chromeStderr.length) {
    console.error(chromeStderr.join('').split(/\r?\n/).filter(Boolean).slice(-30).join('\n'));
  }
}
