"""Verify saved inputs and independently recompute every reported biological/batch score.

Run with the pinned baseline Python environment. Inputs remain untouched; a new
destination retains the verified alignment and the measured comparison.
"""
import argparse
import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys

SOURCE = Path(__file__).parent / "src"
sys.path.insert(0, str(SOURCE))
from resource_guard import ResourceGuard


def read(path):
    return json.loads(path.read_text())


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def reproduce(root, destination, record_directory):
    recorded = read(record_directory / "liatir-run.json")
    dataset = recorded["dataset"]
    target = destination / dataset
    target.mkdir()
    with ResourceGuard(target / "monitor", recorded["resource_limits"]):
        for name in ("common.py", "evaluation.py"):
            if digest(SOURCE / name) != digest(record_directory / "code" / name):
                raise ValueError(f"Evaluation source differs from the recorded run: {name}")
        versions = read(record_directory / "study-environment.json")["packages"]
        for name in ("numpy", "pandas", "scipy", "scikit-learn", "scib-metrics", "jax", "jaxlib"):
            if importlib.metadata.version(name) != versions[name]:
                raise ValueError(f"The recorded package version is required: {name}=={versions[name]}")
        manifest = read(root / "datasets" / dataset / "manifest.json")
        for filename, key in (("counts.h5ad", "prepared_sha256"), ("split.csv", "split_sha256")):
            if digest(root / "datasets" / dataset / filename) != manifest[key]:
                raise ValueError(f"Recorded dataset identity changed: {filename}")
        data_dir = target / "datasets" / dataset
        data_dir.mkdir(parents=True)
        shutil.copy2(root / "datasets" / dataset / "split.csv", data_dir / "split.csv")
        summary = read(root / "results" / "summary.json")
        methods = [row["method"] for row in summary
                   if row["dataset"] == dataset and row["status"] == "completed"]
        for method in methods:
            source = root / "runs" / dataset / method
            stage = target / "runs" / dataset / method
            stage.mkdir(parents=True)
            shutil.copy2(source / "provenance.json", stage / "provenance.json")
            # Compact embeddings are immutable, so this saves disk without sharing metadata.
            try:
                os.link(source / "embedding.npz", stage / "embedding.npz")
            except OSError:
                shutil.copy2(source / "embedding.npz", stage / "embedding.npz")
        from evaluation import align_embeddings, score_embedding
        from sklearn import config_context
        obs, arrays = align_embeddings(target, dataset, methods)
        comparisons = []
        for method, values in arrays.items():
            print(f"Reproducing {dataset}/{method} on {len(values)} cells", flush=True)
            with config_context(working_memory=64):
                measured = score_embedding(values, obs)
            expected = read(root / "runs" / dataset / method / "metrics.json")
            differences = {}
            for key, value in measured.items():
                if key == "null_reasons":
                    if value != expected[key]:
                        raise ValueError(f"Missing-value reasons changed: {dataset}/{method}")
                    continue
                reference = expected[key]
                if value is None or reference is None:
                    if value != reference:
                        raise ValueError(f"Missing measurement changed: {method}/{key}")
                elif not math.isclose(value, reference, rel_tol=1e-8, abs_tol=1e-9):
                    raise ValueError(f"Measurement changed: {method}/{key}: {reference} -> {value}")
                else:
                    differences[key] = abs(value - reference)
            comparisons.append({"method": method, "metrics": measured, "absolute_differences": differences})
        result = {"run_id": recorded["run_id"], "dataset": dataset,
                  "stability_check_only": recorded.get("stability_check", False),
                  "status": "passed", "source_count_sha256": manifest["prepared_sha256"],
                  "split_sha256": manifest["split_sha256"], "comparisons": comparisons,
                  "scope": "Recomputed all biological and batch metrics from saved embeddings; inference is not rerun."}
        (target / "reproduction.json").write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
        print(f"Reproduced {len(comparisons)} completed methods for {dataset}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, nargs="+")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--record-directory", type=Path, help=argparse.SUPPRESS)
    arguments = parser.parse_args()
    if arguments.record_directory:
        if len(arguments.runs) != 1:
            raise ValueError("A reproduction worker requires one source export.")
        record = arguments.record_directory.resolve()
        threads = int(read(record / "liatir-run.json").get("threads", 1))
        if not 1 <= threads <= (os.cpu_count() or 1):
            raise ValueError("The recorded numerical thread count is unavailable on this host.")
        for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
            os.environ[variable] = str(threads)
        os.environ["JAX_PLATFORMS"] = "cpu"
        reproduce(arguments.runs[0].resolve(), arguments.output.resolve(), record)
        sys.exit(0)
    arguments.output.mkdir(parents=True, exist_ok=False)
    for run in arguments.runs:
        root = run.resolve()
        if (root / "liatir-run.json").is_file():
            records = [root]
        else:
            records = sorted(path.parent for path in (root / "datasets").glob("*/liatir-run.json"))
            if not records:
                raise ValueError("Provide a native run or the assembled scientific export.")
        for record in records:
            # Libraries initialize thread pools on first import. A separate
            # worker preserves each dataset's recorded numerical environment.
            subprocess.run([sys.executable, str(Path(__file__).resolve()), str(root),
                            "--output", str(arguments.output.resolve()), "--record-directory", str(record)], check=True)
