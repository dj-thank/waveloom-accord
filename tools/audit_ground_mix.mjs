import { writeFileSync } from 'node:fs';
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
  const g = await import('/shared/data/map_oshioi_ground.js');
  const L = g.GROUND_LAYERS;
  const OBJ = [[0,0],[56,44],[56,-44],[-56,44],[-56,-44]];
  const dist = (x,y) => Math.min(...OBJ.map(([a,b])=>Math.hypot(x-a,y-b)));
  const res = {};
  const bands = [[0,8],[8,16],[16,26],[26,40],[40,60],[60,999]];
  for (const l of L) {
    res[l.id] = { n: l.transforms.length, band: bands.map(()=>0), area: 0 };
    for (const t of l.transforms) {
      const d = dist(t.position[0], t.position[1]);
      const bi = bands.findIndex(([a,b]) => d>=a && d<b);
      if (bi>=0) res[l.id].band[bi]++;
      res[l.id].area += t.scale[0]*t.scale[1];
    }
  }
  return JSON.parse(JSON.stringify({ bands, res }));
})()`);
console.log(JSON.stringify(out, null, 1));
socket.close();
