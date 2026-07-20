# ヒーロー・アビリティ用アセット SSOT

## 目的

18ヒーロー、18武器、72アビリティを、ゲーム定義・画像・音声・実行時URLまで同じIDで結び付ける。ブラウザは個別のファイル名を推測せず、生成済みの `shared/data/hero_assets.js` だけを参照する。

## 正本と生成物

| 区分 | 正本 | 役割 |
|---|---|---|
| ゲーム定義 | `shared/data/heroes.js` | ヒーローID、ロール、武器ID、4スロット、アクションID、behavior |
| ImageGen入力 | `assets-src/imagegen/manifests/group-a.json` ～ `group-f.json` | provider、完全なプロンプト、2x2/4x4グリッド、原画/透過画像のパスとハッシュ |
| 画像原画 | `assets-src/imagegen/heroes/` | ImageGenが生成したグリーンバック原画と、クロマキー除去後の透過原画 |
| ElevenLabs入力/結果 | `assets-src/elevenlabs/manifest.json` | provider、model、プロンプト、要求時間、原音/配信用音声のパスとハッシュ |
| 統合SSOT | `shared/data/hero_assets.js` | 上記を検証して生成する、ブラウザ/サーバー共通の読み取り専用マニフェスト |
| 配信用画像 | `client/assets/generated/` | 内容ハッシュ付きWebPアトラス。HTTPではimmutableとして配信 |
| 配信用音声 | `client/assets/generated/audio/` | 内容ハッシュ付きMP3。HTTPではimmutableとして配信 |

`shared/data/hero_assets.js` は生成物であり、手編集しない。入力ファイルのSHA-256と統合内容の `contentSha256` を内包する。

## 不変条件

- ヒーロー18件、武器18件、アビリティ72件で、IDはすべて一意。
- 各ヒーローは2x2のコンセプト原画1枚、各アビリティは4x4の演出原画1枚を持つ。
- ビジュアルは合計90原画、分割フレームは合計1,224枚、配信用アトラスは90本。
- 原画、透過原画、分割フレーム、配信用アトラスは、記録されたバイト数とSHA-256が一致しなければ採用しない。
- 透過アトラスは透明画素20%以上かつ不透明画素1%以上を必要とし、グリッド境界の残留色を決定的に除去する。
- 音声は武器18件＋アビリティ72件＝90件。全件が揃うまで `complete` は `false` であり、strictビルドとリリーステストは失敗する。
- 未知のヒーロー/武器/アクションIDは別キャラクターの素材へフォールバックせず `null` で閉じる。
- APIキーは環境変数からのみ読み、ソース、マニフェスト、ログへ保存しない。

## 再生成手順

```powershell
# 1. ElevenLabsの要求90件、文字数制限、概算クレジットだけを検査
node tools/generate_elevenlabs_assets.js --dry-run

# 2. ELEVENLABS_API_KEYを現在のプロセスだけに設定して、不足分を再開生成
node tools/generate_elevenlabs_assets.js --concurrency 3

# 3. strict統合。音声90件が揃っていなければ失敗する
node tools/build_hero_asset_manifest.js

# 4. SSOTと実ファイルの全ハッシュを検証
node --test tests/hero_assets.test.js tests/elevenlabs_asset_generator.test.js
```

開発途中で画像側だけを確認する場合に限り、`node tools/build_hero_asset_manifest.js --allow-incomplete-audio` を使える。この場合も不足IDは `missingAudio` に列挙され、`complete: false` のままなのでリリース判定には使えない。

生成処理は既存マニフェストのバイトを再検証してからスキップするため中断後に再開できる。未追跡の同名原音が存在する場合は上書きせず停止する。

並列音声生成でquota切れや非再試行エラーが発生した場合は、新しい仕事の予約を止め、同時workerへabortを通知し、全workerを回収してから終了コード1を返す。トップレベルへ未処理例外を漏らさないため、Windows版NodeでもAPIキーや通信ハンドルを残さず再開可能な状態で停止する。

画像処理キャッシュは辞書の挿入順を保存する。同じ入力から初回処理とキャッシュ再利用で同一のSSOTを生成し、連続再構築時の `shared/data/hero_assets.js` SHA-256が一致しなければならない。

## rc.5 現在値

| 項目 | 状態 |
|---|---:|
| ImageGenグループマニフェスト | 6/6 |
| グリーンバック原画 | 90/90（167,875,667 bytes） |
| 透過原画 | 90/90（111,779,676 bytes） |
| 分割PNG | 1,224/1,224（81,770,537 bytes） |
| 配信用WebP | 90/90（28,266,438 bytes） |
| ElevenLabs MP3 | 2/90（70,305 bytes） |
| 統合SSOT | 18ヒーロー / 72アビリティ、`contentSha256=e62cad2a166deb901b2ec9da5e4852a985720fe6f56d6daa0ae129048945f2f6` |

音声の残り88件は、使用したElevenLabsキーのクォータが0になった時点で停止している。推定総クレジットは6,304。新しいクォータで同じコマンドを実行すれば、検証済み2件を再生成せず残りから再開する。

## 実行時の扱い

- キャラクター選択ではヒーローのコンセプトアトラスを表示する。
- 能力の発動演出はアクションIDから専用アトラスを選び、フレームを時間進行させる。
- 武器/能力音はSSOTにMP3があれば事前デコードして使用し、まだないIDだけ既存の手続き音へ縮退する。
- 画像とMP3は、取得後にマニフェストのbyte数・SHA-256・内容ハッシュ付きファイル名をブラウザ内で照合し、合格したバイト列だけをTextureLoader/AudioContextへ渡す。改変、ハッシュ欠落、Web Crypto不在時はfail-closedで専用アセットを使用しない。
- 音声90件が揃った時点でstrictビルドが手続き音への意図しない縮退を検出する。
