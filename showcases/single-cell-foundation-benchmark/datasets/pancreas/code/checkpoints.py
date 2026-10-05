"""Copy verified completed stages; keep their original measurements and provenance."""
from pathlib import Path
import shutil

from common import METHODS, read_json, sha256, write_json


def copy_artifact(source, destination):
    # An imported historical root must not share writable file storage with a new run.
    return shutil.copy2(source, destination)


def verify_transfer(source, recorded, manifest):
    matches = [run for run in manifest["runs"] if run["run_id"] == recorded["run_id"]]
    if len(matches) != 1 or matches[0]["dataset"] != recorded["dataset"]:
        raise ValueError("The saved study is not a recognized verified transfer.")
    prefix = matches[0]["archive_root"] + "/"
    files = [item for item in manifest["files"] if item["path"].startswith(prefix)]
    if not files:
        raise ValueError("No checksummed files are recorded for this transfer.")
    for item in files:
        relative = Path(item["path"][len(prefix):])
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError("Invalid transfer file path.")
        file = source / relative
        if file.is_symlink() or not file.is_file() or file.stat().st_size != item["bytes"] or sha256(file) != item["sha256"]:
            raise ValueError(f"Transferred study file changed: {relative}")
    return matches[0]


def restore(root, source, dataset, stability_check, transfer_manifest=None, requested_methods=None):
    source = Path(source)
    recorded = read_json(source / "liatir-run.json")
    if recorded["dataset"] != dataset or bool(recorded.get("stability_check")) != stability_check:
        raise ValueError("Checkpoint dataset or stability-test scope does not match.")
    transfer = verify_transfer(source, recorded, transfer_manifest) if transfer_manifest else None
    if not transfer and (root / "liatir-run.json").exists() and recorded.get("resource_limits") != read_json(root / "liatir-run.json").get("resource_limits"):
        raise ValueError("The saved study used different operating limits.")
    # A verified historical export runs no historical inference. Its exact source,
    # environment and measurements stay attached; only compatible evaluation is new.
    code = [root / "code" / name for name in ("common.py", "evaluation.py")] if transfer else sorted((root / "code").glob("*.py"))
    documents = [root / "requirements.txt"] if transfer else [root / "protocol.md", root / "requirements.txt"]
    for current in [*documents, *code]:
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
    recorded_blocked = []
    finalized = read_json(source / "results/summary.json") if transfer and (source / "results/summary.json").exists() else []
    for method in METHODS:
        if requested_methods is not None and method not in requested_methods:
            continue
        directory = source / "runs" / dataset / method
        if not (directory / "provenance.json").exists():
            continue
        provenance = read_json(directory / "provenance.json")
        if provenance.get("status") == "blocked" and any(row["method"] == method and row["status"] == "blocked" for row in finalized):
            target = root / "runs" / dataset / method
            shutil.copytree(directory, target, copy_function=copy_artifact)
            provenance["reused_from_run_id"] = recorded["run_id"]
            provenance["source_study_environment"] = read_json(source / "study-environment.json")
            write_json(target / "provenance.json", provenance)
            recorded_blocked.append(method)
            continue
        if provenance.get("status") != "completed":
            continue
        if provenance["input_sha256"] != manifest["prepared_sha256"] or sha256(directory / "embedding.npz") != provenance["embedding"]["sha256"]:
            raise ValueError(f"Checkpoint embedding or input identity changed: {method}")
        target = root / "runs" / dataset / method
        shutil.copytree(directory, target, copy_function=copy_artifact)
        provenance["reused_from_run_id"] = recorded["run_id"]
        provenance["source_resource_limits"] = recorded.get("resource_limits") if transfer else provenance.get("source_resource_limits", recorded.get("resource_limits"))
        provenance["source_study_environment"] = read_json(source / "study-environment.json") if transfer else provenance.get("source_study_environment")
        provenance["source_frozen_code_directory"] = str(source / "code")
        write_json(target / "provenance.json", provenance)
        completed.append(method)
    partial = source / "runs" / dataset / "scgpt"
    if not transfer and "scgpt" not in completed and (partial / "scgpt-checkpoint.sqlite3").exists():
        import sqlite3
        # A finalized previous run must have released its checkpoint writer.
        connection = sqlite3.connect(partial / "scgpt-checkpoint.sqlite3", timeout=0)
        try:
            connection.execute("BEGIN IMMEDIATE")
            shutil.copytree(partial, root / "runs" / dataset / "scgpt", copy_function=copy_artifact)
        finally:
            connection.close()
    if transfer:
        frozen = root / "imported-source"
        shutil.copytree(source / "code", frozen / "code")
        for name in ("liatir-run.json", "study-environment.json", "protocol.md", "requirements.txt"):
            shutil.copy2(source / name, frozen / name)
        interrupted = source / "runs" / dataset / "scgpt"
        if "scgpt" not in completed and interrupted.exists():
            shutil.copytree(interrupted, frozen / "runs" / dataset / "scgpt", copy_function=copy_artifact)
        write_json(root / "import-origin.json", {"source_run_id": recorded["run_id"], "source_dataset": dataset,
                   "source_root": str(source), "archive_sha256": transfer_manifest["archive_sha256"],
                   "reused_methods": completed, "scope": "Verified historical artifacts, not newly executed Jobs."})
    same_selection = requested_methods is None or sorted(requested_methods) == sorted(row["method"] for row in finalized)
    return {**manifest, "completed_methods": completed, "recorded_blocked_methods": recorded_blocked,
            "evaluation_complete": bool(finalized) and same_selection}
