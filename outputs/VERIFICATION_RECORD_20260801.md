# Local Verification Record — 2026-08-01

This record closes the current local implementation pass. It does not grant
human AAA art approval, rights approval, runtime admission, deployment, or
public-release approval.

## Exact checks

Runtime:

`C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`

Full source suite:

```powershell
& $node --test --test-reporter=dot 'tests/*.test.js'
```

- exit code: `0`
- result: `870` passing tests, `0` failures, `0` errors
- raw dot output: `outputs/verification-full-suite-20260801-final.tap`
- TAP SHA-256: `EAFABA5471E42F24DB3A5E177AFB4309AB82CA5909E4352C5E39C5C6804DBC43`

Authored collision check:

```powershell
& $node tools/generate_authored_map_collision.js --check
```

- exit code: `0`
- manifest digest: `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29`

## Included new evidence

- Automated six-rotation headless run: `outputs/headless-balance-20260801.json`
  (SHA-256 `4399B033BDA9F15CF0A2695600A5DF84F6ED4C8421E15E57A29F68BC9C3821D4`),
  6/6 BO3, roster 18/18, east/west 0.60/0.40, round-two swaps 6/6, ultimate
  average 3.25, zero-use rate 0, max 7, no severe side bias.
- ElevenLabs candidate-only catalog: 350 candidates / 350 technical pass /
  257 mastered / 0 runtime admissions. Wave 002 is 100/100 technical and
  100/100 mastered; detailed evidence is in
  `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md` and the combined summary
  `outputs/audio-factory-20260801/execution-summary-wave002.json` (SHA-256
  `C1DF84D1E01099781AF850419D989FC91CED1FA1A7E80F79BCB54B97DC4A6DFA`).
- ElevenLabs candidate-only priority queue: 350 rows, ordered
  `REJECT_OR_REGENERATE_REVIEW` 69 → `LISTEN_FIRST` 80 → normal 201.
- Tide Marker refined browser candidate: WebGL=true, 1,156 asset triangles / 2
  calls, reference-light frame 1,156 / 2, Tier-1 IoU 0.9123, multi-angle
  ratios 1.0011 / 1.0394, degenerate=false.
- New Image → Three.js candidate specs: `outputs/aaa_img2threejs_candidate_specs_20260801.json`
  (SHA-256 `AAC73A9078CCC200CFBDD16EB26A958C44219DAE823B7579126ED9A7BE5654A7`).
  Market Awning 01: 10 components / 3 hero materials / 8 linked details;
  Roof Finial 01: 8 components / 3 hero materials / 7 linked details. Both
  strict-quality validations returned zero errors and zero warnings; PBR
  extraction confidence is 0.93 for each. The isolated Chrome/Playwright
  browser evidence is `outputs/aaa_img2threejs_browser_evidence_20260801.json`
  (SHA-256 `7D883D00957994A30E95A8461537F6BCE7AB32B5B66A09EACDBC9C100173B58E`):
  WebGL=true, consoleErrors=0, four hash-verified views each, awning
  `820` triangles / `3` calls, finial `808` / `2` calls, collision=none.
  Both remain candidate-only and `NOT_RUNTIME_ADMITTED`; Tier-1, real-map,
  human art, and integrated runtime gates are still open.
- No runtime audio, visual candidate, collision, or map registration was
  changed by the queue/evidence work.

## Still-open gates

- Human listening and rights/creative/mix decisions for provider candidates.
- Human art direction and map-safety proposal for visual candidates.
- Integrated runtime performance, gameplay playtest, release approval, and
  any external deployment/publication.
