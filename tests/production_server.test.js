import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readProductionConfig,
  securityHeaders,
  isOriginAllowed,
  buildHealthPayload,
} from '../server/production.js';

test('ローカル既定値はloopbackで、本番設定は環境変数から厳密に読む', () => {
  assert.deepEqual(readProductionConfig({}, []), {
    host: '127.0.0.1', port: 8787, nodeEnv: 'development', publicOrigin: null,
    shutdownGraceMs: 5000,
  });
  assert.deepEqual(readProductionConfig({
    NODE_ENV: 'production', KAGARIAI_HOST: '0.0.0.0', KAGARIAI_PORT: '9443',
    KAGARIAI_PUBLIC_ORIGIN: 'https://play.example.jp',
    KAGARIAI_SHUTDOWN_GRACE_MS: '9000',
  }, []), {
    host: '0.0.0.0', port: 9443, nodeEnv: 'production', publicOrigin: 'https://play.example.jp',
    shutdownGraceMs: 9000,
  });
});

test('不正なport・environment・originは起動前に拒否する', () => {
  for (const env of [
    { KAGARIAI_PORT: '0' },
    { KAGARIAI_PORT: 'not-a-port' },
    { NODE_ENV: 'staging-ish' },
    { KAGARIAI_PUBLIC_ORIGIN: 'not a url' },
  ]) assert.throws(() => readProductionConfig(env, []));
});

test('HTML応答へCSP等を付け、本番Originは完全一致だけを許可する', () => {
  const config = readProductionConfig({
    NODE_ENV: 'production', KAGARIAI_PUBLIC_ORIGIN: 'https://play.example.jp',
  }, []);
  const headers = securityHeaders(config, '/client/index.html');
  assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
  assert.match(headers['Content-Security-Policy'], /sha256-xKC5iFyQS8Rg2vT8X0L9L5p2MBtIeO2cFdQA\+73n0ZA=/);
  assert.match(headers['Content-Security-Policy'], /connect-src 'self' wss:\/\/play\.example\.jp/);
  assert.match(headers['Content-Security-Policy'], /connect-src[^;]*blob:/);
  assert.doesNotMatch(headers['Content-Security-Policy'], /connect-src[^;]*\bws:\s/);
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.equal(headers['Cache-Control'], 'no-store');
  assert.equal(isOriginAllowed('https://play.example.jp', config), true);
  assert.equal(isOriginAllowed('https://evil.example', config), false);
  assert.equal(isOriginAllowed(undefined, config), false);
});

test('health payloadはready状態と運用カウンタを機械可読で返す', () => {
  assert.deepEqual(buildHealthPayload({
    ready: true, startedAt: 1000, now: 6500, connections: 4,
    matchOrdinal: 3, tickDrops: 2, protocolVersion: 4,
  }), {
    status: 'ok', ready: true, uptimeSec: 5.5, connections: 4,
    matchesStarted: 3, tickDrops: 2, protocolVersion: 4,
  });
});
