// 監査用: 層ごとの三角形消費とインスタンス数を出す（ページ内で実測）。
import { writeFileSync, mkdirSync } from 'node:fs';
import { WebSocket } from 'ws';
function arg(n, f) { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : f; }
const url = arg('url', 'http://localhost:8899/client/map-preview.html');
const outdir = arg('outdir', 'outputs/audit-final');
const port = Number(arg('port', '9333'));
mkdirSync(outdir, { recursive: true });
const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => socket.once('open', r));
let nextId = 1; const pending = new Map();
socket.on('message', raw => {
  const m = JSON.parse(raw.toString());
  if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); }
});
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r?.result?.value; };
await send('Page.enable'); await send('Runtime.enable');
await send('Page.navigate', { url });
for (let a = 0; a < 120; a++) { if (await evaluate('!!window.__KAGARIAI_MAP_PREVIEW__')) break; await new Promise(r => setTimeout(r, 500)); }

const data = await evaluate(`(async () => {
  const mod = await import('/shared/data/map_oshioi_presentation.js');
  const p = mod.OSHIOI_PRESENTATION || mod.default || Object.values(mod).find(v => v && v.layers);
  const layers = p.layers.map(l => ({ id: l.id, primitive: l.primitive, material: l.material,
    semantics: l.semantics || null, n: l.transforms.length }));
  return JSON.parse(JSON.stringify({ layers, materials: Object.keys(p.materials) }));
})()`);
writeFileSync(`${outdir}/layers.json`, JSON.stringify(data, null, 2));
console.log(JSON.stringify(data).slice(0, 200));
socket.close();
