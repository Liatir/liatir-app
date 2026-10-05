"""Copy verified completed stages; keep their original measurements and provenance."""
import os
from pathlib import Path
import shutil

from common import METHODS, read_json, sha256, write_json


def copy_artifact(source, destination):
    if Path(source).suffix in (".h5ad", ".npz"):
        try:
            os.link(source, destination)
            return destination
        except OSError:
            pass
    return shutil.copy2(source, destination)


def restore(root, source, dataset, stability_check):
    source = Path(source)
    recorded = read_json(source / "liatir-run.json")
    if recorded["dataset"] != dataset or bool(recorded.get("stability_check")) != stability_check:
        raise ValueError("Checkpoint dataset or stability-test scope does not match.")
    for current in [root / "protocol.md", root / "requirements.txt", *sorted((root / "code").glob("*.py"))]:
        previous = source / current.relative_to(root)
        if not previous.exists() or sha256(current) != sha256(previous):
            raise ValueError(f"Checkpoint protocol or code changed: {current.name}. Start a fresh study.")
    manifest = read_json(source / "datasets" / dataset / "manifest.json")
    if sha256(source / "datasets" / dataset / "counts.h5ad") != manifest["prepared_sha256"]:
        raise ValueError("Checkpoint count matrix checksum changed.")
    if sha256(source / "datasets" / dataset / "split.csv") != manifest["split_sha256"]:
        raise ValueError("Checkpoint classification split checksum changed.")
    shutil.copytree(source / "datasets" / dataset, root / "datasets" / dataset, copy_function=copy_artifact)
    manifest["prepared_path"] = str(root / "datasets" / dataset / "counts.h5ad")
    write_json(root / "datasets" / dataset / "manifest.json", manifest)
    write_json(root / "datasets" / "manifest.json", [manifest])
    completed = []
    for method in METHODS:
        directory = source / "runs" / dataset / method
        if not (directory / "provenance.json").exists():
            continue
        provenance = read_json(directory / "provenance.json")
        if provenance.get("status") != "completed":
            continue
        if provenance["input_sha256"] != manifest["prepared_sha256"] or sha256(directory / "embedding.npz") != provenance["embedding"]["sha256"]:
            raise ValueError(f"Checkpoint embedding or input identity changed: {method}")
        target = root / "runs" / dataset / method
        shutil.copytree(directory, target, copy_function=copy_artifact)
        provenance["reused_from_run_id"] = recorded["run_id"]
        write_json(target / "provenance.json", provenance)
        completed.append(method)
    return {**manifest, "completed_methods": completed}
