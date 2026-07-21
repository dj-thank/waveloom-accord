from __future__ import annotations

import importlib.util
import hashlib
import json
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "package_rc5_candidate.py"
SPEC = importlib.util.spec_from_file_location("package_rc5_candidate", MODULE_PATH)
PACKAGE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PACKAGE)


class PackageCandidatePolicyTest(unittest.TestCase):
    def _write_fake_release_tree(self, root: Path) -> None:
        generator = root / "tools" / "generate_local_audio_assets.js"
        generator.parent.mkdir(parents=True)
        generator.write_bytes(b"// deterministic fake generator\n")

        assets = []
        for index in range(90):
            kind = "weapon" if index < 18 else "ability"
            asset_id = f"asset_{index:02d}"
            payload = f"not-a-wave-file-{index:02d}".encode("ascii")
            digest = hashlib.sha256(payload).hexdigest()
            source_path = f"assets-src/local-audio/raw/{kind}/{asset_id}.wav"
            runtime_group = "weapons" if kind == "weapon" else "abilities"
            runtime_path = f"client/assets/generated/audio/{runtime_group}/{asset_id}.{digest[:12]}.wav"
            for relative in (source_path, runtime_path):
                output = root / relative
                output.parent.mkdir(parents=True, exist_ok=True)
                output.write_bytes(payload)
            assets.append({
                "id": asset_id,
                "heroId": f"hero_{index % 18:02d}",
                "kind": kind,
                "slot": None if kind == "weapon" else "ability1",
                "behavior": "fake",
                "seed": index,
                "profile": "fake",
                "durationSec": 1.0,
                "sourcePath": source_path,
                "runtimePath": runtime_path,
                "runtimeUrl": f"/{runtime_path}",
                "sha256": digest,
                "bytes": len(payload),
                "contentType": "audio/wav",
                "generatedAt": "2026-07-21T00:00:00.000Z",
            })

        audio_manifest = {
            "schemaVersion": "1.0.0",
            "authoritative": True,
            "provider": "Kagariai Local DSP",
            "generatorVersion": "1.0.0",
            "generatorPath": "tools/generate_local_audio_assets.js",
            "generatorSha256": PACKAGE.sha256_file(generator),
            "sampleRateHz": 44100,
            "channels": 1,
            "bitDepth": 16,
            "contentType": "audio/wav",
            "assets": assets,
        }
        manifest_path = root / "assets-src" / "local-audio" / "manifest.json"
        manifest_path.parent.mkdir(parents=True, exist_ok=True)
        manifest_path.write_text(json.dumps(audio_manifest), encoding="utf-8")

        hero_assets = root / "shared" / "data" / "hero_assets.js"
        hero_assets.parent.mkdir(parents=True)
        hero_assets.write_text(
            '"complete": true\n"missingAudio": []\n'
            '"contentSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"\n',
            encoding="utf-8",
        )

    def test_interrupted_and_temporary_outputs_are_excluded(self) -> None:
        for suffix in (".part", ".partial", ".tmp"):
            with self.subTest(suffix=suffix):
                self.assertIn(suffix, PACKAGE.EXCLUDED_SUFFIXES)

    def test_release_manifest_hashes_status_and_explicitly_excludes_only_itself(self) -> None:
        payload = [{"path": "README.md", "bytes": 3, "sha256": "a" * 64}]
        status_bytes = PACKAGE.canonical_json({"candidateStatus": "COMPLETE_AUDIO"})
        manifest = PACKAGE.build_release_manifest(payload, status_bytes)

        self.assertEqual(manifest["format"], "kagariai-source-manifest-v2")
        self.assertEqual(manifest["selfExcludedPath"], PACKAGE.RELEASE_MANIFEST_PATH)
        self.assertEqual(manifest["fileCount"], 2)
        self.assertEqual(manifest["archiveEntryCount"], 3)
        self.assertEqual(
            {entry["path"] for entry in manifest["files"]},
            {"README.md", PACKAGE.RELEASE_STATUS_PATH},
        )
        status_entry = next(entry for entry in manifest["files"] if entry["path"] == PACKAGE.RELEASE_STATUS_PATH)
        self.assertEqual(status_entry["bytes"], len(status_bytes))
        self.assertEqual(status_entry["sha256"], PACKAGE.sha256_bytes(status_bytes))

    def test_visual_refinement_evidence_is_packaged_with_its_report(self) -> None:
        self.assertIn("outputs/rc5-visual-refinement-audit", PACKAGE.EVIDENCE_DIRECTORIES)

    def test_legacy_audio_is_excluded_but_local_wav_is_admitted(self) -> None:
        local_wav = next((ROOT / "assets-src" / "local-audio" / "raw").rglob("*.wav"))
        legacy_mp3 = next((ROOT / "assets-src" / "elevenlabs" / "raw").rglob("*.mp3"))
        runtime_mp3 = next((ROOT / "client" / "assets" / "generated" / "audio").rglob("*.mp3"))

        self.assertTrue(PACKAGE.admitted(local_wav))
        self.assertFalse(PACKAGE.admitted(legacy_mp3))
        self.assertFalse(PACKAGE.admitted(runtime_mp3))

    def test_release_status_rejects_non_wave_payloads_even_when_hashes_match(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._write_fake_release_tree(root)

            with self.assertRaisesRegex(SystemExit, "WAV|wave|audio"):
                PACKAGE.release_status(root)

    def test_real_audio_passes_wave_and_release_structure_validation(self) -> None:
        sample = next((ROOT / "assets-src" / "local-audio" / "raw").rglob("*.wav"))
        details = PACKAGE.inspect_pcm16_mono_wav(sample.read_bytes(), sample.stem)
        self.assertEqual(details["bytes"], sample.stat().st_size)
        self.assertGreaterEqual(details["durationSec"], 0.85)
        self.assertLessEqual(details["durationSec"], 1.81)

        status = PACKAGE.release_status(ROOT)
        self.assertEqual(status["candidateStatus"], "COMPLETE_AUDIO")
        self.assertEqual(status["presentAudio"], 90)
        self.assertRegex(status["heroAssetContentSha256"], r"^[0-9a-f]{64}$")

    def test_audio_records_must_match_canonical_ids_slots_and_behaviors(self) -> None:
        manifest_path = ROOT / "assets-src" / "local-audio" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        records = PACKAGE.validate_audio_manifest_files(ROOT, manifest)
        canonical = PACKAGE.canonical_audio_catalog(ROOT)
        records["ability:taguriyose"] = dict(records["ability:taguriyose"], slot="ability1")

        with self.assertRaisesRegex(SystemExit, "canonical slot mismatch"):
            PACKAGE.validate_integrated_audio_ssot(ROOT, manifest_path, manifest, records, canonical)

    def test_integrated_ssot_audio_descriptors_are_compared_structurally(self) -> None:
        manifest_path = ROOT / "assets-src" / "local-audio" / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        records = PACKAGE.validate_audio_manifest_files(ROOT, manifest)
        canonical = PACKAGE.canonical_audio_catalog(ROOT)
        integrated = PACKAGE.parse_hero_asset_manifest(ROOT)
        integrated["heroes"][0]["weapon"]["audio"]["runtimeUrl"] = "/client/assets/generated/audio/weapons/tampered.wav"
        integrated.pop("contentSha256")
        integrated["contentSha256"] = PACKAGE.sha256_bytes(
            json.dumps(integrated, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        )

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            output = root / "shared" / "data" / "hero_assets.js"
            output.parent.mkdir(parents=True)
            output.write_text(
                "export const HERO_ASSET_MANIFEST = deepFreeze("
                + json.dumps(integrated, ensure_ascii=False, indent=2)
                + ");\n\nexport const HERO_ASSET_BY_ID = null;\n",
                encoding="utf-8",
            )
            with self.assertRaisesRegex(SystemExit, "weapon audio mismatch"):
                PACKAGE.validate_integrated_audio_ssot(root, manifest_path, manifest, records, canonical)


if __name__ == "__main__":
    unittest.main()
