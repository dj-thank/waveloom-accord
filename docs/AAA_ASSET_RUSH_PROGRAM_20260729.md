# Kagariai AAA Asset Rush Program and Copy/Paste Prompt

Updated: 2026-07-30

## Purpose

Build a large, original candidate-asset library that raises environmental
variety, gameplay readability, character fidelity, and audio breadth without
copying any third-party work or silently harming collision, performance, or
competitive clarity.

`C:\Users\rambo\Downloads\SURAVASA` is a quality-bar reference only. Do not
open it, inspect it, copy it, derive prompts from it, or reproduce its layouts,
assets, UI, names, sounds, silhouettes, or recognizable style signatures.

This is a **candidate-production** program. An asset becomes runtime eligible
only after its own provenance, technical, visual, gameplay, and performance
gates are recorded as passed.

## Production target

The first bounded program is 144 candidate assets, produced in batches of at
most 24 visual/image references or 100 audio assets. It intentionally mixes
high-volume reusable parts with a smaller set of high-fidelity hero/landmark
pilots.

| Family | Candidate target | Production route | Runtime admission gate |
|---|---:|---|---|
| Tileable materials and trim studies | 24 | Original image generation / authored procedural texture | seams, PBR channels, texel density, visual review |
| Decals, signage motifs, and story marks | 24 | Original image generation / vector or canvas authoring | legibility, no text/IP issue, alpha/atlas budget |
| Foliage, rocks, driftwood, and shore clutter | 24 | Image reference -> procedural Three.js or authored instancing | silhouette, overdraw, collision/cover audit |
| Modular market, shrine, dock, and roof props | 36 | Image reference -> procedural Three.js | multi-angle quality, sockets, LOD/draw-call budget |
| Landmark/hero refinement pilots | 12 | Image reference -> strict img2threejs pipeline | all strict model gates and human review |
| Next audio candidates | 24+ | ElevenLabs candidate-only factory | rights/editorial/mix/QC gates |

This target is a planning and candidate count, not a promise that all 144 are
shipped or integrated.

## Non-negotiable rules

- Use only original visual descriptions and original prompts. Never name or
  imitate an artist, franchise, game, actor, person, character, recording, real
  weapon brand, or recognizable sound signature.
- Keep generated images, image references, source prompts, Three.js models,
  rendered derivatives, and runtime-admitted files in separate traceable
  directories. Never overwrite an existing raw candidate.
- Presentation geometry stays collision-free unless collision is deliberately
  authored and all route/fake-cover checks pass. Never create body-height visual
  cover without collision.
- Preserve the map's 128 presentation-layer / 24,000 instance hard limits,
  250-call / 1.2M-triangle preview limits, and current safe-route contracts.
- An image is not a 3D model. A single view is insufficient for hidden geometry;
  record approximation confidence and request/add views before a high-fidelity
  model is accepted.
- Do not put secrets, API keys, provider headers, or private account metadata in
  prompts, manifests, screenshots, logs, source files, or handoffs.

## Candidate directory and manifest contract

Use a new dated root for every wave, for example:

```text
work/asset-rush/<wave-id>/
  prompts/                # JSONL + human-readable prompt library
  image-candidates/       # immutable original image outputs
  img2threejs/            # one directory per prop/hero pilot
  renders/                # review screenshots and comparison sheets
  qc/                     # hashes, measurements, pass/fail records
outputs/asset-rush/<wave-id>/
  manifest.json
  review-queue.md
  adoption-ledger.json
```

Every row must include at least:

```text
asset_id, wave_id, family, gameplay_owner, intended_use, source_route,
original_prompt, negative_constraints, source_hash, source_state,
candidate_state, collision_policy, socket_policy, LOD_policy,
triangle_budget, draw_call_budget, texture_budget, quality_gates,
rights_state, reviewer, adoption_state, notes
```

Allowed `adoption_state` values are `idea`, `prompted`, `generated`,
`candidate`, `quarantined`, `approved_for_integration`, `runtime_eligible`, and
`rejected`. Default is `candidate`; no batch may self-promote to runtime.

## First-wave inventory

### 1. Tileable surface and trim candidates (24)

- `mat-salt-stone-01..04`: weathered pale salt-stone, worn edges, low-contrast
  aggregate, no symbols.
- `mat-terracotta-walk-01..04`: hand-laid terracotta walk variants with readable
  directional wear and controllable wetness masks.
- `mat-aged-cedar-01..04`: cedar plank/beam variants, restrained grain,
  separate roughness/normal/AO intent.
- `mat-roof-ceramic-01..04`: curved ceramic roof surfaces with non-uniform but
  believable soot/salt aging; not a copied regional landmark.
- `trim-bronze-lantern-01..04`: fictional cast-bronze trims, oxidation masks,
  and bevel-readable highlights.
- `trim-dyed-cord-01..04`: original woven cord/binding detail, neutral
  iconography, no letters/logos.

### 2. Decals and environmental story marks (24)

- `decal-tide-stain-01..06`, `decal-ceramic-repair-01..04`,
  `decal-salt-scratch-01..04`, `decal-market-chalk-01..04`,
  `decal-rope-fray-01..03`, and `decal-dock-wear-01..03`.
- These must be text-free unless a separately approved fictional language
  system exists. Generate transparent-background or mask-ready candidates only.

### 3. Reusable world props (36)

- `prop-lantern-housing-01..04`, `prop-lantern-hanger-01..03`,
  `prop-market-awning-01..04`, `prop-shrine-offering-01..03`,
  `prop-roof-finial-01..04`, `prop-dock-pile-01..03`,
  `prop-rope-coil-01..04`, `prop-ceramic-vessel-01..04`,
  `prop-driftwood-01..03`, `prop-tide-marker-01..04`.
- All must expose a pivot, placement footprint, material slots, optional
  collision policy, LOD plan, and deterministic seed policy.

### 4. Foliage and natural scatter (24)

- `foliage-reed-clump-01..06`, `foliage-salt-shrub-01..06`,
  `foliage-hanging-vine-01..04`, `scatter-smooth-stone-01..04`,
  `scatter-shell-fragment-01..02`, `scatter-seaweed-drift-01..02`.
- Treat foliage as transparent/overdraw-sensitive; make an instancing and
  distance-cull plan before integration.

### 5. High-fidelity pilots (12)

- `pilot-shiomaneki-refine-01`, `pilot-central-landmark-01`,
  `pilot-lantern-tower-01`, `pilot-objective-ritual-set-01`, and eight props
  selected only after the low-cost candidate review identifies a real gap.
- These use the strict `img2threejs` process; do not mass-convert a rough image
  into runtime geometry.

## Image -> Three.js quality loop

For every selected image-reference candidate:

1. Confirm that the image is original, legal to use, technically readable, and
   suitable for the chosen 3D target. Reject vague, collage-like, copyrighted,
   logo-bearing, or text-dependent references.
2. Write a `qualityContract` before modeling: object class, intended use,
   gameplay/collision role, macro silhouette, material systems, sockets,
   animation/destruction needs, triangle/draw-call target, and hidden-side
   confidence.
3. Run the img2threejs staged pipeline from its skill root. Start from the
   unlocked pass, create the assessment/spec, pass strict validation, build only
   the unlocked pass, render, compare, record a review, then advance.
4. Require at least two meaningful review angles for non-planar models. Record
   what changed, why, what remains approximate, and whether the next action is
   `continue`, `refine-spec`, `refine-code`, `request-input`, or `stop`.
5. Add a model only as a candidate. Integrate it only after collision,
   fake-cover, route, triangle, draw-call, texture, and visual review gates all
   pass.

## RUSH loop

Repeat this loop only while the next batch has a reviewed manifest and stays
within its explicit budget:

1. Inspect current map/model/audio gaps and draw-budget headroom; choose the
   smallest high-value asset family, not the largest possible file count.
2. Create a batch manifest and exact original prompt library. Check that no
   prompt contains prohibited references or accidental text/logos.
3. Generate or author candidates into a new dated quarantine directory.
4. Hash, probe, render, and visually review candidates. Quarantine failures;
   never delete raw evidence during the wave.
5. Promote only a small approved subset to an integration branch/path. Run
   focused tests and map performance/safety audits after every material change.
6. Record before/after instance, triangle, draw-call, layer, collision, route,
   and false-cover metrics. If any hard gate fails, revert only that candidate
   integration and leave the raw candidate ledger intact.
7. Update the wave ledger and choose the next gap. Stop at budget, repeated
   defect, missing rights/provenance, or a human art-direction decision.

## Copy/paste execution prompt

```text
You are Kagariai's original AAA Asset Rush production owner.

Repository: C:\Users\rambo\projects\kagariai-props
Quality bar: original, readable, richly layered competitive-world assets. Do
not inspect, copy, or derive from C:\Users\rambo\Downloads\SURAVASA or any
third-party game, artist, franchise, actor, character, recording, weapon brand,
layout, UI, name, or recognizable style signature.

Read first:
1. docs/AAA_EXECUTION_HANDOFF_20260729.md
2. docs/AAA_ASSET_RUSH_PROGRAM_20260729.md
3. docs/AAA_FINALIZATION_TODO_20260729.md
4. outputs/map-visual-finish-20260729/quality.json

Authority and safety:
- Preserve the dirty worktree. Do not reset, checkout, commit, push, deploy,
  publish, delete, or overwrite existing raw candidates.
- Use original prompts only. Do not generate real-person likenesses, cloned
  voices, logos, readable third-party text, real weapon brands, or copied art.
- Never reveal or persist API keys. Keep provider outputs candidate-only until
  provenance, rights, technical QC, editorial review, gameplay readability, and
  in-engine mix/art review all pass.
- Never create body-height visual cover without explicitly authored collision
  and passing collision/fake-cover/route audits.

Goal:
Produce the next dated candidate wave from the first-wave inventory. Prefer
reusable environmental assets that visibly improve variety while staying within
the map's layer, instance, draw-call, triangle, texture, and overdraw budgets.
Use image generation only for original candidate references/textures. For every
selected 3D prop or character, use the img2threejs staged quality-gated process;
do not one-shot a mesh from an image.

For each batch:
1. Create a manifest with IDs, owner/use, exact original prompts, negative
   constraints, provenance, collision/LOD/socket policy, technical budgets,
   quality gates, and candidate-only adoption state.
2. Keep raw generated images and image references immutable. Probe/hash them.
3. For 3D candidates, write a quality contract and strict sculpt spec, build
   pass-by-pass, render at multiple angles, compare, record what changed and
   what remains approximate, then decide exactly one next action.
4. Integrate no more than the smallest reviewed subset needed for a measurable
   improvement. Run focused model/map tests plus collision, 30-route,
   fake-cover, presentation, instance, triangle, and draw-call audits.
5. Record before/after metrics and update the durable wave handoff. Leave
   rejected/quarantined raw candidates traceable; do not pretend candidate
   generation is runtime admission or AAA approval.

Exit conditions:
- stop the current batch on a hard budget failure, repeated visual defect,
  missing provenance/rights evidence, or a decision requiring human art
  direction;
- otherwise finish the manifest, evidence, tests, and next dependency-ordered
  TODO before beginning another batch.
```

## Current next action

The first bounded pilot now exists at
`work/asset-rush/aaa-v1-pilot/`:

- `prop-lantern-housing-01` has an original generated reference, source hash,
  probe result, PBR evidence, formal Image -> Three.js assessment/spec, strict
  spec-validation pass, generated factory, and a browser review harness.
- Its measured preview is 1,640 triangles and 3 asset draw calls, with no
  collision. It remains **candidate only** and is not registered in the map.
- Its complete evidence and open gates are in
  `work/asset-rush/aaa-v1-pilot/img2threejs/prop-lantern-housing-01/CANDIDATE_REVIEW.md`.

Next: finish the lantern pilot's calibrated Tier-1/Tier-2 visual-review loop and
a separate map-placement safety proposal before any integration. The next small
original batch has now grown to eight immutable candidate references: tide
marker, rope coil, ceramic vessel, wayfinding lantern post, public water basin,
and hanging signal bells, plus the 2026-08-01 market awning and roof finial. Their hashes,
dimensions, prompts, and preliminary decisions are in
`work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260730.md` and
`work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260801.md`.

Tide Marker 01 now has a technical probe, component-zone inventory, visual
pre-spec assessment, source-derived PBR evidence, a strict-quality PASS sculpt
spec (10 components / 3 materials / zero warnings), and a refined
browser-render candidate pass. The candidate preview measures 1,156 asset
triangles / 2 calls and the reference-light frame also measures 1,156 / 2
across front, three-quarter, and rear; see
`outputs/aaa_tide_marker_tier1_20260801/`. Tier-1 IoU is 0.9123 and the
multi-angle diagnostic is non-degenerate (1.0011/1.0394). AI-vision,
map/runtime, and human art gates remain open. Use
`docs/AAA_TIDE_MARKER_IMG2THREEJS_CONTINUATION_PROMPT_20260730.md` for its
review gate. Rope coil and ceramic vessel remain intake-reviewed candidates;
their procedural simplification/breakable policies must be written before Image
-> Three.js work begins. None of this means the 144-candidate plan has been
completed or that any candidate is runtime eligible.
