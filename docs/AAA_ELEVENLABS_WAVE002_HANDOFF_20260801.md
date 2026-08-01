# ElevenLabs Wave 002 handoff — 2026-08-01

This is the post-generation handoff for the second 100-slot candidate-only
sound-effects wave. It is intentionally separate from the Local DSP runtime
catalog and does not grant rights, creative approval, mix approval, or runtime
admission.

## Result

- Manifest: 100 deterministic slots, estimated ceiling 2,400 credits, actual
  execution `planned=100`, `completed=100`, `retries=0`, `exit=0`.
- Taxonomy: ambience/loops 24, physical Foley 24, movement/traversal 20,
  objective/UI 16, ability/impact 16.
- Technical audit: 100/100 passed; every raw output has a manifest SHA-256,
  decodes as MP3, and satisfies the requested SFX duration/sample-rate rules.
- Mastering: 100/100 attenuation-only derivatives passed; raw provider files
  remain immutable.
- Secret-safe postflight: 8 models listed, 111,852 credits remaining,
  `overageEnabled=false`; the key is not present in the report.
- Combined catalog summary: 350 candidates, 350 technical pass, 257 mastered,
  0 runtime admissions.

## Evidence paths and hashes

| Evidence | Path | SHA-256 |
|---|---|---|
| Final provider manifest | `outputs/audio-factory-20260801/manifests/aaa-wave-002.json` | `381657ABC5081B9D92FD17B75FEC1A049E526FE7128ADD1A1CB165BBD06BF0E6` |
| Technical QC | `outputs/audio-factory-20260801/aaa-wave-002/technical-audit.json` | `B616CD79F02CC714F450487F28F23C93A41DDFE9581CDC802D7568CD435C8D86` |
| Master report | `outputs/audio-factory-20260801/aaa-wave-002/mastered/master-manifest.json` | `1E184C7B0E7DEBC35ADA0F8D923506A9AD5D816F154CEEE812E73C843711CACB` |
| Combined summary | `outputs/audio-factory-20260801/execution-summary-wave002.json` | `C1DF84D1E01099781AF850419D989FC91CED1FA1A7E80F79BCB54B97DC4A6DFA` |
| Acoustic triage | `outputs/audio-factory-20260801/auto-triage-20260801.json` | `4A0A9DACB8F58F6631CBAE9FE8FE921910AAD932B45E8D791C34E1D533CBAD38` |
| 350-row priority JSON | `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.json` | `59B1DCA9E56870D97E3B03F00616DE905FEEEC2B0B870DA0F7B7E8592A86A145` |
| 350-row priority CSV | `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv` | `33CF3364BC2388A7A7DCD5CEB5CD1BA91FB0AE41F0963E5248CDC10BB1E35F24` |
| Post-wave preflight | `outputs/audio-factory-20260801/elevenlabs-preflight-post-wave002.json` | `0C6569832F6DBF88C3FA33BA2624B9AB48B51568631311F53E8C7C7062153047` |

## Triage state

The combined 350-row triage decoded `350/350` and ordered the work as:

- `REJECT_OR_REGENERATE_REVIEW`: 69
- `LISTEN_FIRST`: 80
- `NORMAL_LISTENING_QUEUE`: 201

The flags are ordering hints only. The human fields in the 350-row queue are
blank by design. Review identity, distance readability, mask resistance, loop
seam, duplication, noise/clipping, rights, creative fit, competitive
readability, in-engine mix, and adoption separately.

## Resume commands

```powershell
$node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
$ffprobe = 'C:\Users\rambo\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-8.1.2-full_build\bin\ffprobe.exe'
Set-Location C:\Users\rambo\projects\kagariai-props

# deterministic authoring and billable dry-run (no provider request); use a
# new manifest path for a new wave, never overwrite the completed manifest
& $node tools/author_elevenlabs_wave002_manifest.mjs --out outputs/audio-factory-20260801/manifests/aaa-wave-002.json
& $node tools/elevenlabs_audio_factory.js --manifest outputs/audio-factory-20260801/manifests/aaa-wave-002.json --output outputs/audio-factory-20260801/aaa-wave-002 --dry-run --max-assets 100 --max-estimated-credits 2400

# raw-byte and stream audit
& $node tools/audit_elevenlabs_factory_batch.js --manifest outputs/audio-factory-20260801/manifests/aaa-wave-002.json --root outputs/audio-factory-20260801/aaa-wave-002 --ffprobe $ffprobe --out outputs/audio-factory-20260801/aaa-wave-002/technical-audit.json
```

Never put `ELEVENLABS_API_KEY` on a command line or in a manifest. Keep every
Wave 002 output under `outputs/audio-factory-20260801/aaa-wave-002/` and keep
`adoptionState` / runtime admission candidate-only until human and rights gates
are independently complete.
