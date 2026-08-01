# BOT navigation and combat-intelligence QA

Updated: 2026-07-21

## Runtime contract

- The authored `front`, `cloister`, and `shallows` routes in `shared/data/map_oshioi.js` are the strategic lanes. The east-side routes are mirrored for the west team.
- Frontline and support bots reinforce `front`; damage bots may use a bounded side lane. A competitive team is always one frontline, two damage, and two support heroes.
- The shallows route follows every 0.5 m stair tread. Route nodes never encode a same-XY vertical teleport.
- Recovery uses deterministic, multi-level ground A*. Every edge is checked against floor support, the configured step/drop limit, standable full-capsule clearance, and a swept-cylinder collision query. The normal 8 m search window retries at 12 m only when a large building requires an outside detour; several progress-aware candidates are proved reachable before selection.
- A recovery path owns movement until it is complete. Formation steering and mobility abilities cannot overwrite it, combat-lane transit is not reversed toward a delayed tank, and a waypoint may only be skipped when the swept shortcut is safe.
- Stalled bots jump after 0.7 s and replan after 1.2 s, except on authored stair treads where traversal keeps movement ownership. Near a ledge they predict their stopping path, brake for 0.55 s, and reject airborne, stair, or unsafe mobility impulses. A blocked combat advance retains a short capsule-swept detour while aim and fire remain active.
- Frontline bots contest only with enough nearby allies and support; they retreat when wounded or isolated. Damage bots preserve a bounded crossfire angle behind the frontline. Support bots prioritise wounded allies, keep useful ability range, and fall back behind the tank.
- Bots retain a three-second last-seen position and a 2.5-second team focus callout. Lost targets are investigated through bounded capsule-swept detours; bots do not receive live wall vision or fire at an unseen target.

## Automated acceptance

The navigation audit runs the authoritative world, actual bot controller, collision system, role-valid rosters, and mobility abilities. It fails on:

- out-of-bounds or void movement;
- a sustained fall or a harmful landing below the playable combat deck;
- requested movement with less than 0.5 m progress for 2.5 s;
- recovery without 2 m of progress within 5 s;
- more than 8 s without movement, objective presence, damage, healing, or a combat contribution.
- more than 30 s without objective presence, effective damage/healing, or a tactical ability contribution even if the bot keeps wandering or firing harmless shots;
- an authoritative environmental/void death, including a death observed immediately before respawn-state reset;
- recovery starts that are not accounted for as completed, death/round-interrupted, or explicitly active at capture end.

Final matrix:

| Seed | Rotation | Simulated | Bots | Falls | Violations | Recovery accounting (complete/interrupted/active) | Max inactive |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 20260713 | 0 | 180 s | 10 | 0 | 0 | 317 complete / 0 interrupted / 0 active | 6.84 s |
| 20268632 | 1 | 180 s | 10 | 0 | 0 | 233 complete / 2 round-or-death interrupted / 0 active | 4.94 s |
| 20276551 | 2 | 180 s | 10 | 0 | 0 | 247 complete / 0 interrupted / 1 active | 3.03 s |

All 800 recovery starts are explicitly accounted as 797 completions, two death/round interruptions, and one still-active, progressing recovery at capture end. Environmental deaths were 0/64 total deaths. Maximum tactical inactivity was 23.65 s, below the 30 s threshold. Across the matrix this is 30 bot instances and 5,400 simulated bot-seconds (3,949.36 active-round bot-seconds), covering all 18 heroes in exact 1/2/2 teams.

## Reproduction

```powershell
node --test tests/bot_navigation.test.js tests/bot_navigation_audit.test.js tests/bot_roster.test.js tests/hero_bots.test.js tests/physics.test.js tests/map_collision.test.js
node tools/bot_navigation_audit.js --seed 20260713 --match 0 --seconds 180 --output outputs/rc5-bot-evidence/bot-navigation-audit-final-seed-20260713-match-0.json
node tools/bot_navigation_audit.js --seed 20268632 --match 1 --seconds 180 --output outputs/rc5-bot-evidence/bot-navigation-audit-final-seed-20268632-match-1.json
node tools/bot_navigation_audit.js --seed 20276551 --match 2 --seconds 180 --output outputs/rc5-bot-evidence/bot-navigation-audit-final-seed-20276551-match-2.json
node tools/headless.js --matches 3 --quiet --json
```

## Evidence boundary

This proves deterministic local simulation behaviour for the tested seeds and exact checked-in map. It is not proof of human-level planning, every possible seed, public-network play, or a ten-human playtest. BOT intelligence remains explainable game AI rather than a learned model.
