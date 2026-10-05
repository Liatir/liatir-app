"""Finish validation from two actual native exports; never rerun representations."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

BASE = Path(__file__).resolve().parent
APP_VERSION = json.loads((BASE.parents[1] / "package.json").read_text())["version"]
SOURCE_HEADERS = {"User-Agent": f"Mozilla/5.0 (compatible; Liatir/{APP_VERSION}; +https://liatir.com)"}
sys.path.insert(0, str(BASE / "src"))
from common import read_json, sha256, write_json
from study_data import download, GENCODE_URL
from resource_guard import ResourceGuard


def fetch_sources(runs, cache, evidence):
    fetched = []
    for root in runs:
        dataset = read_json(root / "liatir-run.json")["dataset"]
        manifest = read_json(root / "datasets" / dataset / "manifest.json")
        for source in manifest["source_files"]:
            name = source["file"]
            if dataset == "pancreas":
                url = manifest["urls"][0]
            elif "/pbmc4k/" in name:
                url = next(url for url in manifest["urls"] if "/pbmc4k/" in url)
            elif "/pbmc8k/" in name:
                url = next(url for url in manifest["urls"] if "/pbmc8k/" in url)
            else:
                # scVI saves upstream gene_info.csv under this dataset-specific local name.
                remote_name = "gene_info.csv" if name == "pbmc/gene_info_pbmc.csv" else Path(name).name
                matches = [url for url in manifest["urls"] if url.endswith(remote_name)]
                if len(matches) != 1:
                    raise ValueError(f"No unique recorded public source URL: {name}")
                url = matches[0]
            file = cache / name
            download(url, file, headers=SOURCE_HEADERS)
            if file.stat().st_size != source["bytes"] or sha256(file) != source["sha256"]:
                raise ValueError(f"Public source differs from its recorded identity: {name}")
            fetched.append({**source, "url": url})
        mapping = root / "datasets" / dataset / "gene_mapping_source.json"
        if mapping.exists():
            source = read_json(mapping)
            file = cache / source["file"]
            download(GENCODE_URL, file, headers=SOURCE_HEADERS)
            if sha256(file) != source["sha256"]:
                raise ValueError("The recorded gene reference changed.")
            fetched.append(source)
    write_json(evidence, {"status": "passed", "request_user_agent": SOURCE_HEADERS["User-Agent"], "sources": fetched})


def finish(runs, output, cache, python):
    if output.exists():
        raise ValueError("Choose a fresh final-study directory.")
    if sorted(read_json(root / "liatir-run.json")["dataset"] for root in runs) != ["pancreas", "pbmc"]:
        raise ValueError("Provide the two full native study exports.")
    environment = {**os.environ, "JAX_PLATFORMS": "cpu", "PYTHONHASHSEED": "23"}
    for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
        environment[name] = "1"
    def run(script, arguments):
        subprocess.run([str(python), str(BASE / script), *map(str, arguments)], check=True, env=environment)
    run("assemble.py", [*runs, "--output", output])
    fetch_sources(runs, cache, output / "validation/public-sources.json")
    run("reproduce.py", [output, "--output", output / "validation/reproduction"])
    for dataset in ("pbmc", "pancreas"):
        run("verify_counts.py", [output, "--dataset", dataset, "--cache", cache,
                                "--output", output / f"validation/{dataset}-source-counts.json"])
    (output / "report/reproduction-validation.md").write_text(
        "# Tested reproduction\n\n"
        "Both datasets' saved embeddings and fixed splits passed independent biological and batch metric reproduction, "
        "with absolute tolerance 1e-9 and relative tolerance 1e-8. Missing values and their reasons agreed exactly. "
        "Inference and scVI training were not repeated.\n\n"
        "Every prepared count, original gene order, source cell identity and filtering decision matched the "
        "checksummed canonical sources. Pancreas fractional values were preserved.\n\n"
        "Commands: assemble.py, reproduce.py, verify_counts.py (each dataset), validate_artifacts.py. "
        "Exact outcomes, native run identities, source hashes and comparisons are in validation/. "
        "Native UI checks and final visual review are recorded separately.\n", encoding="utf-8")
    # Add successful validation evidence to the export without changing any scores.
    with ResourceGuard(output / "validation/final-report-monitor", read_json(runs[0] / "liatir-run.json")["resource_limits"]):
        from reporting import report
        report(output)
    run("validate_artifacts.py", [output, "--output", output / "validation/artifact-verification.json"])
    write_json(output / "validation/finish.json", {"status": "passed", "native_runs": [read_json(root / "liatir-run.json") for root in runs],
               "bundle_sha256": sha256(output / "single-cell-study.zip"),
               "scope": "Assembly, exact metric reproduction, source-count preservation and artifact validation. Native UI checks and visual review are separate."})
    print(f"Scientific validation complete: {output}", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("runs", type=Path, nargs=2)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    finish([root.resolve() for root in args.runs], args.output.resolve(), args.cache.resolve(), Path(sys.executable))
