import { writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
function arg(n, f) { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : f; }
const port = Number(arg('port', '9333'));
const out = arg('out', 'outputs/audit-final/prim_cost.json');
const targets = await (await fetch(`http://localhost:${port}/json/list`)).json();
const page = targets.find(t => t.type === 'page');
const socket = new WebSocket(page.webSocketDebuggerUrl, { maxPayload: 64 * 1024 * 1024 });
await new Promise(r => socket.once('open', r));
let nextId = 1; const pending = new Map();
socket.on('message', raw => { const m = JSON.parse(raw.toString()); if (m.id && pending.has(m.id)) { const { resolve, reject } = pending.get(m.id); pending.delete(m.id); if (m.error) reject(new Error(m.error.message)); else resolve(m.result); } });
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); socket.send(JSON.stringify({ id, method, params })); });
const evaluate = async (e) => { const r = await send('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }); if (r?.exceptionDetails) return { __error: r.exceptionDetails.exception?.description || r.exceptionDetails.text }; return r?.result?.value; };
await send('Runtime.enable');
const data = await evaluate(`(async () => {
  const { SceneRenderer } = await import('/client/render.js');
  const f = SceneRenderer.prototype._presentationGeometry;
  const prims = ['box','chamferBox','cylinder','hipRoof','barrelRoof','sawRoof','dodeca','dodecaLow','sphere','plane','archWall','archGate','lattice','colonnade','dome','spire','terrace'];
  const out = {};
  for (const p of prims) {
    try {
      const g = f.call(null, p);
      const n = g.index ? g.index.count / 3 : g.attributes.position.count / 3;
      out[p] = { tri: n, verts: g.attributes.position.count };
    } catch (e) { out[p] = { error: String(e.message) }; }
  }
  return out;
})()`);
console.log(JSON.stringify(data, null, 1));
writeFileSync(out, JSON.stringify(data, null, 2));
socket.close();
