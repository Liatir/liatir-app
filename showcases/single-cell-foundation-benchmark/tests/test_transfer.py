"""Verify historical source files independently of the current presentation code."""
import importlib.util
import io
import json
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

BASE = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE / "src"))
from common import sha256, write_json
from checkpoints import verify_transfer

spec = importlib.util.spec_from_file_location("import_transfer", BASE / "import_transfer.py")
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TransferTests(unittest.TestCase):
    def test_unsafe_paths_and_changed_archive_are_refused_before_extraction(self):
        for name in ("../outside", "/absolute", "C:/absolute", "a\\b", "a/../b"):
            with self.subTest(name=name), self.assertRaises(ValueError):
                module.safe_name(name)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            archive = root / "archive.tar.gz"
            with tarfile.open(archive, "w:gz") as output:
                entry = tarfile.TarInfo("code.py")
                entry.size = 4
                output.addfile(entry, io.BytesIO(b"code"))
            manifest = root / "manifest.json"
            write_json(manifest, {"schema_version": 1, "archive_bytes": archive.stat().st_size, "archive_sha256": "wrong"})
            with self.assertRaisesRegex(ValueError, "archive size or SHA-256"):
                module.import_transfer(archive, manifest, root / "output", root / "evidence.json")
            self.assertFalse((root / "output").exists())

    def test_changed_frozen_code_is_refused_even_if_output_is_valid(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "code").mkdir()
            file = root / "code/evaluation.py"
            file.write_text("frozen code\n")
            recorded = {"run_id": "source", "dataset": "pancreas"}
            manifest = {"runs": [{**recorded, "archive_root": "runs/source/output"}],
                        "files": [{"path": "runs/source/output/code/evaluation.py", "bytes": file.stat().st_size,
                                   "sha256": sha256(file)}]}
            self.assertEqual(verify_transfer(root, recorded, manifest)["run_id"], "source")
            file.write_text("changed code\n")
            with self.assertRaisesRegex(ValueError, "file changed"):
                verify_transfer(root, recorded, manifest)


if __name__ == "__main__":
    unittest.main()
