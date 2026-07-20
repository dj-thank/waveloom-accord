import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function runReleaseVerifier() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/release_verify.js'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
}

test('release verifier observes a draining server become unready and exit cleanly', {
  timeout: 30_000,
}, async () => {
  const result = await runReleaseVerifier();
  const summaryLine = result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1) || '{}';
  const summary = JSON.parse(summaryLine);

  assert.deepEqual({
    verifierExit: { code: result.code, signal: result.signal },
    ok: summary.ok,
    readyStatus: summary.shutdown?.readyStatus,
    ready: summary.shutdown?.ready,
    websocketCloseCode: summary.shutdown?.websocketCloseCode,
    stubbornPeerClosed: summary.shutdown?.stubbornPeerClosed,
    httpClosed: summary.shutdown?.httpClosed,
    webSocketClosed: summary.shutdown?.webSocketClosed,
    serverExit: summary.shutdown?.exit,
  }, {
    verifierExit: { code: 0, signal: null },
    ok: true,
    readyStatus: 503,
    ready: false,
    websocketCloseCode: 1012,
    stubbornPeerClosed: true,
    httpClosed: true,
    webSocketClosed: true,
    serverExit: { code: 0, signal: null },
  }, result.stderr || result.stdout);
});
