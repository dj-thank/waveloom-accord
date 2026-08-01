# AAA Continuation Addendum — 2026-08-01

This is the latest dated handoff addendum. Read it after
`docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md`; the master plan remains the
authoritative dependency graph. Work only in
`C:\Users\rambo\projects\kagariai-props`. Never inspect, copy, or derive from
`C:\Users\rambo\Downloads\SURAVASA`.

## Current verified state

| Area | Evidence | State |
|---|---|---|
| Source suite | `node --test --test-reporter=dot "tests/*.test.js"` | exit 0, 870 dots; `outputs/VERIFICATION_RECORD_20260801.md` and `verification-full-suite-20260801-final.tap` |
| Authored collision | `tools/generate_authored_map_collision.js --check` | hash `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29`, exit 0 |
| ElevenLabs catalog | `outputs/audio-factory-20260801/execution-summary-wave002.json` | 350 candidates, 350 technical pass, 257 mastered, 0 runtime admissions; Wave 002 added 100 SFX candidates |
| Audio auto-triage | `outputs/audio-factory-20260801/auto-triage-20260801.json` | 350/350 decoded; 69 reject/regenerate-review, 80 listen-first, 201 normal |
| Audio human-review priority queue | `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv` / `.json` | all 350 rows ordered reject-first; human score fields are blank; runtime admission remains disabled |
| ElevenLabs safe preflight | `outputs/audio-factory-20260801/elevenlabs-preflight-post-wave002.json` | API key present (not written), 8 models listed, 111,852 credits remaining, overage=false; preflight only |
| Visual references | `work/asset-rush/aaa-v1-pilot/manifest.json` and `qc/SOURCE_CANDIDATE_INTAKE_20260801.md` | 9 original references, all candidate-only; awning and roof finial have authored strict specs/PBR plus isolated browser candidate PASS (820/3 and 808/2, four hash-verified views); no map admission |
| Tide Marker complete local img2threejs ledger | `outputs/aaa_tide_marker_tier1_20260801/` and `OBJECT_SCULPT_SPEC.json` | WebGL=true; asset 1,156 triangles/2 calls; reference-light capture frame 1,156/2; Tier-1 IoU 0.9123; aspect/scale 0.0081/0.0081; multi-angle ratios 1.0011/1.0394; all 8 local passes recorded |

The Tide result is a complete local candidate ledger with measured Tier-1 and
multi-angle gates. It is not human AAA art acceptance, map/runtime admission,
collision, or integrated full-scene performance evidence. The candidate
intentionally keeps `collision=none` and must not become body-height cover.

## Exact continuation commands

```powershell
$node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Set-Location C:\Users\rambo\projects\kagariai-props

# focused contracts
& $node --test tests/asset_rush_candidate_manifest.test.js tests/img2threejs_tide_marker_batched_preview.test.js tests/elevenlabs_audio_factory.test.js tests/elevenlabs_preflight.test.js tests/elevenlabs_audio_summary.test.js tests/elevenlabs_human_review_scorecard.test.js tests/elevenlabs_audio_path_safety.test.js tests/elevenlabs_audio_candidate_triage.test.js tests/bot_navigation.test.js

# complete local source suite
& $node --test --test-reporter=dot 'tests/*.test.js'

# map digest
& $node tools/generate_authored_map_collision.js --check

# candidate audio queue (never writes runtime audio)
& $node tools/triage_elevenlabs_audio_candidates.js --out outputs/audio-factory-20260801/auto-triage-20260801.json --concurrency 1

# rebuild the deterministic human-listening queue from the retained reports
& $node tools/build_elevenlabs_priority_queue.js --triage outputs/audio-factory-20260801/auto-triage-20260801.json --scorecard outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_SCORECARD.csv --out-json outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.json --out-csv outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv
```

## P0/P1 TODO frontier

- [x] Re-run full source tests after browser telemetry and audio triage changes.
- [x] Capture Tide Marker in three known views and record runtime metrics plus
  screenshot hashes.
- [x] Add a fail-closed, path-safe acoustic triage tool and regression tests.
- [x] Run `forge/stage4_review/diagnose_render.py` Tier-1 against the retained
  filled silhouette reference; result IoU 0.9123, aspect/scale 0.0081/0.0081.
- [x] Run the multi-angle diagnostic with three-quarter and rear/side orbits;
  ratios 1.0011 and 1.0394, degenerate=false.
- [x] Run the ordered self-correction reviews through optimization-pass. These
  are candidate visual scores, not human AAA approval.
- [ ] Human art-direction review of the procedural stone/bronze surface and
  decision on whether a texture-safe refinement is worth the remaining budget.
- [ ] Human-listen the 69 reject/regenerate-review hints first, then the 80
  listen-first rows. Record rights, creative fit, competitive readability, and
  in-engine mix separately; automated flags never decide adoption.
- [ ] Define and review a separate runtime-admission manifest. Do not copy
  candidate audio or visual models into runtime before every required gate.
- [x] Re-check the historical `map_flashpoint_runtime.test.js` composition
  report. The current test is green; `buildMap()` has 1,064 solids, the
  flashpoint geometry has 192 additions, duplicate IDs are 0, and removed
  canonical IDs are absent. Keep this regression evidence so an accidental
  reintroduction of the old `979 !== 977` composition path fails closed.
- [x] Build the all-350-row human listening priority queue. Evidence:
  `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv`
  and `.json`; automated triage only orders the work and never decides adoption.
- [x] Generate Wave 002 as 100 candidate-only SFX slots (24 ambience, 24 Foley,
  20 movement, 16 objective/UI, 16 ability), run 100/100 technical QC and
  100/100 mastering. Full evidence is in
  `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`.
- [x] Add two original visual references (`prop-market-awning-01` and
  `prop-roof-finial-01`) with source hashes, prompts, dimensions, and
  candidate-only states. Intake evidence is
  `work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260801.md`.
- [x] Before Image → Three.js work on either new reference, write the measured
  physical-height/fake-cover or socket/sightline policy and an explicit draw /
  overdraw budget. Policies are in
  `img2threejs/prop-market-awning-01/SAFETY_POLICY.md` and
  `img2threejs/prop-roof-finial-01/SAFETY_POLICY.md`; modeling and map
  admission remain separate gates.
- [x] Run the `img2threejs` intake and authoring chain for both new references:
  technical probe, moderate pre-spec, 3×3 detail zones, source-derived PBR
  evidence (0.93/0.93), explicit component/material/repetition/detail contracts,
  and strict validation with zero errors/warnings. Reproducible tool:
  `tools/author_img2threejs_candidate_specs.mjs`; evidence:
  `outputs/aaa_img2threejs_candidate_specs_20260801.json`.
- [x] Generate bounded browser previews for the two authored specs and capture
  four hash-verified views each. Evidence:
  `outputs/aaa_img2threejs_browser_evidence_20260801.json` (WebGL=true,
  consoleErrors=0; awning 820 triangles/3 calls; finial 808/2).
- [~] Run Tier-1/multi-angle, real-map fake-cover, roof socket/clearance,
  sightline, and human art-direction gates. Keep both `candidate` and
  `NOT_RUNTIME_ADMITTED` until all gates are independently green.
  2026-08-02: the real-map half is done. `tools/audit_img2threejs_candidate_placement.mjs`
  places each candidate at a proposed anchor as a virtual cladding layer and re-runs
  the shipped fake-cover cluster rule. Awning PASS (0 new clusters, 0 body-band
  intrusions, nearest route 10.395 m); finial FAIL because its declared `0.85 m`
  root envelope exceeds the `0.80 m` thin-vertical limit while every authored part
  stays at or below `0.72 m`. Evidence:
  `outputs/aaa_img2threejs_placement_audit_20260802.json` and
  `outputs/VERIFICATION_RECORD_20260802.md`. Tier-1 and human art direction remain
  open; `forge/stage4_review/diagnose_render.py` is not present in this repository,
  so no Tier-1 number is claimed for either new candidate.
- [x] Finish the lantern-tower metadata reconciliation. The ring geometry now
  contains the added north-west and south-east stair flights (20 stair solids
  plus two landings), while runtime `highGroundRoutesBySite` intentionally
  excludes the central site. `map_flashpoint_runtime.test.js` asserts both the
  two declared counter routes and this explicit runtime boundary.

## Copy/paste prompt — next Tide Marker owner

```text
Work only in C:\Users\rambo\projects\kagariai-props and preserve all dirty
changes. Read docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md,
docs/AAA_TIDE_MARKER_IMG2THREEJS_CONTINUATION_PROMPT_20260730.md,
work/asset-rush/aaa-v1-pilot/img2threejs/prop-tide-marker-01/NEXT_GATE.md,
and outputs/aaa_tide_marker_browser_render_evidence_20260801.json.

The candidate has a strict spec and a complete local img2threejs pass ledger:
asset=1,156 triangles/2 calls, reference-light capture frame=1,156/2,
WebGL=true, collision=none, Tier-1 IoU=0.9123, and non-degenerate orbit ratios
1.0011/1.0394. Do not register it in the map or add collision. Preserve the
derived filled silhouette reference for geometry diagnostics and the original
four-view PNG for material/art review. Keep the two-call budget, store every
capture/hash/failure, and never call local candidate evidence human AAA or
runtime admission.
```

## Copy/paste prompt — next audio reviewer

```text
Work only from outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv
and its referenced candidate files. The source scorecard and acoustic report
remain available for audit. Do not call ElevenLabs and do not edit raw/mastered
audio. Review REJECT_OR_REGENERATE_REVIEW first, then LISTEN_FIRST, in three contexts:
isolated, plausible combat mix, and distance/occlusion. Record 0–5 scores for
identity, distance readability, mask resistance, loop seam, duplication, and
noise/clipping; separately record rights_review, creative_fit,
competitive_readability, and in_engine_mix. A technical or acoustic flag is
not a rejection or adoption decision. Keep every row candidate-only until a
separate, evidence-backed runtime-admission manifest and Human GO exist.
```

## Known non-blocking defects

- `map_flashpoint_runtime.test.js` has the historical composition-order defect
  described above; its failing arithmetic is a test-construction issue, not a
  newly observed gameplay regression.
- Lantern-tower data declares two counter routes while current geometry exposes
  one. This is a data/geometry reconciliation item, not permission to weaken
  route safety.
- Tide Marker remains a stylized procedural candidate; the local gates are
  complete, but the porous stone/patina richness and human art approval are not
  claims of Suravasa/AAA visual equivalence.
