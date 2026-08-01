# Kagariai Flashpoint Rules v0.1

Status: implementation target. The machine-readable contract is
`shared/data/mode_flashpoint.json`.

This is an original Kagariai ruleset and five-site ordering for the original
Oshioi harbour layout. It does not copy another game's map geometry, landmarks,
routes, textures, or assets.

## 1. Compatibility boundary

Flashpoint is a new mode, not a reinterpretation of the frozen single-area
Shioura mode.

- The existing `docs/mode_shioura_rules_v0.2_FROZEN.md` and
  `shared/data/mode_shioura.json` remain the source of truth for Shioura.
- Implementations **MUST NOT modify the frozen Shioura contract** to enable
  Flashpoint.
- Flashpoint reuses Shioura's current site-local capture, progress, overtime,
  presence, and respawn numeric semantics. It changes the match coordinator
  around that site-local engine.
- This document and `mode_flashpoint.json` are an implementation target. The
  mode must remain disabled until the server, client, map, protocol, reconnect,
  and deterministic tests satisfy this contract.

## 2. Match structure

Flashpoint is one **single continuous match**, not a BO3 and not a first-to-three
mode nested inside BO3 rounds.

- Two teams of five use the existing 1 frontline / 2 damage / 2 support roster.
- The map exposes exactly five stable site IDs in this order:
  `shiogama`, `mizuichi`, `kado`, `ami`, `kazami`.
- `shiogama` is always the opening active site.
- A team wins the match when its `siteScores` entry first reaches 3.
- At most five sites can complete. A completed site can never be selected again
  in the same match (`no_repeat_in_match`).
- There is one 30.0-second match setup before the opening site becomes playable.
  Site changes do not run another setup, round-result, side-swap, or spawn-room
  reset.
- During the outer `match.state=SETUP`, the Flashpoint coordinator may already
  identify `shiogama` as `activeSiteId`, but the site-local capture engine
  remains sealed. Capture can advance only after the outer match enters
  `ACTIVE`. The canonical `match.state` and `match.stateT` carry this one setup
  countdown; setup is not a repeatable Flashpoint phase.
- Physical team sides remain fixed for the continuous match.
- The third site win ends the match immediately. The server does not select a
  pending site and does not run a final 12-second transition.

The five-site rule is therefore 3-0, 3-1, or 3-2. A site win is not a nested
round win.

## 3. Site-local capture semantics

Only the site referenced by `activeSiteId` may evaluate presence or advance its
capture state. Pending, eligible, and completed sites are locked.

Each site uses a 7.0 m horizontal radius, 5.0 m height, and 0.2 m exit
hysteresis. The vertical presence interval is from 0.5 m below the authored
center to 5.0 m above it. A player must be alive. Invulnerable or intangible
players may be shown inside the volume but do not contribute effective presence.
Membership is keyed by site ID and cleared whenever a new site activates, so
hysteresis from the previous site cannot leak into the new site.

The values below are copied without alteration from the frozen Shioura capture
engine:

| Rule | Value |
|---|---:|
| Capture gauge maximum | 100.0 pt |
| Capture rate, 1 player | 16.67 pt/s |
| Capture rate, 2 players | 22.22 pt/s |
| Capture rate, 3+ players | 27.78 pt/s |
| Empty-gauge decay delay / rate | 2.0 s / 10.0 pt/s |
| Simultaneous-full setback | 99.0 pt |
| Owned progress | 1.2%/s, integer tenths |
| Site cap | 480.0 s |
| Overtime initial grace | 5.0 s |
| Overtime absent decay / enemy regen | 2.0/s / 1.0/s |
| Overtime cap shrink | -1.0 s every 10.0 s, minimum 2.0 s |
| Overtime respawn penalty | +3.0 s, then +6.0 s after 30.0 s |
| Respawn base / wave | 10.0 s / 2.5 s |

Capture, ownership, contest, progress, overtime, cap resolution, sudden death,
and simultaneous-full behavior are evaluated by the current site-local state
machine. A site result becomes immutable once resolved. Its winning team is
awarded exactly one site point before the server selects the next site.

## 4. Authoritative lifecycle

The coordinator has three match-level phases: `active`, `transition`, and
`complete`. The authoritative state always carries `activeSiteId`,
`pendingSiteId`, and `completedSiteIds`.

### Active

- `activeSiteId` is one uncompleted site.
- `pendingSiteId` is `null`.
- The active site's capture engine advances.
- The opening state is `activeSiteId="shiogama"`,
  `pendingSiteId=null`, `completedSiteIds=[]`, and `siteScores=[0,0]`.

### Site resolution

The server atomically:

1. freezes the resolved site's final capture state and result;
2. appends its ID once to `completedSiteIds`;
3. increments the winning team's score once;
4. either completes the match at 3 points or invokes the selector exactly once.

Duplicate ticks, events, reconnects, or resyncs must not award a second point.
Overtime must resolve through the site-local engine before this operation.

### Transition

For a non-terminal site result:

- phase becomes `transition`;
- `activeSiteId` becomes `null`;
- the selector result becomes `pendingSiteId`;
- capture is disabled everywhere for exactly **12.0 seconds**;
- `transitionRemainingSec` counts down to zero on the server;
- at zero, the pending site becomes active atomically, `pendingSiteId` becomes
  `null`, site membership is cleared, and the new site-local engine starts from
  its neutral state.

### Complete

When either score reaches 3:

- phase becomes `complete`;
- `winnerTeam` is sticky;
- both `activeSiteId` and `pendingSiteId` are `null`;
- no selector call, capture tick, site transition, or further score award is
  allowed.

## 5. Continuous simulation and clocks

A site transition is not a round reset. Simulation continues during all 12.0
seconds.

The following state is preserved without teleportation or multiplication:

- all player identities, heroes, teams, transforms, health, alive/dead state,
  statuses, statistics, input ownership, and weapon state;
- ultimate charge at a 1.0 multiplier;
- ability cooldowns and active casts;
- projectiles, zones, and barriers;
- deaths already in the respawn queue and their original timestamps;
- team-to-physical-side assignments.

Only site-local owner, capture gauges, owned progress, overtime, presence
membership, and the site-local clock reset for the newly activated site.

`matchClock` and `respawnClock` are whole-match clocks. They are monotonic across
active sites and transitions and must never reset or move backwards at a site
change. `siteClock` is monotonic only within one site activation and resets when
the next site activates. Events carry separate `matchTick`, `matchTimeSec`, and
`siteTimeSec` fields; a site-local timestamp must never overwrite the
whole-match event timestamp.

Respawn waves continue during transition. Resetting the respawn subsystem,
rewriting death times, or deriving respawns from a reset `siteClock` violates
this contract.

## 6. Deterministic server selector

The selector is server-authoritative and uses policy
`dedicated-seeded-weighted-choice`, selector version 1. It runs only after the
completed site's point has been awarded and only when neither team has 3 points.

### 6.1 Candidate filtering

1. Start with the five map site IDs in their authored stable order.
2. Remove every ID in `completedSiteIds`.
3. Apply diagonal avoidance using these original opposite-corner pairs:
   `mizuichi <-> kazami` and `kado <-> ami`.
4. If the previous site has an opposite-corner candidate and at least one
   non-diagonal candidate also remains, exclude the opposite candidate.
5. If the opposite candidate is the only eligible candidate, allow it. The
   diagonal rule must never leave an otherwise valid match without a candidate.

`shiogama` is central and has no diagonal partner.

### 6.2 Capped losing-team travel bias

The trailing team is determined from `siteScores` after the completed site's
award. Its physical side comes from the fixed team-side assignment. Tied scores
have no trailing team and every remaining candidate receives weight 1.

For a trailing team, travel is the map-authored value
`routesBySite.<siteId>.<losingSide>.front.measuredLengthM`. The selector never
uses live player positions, pathfinder timing, a client value, or a combat RNG
sample.

For the post-diagonal candidate pool:

```text
eligibleMeanTravelMeters = mean(candidate travel for the losing side)
rawTravelBias = (eligibleMeanTravelMeters - biasTravelMeters)
                / eligibleMeanTravelMeters
appliedTravelBias = clamp(rawTravelBias, -0.25, +0.25)
weight = 1 + appliedTravelBias
```

Thus every weight stays in `[0.75, 1.25]`. The cap is a modest travel
probability bias, not a guaranteed catch-up site, combat buff, capture-rate
change, spawn teleport, or score adjustment.

Each candidate audit record contains:

```text
siteId
travelMeters { east, west }
biasTravelMeters number | null
rawTravelBias
appliedTravelBias
weight
```

For tied scores, `biasTravelMeters` and `eligibleMeanTravelMeters` are `null`,
both bias values are zero, and weight is 1.

### 6.3 Dedicated deterministic draw

The draw uses only `matchSeed` and `selectionIndex`. It must not consume or
advance the RNG used by weapons, bots, abilities, or other simulation systems.
The first selection uses index 0; the index increments exactly once after every
successful selection.

The version-1 sample algorithm is fixed:

```text
seed32(number) = finite number converted to uint32
seed32(other):
  hash = 0x811c9dc5
  for each Unicode code point in String(seed):
    hash = imul(hash XOR codePoint, 0x01000193)

value = seed32(matchSeed) XOR imul(selectionIndex + 1, 0x9e3779b9)
value = imul(value XOR (value >>> 16), 0x21f0aaad)
value = imul(value XOR (value >>> 15), 0x735a2d97)
value = value XOR (value >>> 15)
sample = uint32(value) / 4294967296
```

Candidates remain in stable map order. Compute
`threshold = sample * totalWeight` and choose the first candidate whose
cumulative weight is strictly greater than `threshold`. Identical inputs must
produce byte-equivalent audit values and the same chosen ID on replay. An empty
candidate pool before a team reaches 3 is an invalid server state and must fail
closed.

The selection audit includes `policy`, `selectorVersion`, `selectionIndex`,
`previousSiteId`, `losingTeam`, `losingSide`, `travelBiasCap`,
`eligibleSiteIdsBeforeDiagonal`, `excludedDiagonalSiteIds`,
`eligibleMeanTravelMeters`, `sample`, `totalWeight`, `candidates`, and
`chosenSiteId`.

## 7. Protocol v6 and canonical state

Flashpoint changes the meaning and cardinality of the objective state. It
therefore requires **protocol v6** (snapshot schema 1) before enablement. A v5
client must be rejected during welcome, before it receives a Flashpoint
snapshot; silently presenting a five-site match as the old singleton objective
is not compatible behavior.

Every full snapshot contains canonical Flashpoint state with:

```text
phase
activeSiteId
pendingSiteId
completedSiteIds
siteScores
transitionRemainingSec
activationIndex
selectionIndex
winnerTeam
lastSelection
sites
```

The surrounding match snapshot also carries `state`, `stateT`,
`matchClockSec`, and `respawnClockSec`. While `state=SETUP`, capture remains
locked even though the opening site ID is already known.

`sites` contains exactly the five stable IDs. Each entry contains `siteId`,
`phase`, `capture`, and `result`. A site's phase may be `eligible`, `pending`,
`active`, or `completed`; the match-level invariants decide which combinations
are legal. Completed results remain present for the rest of the match.

The legacy-shaped top-level `objective` may exist only as a derived projection
of the active site's capture state. It is `null` during transition and after
completion. It is never a second mutable source of truth.

Each player carries canonical `onObjectiveId`. Compatibility `onPoint` is
derived as `onObjectiveId === activeSiteId`; presence at an inactive site cannot
set it.

Projectiles and all preserved player/cooldown/ultimate/respawn state remain in
their existing authoritative snapshot sections. A site change must be visible
as one internally consistent snapshot: no frame may show the old active site
with the new pending/completed state or vice versa.

## 8. Events, join, reconnect, and resync

All objective events add `siteId`, `activationIndex`, `matchTick`,
`matchTimeSec`, and `siteTimeSec`. The coordinator emits, in deterministic
order as applicable:

1. `flashpoint_site_completed`;
2. `flashpoint_site_selected`;
3. `flashpoint_transition_started`;
4. `flashpoint_site_activated`;
5. `flashpoint_match_completed`.

Events are supplemental presentation and telemetry records, not canonical
state. `lastSelection` in the full snapshot carries the complete selector audit.

A fresh join, resumed connection, event-ring overflow recovery, or explicit
resync must reconstruct the current active/pending/completed sites, scores,
transition timer, results, and selector sequence from one full snapshot without
receiving earlier events. Replaying an event after snapshot recovery must not
duplicate a site result or score.

Identity-preserving reconnect is a separate session protocol concern. This
ruleset requires that, when such a resume is supported, it restore the same
player object and its preserved ultimate, cooldowns, projectiles, death/respawn
state, and input sequence; a fresh join must not be described as a reconnect.

## 9. Required acceptance cases

Before enabling Flashpoint, automated tests must cover:

- exact five IDs, fixed `shiogama` opening, one active site, and inactive-site
  capture lock;
- 12.0-second boundary behavior and atomic pending-to-active activation;
- 3-0, 3-1, and 3-2 wins with no completed-site repeat;
- site completion during normal progress, overtime expiry, retake, sudden
  death, and cap resolution;
- no stale presence/hysteresis on activation;
- preservation of players, ultimates, cooldowns, projectiles, zones, barriers,
  deaths, and respawn waves across transitions;
- monotonic match and respawn clocks across multiple site activations;
- deterministic replay for tied and trailing scores, the 0.25 travel cap,
  diagonal exclusion, sole-diagonal fallback, stable ties, and combat-RNG
  independence;
- full-snapshot-only join/resync during active, transition, and complete phases;
- protocol v5 rejection and protocol v6 snapshot validation;
- all five sites and both physical sides being collision-valid and traversable
  in the authoritative map, not merely present as metadata.
