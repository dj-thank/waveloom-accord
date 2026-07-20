# 『篝合』Production Candidate rc.4 検証報告

- 対象: `1.0.0-rc.4`
- 検証日: 2026-07-20（Asia/Tokyo）
- 開発基準 HEAD: `2ccc00dd906beaa4f0d818d1cbd55ea411df9b78`
- 判定: ローカル配布・クローズドプレイテスト候補。世界公開環境への配備は未実施

## 今回の到達点

- 5v5 の固定編成を篝手 1・焔手 2・灯手 2としてサーバー権威で保証し、18ヒーローの武器、通常能力、必殺技を実行可能な状態で維持した。
- 歩行、段差、落下、天井、しゃがみ解除、ダッシュ、押し引き、巻き戻し、スポーンを同じ swept-cylinder 系の衝突経路へ統合した。床のない場所へ仮の床を生成せず、`killZ` 以下は通常の環境デスと復帰経路へ入る。
- hitscan、発射体、爆発、回復、状態異常、障壁、設置物を3Dの最短TOIと共通LOSへ統合し、壁・薄い遮蔽物・有限高さの構造を越える誤命中を防いだ。
- 入力を protocol v5 の有界reorder queue、適用済みACK、retired watermark、250ms leaseへ変更し、短い押下edge、並べ替え、欠落、切断、BOT引き継ぎを決定論的に扱う。
- 表示面と競技用AABBを共通マップblueprintから生成した。runtimeは正体積のcanonical `solids` 147個と同数の `presentationSolids` を使用し、外部GLB由来proxyはruntime collisionへ入れない。
- 各スポーンを出口と主要ルートへ向け、出口4mの円柱クリアランスとルート接続を自動検査する。BOTは篝手の前線、焔手の限定角度、灯手の支援到達距離を基準に行動する。
- HUDに入力、能力名、効果、射程、CT、使用不可理由、ロール責務、直近の推奨行動をまとめた。マウス感度とゲームパッド視点速度を数値入力できる。
- 至近距離3.5m未満と遠距離42m超のworld-spaceネームプレートを隠し、スポーン地点で表示が画面を覆わないようにした。
- 武器種、命中、被弾、回復、能力、必殺技、目標を区別する音響cueと、上限付きエフェクトpool、品質budget、reduced-motion対応を追加した。

## マップと外部アセット

- Poly Havenのコンクリート床・壁PBRをCC0、ファイル単位SHA-256、bundle単位fail-soft読み込みで同梱した。
- ユーザー提供の `chicken_gun_fruzer_mine.glb` は23,866,668 bytes、SHA-256 `DC9017A5F1D875B7CB45C00183E158491FAE042F6A33CE8EC42FCA8D9CA2E597`、CC BY 4.0 attribution付きで保持する。ただし見た目と競技用衝突が一致しないため、検証済み参照として表示OFF・collisionなしにした。
- Kenney Modular Dungeon KitはCC0候補として取得・評価したが、今回のruntimeには同梱していない。
- Poly Haven、Kenney、Quaternius、Sketchfab等からの取得は、source page、作者、ライセンス、原本hash、変換履歴を記録するビルド時admissionに限定する。任意URLをゲームサーバーが実行時に取得する機能は持たない。
- 正式な台帳は `docs/ASSET_LICENSES.md`、導入手順は `docs/EXTERNAL_ASSET_SOURCES.md`、マップ編集手順は `docs/MAP_AUTHORING.md` を正典とする。

## 最終検証

| 検証 | rc.4 結果 |
|---|---|
| Node test suite | `408 / 408` success、fail 0 |
| Authored map regeneration | `D4D471A28169A82C20D34D47E7DEBA99C271268646737BD3E93A0C6292D95219` と一致 |
| Runtime map | canonical collision 147、presentation 147、authored-GLB collision 0 |
| Headless 2試合 | 2 seed、18 / 18 heroes、failures 0、primary 5915、abilities 4020、ultimates 4、healing 109 events / 1480.3 |
| Release verifier | 10接続受理、11番目拒否、role-full拒否、ACK 1、stale拒否、pong、protocol v5 |
| Graceful shutdown | ready 503、WebSocket 1012、stubborn peer close、HTTP/WS close、exit code 0 |
| 実ブラウザ | ヒーロー選択、参加、canonical spawn exit、戦術HUDを確認。console error 0 |
| Docker build | Docker Engine 29.6.1、app `sha256:a44d92a9354075b7d04a004f88d2684b8529b0fa0c5c1c1710fe8fb15432affd`（72,866,146 bytes）、Caddy `sha256:9ac83ceed578c1d006b05677a951a3a2406d618ad0cdfd629ced977d061a9cf4`（43,140,698 bytes） |
| Docker runtime | app/Caddyともnon-root、read-only root、tmpfs、cap-drop ALL、no-new-privileges。ローカル自己署名TLSでHTTPS health/ready 200、WSS 10-client smoke success |
| Compose shutdown | project名固定、15秒猶予。app/Caddyとも `exit=0`、OOM false、restart 0。検証用container/network/volumeは確認後に除去 |
| Dependency audit | pinned Node 24 Alpine build中の `npm ci --omit=dev` で vulnerabilities 0 |
| Runtime CVE scan | exported final root filesystemはapp/Caddyともfixed Critical/High `0 / 0`。Caddyのlayer image scanだけは置換前base binaryのGo 1.26.3を1 Highとして残すが、実行binaryの`build-info`はGo 1.26.4で、export後の185 packagesは0件 |

配布に含めるprivacy-reviewedなbefore/afterと最終画像は `docs/evidence/fps-visual-audit-2026-07-20/VISUAL_AUDIT.md` を参照する。全iteration画像はタスクworkspaceの `outputs/fps-visual-audit-2026-07-20/` に分離して保持する。

## リリース判定

rc.4は、ローカルで遊べるクローズドプレイテスト候補として受け入れる。衝突、重力、遮蔽、マップ表示、5v5編成、能力説明、入力lease、静的配信、Dockerの基本契約は自動検証済みである。

世界公開済みとは判定しない。公開DNS、実証明書、公開ホスト上のHTTPS/WSS、地域別遅延、長時間soak、実端末/GPU/ブラウザ横断、同時接続負荷、運用アラートは別ゲートである。

## 残るP1と制作工程

1. クライアントは63Hzで各入力を予測する一方、サーバーは同tickに固まった連続入力のcontinuous stateを1 simulation stepへcoalesceする。30/60/120Hzの一定holdとedge保持は合格しているが、20–100ms jitter、clump、lossを含むクライアントreconciliation横断試験は未整備であり、外部公開前のP1ゲートとする。
2. 現在のworldは競技用blockoutとPBR材質を一致させた段階である。専用の3D環境、キャラクター、rig、武器animation、LOD、occlusion、録音Foley、材質別impactは別のart/audio制作工程が必要である。
3. キーボード・マウス、ゲームパッド、主要GPU、reduced-motion、低性能端末で人間による操作・酔い・視認性・オーディオmixのプレイテストを行う。
4. 公開前にSBOM、image scan、秘密情報scan、署名、対象ホストでのTLS/WSS smoke、監視、バックアップ、ロールバック手順を再実行する。
5. リポジトリ本体の公開ライセンスは未決定である。外部アセットの個別ライセンスとは別に、権利者がソースコードの配布条件を決定するまで公開ソース配布を行わない。

この判定境界を満たすまでは「ローカルProduction Candidate」であり、「世界公開版」ではない。
