# Kagariai Local Verification Record

Date: 2026-07-30

This record distinguishes fresh local evidence from unperformed release,
deployment, external rights, and human-art-direction gates. It contains no
credentials or provider account data.

## Runtime

The shell `node.cmd` shim was stale during this pass. Commands used the actual
Node executable at:

```text
C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe
```

Future runs should resolve a real `node.exe` rather than assume this exact path
will survive a runtime update.

## Fresh results

| Verification | Result | Notes |
|---|---:|---|
| Complete source test suite | 845 / 845 pass | fresh post-hardening `node --test "tests/*.test.js"` run; 0 errors / nonzero-exit failures |
| Navigation + collision hardening | 52 / 52 pass | explicit static refresh, replacement trace/sweep oracle, direct navigation scan guard, same/cross-cell source-order ties, finite/defensive ordering without object coercion |
| Map/audio/model focused suite | 59 / 59 pass | map visual, collision, Flashpoint, presentation/perf, audio factory/QC, model contracts |
| Authored collision manifest | pass | SHA-256 `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` |
| Historical headless seam | 1 / 1 pass | exact `base seed 20260719`, match index 1 regression; 24.260 s wall time |
| Tide-marker candidate strict gate | pass / HOLD | strict spec: 10 components, 3 materials, 0 errors/warnings; source-derived PBR evidence is recorded. Static blockout estimates 352 triangles but 7 meshes exceed the 2-call target, so no preview/runtime acceptance is claimed |

## What these results do and do not prove

They prove the checked local code/test contracts and the stated generated
candidate metadata at the time of this record. They do **not** prove a public
release, deployed server, external API quota/rights approval, audio editorial
approval, human art direction, full six-rotation competitive balance, physical
device/browser acceptance, or runtime adoption of any asset candidate.

## Candidate-art truth

- `prop-lantern-housing-01`: candidate-only 3D pilot; Tier-1/Tier-2 and map
  safety gates remain open.
- `prop-tide-marker-01`: original generated reference with strict-quality
  source/PBR/spec evidence and an unlocked blockout factory. It remains a
  seven-mesh / two-call-budget **HOLD**, with no browser preview, Tier-1,
  collision, map integration, or runtime admission.
- `prop-rope-coil-01` and `prop-ceramic-vessel-01`: original generated,
  hash-recorded intake candidates only. They have no 3D implementation.

See `docs/AAA_EXECUTION_HANDOFF_20260729.md` for the ordered continuation
frontier, and
`docs/AAA_TIDE_MARKER_IMG2THREEJS_CONTINUATION_PROMPT_20260730.md` for the
next strict Tide Marker pass.
