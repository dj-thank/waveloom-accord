from __future__ import annotations

import importlib.util
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "package_rc5_candidate.py"
SPEC = importlib.util.spec_from_file_location("package_rc5_candidate", MODULE_PATH)
PACKAGE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(PACKAGE)


class PackageCandidatePolicyTest(unittest.TestCase):
    def test_interrupted_and_temporary_outputs_are_excluded(self) -> None:
        for suffix in (".part", ".partial", ".tmp"):
            with self.subTest(suffix=suffix):
                self.assertIn(suffix, PACKAGE.EXCLUDED_SUFFIXES)

    def test_legacy_audio_is_excluded_but_local_wav_is_admitted(self) -> None:
        local_wav = next((ROOT / "assets-src" / "local-audio" / "raw").rglob("*.wav"))
        legacy_mp3 = next((ROOT / "assets-src" / "elevenlabs" / "raw").rglob("*.mp3"))
        runtime_mp3 = next((ROOT / "client" / "assets" / "generated" / "audio").rglob("*.mp3"))

        self.assertTrue(PACKAGE.admitted(local_wav))
        self.assertFalse(PACKAGE.admitted(legacy_mp3))
        self.assertFalse(PACKAGE.admitted(runtime_mp3))


if __name__ == "__main__":
    unittest.main()
