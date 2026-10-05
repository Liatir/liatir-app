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

    def test_new_limits_allow_only_verified_historical_reuse(self):
        with tempfile.TemporaryDirectory() as temporary:
            source, target = self.fixture(Path(temporary))
            for directory in (source, target):
                for name in ("common.py", "evaluation.py"):
                    (directory / "code" / name).write_text("# unchanged scientific definition\n")
            recorded = {"run_id": "original", "dataset": "pbmc", "stability_check": False,
                        "resource_limits": {"maxRssBytes": 2*1024**3}}
            write_json(source / "liatir-run.json", recorded)
            write_json(target / "liatir-run.json", {**recorded, "resource_limits": {"maxRssBytes": 16*1024**3}})
            with self.assertRaisesRegex(ValueError, "different operating limits"):
                restore(target, source, "pbmc", False)
            write_json(source / "study-environment.json", {"cpu": "original Mac", "thread_limits": {"OMP_NUM_THREADS": "1"}})
            manifest = {"runs": [{"run_id": "original", "dataset": "pbmc", "archive_root": "runs/original/output"}],
                        "archive_sha256": "verified archive", "files": [
                            {"path": "runs/original/output/" + p.relative_to(source).as_posix(),
                             "bytes": p.stat().st_size, "sha256": sha256(p)} for p in source.rglob("*") if p.is_file()]}
            result = restore(target, source, "pbmc", False, transfer_manifest=manifest)
            self.assertEqual(result["completed_methods"], ["pca"])
            self.assertEqual(json.loads((target / "runs/pbmc/pca/provenance.json").read_text())["source_study_environment"]["cpu"], "original Mac")
            self.assertEqual(json.loads((source / "liatir-run.json").read_text())["resource_limits"], recorded["resource_limits"])


if __name__ == "__main__":
    unittest.main()
