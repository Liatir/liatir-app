"""Check the complete twelve-configuration export, including ZIP integrity."""
import argparse
import csv
import math
from pathlib import Path
import struct
import sys
import zipfile

sys.path.insert(0, str(Path(__file__).parent / "src"))
from common import DATASETS, METHODS, read_json, sha256, write_json
from reporting import BIO, BATCH


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate(root, output):
    rows = read_json(root / "results/summary.json")
    expected = {(dataset, method) for dataset in DATASETS for method in METHODS}
    require(len(rows) == len(expected) and {(r["dataset"], r["method"]) for r in rows} == expected,
            "The summary must contain exactly the twelve requested configurations.")
    require(not any(r["stability_check_only"] for r in rows), "Diagnostic samples entered the study.")
    for row in rows:
        identity = f"{row['dataset']}/{row['method']}"
        directory = root / "runs" / row["dataset"] / row["method"]
        for name in ("config.json", "environment.json", "metrics.json", "telemetry.json", "provenance.json"):
            require((directory / name).is_file(), f"Missing {identity}/{name}")
        require((directory / "logs").is_dir(), f"Missing logs: {identity}")
        require(row["execution_target"] == "CPU", f"An unapproved execution target appears: {identity}")
        require(row["peak_accelerator_bytes"] is None and bool(row["peak_accelerator_reason"]),
                f"Unexplained accelerator measurement: {identity}")
        if row["status"] == "completed":
            require(all(isinstance(row[k], (int, float)) and math.isfinite(row[k]) for k in BIO),
                    f"Missing or nonfinite biological score: {identity}")
            for key in BATCH:
                require(row[key] is None and bool(row["null_reasons"].get(key)) or
                        isinstance(row[key], (int, float)) and math.isfinite(row[key]),
                        f"Missing batch-score explanation: {identity}/{key}")
            require(row["train_cells"] + row["test_cells"] == row["evaluation_cells"],
                    f"Classification partition changed: {identity}")
            require(all(row[k] is not None and row[k] > 0 for k in
                        ("wall_seconds", "peak_rss_bytes", "model_runtime_bytes", "embedding_dimensions", "embedding_bytes")),
                    f"Missing compute measurement: {identity}")
            require(sha256(directory / "embedding.npz") == row["embedding_sha256"],
                    f"Changed embedding: {identity}")
            for color in ("cell_type", "batch"):
                figure = root / "results/figures" / f"{row['dataset']}-{row['method']}-{color}.png"
                with figure.open("rb") as stream:
                    header = stream.read(24)
                require(header[:8] == b"\x89PNG\r\n\x1a\n" and
                        min(struct.unpack(">II", header[16:24])) >= 600, f"Invalid figure: {figure}")
        else:
            require(row["status"] == "blocked" and bool(row["error"]), f"Unexplained failed run: {identity}")
            require(all(row[k] is None for k in BIO + BATCH), f"A blocked run has invented scores: {identity}")
    with (root / "results/summary.csv").open(newline="") as stream:
        csv_rows = list(csv.DictReader(stream))
    require(len(csv_rows) == len(rows), "CSV and JSON row counts differ.")
    for original, exported in zip(rows, csv_rows):
        for key, text in exported.items():
            value = original[key]
            if value is None:
                require(text == "", f"Missing value changed in CSV: {key}")
            elif isinstance(value, bool):
                require(text.lower() == str(value).lower(), f"Boolean changed in CSV: {key}")
            elif isinstance(value, (int, float)):
                require(float(text) == value, f"Number changed in CSV: {key}")
            else:
                require(text == value, f"Text changed in CSV: {key}")
    for name in ("biological_metrics.csv", "batch_metrics.csv", "compute_metrics.csv"):
        require((root / "results" / name).is_file(), f"Missing {name}")
    for name in ("results.md", "limitations.md", "reproduction.md"):
        require((root / "report" / name).is_file(), f"Missing report/{name}")
    for dataset in DATASETS:
        manifest = read_json(root / "datasets" / dataset / "manifest.json")
        require(sha256(root / "datasets" / dataset / "counts.h5ad") == manifest["prepared_sha256"],
                f"Changed prepared counts: {dataset}")
        require(sha256(root / "datasets" / dataset / "split.csv") == manifest["split_sha256"],
                f"Changed classification split: {dataset}")
    bundle = root / "single-cell-study.zip"
    with zipfile.ZipFile(bundle) as archive:
        names = archive.namelist()
        require(len(set(names)) == len(names), "The bundle has duplicate entries.")
        require(archive.testzip() is None, "The result bundle failed CRC verification.")
        for name in ("datasets/manifest.json", "results/summary.csv", "results/summary.json", "report/results.md"):
            require(name in names, f"The export omits {name}")
    write_json(output, {"status": "passed", "configurations": len(rows),
        "completed": sum(row["status"] == "completed" for row in rows),
        "blocked": [f"{r['dataset']}/{r['method']}" for r in rows if r["status"] == "blocked"],
        "csv_json_values_identical": True, "bundle_crc_verified": True,
        "bundle_sha256": sha256(bundle), "bundle_bytes": bundle.stat().st_size,
        "figures": len(list((root / "results/figures").glob("*.png")))})
    print("Verified the twelve-row summary, figures, source identities and result bundle.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    arguments = parser.parse_args()
    require(not arguments.output.exists(), "Choose a new verification output.")
    validate(arguments.root.resolve(), arguments.output.resolve())
