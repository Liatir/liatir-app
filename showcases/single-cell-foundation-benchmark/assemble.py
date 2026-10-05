"""Assemble two completed native study runs without rerunning representations.

Small records are copied. Immutable matrices use hard links where possible to
keep the local export within the same disk budget as the original study.
"""
import argparse
import os
from pathlib import Path
import shutil
import sys

SOURCE = Path(__file__).parent / "src"
sys.path.insert(0, str(SOURCE))
from common import DATASETS, METHODS, read_json, sha256, write_json
from resource_guard import ResourceGuard


def copy_tree(source, destination):
    destination.mkdir(parents=True, exist_ok=False)
    for item in sorted(source.iterdir()):
        if item.name == "__pycache__":
            continue
        target = destination / item.name
        if item.is_symlink():
            raise ValueError(f"Unexpected symlink inside a recorded run: {item}")
        if item.is_dir():
            copy_tree(item, target)
        elif item.suffix in (".h5ad", ".npz", ".pt", ".torch", ".pkl"):
            try:
                os.link(item, target)
            except OSError:
                shutil.copy2(item, target)
        else:
            shutil.copy2(item, target)


def assemble(roots, destination):
    selected = {}
    limits = None
    for root in roots:
        recorded = read_json(root / "liatir-run.json")
        dataset = recorded["dataset"]
        if recorded.get("stability_check"):
            raise ValueError("Diagnostic samples cannot enter the full-study summary.")
        if dataset not in DATASETS or dataset in selected:
            raise ValueError("Provide exactly one full run for each required dataset.")
        # Assembly does no inference. Keep each producer's limits in its records
        # and apply the stricter common safeguards to this copying/report phase.
        current_limits = recorded["resource_limits"]
        limits = current_limits.copy() if limits is None else {
            key: (max if key.startswith("min") else min)(limits[key], value)
            for key, value in current_limits.items()
        }
        summary = read_json(root / "results/summary.json")
        if sorted(row["method"] for row in summary) != sorted(METHODS):
            raise ValueError(f"The six requested methods are not all recorded: {dataset}")
        manifest = read_json(root / "datasets" / dataset / "manifest.json")
        if sha256(root / "datasets" / dataset / "counts.h5ad") != manifest["prepared_sha256"]:
            raise ValueError(f"Prepared counts changed: {dataset}")
        for row in summary:
            method_dir = root / "runs" / dataset / row["method"]
            for name in ("config.json", "environment.json", "metrics.json", "telemetry.json", "provenance.json"):
                if not (method_dir / name).is_file():
                    raise ValueError(f"Missing required artifact: {dataset}/{row['method']}/{name}")
            provenance = read_json(method_dir / "provenance.json")
            if provenance["input_sha256"] != manifest["prepared_sha256"]:
                raise ValueError(f"A method used a different count matrix: {dataset}/{row['method']}")
            if row["status"] == "completed":
                if sha256(method_dir / "embedding.npz") != provenance["embedding"]["sha256"]:
                    raise ValueError("A completed embedding changed.")
                if not (method_dir / "umap.csv").is_file():
                    raise ValueError("A completed method has no UMAP.")
            elif not provenance.get("error") or not (method_dir / "logs").is_dir():
                raise ValueError("A blocked method needs its actual cause and retained logs.")
        selected[dataset] = (root, recorded, manifest)
    if set(selected) != set(DATASETS):
        raise ValueError("Both complete datasets are required.")
    for name in ("datasets", "runs", "results"):
        if (destination / name).exists():
            raise ValueError(f"Refusing to overwrite existing study artifacts: {destination / name}")
    destination.mkdir(parents=True, exist_ok=True)
    with ResourceGuard(destination / "validation/assembly-monitor", limits):
        manifests, executions = [], []
        for dataset in DATASETS:
            root, recorded, manifest = selected[dataset]
            copy_tree(root / "datasets" / dataset, destination / "datasets" / dataset)
            copy_tree(root / "runs" / dataset, destination / "runs" / dataset)
            shutil.copy2(root / "liatir-run.json", destination / "datasets" / dataset / "liatir-run.json")
            shutil.copy2(root / "study-environment.json", destination / "datasets" / dataset / "study-environment.json")
            for name in ("protocol.md", "requirements.txt"):
                shutil.copy2(root / name, destination / "datasets" / dataset / name)
            copy_tree(root / "code", destination / "datasets" / dataset / "code")
            if (root / "imported-source").exists():
                copy_tree(root / "imported-source", destination / "datasets" / dataset / "imported-source")
                shutil.copy2(root / "import-origin.json", destination / "datasets" / dataset / "import-origin.json")
            manifests.append(manifest)
            executions.append({**recorded, "source_run_directory": str(root),
                               "source_bundle_sha256": sha256(root / "single-cell-study.zip")})
        write_json(destination / "datasets/manifest.json", manifests)
        write_json(destination / "validation/native-study-runs.json", executions)
        shutil.copy2(selected[DATASETS[0]][0] / "study-environment.json", destination / "study-environment.json")
        from reporting import report
        report(destination)
        rows = read_json(destination / "results/summary.json")
        if len(rows) != len(DATASETS) * len(METHODS) or any(row["stability_check_only"] for row in rows):
            raise ValueError("Assembled summary is not the requested full comparison.")
        print(f"Assembled {len(rows)} measured or explicitly blocked configurations.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, nargs=2)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ[name] = "1"
    assemble([p.resolve() for p in args.runs], args.output.resolve())
