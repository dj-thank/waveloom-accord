// 監査用: 全視点で calls / triangles / instances / 層数を実測する。
// 使い方: node tools/audit_perf_views.mjs --outdir outputs/audit-x
import { writeFileSync, mkdirSync } from 'node:fs';
import { WebSocket } from 'ws';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : fallback;
}
const url = arg('url', 'http://localhost:8899/client/map-preview.html');
const outdir = arg('outdir', 'outputs/audit-perf2');
const port = Number(arg('port', '9333'));
const width = Number(arg('width', '1600'));
const height = Number(arg('height', '900'));
const views = arg('views', 'aerial,network,objective,spawn,orbit,site-shiogama,site-mizuichi,site-kado,site-ami,site-kazami')
  .split(',').map(v => v.trim()).filter(Boolean);

mkdirSync(outdir, { recursive: true });
const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
let page = targets.find(t => t.type === 'page');
if (!page) page = await (await fetch(`http://localhost:${port}/json/new?about:blank`)).json();
const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => socket.once('open', r));
let nextId = 1;
const pending = new Map();
socket.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) {
    const { resolve, reject } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (expression) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (r?.exceptionDetails) return { __error: r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description || '') };
  return r?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
for (let a = 0; a < 120; a++) {
  if (await evaluate('!!window.__KAGARIAI_MAP_PREVIEW__')) break;
  await new Promise(r => setTimeout(r, 500));
}

const globalInfo = await evaluate(`(() => {
  const p = window.__KAGARIAI_MAP_PREVIEW__;
  return { instanceCount: p.instanceCount, layerCount: p.layerCount, siteCount: p.siteCount,
           mapId: p.mapId, presentationId: p.presentationId };
})()`);
console.log('GLOBAL', JSON.stringify(globalInfo));

const report = [];
for (const view of views) {
  await evaluate(`window.__KAGARIAI_MAP_PREVIEW__.setView(${JSON.stringify(view)})`);
  await new Promise(r => setTimeout(r, 1600));
  const stats = await evaluate(`(() => {
    const p = window.__KAGARIAI_MAP_PREVIEW__;
    const s = p.performance;
    const ri = s?.rendererInfo || s?.renderer || null;
    return JSON.parse(JSON.stringify({ snapshot: s, rendererInfo: ri }));
  })()`);
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(`${outdir}/${view}.png`, Buffer.from(shot.data, 'base64'));
  report.push({ view, stats });
  const r = stats?.rendererInfo?.render || stats?.snapshot?.rendererInfo?.render || {};
  console.log(`${view.padEnd(16)} calls=${r.calls ?? '?'} tris=${r.triangles ?? '?'} pts=${r.points ?? '?'} lines=${r.lines ?? '?'}`);
}
writeFileSync(`${outdir}/report.json`, JSON.stringify({ globalInfo, report }, null, 2));
socket.close();
