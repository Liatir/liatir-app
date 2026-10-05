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
threads = int(payload.pop("threads", 1))
accelerator = str(payload.get("accelerator", "cpu")).lower()
if accelerator not in ("cpu", "cuda") or not 1 <= threads <= (os.cpu_count() or 1):
    raise ValueError("Invalid explicitly requested model execution resources.")
if accelerator == "cuda" and "maxGpuUsedBytes" not in limits:
    raise ValueError("CUDA study execution requires an independent GPU memory guard.")
for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
    os.environ[name] = str(threads)
os.environ["PYTHONHASHSEED"] = "23"
if accelerator == "cpu":
    os.environ["LIATIR_AI_FORCE_CPU"] = "1"
    os.environ["ACCELERATE_USE_CPU"] = "true"
    os.environ["CUDA_VISIBLE_DEVICES"] = ""
else:
    os.environ.pop("LIATIR_AI_FORCE_CPU", None)
    os.environ.pop("ACCELERATE_USE_CPU", None)
    os.environ["CUDA_VISIBLE_DEVICES"] = "0"
    os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
payload["accelerator"] = accelerator
payload.setdefault("batchSize", 1)
target = "CUDA" if accelerator == "cuda" else "CPU"
runtime = Path(payload["runtimePath"])
env = {"python": sys.version, "os": platform.platform(), "architecture": platform.machine(),
       "cpu": platform.processor() or (next((line.split(":", 1)[1].strip() for line in Path("/proc/cpuinfo").read_text().splitlines() if line.startswith("model name")), "unknown") if sys.platform.startswith("linux") else platform.machine()),
       "host_ram_bytes": os.sysconf("SC_PHYS_PAGES") * os.sysconf("SC_PAGE_SIZE"),
       "cpu_count": os.cpu_count(), "execution_target": target, "resource_limits": limits,
       "thread_limits": {name: os.environ[name] for name in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS")},
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
        torch.set_num_threads(threads)
        torch.set_num_interop_threads(1)
        if accelerator == "cuda":
            if not torch.cuda.is_available():
                raise RuntimeError("The installed runtime does not provide the explicitly requested CUDA device.")
            total = torch.cuda.get_device_properties(0).total_memory
            # The allocator ceiling and the independent whole-device guard both
            # reserve space for Windows display and CUDA context overhead.
            torch.cuda.set_per_process_memory_fraction((limits["maxGpuUsedBytes"] - 512 * 1024**2) / total, 0)
            torch.backends.cuda.matmul.allow_tf32 = False
            torch.backends.cudnn.allow_tf32 = False
            torch.use_deterministic_algorithms(True)
            torch.cuda.reset_peak_memory_stats(0)
            env["gpu"] = {"name": torch.cuda.get_device_name(0), "total_bytes": total,
                          "cuda_runtime": torch.version.cuda, "allocator_limit_bytes": limits["maxGpuUsedBytes"] - 512 * 1024**2}
            (output / "environment.json").write_text(json.dumps(env, indent=2))
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
        "peak_accelerator_bytes": torch.cuda.max_memory_allocated(0) if accelerator == "cuda" and "torch" in globals() and torch.cuda.is_initialized() else None,
        "peak_accelerator_reason": "PyTorch CUDA peak allocated tensor memory; excludes display, driver and other processes." if accelerator == "cuda" else "CPU-only execution; no accelerator used.",
        "execution_target": target,
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
            if accelerator == "cuda":
                measured["peak_accelerator_bytes"] = max(measured["peak_accelerator_bytes"] or 0,
                                                           costs.get("peak_accelerator_bytes") or 0)
                measured["peak_accelerator_reason"] = "Maximum recorded CUDA tensor allocator peak across saved attempts; an interrupted unsaved tail is unmeasured."
    (output / "telemetry.json").write_text(json.dumps(measured, indent=2))
