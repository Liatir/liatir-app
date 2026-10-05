"""Kill a real worker after its first committed batch; verify exact resumability."""
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
HELPER = ROOT / "frontend/src/lib/tools/ai/python-scripts/scgpt-checkpoints.ts"
SOURCE = HELPER.read_text().split("String.raw`", 1)[1].rsplit("`;", 1)[0]
NAMESPACE = {"Path": Path, "os": os, "sys": sys, "json": json}
exec(compile(SOURCE, str(HELPER), "exec"), NAMESPACE)
Checkpoint = NAMESPACE["ScGPTCheckpoint"]


class ScGPTCheckpointTests(unittest.TestCase):
    def identity(self):
        return {"input_sha256": "input", "runner_sha256": "code", "model": "model", "seed": 23,
                "environment": "env", "host": "host", "embedding": {"cells": 4, "dimensions": 3,
                "cell_ids_sha256": hashlib.sha256(json.dumps(["a", "b", "c", "d"], separators=(",", ":")).encode()).hexdigest()}}

    def test_killed_process_resumes_exactly_and_accounts_for_the_interrupted_attempt(self):
        with tempfile.TemporaryDirectory() as temporary:
            worker = Path(temporary) / "worker.py"
            worker.write_text("from pathlib import Path\nimport os, sys, json\n" + SOURCE +
                              "\nimport numpy as np\nc=ScGPTCheckpoint(sys.argv[1],json.loads(sys.argv[2]))\n"
                              "c.load(['a','b','c','d'],3)\nc.save(0,np.arange(6,dtype=np.float32).reshape(2,3))\nos._exit(7)\n")
            directory = Path(temporary) / "saved"
            result = subprocess.run([sys.executable, str(worker), str(directory), json.dumps(self.identity())], capture_output=True, text=True)
            self.assertEqual(result.returncode, 7, result.stderr)
            checkpoint = Checkpoint(directory, self.identity())
            values, start = checkpoint.load(["a", "b", "c", "d"], 3)
            self.assertEqual(start, 2)
            values[start:] = np.arange(6, 12, dtype=np.float32).reshape(2, 3)
            checkpoint.save(start, values[start:])
            np.testing.assert_array_equal(values, np.arange(12, dtype=np.float32).reshape(4, 3))
            account = checkpoint.finish()
            self.assertEqual([a["status"] for a in account["attempts"]], ["interrupted", "completed"])
            self.assertGreater(account["wall_seconds_lower_bound"], 0)

    def test_each_identity_change_and_corrupt_batch_is_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            checkpoint = Checkpoint(directory, self.identity())
            checkpoint.load(["a", "b", "c", "d"], 3)
            checkpoint.save(0, np.ones((1, 3), dtype=np.float32))
            checkpoint.connection.close()
            for field in ("input_sha256", "runner_sha256", "model", "seed", "environment", "host", "embedding"):
                changed = {**self.identity(), field: "changed"}
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, "identity changed"):
                    Checkpoint(directory, changed)
            connection = sqlite3.connect(directory / "scgpt-checkpoint.sqlite3")
            connection.execute("UPDATE batches SET data=?", (b"corrupt",))
            connection.commit()
            connection.close()
            checkpoint = Checkpoint(directory, self.identity())
            with self.assertRaisesRegex(ValueError, "checksum or size changed"):
                checkpoint.load(["a", "b", "c", "d"], 3)
            checkpoint.connection.close()

    def test_changed_order_nonfinite_batch_and_second_writer_are_refused(self):
        with tempfile.TemporaryDirectory() as temporary:
            checkpoint = Checkpoint(temporary, self.identity())
            with self.assertRaisesRegex(ValueError, "cell order"):
                checkpoint.load(["b", "a", "c", "d"], 3)
            checkpoint.load(["a", "b", "c", "d"], 3)
            with self.assertRaisesRegex(ValueError, "Invalid"):
                checkpoint.save(0, np.full((1, 3), np.nan, dtype=np.float32))
            with self.assertRaises(sqlite3.OperationalError):
                Checkpoint(temporary, self.identity())
            checkpoint.connection.close()


if __name__ == "__main__":
    unittest.main()
