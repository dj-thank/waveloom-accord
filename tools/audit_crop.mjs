import { readFileSync, writeFileSync } from 'node:fs';
import { WebSocket } from 'ws';
function arg(n, f) { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : f; }
const file = arg('file');
const out = arg('out');
const [sx, sy, sw, sh] = arg('rect', '600,400,400,260').split(',').map(Number);
const scale = Number(arg('scale', '3'));
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
const b64 = readFileSync(file).toString('base64');
const res = await evaluate(`(async () => {
  const img = new Image(); img.src = 'data:image/png;base64,${b64}'; await img.decode();
  const c = document.createElement('canvas');
  c.width = ${sw*scale}; c.height = ${sh*scale};
  const g = c.getContext('2d'); g.imageSmoothingEnabled = false;
  g.drawImage(img, ${sx}, ${sy}, ${sw}, ${sh}, 0, 0, c.width, c.height);
  return c.toDataURL('image/png').split(',')[1];
})()`);
writeFileSync(out, Buffer.from(res, 'base64'));
console.log('wrote', out);
socket.close();
