# Kagariai rc.5 asset rights review (2026-07-21)

This is a source-backed engineering review, not legal advice. It evaluates the admitted bytes and the permissions evidenced in this checkout. Copyright, trademark, publicity, moral-rights and jurisdiction-specific questions may require the relevant rights holder or counsel.

## Evidence scope and inventory

- Candidate tree: `work/kagariai-rc5-assets/kagariai-1.0.0-rc.4`.
- Visual provenance ledger: `docs/ASSET_LICENSES.md`; SSOT: `docs/ASSET_SSOT.md`.
- ImageGen manifests: `assets-src/imagegen/manifests/group-a.json` through `group-f.json`; each has 15 records (90 generated source/alpha pairs total). Records preserve provider (`openai-built-in-imagegen` or `built-in image_gen`), prompt, paths and hashes.
- Local audio: `assets-src/local-audio/manifest.json` is authoritative and records 90 WAV entries, generator `tools/generate_local_audio_assets.js`, fixed seeds/profiles, hashes and `license: Project-authored; no third-party samples or model weights`.
- External sidecar: `client/assets/chicken_gun_fruzer_mine.LICENSE.txt` records title, Sketchfab URL, author `amogusstrikesback2`, CC BY 4.0 and imported SHA-256 `DC9017...E597`.
- Dependencies: `package-lock.json` records `three@0.166.1` MIT and `ws@8.21.1` MIT.
- Historical rights-review capture: `outputs/kagariai-1.0.0-rc.5-source-70d95887efa0.zip` hashed to `B9904034F8B6D584D51195FC4817C2BA3AA42140FD55E30FF07DB0D59E0F64DC` at that review point. It is not the final-candidate filename. Every regenerated candidate uses the source-manifest hash as its filename suffix and records the archive-byte hash in the adjacent `.zip.sha256`; consumers must verify the delivered pair rather than infer current status from this historical row.

## Rights mapping

| Admitted class | Local evidence / exact scope | Official source and current rule | Obligations and risk | Gate |
|---|---|---|---|---|
| OpenAI built-in ImageGen output (90 source PNGs, alpha helpers and derived frames) | `assets-src/imagegen/manifests/group-{a..f}.json`; provider, exact prompt, source/alpha path and SHA-256 per record; SSOT maps them to runtime WebP | [OpenAI Terms of Use, Content ownership](https://openai.com/policies/terms-of-use/) states that, between user and OpenAI and to the extent permitted by law, the user owns Output and OpenAI assigns its interest; output may be non-unique and user is responsible for rights in Input. | Output ownership/use is not a source-code license and does not prove third-party likeness/trademark clearance. Preserve prompts/manifests and human review; do not represent output as human-generated. No attribution term is stated in the cited Terms, but local attribution/NOTICE policy remains a project decision. | **Pass (conditional)** for output ownership/use under the cited account terms; **blocked** for any claim of exclusive copyright or clearance of depicted third-party subject matter. |
| Poly Haven Concrete Floor 01 + Concrete texture maps (6 files) | `docs/ASSET_LICENSES.md` lists exact source pages, author Rob Tuytel, byte counts and SHA-256/API-MD5 checks | [Poly Haven license](https://polyhaven.com/license) says HDRIs, textures and models are CC0; commercial use, modification and redistribution are allowed and attribution is not required. The same page reserves non-asset site content (logos, thumbnails, metadata, text). | Runtime maps are within the CC0 asset grant; do not bundle Poly Haven logos/thumbnails/metadata without permission. Keeping a courtesy credit/link is low risk but not required. | **Pass** for listed asset bytes; retain hashes and source links. |
| Sketchfab chicken gun model (decorative/hidden reference only) | `client/assets/chicken_gun_fruzer_mine.LICENSE.txt`; source URL, author, CC BY 4.0, required attribution text and SHA-256. `docs/ASSET_LICENSES.md` says it is not rendered and does not define collision. | [CC BY 4.0 deed](https://creativecommons.org/licenses/by/4.0/) permits sharing/adaptation, including commercially, but requires appropriate credit, license link and indication of changes, without implying endorsement. The exact [Sketchfab source page](https://sketchfab.com/3d-models/chicken-gun-fruzer-mine-055bcbb8505548b88af029ed198c37c2) is recorded locally; automated open returned an error during this review, so current page metadata could not be independently re-read. | Keep the sidecar attribution in distributed notices and state modifications (conversion/hidden reference). Because the exact model page could not be re-fetched, author/license provenance is currently dependent on the captured sidecar; a rights-holder/page recheck is required before public release. | **Blocked pending source-page/rights-holder recheck**; attribution text itself is present and otherwise sufficient for CC BY 4.0. |
| Project-authored deterministic DSP audio (90 WAVs) | `assets-src/local-audio/manifest.json` (90 entries; generator version/hash, seeds, profiles, source/runtime paths and SHA-256); `docs/ASSET_LICENSES.md` states no downloads, samples, model weights or services. | No third-party license applies on the stated evidence. This is a provenance assertion about project code and bytes, not an adjudication of copyrightability. | Distribute under the project’s chosen source/binary terms. Re-check generator and repository history for any unrecorded sample or contributor claim before publication. | **Pass as project-authored provenance**, subject to owner attestation and final repository scan. |
| Runtime dependencies | `package-lock.json`: `three@0.166.1` and `ws@8.21.1`, both `license: MIT`; resolved tarball URLs and integrity hashes are recorded. | Installed `node_modules/three/LICENSE` and `node_modules/ws/LICENSE` match the MIT notices captured for this build. MIT permits use/redistribution subject to preserving copyright and license notice. | `THIRD_PARTY_NOTICES.md` contains both complete MIT notices and is a required source-package root file. Do not imply dependency authors endorse Kagariai. | **Pass** for license identification and notice packaging. |

## Minimum release decisions

1. The project owner must choose and add a source-code license (`LICENSE`) for Kagariai. No license is selected by this review; absent an explicit license, default copyright applies to project code.
2. `THIRD_PARTY_NOTICES.md` now contains the Sketchfab CC BY attribution, change indication, both dependency MIT notices, and a courtesy Poly Haven credit; the packager requires it.
3. Decide whether generated ImageGen outputs are distributed under the same project terms or are separately identified as generated assets. The OpenAI Terms establish the user/OpenAI ownership relationship but do not grant exclusivity or resolve third-party rights.
4. Obtain the smallest missing authority: re-open the exact Sketchfab model page (or obtain a rights-holder confirmation). The rc.5 tree-hash filename and detached archive hash have been reconciled.

## Checks performed

- Parsed all six ImageGen manifests: 15 records each; provider and per-record provenance fields inspected.
- Parsed local audio manifest: authoritative declaration and 90 asset records inspected.
- Parsed every `*.LICENSE.txt` found in the candidate tree (one Sketchfab sidecar).
- Parsed `package-lock.json` license fields (three and ws both MIT).
- SHA-256 checked the named rc.5 source ZIP and its detached checksum; the filename suffix was verified as the distinct source-tree manifest hash.
- Opened official OpenAI Terms, Poly Haven license and Creative Commons CC BY deed. The exact Sketchfab URL and npm pages were attempted; Sketchfab/npm automated opens returned errors, so those page states remain an uncertainty.
