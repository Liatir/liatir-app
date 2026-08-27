#!/usr/bin/env python3
"""Create the deterministic, models-only tar.gz mirror consumed by Scrollcase."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import json
import tarfile
from pathlib import PurePosixPath

SOURCE_SHA256 = "6193efee43e768c605b1869b1a7da2b8b89a31140f49cf45449fae17b5b7102e"
SOURCE_URL = (
    "https://github.com/openvax/mhcflurry/releases/download/pre-2.0/"
    "models_class1_presentation.20200611.tar.bz2"
)


def sha256(path: str) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalized_info(name: str, *, directory: bool, size: int = 0) -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE if directory else tarfile.REGTYPE
    info.mode = 0o755 if directory else 0o644
    info.uid = 0
    info.gid = 0
    info.uname = ""
    info.gname = ""
    info.mtime = 0
    info.size = 0 if directory else size
    return info


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("output")
    args = parser.parse_args()
    actual = sha256(args.source)
    if actual != SOURCE_SHA256:
        raise SystemExit(f"MHCflurry source archive hash mismatch: {actual}")

    provenance = (json.dumps({
        "schemaVersion": 1,
        "sourceUrl": SOURCE_URL,
        "sourceSha256": SOURCE_SHA256,
        "selection": "models/ only",
        "normalization": "sorted paths, uid/gid/mtime zero, files 0644, directories 0755",
    }, indent=2, sort_keys=True) + "\n").encode()

    with tarfile.open(args.source, "r:bz2") as source:
        members = []
        for member in source.getmembers():
            path = PurePosixPath(member.name)
            if not path.parts or path.parts[0] != "models":
                continue
            if member.issym() or member.islnk() or member.isdev():
                raise SystemExit(f"Unsupported archive entry: {member.name}")
            if member.isdir() or member.isfile():
                members.append(member)

        with open(args.output, "wb") as raw_output:
            with gzip.GzipFile(filename="", mode="wb", fileobj=raw_output, compresslevel=9, mtime=0) as gz:
                with tarfile.open(fileobj=gz, mode="w|") as output:
                    for member in sorted(members, key=lambda item: item.name):
                        if member.isdir():
                            output.addfile(normalized_info(member.name.rstrip("/") + "/", directory=True))
                            continue
                        extracted = source.extractfile(member)
                        if extracted is None:
                            raise SystemExit(f"Cannot read archive entry: {member.name}")
                        data = extracted.read()
                        output.addfile(normalized_info(member.name, directory=False, size=len(data)), io.BytesIO(data))
                    output.addfile(
                        normalized_info("LIATIR_SOURCE.json", directory=False, size=len(provenance)),
                        io.BytesIO(provenance),
                    )

    print(json.dumps({"output": args.output, "sizeBytes": __import__("os").path.getsize(args.output), "sha256": sha256(args.output)}))


if __name__ == "__main__":
    main()
