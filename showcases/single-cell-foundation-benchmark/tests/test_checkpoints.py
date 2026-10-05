"""Checkpoint identity and immutability checks use small, artificial artifacts."""
import json
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from checkpoints import restore
from common import sha256, write_json


class CheckpointTests(unittest.TestCase):
    def fixture(self, root):
        source, target = root / "source", root / "target"
        for directory in (source, target):
            (directory / "code").mkdir(parents=True)
            (directory / "code/runner.py").write_text("# identical frozen source\n")
            (directory / "protocol.md").write_text("protocol\n")
            (directory / "requirements.txt").write_text("versions\n")
        write_json(source / "liatir-run.json", {"run_id": "original", "dataset": "pbmc", "stability_check": False})
        data = source / "datasets/pbmc"
        data.mkdir(parents=True)
        (data / "counts.h5ad").write_bytes(b"count fixture")
        (data / "split.csv").write_text("cell_id,split\na,train\nb,test\n")
        manifest = {"prepared_sha256": sha256(data / "counts.h5ad"), "split_sha256": sha256(data / "split.csv")}
        write_json(data / "manifest.json", manifest)
        method = source / "runs/pbmc/pca"
        method.mkdir(parents=True)
        (method / "embedding.npz").write_bytes(b"embedding fixture")
        write_json(method / "provenance.json", {"status": "completed", "input_sha256": manifest["prepared_sha256"],
                   "embedding": {"sha256": sha256(method / "embedding.npz")}})
        write_json(method / "metrics.json", {"ari": 0.5})
        return source, target

    def test_reuse_keeps_measurements_and_does_not_alias_mutable_metadata(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, target = self.fixture(Path(temporary))
            result = restore(target, source, "pbmc", False)
            self.assertEqual(result["completed_methods"], ["pca"])
            write_json(target / "runs/pbmc/pca/metrics.json", {"ari": 0.9})
            self.assertEqual(json.loads((source / "runs/pbmc/pca/metrics.json").read_text()), {"ari": 0.5})
            provenance = json.loads((target / "runs/pbmc/pca/provenance.json").read_text())
            self.assertEqual(provenance["reused_from_run_id"], "original")

    def test_changed_code_or_input_is_refused(self):
        for corruption in ("protocol.md", "datasets/pbmc/counts.h5ad", "runs/pbmc/pca/embedding.npz"):
            with self.subTest(corruption=corruption), tempfile.TemporaryDirectory() as temporary:
                source, target = self.fixture(Path(temporary))
                (source / corruption).write_bytes(b"changed")
                with self.assertRaises(ValueError):
                    restore(target, source, "pbmc", False)


if __name__ == "__main__":
    unittest.main()
