// 複数視点のスクリーンショットを撮る。
// 既存の cdp_preview_audit.mjs は視点を選べないので、setView() を叩いて連続撮影する。
// 使い方: node tools/capture_map_views.mjs --url <http-url> --outdir <dir> [--port 9333]
//         （--port の Chrome は --remote-debugging-port で起動済みであること）

import { writeFileSync, mkdirSync } from 'node:fs';
import { WebSocket } from 'ws';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const url = arg('url', 'http://localhost:8899/client/map-preview.html');
const outdir = arg('outdir', 'outputs/views');
const port = Number(arg('port', '9333'));
const width = Number(arg('width', '1600'));
const height = Number(arg('height', '900'));
const views = arg('views', 'aerial,network,objective,spawn,site-mizuichi,site-kado,site-ami,site-kazami')
  .split(',').map(v => v.trim()).filter(Boolean);

mkdirSync(outdir, { recursive: true });

const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
let page = targets.find(t => t.type === 'page');
if (!page) {
  page = await (await fetch(`http://localhost:${port}/json/new?about:blank`)).json();
}

const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(resolve => socket.once('open', resolve));

let nextId = 1;
const pending = new Map();
socket.on('message', raw => {
  const message = JSON.parse(raw.toString());
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message));
    else resolve(message.result);
  }
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = nextId++;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluate = async (expression) => {
  const result = await send('Runtime.evaluate', {
    expression, awaitPromise: true, returnByValue: true,
  });
  return result?.result?.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width, height, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url });

// 診断オブジェクトが立つまで待つ（three のロードとシーン構築の完了信号）
for (let attempt = 0; attempt < 120; attempt++) {
  if (await evaluate('!!window.__KAGARIAI_MAP_PREVIEW__')) break;
  await new Promise(r => setTimeout(r, 500));
}
if (!await evaluate('!!window.__KAGARIAI_MAP_PREVIEW__')) {
  throw new Error('MAP_PREVIEW_NOT_READY');
}

const report = [];
for (const view of views) {
  const applied = await evaluate(
    `(() => { const p = window.__KAGARIAI_MAP_PREVIEW__;
       try { p.setView(${JSON.stringify(view)}); return true; } catch (e) { return String(e.message); } })()`,
  );
  // カメラ移動とフレーム描画の落ち着きを待つ
  await new Promise(r => setTimeout(r, 1400));
  const stats = await evaluate(
    `(() => { const p = window.__KAGARIAI_MAP_PREVIEW__;
       const r = p.renderer || p.getRenderer?.();
       const info = r?.info?.render;
       return info ? { calls: info.calls, triangles: info.triangles } : null; })()`,
  );
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const file = `${outdir}/${view}.png`;
  writeFileSync(file, Buffer.from(shot.data, 'base64'));
  report.push({ view, applied, ...(stats || {}), file });
  console.log(`${view.padEnd(16)} applied=${applied} calls=${stats?.calls ?? '?'} tris=${stats?.triangles ?? '?'} -> ${file}`);
}

writeFileSync(`${outdir}/report.json`, JSON.stringify(report, null, 2));
socket.close();
