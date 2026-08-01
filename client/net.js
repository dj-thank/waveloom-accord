// WebSocket 通信・RTT計測（PROTOCOL.md 準拠）
// - join / input / ping / restart を送信
// - welcome / snap / pong を受信してコールバックに配る
// - interpMs: 既定100ms。RTTが大きいときは増やす（サーバー許容上限220ms）

import {
  PROTOCOL_VERSION, LAG_COMPENSATION_POLICY, isSupportedProtocolVersion,
} from '../shared/protocol.js';

export class Net {
  constructor() {
    this.ws = null;
    this.rtt = 0;        // 直近RTT (ms)
    this.rttEma = 0;     // 平滑RTT (ms)
    this.connected = false;
    this.onWelcome = null;   // (msg) => void
    this.onProtocolMismatch = null; // ({ expected, received }) => void
    this.onSnap = null;      // (snap, events) => void
    this.onClose = null;     // () => void
    this.onError = null;     // () => void
    this.onServerError = null; // (msg) => void
    this.onSelectResult = null; // (msg) => void
    this._pingId = 0;
    this._pingSent = new Map();  // id -> performance.now()
    this._pingTimer = 0;
    this._protocolRejected = false;
  }

  connect(name, heroId) {
    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    // Tailscale Serve and other reverse proxies may mount the game below a
    // path (for example /kagariai) while keeping the same static asset root.
    // Preserve that path for the WebSocket handshake; root deployments still
    // use the protocol's historical `/` endpoint.
    const pathname = typeof location.pathname === 'string' ? location.pathname : '/';
    const websocketPath = pathname === '/'
      ? '/'
      : `${pathname.replace(/\/+$/, '')}/`;
    const ws = new WebSocket(`${proto}${location.host}${websocketPath}`);
    this.ws = ws;
    this._protocolRejected = false;
    ws.onopen = () => {
      this.connected = true;
      this.send({ t: 'join', name, heroId });
      this.ping();
      this._pingTimer = setInterval(() => this.ping(), 2000); // 2秒毎
    };
    ws.onmessage = (ev) => {
      if (this.ws !== ws || this._protocolRejected) return;
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') {
        if (!isSupportedProtocolVersion(msg.protocolVersion)) {
          this._protocolRejected = true;
          this.onProtocolMismatch?.({
            expected: PROTOCOL_VERSION,
            received: msg.protocolVersion ?? null,
          });
          ws.close(1002, 'unsupported protocol version');
          return;
        }
        this.onWelcome?.(msg);
      }
      else if (msg.t === 'snap') this.onSnap?.(msg.snap, msg.events || []);
      else if (msg.t === 'select_result') this.onSelectResult?.(msg);
      else if (msg.t === 'error' || msg.t === 'reject') this.onServerError?.(msg);
      else if (msg.t === 'pong') {
        const sentAt = this._pingSent.get(msg.id);
        if (sentAt !== undefined) {
          this._pingSent.delete(msg.id);
          this.rtt = performance.now() - sentAt;
          this.rttEma = this.rttEma > 0 ? this.rttEma * 0.7 + this.rtt * 0.3 : this.rtt;
        }
      }
    };
    ws.onerror = () => { this.onError?.(); };
    ws.onclose = () => {
      this.connected = false;
      clearInterval(this._pingTimer);
      this.onClose?.();
    };
  }

  ping() {
    if (this.ws?.readyState !== 1) return;
    const id = ++this._pingId;
    this._pingSent.set(id, performance.now());
    // 応答が来ないpingは溜めない
    if (this._pingSent.size > 8) {
      const oldest = this._pingSent.keys().next().value;
      this._pingSent.delete(oldest);
    }
    this.send({ t: 'ping', id });
  }

  send(obj) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(obj));
  }

  sendInput(d) { this.send({ t: 'input', d }); }
  sendSelect(heroId) { this.send({ t: 'select', heroId }); }
  sendRestart() { this.send({ t: 'restart' }); }

  // 補間遅延: 既定100ms、RTTが大きければ増やす（snap間隔≒48msの2枠+余裕）
  interpMs() {
    const r = this.rttEma || this.rtt || 0;
    return Math.round(Math.max(
      LAG_COMPENSATION_POLICY.displayInterpolationBaseMs,
      Math.min(LAG_COMPENSATION_POLICY.absoluteMaxMs, 76 + r * 0.5),
    ));
  }
}
