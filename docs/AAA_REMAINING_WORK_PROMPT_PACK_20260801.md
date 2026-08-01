# AAA / Suravasa-quality 残作業・引き継ぎ Prompt Pack — 2026-08-01

この文書は、Kagariai の残作業を別 agent / 別セッションへ渡すための実行契約である。
目標は「企画開始時の要求を、測定可能な完成候補まで閉じる」ことであり、ローカルの
technical PASS を AAA art approval や runtime 採用と呼ばない。

## 0. 絶対境界

- 作業ルートは `C:\Users\rambo\projects\kagariai-props` のみ。
- `C:\Users\rambo\Downloads\SURAVASA` は参照・検査・コピー・類似化の対象にしない。
- `presentation` は collision に流さない。map の fake-cover cluster 規則を緩めない。
- 新規画像・音声・モデル・音声候補は、権利、視覚/聴覚、人間判定、ゲーム内 mix、性能、
  runtime admission の各ゲートが別々に green になるまで `candidate` のままにする。
- API key、authorization header、provider の私的情報は画面・ログ・manifest・markdown・
  commit に出さない。`ELEVENLABS_API_KEY` は server-side process の header にだけ渡す。
- 既存の Local DSP 音源、既存 map、既存 gameplay 契約を、候補があるという理由だけで置換しない。
- 破壊的な削除、公開、push、deploy、runtime 登録はこの文書の local task に含めない。

## 1. 先に読むファイル

1. `docs/AAA_HANDOFF_INDEX_20260801.md`
2. `docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md`
3. `docs/AAA_CONTINUATION_ADDENDUM_20260801.md`
4. `docs/AAA_FINALIZATION_TODO_20260729.md`
5. `work/asset-rush/aaa-v1-pilot/manifest.json`
6. `outputs/VERIFICATION_RECORD_20260801.md`
7. 音声を触る場合は `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`
8. map を触る場合は `docs/AAA_MAP_HANDOFF.md`

## 2. 現在の証拠と状態

| 対象 | 現在の証拠 | まだ閉じていないもの |
|---|---|---|
| Map / collision | authored collision hash `66EB52BB...3BBC29`、既存 route/fake-cover 回帰 | human playtest、art direction、公開/統合 |
| Headless balance | `outputs/headless-balance-20260801.json`、6/6 BO3、roster 18/18、east/west 0.60/0.40、swap 6/6、severe bias=false | human 5v5 playtest |
| Tide Marker 01 | 1,156 triangles / 2 calls、WebGL、Tier-1 IoU 0.9123、multi-angle 1.0011/1.0394、collision=none | human art、real map safety、runtime admission |
| Market Awning 01 | strict spec PASS、10 components、3 hero materials、8 linked details、PBR 0.93、browser candidate PASS（820 triangles / 3 calls、4 hash-verified views） | Tier-1/multi-angle、fake-cover/map audit、人間レビュー |
| Roof Finial 01 | strict spec PASS、8 components、3 hero materials、7 linked details、PBR 0.93、browser candidate PASS（808 triangles / 2 calls、4 hash-verified views） | Tier-1/multi-angle、roof clearance/sightline、人間レビュー |
| ElevenLabs | 350 technical candidates、257 mastered、runtime admission 0、残 credits 111,852、overage=false。Wave 002 は100/100 technical + 100/100 mastered | 350件の人手試聴、rights/creative/mix、runtime admission |

新規2候補の strict 証跡は `outputs/aaa_img2threejs_candidate_specs_20260801.json`、
browser 証跡は `outputs/aaa_img2threejs_browser_evidence_20260801.json`。
strict spec / browser candidate PASS は Tier-1、map、human art、runtime PASS ではない。

## 3. 依存順 TODO

### P0 — 変更を安全に閉じる

- [x] 最終フル source suite を実行し、870/870、exit 0、TAP hash
  `EAFABA5471E42F24DB3A5E177AFB4309AB82CA5909E4352C5E39C5C6804DBC43` を記録した。
- [x] `tools/generate_authored_map_collision.js --check` を再実行し、manifest hash
  `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` を記録した。
- [x] dirty worktree の unrelated changes を保持し、`git diff --check` exit 0 を確認した。
- [ ] map の `979 !== 977` は test 合成手順の既知バグとして記録し、実装を勝手に書き換えない。

### P1 — 新規2つの Image → Three.js

- [x] `prop-market-awning-01` の browser preview を作成し、820 triangles / 3 calls、WebGL=true、4 view hash evidence を記録した。
- [x] `prop-roof-finial-01` の browser preview を作成し、808 triangles / 2 calls、WebGL=true、4 view hash evidence を記録した。
- [x] 各候補で front / three-quarter / rear / top-clearance と neutral / grazing / reference light を記録した。証跡は `outputs/aaa_img2threejs_browser_evidence_20260801.json`。
- [ ] orbit が source camera にだけ合わないことを確認する。finial の fins はカードにしない。
- [ ] awning は alpha fringe を積まず、canopy/poles/rings/cords が body-height fake cover にならないことを real-map で測る。
- [ ] finial は roof socket の上、playable surface から 0.25 m 以上離し、climbable step/collision にしない。
- [ ] 人間 art-direction が終わるまで manifest の `adoptionState` は `candidate` のままにする。

### P2 — 音声の人手ゲート

- [ ] `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv` の `REJECT_OR_REGENERATE_REVIEW` 69件を先に聴く。
- [ ] 次に `LISTEN_FIRST` 80件、最後に normal 201件を、isolated / combat mix / distance-occlusion で確認する。
- [ ] 各行に identity、distance readability、mask resistance、loop seam、duplication、noise、rights、creative fit、competitive readability、in-engine mix、adoption を記録する。
- [ ] technical flag は採用決定ではない。人手欄が空欄の候補は runtime に入れない。

### P3 — 次の音声 wave

- [x] Wave 002 を100件として manifest → dry-run → concurrency=1生成 → technical QC → mastering → scorecard の順で実行した。詳細は `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`。
- [x] Wave 002 の総 credit ceiling 2,400、同時実行数1、retry上限3、mp3_44100_192を manifest/実行記録に固定した。
- [ ] Wave 001 の結果を聴く前に 492件/600件を一括生成しない。重複・権利・mix の失敗を拡大しない。
- [ ] BGM、ambient loop、weapon、ability、movement/foley、UI/objective、cinematic、voice を同じ prompt grammar と台帳で管理する。

## 4. Prompt A — master continuation agent

```text
You are the evidence-first continuation owner for Kagariai.

Work only in C:\Users\rambo\projects\kagariai-props. Never inspect, copy, or derive from
C:\Users\rambo\Downloads\SURAVASA. Preserve unrelated dirty-worktree changes.

Read, in order:
  docs/AAA_HANDOFF_INDEX_20260801.md
  docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md
  docs/AAA_CONTINUATION_ADDENDUM_20260801.md
  docs/AAA_FINALIZATION_TODO_20260729.md
  work/asset-rush/aaa-v1-pilot/manifest.json
  outputs/VERIFICATION_RECORD_20260801.md

Current truth:
  - map/collision and six-rotation headless evidence are local technical PASS only;
  - Tide Marker is a 1,156-triangle/2-call browser candidate with collision=none;
  - Market Awning 01 and Roof Finial 01 have strict authored specs, PBR evidence,
    and isolated browser candidate evidence (awning 820 triangles/3 calls,
    finial 808/2, four hash-verified views each), but no Tier-1/map admission;
    browser evidence is recorded in outputs/aaa_img2threejs_browser_evidence_20260801.json;
    do not repeat the already-completed preview step from the older P1 checklist;
  - verification is current at 870/870 tests, collision hash
    66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29,
    and git diff --check exit 0; refresh hashes only after a new run;
  - next visual work starts at Tier-1/multi-angle and real-map safety, not at
    browser preview authoring; next audio work starts at human listening and
    rights/creative/mix review, not at runtime admission;
  - ElevenLabs has 350 technical candidates / 257 mastered / 0 runtime admissions;
    Wave 002 is complete at 100/100 technical and 100/100 mastered;
  - every candidate remains candidate-only.

Start with read-only inspection and a TODO frontier. Then close every safe local item:
  1. run focused tests, full suite, collision check, and git diff --check;
  2. finish exactly one visual candidate gate at a time, obeying its SAFETY_POLICY.md;
  3. keep renderer, map safety, human review, rights, playtest, and runtime admission as
     separate gates;
  4. update the handoff docs and verification record with paths, counts, hashes, and the
     exact unverified boundary;
  5. never claim AAA or Suravasa equivalence from a static test or generated reference.

Stop and record a blocker only when the same external/human gate is genuinely repeated;
otherwise continue with the next bounded local task. Do not publish, deploy, push, or add
candidate assets to runtime.
```

## 5. Prompt B — new visual candidate finisher

```text
You own exactly one candidate under
C:\Users\rambo\projects\kagariai-props\work\asset-rush\aaa-v1-pilot\img2threejs.

Read the candidate's SAFETY_POLICY.md, CANDIDATE_REVIEW.md, NEXT_GATE.md, and
OBJECT_SCULPT_SPEC.json. Do not inspect SURAVASA. Do not modify map collision or runtime.

Use the authored component tree; do not replace it with a generic one-mesh blockout.
Run the img2threejs gates in order:
  probe_image -> pre-spec/detail inventory -> strict spec -> blockout -> structural ->
  form -> material -> surface -> lighting -> interaction -> optimization.

For every visual pass capture the same reference pairing plus:
  front, three-quarter, rear-side, top/clearance, neutral light, grazing light,
  reference-matched light, and an orbit view.

Measure and report:
  assetTriangles, assetDrawCalls, WebGL state, console errors, camera framing,
  component visibility, material response, and collision=none/presentation-only.

Safety hard fails:
  - any uncollidable body-height opaque cluster;
  - any alpha fringe stack or billboard that hides the real open volume;
  - any fin/fold/fastener that exists only in color when its silhouette requires geometry;
  - any roof socket/canopy part that becomes climbable or gameplay cover;
  - any budget overrun without an identity-preserving reduction and a new measurement.

When done, update only candidate-local evidence and docs. Keep adoptionState=candidate and
admission=NOT_RUNTIME_ADMITTED until human art direction, real-map safety, and runtime gates
are independently recorded.
```

## 6. Prompt C — ElevenLabs bulk candidate factory

```text
You are the Kagariai original-audio factory owner. This is a candidate-generation wave,
not a runtime-admission task.

Repository: C:\Users\rambo\projects\kagariai-props
Read:
  docs/AAA_REMAINING_WORK_PROMPT_PACK_20260801.md
  docs/research/elevenlabs_audio_api_execution_refresh_20260730.md
  docs/AAA_ELEVENLABS_AUDIO_FACTORY_EXECUTION_PROMPT_20260730.md
  outputs/audio-factory-20260730/execution-summary.json
  outputs/audio-factory-20260730/HUMAN_LISTENING_SCORECARD.csv

Credential rules:
  - Read ELEVENLABS_API_KEY only from process environment.
  - Send it as xi-api-key. Never print the key, header, environment dump, curl command,
    raw response, or account-private data.
  - Run the secret-safe preflight first. Confirm enabled models, credit limit/remaining,
    overage policy, endpoint schema, concurrency, and output format.
  - If preflight is stale or remaining credits are below the manifest ceiling, stop before
    any request and write a blocked report.

Canonical API routes (verify live official documentation before execution):
  - SFX: POST /v1/sound-generation with model_id=eleven_text_to_sound_v2;
    duration_seconds 0.5–30, loop boolean, prompt text bounded by the live contract.
  - Music: POST /v1/music with model_id=music_v2; use either prompt or composition_plan,
    never both; music_length_ms 3,000–600,000; force_instrumental for BGM when required.
  - Voice: POST /v1/text-to-speech/{approved_voice_id} with an approved premade or
    project-owned voice only; never clone or imitate a real person without explicit rights.
  - MCP is optional. If an MCP tool exposes the same endpoints, keep the same manifest,
    hashes, request IDs, dry-run, and candidate-only gates. Direct HTTPS remains the
    auditable fallback.

Wave policy:
  - Build a JSON manifest before HTTP. Every row has stable asset_id, family, gameplay
    owner/event, endpoint, model, exact prompt, negative constraints, duration/loop,
    variation axes, output path, estimated credits, request hash, candidate-only state,
    and rights note.
  - First wave is exactly 100 assets, executed in four 25-asset chunks. Set a hard
    max-assets=100, max-estimated-credits in the manifest, concurrency <=3, retries <=2,
    exponential backoff, and no overwrite of prior candidate files.
  - Use immutable raw output plus a separate mastered derivative. Preserve request ID,
    trace ID/song ID where returned, HTTP status, response format, timestamp, file hash,
    byte count, and technical QC result.
  - A failed or ambiguous row is quarantined; do not silently regenerate under the same ID.

Recommended 100-slot first wave:
  24 weapon families (fictional carbine, scatter, pressure cannon, crystal rifle,
     needle launcher, blade/impact hybrid; each with near/mid/far fire, reload, dry,
     charge, impact, overheat or alternate fire where appropriate)
  16 ability/ultimate families (charge, release, travel, hit, miss, shield, water,
     ceramic, bronze, wind, glass, stone, fire-like energy without real weapon samples)
  16 movement/foley (stone, wet stone, wood, ceramic, cloth, rope, metal, landing,
     jump, slide, vault, equipment rustle; close and distance variants)
  12 UI/objective (focus, confirm, cancel, hit, damage, capture start/tick/contested,
     round start/end, respawn, warning; no alarm or existing-game imitation)
  12 ambient loops (coastal wind, canal water, canvas awning, rooftop, market lane,
     stone alley, shrine approach, rain-on-stone, distant bell, low crowd texture with
     no intelligible speech; 8–30 seconds and loop=true)
  8 BGM/music candidates (menu, market, approach, calm round, combat, overtime,
     victory, defeat; original instrumental prompts, 30–120 seconds, no named artists)
  12 approved voice candidates (Japanese/English operations lines using approved
     premade or owned voice IDs; several delivery/emotion/distance variants, no real
     person likeness or clone; if voice rights are not recorded, generate zero voice rows)

Prompt grammar:
  [gameplay event] + [fictional material/source] + [perspective/distance] +
  [duration/loop] + [frequency/attack/tail intent] + [mix role] + [negative constraints].
  Every prompt must say original fictional material, no speech/music when SFX, no named
  artist/song/game/brand, no real-person voice, no clipping, and no source audio.

Technical QC before any human claim:
  - decode all files; verify codec, sample rate, channels, duration tolerance, non-silence,
    peak/clipping, DC offset, zero-crossing/attack, loop seam, and hash/path uniqueness;
  - flag near-silent, clipping-risk, under-audible, DC-offset, attack-dominant,
    tail-dominant, and duplicate/near-duplicate candidates;
  - write a review queue but leave human rights/creative/mix/adoption fields blank;
  - never copy candidates into runtime or overwrite Local DSP assets.

After each 25-row chunk, save a resumable checkpoint and stop if credit use, error rate,
schema drift, output format, or rights ambiguity violates the manifest. Finish with a
summary containing requested/completed/failed, credits used, remaining credits (boolean-
safe account data only), hashes, QC counts, and the exact human gate still open.
```

## 7. Prompt D — audio human review owner

```text
Do not call ElevenLabs and do not modify raw/mastered files.

Read HUMAN_LISTENING_PRIORITY_QUEUE.csv and the referenced candidates. Review in this
order: REJECT_OR_REGENERATE_REVIEW, LISTEN_FIRST, then NORMAL_LISTENING_QUEUE.
For each row listen in three contexts: isolated, plausible combat mix, and distance /
occlusion. Score 0–5 for identity, distance readability, mask resistance, loop seam,
duplication, and noise. Then record rights_review, creative_fit, competitive_readability,
in_engine_mix, adoption, reviewer, and notes.

Reject or hold anything that resembles a named artist/song/game, a real-person voice,
an unlicensed sample, or a recognisable third-party signature. A technical PASS is not
an adoption decision. Only a separate evidence-backed manifest with all required human
fields may make a candidate runtime-eligible; all other rows remain candidate-only.
```

## 8. Prompt E — map/runtime finisher

```text
Work only in C:\Users\rambo\projects\kagariai-props. Read docs/AAA_MAP_HANDOFF.md first.

Treat all presentation assets as collision=none until a separate authored collision
decision exists. Run the existing map visual, collision, route, camera, fake-cover, and
performance checks without changing gameplay rules. The cluster rule is structural:
nearby cladding is evaluated together over the actual jump-reachable top surface and
body-height band; individual sub-0.8 m parts do not excuse a combined opaque cover mass.

For every visual change report before/after triangles, instances, draw calls, layers,
nearest-cover p50, route count, unsafe count, camera usability, and collision manifest
hash. Keep the map and runtime candidate gates separate from human playtest and release.
```

## 9. 完了の定義

この pack の作業を「完了」と書けるのは、該当項目について次が全て残った場合だけである。

- source / request / prompt / negative constraints / SHA-256 / byte count が追跡できる。
- static/schema/technical tests と renderer evidence が別々にある。
- 画像は front だけでなく orbit / neutral / grazing / reference-matched で見ている。
- 音声は isolated だけでなく combat mix / distance-occlusion で聴いている。
- collision、fake-cover、route、camera、performance、rights、human approval が別の証跡になっている。
- `candidate` / `NOT_RUNTIME_ADMITTED` の境界が manifest、handoff、verification record で一致している。
- 未確認事項を「AAA」と言い換えていない。

最終成果物の入り口は `docs/AAA_HANDOFF_INDEX_20260801.md`、新規候補のstrict証跡は
`outputs/aaa_img2threejs_candidate_specs_20260801.json`、音声の公式契約は
`docs/research/elevenlabs_audio_api_execution_refresh_20260730.md` である。
