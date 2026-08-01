# Kagariai AAA Execution Handoff

Updated: 2026-07-30

This is the durable continuation document for the completed execution pass. It
records what was actually run, what is only a local/candidate result, and the
next work that may safely proceed. It deliberately does **not** contain an API
key, authorization header, account identifier, or copied third-party IP.

> **Current-state pointer (2026-07-30):** Read
> `docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md` before acting on this historical
> handoff. It records the current 350 provider candidates (including Wave 002), the candidate-only
> 2-call Tide Marker preview work, new visual reference candidates, and the
> updated dependency-ordered TODO frontier. This document remains the durable
> evidence record for the preceding pass.

## 1. Scope and non-negotiable boundaries

- Repository: `C:\Users\rambo\projects\kagariai-props`
- Never inspect, copy, or derive from `C:\Users\rambo\Downloads\SURAVASA`.
- Preserve the dirty shared worktree. Do not reset, checkout, delete, publish,
  deploy, commit, or push as part of a continuation unless specifically asked.
- Presentation geometry remains independent from collision. A decorative object
  must never create body-height cover unless collision is deliberately authored
  with it.
- ElevenLabs material is an original, quarantined **candidate** until rights,
  editorial, gameplay-mix, and human review all pass. It does not replace the
  Local DSP runtime catalog and must not be distributed as a standalone SFX
  library without a separate rights review. The official endpoint/security
  refresh is in `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`.
- Do not request artist/song/franchise/actor imitation, cloned voices, real
  weapon brands, or recognizable third-party sound signatures.

## 2. Current execution scorecard

| Area | Current evidence | Status |
|---|---|---|
| Map visual finish | quality score 100/100; 1,064 solids; 110 layers; 17,497 instances; preview 147 calls / 503,518 triangles / 0 console-exception errors | local pass |
| Map safety | 30 routes, unsafe 0, high-unsafe 0, fake-cover clusters 0, byte-stable collision manifest | local pass |
| Map ten-view budget | maximum 205 calls / 505,902 triangles; limits are 250 / 1,200,000 | local pass |
| Focused independent verification | 59/59 focused tests passed | local pass |
| Local DSP source contract | 90 raw/local assets restored; source/runtime/manifest audit had 0 structural and 0 acoustic failures | local pass |
| ElevenLabs SFX candidates | 90 files: 18 weapons + 72 abilities; hash failures 0; technical failures 0 | candidate-only pass |
| ElevenLabs wave 001 | 12 BGM + 20 Japanese operations lines; technical QC 32/32 | candidate-only pass |
| Music candidate mastering | 12/12 mastered; post measurement -18.44 to -17.37 LUFS, max -1.24 dBTP | candidate-only pass |
| Voice candidate mastering | 20/20 mastered, 48 kHz mono; post measurement -20.65 to -18.44 LUFS, max -1.35 dBTP | candidate-only pass |
| Character model profile contracts | 37/37 focused tests passed; all 18 assets remain fail-closed candidates | local pass, art gate open |
| Historical headless acceptance seam | rotation 1 now reaches `MATCH_END`, score `[0,2]`, at 340.159 simulated seconds with zero failures | local pass |
| Six-rotation automated balance run | `outputs/headless-balance-20260801.json`; 6/6 BO3, roster 18/18, east/west 0.60/0.40, swaps 6/6, ultimate average 3.25, severe side bias false | automated evidence; human 5v5 playtest remains open |
| Navigation and collision hardening | 52/52 focused tests: explicit static refresh, direct post-refresh navigation scan guard, same/cross-cell source-order ties, finite/defensive candidate ordering without object coercion | local pass |
| Visual asset-rush pilot wave | 9 original image references retained; lantern is a 3D hold, Tide Marker has a strict eight-pass local ledger with measured 1,156-triangle / 2-call browser evidence, awning/finial have strict authored specs, PBR evidence, and isolated browser candidate evidence (820/3 and 808/2), rope/vessel remain intake-reviewed | candidate-only; real-map safety, art, and adoption gates open |
| Complete source-suite verification | 870/870 pass, 0 errors; fresh priority-queue, candidate-spec, browser-evidence, and Wave 002 manifest regressions | local pass; `outputs/VERIFICATION_RECORD_20260801.md` |

`AAA` is not claimed here. The map has strong local technical evidence and an
improved authored visual result, but external art direction, gameplay playtest,
rights approval, integrated audio mix, deployment, and public release are
separate gates.

Fresh 2026-07-30 command/result evidence is retained in
`outputs/VERIFICATION_RECORD_20260730.md`. It includes the full-suite result,
focused sets, collision-manifest hash, historical headless seam, and the exact
limits of what local verification does not prove.

## 3. Delivered artifacts

### Map visual finish

- Main source areas:
  - `shared/data/map_oshioi_presentation.js`
  - `shared/data/map_oshioi_ground.js`
  - `shared/data/map_oshioi_site_cladding.js`
  - `tests/map_visual_finish.test.js`
- The roof skyline now uses a deterministic 17-building cadence plus three
  outliers, with hip/barrel/saw/dome counts `56/25/24/17`.
- The central approach keeps four readable lanes while reducing gold transforms
  `403 -> 361` and central cedar seams `1,206 -> 1,049`.
- Ring finials are deterministically irregular: `261 -> 232` (-11.1%) with two
  crown heights and their support columns retained.
- Evidence: `outputs/map-visual-finish-20260729/preview.png`,
  `outputs/map-visual-finish-20260729/quality.json`, and the `perf-*` folders.

### Audio factory and generated candidates

- Factory: `tools/elevenlabs_audio_factory.js`
- Actual-generation manifest builder: `tools/build_elevenlabs_aaa_wave_manifest.js`
- Candidate technical audits:
  - `tools/audit_elevenlabs_candidates.js`
  - `tools/audit_elevenlabs_factory_batch.js`
- Candidate mastering: `tools/master_elevenlabs_music_candidates.js`
- Original API research: `docs/research/elevenlabs_audio_api_execution_research_20260729.md`
  with the required live endpoint/security refresh in
  `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`
- Existing provider SFX manifest and files: `assets-src/elevenlabs/manifest.json`
  and its `raw/` tree. These are 90 provider candidates, separate from Local
  DSP WAV assets.
- Wave 001 prompt/response ledger:
  `outputs/audio-factory-20260729/manifests/aaa-wave-001.json`
  and `outputs/audio-factory-20260729/aaa-wave-001/`.
- Historical provider-generated candidate count was **125**: 90 SFX catalog
  entries, 3 smoke assets, and 32 Wave 001 assets. The prior total was **250**
  after the Pilot 002, remediation, and Batch 001 waves. Wave 002 now adds 100
  original SFX candidates; the current combined total is **350 technical pass /
  257 mastered / 0 runtime admissions**. See
  `outputs/audio-factory-20260801/execution-summary-wave002.json` and
  `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`. Do not report any of these
  as shipped assets.
- Music mastering report:
  `outputs/audio-factory-20260729/aaa-wave-001/mastered/master-manifest.json`
- Voice mastering report:
  `outputs/audio-factory-20260729/aaa-wave-001/mastered-voices/master-manifest.json`

### Models

- Profile root: `assets-src/img2threejs/rollout.json`
- Generated manifest: `shared/data/character_model_assets.js`
- Shiomaneki recovery/evidence: `work/img2threejs/shiomaneki/`
- The Shiomaneki pilot is intentionally `candidate`, not accepted. Strict
  profile/material/runtime-contract checks are true; silhouette, multi-angle,
  performance, and visual-review acceptance gates remain false. Its manual
  semantic-fidelity review is approximately 0.53 and draw calls were 74 versus
  the mobile target 24. Continue refinement; do not loosen its gates.

### Next visual asset-rush program

- Detailed 144-candidate program, inventory, quarantine contract, and
  copy/paste production prompt:
  `docs/AAA_ASSET_RUSH_PROGRAM_20260729.md`.
- It treats Suravasa only as an external quality bar, never a source of
  inspected/copied/derived assets. Image generation and Image -> Three.js work
  remain candidate-only until the model/map gates pass.
- First concrete pilot: `work/asset-rush/aaa-v1-pilot/` contains the original
  `prop-lantern-housing-01` reference, hash, PBR evidence, strict validated
  sculpt spec, generated factory, browser preview, and review evidence. Its
  candidate preview is 1,640 triangles / 3 asset draw calls / no collision.
  It remains **HOLD / candidate only**: no passing full Tier-1/Tier-2 visual
  review, gameplay safety evidence, map integration, or human art adoption.
  Read `work/asset-rush/aaa-v1-pilot/img2threejs/prop-lantern-housing-01/CANDIDATE_REVIEW.md`
  before changing or promoting it.
- 2026-07-30 added three more original four-view reference candidates to the
  same quarantine wave: tide marker, rope coil, and ceramic vessel. Source
  PNGs, dimensions, byte counts, SHA-256 hashes, prompts, visual intake
  observations, and candidacy decisions are in
  `work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260730.md` and
  `work/asset-rush/aaa-v1-pilot/manifest.json`.
- Tide Marker 01, Market Awning 01, and Roof Finial 01 now have browser-render
  candidate evidence. The awning measures 820 triangles / 3 calls and the finial
  808 / 2 with WebGL=true and four hash-verified views each. These previews are
  isolated candidate evidence and do not authorize map registration.
- Tide Marker 01 remains the only candidate with a completed local Tier-1 and
  multi-angle ledger. Its
  source-derived three-material PBR evidence and 10-component sculpt spec pass
  strict validation with zero errors/warnings; the refined candidate batches to
  two asset meshes. Browser gate measures WebGL=true, asset=1,156 triangles/2
  calls, and reference-light frame=1,156/2 across front, three-quarter, and
  rear. Tier-1 IoU is 0.9123 and the two multi-angle ratios are 1.0011/1.0394
  with degenerate=false. Evidence is under
  `outputs/aaa_tide_marker_tier1_20260801/`. It remains **HOLD / candidate
  only** for human art direction, AI-vision, runtime admission, collision, map,
  and integrated performance evidence. Read
  `work/asset-rush/aaa-v1-pilot/img2threejs/prop-tide-marker-01/NEXT_GATE.md`
  and `BLOCKOUT_BUDGET_AUDIT.md` before modifying it.
- `prop-market-awning-01` and `prop-roof-finial-01` have now proceeded from
  intake to strict authored candidate specs: 10/8 components, 3/3 hero
  materials, 8/7 linked details, 2/2 repetition systems, and source-derived
  PBR evidence at 0.93 confidence. Evidence is
  `outputs/aaa_img2threejs_candidate_specs_20260801.json`; read each candidate's
  `CANDIDATE_REVIEW.md` and `NEXT_GATE.md`. The two new browser previews still
  lack Tier-1 acceptance, real-map safety, human art review, and runtime admission.

### Headless liveness diagnostics

- `tools/headless.js` now supports bounded execution (`--max-sim-sec`),
  `--progress`, `--match-index`, `--profile`, `--max-wall-sec`, per-match
  `terminationReason`, final objective snapshots, and liveness telemetry.
- The exact former failure seam is base seed `20260719`, match index `1`, and
  derived seed `20268638`. It now terminates locally: `MATCH_END`, score
  `[0,2]`, 340.159 simulated seconds, zero failures, and no wall-clock-budget
  exhaustion. Durable summary:
  `outputs/headless-acceptance-rotation1-20260729.md`.
- The root cause was repeated, unchanged failed route-rejoin planning. Repairs:
  static-only navigation broadphase guarded by authored-array identity;
  nearest-first route-cell evaluation; and a 0.35-second retry cadence for an
  unchanged failed route rejoin. The safe wall-corner fixture reduced sweeps
  from 11,844 to 374 without changing its safe 11-node path.
- 2026-07-30 hardening: if a map-authoring/tooling pass deliberately edits an
  existing `Collider.solids` array in place, it must call
  `collider.refreshStaticGeometry()` once after the batch. That rebuilds the
  spatial grid explicitly; normal trace/sweep and repeated local reads retain
  their O(1) source-identity update check. The regression covers XY-bound
  movement, element replacement (including trace/sweep), source-array
  reversal with exact same-cell and cross-cell source-order ties, and bounded
  reads after refresh against a linear oracle. Direct trace and cylinder-sweep
  oracle coverage follows the refresh; Proxy regressions prove ordinary local
  trace/sweep and the direct navigation `staticSolidsInAabb()` query do not
  silently rescan every static source entry.
- Recovery ranking is now a strict total order for routable numeric cells in
  both start/goal selection and
  A* open-set selection: exact score/distance first, then local forward/side/Z
  order. This removes epsilon-comparison cycles without changing a genuine
  equal-distance directional tie-break. Defensive `NaN`, infinities, `null`,
  and `undefined` now also have explicit non-cyclic ordering. Symbols,
  objects, and functions are inert unsupported sentinels and are never coerced
  through user-defined `valueOf()`/`toString()`; real game cells remain finite.
- `tests/hero_bots.test.js` now contains the real acceptance-seam regression
  with a child-process timeout, alongside smoke, rotation-index, invalid-input,
  and profile diagnostics.
- Smoke remains a 10-second one-round lifecycle probe: it requires terminal
  objective flow, actions, and healing, while the kill requirement remains on
  non-smoke acceptance runs where it is deterministic and meaningful.
- Historical failure evidence is `work/root-full-test-20260729.txt`: its full
  pre-instrumentation run records match index 1 (derived seed `20268638`) at
  2,700 simulated seconds, `ACTIVE`, score `[1,0]`, and no match winner.
  It is retained as a pre-fix record; do not compare its score directly to the
  repaired run because their route-recovery behavior differs.
- `work/headless-repro-seed20260719-m2-600.txt` is only a bounded telemetry
  check: match index 0 reached `[1,1]` and began a third round before its
  600-second budget. It validates diagnostics, not the historical failure.

## 4. Reproducible local verification

Use a real configured runtime rather than a shell `node.cmd` shim. This machine
has a stale shim, so resolve an actual `node.exe` first.

```powershell
$nodeCandidates = @(
  'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe',
  (Get-Command node.exe -ErrorAction SilentlyContinue).Source
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) -and ([IO.Path]::GetExtension($_) -eq '.exe') }
$node = $nodeCandidates | Select-Object -First 1
if (-not $node) { throw 'Resolve a real Node node.exe before verification; do not use a failing node.cmd shim.' }
$ffprobe = 'C:\Users\rambo\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffprobe.exe'

# Independent focused suite used in the final verification.
& $node --test tests/map_visual_finish.test.js tests/map_collision.test.js `
  tests/map_flashpoint.test.js tests/map_flashpoint_runtime.test.js `
  tests/map_quality_score.test.js tests/map_presentation.test.js `
  tests/render_performance.test.js tests/elevenlabs_asset_generator.test.js `
  tests/elevenlabs_audio_factory.test.js tests/audio_quality_audit.test.js `
  tests/img2threejs_model_profiles.test.js tests/img2threejs_runtime_contract.test.js

# Generated-audio integrity only; neither command calls ElevenLabs.
& $node tools/audit_elevenlabs_candidates.js --ffprobe $ffprobe `
  --out outputs/elevenlabs-candidate-audit-20260729.json
& $node tools/audit_elevenlabs_factory_batch.js `
  --manifest outputs/audio-factory-20260729/manifests/aaa-wave-001.json `
  --root outputs/audio-factory-20260729/aaa-wave-001 --ffprobe $ffprobe `
  --out outputs/audio-factory-20260729/aaa-wave-001/technical-audit-20260729.json

# Bounded diagnostic—not the full long-run acceptance profile.
& $node tools/headless.js --matches 1 --seed 20260719 --smoke `
  --round-cap-sec 10 --max-sim-sec 60 --quiet --json

# Real former-liveness seam: a full BO3 acceptance match, not smoke.
& $node --test --test-name-pattern 'headless acceptance completes the historically stalled roster seam' `
  tests/hero_bots.test.js
```

The exact single-match liveness seam is now guarded. The default six-rotation
acceptance run still needs a separately retained balance report and enough wall
time; it is not implied by the single historical-seam pass.

## 5. Ordered TODO frontier

### P0 — diagnose and repair standard headless liveness

Completed on 2026-07-29:

1. Reproduced the exact base-seed/match-index seam and profiled it.
2. Added a static-only authored-map navigation broadphase, nearest-first
   recovery-cell evaluation, and a 0.35-second retry cadence for unchanged
   route-rejoin failures. No sudden-death rule, seeded tie-break, or collision
   rule was loosened.
3. Added the actual child-process acceptance regression and reran it green.
4. Added explicit static-geometry refresh, direct-navigation no-hot-path-
   rescan, and strict
   recovery ordering regressions (including finite, non-finite, and missing
   candidates plus non-coercible unsupported values); `tests/collision_broadphase.test.js`
   plus `tests/bot_navigation.test.js` passed 52/52 on 2026-07-30.

Continuing work is a **P1 balance gate**, not a liveness blocker: run all six
rotations with retained side-balance and human-playtest evidence before making
any competitive balance claim.

### P1 — candidate audio review and runtime admission

1. Start with `outputs/audio-factory-20260801/auto-triage-20260801.json`:
   350/350 decode, 69 reject/regenerate-review hints, 80 listen-first hints,
   and 201 normal-queue rows. This is only a listening-order aid.
2. Listen to the 350 provider candidates in context, not alone. Score each for
   intelligibility, distance/readability, duplication, clipping/noise, loop
   seams, and combat masking.
3. Complete rights/editorial review. Do not distribute or copy a candidate into
   `client/assets/generated/audio` until its candidate ledger explicitly says
   approved for that use.
4. Define game-mixer buses, ducking, attenuation, priority, concurrency, and
   event mapping. Compare candidates against the existing Local DSP contract;
   preserve the latter until a replacement passes all checks.
5. Keep raw provider audio, mastered derivative, hash, request metadata, and
   human verdict together. A rendered derivative is not a source replacement.

### P2 — Shiomaneki and remaining model quality

1. Correct the rope, claw/pincer silhouette, torso taper, helmet cheeks and
   mandible, boots, and material wear from the pilot review.
2. Reduce draw calls toward the target without removing required details.
3. Re-run strict spec, multi-angle, Tier 1, performance, and human review.
   Only an explicitly accepted profile can become runtime eligible.

### P3 — art-direction and playtest gate

1. Conduct a human map art review using the ten-view evidence. Assess central
   tower separation, roof rhythm, plaza storytelling, landmark readability,
   and combat legibility at real gameplay camera heights.
2. Conduct a human 5v5 playtest for routes, counterplay, cover readability,
   audio masking, and objective rotations.
3. Treat local 100/100 as a technical completeness gate, never as an external
   AAA approval or release approval.

### P4 — original visual asset-rush candidates

1. Continue from the dated `work/asset-rush/aaa-v1-pilot/manifest.json`; its
   lantern pilot remains evidence-backed but candidate-only. The wave now also
   contains original tide-marker, rope-coil, and ceramic-vessel reference PNGs.
2. Tide Marker 01 has a strict PASS spec, two-mesh static contract, and
   browser-render candidate evidence, but remains a **Tier-1/AI/runtime HOLD**.
   Follow its `NEXT_GATE.md` and the dated browser evidence before any
   promotion. It is not a runtime model.
3. Complete the lantern's calibrated strict multi-angle Tier-1/Tier-2 gate and
   a separate map-placement safety proposal before creating any runtime
   integration.
4. Keep every image/model candidate quarantined until a small reviewed subset
   passes presentation, collision, 30-route, fake-cover, and performance gates.

## 6. Copy/paste prompt — AAA Audio Expansion execution

```text
You are the execution owner for Kagariai's original AAA Audio Expansion.

Repository: C:\Users\rambo\projects\kagariai-props
Do not inspect, copy, or derive any material from
C:\Users\rambo\Downloads\SURAVASA. Preserve unrelated dirty-worktree changes.
Do not deploy, publish, commit, push, delete sources, or alter the Local DSP
runtime catalog unless a separate request explicitly authorizes that action.

Read first:
1. docs/AAA_EXECUTION_HANDOFF_20260729.md
2. docs/research/elevenlabs_audio_api_execution_refresh_20260730.md
3. outputs/audio-factory-20260729/manifests/aaa-wave-001.json
4. assets-src/elevenlabs/manifest.json
5. outputs/elevenlabs-candidate-audit-20260729.json

Authority and secret rules:
- Read ELEVENLABS_API_KEY only from the process environment. Never print it,
  persist it, put it in a prompt/manifest, or send it anywhere except the
  ElevenLabs API authorization header.
- Before external generation, use official ElevenLabs documentation and safe
  account metadata to re-check endpoint, enabled model, output format, credit
  quota, and concurrency. Do not log private account data.
- Use only provider-premade voices or sources whose written authorization is
  stored outside this task. Never clone or imitate a person, actor, character,
  franchise, artist, song, or real weapon brand.

Goal:
Build the next original candidate-only wave in manifest form, then generate it
in staged batches of at most 100 assets. Cover BGM/stems, ambient loops,
weapons, abilities, impacts, movement/foley, UI/objective feedback, Japanese
operations voices, and optional original hero barks. Every asset requires a
unique ID, owner/event, API kind, duration, variation axis, exact original
prompt, negative constraints, model, format, rights state, QC state, and
adoption state=candidate.

Prompt policy:
- Music: instrumental by default; include scene, intensity curve, tempo feel,
  original motif rule, mix space, duration/loop behavior, and negatives.
- SFX: include fictional mechanism/material, action envelope, perspective,
  duration, frequency/readability intention, environment, and negatives.
- Voice: provide only the spoken line and a generic original delivery brief;
  use a provider-premade voice ID; never name a person or character to mimic.
- All prompts must explicitly forbid artist references, existing melodies,
  recognizable game sounds, real-person imitation, spoken content where not
  wanted, clipping, and excessive sub-bass.

Execution loop per batch:
1. Write and validate the manifest with a dry run. Estimate count/cost before
   requests; use concurrency 1 initially and bounded retry/backoff for 429/5xx.
2. Generate into a new dated candidate directory. Never overwrite raw audio;
   resume only when the request hash and output hash match.
3. Record request hash, output SHA-256, content type, request/trace/song IDs
   when returned, byte count, time, and provider cost metadata without secrets.
4. Run decode/sample-rate/channel/duration/hash QC. For music, create a
   separate mastered derivative with a recorded two-pass measurement; for short
   voice, preserve peak protection and record integrated loudness rather than
   forcing a programme-length music target.
5. Quarantine technical failures. Keep all successes candidate-only until
   rights, creative, competitive-readability, and in-engine mix review pass.
6. Update this handoff with counts, commands, artifacts, exact failures, and
   next batch. Do not claim shipped/runtime admission without explicit proof.

Acceptance for a batch is not “the API returned audio.” It requires zero hash
or decode failures, no forbidden prompt/voice provenance, no clipping/invalid
duration, a complete ledger, and a named human review queue.
```

## 7. Copy/paste prompt — map, model, and liveness finisher

```text
You are the evidence-driven Kagariai finisher.

Repository: C:\Users\rambo\projects\kagariai-props
Read docs/AAA_EXECUTION_HANDOFF_20260729.md first. Never inspect or copy from
C:\Users\rambo\Downloads\SURAVASA. Preserve the dirty worktree and do not
reset, checkout, commit, deploy, publish, or delete unrelated files.

Goal: turn the remaining local technical risks into evidence-backed fixes while
keeping gameplay rules and candidate gates honest.

First, reproduce the standard headless R2+ failure at base seed 20260719,
match index 1 using a bounded progress trace. Determine sudden death vs
overtime vs bot-navigation/regroup failure before changing behavior. Add a
minimal regression at the real World/BotController seam, fix only the verified
bot liveness cause, and rerun the exact fixture. Do not change Shioura sudden
death rules without a separately approved design decision.

Then refine Shiomaneki only through its strict candidate pipeline: retain
reference/evidence provenance, repair silhouette/material issues, reduce draw
calls, and do not mark accepted until all quality gates are green.

For map work, preserve collision/presentation separation, all 30 safe routes,
zero false-cover clusters, 128/24,000 hard budgets, 120/22,000 soft budgets,
and the 250-call/1.2M-triangle preview limits. Re-capture ten views after every
material visual change. A local 100/100 quality score is not an AAA art review.

Every material change must end with focused tests, collision check, route and
fake-cover audit, exact before/after metrics, evidence paths, and this handoff
updated with remaining risks.
```

## 8. Official ElevenLabs references used for the implementation

- [Authentication](https://elevenlabs.io/docs/api-reference/authentication)
- [Music compose API](https://elevenlabs.io/docs/api-reference/music/compose)
- [Sound-effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
- [Text-to-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [429 retry guidance](https://elevenlabs.io/docs/help-center/technical/api-error-code-429)
- [Use policy](https://elevenlabs.io/use-policy)
