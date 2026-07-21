# Visual refinement report — 2026-07-21

## Outcome

The blockout-like world, missing articulated third-person presentation, and
oversized combat HUD were addressed without changing authoritative collision or
simulation rules.

## World presentation

- `map.solids` and `presentationSolids` remain the canonical gameplay geometry.
- The new `non-colliding-world-dressing` group is visual-only and declares
  `collision:false`.
- Opaque facade posts, horizontal bands, and bay panels are fully contained by
  an existing canonical collider. Tests reject any protruding instance AABB.
- Large wall faces are divided into bays no wider than approximately 2.4 m and
  vertical rows no taller than approximately 2.7 m.
- Per-instance facade colors, horizontal level bands, PBR coverage for stairs
  and spawn walls, and reduced outline noise replace the uniform box faces.
- Coplanar details use polygon offset rather than protruding beyond collision.
- Decorative rocks remain outside playable bounds and route lights are
  holographic, non-colliding presentation.

## Character presentation and SSOT

- `shared/data/character_assets.js` is the single runtime descriptor for the
  articulated base: URL, SHA-256, byte count, MIME type, size ceiling, clip
  aliases, authors, source, and license.
- The bundled CC0 RobotExpressive GLB is verified before `GLTFLoader` receives
  an object URL. Browser state reported `data-hero-rig="verified"` in this run.
- Third-person state now consumes velocity, pitch, grounded/crouch, cast,
  action, alive, and death state to drive idle/walk/run/air/crouch/fire/cast/
  death animation.
- Every new fire or ability event increments a presentation-only trigger and
  restarts the matching one-shot clip, including consecutive shots.
- All 18 heroes keep distinct project-authored silhouette/accessory signatures
  and team readability. The procedural articulated fallback remains available
  if the verified GLB fails.

This is one shared articulated base plus 18 hero-specific presentation layers;
it is not a claim that 18 individually sculpted production meshes now exist.

## Combat HUD

- The default bottom HUD is approximately 89–94 px at the audited 1280×720
  viewport (about 12–13% of screen height), down from approximately 276 px
  (about 38%).
- The default view keeps hero, HP/shield, ammunition, resource, ability input,
  short name, state/cooldown, and progress visible.
- A separate compact tactical prompt keeps the current instruction visible
  during play. Effect/range details, role purpose, phase, and the full
  checklist remain available through `戦術詳細 F1`.
- The expanded panel is capped at `min(42dvh, 360px)` and scrolls internally.
- The toggle remains visible inside the expanded panel, and an actual
  expand/collapse round trip ended with `aria-expanded="false"`.
- Full ability input/effect/range/cooldown/state text remains in the ability
  root `aria-label` while visually collapsed.
- The tactical prompt and pointer-lock hint are moved above the current HUD
  state rather than covering its cards. Settings default to a native collapsed
  `<details>` control.

## Current-run visual evidence

- `outputs/rc5-visual-refinement-audit/01-before-live.png`
- `outputs/rc5-visual-refinement-audit/03-after-final-live.png`
- `outputs/rc5-visual-refinement-audit/04-after-expanded-live.png`
- `outputs/rc5-visual-refinement-audit/05-before-after-comparison.png`

The browser run also reported `data-authored-map="loaded"` and
`data-hero-rig="verified"`.

## Verification boundary

Node structural tests prove collision containment, descriptor integrity,
animation-state routing, HUD contracts, and deterministic resource behavior.
The current-run screenshots verify visible layout and the live asset status.
They do not prove 1080p GPU percentile performance, screen-reader/forced-colors
behavior, 18-hero blind-identification rate, public deployment, or bespoke
production sculpt quality. Those remain separate release gates.
