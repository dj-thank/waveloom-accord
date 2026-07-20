const ALLOWED_ENVIRONMENTS = new Set(['development', 'test', 'production']);

function argumentValue(args, name) {
  const index = Array.isArray(args) ? args.indexOf(name) : -1;
  return index >= 0 ? args[index + 1] : undefined;
}

function parsePort(value) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error('KAGARIAI_PORT must be an integer from 1 to 65535');
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    throw new Error('KAGARIAI_PORT must be an integer from 1 to 65535');
  }
  return port;
}

function parseInteger(value, name, min, max) {
  if (!/^[0-9]+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} is outside its safe range`);
  return parsed;
}

function normalizeOrigin(value) {
  if (!value) return null;
  let url;
  try { url = new URL(String(value)); } catch { throw new Error('KAGARIAI_PUBLIC_ORIGIN must be an absolute http(s) origin'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('KAGARIAI_PUBLIC_ORIGIN must contain only an http(s) origin');
  }
  return url.origin;
}

export function readProductionConfig(env = {}, args = []) {
  const nodeEnv = String(env.NODE_ENV || 'development');
  if (!ALLOWED_ENVIRONMENTS.has(nodeEnv)) throw new Error('NODE_ENV must be development, test, or production');
  const host = String(argumentValue(args, '--host') ?? env.KAGARIAI_HOST ?? '127.0.0.1').trim();
  if (!host || /[\s/\\]/.test(host)) throw new Error('KAGARIAI_HOST is invalid');
  const port = parsePort(argumentValue(args, '--port') ?? env.KAGARIAI_PORT ?? '8787');
  const publicOrigin = normalizeOrigin(env.KAGARIAI_PUBLIC_ORIGIN);
  if (nodeEnv === 'production' && !publicOrigin) {
    throw new Error('KAGARIAI_PUBLIC_ORIGIN is required in production');
  }
  return {
    host,
    port,
    nodeEnv,
    publicOrigin,
    shutdownGraceMs: parseInteger(env.KAGARIAI_SHUTDOWN_GRACE_MS ?? '5000', 'KAGARIAI_SHUTDOWN_GRACE_MS', 1000, 30000),
  };
}

export function securityHeaders(config, pathname = '/') {
  const html = pathname === '/' || pathname.endsWith('.html');
  const websocketOrigin = config?.publicOrigin?.replace(/^http(s?):/, 'ws$1:');
  const connectSource = websocketOrigin ? `'self' ${websocketOrigin}` : "'self' ws: wss:";
  const headers = {
    'Content-Security-Policy': `default-src 'self'; script-src 'self' 'sha256-xKC5iFyQS8Rg2vT8X0L9L5p2MBtIeO2cFdQA+73n0ZA='; style-src 'self' 'unsafe-inline'; connect-src ${connectSource} blob:; img-src 'self' data: blob:; font-src 'self'; media-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'`,
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Cache-Control': html ? 'no-store' : 'no-cache',
  };
  if (config?.nodeEnv === 'production' && config?.publicOrigin?.startsWith('https://')) {
    headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  }
  return headers;
}

export function isOriginAllowed(origin, config) {
  if (config?.publicOrigin) {
    if (!origin) return false;
    try { return new URL(origin).origin === config.publicOrigin && String(origin).replace(/\/$/, '') === config.publicOrigin; }
    catch { return false; }
  }
  return config?.nodeEnv !== 'production';
}

export function buildHealthPayload(state = {}) {
  const startedAt = Number(state.startedAt) || 0;
  const now = Number(state.now) || startedAt;
  return {
    status: state.ready ? 'ok' : 'starting',
    ready: !!state.ready,
    uptimeSec: Math.max(0, Math.round((now - startedAt) / 100) / 10),
    connections: Math.max(0, Number(state.connections) || 0),
    matchesStarted: Math.max(0, Number(state.matchOrdinal) || 0),
    tickDrops: Math.max(0, Number(state.tickDrops) || 0),
    protocolVersion: Number(state.protocolVersion) || 0,
  };
}
