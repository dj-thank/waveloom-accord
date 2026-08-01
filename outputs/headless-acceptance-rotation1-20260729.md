# Headless acceptance evidence — historical rotation 1

Date: 2026-07-29

## Exact seam

```powershell
& $node tools/headless.js --seed 20260719 --match-index 1 --matches 1 `
  --max-sim-sec 2700 --profile --max-wall-sec 90 --quiet --json
```

- Base seed: `20260719`
- Match index: `1`
- Derived match seed: `20268638`
- Roster: `vesta, botan, ankou, tsuzuri, kazura` versus `nuedori, shirasagi,
  asagi, hibari, shirabe`

## Fresh result

| Field | Result |
|---|---|
| Exit status | `0` |
| Final state | `MATCH_END` |
| Termination | `match_end` |
| Score | `[0, 2]` |
| Simulated duration | `340.159 s` |
| Wall-clock budget exhausted | `false` |
| Round-side swap | observed; east and west each won one decisive round |
| Headless failures | `0` |

The standalone Node-test regression
`headless acceptance completes the historically stalled roster seam` also
passed in `49.484 s` wall clock with the same exact seam. The complete
headless-focused set (smoke, match-index, invalid-input, profile, and this
acceptance seam) passed `5/5`.

## Verified cause and repair

The historical run repeatedly rebuilt route-recovery A* work while a bot had
not moved and route progress had not changed. The repair keeps the authored
route and collision rules unchanged, but bounds retries for the same failed
route-rejoin state to `0.35 s`. It is guarded by a real World/BotController
regression test.

Additional navigation work reuses the static collision broadphase only when it
is backed by the same authored `map.solids` array, and keeps a full-scan
fallback when it is not. The wall-corner recovery fixture reduced collision
sweeps from `11,844` to `374` while retaining the same safe 11-node path.

## Remaining boundary

This proves the formerly stalled rotation terminates locally. It is not a
complete six-rotation balance approval, human 5v5 playtest, browser E2E, or
release/deployment proof.
