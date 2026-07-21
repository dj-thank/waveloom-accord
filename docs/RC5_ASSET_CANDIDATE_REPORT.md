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

最終候補の3 seed・3試合・30 player-matchで103回使用され、平均は **3.433回/player-match**、中央値3.5、最小1、最大5、0回率0%だった。旧4試合・40 player-matchの136回（平均3.40）は調整過程の履歴であり、最終判定にはこの3試合証跡を用いる。

| seed / 試合 | player-match | 使用回数 | 平均 | 中央値 | 最小 | 0 回率 | 最大 |
|---|---:|---:|---:|---:|---:|---:|---:|
| 20260713 / 20268632 / 20276551、各1試合 | 30 | 103 | 3.433 | 3.5 | 1 | 0% | 5 |

試合展開とヒーロー構成による幅は残るが、要求された「1 試合でだいたい 3 回」の中心値を満たす。自動検証は平均 2.0〜4.5、中央値 2〜5、0 回率 15% 以下、最大 8 回以下を fail-closed で監視する。

## 検証結果

| ゲート | 結果 |
|---|---|
| Node 全回帰 | 471/471 pass |
| BOT・物理・マップ集中回帰 | 100/100 pass |
| 画像キャッシュ決定性 | Python unittest pass、連続再構築のSSOT SHA-256一致 |
| asset/runtime focused | 34/34 pass |
| Local DSP生成 | 90件を2回再生成し、全WAVとmanifest bytesが一致 |
| source packager policy | Python unittest 7/7 pass。WAV実体・信号品質・18武器/72能力・各slot・正典ID・統合SSOTを構造照合し、任意バイト列と改ざんを拒否。manifest v2は`RELEASE_STATUS.json`をhash対象へ含め、自己参照になる`RELEASE_MANIFEST.json`だけを明示除外する |
| strict hero asset | `complete=true`、90/90音声、90固有hash、入力/配信byte一致 |
| authored map collision | pass、`26FF2FBA528C111CE3C23BC0B447BC5B633EA56FC9FF53F09E739F6571E25E4E` |
| headless BO3 | 3 seed × 1 match完走、18/18ヒーロー、能力10,665回、必殺103回、回復15,224.4、failures 0 |
| Luna再監査 | 旧2/90表記の文書ドリフトを検出し、本レポートと実画面監査を修正 |
| ブラウザ DOM | 18/18 ヒーロー画像を verified、選択中 Vesta の能力 4/4 を verified |
| 実ブラウザWAV | Chrome AudioContextで代表音源をdecode。HTTP 200、`audio/wav`、immutable、warning/error 0 |
| Docker smoke | app/Caddyともnon-root・read-only。信頼したローカルCAでTLS検証を有効にしたWSS 10-client、11番目拒否、role-full拒否、ACK/pong、損失/並べ替え/reconnectを確認 |

Python 全回帰は画像キャッシュ決定性1件を含む8/8 pass。source packagerは拡張子やmanifest自己申告だけを信頼せず、各ファイルのRIFF/WAVEヘッダ、44.1 kHz mono PCM16、data長、byte数、SHA-256、duration、peak/RMS/fade、正典ロスター、統合SSOTのdescriptorとcontent hashを再計算してから候補化する。さらにZIPの全payload名とmanifestを照合し、listed payloadのbyte数とSHA-256を再計算する。

ブラウザのアセット目視証跡は `docs/evidence/rc5-asset-visual-audit-2026-07-21/VISUAL_AUDIT.md` と `outputs/rc5-visual-evidence/` に保存した。現行ツリー専用serverでの最終ライブ画面、能力CT遷移、console 0件の証跡は `outputs/rc5-bot-evidence/screenshots/gameplay-live-final.png` と同ディレクトリの `README.md` に保存した。目視ではworld artが箱型blockoutの域を出ず、下部HUDが戦闘視界を大きく占有しており、これらをOW級presentation合格とは扱わない。

## Docker 本番候補

- app tag: `kagariai:rc5-codex-20260721`
- app digest / image ID: `sha256:e890533b262fbaedd432f3d518b6b9d11708134542165883df900cf5a67bb336`
- app size: 110,196,237 bytes
- Caddy digest / image ID: `sha256:ed9fabe23943e9cfabe16e71d93d721270f3a6a33c453c3f5c10156d63b794a0`（43,140,567 bytes）
- runtime user: `node`
- read-only root filesystem
- capability: `ALL` drop
- security option: `no-new-privileges:true`
- `/tmp`: `noexec,nosuid`
- WebP/WAV:正しい MIME と `immutable` cache policy
- image内音声: WAV 90件、旧MP3 0件
- exported final rootfsの修正可能Critical/High: app 0 / Caddy 0。Caddy layer scanは上書き前base binaryのGo 1.26.3をHigh 1件と報告するが、実行binary `build-info`はGo 1.26.4で、exported rootfs scanは0件

## 無料音声の再生成

通常の再生成・検証にはネットワークもAPIキーも不要である。

```powershell
node tools/generate_local_audio_assets.js --force
node tools/build_hero_asset_manifest.js
node --test tests/local_audio_asset_generator.test.js tests/hero_assets.test.js tests/asset_licenses.test.js
```

## 2026-07-21 visual refinement supersession

The earlier blockout/HUD limitation recorded above has been superseded by
`docs/VISUAL_REFINEMENT_REPORT_2026-07-21.md`. The live browser evidence now
shows collision-contained facade bays and horizontal bands, an integrity-
verified articulated third-person base, and a default combat HUD reduced from
approximately 276 px to approximately 89–94 px at 1280×720. The remaining
boundary is bespoke sculpt production and human/GPU/accessibility release QA,
not the earlier black wall or always-expanded lower HUD implementation.

旧ElevenLabs実験の2 MP3は履歴としてワークツリーに残すが、authoritative manifest、統合SSOT、Docker image、完成source candidateには入れない。

## 公開前に残る境界

1. 実機スピーカー/ヘッドホンで全90音の音量、識別性、長さ、反復疲労、空間定位を人間が監査する。機械検証は聴感品質を証明しない。
2. 画像アトラスを全ヒーロー・全能力で実プレイし、意匠の一貫性、読みやすさ、遮蔽への悪影響を人間が監査する。
3. 公開 DNS/TLS/WSS、実ネットワーク損失・遅延、長時間 soak、実プレイヤー10人のE2Eを別ゲートで確認する。
4. プロジェクトLICENSE/NOTICEとImageGenを含む全公開アセットの最終権利レビューを行う。
