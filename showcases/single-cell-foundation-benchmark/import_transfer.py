"""Verify a handoff archive before copying its files into a fresh transfer root."""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import time


def digest(path):
    value = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            value.update(block)
    return value.hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts or "\\" in name or ":" in name:
        raise ValueError(f"Unsafe archive path: {name}")
    if str(path) != name.rstrip("/") or not path.parts:
        raise ValueError(f"Noncanonical archive path: {name}")
    return path


def import_transfer(archive, manifest_path, output, evidence):
    started = time.monotonic()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest["schema_version"] != 1:
        raise ValueError("Unsupported transfer manifest.")
    if archive.stat().st_size != manifest["archive_bytes"] or digest(archive) != manifest["archive_sha256"]:
        raise ValueError("Handoff archive size or SHA-256 mismatch.")
    expected = {record["path"]: record for record in manifest["files"]}
    if len(expected) != len(manifest["files"]):
        raise ValueError("Duplicate paths in transfer manifest.")
    directories = set()
    for name in expected:
        directories.update(str(p) for p in safe_name(name).parents if str(p) != ".")
    if output.exists() or evidence.exists():
        raise ValueError("Refusing to overwrite transfer files or evidence.")
    with tarfile.open(archive, "r:gz") as source:
        members = source.getmembers()
        seen = set()
        for member in members:
            name = str(safe_name(member.name))
            if name in seen:
                raise ValueError(f"Duplicate archive member: {name}")
            seen.add(name)
            if member.isdir() and name in directories:
                continue
            if not member.isfile() or name not in expected or member.size != expected[name]["bytes"]:
                raise ValueError(f"Unexpected archive member, type or size: {name}")
        if {m.name for m in members if m.isfile()} != set(expected):
            raise ValueError("Archive members differ from the recorded manifest.")
        output.mkdir(parents=True, exist_ok=False)
        for member in members:
            if not member.isfile():
                continue
            target = output.joinpath(*PurePosixPath(member.name).parts)
            target.parent.mkdir(parents=True, exist_ok=True)
            with source.extractfile(member) as stream, target.open("xb") as destination:
                shutil.copyfileobj(stream, destination, length=8 * 1024 * 1024)
            if digest(target) != expected[member.name]["sha256"]:
                raise ValueError(f"Extracted file SHA-256 mismatch: {member.name}")
    record = {"status": "passed", "archive_sha256": manifest["archive_sha256"],
              "manifest_sha256": digest(manifest_path), "files_verified": len(expected),
              "output_root": str(output.resolve()), "run_ids": [r["run_id"] for r in manifest["runs"]],
              "duration_seconds": time.monotonic() - started,
              "scope": "Exact archive and file bytes; scientific alignment is checked separately."}
    evidence.parent.mkdir(parents=True, exist_ok=True)
    evidence.write_text(json.dumps(record, indent=2) + "\n", encoding="utf-8")
    return record


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--manifest", type=Path, default=Path(__file__).parent / "validation/windows-wsl2-handoff-manifest.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evidence", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(import_transfer(args.archive.resolve(), args.manifest.resolve(), args.output.resolve(), args.evidence.resolve())))
