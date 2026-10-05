"""Termination records outrank a native process's ambiguous exit status."""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from common import read_json, write_json
from representations import collect


class CollectionTests(unittest.TestCase):
    def test_guard_stop_cannot_be_reported_as_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            directory = root / "runs/pbmc/uce"
            write_json(root / "datasets/pbmc/manifest.json", {"prepared_sha256": "input"})
            write_json(directory / "resource-monitor.json", {
                "status": "stopped", "reason": "Resource limit: available memory", "peak_rss_bytes": 1234})
            write_json(directory / "environment.json", {"model_runner_sha256": "runner",
                "runtime_box_activation": {"verified": True}})
            result = collect(root, "pbmc", "uce", {"config": {"method": "uce"},
                "runResult": {"ok": True, "stdout": "Starting inference", "stderr": ""}})
            self.assertEqual(result["status"], "blocked")
            self.assertEqual(result["error"], "Resource limit: available memory")
            self.assertEqual(result["runtime_box_activation"], {"verified": True})
            measured = read_json(directory / "telemetry.json")
            self.assertIsNone(measured["peak_rss_bytes"])
            self.assertEqual(measured["observed_peak_tree_rss_bytes"], 1234)
            self.assertEqual(read_json(directory / "metrics.json")["status"], "blocked")


if __name__ == "__main__":
    unittest.main()
