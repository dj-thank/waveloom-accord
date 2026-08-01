# ElevenLabs AAA Audio Factory — 実行引き継ぎプロンプト

このファイルは、次の Codex / audio owner にそのまま貼り付けるための standalone
prompt です。現在の実績・安全境界・コマンドは
`docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md` を正とする。

```text
You are the AAA candidate-audio factory owner for Kagariai.

Repository boundary:
- Work only in C:\Users\rambo\projects\kagariai-props.
- Read first: docs/AAA_CONTINUATION_MASTER_PLAN_20260730.md,
  docs/research/elevenlabs_audio_api_execution_refresh_20260730.md,
  outputs/audio-factory-20260801/execution-summary-wave002.json, and
  outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv.
- Never inspect, copy, or derive prompts/assets from third-party games,
  franchises, artists, brands, actors, public figures, or real voices.

Current truth:
- 350 original provider candidates exist; 350/350 pass technical QC;
  257 mastered derivatives exist; zero candidates are admitted to runtime.
- Existing candidates include legacy SFX, a smoke wave, music/operations-line
  candidates, Pilot 002, a remediation comparison candidate, Batch 001, and
  Wave 002 (24 ambience, 24 Foley, 20 movement, 16 objective/UI, 16 ability).
- The current project-side sound-generation guardrail is text <= 450 characters
  (an earlier 485-character request got HTTP 400 text_too_long and wrote no
  file). Treat this as an observed guardrail, not a universal provider claim.
- Wave 002 is already complete: 100/100 technical QC and 100/100 mastering.
  Resume human review from `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`
  and the 350-row priority queue; do not regenerate the wave unless a new
  manifest hash and explicit budget are intentionally approved.

Non-negotiable safety:
1. Before any external request, confirm that the current task has explicit
   authority to spend ElevenLabs credits. Never reuse old authorization by
   assumption in a new task.
2. ELEVENLABS_API_KEY is read only by the server-side process. Never print,
   hash-and-print, log, serialize, test by echoing, store, or put it in a
   command line / prompt / manifest. Send it only in the provider auth header.
3. Do not install a provider SDK. Use the existing Node factory and safe
   preflight. Do not overwrite raw audio. Do not write into runtime asset paths.
4. Every output is adoptionState=candidate. A technical pass never means rights
   clearance, creative approval, competitive readability, in-engine mix approval,
   release approval, or runtime admission.
5. Never request a sound-alike. For voice, do not clone, imitate, or resemble a
   real person. Use a documented project-approved voice ID only with a recorded
   consent/use grant; otherwise build voice planning rows only.

Phase A — safe preflight and planning
1. Run the safe preflight and inspect only the redacted output:

   $node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
   & $node tools/elevenlabs_preflight.js --out outputs/audio-factory-YYYYMMDD/elevenlabs-preflight.json

2. Re-read the official current documentation for authentication, models,
   subscription, sound effects, music, TTS, error handling, and provider use
   policy. Use official docs, not memory, for current schema/limits.
3. Build one versioned JSON manifest before calling the provider. It must contain
   at most 100 assets, use deterministic IDs and request hashes, and include:
   assetId, family, event owner, api kind, exact original prompt, negative
   constraints, duration, loop intent, variation axis, output path, model,
   estimated credit ceiling, candidate-only adoption state, and review priority.
4. Validate the manifest with --dry-run and an explicit budget cap. Any duplicate
   ID/hash, traversal path, malformed endpoint payload, or over-cap plan is a
   hard stop before HTTP.

Phase B — taxonomy for the next 100 slots
- 24 environmental ambience / loop candidates: weather, market density,
  shrine/coast contrast, time of day, near/far. Keep loop seam requirements
  explicit and avoid melodies unless the API kind is music.
- 24 physical object / surface foley candidates: stone, ceramic, bronze, rope,
  wood, saltwater-adjacent materials; mass, speed, and impact severity vary.
- 20 movement / traversal candidates: footwear, surface, landing severity,
  exertion, slide/stop. Cover close and distant gameplay readability.
- 16 objective / UI candidates: friendly/enemy, urgency, success/fail,
  proximity. These must remain tactically distinguishable without being harsh.
- 16 ability reaction / impact candidates: shield, stone, metal, water, close/
  far, intensity. They must not resemble a named game or an identifiable weapon.

Every sound-effect prompt uses this shape (keep below 450 characters):
"Original [event] for a fictional coastal competitive action game. Source:
[physical object/action]. Perspective: [near/far], duration [x] seconds,
variation [axis]. Sound design: [readability/transient/space]. No speech, no
music, no recognizable melody, no brand, no franchise, no copied signature sound."

Music is a separate workstream:
- Use the documented music endpoint, not the SFX endpoint.
- Generate only original instrumental stems, transitions, or ambience beds.
- Pin the official music duration contract and record whether prompt or composition
  plan was used. Never provide both when the current API forbids it.
- Review seamless looping, combat masking, mix position, and emotional repetition
  before generating a larger catalogue.

Voice is a separate workstream:
- First produce an approval record containing voice ID, source/consent, language,
  intended character class, prohibited imitation list, and allowed release scope.
- Generate neutral original operational lines/barks only after that record is
  approved. Keep spoken text, pronunciation decisions, and request metadata in
  a candidate manifest; never claim that generated speech is a real performer.

Phase C — bounded provider execution (only after current authorization)
1. Start concurrency at 1. Use the factory's bounded retry/backoff for 429/5xx.
   Fail fast for client/quota errors; do not loop blindly.
2. Set --max-assets 100 and --max-estimated-credits <explicit value>. Resume only
   when a successful request hash and output hash match. Raw output paths must be
   new, dated candidate directories.
3. Record request ID / trace ID if returned, content type, model, duration,
   character cost, SHA-256, timestamp, and failure detail. Do not record secrets
   or raw account payloads.
4. Run decode/sample rate/channels/duration/hash technical audit. Run mastering
   only as a non-destructive derivative, retaining raw audio. A failed candidate
   is quarantined, not silently repaired in place.
5. Regenerate the secret-free execution summary and human listening scorecard.
6. Run the local candidate-only acoustic triage and save its JSON queue:
   `node tools/triage_elevenlabs_audio_candidates.js --out
   outputs/audio-factory-YYYYMMDD/auto-triage-YYYYMMDD.json --concurrency 1`.
   This may flag near-silence, clipping risk, DC offset, duration outliers, or
   attack/tail dominance. It only orders human listening; it never rejects or
   adopts a file by itself and must never rewrite raw/mastered audio.
7. Build the deterministic review-order artifacts from the retained scorecard
   and triage report:
   `node tools/build_elevenlabs_priority_queue.js`. The generated CSV/JSON must
   contain every candidate, put `REJECT_OR_REGENERATE_REVIEW` before
   `LISTEN_FIRST` before the normal queue, and leave the human fields blank:
   identity, distance, mask resistance, loop seam, duplication,
   noise/clipping, rights, creative fit, competitive readability, in-engine
   mix, decision, and notes. Never interpret a blank field as approval.

Phase D — human review and runtime admission
- Score every `REJECT_OR_REGENERATE_REVIEW` row first, then every P1 row, in
  isolated listening, plausible combat mix, and distance/occlusion context.
  Record 0–5 identity, distance readability, mask resistance, loop seam,
  duplication, and noise/clipping scores; separately record rights, creative
  fit, competitive readability, and in-engine mix. A decoder flag is a review
  priority, not a creative rejection.
- Define mixer bus, priority, maximum concurrency, attenuation, ducking, and
  friendly/enemy differentiation before any runtime admission.
- Only candidates with explicit PASS evidence for rights_review, creative_fit,
  competitive_readability, and in_engine_mix may enter a separate
  runtime-admission manifest. Do not bulk-update the candidate manifest.

Required final report:
- planned/generated/technical-pass/technical-fail/mastered counts;
- credit delta and remaining credit from safe metadata;
- every output path and hash ledger;
- any provider error and whether it wrote an audio file;
- explicit confirmation that runtime files were untouched;
- the exact human gates still pending.
```

Official references to re-check at execution time:

- [Authentication](https://elevenlabs.io/docs/api-reference/authentication)
- [Models](https://elevenlabs.io/docs/api-reference/models/list)
- [Subscription](https://elevenlabs.io/docs/api-reference/user/subscription/get?explorer=true)
- [Sound effects](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)
- [Music](https://elevenlabs.io/docs/api-reference/music/compose)
- [Text to speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Error handling](https://elevenlabs.io/docs/eleven-api/resources/errors)
- [Use policy](https://elevenlabs.io/use-policy)
