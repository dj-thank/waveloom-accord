# Kagariai 1.0.0-rc.5 アセット候補レポート

実施日: 2026-07-20、追補: 2026-07-21（Asia/Tokyo）

## 判定

**条件付き候補。公開リリースは BLOCKED。**

画像、統合 SSOT、実行時アセット整合性、必殺技経済、ブラウザ表示、Docker 本番構成は検証済み。ElevenLabs 音声が 2/90 件のため、strict リリースゲートだけは意図的に失敗させている。

## 実装済み

- 18 ヒーロー、18 武器、72 アビリティを共通 ID で結ぶ `shared/data/hero_assets.js` を生成物の SSOT とした。
- ImageGen で 6 グループ、90 枚のグリーンバック原画を生成し、透過原画、1,224 分割 PNG、90 配信用 WebP アトラスへ決定的に変換した。
- ヒーロー選択画面は 18 件のコンセプトアトラス、能力演出は 72 件のアクションアトラスを SSOT から参照する。
- ブラウザは画像・MP3を使用する前に、byte 数、SHA-256、内容ハッシュ付きファイル名、MIME を検証する。欠落、不一致、Web Crypto 不在時は fail-closed とする。
- ElevenLabs 生成は 90 件のプロンプト、モデル、要求時間、原音/配信用ハッシュを記録し、中断点から重複なしで再開できる。
- 必殺ゲージは生存中の時間、与ダメージ、回復を権威サーバー上で換算し、ラウンド間持越しと返却を上限付きで行う。

## アセット会計

| 区分 | 完了数 | byte 数 |
|---|---:|---:|
| グリーンバック原画 | 90/90 | 167,875,667 |
| 透過原画 | 90/90 | 111,779,676 |
| 分割 PNG | 1,224/1,224 | 81,770,537 |
| 配信用 WebP | 90/90 | 28,266,438 |
| ElevenLabs MP3 | 2/90 | 70,305 |

SSOT の内容ハッシュは `e62cad2a166deb901b2ec9da5e4852a985720fe6f56d6daa0ae129048945f2f6`。`authoritative: true`、`complete: false`、`missingAudio: 88` であり、不足を隠さない。

## 必殺技の調整結果

2 種類の開始 seed、合計 4 試合・40 player-match で 136 回使用され、平均は **3.40 回/player-match**。

| 開始 seed | player-match | 使用回数 | 平均 | 中央値 | 0 回率 | 最大 |
|---:|---:|---:|---:|---:|---:|---:|
| 20260713 | 20 | 53 | 2.65 | 2 | 10% | 6 |
| 20260719 | 20 | 83 | 4.15 | 5 | 5% | 6 |

試合展開とヒーロー構成による幅は残るが、要求された「1 試合でだいたい 3 回」の中心値を満たす。自動検証は平均 2.0〜4.5、中央値 2〜5、0 回率 15% 以下、最大 8 回以下を fail-closed で監視する。

## 検証結果

| ゲート | 結果 |
|---|---|
| 音声完全性以外の Node 回帰 | 425/425 pass |
| 画像キャッシュ決定性 | Python unittest pass、連続再構築のSSOT SHA-256一致 |
| quota安全停止 | 実ElevenLabs APIで終了コード1、未処理例外・libuv assertionなし |
| strict hero asset テスト | 3 pass / 1 fail（音声 88 件不足を正しく検出） |
| authored map collision | pass、`D4D471A28169A82C20D34D47E7DEBA99C271268646737BD3E93A0C6292D95219` |
| headless BO3 | 2 seed × 2 match 完走、18/18 ヒーロー、能力・必殺・回復を確認 |
| 最終 Luna レビュー | P0/P1/P2 残件なし、音声 quota のみ BLOCKED |
| ブラウザ DOM | 18/18 ヒーロー画像を verified、選択中 Vesta の能力 4/4 を verified |
| Docker smoke | healthy、ready、protocol 5、SSOT/画像/音声配信を確認 |

ブラウザの目視証跡は `docs/evidence/rc5-asset-visual-audit-2026-07-21/VISUAL_AUDIT.md` と `outputs/rc5-visual-evidence/` に保存した。

## Docker 本番候補

- tag: `kagariai:1.0.0-rc.5-local`
- digest / image ID: `sha256:8e0c8ab998b614779d2b6ae1526c388db4a4b3ee29b9491e536221454b064b28`
- size: 101,299,172 bytes
- runtime user: `node`
- read-only root filesystem
- capability: `ALL` drop
- security option: `no-new-privileges:true`
- `/tmp`: `noexec,nosuid`
- WebP/MP3:正しい MIME と `immutable` cache policy

## ElevenLabs 再開条件

接続と生成自体は成功したが、使用した API キーは 2 件生成後に quota 0 となった。2026-07-21にクリップボードのキーで再確認してもElevenLabs側の応答は残量0だった。dry-run の全 90 件概算は 6,304 credits。十分な追加 quota または別アカウントの利用可能キーを現在のプロセスだけに設定し、次を実行する。

```powershell
node tools/generate_elevenlabs_assets.js --concurrency 3
node tools/build_hero_asset_manifest.js
node --test tests/hero_assets.test.js tests/elevenlabs_asset_generator.test.js
```

生成済み 2 件は byte 数とハッシュを再検証してスキップされ、残り 88 件から再開する。API キーはソース、マニフェスト、ログへ保存しない。

## 公開前に残る境界

1. ElevenLabs の残り 88 件を生成し、strict テストを 4/4 pass にする。
2. 実機スピーカー/ヘッドホンで全 90 音の音量、長さ、反復疲労、空間定位を人間が監査する。
3. 画像アトラスを全ヒーロー・全能力で実プレイし、意匠の一貫性、読みやすさ、遮蔽への悪影響を人間が監査する。
4. 公開 DNS/TLS/WSS、実ネットワーク損失・遅延、長時間 soak、実プレイヤー 10 人の E2E を別ゲートで確認する。
