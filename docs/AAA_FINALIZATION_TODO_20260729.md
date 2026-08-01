# AAA Finalization TODO and Handoff Prompts

Updated: 2026-07-30

This is the execution frontier for the Kagariai map, runtime, and audio factory.
It is deliberately evidence-first: a local test, a rendered browser preview, a
provider generation, and a public/release claim are separate gates.

The dated continuation prompt pack is `docs/AAA_REMAINING_WORK_PROMPT_PACK_20260801.md`.

> **Execution update (2026-07-30):** This planning snapshot has been advanced
> materially. Read `docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md` first for the
> current state. Local audio sources have been recovered and verified; **350**
> 350 original ElevenLabs candidates were generated in quarantined candidate paths;
> map P1/P2/P3 visual finishing is implemented with fresh evidence; and model
> profile contracts now pass. The historical standard-headless rotation-1 seam
> was reproduced, repaired at the verified bot route-rejoin seam, and passed as
> a real BO3 acceptance match. See
> `outputs/headless-acceptance-rotation1-20260729.md`; a six-rotation balance
> run and human playtest remain separate gates. The current master plan also
> records the 2-call Tide Marker browser-render candidate evidence and its
> still-open Tier-1/runtime gates; no candidate is thereby admitted to runtime.

## 0. Superseding execution facts

| Former planning item | Current result | Continuing gate |
|---|---|---|
| Local audio source recovery | 90 Local DSP source/runtime/manifest assets restored; 31 focused audio checks passed | provider candidates remain separate |
| ElevenLabs planning only | 90 SFX + 3 smoke + 32 BGM/voice candidates generated with manifests/hashes/QC | rights/editorial/mix/human review required |
| Visual P1/P2/P3 | roof cadence, plaza negative space, and finial irregularity implemented | human art-direction review still required |
| Character model mismatch | 18 candidate profiles and runtime contracts validate; 37 focused checks passed | no candidate becomes runtime eligible without all gates |
| Historical headless rotation 1 | exact base-seed/match-index BO3 reaches `MATCH_END`, score `[0,2]`, zero failures | full six-rotation balance and human playtest remain separate |

Do not use the older `blocked` or `open` labels below without checking the
superseding handoff and the dated artifacts it links.

## 1. Current local evidence

| Area | Local result | Status |
|---|---|---|
| Flashpoint route safety | 30/30 safe; unsafe-high = 0 | pass |
| Fake body-height cover clusters | 0 | pass |
| Browser preview | 17,725 instances; 110 layers; max 165 calls; max 506,314 triangles; no console exceptions | pass |
| Local map quality rubric | 100/100 `complete-local-evidence` | pass; not an AAA art claim |
| Bot route regression | adverse rejoin seed fixed; targeted navigation audit has 0 violations | pass |
| Headless lifecycle smoke | 3 rotations including seed `20268638`; all reached `MATCH_END` | pass |
| Historical headless acceptance seam | rotation 1 reaches `MATCH_END` at 340.159 simulated seconds; acceptance regression green | pass; full six-rotation balance remains open |
| Local audio source assets | 90 Local DSP raw/runtime/manifest assets restored and structurally/acoustically audited | pass; provider candidates remain separate |
| Character-model manifest/profile checks | 18 candidate profiles and contracts validate; Shiomaneki pilot remains fail-closed | technical pass; art/performance gate open |

Fresh focused evidence includes map/audio/model **59/59**, navigation and
collision broadphase **52/52** (including explicit static-geometry refresh,
direct trace/sweep oracle after replacement, post-refresh direct-navigation
and collision no-hot-path-rescan, same/cross-cell source-order ties, and
finite/non-finite/missing-candidate ordering without coercing unsupported
objects), and the real historical headless acceptance
seam **1/1**. These local results do not replace six-rotation balance, human
5v5 playtest, art direction, rights, or release gates.

The complete local source suite was also fresh on 2026-08-01: **870/870 pass,
0 errors**. See `outputs/VERIFICATION_RECORD_20260801.md` for the command,
runtime caveat, focused result breakdown, collision-manifest hash, and the
explicit non-local gates that remain open.

The canonical visual and quality evidence is in:

- `outputs/root-flashpoint-map-preview-final-20260729.png`
- `outputs/root-flashpoint-map-preview-final-20260729.json`
- `outputs/root-perf-final-20260729/report.json`
- `outputs/root-flashpoint-quality-score-20260729.json`

## 2. What changed in the finalization pass

- `tools/headless.js` now accepts bounded simulation controls and returns a
  per-match terminal record: `finalState`, `terminationReason`, `ticks`,
  `maxTicks`, and `finalObjective`.
- `--progress` writes heartbeat diagnostics to stderr, preserving the one-line
  JSON stdout contract used by machines.
- `--smoke --round-cap-sec 10 --max-sim-sec 60` is a short, deterministic
  lifecycle test. It intentionally uses one-round matches and must never be
  described as a balance or ultimate-economy acceptance run.
- `tests/hero_bots.test.js` now runs that smoke profile with a child-process
  timeout and asserts every seeded rotation actually reaches `MATCH_END`.
- The smoke assertion deliberately requires terminal objective flow, actions,
  and healing but not a kill from every 10-second one-round roster; full
  acceptance retains the combat-elimination assertion.
- The exact historical seam now has a non-smoke, real BO3 regression:
  base seed `20260719`, match index `1`, derived seed `20268638`.
- Navigation floor/stair queries reuse the static collision broadphase only
  when it is backed by the same authored `map.solids` array; stale collider
  geometry falls back to the legacy authored scan.
- If tooling deliberately mutates an existing static `solids` array in place,
  it must call `collider.refreshStaticGeometry()` exactly once after the batch.
  Do not add an O(n) source scan to trace/sweep or every recovery floor query.
- Route recovery ranks candidate cells before expensive capsule predicates and
  bounds unchanged failed rejoin replans to 0.35 seconds. This fixed the
  observed liveness storm without changing sudden-death rules.

Do not add a sudden-death timer or seed tie-breaker to `ShiouraObjective`.
The frozen rule says a tied cap resolves on the next capture with no time cap;
changing it would also alter Flashpoint site semantics.

## 3. Mandatory commands before a local handoff

Use a real workspace Node runtime, not an assumed shell shim. Resolve an actual
`node.exe`; a `node.cmd` shim is known to be stale on this machine.

```powershell
$nodeCandidates = @(
  'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  (Get-Command node.exe -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and ([IO.Path]::GetExtension($_) -eq '.exe') }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Resolve a real Node node.exe before verification.' }

& $node --test tests/hero_bots.test.js tests/bot_navigation.test.js tests/bot_navigation_audit.test.js
& $node --test tests/flashpoint_world.test.js tests/flashpoint_bot_route_adapter.test.js `
  tests/flashpoint_navigation_planner.test.js tests/flashpoint_objective_mode.test.js `
  tests/map_flashpoint.test.js tests/map_flashpoint_runtime.test.js `
  tests/mode_flashpoint_rules.test.js tests/client_objective_presentation.test.js `
  tests/map_site_cladding.test.js tests/map_quality_score.test.js `
  tests/server_protocol_version.test.js tests/server_runtime_composition.test.js
& $node tools/generate_authored_map_collision.js --check
& $node tools/audit_route_safety.mjs
& $node tools/audit_fake_cover_clusters.mjs
```

For a bounded, inspectable three-rotation lifecycle run:

```powershell
& $node tools/headless.js --matches 3 --seed 20260719 `
  --smoke --round-cap-sec 10 --max-sim-sec 60 --quiet --json --progress
```

For the former real liveness seam (not smoke):

```powershell
& $node --test --test-name-pattern 'headless acceptance completes the historically stalled roster seam' `
  tests/hero_bots.test.js
```

The normal `tools/headless.js --matches 3 --seed 20260719 --quiet --json`
remains a long-run acceptance run. Use `--progress --progress-every-sec 30`
when investigating it, and retain its stderr plus terminal JSON as evidence.

## 4. Priority TODOs

### P0 — preserve the currently verified map/runtime state

- [ ] Re-run the command block above after any map, navigation, renderer, or
  mode change.
- [ ] Keep `presentation` independent from collision; preserve the
  presentation-empty collision identity test.
- [ ] Keep the nearby-cladding body-cover cluster test. Never weaken it by
  checking individual pieces only.
- [ ] Re-capture all ten map views after any future material visual change and compare
  calls, triangles, layers, instances, console errors, and site identity.

### P1 — standard Shioura headless liveness investigation

- [x] Reproduce the exact base seed `20260719` / match index `1` seam, collect
  bounded wall-clock diagnostics, and identify the failed route-rejoin retry
  storm.
- [x] Add liveness telemetry, an exact child-process regression, and a bounded
  unchanged-rejoin retry cadence without altering sudden-death rules.
- [x] Rerun the real BO3 seam to `MATCH_END`; evidence is
  `outputs/headless-acceptance-rotation1-20260729.md`.
- [x] Run all six roster rotations with retained terminal JSON and side-balance
  evidence. `outputs/headless-balance-20260801.json` records 6/6 BO3 completion,
  roster 18/18, side wins east 9 / west 6 (0.60/0.40), round-two swaps 6/6,
  ultimate average 3.25, median 3, zero-use rate 0, max 7, and
  `severeBiasDetected=false`. This is automated evidence only, not a human
  balance or playtest approval.
- [ ] Conduct a human 5v5 playtest before making a competitive balance claim.

### P2 — visual finish, not false AAA labeling

- [ ] Improve roof silhouette variety from aerial views without raising the
  draw/triangle budgets beyond the verified maxima.
- [ ] Add central-plaza floor storytelling only where it improves navigation,
  combat readability, or landmark hierarchy.
- [ ] Separate the central tower from the far-background value range.
- [ ] Break obvious even-spacing in ornamental gold finials while retaining
  collision safety and sightline readability.
- [ ] Re-score from fresh screenshot evidence. `100/100 complete-local-evidence`
  remains a gate score, not a substitute for external art-direction review.

### P3 — restore the local audio verification boundary

- [x] Restore the Local DSP source/runtime/manifest catalog and audit its
  structural/acoustic contract.
- [x] Keep provider candidates, mastered derivatives, source assets, and
  manifests separately traceable with hashes.
- [ ] Complete rights/editorial/in-engine mix review before any of the 350
  provider candidates is promoted beyond `candidate`.
- [x] Run local acoustic triage over all 350 candidate rows. Evidence:
  `outputs/audio-factory-20260801/auto-triage-20260801.json` (350/350 decode;
  69 reject/regenerate-review, 80 listen-first, 201 normal queue).
- [ ] Review triage queues by listening; automated flags are not adoption or
  rights decisions.
- [ ] Before a Human-GO generation wave, re-read
  `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`; pin
  live model access, endpoint schema, credit ceiling, and concurrency ceiling
  into the approved manifest without recording the API key.
- [ ] Use `docs/AAA_ASSET_RUSH_PROGRAM_20260729.md` for the next original
  audio/visual candidate wave; preserve the same provenance separation.

### P4 — model asset closure

- [x] Rehydrate the Shiomaneki candidate evidence/spec and align all 18 model
  profiles to the declared `+Y up, +Z forward` coordinate convention.
- [x] Keep runtime profile contracts fail-closed; strict checks passing does
  not promote a candidate to runtime eligibility.
- [ ] Refine Shiomaneki silhouette/material/draw calls and obtain multi-angle
  human review before adoption.
- [x] Start the first original modular prop pilot through the strict
  Image -> Three.js process: lantern evidence/spec/preview remain quarantined
  at `work/asset-rush/aaa-v1-pilot/`.
- [ ] Complete its Tier-1/Tier-2 visual gate and separate map-safety proposal
  before any adoption or scale-out.

### P5 — original AAA asset-rush program

- [x] Create the dated `work/asset-rush/aaa-v1-pilot/` candidate manifest and
  immutable original lantern reference/hash; no runtime integration.
- [x] Generate/review the first low-risk modular-prop candidate through source
  probe, PBR evidence, strict sculpt-spec validation, generated factory, and
  three browser views. Evidence:
  `work/asset-rush/aaa-v1-pilot/img2threejs/prop-lantern-housing-01/CANDIDATE_REVIEW.md`.
- [ ] Finish the lantern's calibrated Tier-1/Tier-2 visual review (without
  lowering thresholds), then prove its separate map/collision/30-route/
  fake-cover/performance safety before any integration or scale-out.
- [x] Generate and intake-review the next small original reference batch:
  tide marker, rope coil, and ceramic vessel are immutable candidate PNGs with
  prompt, hash, dimensions, and source decision recorded in
  `work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260730.md`.
- [x] Advance Tide Marker 01 through technical probe, component-zone inventory,
  visual pre-spec assessment, source-derived three-material PBR evidence, and
  strict sculpt-spec validation (zero errors/warnings). The unlocked blockout
  factory is still candidate-only and has no collision or runtime admission.
- [x] Batch Tide Marker 01 from its current seven meshes to the two-call budget
  without collapsing the separate salt-stone, bronze, and sea-glass PBR
  response. The refined browser evidence measures asset=1,156 triangles/2
  calls and reference-light frame=1,156/2 across three views.
- [x] Run Tier-1 and non-degenerate orbit diagnostics. Tier-1 IoU is 0.9123,
  aspect/scale deltas are 0.0081/0.0081, and orbit ratios are 1.0011/1.0394
  with degenerate=false. The complete local img2threejs eight-pass ledger is
  recorded; AI-vision, human art, and runtime-admission gates remain open.
  Use its candidate-local `NEXT_GATE.md` and `BLOCKOUT_BUDGET_AUDIT.md`; do
  not claim adoption from static/browser evidence alone.
- [x] Advance `prop-market-awning-01` and `prop-roof-finial-01` beyond intake:
  both now have authored strict specs, 3 hero materials, linked detail
  inventories, repetition systems, safety policies, and source-derived PBR
  evidence at 0.93 confidence. Evidence:
  `outputs/aaa_img2threejs_candidate_specs_20260801.json`.
- [x] Generate bounded browser previews for the two new specs and capture four
  hash-verified views each. Evidence:
  `outputs/aaa_img2threejs_browser_evidence_20260801.json` (awning 820
  triangles/3 calls; finial 808/2; WebGL=true; consoleErrors=0).
- [ ] Run Tier-1/multi-angle, real-map fake-cover, roof-clearance, sightline,
  and human art-direction gates. They remain candidate-only and
  `NOT_RUNTIME_ADMITTED`.
- [ ] Keep rope coil and ceramic vessel at intake-review status until their
  explicit procedural simplification/breakable policy is written.
- [ ] Keep all generated visual/audio assets candidate-only until the stated
  art, rights, gameplay, and performance gates pass.

## 5. Copy/paste prompt: map and gameplay finisher

```text
You are the final evidence-driven Kagariai map/gameplay finisher.

Repository: C:\Users\rambo\projects\kagariai-props
Do not inspect or copy assets from C:\Users\rambo\Downloads\SURAVASA.
Preserve all unrelated dirty-worktree changes. Do not reset, checkout, stage,
commit, deploy, publish, or delete files unless separately authorized.

Read first:
1. docs/AAA_MAP_HANDOFF.md
2. docs/AAA_FINALIZATION_TODO_20260729.md
3. docs/AAA_EXECUTION_HANDOFF_20260729.md
4. docs/AAA_ASSET_RUSH_PROGRAM_20260729.md
5. outputs/headless-acceptance-rotation1-20260729.md

Goal: improve the project from its current local-evidence state toward a
production-quality original competitive map, without claiming external AAA art
approval. Carry every chosen change through implementation, focused tests,
performance/safety audits, visual evidence, and a dated handoff update.

Non-negotiable invariants:
- Collision/gameplay must remain independent from presentation-only geometry.
- Never create body-height visual cover without collision.
- Keep all 30 Flashpoint routes safe and all inactive sites non-capturable.
- Preserve original/IP-safe art direction; do not copy Overwatch/SURAVASA assets,
layouts, UI, names, recordings, or recognizable style signatures.
- Do not weaken a failing test merely to make it pass.
- Shioura sudden death is intentionally uncapped; diagnose and correct bot
  liveness, not the frozen rule.

Required evidence after each material change:
- focused node tests;
- collision manifest check;
- route and fake-cover cluster audits;
- ten-view browser capture plus perf report;
- exact before/after metrics;
- a short handoff entry with remaining risks and next commands.

If full acceptance is blocked, leave a precise reproducible command, exact
seed/rotation, observed state, and a safe next investigation rather than an
unqualified completion claim.
```

## 6. Copy/paste prompt: ElevenLabs AAA Audio Factory planning only

```text
You are the planning lead for Kagariai's original AAA Audio Factory.

Repository: C:\Users\rambo\projects\kagariai-props
Read outputs/AAA_AUDIO_FACTORY_HANDOFF_20260729.md,
docs/research/elevenlabs_audio_api_execution_refresh_20260730.md, and
docs/AAA_FINALIZATION_TODO_20260729.md first.

Do NOT read, print, validate, or use ELEVENLABS_API_KEY. Do NOT call ElevenLabs,
spend credits, generate audio, install a provider SDK, or make external writes.
This task produces only a reviewable plan, JSONL manifest draft, prompt library,
QC rubric, and dependency-ordered TODOs.

Build a 492-slot original-audio inventory covering BGM/stems, ambient loops,
weapons, abilities, movement/foley, UI/objective feedback, voices, and cinematic
assets. Every asset row must have: asset_id, family, gameplay owner/event,
perspective, variation axis, api kind, target duration, loop policy, requested
format, exact original prompt, negative constraints, rights constraint,
technical QC, competitive-readability QC, creative QC, adoption state, and
dependencies.

Use only original fictional sound direction. Never ask for a real artist,
song title, character, actor, franchise, or third-party voice imitation.
Treat all music as instrumental unless a separately approved lyric brief exists.
For voices, specify Voice Design or legally authorized self/actor sources only.

Plan in gates: Smoke 3 -> Pilot 24 -> Batch 100 -> later batches. Include a
server-side secret handling design, bounded concurrency/retry plan, request and
cost ledger, content-addressed storage, quarantine workflow, loudness/peak/loop
checks, gameplay distance/priority checks, and human review checkpoints.

Return a plan that a separate Human-GO execution task can run without guessing.
```

## 7. Copy/paste prompt: ElevenLabs execution after explicit Human GO only

```text
Human GO has been explicitly granted for the approved manifest only.

Before doing anything, read
docs/research/elevenlabs_audio_api_execution_refresh_20260730.md. Verify that
ELEVENLABS_API_KEY is available only to the server-side process and do not
reveal it. Verify current ElevenLabs endpoint schemas, enabled models,
quota/credit limits, output formats, and concurrency limits using official
documentation and safe account metadata only.

Execute strictly in this order:
1. Generate Smoke 3: one BGM/music candidate, one SFX candidate, one approved
   original voice candidate.
2. Write request IDs, model/version, returned format, duration, cost/usage,
   hashes, prompts, and timestamps to a local manifest. Do not overwrite a
   prior candidate.
3. Run decode, sample-rate, peak, loudness, duration, loop-boundary, silence,
   rights, and competitive-readability checks.
4. Stop for human review. Do not continue to Pilot 24 unless every Smoke item is
   approved or explicitly replaced.
5. Run Pilot 24, then Batch 100 only after the same gate.

Use bounded concurrency one below the verified account limit (start at one).
On 429/system_busy, retry only idempotent manifest rows with exponential backoff
and jitter; never duplicate an accepted asset. Quarantine failures and preserve
their metadata. Never generate real-person imitation or copyrighted-song-style
audio. Never export the API key, raw authorization headers, or private account
data into logs, code, commits, artifacts, or chat.
```

## 8. Definition of done

Local completion means every applicable test/audit above has fresh evidence,
all active TODOs are either complete or explicitly gated, and the handoff points
to durable artifacts. It does not mean deployment, public release, provider
generation, billing, rights clearance, or external AAA art review occurred.
