# Kagariai 1.0.0-rc.5 アセット候補レポート

実施日: 2026-07-20、追補: 2026-07-21（Asia/Tokyo）

## 判定

**ローカル本番候補。音声アセットの自動ゲートは PASS。**

画像、統合 SSOT、実行時アセット整合性、必殺技経済、ブラウザ表示、Docker 本番構成に加え、18武器＋72アビリティの音声90/90件を検証した。外部APIに依存する音声不足は解消した。ただし全90音の人間による聴感評価、公開ネットワーク、10人実プレイ、最終権利レビューは別ゲートであり、世界公開そのものを承認する判定ではない。

## 実装済み

- 18 ヒーロー、18 武器、72 アビリティを共通 ID で結ぶ `shared/data/hero_assets.js` を生成物の SSOT とした。
- ImageGen で 6 グループ、90 枚のグリーンバック原画を生成し、透過原画、1,224 分割 PNG、90 配信用 WebP アトラスへ決定的に変換した。
- ヒーロー選択画面は 18 件のコンセプトアトラス、能力演出は 72 件のアクションアトラスを SSOT から参照する。
- ブラウザは画像・WAVを使用する前に、byte 数、SHA-256、内容ハッシュ付きファイル名、MIME を検証する。欠落、不一致、Web Crypto 不在時は fail-closed とする。
- 音声はプロジェクト内の決定論的 Local DSP で生成する。外部API、アカウント、APIキー、quota、第三者サンプル、第三者モデルweightを必要としない。
- `assets-src/local-audio/manifest.json` に90件のID、seed、profile、長さ、原音/配信用パス、byte数、SHA-256、生成器パスと生成器ハッシュを記録する。
- 必殺ゲージは生存中の時間、与ダメージ、回復を権威サーバー上で換算し、ラウンド間持越しと返却を上限付きで行う。

## アセット会計

| 区分 | 完了数 | byte 数 |
|---|---:|---:|
| グリーンバック原画 | 90/90 | 167,875,667 |
| 透過原画 | 90/90 | 111,779,676 |
| 分割 PNG | 1,224/1,224 | 81,770,537 |
| 配信用 WebP | 90/90 | 28,266,438 |
| Local DSP raw WAV | 90/90 | 9,953,802 |
| 配信用 WAV | 90/90 | 9,953,802 |

SSOT の内容ハッシュは `6085b6af8b484e15248aa7717147e814bf925831410e7f8201002fde68d97c92`。`authoritative: true`、`complete: true`、`missingAudio: []`。音声manifest SHA-256は `5fe306133bcafe4bf704b792361376afdd4db6dc64c6bb1df724a77c12c98808`、生成器SHA-256は `e94208ca76de3683559d87b78201b0ed7b89b9541bf73f36eb3f9994b1eaf7d8`。全90件のWAV hashは一意で、44.1 kHz、mono、PCM16、長さ0.88〜1.80秒である。

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
| Node 全回帰 | 437/437 pass |
| 画像キャッシュ決定性 | Python unittest pass、連続再構築のSSOT SHA-256一致 |
| asset/runtime focused | 34/34 pass |
| Local DSP生成 | 90件を2回再生成し、全WAVとmanifest bytesが一致 |
| source packager policy | Python unittest 2/2 pass。`.part`、`.partial`、`.tmp`、旧MP3を除外 |
| strict hero asset | `complete=true`、90/90音声、90固有hash、入力/配信byte一致 |
| authored map collision | pass、`D4D471A28169A82C20D34D47E7DEBA99C271268646737BD3E93A0C6292D95219` |
| headless BO3 | 2 seed × 2 match 完走、18/18 ヒーロー、能力・必殺・回復を確認 |
| Luna再監査 | 旧2/90表記の文書ドリフトを検出し、本レポートと実画面監査を修正 |
| ブラウザ DOM | 18/18 ヒーロー画像を verified、選択中 Vesta の能力 4/4 を verified |
| 実ブラウザWAV | Chrome AudioContextで代表音源をdecode。HTTP 200、`audio/wav`、immutable、warning/error 0 |
| Docker smoke | healthy、ready、protocol 5、WAV 90、MP3 0、SSOT参照 90/90を確認 |

ブラウザの目視証跡は `docs/evidence/rc5-asset-visual-audit-2026-07-21/VISUAL_AUDIT.md` と `outputs/rc5-visual-evidence/` に保存した。

## Docker 本番候補

- tag: `kagariai:1.0.0-rc.5-free-audio`
- digest / image ID: `sha256:c9bdb728ad288aa1f6f0976a47ac29fb01ffda58d75ca4e82edc5f603c8843e9`
- size: 110,184,603 bytes
- runtime user: `node`
- read-only root filesystem
- capability: `ALL` drop
- security option: `no-new-privileges:true`
- `/tmp`: `noexec,nosuid`
- WebP/WAV:正しい MIME と `immutable` cache policy
- image内音声: WAV 90件、旧MP3 0件

## 無料音声の再生成

通常の再生成・検証にはネットワークもAPIキーも不要である。

```powershell
node tools/generate_local_audio_assets.js --force
node tools/build_hero_asset_manifest.js
node --test tests/local_audio_asset_generator.test.js tests/hero_assets.test.js tests/asset_licenses.test.js
```

旧ElevenLabs実験の2 MP3は履歴としてワークツリーに残すが、authoritative manifest、統合SSOT、Docker image、完成source candidateには入れない。

## 公開前に残る境界

1. 実機スピーカー/ヘッドホンで全90音の音量、識別性、長さ、反復疲労、空間定位を人間が監査する。機械検証は聴感品質を証明しない。
2. 画像アトラスを全ヒーロー・全能力で実プレイし、意匠の一貫性、読みやすさ、遮蔽への悪影響を人間が監査する。
3. 公開 DNS/TLS/WSS、実ネットワーク損失・遅延、長時間 soak、実プレイヤー10人のE2Eを別ゲートで確認する。
4. プロジェクトLICENSE/NOTICEとImageGenを含む全公開アセットの最終権利レビューを行う。
