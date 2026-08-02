# Oshioi map — refreshed local evidence, 2026-08-02

The map scorecard was being read against a stale browser capture
(`outputs/root-flashpoint-map-preview-final-20260729.json`, taken when the map had
`17,725` presentation instances). The map now has `17,497`, so the count-match
criterion failed and the score sat at `95/100`. This pass re-captured every
browser measurement against the current map.

This is local evidence only. It is not human art direction, not a playtest, and
not release approval.

## Commands

```powershell
$node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
# static server on 8899 (see docs/AAA_MAP_HANDOFF.md §0), then:
& $node tools/cdp_preview_audit.mjs --mode map --url http://localhost:8899/client/map-preview.html `
  --out outputs/root-flashpoint-map-preview-20260802.json `
  --screenshot outputs/root-flashpoint-map-preview-20260802.png --width 1280 --height 800
& $node tools/audit_map_quality_score.mjs --preview outputs/root-flashpoint-map-preview-20260802.json `
  --out outputs/aaa_map_quality_score_20260802.json
& $node tools/audit_perf_views.mjs --url http://localhost:8899/client/map-preview.html --outdir outputs/aaa-map-20260802-perf
& $node tools/capture_map_views.mjs --url http://localhost:8899/client/map-preview.html --outdir outputs/aaa-map-20260802 `
  --views aerial,network,objective,spawn,orbit,site-shiogama,site-mizuichi,site-kado,site-ami,site-kazami
& $node tools/audit_route_safety.mjs
& $node tools/audit_fake_cover_clusters.mjs
```

## Results

**Map quality scorecard: `100 / 100`, `complete-local-evidence`, exit 0**
(`outputs/aaa_map_quality_score_20260802.json`). Previously `95/100` on stale
evidence, `77/100` with no preview at all. Every criterion passes:

| Criterion | Measured | Target |
|---|---:|---:|
| collision solids | 1,064 | ≥ 1,000 |
| presentation layers | 110 | ≤ 128 |
| presentation instances | 17,497 | ≤ 24,000 |
| browser draw calls | 145 | ≤ 250 |
| browser triangles | 503,434 | ≤ 1,200,000 |
| browser instances / layers | 17,497 / 110 | matches the definition exactly |
| browser exceptions + console errors | 0 | 0 |
| dome rhythm / beacon contrast / plaza hierarchy / finial cadence / site vocabulary | all pass | — |

**All ten review viewpoints stay inside budget** (`outputs/aaa-map-20260802-perf`):

| View | calls | triangles |
|---|---:|---:|
| aerial | 153 | 504,334 |
| network | 205 | 505,902 |
| objective | 146 | 503,470 |
| spawn | 147 | 503,482 |
| orbit | 146 | 503,470 |
| site-shiogama | 164 | 504,674 |
| site-mizuichi | 160 | 504,214 |
| site-kado | 165 | 504,686 |
| site-ami | 131 | 493,666 |
| site-kazami | 155 | 502,634 |

Worst case is `205 / 250` draw calls and `505,902 / 1,200,000` triangles, so the
map is running at roughly `82%` of its draw budget and `42%` of its triangle
budget. There is real headroom for a further art pass.

**Safety audits are clean at the same commit:** 30 of 30 approach routes traversable
with zero unsafe segments and zero unsafe high-ground segments; zero fake-cover
clusters over 1,064 solids.

Ten review screenshots are in `outputs/aaa-map-20260802/`.

## Reference benchmark — abstract metrics only

The owner explicitly directed that the SURAVASA capture be consulted as a quality
benchmark. Only measurable, non-expressive design values were taken from it. No
geometry, texture, material, object name, or layout was read into this project,
which stays consistent with
`OSHIOI_PRESENTATION.authorship.referencePolicy = 'abstract-quality-benchmark-only'`
and its `prohibitedMotifs` list.

Measured with headless Blender over the capture:

| Metric | Reference | Oshioi (this map) |
|---|---:|---:|
| mesh objects / presentation instances | 16,322 | 19,038 |
| triangles | 6,324,489 | 506,990 |
| triangles per object | 387 | 27 |
| materials | 527 | 46 |
| props ≤ 8 m (share of objects) | 73% | — |
| sub-0.5 m detail objects | 574 | — |

**The instance count is already comparable; the geometry budget per instance is
not.** Our props are boxes and planes at 2–12 triangles where the reference
carries ~387. That single ratio, not instance density, is what separates a
coloured greybox from a finished look. Our own ceiling is 1,200,000 triangles and
we are at 507k, so roughly 2.4× is available — enough to convert the
silhouette-defining instances to curved geometry, not enough to model everything.
Spending it on silhouette (roof caps, columns, crowning, arch openings) is the
highest-value use.

Two structural lessons were also taken and are being applied: horizontal banding
(plinth / body / trim / cornice) with real projection, and paving that reads as
laid stone with joints rather than coloured panels. The reference's dome-dominated
roofscape was deliberately **not** copied — this project forbids real-world
cultural motifs, so curvature comes from barrel vaults instead.

## Changes made in this pass

1. **Paving joints.** Every band-0/band-1 paving tile now draws a thin joint on
   its `+X` and `+Y` edge (shared with the neighbour, so never doubled), skipping
   the four central approach wedges so the negative space that makes the entrances
   readable is preserved. The joints use a new `stoneJoint` material that keeps the
   shell hue and only drops value — `cedar` made the floor read as one more warm
   decal, and `basalt` turned the plaza into a black grid in an earlier pass.
   Cost: `+1,541` instances, `+1` ground layer (8 → 9), `+1` draw call,
   `+3,082` triangles.
2. **Small-store roofs.** Tier-0 buildings were the source of the "identical flat
   plates from above" read: their roof occupied only 16% of the building height, so
   the hip slope collapsed into a plate. Their roof is now 24% of the height and
   their family is drawn from the barrel-vault set, giving the roofscape curvature
   in our own vocabulary. Cost: `+3,572` triangles, no new layer, no new draw call.

3. **Round columns.** `core-pilaster` is 569 instances and every one of them is a
   vertical member (engaged columns, balusters, lantern-post bodies), yet they
   were drawn as boxes. Switched to `cylinder`. This is the first deliberate spend
   against the triangles-per-instance gap: the central objective is the most-looked-at
   space on the map, and square posts were the strongest greybox tell at eye level.
   Cost: `+15,932` triangles, exactly as predicted, no new layer, no new draw call.

4. **Facade openings.** The upper arch band on ring stores was gated behind
   `tier >= 1 && r2 > 0.45`, so roughly a third of the harbour blocks had a single
   opening band and read as a flat box with painted trim. It now runs on every
   store, with the inset varying by tier so upper and lower openings do not line up
   into a grid, and tier-0 sheds get one shallow band under the eaves.
   Cost: `+21` instances, `+4,578` triangles, no new layer, no new draw call.

   This produced far less than expected, which is itself a finding: `clad-market-arch`
   — the layer that absorbs both `market-arch` and `ring-arch` — holds only **32
   instances across the entire ring**. The arch vocabulary is barely reaching the 178
   harbour buildings, and finding out why is the highest-value lead for the next pass.

All four changes are presentation-only. Collision, routes, and the authored
collision digest are untouched, and the fake-cover cluster count is still `0`.

### Rejected: trees inside the playable core

Three rotationally-symmetric pairs of `ring-tree-core-*` collision solids were
authored for the central arena (the core currently has no trees at all, and the
existing `insideCore()` guard was relaxed only for individually authored,
180°-symmetric coordinates that passed every route/spawn/overlap/boost check).

They passed route safety (30/30, zero unsafe segments) and the fake-cover audit
(0 clusters), but were reverted because they **change fight outcomes**.

`tests/hero_bots.test.js` — "three competitive matchups pass on both mirrored
sides with paired seeds" — failed with the trees in place:

```
match 1: global combat kills were one-sided at 1:6
match 4: global combat kills were one-sided at 5:0
```

Those matchups use fixed seeds, so the result is deterministic and reproducible,
and the same test passes with the trees removed. Six pieces of body-height cover
in the central arena were enough to tip two of the three audited matchups past the
one-sidedness guard. Placement needs balance iteration and a human playtest, which
is exactly the gate this project already declares — not something to decide from a
screenshot.

**Correction.** An earlier version of this document, and the commit message of
`4a7bcaa`, attributed the rejection to bot-navigation *performance*: the
acceptance match hitting `wall_clock_budget_exhausted` with worst-case bot think
rising from 441 ms to 2,488 ms. That measurement was wrong. It was taken while a
headless Chrome instance was rendering map views on the same machine, and the
`--max-wall-sec 90` budget is wall-clock and therefore load-sensitive. Re-measured
on an unloaded machine:

| | without core trees | with 6 core trees |
|---|---:|---:|
| wall elapsed | 31.5 s | 37.3 s / 39.5 s (two runs) |
| worst single bot think | 229 ms | 640 ms / 577 ms |
| final state | `MATCH_END` | `MATCH_END`, `failures=0` |

The trees do cost roughly 19% more wall time, but they stay well inside the 90 s
budget and the acceptance match completes. There is no bot-planner blocker. The
blocker is competitive balance, and it is a different and more interesting problem.

Any future performance number from `tools/headless.js --max-wall-sec` must be taken
with no browser capture running, or it measures the machine rather than the map.

## The harbour district is 23 buildings, not 178

`map_oshioi_site_cladding.js` opens with "178棟。ここが「まだ箱に見える」と指摘された
本体" and the whole cladding vocabulary is written against that number. The actual
ring contains **23 `ring-store-*` solids** (12 east, 8 west, 3 south). The visual
density of the ring comes from crates (150), deck stairs (218), trees (69) and
curbs (115) — not from architecture. This is why broadening the facade arch band in
`6acad31` moved only 21 instances: there are only 23 walls to put arches on.

Instrumented `tryStore` to count every rejection reason across one build:

| outcome | count | share |
|---|---:|---:|
| candidates generated | 117 | — |
| rejected: route clearance | 39 | 33% |
| rejected: overlaps existing solid | 21 | 18% |
| rejected: inside a spawn room | 16 | 14% |
| rejected: site keep-out (17 m) | 15 | 13% |
| rejected: inside the legacy core | 1 | 1% |
| **placed** | **25** | **21%** |

Two conclusions, both of which correct earlier guesses in this document's own
history:

1. **Route clearance is the largest single rejector but not the bottleneck.** A
   sensitivity sweep that graded the building clearance by height —
   `4.2 m → 3.4 m` for tall masses and `4.2 m → 2.6 m`, then `2.2 m`, then `2.0 m`
   for low sheds — moved the placed count only from 23 to 25, 26, and 28. Relaxing
   a competitive-geometry constant to buy three buildings is a bad trade, so the
   change was reverted rather than shipped.
2. **The candidate grid is the real ceiling.** Only 117 candidates are ever
   generated, from `BLOCK_PITCH_X = 23` / `BLOCK_PITCH_Y = 21` against
   `BLOCK_W = 14` / `BLOCK_D = 13`. Even rejecting nothing would yield 117, not 178.
   The way to a denser harbour is to generate more candidates inside the space that
   is already legal — a tighter pitch, and infill units between the existing
   blocks — not to loosen the constraints that keep lanes open.

That is the next piece of work, and it touches collision, so it has to clear the
mirrored-matchup balance test the same way the core trees failed to.

## P0-A shipped: harbour buildings 23 → 75

The candidate-grid ceiling described above was the fix. Tightening only the block
pitch — `BLOCK_PITCH_X 23 → 10`, `BLOCK_PITCH_Y 21 → 7`, a two-line change with no
safety constant touched — raised `ring-store-*` from 23 to 75. The pitch/yield
relationship is non-monotonic (discrete grid aliasing against `BLOCK_W 14` /
`BLOCK_D 13`), so the value was found by an empirical sweep, not a formula: pitch
19×17 actually gave *fewer* stores (22) than the 23×21 baseline.

Verified independently on an unloaded machine:

| gate | result |
|---|---|
| `ring-store-*` | 23 → **75** |
| map solids | 1,064 → 1,150 (canonical 175 + flash 192 + ring 783, all `ring-*`) |
| full source suite | exit 0, 875 dots, zero `F`/`X` |
| mirrored-matchup balance (`three competitive matchups`) | **pass**, no iteration needed |
| route safety | 30/30, zero unsafe segments |
| fake-cover clusters | 0 |
| map quality score | 100/100 |
| worst-view budget | 206/250 draw calls, 614,256/1,200,000 triangles |
| authored collision digest | unchanged |

The aerial view now reads as a built-up harbour ring instead of a sparse one;
the central arena is untouched. This is the change the whole cladding vocabulary
was waiting on — walls, roofs, eaves, and arches now have three times the surface
to land on.

One real cost surfaced: presentation instances rose 19,059 → 21,214 against the
soft budget of 22,000 (hard 24,000). Each store pulls ~41 cladding instances. The
786-instance margin means P0-B (eye-level detail) and P1-A (curved silhouette)
must either raise the soft budget deliberately or spend their triangles on
existing instances rather than new ones. A denser 81-store config (pitch 8×5) was
measured but left only 511 margin and was not shipped.

## P1-A shipped: corner columns box → cylinder (zero new instances)

With P0-A pushing instances to 21,214 against a 22,000 soft budget, the silhouette
spend had to come from upgrading existing primitives, not adding new ones. The
fattest "box column" tell at eye level is the corner pilaster on every ring store
— now 75 buildings × 4 corners.

`ring-pilaster` turned out to be an overloaded key used three ways: the 0.6 m
corner columns, the 0.34 m string-line lamp-post supports (guarded by a specific
finial test), and thin slabs. Moving the whole key to cylinder broke the
string-line test — correctly, because it counts the 0.34 m supports inside
`clad-shell-trim`. The fix was to split only the fat corner columns onto a new
`ring-column` key and a `clad-ring-column` cylinder layer, leaving the 0.34 m
supports as boxes where the test expects them. `site-pilaster` (site buildings)
is only ever a corner column, so it moved wholesale to `clad-site-column`.

Result, verified unloaded:

| gate | result |
|---|---|
| columns box → cylinder | 300 ring + 60 site = 360 |
| presentation instances | 21,214 → **21,214** (unchanged; primitives swapped in place) |
| presentation layers | 111 → 113 (budget 128) |
| triangles (browser) | 611,848 → 621,928 (+10,080 = 360 × 28, as predicted) |
| full source suite | exit 0, 875 dots, zero `F`/`X` |
| worst-view budget | 208/250 draw calls, 624,336/1,200,000 triangles |
| fake-cover clusters | 0 |
| authored collision digest | unchanged |

Draw calls rose by 2 (the two new layers). This is the pattern for the rest of
P1-A: find an overloaded box key that is genuinely a curved/vertical member, split
just that use onto the right primitive, spend triangles not instances.

### Rejected: chamfered crates (bad triangle trade)

Splitting the 209 harbour crates (`ring-crate` + `market-crates`) from box onto a
`chamferBox` layer was tried and reverted. It passed every gate — 875 tests, 100/100,
fake-cover 0, digest unchanged — but the cost was wrong. `chamferBox` is not the
~44 triangles the primitive table assumed; the bevelled extrude geometry measures
about **600 triangles each**, so 209 crates added **127,000 triangles** (611,848 →
749,000, jumping the budget from 52% to 62%) for an edge bevel that is invisible at
gameplay distance. The learning doc's own rule — spend triangles on silhouette, not
dressing — says no. The 40-triangle cylinder columns are a good trade because a
round column reads at range; a 600-triangle bevelled crate is not, because crates
are small floor dressing. Kept the columns, reverted the crates. The measured
`chamferBox ≈ 600 tris` figure is recorded so future passes budget it correctly:
it is only worth spending on a large, close, silhouette-defining surface, never on
scattered props.

## Side effect of P0-A: arch openings tripled on their own

The facade arch broadening in `6acad31` moved only 21 instances when there were
23 buildings. With P0-A at 75 buildings, the same code now emits **102 arch
openings** (`clad-market-arch`, up from 32), plus 47 colonnades and 51 lattices —
roughly 2.7 opening treatments per building. The flat-wall tell that the reference
solves with recessed openings is now substantially addressed as a free consequence
of having three times the hosts, with no new work. This is the compounding the plan
predicted: fixing the host count first makes every per-building vocabulary item pay
off across the whole ring.

## Art observations from the captured views — for the human art pass

These are recorded, not acted on. The map is dense and heavily pinned by tests, so
changing its look on a guess is more likely to regress it than improve it. Each
item below is something a human art director should confirm before anyone edits:

1. **Small-building roofs read as flat plates from above** (`site-mizuichi.png`,
   `aerial.png`). The ring stores already carry seven roof families, split large
   roofs, eaves, ridges and spires, but the smaller stall/store bodies still
   present a single dark-teal slab at grazing top-down angles. A ridge cap or
   vent at ≤ 0.34 m width would stay inside the cladding safety limit.
2. **Central plaza paving reads as coloured decals rather than laid stone**
   (`objective.png`). The terracotta patches have no joint or border, so they sit
   on the pale field without an edge. The ground module has `8` layers used of an
   `8` layer budget and `3,179` of `7,600` instances, so a joint frame is
   affordable without a new draw call.
3. **Site vocabulary is only nominally distinct.** Within 26 m of each site
   centre, that site's own vocabulary is `2.1%`–`5.9%` of instances
   (shiogama 2.1, mizuichi 4.1, kado 4.6, ami 3.7, kazami 5.9), and 24–45
   instances per site come from a *different* site's vocabulary. The scorecard's
   "five families with ≥ 3 layers" criterion passes on layer count, so this
   deficit is invisible to it.

## Unchanged by this pass

No collision, cladding, route, or presentation data was edited. The authored
collision digest is still
`66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` and the full
source suite is still `875` passing with `0` failures.
