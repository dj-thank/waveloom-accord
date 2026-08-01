# Overwatch presentation benchmark for Kagariai rc.5

Research date: 2026-07-21 (JST). Scope is Blizzard/Overwatch official articles and patch notes only. ?Source fact? is explicit in the source; ?Design inference? is a neutral, testable Kagariai criterion and not an Overwatch requirement.

## Source facts

| Area | Source fact | Primary source |
|---|---|---|
|Spatial readability|Flashpoint rework targets clearer entrances, open sightlines, less clutter, stronger area distinction, and less confusing diagonal navigation.|[Flashpoint Map Reworks](https://overwatch.blizzard.com/en-us/news/24215719/weekly-recall-flashpoint-map-reworks/) (2025-06-27; accessed 2026-07-21)|
|HUD/ability communication|Kill Feed gained hero ability icons, headshot indicator, environmental/ability-specific icons, and resurrection color coding.|[2017-01 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2017/01/); [2017-05 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2017/05/) (accessed 2026-07-21)|
|Subtitles and color|Subtitle scale, portraits, speaker name, text/background colors and preview are configurable; Group/Alert and health/armor/shield/overhealth colors are customizable.|[Season 3 accessibility](https://overwatch.blizzard.com/en-gb/news/23912175/); [2023-02 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/02/); [2023-04 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/04/) (accessed 2026-07-21)|
|Cursor/chat|PC cursor size, high-contrast chat and chat background opacity are options.|[2023-02 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2023/02/); [accessibility notes](https://overwatch.blizzard.com/en-us/news/patch-notes/there%E2%98%9D%EF%B8%8F/) (accessed 2026-07-21)|
|Spatial audio|Dolby Atmos and Windows Spatial Audio are supported; Windows spatial settings take priority over client settings.|[2018-11 PTR notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ptr/2018/11/) (accessed 2026-07-21)|
|Directional audio|A beta fix made reverb directional toward its source; another mix change increased prominence of third-person footsteps.|[2022-05 beta notes](https://overwatch.blizzard.com/en-us/news/patch-notes/beta/2022/05/); [2020-12 notes](https://overwatch.blizzard.com/en-gb/news/patch-notes/live/2020/12) (accessed 2026-07-21)|
|VFX noise|A 2025 change explicitly reduced ?visual noise? of Lille F?lde.|[2025-06 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/06/) (accessed 2026-07-21)|
|Replay/spectator|Replay Viewer can independently toggle HUD/Kill Feed/health/nameplates, outline strength, FOV, objective sounds, and playback speeds 0.75x/1.75x.|[2020-11 PTR notes](https://overwatch.blizzard.com/en-us/news/patch-notes/ptr/2020/11/) (accessed 2026-07-21)|
|Practice/hit feedback|Practice Range exposes Floating Combat Text; hit markers scale with damage.|[current patch notes](https://overwatch.blizzard.com/en-us/news/patch-notes/there%E2%98%9D%EF%B8%8F/); [2020-04 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2020/04/) (accessed 2026-07-21)|
|Onboarding|New players may face AI opponents for their first five Quick Play matches; unlock requirements were reduced from 10 to 5 matches.|[2025-01 notes](https://overwatch.blizzard.com/en-us/news/patch-notes/live/2025/01/) (accessed 2026-07-21)|

## Benchmark matrix (rc.5 inspection)

Score each case Pass / Partial / Fail / N/A. Thresholds below are Kagariai test inferences, not Blizzard requirements. Save video, screenshots, input logs and audio settings from the same build.

|ID|Criterion|Measurable acceptance|Test/evidence|
|---|---|---|---|
|R1|Objective/entrance readability|4/5 first-time testers identify next entrance within 10 s; median wrong-way turns <=1|Three runs from fixed spawn, HUD on/off, recorded|
|R2|Character silhouette|>=90% class/team identification on 0.5 s frames at 3 distances|Blind image test across skins/lighting|
|R3|Ability state communication|>=90% identify start/end/danger without audio; <=1 miss in 20|Controlled ability scenarios, frame timestamps|
|R4|VFX noise|Center ROI occlusion <=0.25 s/event; <=10% false interpretation|Increase concurrent effects and measure pixels/frames|
|R5|HUD latency/accuracy|>=95% event classification; indicator begins <=100 ms after event|Compare combat event log to captured HUD timestamps|
|R6|Kill/hit feedback|100% classify kill, assist, headshot, environmental and summon deaths in 10 each; zero missing marker/sound|Cross-check video and event log|
|R7|Sound localization|>=90% left/right/front/back/up/down; <=10% footstep confusion|Two headphones, spatial audio on/off, occlusion cases|
|R8|Non-audio fallback|With audio muted, >=90% important warnings recognized via subtitle/visual; speaker/color settings persist|Mute, subtitle variants, color presets|
|R9|Color accessibility|>=90% friend/enemy/warning identification in three color presets and custom colors; no color-only critical signal|Grayscale and low/high luminance screenshots|
|R10|Replay/spectator|UI toggles preserve causal tracking; event time error <=0.2 s at 0.75x/1.75x|Three observers reproduce same replay|
|R11|Onboarding/training|4/5 first-time users explain and execute 3 basic abilities; major HUD recognized within 5 matches|Measure time, retries and skips|
|R12|Animation/state transitions|<=5% state misclassification; zero dropped frames in 60 fps capture|10 abilities under normal, hit, interrupt conditions|

## Top 10 current-product inspection questions

1. Can a first-time player identify the next objective entrance within 10 seconds?
2. Can enemy hero silhouette and movement state be identified within 0.5 seconds?
3. Do concurrent VFX obscure enemy, objective or ally health in the center of the screen?
4. Can ability start/end, danger area and cancellation be understood with audio muted?
5. Does the Kill Feed distinguish kills, assists, headshots, environmental and summon deaths?
6. Do hit markers, damage numbers and elimination sounds match the actual event?
7. Do footsteps, weapons and warnings localize correctly in six directions?
8. Do subtitle, custom-color, cursor and chat settings persist in every mode?
9. Can replay/spectator UI, outline, sound and speed toggles preserve causal understanding?
10. Can a first-time user explain the HUD and execute three abilities within five matches?

## Interpretation and limits

Official sources document Overwatch implementation and intent, but do not define Kagariai pass/fail thresholds. Numeric thresholds above are design inferences for repeatable rc.5 inspection. Unmeasured cases are ?not verified,? not Fail. Passing does not establish Overwatch equivalence, public-network E2E, or real-user quality.
