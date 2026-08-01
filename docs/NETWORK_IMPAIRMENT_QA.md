# RC5 Network Impairment QA

`node tools/network_impairment_harness.js` is a deterministic local harness. Input acceptance goes through production `server/runtime.js` `receiveInputCommand` (sanitization and lag tracker), and pending-input retirement goes through `client/prediction.js`. Ten simulated clients send 240 ticks through 20/100 ms jitter, clumping, reordering, and 1/5/10% loss.

Checks include bounded delay, monotonic ACK, finite authoritative-vs-predicted position error, clump/reorder occurrence, reconnect at tick 120, lease expiry, and equality of two runs with the same seed. Evidence is written to `outputs/rc5-network-evidence/network-impairment.json`.

This is an auxiliary production-seam simulation, not a standalone release gate. The harness does not instantiate the full `World` tick loop or a real WebSocket transport; therefore it does not prove Internet RTT, congestion, ISP/NAT behavior, browser WebSocket behavior, or ten physical clients. Real-network soak/loss remains a separate gate.

## Local WSS smoke

With a locally running WSS server, set `KAGARIAI_WS_URL=wss://127.0.0.1:8787` (or pass `--url`) and run `node tools/ws_impairment_smoke.js`. The smoke opens ten real WebSocket connections, sends the deterministic impairment matrix, checks protocol/welcome, snapshot ACK monotonicity, stale rejection, finite progress, and reconnect. It writes `outputs/rc5-network-evidence/ws-impairment.json`.

For a local self-signed certificate only, the caller may set `NODE_TLS_REJECT_UNAUTHORIZED=0` in the process environment. The harness has no flag that disables TLS verification; never use this setting for public traffic.

## Accepted local candidate evidence (2026-07-21)

The final local candidate was exercised through the exact Docker app and Caddy images at `wss://localhost:18443`. The Caddy local root certificate was extracted once and supplied to Node through `NODE_EXTRA_CA_CERTS`; TLS verification remained enabled (`tlsVerificationDisabledByHarness: false`). `NODE_TLS_REJECT_UNAUTHORIZED=0` was not used for the accepted run.

The accepted v2 capture in `outputs/rc5-network-evidence/ws-impairment.json` passed with 10 real WebSocket clients across the 20/100 ms jitter and 1/5/10% loss matrix. It verified monotonic snapshot ACK and pending-input retirement, finite positions, stale-input rejection, and reconnect. The same runtime smoke also accepted clients 1–10, rejected client 11 at capacity, rejected a role-full selection, and returned ACK/pong. This is local transport evidence only; it does not replace public-certificate, Internet-path, regional, physical-client, capacity, or soak gates.
