# Kagariai Local DSP audio

These WAV files are project-authored, deterministic procedural assets. The generator uses only Node.js standard-library code and mathematical DSP primitives; it does not use third-party samples, hosted APIs, generative models, or model weights.

Generate the canonical 18 weapon and 72 ability one-shots:

```console
node tools/generate_local_audio_assets.js
```

Validate the canonical catalog and fixed audio settings without writing files:

```console
node tools/generate_local_audio_assets.js --check
```

The source WAVs live under `assets-src/local-audio/raw/`. Byte-identical runtime copies use content-addressed filenames under `client/assets/generated/audio/`. `manifest.json` records the canonical IDs, DSP seeds and profiles, file hashes, format, and provenance. Given the same generator version and hero catalog, regeneration is byte-for-byte deterministic.

`--force` permits replacement if a known raw/runtime WAV path contains non-matching bytes. Without it, the generator fails closed instead of overwriting unexpected audio. The authoritative manifest itself is rebuilt atomically from the canonical catalog on each run. Existing ElevenLabs/MP3 assets are outside this generator's paths and are not removed.
