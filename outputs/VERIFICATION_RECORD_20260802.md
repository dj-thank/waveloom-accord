# Local Verification Record — 2026-08-02

This record covers one loop only: the real-map placement safety gate for the two
new Image → Three.js candidates. It does not grant human AAA art approval,
Tier-1 likeness approval, rights approval, runtime admission, deployment, or
public-release approval. Both candidates remain `candidate` /
`NOT_RUNTIME_ADMITTED`.

## Exact checks

Runtime:

`C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`

```powershell
& $node --test --test-reporter=dot 'tests/*.test.js'
& $node tools/generate_authored_map_collision.js --check
& $node tools/audit_img2threejs_candidate_placement.mjs --out outputs/aaa_img2threejs_placement_audit_20260802.json
git diff --check
```

- Full source suite: exit `0`, `875` passing (`870` prior + `5` new), `0` failures,
  `0` errors. Raw dot output `outputs/verification-full-suite-20260802-placement.tap`,
  SHA-256 `4F06581E0AF9EBA695A88E17B55201F79FADD4B799114D26EC5778E975D72153`.
  Measured with the existing uncommitted working tree, not a clean checkout.
- Authored collision check: exit `0`, digest
  `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` — unchanged.
- Placement audit: exit `1` (one gate legitimately fails, see below). Report
  `outputs/aaa_img2threejs_placement_audit_20260802.json`, SHA-256
  `5BFBA4E28C16D211D4E84F2D9AC2AE800B44067E83593C60C0EFCE46123C3C94`.
- `git diff --check`: clean (only pre-existing CRLF warnings).

## What was added

- `tools/audit_img2threejs_candidate_placement.mjs` — read-only probe that maps an
  `OBJECT_SCULPT_SPEC.json` component tree into world-space boxes at a proposed
  anchor, injects them as a *virtual* cladding layer on a shallow copy of the map,
  and re-runs the shipped fake-cover cluster rule from
  `tools/audit_fake_cover_clusters.mjs`. It never writes to `shared/data`, never
  adds a solid, and never registers anything in the presentation SSOT.
- `tests/img2threejs_candidate_placement.test.js` — 5 tests pinning the result,
  including a deliberately unsafe control placement (a free-standing awning in the
  east market lane) that must keep failing. That control is the regression guard
  against quietly relaxing the rule to admit a candidate.

Interpretation limits recorded in the report itself: object-space positions come
from `transform.position`, falling back to the attachment `localStart`/`localEnd`
midpoint; the length axis of `tube` / `curve-sweep` parts is taken from the
dominant attachment direction. The declared root envelope is audited alongside the
authored parts as a conservative worst case and is labelled separately.

## Measured results

| Candidate | Anchor | Host top | New unsafe clusters | Body-band intrusions | Nearest route | Verdict |
|---|---|---:|---:|---:|---:|---|
| `prop-market-awning-01` | `canonical-076-wall` @ (20, 26.3, 4) | 7.00 m | 0 | 0 | 10.395 m | PASS |
| `prop-roof-finial-01` | `flash-site-kado-mass-north` @ (50, −30, 11) | 11.00 m | 0 | 0 | none on this roof | FAIL |
| control: free-standing awning | market slab @ (20, −10, 4) | 4.00 m | 0 | 5 samples | 7.225 m | FAIL (expected) |

Map baseline is `0` unsafe clusters over `1,064` solids, and stays `0` with either
candidate injected.

### Open findings

1. `prop-roof-finial-01` fails the placement gate. Its declared root envelope is
   `0.85 m` wide while the thin-vertical limit for anything rising above its host
   top is `0.80 m`. Every authored part is inside the limit (widest `0.72 m`,
   the stone collar); rim clearance is `1.575 m` against a `0.25 m` requirement.
   The correct fix is to tighten the declared envelope in
   `OBJECT_SCULPT_SPEC.json` to the real parts and re-run strict validation, which
   would also move `outputs/aaa_img2threejs_candidate_specs_20260801.json`. That
   spec edit was **not** made here; the `0.80 m` rule was not relaxed.
2. `prop-market-awning-01` passes, but the `2.20 m` underside clearance declared in
   `SAFETY_POLICY.md` is not met by the authored geometry: the lowest overhead part
   (tension cords) sits `1.50 m` above the mount floor, and the canopy panel
   underside sits `1.99 m`. The audited anchor passes only through the policy's
   second branch — the whole envelope stays inside the collidable wall footprint,
   where no player can stand. Any placement over a walkway must raise the canopy or
   shorten the cords first.

The control placement produced four thin-vertical failures (declared envelope,
canopy panel, front hem, fastener cluster) plus an underside-clearance failure,
confirming the rule still rejects an uncollidable body-height prop in a lane.

## Still-open gates (unchanged by this loop)

- Tier-1 silhouette/proportion and multi-angle diagnostics for both new candidates.
  The `forge/stage4_review/diagnose_render.py` tooling used for Tide Marker is not
  present in this repository, so no Tier-1 number is claimed for the awning or the
  finial.
- Human art-direction review and comparison-sheet judgement.
- Human listening, rights, creative-fit, and in-engine mix decisions for all 350
  audio candidates.
- Integrated runtime performance, 5v5 playtest, release approval, and any external
  deployment or publication.
