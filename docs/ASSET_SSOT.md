# ヒーロー・アビリティ用アセット SSOT

## 目的

18ヒーロー、18武器、72アビリティを、ゲーム定義・画像・音声・実行時URLまで同じIDで結び付ける。ブラウザは個別のファイル名を推測せず、生成済みの `shared/data/hero_assets.js` だけを参照する。

## 正本と生成物

| 区分 | 正本 | 役割 |
|---|---|---|
| ゲーム定義 | `shared/data/heroes.js` | ヒーローID、ロール、武器ID、4スロット、アクションID、behavior |
| ImageGen入力 | `assets-src/imagegen/manifests/group-a.json` ～ `group-f.json` | provider、完全なプロンプト、2x2/4x4グリッド、原画/透過画像のパスとハッシュ |
| 画像原画 | `assets-src/imagegen/heroes/` | ImageGenが生成したグリーンバック原画と、クロマキー除去後の透過原画 |
| ローカルDSP入力/結果 | `assets-src/local-audio/manifest.json` | generator version、固定seed、合成profile、WAV仕様、原音/配信用音声のパスとハッシュ |
| 統合SSOT | `shared/data/hero_assets.js` | 上記を検証して生成する、ブラウザ/サーバー共通の読み取り専用マニフェスト |
| 配信用画像 | `client/assets/generated/` | 内容ハッシュ付きWebPアトラス。HTTPではimmutableとして配信 |
| 配信用音声 | `client/assets/generated/audio/` | 内容ハッシュ付きWAV。HTTPではimmutableとして配信 |

`shared/data/hero_assets.js` は生成物であり、手編集しない。入力ファイルのSHA-256と統合内容の `contentSha256` を内包する。

## 不変条件

- ヒーロー18件、武器18件、アビリティ72件で、IDはすべて一意。
- 各ヒーローは2x2のコンセプト原画1枚、各アビリティは4x4の演出原画1枚を持つ。
- ビジュアルは合計90原画、分割フレームは合計1,224枚、配信用アトラスは90本。
- 原画、透過原画、分割フレーム、配信用アトラスは、記録されたバイト数とSHA-256が一致しなければ採用しない。
- 透過アトラスは透明画素20%以上かつ不透明画素1%以上を必要とし、グリッド境界の残留色を決定的に除去する。
- 音声は武器18件＋アビリティ72件＝90件。全件が揃うまで `complete` は `false` であり、strictビルドとリリーステストは失敗する。
- 全音声はRIFF/WAVE、44,100 Hz、mono、PCM16であり、90件の内容ハッシュはすべて異なる。
- 未知のヒーロー/武器/アクションIDは別キャラクターの素材へフォールバックせず `null` で閉じる。
- 音声生成は第三者sample、モデル重み、API、アカウント、ネットワーク、秘密情報を使用しない。

## 再生成手順

```powershell
# 1. 正典IDとWAV生成契約だけを検査（ファイルを書かない）
node tools/generate_local_audio_assets.js --check

# 2. 90件をローカルCPUで決定的に生成
node tools/generate_local_audio_assets.js

# 3. strict統合。音声90件が揃っていなければ失敗する
# Windowsでpythonが子プロセスから見つからない場合は、Pillowを含む実体を明示する:
# $env:KAGARIAI_PYTHON='C:\path\to\python.exe'
node tools/build_hero_asset_manifest.js

# 4. SSOTと実ファイルの全ハッシュを検証
node --test tests/hero_assets.test.js tests/local_audio_asset_generator.test.js tests/asset_licenses.test.js
```

開発途中で画像側だけを確認する場合に限り、`node tools/build_hero_asset_manifest.js --allow-incomplete-audio` を使える。この場合も不足IDは `missingAudio` に列挙され、`complete: false` のままなのでリリース判定には使えない。

生成器は同じID、behavior、slot、generator versionから同じseedと同じPCM bytesを作る。source/runtimeは同一bytesで、配信用名にはSHA-256先頭12桁を含める。manifestは全90件の生成と検証が終わってから原子的に更新する。

旧ElevenLabs実験の2 MP3は履歴として残すが、統合SSOT、Docker本番image、完成source candidateから除外する。通常の生成・検証コマンドはAPIキーを要求しない。

画像処理キャッシュは辞書の挿入順を保存する。同じ入力から初回処理とキャッシュ再利用で同一のSSOTを生成し、連続再構築時の `shared/data/hero_assets.js` SHA-256が一致しなければならない。

## rc.5 現在値

| 項目 | 状態 |
|---|---:|
| ImageGenグループマニフェスト | 6/6 |
| グリーンバック原画 | 90/90（167,875,667 bytes） |
| 透過原画 | 90/90（111,779,676 bytes） |
| 分割PNG | 1,224/1,224（81,770,537 bytes） |
| 配信用WebP | 90/90（28,266,438 bytes） |
| ローカルDSP WAV原音 | 90/90（9,953,802 bytes） |
| 配信用WAV | 90/90（9,953,802 bytes） |
| 音声内容ハッシュ | 90/90 unique |
| 統合SSOT | 18ヒーロー / 72アビリティ、`complete=true`、`contentSha256=6085b6af8b484e15248aa7717147e814bf925831410e7f8201002fde68d97c92` |

音声manifestのSHA-256は `5fe306133bcafe4bf704b792361376afdd4db6dc64c6bb1df724a77c12c98808`、生成器のSHA-256は `e94208ca76de3683559d87b78201b0ed7b89b9541bf73f36eb3f9994b1eaf7d8`。90件の長さは0.88〜1.80秒で、再生成2回のWAV hashとmanifest bytesは一致する。

## 実行時の扱い

- キャラクター選択ではヒーローのコンセプトアトラスを表示する。
- 能力の発動演出はアクションIDから専用アトラスを選び、フレームを時間進行させる。
- 武器/能力音はSSOTのWAVを事前デコードして使用し、検証・decodeに失敗したIDだけ既存の手続き音へ縮退する。
- 画像とWAVは、取得後にマニフェストのbyte数・SHA-256・内容ハッシュ付きファイル名・MIMEをブラウザ内で照合し、合格したバイト列だけをTextureLoader/AudioContextへ渡す。改変、ハッシュ欠落、Web Crypto不在時はfail-closedで専用アセットを使用しない。
- 音声90件が揃った時点でstrictビルドが手続き音への意図しない縮退を検出する。
