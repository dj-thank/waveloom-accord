# ElevenLabs Audio API — official execution refresh

Updated: 2026-08-01 (official-page recheck)

Scope: documentation refresh only. No API key was read, no provider request was
sent, and no audio was generated in this pass.

## Confirmed official capability map

| Candidate family | Official request path | Use in this program | Important contract |
|---|---|---|---|
| Full BGM / controlled music | POST /v1/music | Original instrumental BGM, transitions, and longer music candidates | Send either a text prompt or a composition plan, never both. Prompt length is at most 4,100 characters; prompt-driven duration is 3,000–600,000 ms. [Compose music](https://elevenlabs.io/docs/api-reference/music/compose) |
| SFX / Foley / ambience | POST /v1/sound-generation | Original weapon vocabulary, abilities, UI, movement, ambience, and stingers | text is required. duration_seconds is 0.5–30; looping is available for eleven_text_to_sound_v2; prompt_influence is 0–1. [Create sound effect](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) |
| Spoken announcements / barks | POST /v1/text-to-speech/{voice_id} | Japanese operations lines, temporary original character barks, accessibility variants | Resolve and record an allowed voice_id, model, text, output format, and pronunciation treatment before generation. [Create speech](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) |

The SFX documentation explicitly positions the endpoint for game effects and
Foley. It also says full music production belongs on the Music API; do not use
short SFX generation as a substitute for the BGM pipeline.
[Sound effects overview](https://elevenlabs.io/docs/overview/capabilities/sound-effects)

For structured BGM, use a Music v2 composition plan after a small prompt-based
pilot. The official guide describes an ordered list of up to 30 chunks, with
3–120 seconds per chunk and 3 seconds–10 minutes total duration; the first
chunk establishes the overall style. A prompt and a composition plan are
mutually exclusive. [Composition plans](https://elevenlabs.io/docs/eleven-api/guides/how-to/music/composition-plans)

## Security and cost boundary

ELEVENLABS_API_KEY is a server-side secret only. Send it in the xi-api-key
header; never expose it in browser code, manifests, screenshots, logs, prompts,
or generated assets. Create a restricted key for the work: endpoint scope,
credit quota, and IP allowlist are official controls.
[API authentication](https://elevenlabs.io/docs/api-reference/authentication)

Before every non-dry-run wave:

1. Query the allowed models/access on the server and write the selected model
   IDs into the immutable request manifest.
2. Set a wave-wide credit ceiling and a per-family ceiling.
3. Start at smoke (3), then pilot (24), then one 100-item batch. Do not launch
   the next gate automatically just because the prior request succeeded.
4. Store request_hash, asset_id, provider model, endpoint, output format,
   request ID, trace ID, character cost if present, byte hash, duration, and
   QC state. The official SDK/API documentation identifies character-cost,
   request-id, and x-trace-id as useful response metadata.
   [API introduction](https://elevenlabs.io/docs/api-reference/introduction/)

## Reliable bulk-worker contract

The candidate generator must be manifest driven and resumable:

- One asset slot has one deterministic request_hash; if a matching successful
  response with the same SHA-256 exists, skip it rather than regenerate it.
- A 400/401/402/403/404/422 is terminal for that item until the manifest or
  account configuration is intentionally corrected. Do not blindly retry.
- For 429 rate_limit_exceeded / system_busy, use bounded exponential backoff
  plus jitter. For concurrent_limit_exceeded, stop scheduling new work and wait
  for an in-flight request to finish instead of multiplying workers. Retry
  transient 5xx only a bounded number of times.
  [Errors](https://elevenlabs.io/docs/eleven-api/resources/errors) and
  [429 details](https://elevenlabs.io/docs/help-center/technical/api-error-code-429)
- On the first non-retryable failure, halt scheduling, drain active workers,
  preserve partial metadata, and return a controlled failure. Never leave
  orphan assets marked as accepted.
- Treat every returned file as candidate until technical, creative,
  competitive-readability, rights, and human review are independently green.

## Rights and voice boundary

All prompts must request new fictional material. Never reference existing games,
artists, actors, characters, brands, song titles, recordings, or recognizable
voice identities. Voice work is limited to a licensed library voice or a
documented original/consented performer. Do not create, clone, or imitate a
real person's voice without the provider-required consent and a project-side
written grant. Review the current provider restrictions before each voice wave:
[ElevenLabs Prohibited Use Policy](https://elevenlabs.io/use-policy).

## Changes required in the execution handoff

The existing outputs/AAA_AUDIO_FACTORY_HANDOFF_20260729.md remains usable, with
these refreshes applied by the next implementation owner:

1. Pin actual model IDs from the account/model listing at run time; do not
   assume access from a document.
2. Use Music API for BGM and Sound Effects API for short effects, even when an
   SFX prompt contains a musical fragment.
3. Replace a fixed concurrency number with a server-side limiter whose ceiling
   is configured from the account plan and kept below the observed 429 limit.
4. Record the official request/trace/cost metadata in the candidate manifest.
5. Keep all output quarantined and out of the runtime asset manifest until the
   stated multi-stage gates and a Human GO are complete.

## Project execution observations — 2026-07-30

These are local evidence for this project, not a substitute for checking the
official schema before a later provider call.

The official pages were rechecked on 2026-08-01. Authentication still requires
the `xi-api-key` header and explicitly warns not to expose the key in client
code. The current SFX reference documents `POST /v1/sound-generation`,
`eleven_text_to_sound_v2`, `duration_seconds` 0.5–30 seconds, and `loop`; the
Music reference documents `POST /v1/music`, a prompt or composition plan (not
both), prompt-driven duration 3,000–600,000 ms, and a prompt ceiling of 4,100
characters. Treat the project-observed 450-character SFX ceiling as a local
guardrail, not as the provider's universal music limit.

- `tools/elevenlabs_preflight.js` reads safe model/subscription metadata without
  printing the API key, account identifier, or raw provider response.
- The factory now rejects unsafe output paths, duplicate asset IDs/request hashes,
  unsupported endpoint payloads, and manifest/CLI budget overflow before issuing
  HTTP. It records request/trace metadata where available and keeps raw output
  immutable.
- The technical-audit and SFX-mastering helpers now also reject manifest output
  traversal/absolute paths before reading raw candidate bytes; mastered files
  stay below their dedicated output root and duplicate derivative filenames fail
  closed.
- The observed `POST /v1/sound-generation` prompt ceiling for this account/run was
  **450 characters**. An initial 485-character remediation request received
  `HTTP 400 text_too_long`; no audio file was written. The succeeding v002 prompt
  was shortened to 415 characters. Treat 450 as a project guardrail, not a global
  permanent API guarantee.
- The pre-Wave-002 candidate summary is
  `outputs/audio-factory-20260730/execution-summary.json`: 250 candidates,
  250 technical passes, 157 mastered derivatives, and zero runtime admissions.
  The latest combined summary is
  `outputs/audio-factory-20260801/execution-summary-wave002.json`.
- A provider model list is not proof that music or sound-effect access is enabled.
  Each product surface must be proven by its own successful candidate response
  metadata or by current official documentation.
- Before Wave 002, `tools/triage_elevenlabs_audio_candidates.js` decoded the
  original 250 rows as 250/250 and ordered 62 reject-review, 61 listen-first,
  and 127 normal rows. This is retained as historical evidence.
- The latest 350-row reject-first queue is in
  `outputs/audio-factory-20260801/wave-002-HUMAN_LISTENING_PRIORITY_QUEUE.csv`
  and `.json`, with blank human decision fields and an explicit
  `NOT_RUNTIME_ADMITTED` boundary.
- The pre-Wave-002 secret-safe preflight recorded 113,702 credits remaining;
  the latest post-Wave-002 preflight records 111,852 remaining and
  `overageEnabled=false`. Both reports contain no API key or account ID and
  remain preflight-only.

### Wave 002 execution observation — 2026-08-01

The scoped user-authorized Wave 002 used the documented SFX endpoint with a
100-slot manifest, concurrency 1, retry ceiling 3, and a 2,400-credit estimate.
It completed 100/100 with zero retries. The raw files passed 100/100 technical
QC and 100/100 attenuation-only mastering. The post-wave secret-safe preflight
records 9,153 credits used, 111,852 remaining, and `overageEnabled=false`.
The combined 350-row triage decoded 350/350 and ordered 69 reject-review, 80
listen-first, and 201 normal rows. All remain `NOT_RUNTIME_ADMITTED`.
Detailed paths and hashes are in `docs/AAA_ELEVENLABS_WAVE002_HANDOFF_20260801.md`.

### Current safe execution commands

The following commands do not reveal the secret. The first only reads safe
metadata; the factory command must be preceded by explicit current authority to
spend provider credits.

```powershell
$node = 'C:\Users\rambo\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
& $node tools/elevenlabs_preflight.js --out outputs/audio-factory-YYYYMMDD/elevenlabs-preflight.json
& $node tools/elevenlabs_audio_factory.js --manifest <new-manifest.json> --dry-run --max-assets 100 --max-estimated-credits <cap>
& $node tools/audit_elevenlabs_factory_batch.js --manifest <new-manifest.json> --ffprobe <ffprobe-path> --out <technical-audit.json>
& $node tools/triage_elevenlabs_audio_candidates.js --out outputs/audio-factory-YYYYMMDD/auto-triage-YYYYMMDD.json --concurrency 1
& $node tools/build_elevenlabs_priority_queue.js
```

Do not pass the API key on a command line. Do not replace raw candidate files
with mastered derivatives. The only safe promotion path is a separate,
evidence-backed runtime-admission manifest after rights, creative, competitive,
and in-engine mix review.
