# Kagariai local-audio contract recovery (2026-07-29)

## 結論

復旧の最小 seam は、既存の `tools/generate_local_audio_assets.js` をそのまま実行して canonical Local DSP catalog を再生成すること。作業ツリーでは `assets-src/local-audio/manifest.json` と raw WAV 90 件が削除済みだが、`client/assets/generated/audio/**` の content-addressed WAV は 90 件残っている。生成器は同じ deterministic bytes を計算するため、既存 runtime と一致するパスには no-op、欠落 raw/manifest のみを再作成できる。テスト契約を緩めたり ElevenLabs 出力を置換したりしない。

`node` は本環境の `C:\Users\rambo\.claude\bin\node.cmd` shim が実体を解決できず、CLI 実行は未検証（`The system cannot find the path specified.`）。以下は実ファイル、HEAD の manifest、ソース/テストの静的検査に基づく。

## Canonical catalog / IDs

生成器 `requestedAssets()` は各 canonical hero の weapon 1 件 + `secondary`, `ability1`, `ability2`, `ultimate` の 4 件を列挙する。`assertValidCatalog()` は hero 18、合計 90、weapon 18、ability 72、重複なし、安全な lower-case ID を要求する。

Weapons (18): `zairu_chain_spear`, `baraga_forge_hammer`, `vesta_pressure_cannon`, `nuedori_twin_needles`, `sedora_pile_driver`, `shiomaneki_water_bomb`, `asagi_survey_rifle`, `shirasagi_crystal_rifle`, `tsubakuro_blade`, `hokuchi_scattergun`, `botan_bloom_cannon`, `ankou_lure_torpedo`, `tsuzuri_light_needle`, `koyomi_incense_burner`, `karakasa_rib_scatter`, `shirabe_string_beam`, `hibari_spark_shot`, `kazura_vine_beam`.

Abilities (72): `taguriyose`, `toubyou`, `makimodoshi`, `keiryukan`, `rouke`, `chuzouheki`, `youkaida`, `daichukomi`, `henkoya`, `kussetsusho`, `ranhansha`, `byakuyatai`, `tobariwatari`, `shotoucho`, `kagenui`, `yoiyami`, `katsugu`, `sueru`, `yobimodoshi`, `sando`, `naminori`, `uneri`, `shiogaeshi`, `michi`, `tensei`, `shirubeya`, `tsugiashi`, `sarashibi`, `fukitoru`, `hakuro`, `hakuyoku`, `sumiwatari`, `tsubamegaeshi`, `tousan`, `yobibane`, `muretsubame`, `hibana`, `aburadama`, `aburasuberi`, `oohimatsuri`, `kaika`, `shikakehana`, `hanabiashi`, `senrinzaki`, `sasou`, `tsuridama`, `mizuheri`, `shinkainogyoretsu`, `itokuri`, `tsuzuriwatari`, `tokito`, `senbari`, `kemurio`, `hayamawashi`, `chien`, `uruudoki`, `ukenagashi`, `kasasuberi`, `kasauch`, `senbonkasa`, `chogen`, `waon`, `hikiyose`, `daigasso`, `kassho`, `wataribi`, `hibariage`, `watarinooohi`, `yadorizuru`, `itamikaiho`, `togebaraki`, `daiukenoootsuru`.

## Required manifest field mapping

| 層 | 必須フィールド / 規則 |
|---|---|
| Manifest | `schemaVersion: 1.0.0`, `authoritative: true`, `provider: Kagariai Local DSP`, `generatorVersion` semver, `generatorPath: tools/generate_local_audio_assets.js`, matching `generatorSha256`, `generatedFor: kagariai-1.0.0-rc.5` |
| Manifest format/provenance | `contentType: audio/wav`, `sampleRateHz: 44100`, `channels: 1`, `bitDepth: 16`, license matching `/no third-party samples or model weights/i` |
| Asset identity | `id`, `heroId`, `kind` (`weapon`/`ability`), `slot` (weapon `null`, ability canonical slot), `behavior` |
| DSP metadata | integer unsigned-32 `seed`, non-empty unique `profile`, finite positive `durationSec` |
| Files/integrity | `sourcePath`, `runtimePath` are relative slash paths; source/runtime bytes and SHA-256 must match; `runtimeUrl` equals `/` + runtime path and filename contains `.<sha256 first 12>.wav`; `bytes`, `contentType`, ISO `generatedAt` |

`build_hero_asset_manifest.js` additionally rejects path escape/absolute paths, verifies every source/runtime hash, checks the generator hash, expected catalog keys, and fails closed unless all 90 records exist (only `--allow-incomplete-audio` bypasses this completeness gate; do not use it for recovery).

## Runtime path and WAV/QC contract

- Source: `assets-src/local-audio/raw/{weapon|ability}/{id}.wav`.
- Runtime: `client/assets/generated/audio/{weapons|abilities}/{id}.{sha256[0:12]}.wav`; URL is root-relative `/client/assets/generated/audio/...`.
- Generator emits canonical RIFF/WAVE PCM16 mono 44,100 Hz (`fmt` 16-byte PCM, byte rate 88,200, block align 2, non-empty even `data`).
- Generator/tests require non-ultimate duration roughly 0.85–1.21 s (catalog validator allows 0.75–1.35), ultimate 1.70–1.81 s (validator minimum 1.5); peak 0.88–0.92, RMS 0.025–0.40, early peak ≥0.28, tail RMS ≤ 30% of RMS, zero fraction <10%, first non-zero sample <32, final sample ≤1, unique hashes/profiles.
- `audio_quality_audit.js` independently rejects malformed/silent WAV, non-PCM16 mono 44100, RIFF/chunk/length errors, hash/byte/duration mismatches, source/runtime divergence, and path traversal. Its human scorecard remains `NOT HUMAN-VERIFIED`; structural pass is not listening/browser evidence.

## Deleted inventory and ElevenLabs compatibility

Read-only inventory: HEAD local-audio tree has 92 paths (README + manifest + 90 WAV). Worktree status marks all 92 deleted. Runtime currently contains 90 `.wav` files; HEAD manifest records all 90 source paths, so all 90 source files are missing while runtime files are present. `assets-src/elevenlabs/manifest.json` contains only 2 records (`taguriyose`, `zairu_chain_spear`) and their raw/runtime files are `audio/mpeg` MP3.

Those ElevenLabs files cannot replace deleted Local DSP assets directly: provider, generator path/hash, license/provenance, seed/profile metadata, content type, and WAV QC contract differ; coverage is 2/90. Converting MP3 to WAV would still not satisfy deterministic Local DSP provenance and would require a new admitted-provider contract plus test changes. Keep ElevenLabs assets outside this pipeline as the README specifies.

## Root implementation and validation commands

From `C:\Users\rambo\projects\kagariai-props` (after restoring a working Node executable):

```console
node tools/generate_local_audio_assets.js --check
node tools/generate_local_audio_assets.js
node tools/build_hero_asset_manifest.js
node --test tests/asset_licenses.test.js tests/asset_manifest_builder.test.js tests/local_audio_asset_generator.test.js tests/elevenlabs_asset_generator.test.js tests/audio_quality_audit.test.js
node tools/audio_quality_audit.js --project-root . --output outputs/rc5-audio-evidence/audio-quality-audit.json
```

Expected generator check summary is 90/18/72, 44100 Hz, mono, 16-bit, provider `Kagariai Local DSP`; audit should report manifest/source/runtime 90 and zero structural failures. The listed Node commands were not runnable in this environment because the available Node shim is broken; no API key, network call, source edit, test edit, or git operation was performed.
