# ElevenLabs 音声 API 実行調査（2026-07-29）

対象は Kagariai のオリジナル AAA 音声工場（BGM、SFX、非識別ゲーム音声）である。これは公式ドキュメントを読むだけの調査であり、API 呼び出し、キーの読取り、音声生成、課金発生は行っていない。

## 実行に使える公式 API

| 用途 | HTTP / endpoint | 入力と主要パラメータ | 出力・制約 |
|---|---|---|---|
| BGM / music | `POST https://api.elevenlabs.io/v1/music` | JSON。`prompt`（最大4,100文字）または `composition_plan`（相互排他的）、`music_length_ms` 3,000–600,000、`model_id`、`seed`、`force_instrumental`、`store_for_inpainting`、`sign_with_c2pa`。`output_format` クエリは既定 `auto`。 | 指定形式の音声バイナリ、`song-id` レスポンスヘッダ。`auto` は v1 が `mp3_44100_128`、v2 が `mp3_48000_192`。音楽 API は有料サブスク向け。 [Compose music](https://elevenlabs.io/docs/api-reference/music/compose)、[Music overview](https://elevenlabs.io/docs/eleven-creative/products/music)、[Music API](https://elevenlabs.io/music-api) |
| SFX / Foley | `POST https://api.elevenlabs.io/v1/sound-generation` | JSON。必須 `text`、任意 `loop`（`eleven_text_to_sound_v2` のみ）、`duration_seconds` 0.5–30、`prompt_influence` 0–1、`model_id`（既定 `eleven_text_to_sound_v2`）。`output_format` クエリは codec_sample_rate_bitrate。 | 生成音声 MP3。レスポンス `character-cost`。ドキュメント上、MP3 各種、PCM/WAV 等の形式 enum があるが、契約プランに依存する（MP3 192 kbps は Creator 以上、PCM 44.1 kHz は Pro 以上）。 [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) |
| TTS / announcer・bark | `POST https://api.elevenlabs.io/v1/text-to-speech/:voice_id` | JSON。必須 `text`、任意 `model_id`（既定 `eleven_multilingual_v2`）、`language_code`、`voice_settings`、最大3個の pronunciation dictionary locator、`seed` 0–4,294,967,295（同一パラメータで同一結果を目指す best effort、保証なし）、前後テキスト/最大3個の `previous_request_ids`・`next_request_ids`。 | 音声ファイル（既定 `mp3_44100_128`）。`output_format` は codec_sample_rate_bitrate。MP3 192 kbps は Creator 以上、PCM/WAV 44.1 kHz は Pro 以上。ストリーミング API もあり、応答は音声チャンク。 [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)、[Streaming TTS](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming) |

モデル選択は固定値を盲目的に使わず、Human GO 後に `GET /v1/models` の `can_do_text_to_speech`、最大文字数、言語、`concurrency_group` 等を確認する。 [List models](https://elevenlabs.io/docs/api-reference/models/list)

## 認証とアカウント状態（実行前ゲート）

- API リクエストは `xi-api-key` HTTP ヘッダで認証する。キーには endpoint scope、credit quota、IP allowlist を設定できる。キーは秘密情報であり、ブラウザ・アプリ・ログへ出さない。 [API Authentication](https://elevenlabs.io/docs/api-reference/authentication)
- 実行前に、承認された server-side 実行環境でのみ、現在のプラン、Music API 可用性、credit/character 上限、同時実行数を人間が確認する。公式の read-only メタデータ endpoint は `GET /v1/user`（ユーザー・subscription 情報）と `GET /v1/user/subscription`（tier、character_count/limit、credit extension、voice slots、次回 reset 等）である。キー値そのものを記録・表示しない。 [Get user](https://elevenlabs.io/docs/api-reference/user/get)、[Get user subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get)
- Music の公式概要は API access を paid subscribers としている。現アカウントが対象かは API を呼ばず、root のアカウント確認に委ねる。

## 429、再試行、重複課金の扱い

- 公式 429 ページは `too_many_concurrent_requests`（契約プランの同時実行上限）と `system_busy`（サービス混雑）を区別する。プラン別同時実行数は Free 2 / Starter 3 / Creator 5 / Pro 10 / Scale 15 / Business 15 と記載されるが、将来変更され得る。`system_busy` は再試行で成功する場合がある。 [API error code 429](https://elevenlabs.io/docs/help-center/technical/api-error-code-429)
- 公式 API 参照で、POST 生成 endpoint に一般的な `Idempotency-Key` パラメータ/保証は確認できなかった（未文書化であることは非対応の証明ではない）。したがって、同じ生成を自動再送して重複課金しないよう、クライアント側で asset_id と入力ハッシュを dedupe し、`request-id`/`trace-id`/`song-id`/`character-cost` を保存する。TTS の `seed` は再現性 best effort に過ぎず、idempotency ではない。 [API Introduction](https://elevenlabs.io/docs/api-reference/introduction/)
- 429 は指数 backoff + jitter、`system_busy` も限定回数の再試行、401/422 は再試行せず設定/入力を修正する、という運用を採用する。最大並列数はアカウントの実測/確認値より1以上低く設定し、429 が続く場合はバッチ停止して Human GO を再取得する。これは公式 429 の原因説明に基づく安全側の実装判断である。

## 出力・QC で記録するもの

各 asset manifest に endpoint、model、全入力パラメータ、要求 format、HTTP status、`request-id`（TTS の例）、`trace-id`、`song-id` または `character-cost`、受信バイトの SHA-256、実測 duration/sample rate/codec/peak/loudness、loop 判定を記録する。公式 API は生成音声バイナリを返すが、ゲーム用の WAV 48 kHz 可否や上位 bitrate はプランと選択した enum を smoke で確認するまで未確定である。

## 音声の独自性・安全性

Voice Design 等で新規の架空ボイスを使い、実在人物・俳優・既存キャラクターの声を模倣しない。Prohibited Use Policy は同意/法的権利なしの他人の声の意図的複製を禁止している。 [Prohibited Use Policy](https://elevenlabs.io/use-policy)

## ライセンス／ポリシー上の留意点

- 無料プランは商用ライセンスを含まない。ヘルプセンターは有料プラン生成物を商用利用可能（Beta Services を除く）と説明している。 [Can I publish the content I generate?](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- Music API ページは paid plans の広い商用利用を説明する一方、film/TV/large studio game rights は Enterprise としている。Kagariai の配布形態がこの区分に該当するかは契約担当者/Human GO が確認する。 [Music API](https://elevenlabs.io/music-api)
- Prohibited Use Policy は Sound Effects product の出力を「standalone basis」で商用利用・再配布・ライブラリ化することを禁止している。ゲームに統合した利用が standalone に当たらないか、SFX を配布可能な素材ライブラリとして扱わないかを rights QC で確認する。 [Prohibited Use Policy §9(c)](https://elevenlabs.io/use-policy)
- 入力プロンプト、参照音声、歌詞等について Kagariai 側が必要な権利を持つこと、著作権・商標・実在人物識別情報を持ち込まないことを前提にする。ElevenLabs のポリシー適合だけでは Kagariai の権利確認を代替しない。

## 未確定事項（API を呼ばずには確定できない）

1. 現在のアカウント tier、Music API entitlement、credit 残量、実際の concurrency、利用可能 output enum。
2. Kagariai の対象配布（小規模ゲーム、商用ゲーム、large studio 等）に適用される Music/SFX/TTS 契約条項。
3. 実際の生成物の originality、音質、ループ境界、ゲーム内ミックス適合性。
4. `Idempotency-Key` の実装有無、Retry-After や concurrency ヘッダの全 endpoint での提供有無（参照ページで保証を確認できなかった）。

## 実行順序（Human GO 後のみ）

1. root がキーを表示せず account/subscription/model/format/concurrency を確認。
2. 1 BGM + 1 SFX + 1 架空 TTS の smoke を、低い並列（開始時1）で実行し、manifest/QC/権利ゲートを通す。
3. 同一入力ハッシュの重複送信を禁止し、429 は backoff、継続時は停止。
4. smoke/pilot の人手レビュー後にのみバッチへ進む。これは API の技術可否を示す調査であり、生成許可ではない。

