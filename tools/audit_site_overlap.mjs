// 4拠点が「同じ広場の貼り替え」かを幾何で測る。
// 各拠点中心からの相対座標に正規化し、(相対位置, スケール) が一致する
// インスタンスの割合を拠点間で比較する。層IDが同じかどうかも見る。
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
  const C = { mizuichi:[56,44], kado:[56,-44], ami:[-56,44], kazami:[-56,-44] };
  const R = 24;
  const q = v => Math.round(v*4)/4;
  const sets = {}; const mats = {};
  for (const k of Object.keys(C)) { sets[k] = new Map(); mats[k] = {}; }
  for (const l of p.layers) {
    for (const t of l.transforms) {
      const [x,y,z] = t.position;
      for (const [sid,[cx,cy]] of Object.entries(C)) {
        if (Math.abs(x-cx)>R || Math.abs(y-cy)>R) continue;
        // 東西/南北の鏡像を吸収して比較（拠点は対称配置）
        const rx = Math.abs(x-cx), ry = Math.abs(y-cy);
        const geoKey = q(rx)+','+q(ry)+','+q(z)+'|'+q(t.scale[0])+','+q(t.scale[1])+','+q(t.scale[2]);
        sets[sid].set(geoKey, (sets[sid].get(geoKey)||0)+1);
        mats[sid][l.material] = (mats[sid][l.material]||0)+1;
      }
    }
  }
  const ids = Object.keys(C);
  const pairs = [];
  for (let i=0;i<ids.length;i++) for (let j=i+1;j<ids.length;j++) {
    const a = sets[ids[i]], b = sets[ids[j]];
    let inter = 0;
    for (const [k,v] of a) if (b.has(k)) inter += Math.min(v, b.get(k));
    const na = [...a.values()].reduce((s,v)=>s+v,0);
    const nb = [...b.values()].reduce((s,v)=>s+v,0);
    pairs.push({ pair: ids[i]+'/'+ids[j], na, nb, sharedGeom: inter,
      pctA: +(100*inter/na).toFixed(1), pctB: +(100*inter/nb).toFixed(1) });
  }
  const matTop = {};
  for (const k of ids) {
    const tot = Object.values(mats[k]).reduce((s,v)=>s+v,0);
    matTop[k] = { total: tot, top: Object.entries(mats[k]).sort((x,y)=>y[1]-x[1]).slice(0,6)
      .map(([m,n])=>m+':'+(100*n/tot).toFixed(0)+'%') };
  }
  return JSON.parse(JSON.stringify({ pairs, matTop }));
})()`);
console.log(JSON.stringify(out, null, 1));
socket.close();
