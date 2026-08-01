# AAA Audio Factory — ElevenLabs 大量生成・引き継ぎプロンプト

更新日: 2026-08-01  
状態: **250件の候補生成・技術QC・自動トリアージ・試聴キューまで完了。全件 candidate-only。**

現行実績: ElevenLabs候補 250/250 technical pass、mastered derivative 157件、
runtime admission 0件。2026-08-01のsecret-safe preflightは8 model listing、
`eleven_multilingual_v2`のTTS可用性、残credits 113,702、overage=falseを確認した。
詳細な現行実行プロンプトは
`docs/AAA_ELEVENLABS_AUDIO_FACTORY_EXECUTION_PROMPT_20260730.md`、250件の試聴順は
`outputs/audio-factory-20260730/HUMAN_LISTENING_PRIORITY_QUEUE.csv` / `.json` を正とする。

これは Kagariai を、固有IPを模倣せずに「高密度で、空間的で、競技可読性を損なわない AAA 水準」の
音響へ近付けるための実行設計である。視覚参照を固有名詞で指定するのではなく、
`陽光の強い石造海岸都市 / 金属と陶器 / 風 / 水路 / 多層の垂直空間` という抽象化した設計語彙を使う。

## 1. この文書の使い方

1. まず「0. 実行権限」と「2. 安全・権利ゲート」を満たす。
2. `7. マスタープロンプト` を新しい Codex タスクへ貼り、**manifest の設計だけ**を依頼する。
3. 人間が予算・プラン・権利・最初の小バッチを承認した後だけ、生成担当に `8. 実行プロンプト` を渡す。既存250候補は先に
   `HUMAN_LISTENING_PRIORITY_QUEUE.csv` の reject-first 順で試聴し、空欄の人手判定を埋める。
4. いきなり数百件を発火しない。`smoke 3件 → pilot 24件 → batch 100件` の順に、各ゲートを通す。

## 0. 実行権限と秘密情報の境界

- `ELEVENLABS_API_KEY` は秘密情報である。Markdown、Git、テスト出力、スクリーンショット、ブラウザJS、
  クライアント配布物、ログに書かない。
- キーは実行プロセスの環境変数からだけ読み、APIキー側でも **endpoint scope / credit quota / IP allowlist** を
  設定する。ElevenLabs はこれらの制限をキーに設定できる。  
  参照: [API Authentication](https://elevenlabs.io/docs/api-reference/authentication)
- この文書は**新しい生成を自動承認しない**。既存250件の候補生成は完了済みだが、追加の課金API呼び出し、プラン変更、
  音声アップロード、声のクローン、大量生成、公開・配布は、その時点で別途 Human GO を取る。
- APIの `429 too_many_concurrent_requests` はプランの同時実行枠超過である。枠は変動しうるため、
  実行時に契約を確認し、常に1枠を余らせる。  
  参照: [429 / concurrency](https://elevenlabs.io/docs/help-center/technical/api-error-code-429)

## 2. 安全・権利ゲート（必須）

### 2.1 固有IP・音楽

- 実在のアーティスト名、バンド名、曲名、歌詞、既存ゲーム名・既存キャラクター名をプロンプトに入れない。
- 「その作品そっくり」「同じ声」「〜風を完全再現」の依頼をしない。代わりにテンポ、編成、空間、感情曲線、
  ミックス、ゲーム機能を記述する。
- Music Terms は実在アーティスト名・相当量の既存歌詞などを禁止入力として挙げている。  
  参照: [Music Terms](https://elevenlabs.io/it/music-terms)

### 2.2 声

- 台詞は `Voice Design` で新規に設計した声、または本人が権利を持ち書面同意済みの演者の声だけを使う。
- 実在人物、声優、配信者、政治家、既存キャラクターを模倣・再現・誤認させる設計は禁止。
- Professional Voice Clone は本人の声のみで、本人確認が必要。第三者の声は、同意があっても自分のPVCとして
  作れない。  
  参照: [他人のPVCは作成不可](https://elevenlabs.io/docs/help-center/product/voice-customization/voice-cloning/can-i-create-a-professional-voice-clone-of-someone-elses-voice),
  [Prohibited Use Policy](https://elevenlabs.io/use-policy)

### 2.3 武器音

- 銃声は**架空のゲーム武器の音響資産**として生成する。実銃の製造・改造・運用手順、危害を具体化する情報は
  含めない。
- 競技性を優先し、敵味方、近中遠距離、命中種別、危険度を音だけで判別できるようにする。

## 3. 現行APIの使い分け（2026-08-01公式ページ再確認）

| 資産 | 推奨API | 実務上の使い方 | 事実根拠 |
|---|---|---|---|
| BGM・戦闘曲・楽曲ステム | `POST /v1/music` | 短いpilotから。modelごとの現行schemaを確認し、構造制御が必要な Music v2 では composition plan を優先する。初回は3秒〜5分に制限し、prompt形は実行時の公式schemaで対応を確認してから使う | [Compose music](https://elevenlabs.io/docs/api-reference/music/compose) |
| ループ環境音・UI・武器・能力・Foley | `POST /v1/sound-generation` | `eleven_text_to_sound_v2`。duration 0.5〜30秒、loop、prompt influence を使い分ける | [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) |
| 台詞・アナウンス・短いボイス反応 | `POST /v1/text-to-speech/:voice_id` | voice ID を固定し、台詞と発話設計を分離。必要に応じ pronunciation dictionaries / voice settings を使う | [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |
| 新規キャラクター声 | Voice Design → voice作成 | まずテキスト記述から複数previewを比較。クローンを前提にしない | [Voices](https://elevenlabs.io/docs/overview/capabilities/voices) |

補足:

- SFX は指定時 0.5〜30秒、非ループでは WAV 48kHz 出力の選択肢がある。ループや出力形式は契約・モデルの
  実行時サポートを確認する。  
  参照: [Sound effects overview](https://elevenlabs.io/docs/overview/capabilities/sound-effects)
- Music v2 は構造・プロンプト追従・ボーカルを改善している。Music API は有料加入者向けで、生成曲は最短3秒、
  最長5分。Music v2のcomposition planとprompt形の対応は更新されうるため、実行前に現在のAPI schemaを
  照合する。Compose API reference の `music_length_ms` 上限表記と製品overviewの最長表記が異なる場合は、
  より保守的な5分を採用し、実行時のschema・プランで確認する。  
  参照: [Eleven Music](https://elevenlabs.io/docs/overview/capabilities/music),
  [Music quickstart](https://elevenlabs.io/docs/eleven-api/guides/cookbooks/music)
- TTS の出力はデフォルトMP3で、使えるPCM/WAVなどの高品質形式はプランによる。ゲーム組込み前に**実際に使える
  出力formatを小バッチで確認**する。  
  参照: [TTS API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)

## 4. 目標カタログ（最初の492資産）

この数は「生成要求数」ではなく、最終採用候補の**asset slot**である。各 slot は `A/B/C` の3 variationを
持てるため、初期生成要求は 1,000件を超えうる。採用前に全件を一括発火しない。

| Family | Slot数 | 例 | 生成単位 |
|---|---:|---|---|
| BGM / stems / transitions | 48 | setup、探索、contest、overtime、勝敗、地域別環境音楽 | 15〜90秒曲、短いstinger、必要ならstem |
| Ambient loops | 72 | 海風、水路、布、鐘、遠い市場、屋上、室内、雨後 | 15〜30秒 seamless loop |
| Weapon vocabulary | 120 | 架空武器12種 × fire/reload/dry/impact/near/far 等 | 0.15〜4秒 one-shot |
| Ability / combat feedback | 80 | charge、cast、travel、impact、shield、heal、ultimate | 0.2〜6秒 one-shot / layered set |
| Movement / Foley | 60 | stone/wood/metal/water、jump/land/slide、cloth | 0.1〜3秒 one-shot |
| UI / objective / readability | 40 | capture、contested、transition、ally/enemy ping、menu | 0.1〜5秒 one-shot |
| Voices / announcements | 48 | objective announcer、hero barks、effort、callout | 0.4〜8秒 TTS |
| Cinematic / branding | 24 | logo、match intro、round end、reveal、defeat | 1〜20秒 |
| **合計** | **492** |  |  |

### 4.1 バッチの順序

| Gate | 件数 | 内容 | 合格条件 |
|---|---:|---|---|
| Smoke | 3 | BGM 1 / SFX 1 / voice 1 | API認証、保存先、metadata、秘密非露出を確認 |
| Pilot | 24 | 各 family から代表 | 方向性、音量、ループ、可読性を人間承認 |
| Batch-01 | 100 | 武器・UI・objectiveの最重要部 | プレイ中の聞き分け、重複率、技術QC |
| Batch-02 | 100 | movement / abilities / impact | 誤認ゼロ、過度な疲労感なし |
| Batch-03 | 100 | ambience / BGM stems | loop継ぎ目、音楽遷移、混雑時の余白 |
| Batch-04 | 100 | voices / barks / announcements | 演技一貫性、権利、台本・言語確認 |
| Batch-05 | 68+ | cinematic / 欠番 / 採用variation | 完全manifestと再生成余力 |

## 5. Manifest（生成より先に作る）

`asset_id` は永続IDで、プロンプト変更・再生成・採否を履歴化する。ファイル名だけを真実にしない。

```json
{
  "asset_id": "sfx.weapon.asagi.primary.fire.near.v001",
  "family": "weapon",
  "gameplay_owner": "asagi",
  "event": "primary_fire",
  "perspective": "near",
  "variant": "A",
  "api_kind": "sound_effect",
  "model_id": "eleven_text_to_sound_v2",
  "duration_target_s": 0.35,
  "loop": false,
  "prompt_influence": 0.72,
  "prompt": "...",
  "negative_constraints": ["no speech", "no music", "no real brand", "no clipping"],
  "requested_format": "wav_48000",
  "seed": null,
  "request_id": null,
  "provider_cost": null,
  "sha256": null,
  "technical_qc": "pending",
  "creative_qc": "pending",
  "rights_qc": "pending",
  "adoption": "candidate"
}
```

必須列: `asset_id`, `prompt`, `provider_model`, `provider_request_id`, `cost`, `input rights`,
`created_at`, `sha256`, `duration`, `peak`, `loudness`, `loop result`, `reviewer`, `status`, `replacement_of`。

## 6. プロンプト設計語彙

### 6.1 すべてのSFXに入れる7要素

`[機能] + [素材/機構] + [動き] + [時間] + [空間] + [周波数/ダイナミクス] + [除外事項]`

例:

> **Gameplay one-shot.** Fictional compact energy carbine primary-fire, short ceramic-and-brass mechanical snap followed by a tight luminous plasma crack, 0.32 seconds, close first-person perspective, dry courtyard reflections only, strong transient at 2–5 kHz for competitive readability, controlled low end, no voice, no music, no real weapon brand, no distortion or clipping.

### 6.2 BGMに入れる9要素

`[scene] + [intensity curve] + [tempo] + [meter] + [palette] + [melody rule] + [mix rule] + [loop/structure] + [negative]`

例:

> Instrumental competitive-game control-point music for a sunlit stone coastal city. 108 BPM, 4/4. Start spacious for 12 seconds, build to focused mid-intensity without becoming trailer bombast, then leave a clean 8-second loop tail. Muted hand percussion, low bowed strings, warm brass breath, small ceramic chimes, distant sea wind texture. Distinct original motif of three rising notes; no quoted melody, no vocals, no artist references, no excessive sub-bass, leave 1–4 kHz space for gameplay SFX.

### 6.3 台詞に入れる6要素

`[speaker bible] + [intent] + [emotional arc] + [pacing] + [language] + [audio-tag policy]`

例:

> New original adult Japanese objective announcer voice, calm and authoritative, never resembling a real person or existing character. Delivery: clear, 2.8 words/sec, warm neutral timbre, short breath before the final command. Speak only the provided Japanese text. Use one subtle emotional cue at most; no imitation, no singing, no background music.

## 7. マスタープロンプト — 設計・manifest作成担当用

以下を新しい Codex タスクにそのまま貼る。これは**課金APIを呼ばず**、生成計画だけを作る担当向け。

```text
あなたは Kagariai の AAA Audio Factory プロデューサー兼テクニカルサウンドデザイナーです。
目標は、固有IP・実在人物・実在アーティストの模倣をせずに、陽光の強い石造海岸都市、風、水路、
陶器、金属、垂直戦闘空間を持つ競技FPSのための、実装可能で可読性の高い音響資産台帳を作ることです。

最初に必ず次を守ること:
- ELEVENLABS_API_KEYを読まない、出力しない、APIを呼ばない、SDKをインストールしない。
- 実在のゲーム名、キャラクター、俳優、声優、アーティスト、楽曲、歌詞、ブランドをプロンプトに使わない。
- 声はVoice Designまたは権利・同意が記録済みのオリジナル演者だけを想定し、声のクローンを前提にしない。
- 生成は行わず、manifestとレビュー計画だけをoutputs/に作る。

成果物:
1. outputs/audio-manifest-draft.jsonl — 最初の492 slotのうち、まずBatch-01の100行。
2. outputs/audio-prompt-library.md — 各familyのprompt grammar、positive/negative例、variation軸。
3. outputs/audio-qc-rubric.md — 技術、競技可読性、演出、権利の採否基準。
4. docs/AAA_AUDIO_FACTORY_HANDOFF.md への追記案（既存内容を上書きしない）。

Batch-01の100枠は、武器40、ability 24、UI 20、objective 8、movement 8とする。
各行に asset_id, event, perspective, duration_target_s, loop, api_kind, model_id,
prompt_influence, original prompt, negative constraints, variation axis, requested format,
QC assertions, dependency, status=pending_human_go を必ず入れる。

競技音のルール:
- 敵対的な危険は 150–2500 Hz の識別核を持ち、味方/敵/近/遠/遮蔽越しを混同させない。
- 重要音は環境音・BGMと帯域/タイミングを競合させない。
- 1つのアクションを1つの"万能音"にしない。near/mid/far、start/travel/impact、surface差を分ける。
- BGMはゲームプレイSFXのために中域の余白を残す。
- 同じpromptの焼き直しは禁止。variationは素材、距離、空間、演奏、エネルギー曲線のいずれかを明示的に変える。

最後に、生成を実行する前に人間へ確認すべき質問（予算、レーティング、言語、声の権利、
ミドルウェア、出力形式、最初の100件）を短く列挙すること。
```

## 8. マスタープロンプト — 承認後の生成実行担当用

以下は **Human GO後だけ** 使用する。実行担当は、生成開始前にキーが存在するかを真偽だけで確認し、
値を絶対に表示しない。

```text
あなたは Kagariai Audio Factory の安全なバッチ実行担当です。
Human GOで承認された manifest だけを処理し、承認されていないasset_idは1件も生成しないでください。

開始前チェック:
1. ELEVENLABS_API_KEYの値を表示せず、存在だけを確認する。なければ停止して報告する。
2. APIキーが server-side のみで使われ、scope/credit quota/IP制限が設定済みかを確認する。
3. 現在のElevenLabsプラン、APIが使えるmodel、利用可能なoutput format、残クレジット、並列枠を確認する。
4. 予算上限、今回のasset_id数、最大同時実行数、保存先、再試行上限をmanifestとHuman GOから読み取る。
5. 実在アーティスト名、曲名、歌詞、既存IP名、実在人物の声、権利不明なreference audioが1件でもあれば
   その行を quarantine にし、APIを呼ばない。

実行規則:
- smoke 3件 → 人間レビュー → pilot 24件 → 人間レビュー → 100件バッチ、の順。前ゲートが未承認なら停止。
- BGMは POST /v1/music（modelとrequest schemaを実行時に照合）、SFXは POST /v1/sound-generation、
  台詞は POST /v1/text-to-speech/:voice_id。
- APIのモデル/formatは実行時にGET /v1/models等の公式API応答で確認し、manifestと照合する。
- concurrencyは契約枠より1少なく、初回は1から開始する。429/system_busyでは指数バックオフ+jitter。
  成功率低下、予算超過、schema不一致、同じ失敗の3回連続でバッチを停止する。
- request-id、trace-id、character-cost等のレスポンスmetadata、ファイルhash、duration、出力formatをmanifestへ記録する。
- 生成音声そのもの、キー、HTTP Authorization相当の情報をログへ出さない。
- 音声は staging にだけ保存し、technical QC / creative QC / rights QC が全てpassになるまでゲーム資産へ昇格しない。

品質QC:
- technical: decode可、目標duration、無音でない、clipなし、想定sample rate/format、loopなら継ぎ目のclickなし。
- competitive: near/mid/far、ally/enemy、start/impact、danger/utilityをブラインド試聴で区別できる。
- creative: 固有の素材感、他assetとの差、環境との調和、過度な耳疲労がない。
- rights: prompt/reference/voiceが権利・同意・利用規約に適合する。

終了時に、成功/失敗/quarantine/予算/再試行/採用候補をasset_idごとにまとめ、
次バッチへ進んでよいかHuman GOを求めること。自動で次の100件へ進まないこと。
```

## 9. Batch-01 の100資産IDテンプレート

以下の一意IDを最初のmanifestで展開する。各IDは `A/B/C` variationを**候補**として持つが、
採用はブラインド比較後に1つだけ決める。

```text
# Weapons (40)
sfx.weapon.{asagi,hokuchi,shirasagi,ankou}.primary.{fire_near,fire_mid,fire_far,impact_stone,impact_metal,reload,empty,charge}.{A,B,C}

# Abilities (24)
sfx.ability.{asagi,hokuchi,shirasagi,ankou,hibari,tsuzuri}.{cast,travel,impact,heal,shield,ultimate}.{A,B,C}

# UI (20)
sfx.ui.{confirm,cancel,focus,hit_confirm,crit_confirm,damage_taken,low_health,healed,ally_ping,enemy_ping,menu_open,menu_close}.{A,B,C}

# Objective (8)
sfx.objective.{unlock,capture_start,capture_tick,contested,lead_change,transition,resolved,round_end}.{A,B,C}

# Movement (8)
sfx.movement.{stone_step,wood_step,metal_step,shallow_water_step,jump,land,slide,cloth}.{A,B,C}
```

> 実装時は上記の `{}` を機械的に展開せず、各 asset_id に対して **距離・役割・素材・negative constraints** の
> 固有行を与える。A/B/Cは同じ音を複製する番号ではない。

## 10. ToDo / Human GO チェックリスト

- [ ] 商用利用予定、年齢レーティング、対象プラットフォーム、音声言語を決める。
- [ ] ElevenLabsの有料プラン、Music API可否、実行時のモデル・format・同時実行枠・予算を確認する。
- [ ] `ELEVENLABS_API_KEY` をserver-side secretに置き、scope/credit quota/IP allowlistを設定する。
- [ ] 音声保存先（staging / approved / rejected）と、manifest・hash・保管期間を決める。
- [ ] 声の方針を決める: Voice Design / 本人演者 / 契約済み声。第三者クローンは禁止。
- [ ] 100件のBatch-01 manifestをレビューし、固有IP・実在人物・アーティスト名・歌詞を除外する。
- [ ] Smoke 3件の課金上限を承認する。
- [ ] Pilot 24件のブラインド試聴参加者と採点基準を決める。
- [ ] loudness / peak / loop / distance attenuation / middleware event mapping の数値基準をプロジェクトで確定する。
- [ ] 実装時に asset manifest builder、license test、runtime asset integrity test を更新し、全回帰を通す。
- [ ] Human GOなしに100件以上へ進まない。

## 11. 完了定義

`AAA audio factory complete` と言えるのは、次がすべて揃ったときだけである。

1. 採用済み音の全asset_idに、prompt・request metadata・hash・権利記録・QC結果がある。
2. 競技上重要なイベントの聴覚可読性が、実プレイまたはブラインド試聴で検証済み。
3. BGM / ambience / SFX / voice が同じ音量帯を奪わず、状況に応じたducking/priorityが実装済み。
4. 全生成は予算・契約・権利の範囲内で、秘密情報を露出していない。
5. ローカルテスト、ゲーム内統合、対象環境での実機再生がそれぞれ別々に緑である。

この文書は「大量生成の許可」ではなく、**許可を受けてから安全に大量生成するための設計図**である。
