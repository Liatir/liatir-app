"""Run a scientific validator child and report OS peak RAM and sampled per-process CUDA memory."""

import argparse
import json
import os
import runpy
import subprocess
import sys
import threading
import time


def peak_ram_bytes():
    if sys.platform != "win32":
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        return int(peak if sys.platform == "darwin" else peak * 1024)
    import ctypes
    from ctypes import wintypes

    class Counters(ctypes.Structure):
        _fields_ = [("cb", wintypes.DWORD), ("PageFaultCount", wintypes.DWORD)] + [
            (name, ctypes.c_size_t) for name in (
                "PeakWorkingSetSize", "WorkingSetSize", "QuotaPeakPagedPoolUsage", "QuotaPagedPoolUsage",
                "QuotaPeakNonPagedPoolUsage", "QuotaNonPagedPoolUsage", "PagefileUsage", "PeakPagefileUsage",
            )
        ]

    current_process = ctypes.windll.kernel32.GetCurrentProcess
    current_process.restype = wintypes.HANDLE
    memory_info = ctypes.windll.psapi.GetProcessMemoryInfo
    memory_info.argtypes = [wintypes.HANDLE, ctypes.POINTER(Counters), wintypes.DWORD]
    counters = Counters()
    counters.cb = ctypes.sizeof(counters)
    if not memory_info(current_process(), ctypes.byref(counters), counters.cb):
        raise ctypes.WinError()
    return int(counters.PeakWorkingSetSize)


def cuda_process_memory_bytes():
    result = subprocess.run(
        ["nvidia-smi", "--query-compute-apps=pid,used_gpu_memory", "--format=csv,noheader,nounits"],
        check=True, capture_output=True, text=True, timeout=5,
    )
    total = 0
    for row in result.stdout.splitlines():
        fields = [field.strip() for field in row.split(",")]
        if fields[0] == str(os.getpid()):
            if len(fields) != 2 or not fields[1].isdigit():
                raise RuntimeError("This GPU driver cannot report per-process memory usage.")
            total += int(fields[1]) * 1024 * 1024
    return total


parser = argparse.ArgumentParser()
parser.add_argument("--accelerator", choices=("cpu", "cuda"), required=True)
parser.add_argument("script")
args = parser.parse_args()
stopped = threading.Event()
gpu_peak = [0]
gpu_errors = []


def sample_gpu():
    while not stopped.is_set():
        try:
            gpu_peak[0] = max(gpu_peak[0], cuda_process_memory_bytes())
        except Exception as error:
            gpu_errors.append(str(error))
            return
        stopped.wait(0.2)


sampler = None
if args.accelerator == "cuda":
    cuda_process_memory_bytes()
    sampler = threading.Thread(target=sample_gpu, daemon=True)
    sampler.start()
started = time.monotonic()
try:
    sys.argv = [args.script]
    runpy.run_path(args.script, run_name="__main__")
finally:
    stopped.set()
    if sampler is not None:
        sampler.join(timeout=6)
    print("LIATIR_SCIENTIFIC_MEASUREMENT " + json.dumps({
        "elapsedMs": max(1, round((time.monotonic() - started) * 1000)),
        "peakRamBytes": peak_ram_bytes(),
        "peakVramBytes": gpu_peak[0] or None,
        "vramSamplingIntervalMs": 200 if sampler is not None else None,
        "vramMeasurementErrors": gpu_errors,
    }), file=sys.stderr, flush=True)
