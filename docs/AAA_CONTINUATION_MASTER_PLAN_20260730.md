# AAA 継続マスタープラン — 2026-07-30

この文書は、Kagariai の map / audio / original visual candidates を、企画開始時の
要求から「検証可能な完成」まで繋ぐための唯一の現在版 handoff です。旧 handoff は
履歴証跡として保持し、本書の現在値と優先順を上書きしません。

> 重要: 「AAA」は品質目標であり、ここにあるローカル技術合格や候補生成は外部の
> AAA art review、法務承認、リリース承認、または runtime 採用を意味しない。

## 0. 最初に読む順番

1. `docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md`（本書）
2. `docs/AAA_CONTINUATION_ADDENDUM_20260801.md`（最新の実測と再開コマンド）
3. `outputs/audio-factory-20260801/execution-summary-wave002.json`（音声の現在値）
4. `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_SCORECARD.csv`（350件の採否台帳）
5. `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv`（350件の試聴順と空欄の人手判定欄）
6. `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`（公式 API 契約）
7. `docs/AAA_MAP_HANDOFF.md`（map の既存境界と安全契約）
8. `work/asset-rush/aaa-v1-pilot/manifest.json`（visual candidate の唯一の台帳）
9. `docs/AAA_EXECUTION_HANDOFF_20260729.md`（過去の実行証跡。現在値は本書優先）
10. `outputs/aaa_img2threejs_candidate_specs_20260801.json`（新規2候補のstrict spec証跡）
11. `docs/AAA_REMAINING_WORK_PROMPT_PACK_20260801.md`（残作業と大量音声生成の引き継ぎprompt）

## 1. 現在の真実

| 領域 | 実際にあるもの | 未達・採用を止めるゲート |
|---|---|---|
| Map | 既存 handoff のローカル検証済み map / collision / route 成果物 | 人間の art-direction、完全な playtest、runtime/公開の別証跡 |
| Audio candidate catalog | **350** original provider candidates、technical QC **350/350**、mastered derivative **257/257**。Wave 002 は100/100 technical + 100/100 mastered | rights、creative fit、competitive readability、in-engine mix、human listening review。全件 candidate-only |
| Audio provider usage (この実行) | 旧 preflight 7,303 → Wave 002後 9,153 credits（差分1,850）、残111,852、overage=false | 次の外部生成は改めて利用可能性・予算・同意を確認する |
| Visual reference catalog | original generated reference が **9** 件。すべて candidate-only | image → 3D strict pipeline、visual review、map safety、runtime integration |
| Tide Marker 01 | 2 asset mesh / 2 call の refined candidate。ブラウザ実測 asset 1,156 triangle / 2 call、reference-light capture frame 1,156 triangle / 2 call、WebGL PASS、Tier-1 IoU 0.9123、multi-angle degenerate=false、collision=`none` | candidate-only。local img2threejs 8 pass 完了。human art-direction、map runtime admission、integrated FPS は未実施 |
| Navigation | 非有限値・coercible object を fail-closed にする対象入力回帰を追加 | full suite exit 0。ルールや競技バランスを変えない |
| Automated six-rotation balance | `outputs/headless-balance-20260801.json` | 6/6 BO3完走、18/18 roster、east/west 0.60/0.40、round-two swap 6/6、ultimate average 3.25、severe bias=false; human playtest remains open |

### この継続実行での再検証

- targeted: audio factory / preflight / manifest builders / summary / human scorecard /
  bot navigation / Tide static contract / asset provenance の **49/49 PASS**。その後の
  audit/master path-safety 追加回帰も **13/13 PASS**。
- full source suite: `node --test --test-reporter=dot "tests/*.test.js"` が
  **exit code 0**、dot output **870** で完走（priority-queue と新規 img2threejs
  candidate-spec regression を含む）。最終出力は
  `outputs/verification-full-suite-20260801-final.tap`（SHA-256
  `EAFABA5471E42F24DB3A5E177AFB4309AB82CA5909E4352C5E39C5C6804DBC43`）。
  一つ前の TAP evidence は `outputs/verification-full-suite-20260730.tap` に
  859/859 PASS として残り、その後に path-safety の2 test を追加した。
- map collision: `tools/generate_authored_map_collision.js --check` は
  `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29`
  で OK。
- Tide Marker: local Browser で front / three-quarter / rear の実描画を取得し、WebGL=true、asset
  1,156 triangles / 2 calls、reference-light capture frame 1,156 triangles / 2 calls を実測した。
  Tier-1 は filled silhouette 参照に対して IoU 0.9123、aspect/scale 0.0081/0.0081、
  multi-angle ratios 1.0011/1.0394 (degenerate=false) で PASS。証跡は
  `outputs/aaa_tide_marker_tier1_20260801/`。local img2threejs の全8 pass review は spec に記録済み。
  これは candidate evidence であり、human AAA art、map/runtime admission、integrated FPS は **HOLD**。

### 音声の構成

| wave | 件数 | technical QC | mastering | 備考 |
|---|---:|---:|---:|---|
| legacy SFX | 90 | 90/90 | — | 既存 raw catalog を再監査 |
| smoke | 3 | 3/3 | — | API 接続・出力経路の小さな証跡 |
| Wave 001 | 32 | 32/32 | 32/32 | BGM / operation-line 候補 |
| Pilot 002 + remediation | 25 | 25/25 | 25/25 | v001 の小さすぎる ambience は v002 比較候補を作成。採用ではない |
| Batch 001 | 100 | 100/100 | 100/100 | weapons / abilities / UI / objective / movement |
| Wave 002 | 100 | 100/100 | 100/100 | ambience / Foley / movement / objective / ability; candidate-only |
| **合計** | **350** | **350/350** | **257/257** | runtime にコピーした件数 **0** |

`aaa.pilot002.sfx.ambient-market-canopy.v001` は technical PASS でも source mean が
小さすぎるため、v002 と人間の比較を必要とする。自動値だけで v002 を採用しない。

自動音響トリアージも追加した。`tools/triage_elevenlabs_audio_candidates.js` が raw MP3
350件を ffmpeg で一時的に PCM decode し、raw/mastered を変更せずに次の試聴順を作る。
2026-08-01 Wave 002後の実測は decode **350/350**、`REJECT_OR_REGENERATE_REVIEW` **69**、
`LISTEN_FIRST` **80**、`NORMAL_LISTENING_QUEUE` **201**。内訳は near-silent 24、
clipping-risk 45、under-audible 25、DC offset 6、attack-dominant 79、tail-dominant 13
(重複あり)。出力は `outputs/audio-factory-20260801/auto-triage-20260801.json`。
これは試聴順を補助する technical signal であり、rights / creative fit / competitive
readability / in-engine mix / adoption の人間判定を置き換えない。
試聴順の完成版は `tools/build_elevenlabs_priority_queue.js` が生成する
`outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv` / `.json`。
350件すべてを保持し、危険フラグ順に並べるだけで、採否欄は空欄のままにする。
2026-08-01 Wave 002後の secret-safe preflight (`outputs/audio-factory-20260801/elevenlabs-preflight-post-wave002.json`) は
API key の存在だけを確認し、8 model listing、`eleven_multilingual_v2` の TTS 可用性、
残 credits 111,852、overage=false を記録した。music / sound-generation の可用性は
model listing から推測していない。

### Visual candidate の構成

| asset | 状態 | 次の正しい一手 |
|---|---|---|
| `prop-lantern-housing-01` | preview built、candidate-only | Tier-1 / Tier-2 と map safety を別途確認 |
| `prop-tide-marker-01` | strict spec / PBR evidence / 1,156-triangle 2-call browser evidence / Tier-1 / multi-angle / eight local pass reviews | human art-direction → separate map safety proposal → runtime admission。collision は `none` のまま |
| `prop-rope-coil-01` | intake reviewed | literal rope ではなく procedural simplification / overdraw policy を先に書く |
| `prop-ceramic-vessel-01` | intake reviewed | breakable / collision / socket の設計を先に決める |
| `prop-wayfinding-lantern-post-01` | intake reviewed | 高さと no-fake-cover placement rule を先に定義する |
| `prop-public-water-basin-01` | intake reviewed | traversal / interaction / collision を暗黙にしない |
| `prop-hanging-signal-bells-01` | intake reviewed | cord の簡略化と overdraw / visibility を先に決める |
| `prop-market-awning-01` | strict spec PASS、10 components / 3 hero materials / 8 linked details、PBR evidence 0.93、browser candidate PASS（820 triangles / 3 calls、4 hash-verified views） | Tier-1/multi-angle → real-map fake-cover/sightline audit → human review。`CANDIDATE_REVIEW.md` / `NEXT_GATE.md` を読む |
| `prop-roof-finial-01` | strict spec PASS、8 components / 3 hero materials / 7 linked details、PBR evidence 0.93、browser candidate PASS（808 triangles / 2 calls、4 hash-verified views） | Tier-1/multi-angle → real-map roof socket/clearance/sightline audit → human review。`CANDIDATE_REVIEW.md` / `NEXT_GATE.md` を読む |

## 2. 守るべき不変条件

- `presentation` は collision に流入させない。map safety の cluster 規則を緩めない。
- 視覚物は、collision と明示的な map placement が別々に green になるまで
  `candidate` のままにする。
- ElevenLabs の raw、mastered、manifest、QC report を別ファイルのまま保つ。
  raw を上書きしない。hash / request metadata / trace metadata を消さない。
- API key は process environment から authorization header へだけ渡す。表示、
  markdown、manifest、test log、shell history に残さない。
- 声は、実在人物の模倣・無許可 clone・第三者の声の再現をしない。voice は
  許可済みの voice ID とプロジェクト側の用途記録がある場合だけ扱う。
- 既存の Local DSP catalog を、candidate の存在だけを理由に置換しない。
- external publish / deployment / billing expansion / runtime admission は、本書の
  local technical evidence とは別の意思決定である。

## 3. 依存順 TODO

### P0 — 最終ローカル検証を再現可能にする

- [x] 対象 test を実行し、49/49 PASS を確認した。

  ```powershell
  $node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
  & $node --test tests/asset_rush_candidate_manifest.test.js tests/img2threejs_tide_marker_batched_preview.test.js tests/elevenlabs_audio_factory.test.js tests/elevenlabs_preflight.test.js tests/elevenlabs_audio_summary.test.js tests/elevenlabs_human_review_scorecard.test.js tests/bot_navigation.test.js
  ```

- [x] 全 source suite を `--test-reporter=dot` で実行し、exit code 0 と
  dot output 870 を確認した（Wave 002 manifest regression 後の最新再実行）。
  以前の 867/868/869-dot 証跡は中間値であり、`outputs/VERIFICATION_RECORD_20260801.md`
  と `outputs/verification-full-suite-20260801-final.tap` の 870-dot 証跡が現行値である。

  ```powershell
  & $node --test "tests/*.test.js"
  ```

- [x] `work/asset-rush/aaa-v1-pilot/manifest.json` を parse し、7 candidate の
  source hash が一致することを確認した。candidate は runtime tree にコピーしていない。

### P1 — 350 音声候補を「聞いて」絞る

**完成条件:** scorecard の各行で `rights_review`、`creative_fit`、
`competitive_readability`、`in_engine_mix` が人間の根拠付きで埋まり、採用候補が
候補台帳から明示的に選ばれる。空欄を PASS とみなさない。

- [ ] `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_SCORECARD.csv` を P1 から順に
  確認する。比較評価は単体再生と想定ゲームミックスの両方で行う。
- [x] `tools/triage_elevenlabs_audio_candidates.js` を実行し、350/350 decode と
  review disposition を `outputs/audio-factory-20260801/auto-triage-20260801.json` に保存した。
- [x] 350行の人手試聴キューを `tools/build_elevenlabs_priority_queue.js` で生成した。
  `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv` / `.json` は runtime admission を無効化したまま、
  reject-first の順序と空欄の人手判定欄を保持する。
- [ ] トリアージ disposition が `REJECT_OR_REGENERATE_REVIEW` の69件を先に聴き、
  `LISTEN_FIRST` の80件を次に blind A/B する。自動 flag だけで reject/adopt しない。
- [ ] 1 candidate ごとに 0–5 で「識別性 / 距離感 / mask 耐性 / loop seam /
  重複感 / ノイズ」を記録する。0–2 は reject または regenerate、3 は hold、4–5 のみ
  mix candidate にする。
- [ ] 音量差、距離、味方/敵対、同時発音数、ducking の mixer policy を event family
  ごとに定義する。BGM を勝手に combat readability より優先させない。
- [ ] v001/v002 ambience は blind A/B を行い、採用を一つだけ台帳へ書く。
- [ ] 本当に採用するファイルだけに、別の runtime-admission manifest を作る。
  元の candidate manifest の `adoptionState` をまとめて書き換えない。

### P2 — ElevenLabs の次 wave を作る前に、穴を定義する

**完成条件:** 既存350件との差分で、イベント単位・variation 軸・距離レイヤ・
ミックス bus・所有者が一意な manifest が dry-run PASS する。生成件数は一波あたり
100 以下、予算上限を明記する。

Wave 002 はこの契約を満たして完了した（100/100 technical、100/100
mastered、推定 ceiling 2,400、実行 concurrency 1）。次の生成 wave は、
350件の人手レビューと権利/mix判断を先に閉じてから新しい manifest を作る。

推奨する次の wave は、未充足の ambience / object foley / traversal / readability を
優先し、武器の「数だけ増やす」ことを避ける。

| family | slots | variation 軸 |
|---|---:|---|
| environmental ambiences / seamless loops | 24 | weather, density, time-of-day, near/far |
| prop & surface foley | 24 | material, mass, speed, one-shot/loop |
| movement & traversal | 20 | footwear, surface, exertion, landing severity |
| objective / UI readability | 16 | friendly/enemy, urgency, success/fail, proximity |
| ability reactions / impacts | 16 | shield/stone/metal/water, near/far, intensity |
| **total** | **100** | each slot has a unique event contract |

Music は SFX wave と別に扱う。候補が少ないため、まず 12–20 曲の短い original
instrumental stem / transition set を composition plan で設計し、loop seam と combat
mask の review をしてから増やす。Voice は、許可済み voice と用途記録が無い場合は
manifest **planning only** に留める。

### P3 — Tide Marker を偽らず 3D ゲートに通す

**完成条件:** 実 renderer が `assetTriangles`、`assetDrawCalls=2`、`collision=none` を
返し、front / three-quarter / rear-side の画像で Tier-1 と multi-angle が PASS。

1. [x] `preview.html` を local static server + Codex In-app Browser で開き、WebGL=true、
   `window.__tideMarkerMetrics` と `window.__tideMarkerRuntime` を取得した。HTTP/DOMのみではなく、
   実フレーム統計を証跡化済み。
2. [x] `front`、`three-quarter`、`rear` の3視点を capture し、画像バイト数と SHA-256 を
   `outputs/aaa_tide_marker_browser_render_evidence_20260801.json` に保存した。
3. [ ] Tier-1 の silhouette / semantic / material diagnostic を reference と比較して実行する。
4. [ ] non-degenerate multi-angle review と comparison sheet を実行する。
5. [ ] AI vision の閾値評価と self-correction decision を記録する。
6. [ ] map runtime admission は collision=`none` を維持した上で別ゲートとして承認する。
7. `img2threejs` の順序を守る。

   ```powershell
   Set-Location C:\Users\rambo\.codex\skills\img2threejs
   python forge/stage4_review/diagnose_render.py --reference <reference-front.png> --render <blockout-front.png> --spec <spec.json> --pass-id blockout --in-place --json
   python forge/stage4_review/diagnose_render_multi_angle.py --reference <blockout-front.png> --orbit <three-quarter.png> --orbit <rear-side.png> --json
   python forge/next.py <spec.json>
   ```

4. shader、silhouette、inset placement、draw-call measurement のいずれかが失敗なら
   `refine-code`。draw-call budget を緩めない。Tier-1 PASS の前に map へ置かない。

### P4 — new visual candidates を一つずつ安全に進める

- [ ] new lantern post: 先に height / low-cover / placement rule。
- [ ] water basin: 先に interaction / collision / navigation の意図を ADR 化。
- [ ] signal bells: 先に cord simplification と overdraw budget。
- [ ] rope / vessel: 既存 TODO を先に閉じる。
- [ ] 1 asset につき `intake → spec → blockout → actual render → Tier-1 → multi-angle
  → performance → map placement proposal` を完走してから次の pass に進む。

### P5 — map の残る AAA 差分を小さい変更単位にする

対象は既存の「屋根の単調さ、中央広場の床情報、中央塔の遠景分離、金冠ボラードの
等間隔感」。各変更は以下を一括で満たすこと。

1. presentation だけの差分として実装する。
2. collision digest と solid count の意図しない変化がないことを確認する。
3. 10 views の performance capture と、30 route / fake-cover cluster audit を再実行する。
4. 改善前後の measurement を handoff に残す。

## 4. Copy/paste prompt — ElevenLabs AAA Audio Factory

以下は**次の担当 agent に渡す実行 prompt**である。future run では API credit を使う
ため、外部生成の明示 authorization をその run で確認する。キー自体を会話に貼らない。

```text
You own only the candidate-audio pipeline in C:\Users\rambo\projects\kagariai-props.
Read, in order:
1) docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md
2) docs/research/elevenlabs_audio_api_execution_refresh_20260730.md
3) outputs/audio-factory-20260730/execution-summary.json
4) outputs/audio-factory-20260730/HUMAN_LISTENING_SCORECARD.csv

Goal: create one reviewable, original, candidate-only audio wave of at most 100
assets. Do not touch runtime audio, client assets, map files, or Local DSP assets.

Authorization and secrecy:
- Confirm that this run has explicit authority to spend provider credits before any
  live request. ELEVENLABS_API_KEY may be read only from the process environment.
  Never print, serialize, redact-and-print, validate by echoing, or write it.
- Use server-side HTTP only. Do not install a provider SDK.
- Re-check official current endpoints with the safe preflight tool and official docs.
  Do not trust an old model list as proof that music/SFX access is enabled.

Safety and originality:
- Every prompt must describe an original fictional sound. Do not request a named
  game, film, real brand, artist, composer, actor, public figure, or a sound-alike.
- Do not clone or imitate a real person. Voice work requires an allowed project
  voice ID plus documented consent and usage approval; otherwise produce voice
  planning rows only.
- Mark every output candidate-only. Technical PASS is never creative, rights,
  competitive-readability, in-engine mix, or runtime admission.

Execution sequence:
1) Run tools/elevenlabs_preflight.js and write only safe metadata under a new
   outputs/audio-factory-YYYYMMDD directory.
2) Build a JSON manifest first. Every row must have a stable asset ID, event
   owner, API kind, duration, variation axis, exact original prompt, negative
   constraints, estimated credit ceiling, adoptionState=candidate, and immutable
   output path. Validate it with --dry-run before any HTTP request.
3) Limit the wave to 100 assets and set explicit max-assets and
   max-estimated-credits. Start at concurrency 1. Use the existing factory's
   retry/backoff and resume behavior; never overwrite raw output.
4) For sound-generation prompts, keep text <= 450 characters because that is the
   observed provider limit in this project. Pin duration to 0.5–30 seconds.
5) Treat music separately through the documented music endpoint and its duration
   contract; never silently route music through a sound-effect request. Use only
   original instrumental direction and capture loop/seam review requirements.
6) Run factory-batch audit, then mastering only as an attenuation-safe derivative.
   Preserve raw files and hashes. Generate/update execution-summary and the human
   listening scorecard. Quarantine failures and report them honestly.
7) Do not copy anything into runtime. End with an evidence table: planned,
   generated, technical pass/fail, mastered, credit delta, remaining credit,
   output paths, and exactly what still requires human review.

Candidate taxonomy for this wave:
- 24 environmental ambiences / loops: weather, density, time-of-day, near/far.
- 24 object and surface foley: material, mass, speed, one-shot/loop.
- 20 movement and traversal: footwear, surface, exertion, landing severity.
- 16 objective/UI readability sounds: friendly/enemy, urgency, success/fail.
- 16 ability reactions/impacts: shield/stone/metal/water, near/far, intensity.

Required output prompt pattern for each row:
"Original [category] for a fictional coastal competitive action game. [Physical
source and action]. [Distance, duration, variation]. Clean transient/readability
requirements. No speech, no music, no recognizable melody, no franchise or
brand reference, no copied signature sound."
```

## 5. Copy/paste prompt — Human listening, mix, and admission

```text
You are the candidate-audio review owner. Work only from
outputs/audio-factory-20260730/HUMAN_LISTENING_SCORECARD.csv and its referenced
raw/mastered files. Do not call ElevenLabs and do not alter raw audio.

For every P1 item, listen in three contexts: isolated, plausible combat mix, and
distance/occlusion simulation. Record 0–5 scores with one factual note for:
identity/readability, distance, masking, clipping/noise, loop seam, variation,
and emotional fit. Check whether a candidate resembles an identifiable third
party style or voice; if so mark rights_review=hold and do not promote it.

For each event family, write mixer policy: bus, priority, max simultaneous
voices, friendly/enemy differentiation, attenuation, ducking, and interruption.
Do not treat a technical audit as a listening pass. Do not copy audio into runtime
unless rights_review, creative_fit, competitive_readability, and in_engine_mix
are all explicitly approved with evidence. Preserve candidate-only state for all
other rows. Compare ambient-market-canopy v001/v002 blind and select at most one.
Return a CSV-compatible scorecard update and a short admit/hold/reject ledger.
```

## 6. Copy/paste prompt — Original Image → Three.js candidate finisher

```text
Work only in C:\Users\rambo\projects\kagariai-props\work\asset-rush\aaa-v1-pilot.
Read manifest.json and the target asset's local docs before editing. The source
is an original generated reference and is candidate-only; do not inspect, copy,
or derive from third-party games, maps, or brands.

Choose exactly one asset. Preserve adoptionState=candidate, collision policy, and
draw-call/triangle budgets. Never add it to the map, runtime registration, or
collision data during this task.

Follow this strict order: intake analysis -> explicit object sculpt spec ->
strict validator -> procedural blockout -> actual browser render -> metrics ->
front/three-quarter/rear evidence -> Tier-1 -> multi-angle review -> truthful
self-correction. Do not skip from static source analysis to a claimed render.

For Tide Marker 01 specifically: retain exactly two asset meshes, use the real
sea-glass inset and bronze bezel, keep collision='none', and do not relax the
two-call budget. The current measured candidate is 1,156 asset triangles / 2
calls, with a reference-light capture frame also at 1,156 / 2. If browser
shader compilation or runtime measurement fails, choose refine-code and record
the failure; do not claim a preview PASS.

For any candidate that could create cover, write a physical-height and fake-cover
proposal before map placement. For cords/ropes, specify a simplification and
overdraw policy before geometry. Report evidence paths, measured triangles,
measured draw calls, console errors, collision state, and all gates still open.
```

## 7. Known defects and deliberate non-fixes

- `map_flashpoint_runtime.test.js` historical `979 !== 977` was reported as a
  test-composition defect. The current runtime check is green: 1,064 map solids,
  192 Flashpoint additions, zero duplicate IDs, and no removed canonical IDs
  present. Keep the uniqueness regression so the old composition path cannot
  silently return.
- Lantern-tower `counterRoutes` declares two routes for each central roof. The
  ring geometry now contains the two added stair flights (20 stair solids plus
  two landings), while runtime `highGroundRoutesBySite` intentionally excludes
  the central site. Keep this as an explicit metadata boundary and document it
  before changing either data or geometry.
- Tide browser attachment is no longer a blocker: WebGL render evidence exists
  for three views, Tier-1 and multi-angle diagnostics pass locally, and all
  eight local img2threejs pass reviews are recorded. AI-vision, runtime
  admission, map safety, and human art review remain open by design.

## 8. Definition of done for a future release candidate

All of the following must be independently true:

- Map has fresh collision/presentation separation proof, route proof, fake-cover
  cluster proof, and performance captures after the final visual change.
- Every runtime audio asset has provenance, technical QC, rights/editorial,
  competitive-readability, and in-engine mix approval; unreviewed candidates are
  excluded.
- Every runtime visual asset has original-source provenance, actual renderer
  metrics, visual gates, collision/placement decision, and performance evidence.
- Full test suite is green with the exact command/result recorded.
- Human art direction, gameplay, and release owners explicitly approve the
  remaining subjective / external gates.
