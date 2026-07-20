# クライアント ↔ サーバー プロトコル v5

JSON over WebSocket。接続先は `ws://<host>:8787`（HTTP と同一ポート）。
静的配信は `/client/*`、`/shared/*`、`/vendor/three.module.js`、`/vendor/addons/*.js` に限定する。`/client/assets/` にはライセンス同梱済みの3Dマップを置く。

サーバーは 63Hz でシミュレーションし、通常 21Hz で full snapshot を送る。
1チーム5人、全体10人が接続中の人間プレイヤー上限である。正典編成の篝手1・焔手2・灯手2をサーバーが強制する。WebSocket transport全体の同時接続上限は32で、join前の接続も数える。

v5のクライアントとサーバーは同時に配布する。クライアントは `welcome.protocolVersion !== 5`（欠落を含む）ならwelcomeを適用せず、code 1002で接続を閉じる。

## クライアント → サーバー

| `t` | payload | 契約 |
|---|---|---|
| `join` | `{ t:'join', name, heroId }` | 入室。`name` は最大16文字。`heroId` は正典ロスターで検証し、不明・欠落時は `asagi` へfallbackする。選択ロールのBOT枠と交代する |
| `select` | `{ t:'select', heroId }` | SETUP中、または死亡してrespawn待機中だけheroを変更する。SETUP中のロール変更は対象ロールのBOTと枠交換する |
| `input` | `{ t:'input', d:{...} }` | サーバー入力。下記のshapeと範囲を満たし、`seq` は接続ごとに単調増加させる。サーバーは32件のbounded reorder windowを持つ |
| `ping` | `{ t:'ping', id }` | 同じ `id` の `pong` を返す |
| `restart` | `{ t:'restart' }` | 参加済み接続かつ `MATCH_END` 中だけ再試合を要求できる |

### `input.d`

```js
{
  f, b, l, r, jump, crouch, fire, reload, // boolean
  secondary, ability1, ability2, ultimate, // boolean
  moveX, moveY,                            // optional number [-1, 1]
  yaw, pitch,                              // number (rad)
  seq, interpMs                            // integer
}
```

- payload は配列でないJSON objectでなければならない。
- boolean 12キーは厳密なbooleanだけを許可する。欠落キーは `false`、未知キーは破棄する。
- optionalの `moveX`（右が正）と `moveY`（前が正）は有限値かつ `-1..1`。欠落時は `null` としてboolean移動キーへfallbackする。
- `yaw` は有限値かつ `-2π..2π`、`pitch` は有限値かつ `-1.55..1.55`。
- `seq` は1以上のsafe integerで、送信側では接続ごとに単調増加させる。サーバーは `max(ack, retired) + 1` から32件先までを受理し、未解決済みの古い値と重複値は `stale_input`、window外は `input_seq_out_of_window` で拒否する。
- WebSocket/TCPは信頼性のある順序付きtransportであり、通常運用では逆順や欠番は生じない。bounded reorderはアプリ内部の一時的不整合をfail-safeに収束させる防御である。欠番の先にあるcommandは最大32ms待ち、欠番を `retired` としてskipしてから適用する。独自の再送やaction IDはv5契約に含めない。
- `interpMs` は `0..220` のsafe integerで、クライアントの補間希望値である。サーバーは値を信用せず、正常sampleが4件揃った後だけ、直近20件のserver観測 WebSocket RTTの最小値から `min(220, 100 + rolling_min_RTT/2)` を上限として決め、要求値と小さい方の `rewindMs` だけをhitscanに適用する。RTT EMAとjitter EMAは診断専用で補償へ加算しない。4件未満の人間は最大100ms、BOTは0msである。直近の生RTT sampleが220msを超えた接続は次の有効sampleまで上限0msとしてfail closedする。通常の `{ t:'ping', id }` / `{ t:'pong', id }` 契約は変わらない。
- shape・型・有限値・範囲違反は `invalid_input` で拒否し、Worldへ渡さない。
- 人間playerごとに受理済みinputをsequence順queue（最大32件）へ保持する。simulation tickでは、その時点で到着済みかつ連続するcommandをまとめて消費する。移動・視点などのcontinuous stateはbatch末尾を1回適用し、射撃・reload・能力などのaction edgeは各commandの視点・rewind値と順序を保って再生する。`ack` は適用batch末尾へ進む。満杯時は新しいcommandを `input_queue_full` で拒否し、受理済み `seq` もACKも進めない。
- 最後に正常受理したinputから250ms（63Hzでは次のtick境界まで切り上げ）経過した場合、未適用queueを破棄し、その末尾まで `retired` を進め、移動・射撃・reload・能力edgeを中立化する。ping、focus、visibilityはleaseを延長しない。切断、枠の再割当、hero変更などの明示的な中立化でも破棄件数を別metricに記録する。
- message rateはcapacity 180、refill 180 token/秒の接続別token bucketで制限する。tokenがないmessageを受けるとpolicy violationとしてsocketを切断する。

## サーバー → クライアント

### `welcome`

join成功時、およびrestartでplayer IDを再割当した時に送る。

```js
{
  t: 'welcome',
  protocolVersion: 5,
  id: 'p3',
  team: 0,
  heroId: 'asagi',
  roster: {
    version: 1,
    defaultHeroId: 'asagi',
    roleSlots: { frontline:1, damage:2, support:2 },
    heroes: [{ id, name, role, roleLabel, subtype, color, maxHp }]
  },
  lagCompensationPolicy: {
    displayInterpolationBaseMs: 100,
    absoluteMaxMs: 220
  },
  tickRateHz: 63,
  mode: { /* shared/data/mode_shioura.json */ },
  combat: { /* shared/data/combat.json */ },
  seed: 123
}
```

サーバーは `welcome` の直後、同じsocketへ必ず現在の full `snap` を送る。
クライアントは要求値ではなく `welcome.heroId` を採用する。`lagCompensationPolicy` は共有v5定数の表示用通知であり、クライアント入力によって変更できない。

### `select_result`

```js
{ t:'select_result', ok:true, heroId:'koyomi' }
{ t:'select_result', ok:false, heroId:'koyomi', code:'selection_locked' }
```

拒否codeは `not_joined`、`invalid_hero`、`selection_locked`、`role_full`、`role_change_locked`。
成功は次回snapshotの `players[].heroId` と `hero_selected` eventにも反映される。

### `error`

```js
{ t:'error', code:'server_full', message:'The match is full (5 players per team).' }
```

主なcode:

- `already_joined`: 同じ接続でjoin済み
- `server_full`: 接続中の人間が10人、または両teamが5人
- `role_full`: 選択したロールの人間枠が両team、または自teamで満員
- `not_joined`: join前に入力を送った
- `invalid_message`: JSONまたはmessage envelopeが不正
- `invalid_input`: inputのshape・型・範囲が不正
- `stale_input`: `seq` が古い、または重複
- `input_queue_full`: playerの32件queueが満杯で、そのinputは未受理
- `input_seq_out_of_window`: `seq` が未解決基準から32件を超えて先行した
- `restart_not_allowed`: MATCH_END以外でrestart
- `server_error`: message処理中の予期しない例外を接続単位で封じ込めた

## HTTP運用契約

- `GET /healthz`: プロセス状態、uptime、全WebSocket接続数、join済みplayer数、join前接続数、開始試合数、tick drop数、protocol versionをJSONで返す。
- 同じpayloadの `inputCommands` はqueued/accepted/applied/rejected、lease expiration、lease/明示中立化別のdiscard数、queue high watermark、reorder window/wait、buffered/gap skip/missing件数を返す。`lagCompensation` はjoin前を含む接続別のRTT EMA、jitter EMA、rolling minimum、sample readiness、slow-pong outlier/absolute-cap超過件数、補償上限、適用rewindを返す。
- `eventDelivery` はringのretention（capacity 4096、TTL 5000ms、1送信最大256件）、遅延接続、backpressure/send failure、overflow resyncとdrop件数を返す。`connectionAdmission` は上限32、join期限5000ms、強制切断猶予100ms、Origin/upgrade前/upgrade後拒否、timeout、強制終了、message-rate超過の単調増加counterを返す。`webSocketCloses` はclose code別counter、`lagCompensationTotals` は切断後も残るRTT sample/outlier/cap超過counterを返す。`staticDelivery` は同時stream上限32、稼働・拒否件数を返す。
- `GET /readyz`: listen完了後かつ停止処理中でない時にHTTP 200。接続上限など個別のadmission可否はupgrade時に503で拒否し、`connectionAdmission` countersで観測する。
- `GET` と `HEAD` 以外は405。
- 静的assetはメモリへ全読込せずstreamする。同時GET streamは32本までで、超過時は503と `Retry-After: 1`。HEADはbodyもstream slotも使わない。単一byte rangeを206で返し、不正・複数・範囲外rangeは416とする。
- ETag/Last-Modified条件付きrequestは304。HTMLとJavaScriptは `Cache-Control: no-cache`、内容hash付きassetは1年immutable、vendor assetは1日、その他はno-cacheとする。全応答へCSP、nosniff、same-origin resource policy等を付与する。
- `NODE_ENV=production` では `KAGARIAI_PUBLIC_ORIGIN` が必須で、WebSocket `Origin` は完全一致だけを許可する。
- WebSocketは全transportで32接続まで。上限超過はupgrade前にHTTP 503と `Retry-After: 1` で拒否する。競合時の防御としてupgrade後にも上限を再確認し、該当socketを1013でcloseしてpeerがclose handshakeを無視しても100ms後に強制終了する。接続後5秒以内にjoinしないsocketも1008でcloseし、同じ期限で強制終了する。公開環境のIP別connection/rate limitはCaddyなど信頼境界上のreverse proxyで施行する。

### `snap`

```js
{
  t: 'snap',
  snap: {
    tick, t,
    match: {
      state: 'SETUP|ACTIVE|ROUND_END|MATCH_END',
      stateT, round, score, sides, matchWinner, setupSec, roundCapSec
    },
    objective: {
      sealed, state, owner, gauge, pot, ot, suddenDeath,
      otPenaltyStartT, respawnPenaltySec, time
    },
    pickups: [{ id, active }],
    zones: [/* ability zones; destructible emitters additionally expose hp/maxHp */],
    barriers: [/* ability barriers */],
    projectiles: [/* authoritative projectiles */],
    players: [{
      id, name, team, bot,
      heroId, heroName, role, roleLabel,
      pos, vel, yaw, pitch, crouch, grounded,
      hp, maxHp, shield, alive, onPoint,
      ammo, maxAmmo, weaponId, weaponName, reloading, reloadRemainingSec, reloadProgress,
      resource,
      abilities, cooldowns, cast, ultGauge, statuses,
      respawnIn, spawnProtected, spawnProtectionRemaining,
      kills, deaths, dmg, healing, ack, retired, rewindMs
    }]
  },
  events: [/* event streamからこのsocketへ配信するevent batch */],
  eventStream: {
    cursor, remaining,
    // retention超過時だけ: resync:true, dropped, reason:'retention_overflow'
  }
}
```

`abilities` は各slotの `id`、`name`、`state`、cooldown/cast/active残時間を持つ。
`players[].ack` はそのplayerへ最後にsimulation tickで適用したinput `seq`。受理だけでは進まないが、1 tickで連続batchを適用した場合はbatch末尾まで進む。`players[].retired` は適用済みまたは欠番skip/lease/中立化で確定破棄した最大 `seq` であり、常に `retired >= ack`。クライアントは `seq <= retired` の予測入力を再適用しない。`players[].rewindMs` は最後に適用したサーバー決定値（BOTは0）である。`spawnProtected` と `spawnProtectionRemaining` は復帰後の被ダメージ無効状態を示し、攻撃または能力使用で即時終了する。
主要eventは `hero_selected`、`ability_windup`、`ability_used`、`ultimate_used`、
`shot`、`projectile_*`、`hit`、`heal`、`kill`、`respawn`、`pickup`、
`zone_created`、`barrier_*`、`deployable_hit`、`deployable_destroyed`、
`ability_interrupted`、`ability_transit_*`、`blade_*`、objective/round/match遷移。攻撃由来eventは可能な場合
`abilityId` または `weaponId` を持つ。

## 参加枠・切断・restart

- join先teamは、World上の `isBot` 数ではなくOPENなsocket数で決める。
- 切断後3秒の猶予中も、そのplayer slotは新しい接続が再利用できる。再利用時は選択hero、HP、武器、能力、固有資源、位置、input/ACKを安全に初期化する。
- 切断時は最後の人間inputを直ちに中立化する。3秒後も再接続されていなければ、同じhero・位置・HPのままbotが引き継ぐ。
- restart時は接続中の人間の `name`、team、`heroId` を保持し、新しいIDをwelcomeで通知する。
- `seq` はWebSocket接続単位なのでrestart後も単調増加を継続する。welcomeで0へ戻さない。
- 新しい試合のbotは18人の正典ロスターから、frontline/damage/supportが偏らないよう分散割当する。

## Backpressure

socketの `bufferedAmount` が256KiBを超えている間、そのsocketへの古いsnapshot送信をskipする。
次に送れる `snap` 自体がfull stateなので権威状態は回復できる。eventはsocket別cursorを進めず、容量4096・TTL 5000msのserver ringから最大256件ずつ再送する。送信失敗時もcursorは進めないため、成功したbatchを重複送信しない。

cursorがretention範囲より遅れた場合、サーバーは古いeventを再構成せず、最新full snapshotと空の `events`、`eventStream.resync: true`、`dropped`、`reason` を送る。その送信成功時にだけcursorを最新へ進める。一過性演出は欠落し得るが、gameplay stateはfull snapshotを正典として回復する。

## クライアント予測

- クライアントはinputを `seq` 付きで送り、同じ固定dt stepをローカル適用する。
- snap受信時は自分の権威位置を起点に `seq > max(ack, retired)` の未解決inputだけを再適用する。
- 他playerは `interpMs` 過去のsnapshot間を補間する。大きなteleportや生死切替は即時snapする。

## 座標系

`shot.attackId` は武器トリガーごとの単調な整数で、散弾・burstの同一トリガー内では共有する。`pelletIndex`（0始まり）と `pelletCount` はそのトリガー内のshotを表す。

- 右手系。`x`=東西（東+）、`y`=南北（北+）、`z`=上、位置単位はm。
- `yaw=0` は `+x`、反時計回り正。`pitch` は上向き正で±1.55rad。
