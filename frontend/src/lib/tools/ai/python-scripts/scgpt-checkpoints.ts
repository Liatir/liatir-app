/** SQLite commits each complete batch before progress is reported. */
export const SCGPT_CHECKPOINT_SCRIPT = String.raw`
import hashlib
import importlib.metadata
import platform
import sqlite3
import time
import uuid

scgpt_attempt_started = time.monotonic()

def scgpt_file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def scgpt_checkpoint_identity(payload, paths, source_package, accelerator):
    runner_hash = payload.get("runnerSha256")
    if not runner_hash:
        runner_path = globals().get("__file__")
        if not runner_path:
            raise ValueError("Cannot establish the scGPT runner identity for durable saving.")
        runner_hash = scgpt_file_hash(runner_path)
    identity = {
        "format_version": 1,
        "input_sha256": scgpt_file_hash(input_file),
        "runner_sha256": runner_hash,
        "model_files": {name: scgpt_file_hash(path) for name, path in paths.items()},
        "activation_sha256": scgpt_file_hash(runtime_path / "runtime-box-activation.json") if (runtime_path / "runtime-box-activation.json").exists() else None,
        "box_sha256": scgpt_file_hash(runtime_path / "box.json") if (runtime_path / "box.json").exists() else None,
        "runtime_identity_scope": "Activated box" if (runtime_path / "runtime-box-activation.json").exists() else "Pre-activation validator: exact model and source file hashes",
        "source_files": {str(path.relative_to(source_package)): scgpt_file_hash(path)
                         for path in sorted(source_package.rglob("*.py"))},
        "seed": int(payload.get("randomSeed", 23)), "batch_size": batch_size,
        "species": species, "accelerator": accelerator,
        "source_count_provenance": payload.get("sourceCountProvenance", {}),
        "python": sys.version, "platform": platform.platform(), "host": platform.node(),
        "packages": {name: importlib.metadata.version(name) for name in ("numpy", "torch", "anndata", "scipy")},
        "threads": {name: os.environ.get(name) for name in
                    ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS")},
    }
    if accelerator == "CUDA":
        import torch
        device = torch.cuda.get_device_properties(0)
        identity["cuda_device"] = {"name": device.name, "total_memory": device.total_memory,
                                   "capability": [device.major, device.minor], "runtime": torch.version.cuda,
                                   "matmul_tf32": torch.backends.cuda.matmul.allow_tf32,
                                   "cudnn_tf32": torch.backends.cudnn.allow_tf32,
                                   "deterministic_algorithms": torch.are_deterministic_algorithms_enabled(),
                                   "cublas_workspace": os.environ.get("CUBLAS_WORKSPACE_CONFIG")}
    return identity

class ScGPTCheckpoint:
    def __init__(self, directory, identity, started=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic() if started is None else started
        self.identity_json = json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False)
        self.connection = sqlite3.connect(self.directory / "scgpt-checkpoint.sqlite3", timeout=0)
        self.connection.execute("PRAGMA journal_mode=DELETE")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("CREATE TABLE IF NOT EXISTS identity (value TEXT NOT NULL)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS batches (start INTEGER PRIMARY KEY, stop INTEGER NOT NULL, dimensions INTEGER NOT NULL, data BLOB NOT NULL, sha256 TEXT NOT NULL)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, started_at REAL NOT NULL, updated_at REAL NOT NULL, elapsed REAL NOT NULL, peak_rss INTEGER, status TEXT NOT NULL)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS accelerator_peaks (attempt_id TEXT PRIMARY KEY, bytes INTEGER NOT NULL)")
        self.connection.commit()
        # Hold a writer lock throughout inference. A second process cannot own the same checkpoint.
        self.connection.execute("BEGIN IMMEDIATE")
        rows = self.connection.execute("SELECT value FROM identity").fetchall()
        if rows and (len(rows) != 1 or rows[0][0] != self.identity_json):
            self.connection.close()
            raise ValueError("scGPT checkpoint input, model, runner, seed, environment or host identity changed.")
        if not rows:
            self.connection.execute("INSERT INTO identity VALUES (?)", (self.identity_json,))
        self.connection.execute("UPDATE attempts SET status='interrupted' WHERE status='running'")
        self.attempt = str(uuid.uuid4())
        self.connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?)",
                                (self.attempt, time.time(), time.time(), time.monotonic()-self.started, self.peak_rss(), "running"))
        self.commit()

    @staticmethod
    def peak_rss():
        try:
            import resource
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return int(peak if sys.platform == "darwin" else peak * 1024)
        except ImportError:
            return None

    def commit(self):
        self.connection.commit()
        self.connection.execute("BEGIN IMMEDIATE")

    def load(self, cell_ids, dimensions):
        import numpy as np
        actual = {"cell_ids_sha256": hashlib.sha256(json.dumps(list(cell_ids), separators=(",", ":")).encode()).hexdigest(),
                  "cells": len(cell_ids), "dimensions": dimensions}
        expected = json.loads(self.identity_json)["embedding"]
        if actual != expected:
            raise ValueError("scGPT checkpoint cell order or embedding shape changed.")
        values = np.empty((len(cell_ids), dimensions), dtype=np.float32)
        completed = 0
        for start, stop, width, data, checksum in self.connection.execute("SELECT * FROM batches ORDER BY start"):
            if start != completed or not start < stop <= len(cell_ids) or width != dimensions:
                raise ValueError("Noncontiguous scGPT checkpoint batches.")
            if len(data) != (stop-start)*dimensions*4 or hashlib.sha256(data).hexdigest() != checksum:
                raise ValueError("scGPT checkpoint batch checksum or size changed.")
            batch = np.frombuffer(data, dtype="<f4").reshape(stop-start, dimensions)
            if not np.isfinite(batch).all():
                raise ValueError("Nonfinite scGPT checkpoint values.")
            values[start:stop] = batch
            completed = stop
        self.completed = completed
        self.dimensions = dimensions
        self.cells = len(cell_ids)
        return values, completed

    def save(self, start, values):
        import numpy as np
        values = np.asarray(values, dtype="<f4")
        stop = start + len(values)
        if start != self.completed or values.ndim != 2 or values.shape[1] != self.dimensions or not start < stop <= self.cells or not np.isfinite(values).all():
            raise ValueError("Invalid scGPT checkpoint batch.")
        data = values.tobytes()
        self.connection.execute("INSERT INTO batches VALUES (?,?,?,?,?)",
                                (start, stop, self.dimensions, data, hashlib.sha256(data).hexdigest()))
        self.update_attempt("running")
        self.commit()
        self.completed = stop

    def update_attempt(self, status):
        self.connection.execute("UPDATE attempts SET updated_at=?, elapsed=?, peak_rss=?, status=? WHERE id=?",
                                (time.time(), time.monotonic()-self.started, self.peak_rss(), status, self.attempt))
        if json.loads(self.identity_json).get("accelerator") == "CUDA":
            import torch
            self.connection.execute("INSERT OR REPLACE INTO accelerator_peaks VALUES (?,?)",
                                    (self.attempt, torch.cuda.max_memory_allocated(0)))

    def finish(self):
        if self.completed != self.cells:
            raise ValueError("Cannot finalize an incomplete scGPT checkpoint.")
        self.update_attempt("completed")
        self.connection.commit()
        rows = [dict(zip(("id", "started_at", "updated_at", "elapsed_seconds", "peak_rss_bytes", "status"), row))
                for row in self.connection.execute("SELECT * FROM attempts ORDER BY started_at")]
        result = {"attempts": rows, "wall_seconds_lower_bound": sum(row["elapsed_seconds"] for row in rows),
                  "peak_rss_bytes": max((row["peak_rss_bytes"] for row in rows if row["peak_rss_bytes"] is not None), default=None),
                  "unmeasured_time_reason": "Interrupted attempts record elapsed time through their last committed batch; any unsaved tail is unknown.",
                  "identity": json.loads(self.identity_json)}
        peaks = dict(self.connection.execute("SELECT attempt_id, bytes FROM accelerator_peaks"))
        for row in rows:
            row["peak_accelerator_bytes"] = peaks.get(row["id"])
        result["peak_accelerator_bytes"] = max(peaks.values(), default=None)
        temporary = self.directory / "scgpt-checkpoint-accounting.json.tmp"
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(self.directory / "scgpt-checkpoint-accounting.json")
        self.connection.close()
        return result
`;
