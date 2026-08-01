// 画像の色分布を実測する（暖色/寒色/金の面積比）。
import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';
function arg(n, f) { const i = process.argv.indexOf(`--${n}`); return i > -1 ? process.argv[i + 1] : f; }
const files = arg('files', '').split(',').filter(Boolean);
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
for (const f of files) {
  const b64 = readFileSync(f).toString('base64');
  const res = await evaluate(`(async () => {
    const img = new Image();
    img.src = 'data:image/png;base64,${b64}';
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0);
    // 左上のUIパネル (x<450,y<300) を除外
    const d = g.getImageData(0,0,c.width,c.height).data;
    let warm=0, cool=0, gold=0, neutral=0, total=0, sumL=0, sumC=0;
    for (let y=0;y<c.height;y+=2) for (let x=0;x<c.width;x+=2) {
      if (x<460 && y<300) continue;
      const i=(y*c.width+x)*4;
      const R=d[i],G=d[i+1],B=d[i+2];
      const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
      const L=(mx+mn)/2/255, C=(mx-mn)/255;
      total++; sumL+=L; sumC+=C;
      if (C<0.10) { neutral++; continue; }
      if (R>B+18) { warm++; if (R>150 && G>110 && B<130 && R-B>60) gold++; }
      else if (B>R+18) cool++;
      else neutral++;
    }
    return { file:'${f.replace(/\\\\/g,'/')}', total, warmPct:+(100*warm/total).toFixed(1), coolPct:+(100*cool/total).toFixed(1),
             goldPct:+(100*gold/total).toFixed(1), neutralPct:+(100*neutral/total).toFixed(1),
             meanL:+(sumL/total).toFixed(3), meanC:+(sumC/total).toFixed(3) };
  })()`);
  console.log(JSON.stringify(res));
}
socket.close();
