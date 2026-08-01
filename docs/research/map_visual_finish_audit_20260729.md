# Flashpoint map visual-finish audit (2026-07-29)

## Scope and evidence

This is a read-only visual audit of the original Kagariai map. I inspected the
local preview PNG, its JSON capture, the local quality-score JSON, the AAA
finalization TODO, and the presentation/landmark/ground/cladding sources. I did
not inspect or use SURAVASA or external APIs. The preview is a 1600x900 aerial
view of `map_oshioi` (`oshioi-shiokagami-original-v1`).

Observed evidence: 17,725 presentation instances, 110 layers, 147 render calls,
505,146 triangles, 149 geometries, 9 textures, and no browser console
exceptions. The JSON contains one non-gameplay favicon 404 network log. The
quality score is 100/100 `complete-local-evidence`, but explicitly says this is
not a human AAA-art verdict. Collision and route safety are separate gates.

### Observation versus inference

- **Observed:** The central copper beacon is the strongest foreground vertical
  but its mast is cropped by the top edge of the screenshot; many background
  blocks use closely related pale shell/grey roof values; gold finials and
  lanterns repeat in long, near-regular rows; the central plaza contains dense
  black/cedar seam geometry and radial gold markers.
- **Inference:** The crop weakens landmark silhouette recognition, the repeated
  far-roof cadence reduces district legibility at aerial distance, regular
  finial rows read as procedural rather than authored, and the central floor
  pattern can compete with player/objective readability. These are art-direction
  hypotheses, not gameplay findings; each requires before/after captures.

## Ranked, low-risk recommendations

### P0 — Reframe the hero capture and tune beacon/background value separation

**Likely files:** preview camera/shot setup (the map-preview page or its camera
configuration) and, only if the reframed view still lacks separation,
`shared/data/map_oshioi_landmarks.js` beacon material assignments plus
`shared/data/map_oshioi_presentation.js` far-shell/far-roof materials.

**Change:** Lower/rotate the aerial camera enough to include the complete beacon
tip and preserve at least one screen-height of skyline behind it. In the
material pass, test a restrained darker/warmer beacon body or a narrow indigo
band while keeping far-shell roofs one value step quieter; do not add a new
light.

**Benefit:** A complete silhouette gives the opening site an unambiguous visual
anchor; value separation prevents the beacon from merging with the distant
industrial skyline.

**Collision risk:** None for camera/material-only work. If a landmark transform
is edited, keep it presentation-only and attached to existing beacon solids;
`map_site_cladding` footprint tests must remain green.

**Performance budget:** Camera/material-only: ~0 instances, 0 layers, 0 calls,
0 triangles. A beacon band using an existing box layer should stay within
approximately +1 layer/+8 instances and <200 triangles; retain the verified
ceilings (24,000 instances, 128 layers, 1.2M triangles).

**Acceptance evidence:** Capture the same 1600x900 view plus a hero view where
the tip is not cropped; compare beacon/background luminance and silhouette
readability by human review. Re-run preview contract, console/network log scan,
`map_site_cladding.test.js`, and the map quality score.

### P1 — Replace deterministic far-roof cadence with a bounded authored mix

**Likely file:** `shared/data/map_oshioi_presentation.js` (the `roofStyle =
siteIndex % 5` branch around the metropolis roof arrays).

**Change:** Keep the existing `hipRoof`, `barrelRoof`, `sawRoof`, and `dome`
  primitives, but choose styles from a fixed, reviewed permutation keyed by
  `siteIndex` (and optionally district ring), with only 2–4 deliberate
  silhouette outliers in the highest tier. Preserve all existing transforms,
  outside-playable-bounds semantics, and the current layer IDs.

**Benefit:** Breaks the visible every-fifth repetition and gives each aerial
  district a more intentional skyline rhythm without importing a new style.

**Collision risk:** None when transforms stay outside playable bounds. Do not
  move any `presentationSolids`; assert that no presentation transform enters a
  walkable/collision footprint.

**Performance budget:** Reassignment only: 0 new instances/layers/calls; triangle
  count should remain within the current 505k ± the primitive mix delta. If up to
  four roofs are upgraded to domes, reserve roughly +4,800 triangles (the
  documented dome budget is 1,200 each), still far below 1.2M.

**Acceptance evidence:** Ten-view browser capture (all sites and aerial angles),
  diff the roof silhouette cadence, and record instances/layers/calls/triangles.
  Run map presentation contract, map quality score, route-safety and fake-cover
  audits; require unchanged 30/30 route safety and zero fake-cover clusters.

### P2 — Introduce negative space and a single readable objective-floor motif

**Likely file:** `shared/data/map_oshioi_ground.js`, specifically the objective
  `ground-lane-gold` radial markers and central `shellFan`/`waveRings` seam
  generation.

**Change:** Keep the objective ring and route lanes, but thin or shorten the
  innermost radial gold markers in the central 8–12 m and reserve one clean
  approach wedge from each spawn direction. Use the existing cedar/basalt
  seam materials; do not add waist-high props or opaque cover.

**Benefit:** Makes the capture area and approach lanes read in one glance,
  reducing floor-pattern noise in combat while retaining the tidal-harbour
  language.

**Collision risk:** Low if this is plane/seam presentation only; changing
  `underBuilding` or any solid is out of scope. Verify presentation-empty
  collision identity and route safety after edits.

**Performance budget:** Removing markers is a small win. The current source
  emits about 430 gold lane tiles (quality-score metric); a 15–25% reduction is
  approximately 65–110 fewer instances and no new layers/calls.

**Acceptance evidence:** Compare center-plaza and first-person-height test
  captures with objective marker visibility, lane continuity, and no new visual
  body-height cover. Run `map_quality_score`, route safety, fake-cover cluster,
  and browser preview/perf capture.

### P3 — Make finial rows intentionally irregular while retaining sightline clearance

**Likely file:** `shared/data/map_oshioi_site_cladding.js`, `stringLine()` and
  the `ring-finial` emission around lines 737–741 and 899–905.

**Change:** Replace the current near-uniform boundary jitter with a small,
  deterministic skip/scale pattern (for example, one omitted finial every
  5–7 spans and a two-level height palette), constrained to existing rail/pole
  footprints. Keep the current `hash01` seed so output remains reproducible.

**Benefit:** Removes the repeated picket/final cadence visible across the aerial
  plaza and gives each route string a hand-authored rhythm without adding props.

**Collision risk:** Low but non-zero: finials are presentation cladding on
  existing solids. Keep XY offsets within the current 0.35 m/0.8 m cladding
  tolerances and do not create human-height false cover.

**Performance budget:** Omitting 10–15% of finials removes an estimated
  25–60 instances (exact count must be measured from the generated layers);
  layers and draw calls remain unchanged.

**Acceptance evidence:** Re-run `map_site_cladding.test.js` and the fake-cover
  audit, then capture all ten views and inspect long rows for rhythm, clearance,
  and site identity. Record exact before/after `clad-ring-finial` count and total
  preview metrics.

## Required finish gate

After any chosen change, recapture the dated preview and rerun the focused map
tests, collision manifest check, route-safety audit, fake-cover audit, and
performance report. Treat the result as stronger local visual evidence only;
it does not establish deployment, multiplayer, device, or external human AAA
approval.

