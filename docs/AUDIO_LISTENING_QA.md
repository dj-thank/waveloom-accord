# Audio listening QA (rc.5)

`tools/audio_quality_audit.js` performs deterministic, local-only structural and acoustic checks over every manifest entry. It validates RIFF/WAVE PCM16 mono format, source/runtime linkage, duration, SHA-256, peak, RMS, DC offset, clipping, edge fade ratios, zero-crossing rate, and a lightweight spectral-distinctness proxy. Results are written to `outputs/rc5-audio-evidence/audio-quality-audit.json`.

The generated `AUDIO_LISTENING_SCORECARD.md` contains one unchecked row per manifest ID for identity, loudness, fatigue, spatial/role clarity, headphones, browser, and volume. It is explicitly **NOT HUMAN-VERIFIED**: automated metrics cannot establish audibility, fatigue, spatial placement, or contextual role clarity. A reviewer must listen to all 90 source/runtime pairs and record notes before making a human QA claim.

Run from the release tree:

```text
node tools/audio_quality_audit.js
node --test tests/audio_quality_audit.test.js
```

Warnings (for example clipping or unusual DC offset) are recorded per asset and aggregated; they do not silently become a human approval.
