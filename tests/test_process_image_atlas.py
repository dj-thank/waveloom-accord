from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
PROCESSOR_PATH = ROOT / "tools" / "process_image_atlas.py"
SPEC = importlib.util.spec_from_file_location("process_image_atlas", PROCESSOR_PATH)
assert SPEC and SPEC.loader
PROCESSOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PROCESSOR)


class AtlasCacheDeterminismTest(unittest.TestCase):
    def test_cache_round_trip_preserves_result_key_order(self) -> None:
        result = {
            "input": "assets-src/example.png",
            "inputSha256": "a" * 64,
            "sourceWidth": 1024,
            "sourceHeight": 1024,
            "grid": {"rows": 4, "cols": 4},
            "frames": [{
                "index": 0,
                "row": 0,
                "col": 0,
                "path": "work/frame.png",
                "sha256": "b" * 64,
                "bytes": 123,
                "width": 256,
                "height": 256,
            }],
        }

        with tempfile.TemporaryDirectory() as directory:
            cache_path = Path(directory) / ".atlas-cache.json"
            PROCESSOR.write_cache(cache_path, "cache-key", result)
            restored = json.loads(cache_path.read_text(encoding="utf-8"))["result"]

        self.assertEqual(list(restored), list(result))
        self.assertEqual(list(restored["grid"]), list(result["grid"]))
        self.assertEqual(list(restored["frames"][0]), list(result["frames"][0]))


if __name__ == "__main__":
    unittest.main()
