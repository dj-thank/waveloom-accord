import { WebSocket } from 'ws';
const port = 9333;
const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 256 * 1024 * 1024 });
await new Promise(r => socket.once('open', r));
let nextId = 1; const pending = new Map();
socket.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r?.result?.value; };
await send('Runtime.enable');
const out = await evaluate(`(async () => {
  const mod = await import('/shared/data/map_oshioi_presentation.js');
  const p = mod.OSHIOI_PRESENTATION || mod.default || Object.values(mod).find(v => v && v.layers);
  const CENTERS = { shiogama:[0,0], mizuichi:[56,44], kado:[56,-44], ami:[-56,44], kazami:[-56,-44] };
  const VOCAB = { kiln:'shiogama', market:'mizuichi', dock:'kado', lock:'ami', slip:'kazami' };
  const R = 26;
  const res = {};
  for (const id of Object.keys(CENTERS)) res[id] = { total:0, unique:0, shared:0, layers:new Set(), uniqueLayers:new Set(), foreign:0 };
  for (const l of p.layers) {
    const m = /^clad-([a-z]+)-/.exec(l.id);
    const vocab = m && VOCAB[m[1]] ? VOCAB[m[1]] : null;
    for (const t of l.transforms) {
      const [x,y] = t.position;
      for (const [sid,[cx,cy]] of Object.entries(CENTERS)) {
        if (Math.hypot(x-cx, y-cy) > R) continue;
        const r = res[sid];
        r.total++; r.layers.add(l.id);
        if (vocab === sid) { r.unique++; r.uniqueLayers.add(l.id); }
        else if (vocab) r.foreign++;
        else r.shared++;
      }
    }
  }
  const o = {};
  for (const [k,v] of Object.entries(res)) o[k] = { total:v.total, unique:v.unique, foreignVocab:v.foreign, shared:v.shared,
    layers:v.layers.size, uniqueLayers:v.uniqueLayers.size,
    uniquePct:+(100*v.unique/v.total).toFixed(1) };
  return o;
})()`);
console.log(JSON.stringify(out, null, 1));
socket.close();
