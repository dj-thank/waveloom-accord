import fs from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream';

export const STATIC_STREAM_LIMIT = 32;

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.bin': 'application/octet-stream',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
});

export function contentTypeForPath(file) {
  return MIME[path.extname(String(file || '')).toLowerCase()] || 'application/octet-stream';
}

export function parseSingleByteRange(value, size) {
  if (typeof value !== 'string' || !Number.isSafeInteger(size) || size <= 0) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value.trim());
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= size
    || requestedEnd < start
  ) return null;
  return { start, end: Math.min(size - 1, requestedEnd) };
}

export function makeEntityTag(stat) {
  const size = Math.max(0, Number(stat?.size) || 0);
  const mtimeMs = Math.max(0, Math.trunc(Number(stat?.mtimeMs) || 0));
  return `"${size.toString(16)}-${mtimeMs.toString(16)}"`;
}

function etagMatches(value, etag) {
  return String(value).split(',').some(candidate => {
    const normalized = candidate.trim().replace(/^W\//, '');
    return normalized === '*' || normalized === etag;
  });
}

export function isFreshRequest(headers, etag, mtime) {
  const noneMatch = headers?.['if-none-match'];
  if (noneMatch !== undefined) return etagMatches(noneMatch, etag);
  const modifiedSince = headers?.['if-modified-since'];
  if (!modifiedSince) return false;
  const sinceMs = Date.parse(modifiedSince);
  if (!Number.isFinite(sinceMs)) return false;
  return Math.floor(mtime.getTime() / 1_000) * 1_000 <= sinceMs;
}

export function cacheControlForPath(pathname) {
  const normalized = String(pathname || '').toLowerCase();
  if (normalized.endsWith('.html') || normalized.endsWith('.js')) return 'no-cache';
  if (/\.[a-f0-9]{8,}\.(?:glb|gltf|bin|png|jpe?g|webp|avif|mp3|wav|wasm|css)$/i.test(normalized)) {
    return 'public, max-age=31536000, immutable';
  }
  if (normalized.startsWith('/vendor/')) return 'public, max-age=86400';
  return 'no-cache';
}

export function canStartStaticStream(activeStreams, limit = STATIC_STREAM_LIMIT) {
  return Number.isSafeInteger(activeStreams)
    && Number.isSafeInteger(limit)
    && limit > 0
    && activeStreams < limit;
}

function isInsideRoot(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function createStaticFileResponder({ root, maxConcurrentStreams = STATIC_STREAM_LIMIT } = {}) {
  const resolvedRoot = path.resolve(root || '.');
  const streamLimit = Number.isSafeInteger(maxConcurrentStreams) && maxConcurrentStreams > 0
    ? maxConcurrentStreams
    : STATIC_STREAM_LIMIT;
  let activeStreams = 0;
  let rejectedStreams = 0;

  async function sendFile(req, res, file, { method = 'GET', pathname = '' } = {}) {
    const normalizedFile = path.normalize(file);
    if (!isInsideRoot(resolvedRoot, normalizedFile)) {
      res.writeHead(403);
      res.end();
      return;
    }

    let stat;
    try {
      stat = await fs.promises.stat(normalizedFile);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end(method === 'HEAD' ? undefined : 'not found');
      return;
    }

    const etag = makeEntityTag(stat);
    const lastModified = stat.mtime.toUTCString();
    const commonHeaders = {
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControlForPath(pathname),
      'Content-Type': contentTypeForPath(normalizedFile),
      ETag: etag,
      'Last-Modified': lastModified,
    };
    if (isFreshRequest(req.headers, etag, stat.mtime)) {
      res.writeHead(304, commonHeaders);
      res.end();
      return;
    }

    let range = null;
    if (req.headers.range) {
      range = parseSingleByteRange(req.headers.range, stat.size);
      if (!range) {
        res.writeHead(416, { ...commonHeaders, 'Content-Range': `bytes */${stat.size}` });
        res.end();
        return;
      }
    }
    const start = range?.start ?? 0;
    const end = range?.end ?? Math.max(0, stat.size - 1);
    const contentLength = range ? end - start + 1 : stat.size;
    const responseHeaders = { ...commonHeaders, 'Content-Length': contentLength };
    if (range) responseHeaders['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    const status = range ? 206 : 200;

    if (method === 'HEAD' || stat.size === 0) {
      res.writeHead(status, responseHeaders);
      res.end();
      return;
    }
    if (!canStartStaticStream(activeStreams, streamLimit)) {
      rejectedStreams++;
      res.writeHead(503, {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        'Retry-After': '1',
      });
      res.end('static stream capacity reached');
      return;
    }

    activeStreams++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      activeStreams--;
    };
    const source = fs.createReadStream(normalizedFile, range ? { start, end } : undefined);
    req.once('aborted', () => source.destroy());
    res.once('close', release);
    res.writeHead(status, responseHeaders);
    pipeline(source, res, (error) => {
      release();
      if (error && !res.destroyed) res.destroy(error);
    });
  }

  return {
    sendFile,
    health: () => ({
      activeStreams,
      limit: streamLimit,
      rejectedStreams,
    }),
  };
}
