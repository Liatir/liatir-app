"""Shared, explicit study constants and artifact serialization."""
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import resource
import sys
import time
import subprocess

SEED = 23
METHODS = ("pca", "geneformer", "harmony", "scvi", "scgpt", "uce")
DATASETS = ("pbmc", "pancreas")


def write_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, allow_nan=False) + "\n")


def read_json(path):
    return json.loads(Path(path).read_text())


def sha256(path):
    digest = hashlib.sha256()
    with open(path, "rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def environment():
    import psutil
    cpu = platform.processor()
    if sys.platform == "darwin":
        cpu = subprocess.check_output(["/usr/sbin/sysctl", "-n", "machdep.cpu.brand_string"], text=True).strip()
    return {
        "python": sys.version,
        "os": platform.platform(),
        "architecture": platform.machine(),
        "cpu": cpu,
        "cpu_count": os.cpu_count(),
        "host_ram_bytes": psutil.virtual_memory().total,
        "packages": dict(sorted((d.metadata["Name"], d.version)
                                for d in importlib.metadata.distributions() if d.metadata["Name"])),
        "thread_limits": {key: os.environ.get(key) for key in
                          ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS")},
    }


def telemetry(start, target="CPU"):
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    return {
        "wall_seconds": time.perf_counter() - start,
        "peak_rss_bytes": int(peak if sys.platform == "darwin" else peak * 1024),
        "rss_measurement": "OS process high-water mark, includes imports and serialization",
        "peak_accelerator_bytes": None,
        "peak_accelerator_reason": "No reliable Metal peak allocator counter; CPU runs do not use accelerator memory.",
        "execution_target": target,
    }


def save_embedding(directory, values, cell_ids):
    import numpy as np
    values = np.asarray(values, dtype=np.float32)
    cell_ids = np.asarray(cell_ids, dtype=str)
    if values.ndim != 2 or values.shape[0] != len(cell_ids) or not np.isfinite(values).all():
        raise ValueError("Embedding shape, cell identity, or finite-value validation failed.")
    if len(set(cell_ids)) != len(cell_ids):
        raise ValueError("Embedding contains duplicate cell identities.")
    path = Path(directory) / "embedding.npz"
    np.savez_compressed(path, values=values, cell_ids=cell_ids)
    return {"path": str(path), "sha256": sha256(path), "bytes": path.stat().st_size,
            "cells": len(cell_ids), "dimensions": int(values.shape[1])}
