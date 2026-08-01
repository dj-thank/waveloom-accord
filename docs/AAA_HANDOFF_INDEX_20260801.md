# AAA / Suravasa-quality continuation index — 2026-08-01

この1枚を最初に開き、必要な担当別文書へ進む。作業境界は
`C:\Users\rambo\projects\kagariai-props`。`C:\Users\rambo\Downloads\SURAVASA` は参照・検査・コピー禁止。
「AAA」は目標であり、候補のローカルPASSは人間のart-direction、権利、playtest、runtime採用、公開を意味しない。

## 現在値

| 領域 | 実測 | 状態 |
|---|---:|---|
| Full source suite | 870/870, exit 0; TAP SHA `EAFABA5471E42F24DB3A5E177AFB4309AB82CA5909E4352C5E39C5C6804DBC43` | local PASS |
| Authored collision manifest | hash `66EB52BB76C0926CFCB1DB4B5E343C067F8C8B6F2294869BE393EDE4573BBC29` | local PASS |
| Automated six-rotation balance | 6/6 BO3, roster 18/18, east/west 0.60/0.40, swap 6/6, ultimate average 3.25 | automated PASS; human 5v5 playtest open |
| Visual reference candidates | 9 original sheets | all candidate-only |
| Tide Marker 01 | 1,156 triangles / 2 calls; WebGL; Tier-1 IoU 0.9123; multi-angle 1.0011 / 1.0394 | candidate local PASS; human/map/runtime gates open |
| Market Awning 01 | strict spec PASS; PBR confidence 0.93; browser candidate PASS at 820 triangles / 3 calls, WebGL, 4 hash-verified views | Tier-1 + real-map fake-cover/sightline + human review open |
| Roof Finial 01 | strict spec PASS; PBR confidence 0.93; browser candidate PASS at 808 triangles / 2 calls, WebGL, 4 hash-verified views | Tier-1 + real-map roof-clearance/sightline + human review open |
| ElevenLabs candidates | 350 technical pass / 257 mastered / 0 runtime admission; Wave 002 added 100 slots | human review open |
| Acoustic triage | 69 reject/regenerate hints / 80 listen-first / 201 normal across 350 rows | ordering signal only |
| ElevenLabs preflight | 8 models; required TTS listed; 111,852 credits after Wave 002; overage=false | preflight only |

## まず読む文書

1. `AAA_CONTINUATION_MASTER_PLAN_20260730.md` — 全体の依存順・不変条件・現在の真実
2. `AAA_CONTINUATION_ADDENDUM_20260801.md` — 最新実測、コマンド、P0/P1 TODO
3. `AAA_EXECUTION_HANDOFF_20260729.md` — map/runtime/audio/modelの過去証跡
4. `AAA_FINALIZATION_TODO_20260729.md` — 作業フロンティア
5. `AAA_MAP_HANDOFF.md` — collision/presentation/route/fake-coverの安全境界
6. `AAA_REMAINING_WORK_PROMPT_PACK_20260801.md` — 残作業TODO、画像候補、ElevenLabs大量生成、音声試聴、map finisher の copy/paste prompt

## Visual / Image → Three.js

- 入口台帳: `work/asset-rush/aaa-v1-pilot/manifest.json`
- Intake: `work/asset-rush/aaa-v1-pilot/qc/SOURCE_CANDIDATE_INTAKE_20260730.md`,
  `SOURCE_CANDIDATE_INTAKE_20260801.md`
- Tide continuation prompt: `AAA_TIDE_MARKER_IMG2THREEJS_CONTINUATION_PROMPT_20260730.md`
- Tide final evidence: `outputs/aaa_tide_marker_tier1_20260801/tide-marker-final-evidence.json`
- Tide review / next gate: `work/asset-rush/aaa-v1-pilot/img2threejs/prop-tide-marker-01/CANDIDATE_REVIEW.md`,
  `NEXT_GATE.md`
- 新規2候補の strict spec 証跡: `outputs/aaa_img2threejs_candidate_specs_20260801.json`
- 新規2候補の browser 証跡: `outputs/aaa_img2threejs_browser_evidence_20260801.json`
- 実マップ配置の安全証跡（2026-08-02）: `outputs/aaa_img2threejs_placement_audit_20260802.json`、
  記録は `outputs/VERIFICATION_RECORD_20260802.md`。awning は PASS、finial は宣言エンベロープ
  0.85m が 0.80m 上限を超えて FAIL。規則は緩めていない。
- `prop-market-awning-01`: `CANDIDATE_REVIEW.md` / `NEXT_GATE.md` / `SAFETY_POLICY.md`。strict spec/PBR と browser candidate PASS（820 triangles / 3 calls、4 view hashes）を記録済み。Tier-1、real-map fake-cover/sightline、human review は未実施。
- `prop-roof-finial-01`: `CANDIDATE_REVIEW.md` / `NEXT_GATE.md` / `SAFETY_POLICY.md`。strict spec/PBR と browser candidate PASS（808 triangles / 2 calls、4 view hashes）を記録済み。Tier-1、roof socket/sightline、human review は未実施。

## ElevenLabs / 音声

- 実行・安全プロンプト: `AAA_ELEVENLABS_AUDIO_FACTORY_EXECUTION_PROMPT_20260730.md`
- 公式API再確認: `docs/research/elevenlabs_audio_api_execution_refresh_20260730.md`
- 候補サマリ: `outputs/audio-factory-20260730/execution-summary.json`
- 技術トリアージ: `outputs/audio-factory-20260730/auto-triage-20260801.json`
- 試聴優先キュー: `outputs/audio-factory-20260730/HUMAN_LISTENING_PRIORITY_QUEUE.csv` / `.json`
- 安全preflight: `outputs/audio-factory-20260801/elevenlabs-preflight-20260801.json`
- Wave 002 handoff: `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`
- Wave 002 manifest / technical / mastered: `outputs/audio-factory-20260801/manifests/aaa-wave-002.json`,
  `outputs/audio-factory-20260801/aaa-wave-002/technical-audit.json`,
  `outputs/audio-factory-20260801/aaa-wave-002/mastered/master-manifest.json`
- 350件すべてについて isolated / combat mix / distance-occlusion を聴き、rights、creative fit、competitive readability、in-engine mix を個別に記録するまで runtime へ移さない。

## 再現コマンド

```powershell
$node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
Set-Location C:\Users\rambo\projects\kagariai-props
& $node --test --test-reporter=dot 'tests/*.test.js'
& $node tools/generate_authored_map_collision.js --check
& $node tools/build_elevenlabs_priority_queue.js
```

秘密情報は表示・保存・ログ化しない。候補の技術PASS、画像生成、ブラウザ証跡だけで採用やAAA判定をしない。
