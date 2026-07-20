# 篝合 Production Candidate デプロイ手順

## 前提

- Docker Engine 24以降とCompose v2
- 公開DNS名
- TCP 80/443およびUDP 443を受けられるホスト
- 1インスタンスで1試合（最大10人）。水平分割には試合ディレクトリが別途必要

Node、Go toolchain、Caddyのベースイメージはtagに加えてSHA-256 digestで固定している。Caddyはv2.11.4をGo 1.26.4で再構築し、不要なcurlとfile capabilityを除去している。更新時は新digestへ明示的に変更し、build・テスト・CVE scan・WSS smokeを一組で再実行する。

## 必須環境変数

```dotenv
KAGARIAI_DOMAIN=play.example.jp
KAGARIAI_PUBLIC_ORIGIN=https://play.example.jp
KAGARIAI_IMAGE_TAG=1.0.0-rc.5
KAGARIAI_CADDY_IMAGE_TAG=2.11.4-kagariai-go1.26.4
KAGARIAI_CADDY_DATA_VOLUME=kagariai_caddy_data_rc5
KAGARIAI_CADDY_CONFIG_VOLUME=kagariai_caddy_config_rc5
# 既定は80/443。ローカル検証時だけ別ポートへ変更可能
KAGARIAI_HTTP_PORT=80
KAGARIAI_HTTPS_PORT=443
```

`KAGARIAI_PUBLIC_ORIGIN` はスキーム・ホスト・ポートを含む完全なOriginで、パスは含めない。本番では未設定・不正値・異OriginのWebSocket接続をfail-closedで拒否する。

## 起動

```sh
docker compose --env-file .env.production -f compose.production.yml build --pull
docker compose --env-file .env.production -f compose.production.yml up -d
docker compose --env-file .env.production -f compose.production.yml ps
```

CaddyがTLS証明書を取得し、HTTP/WebSocketを同じOriginでアプリへ転送する。Caddyfileはversioned Caddy image内へ固定し、作業ツリーからbind mountしないため、image tagの切替で設定も同時にロールバックされる。NodeとCaddyはともに非root、read-only filesystem、capability全削除、`no-new-privileges`で起動する。Caddyのコンテナ内待受は非特権ポート8080/8443で、ホストの80/443からのみ転送する。

Compose project名はmanifest内で `kagariai` に固定し、releaseディレクトリへmanifestを移しても別stackを誤作成しない。両サービスの停止猶予は15秒で、アプリのgraceful shutdown期限より長く確保する。

rc.5は既存Caddyボリュームを上書きせず、環境変数で指定した`kagariai_caddy_data_rc5` / `kagariai_caddy_config_rc5`をside-by-sideで新設する。初回だけ証明書を再取得するため、切替前にCAのrate limitとDNSを確認する。旧ボリュームはロールバック完了まで削除しない。

## 停止

```sh
# コンテナを保持して停止
docker compose --env-file .env.production -f compose.production.yml stop -t 15

# imageとCaddyボリュームを保持してcontainer/networkだけを除去
docker compose --env-file .env.production -f compose.production.yml down -t 15
```

ロールバック用の証明書と設定を保持するため、`down -v`、`--volumes`、`--rmi`は使わない。

## 検証

```sh
curl --fail https://play.example.jp/healthz
curl --fail https://play.example.jp/readyz
npm run smoke -- --url wss://play.example.jp
docker scout cves kagariai:${KAGARIAI_IMAGE_TAG} --only-severity critical,high --only-fixed
docker scout cves kagariai-caddy:${KAGARIAI_CADDY_IMAGE_TAG} --only-severity critical,high --only-fixed

# 継承レイヤーではなく、実際に起動するroot filesystemをrelease gateにする
app_scan_id="$(docker create kagariai:${KAGARIAI_IMAGE_TAG})"
docker export --output /tmp/kagariai-app-rootfs.tar "$app_scan_id"
docker rm "$app_scan_id"
docker scout cves fs:///tmp/kagariai-app-rootfs.tar --only-severity critical,high --only-fixed --exit-code

caddy_scan_id="$(docker create kagariai-caddy:${KAGARIAI_CADDY_IMAGE_TAG})"
docker export --output /tmp/kagariai-caddy-rootfs.tar "$caddy_scan_id"
docker rm "$caddy_scan_id"
docker scout cves fs:///tmp/kagariai-caddy-rootfs.tar --only-severity critical,high --only-fixed --exit-code
```

スモークツールは `wss:` から `https:` のOriginを自動導出する。非標準の公開Originを検証する場合だけ `--origin https://play.example.jp` を明示する。

期待値:

- `/healthz`: HTTP 200、`status=ok`
- `/readyz`: HTTP 200、`ready=true`
- スモーク: 10人受理、11人目拒否、1/2/2の満員ロール拒否、入力ACK、pong
- CVE scan: runtime filesystemに修正可能なCritical/Highがないこと。継承レイヤーだけの検出は、実行バイナリのbuild infoとexported filesystem scanで必ず再確認する

## 更新

1. 新しい一意なapp/Caddy image tagとCaddy volume名を記したrelease専用envファイル、およびその時点の`compose.production.yml`を同じreleaseディレクトリへコピーし、変更せず保管する。
2. `docker compose config` で必須変数とポートを確認する。
3. `up -d` 後、`/readyz` とWebSocketスモークを通す。
4. 5分間、再起動回数・tickDrops・入力キュー拒否・入力リース切れ・RTT上限適用・WebSocket切断を監視する。
5. 両imageのID/digest、Compose設定、volume mappingをrelease記録へ保存する。

## ロールバック

1. appだけでなくCaddy image tagとCaddy volume mappingも含む、直前の正常なrelease専用envファイルとCompose manifestを選ぶ。
2. `docker compose --env-file releases/previous/.env.production -f releases/previous/compose.production.yml up -d --no-build` を実行する。
3. `/readyz` とWebSocketスモークを再実行する。
4. 失敗イメージとログは調査完了まで保持し、稼働中ボリュームを削除しない。

## 運用境界

- TLS・圧縮・アクセスログはCaddy、試合判定はNodeサーバーが担当する。
- `/healthz` はプロセス状態、`/readyz` はlisten完了かつ停止処理中でない状態を表す。接続上限などの個別admissionはWebSocket upgradeと`connectionAdmission` counterで確認する。
- アカウント、レート制限の共有状態、マッチメイク、永続統計、DDoS防御は外部プラットフォーム側で追加する。
