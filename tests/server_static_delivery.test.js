import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  parseSingleByteRange, makeEntityTag, isFreshRequest,
  cacheControlForPath, contentTypeForPath, canStartStaticStream, createStaticFileResponder,
} from '../server/http_static.js';

test('single byte ranges and static stream ceiling are exact at boundaries', () => {
  assert.deepEqual(parseSingleByteRange('bytes=2-5', 10), { start: 2, end: 5 });
  assert.deepEqual(parseSingleByteRange('bytes=7-', 10), { start: 7, end: 9 });
  assert.deepEqual(parseSingleByteRange('bytes=-3', 10), { start: 7, end: 9 });
  assert.equal(parseSingleByteRange('bytes=10-11', 10), null);
  assert.equal(parseSingleByteRange('bytes=0-1,4-5', 10), null);
  assert.equal(canStartStaticStream(31), true);
  assert.equal(canStartStaticStream(32), false);
});

test('static validators and cache policy distinguish immutable hashes from mutable code', () => {
  const stat = { size: 10, mtimeMs: Date.UTC(2026, 0, 2, 3, 4, 5) };
  const etag = makeEntityTag(stat);
  assert.equal(etag, '"a-19b7ca98c88"');
  assert.equal(isFreshRequest({ 'if-none-match': etag }, etag, new Date(stat.mtimeMs)), true);
  assert.equal(isFreshRequest({ 'if-modified-since': new Date(stat.mtimeMs).toUTCString() }, etag, new Date(stat.mtimeMs)), true);
  assert.equal(cacheControlForPath('/client/index.html'), 'no-cache');
  assert.equal(cacheControlForPath('/client/main.js'), 'no-cache');
  assert.equal(cacheControlForPath('/client/assets/map.0123456789abcdef.glb'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControlForPath('/client/assets/map.glb'), 'no-cache');
  assert.equal(contentTypeForPath('/client/assets/floor.jpg'), 'image/jpeg');
  assert.equal(contentTypeForPath('/client/assets/floor.JPEG'), 'image/jpeg');
  assert.equal(contentTypeForPath('/client/assets/normal.png'), 'image/png');
});

test('real static responder serves HEAD metadata, ranges, validators, and no full Buffer', async (t) => {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kagariai-static-'));
  const file = path.join(tempDir, 'asset.01234567.glb');
  await fs.writeFile(file, 'abcdefghij');
  const responder = createStaticFileResponder({ root: tempDir, maxConcurrentStreams: 32 });
  const server = http.createServer((req, res) => responder.sendFile(req, res, file, {
    method: req.method, pathname: '/asset.01234567.glb',
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(tempDir, { recursive: true, force: true });
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const head = await fetch(base, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), '10');
  assert.equal(await head.text(), '');
  assert.equal(responder.health().activeStreams, 0);

  const partial = await fetch(base, { headers: { Range: 'bytes=2-5' } });
  assert.equal(partial.status, 206);
  assert.equal(partial.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await partial.text(), 'cdef');
  const etag = partial.headers.get('etag');

  const fresh = await fetch(base, { headers: { 'If-None-Match': etag } });
  assert.equal(fresh.status, 304);
  assert.equal(await fresh.text(), '');

  const invalid = await fetch(base, { headers: { Range: 'bytes=20-30' } });
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), 'bytes */10');
  assert.equal(responder.health().activeStreams, 0);
});
