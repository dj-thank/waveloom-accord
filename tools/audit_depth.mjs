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
  // 高さ帯（床面 z=4 を基準にした相対高さ）
  const bands = [[0,2],[2,6],[6,10],[10,14],[14,20],[20,28],[28,999]];
  const inPlay = { n:0, band: bands.map(()=>0) };
  const outPlay = { n:0, band: bands.map(()=>0) };
  const matCount = {};
  for (const l of p.layers) {
    for (const t of l.transforms) {
      const [x,y,z] = t.position;
      const top = z + t.scale[2]/2;
      const h = top - 4;
      const bi = bands.findIndex(([a,b]) => h>=a && h<b);
      const tgt = (Math.abs(x)<=126 && Math.abs(y)<=92) ? inPlay : outPlay;
      tgt.n++; if (bi>=0) tgt.band[bi]++;
      matCount[l.material] = (matCount[l.material]||0)+1;
    }
  }
  const tot = Object.values(matCount).reduce((s,v)=>s+v,0);
  const mats = Object.entries(matCount).sort((a,b)=>b[1]-a[1])
    .map(([m,n])=>m+' '+n+' ('+(100*n/tot).toFixed(1)+'%)');
  return JSON.parse(JSON.stringify({ bands, inPlay, outPlay, mats }));
})()`);
console.log(JSON.stringify(out, null, 1));
socket.close();
