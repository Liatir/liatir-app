"""Instrumentation around the production embedding runner, inside its signed box."""
import contextlib
import hashlib
import importlib.metadata
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import resource
import sys
import time
import traceback
import zipfile
import uuid


class Tee:
    def __init__(self, stream, file):
        self.stream, self.file = stream, file

    def write(self, value):
        self.file.write(value)
        self.file.flush()
        return self.stream.write(value)

    def flush(self):
        self.file.flush()
        self.stream.flush()

    def __getattr__(self, name):
        return getattr(self.stream, name)

payload = json.loads(sys.stdin.read())
script = payload.pop("modelScript")
payload["runnerSha256"] = hashlib.sha256(script.encode()).hexdigest()
guard_source = payload.pop("resourceGuard")
limits = payload.pop("resourceLimits")
checkpoint_preflight = payload.pop("uceCheckpointPreflight", False)
profile_inference = payload.pop("profileInference", False)
output = Path(payload["outputDir"])
output.mkdir(parents=True, exist_ok=True)
if (output / "logs").exists():
    previous = output / "attempts" / str(uuid.uuid4())
    previous.mkdir(parents=True)
    for name in ("logs", "runner.py", "environment.json", "telemetry.json", "resource-monitor.json", "resource_guard.py"):
        if (output / name).exists():
            (output / name).rename(previous / name)
(output / "runner.py").write_text(script)
guard_path = output / "resource_guard.py"
guard_path.write_text(guard_source)
spec = importlib.util.spec_from_file_location("study_resource_guard", guard_path)
guard_module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(guard_module)
(output / "logs").mkdir(exist_ok=True)
sys.stdout = Tee(sys.stdout, (output / "logs" / "stdout.log").open("w"))
sys.stderr = Tee(sys.stderr, (output / "logs" / "stderr.log").open("w"))
print("Starting signed model inference; logs are saved continuously.", flush=True)
started = time.perf_counter()
for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[name] = "1"
os.environ["PYTHONHASHSEED"] = "23"
os.environ["LIATIR_AI_FORCE_CPU"] = "1"
os.environ["ACCELERATE_USE_CPU"] = "true"
os.environ["CUDA_VISIBLE_DEVICES"] = ""
payload["accelerator"] = "cpu"
payload["batchSize"] = 1
runtime = Path(payload["runtimePath"])
env = {"python": sys.version, "os": platform.platform(), "architecture": platform.machine(),
       "cpu": platform.processor() or (next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown") if sys.platform.startswith("linux") else platform.machine()),
       "host_ram_bytes": os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"),
       "cpu_count": os.cpu_count(), "execution_target": "CPU", "resource_limits": limits,
       "packages": dict(sorted((d.metadata["Name"], d.version) for d in importlib.metadata.distributions() if d.metadata["Name"])),
       "model_runner_sha256": hashlib.sha256(script.encode()).hexdigest(),
       "box": json.loads((runtime / "box.json").read_text()),
       "runtime_box_activation": json.loads((runtime / "runtime-box-activation.json").read_text())}
(output / "environment.json").write_text(json.dumps(env, indent=2))
status = "failed"
try:
    with guard_module.ResourceGuard(output, limits):
        if hasattr(os, "nice"):
            os.nice(10)
        if checkpoint_preflight:
            checkpoint = Path(payload["modelCacheDir"]) / "model_files" / "4layer_model.torch"
            # The pinned UCE loader calls torch.load without mmap: every checkpoint
            # storage must be resident before load_state_dict can complete.
            with zipfile.ZipFile(checkpoint) as archive:
                storage_bytes = sum(item.file_size for item in archive.infolist() if "/data/" in item.filename)
            if storage_bytes == 0:
                raise RuntimeError("Cannot verify UCE checkpoint storage before allocation.")
            (output / "memory-preflight.json").write_text(json.dumps({
                "checkpoint": str(checkpoint), "tensor_storage_bytes": storage_bytes,
                "max_process_rss_bytes": limits["maxRssBytes"],
                "basis": "Pinned UCE evaluate.py: torch.load(args.model_loc, map_location='cpu') without mmap"
            }, indent=2))
            if storage_bytes > limits["maxRssBytes"]:
                raise RuntimeError(f"UCE checkpoint requires at least {storage_bytes} resident tensor bytes; "
                                   f"the approved process memory limit is {limits['maxRssBytes']} bytes.")
        if profile_inference:
            import cProfile
            profiler = cProfile.Profile()
            profiler.enable()
        import numpy as np
        import torch
        np.random.seed(23)
        torch.manual_seed(23)
        torch.set_num_threads(1)
        torch.set_num_interop_threads(1)
        sys.stdin = io.StringIO(json.dumps(payload))
        exec(compile(script, "liatir-production-embedding.py", "exec"), {"__name__": "__main__"})
        if profile_inference:
            profiler.disable()
            profiler.dump_stats(str(output / "stability-profile.pstats"))
    status = "completed"
except BaseException:
    traceback.print_exc()
    raise
finally:
    elapsed = time.perf_counter() - started
    peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    disk_bytes = sum(p.stat().st_size for p in runtime.rglob("*")
                     if p.is_file() and "runs" not in p.relative_to(runtime).parts)
    measured = {
        "wall_seconds": elapsed,
        "peak_rss_bytes": int(peak if sys.platform == "darwin" else peak * 1024),
        "rss_measurement": "OS root-process high-water mark; excludes child processes",
        "peak_accelerator_bytes": None,
        "peak_accelerator_reason": "CPU-only execution; no accelerator used.",
        "execution_target": "CPU",
        "model_runtime_bytes": disk_bytes,
        "disk_scope": "signed installed box including model and runtime, excluding run scratch directories",
        "status": status,
    }
    accounting = output / "scgpt-checkpoint-accounting.json"
    if accounting.exists():
        costs = json.loads(accounting.read_text())
        measured["checkpoint_attempts"] = costs["attempts"]
        if len(costs["attempts"]) > 1:
            measured["wall_seconds"] = None
            measured["wall_seconds_lower_bound"] = costs["wall_seconds_lower_bound"]
            measured["wall_seconds_reason"] = costs["unmeasured_time_reason"]
            measured["peak_rss_bytes"] = max(measured["peak_rss_bytes"], costs["peak_rss_bytes"] or 0)
    (output / "telemetry.json").write_text(json.dumps(measured, indent=2))
