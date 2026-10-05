"""Prove the independent watchdog stops a bounded dummy allocation, not real models."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SOURCE))
from resource_guard import ResourceGuard, violation


class ResourceGuardTests(unittest.TestCase):
    def test_preflight_refuses_missing_disk_headroom(self):
        with tempfile.TemporaryDirectory() as directory:
            limits = dict(maxRssBytes=256 * 1024**2, minAvailableBytes=1,
                          minDiskBytes=10**18, maxSwapGrowthBytes=1024**3)
            with self.assertRaisesRegex(RuntimeError, "disk_free_bytes"):
                with ResourceGuard(directory, limits):
                    self.fail("Unsafe work must not start")
            self.assertEqual(json.loads((Path(directory) / "resource-monitor.json").read_text())["status"], "refused")

    def test_external_monitor_terminates_worker_and_retains_reason(self):
        with tempfile.TemporaryDirectory() as directory:
            # 96 MiB is deliberately tiny compared with the study's real 2 GiB cap.
            limits = dict(maxRssBytes=80 * 1024**2, minAvailableBytes=1,
                          minDiskBytes=1, maxSwapGrowthBytes=1024**3)
            code = (f"import sys,time;sys.path.insert(0,{str(SOURCE)!r});from resource_guard import ResourceGuard\n"
                    f"with ResourceGuard({directory!r},{limits!r}):\n"
                    "    memory=bytearray(96*1024**2)\n    time.sleep(15)\n")
            run = subprocess.run([sys.executable, "-S", "-c", code], capture_output=True, text=True, timeout=20)
            self.assertNotEqual(run.returncode, 0)
            record = json.loads((Path(directory) / "resource-monitor.json").read_text())
            self.assertEqual(record["status"], "stopped")
            self.assertIn("rss_bytes", record["reason"])

    def test_swap_growth_is_a_stop_condition(self):
        limits = dict(maxRssBytes=1000, minAvailableBytes=1, minDiskBytes=1, maxSwapGrowthBytes=10)
        sample = dict(rss_bytes=100, available_bytes=100, disk_free_bytes=100, swap_used_bytes=111)
        self.assertIn("swap grew", violation(sample, 100, limits))


if __name__ == "__main__":
    unittest.main()
