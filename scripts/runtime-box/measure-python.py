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


def nvidia_smi(query):
    result = subprocess.run(
        ["nvidia-smi", query, "--format=csv,noheader,nounits"],
        check=True, capture_output=True, text=True, timeout=5,
    )
    return result.stdout


def cuda_process_memory_bytes():
    """
    Per-process VRAM for this process, or None where the driver refuses to attribute it.

    A paravirtualised GPU answers this query two different ways. Under WSL2 it lists nothing at
    all until a CUDA context exists, and once one does it lists this very process with `[N/A]`
    for its memory — measured on 2026-09-10 against a live OpenMM CUDA context. Neither shape is
    a fault to report: both mean the same thing, that the driver knows the process but not its
    share, and the caller answers by measuring the device instead.
    """
    total = 0
    for row in nvidia_smi("--query-compute-apps=pid,used_gpu_memory").splitlines():
        fields = [field.strip() for field in row.split(",")]
        if fields[0] == str(os.getpid()):
            if len(fields) != 2 or not fields[1].isdigit():
                return None
            total += int(fields[1]) * 1024 * 1024
    return total


def cuda_device_used_bytes():
    """Device-wide used VRAM. Always available, including where per-process is not."""
    value = nvidia_smi("--query-gpu=memory.used").strip().splitlines()[0].strip()
    if not value.isdigit():
        raise RuntimeError("This GPU driver cannot report device memory usage.")
    return int(value) * 1024 * 1024


def cuda_device_identity():
    fields = [f.strip() for f in nvidia_smi("--query-gpu=name,driver_version").strip().split(",")]
    return {"gpuName": fields[0], "gpuDriverVersion": fields[1]} if len(fields) == 2 else {}


parser = argparse.ArgumentParser()
parser.add_argument("--accelerator", choices=("cpu", "cuda"), required=True)
parser.add_argument("script")
args = parser.parse_args()
stopped = threading.Event()
gpu_peak = [0]
device_peak = [0]
device_baseline = [0]
gpu_identity = {}
gpu_errors = []
per_process_unattributed = [False]


# Each nvidia-smi call costs ~80 ms, so the pair plus the old 200 ms wait sampled under three
# times a second — few enough to miss a short run's whole GPU window. 50 ms roughly doubles the
# rate for both the per-process and the device-wide figure.
SAMPLE_WAIT_SECONDS = 0.05


def sample_gpu():
    while not stopped.is_set():
        try:
            # Once the driver has declined to attribute memory to this process it will not start,
            # so the query is dropped for the rest of the run rather than paid for ~80 ms a round.
            if not per_process_unattributed[0]:
                measured = cuda_process_memory_bytes()
                if measured is None:
                    per_process_unattributed[0] = True
                else:
                    gpu_peak[0] = max(gpu_peak[0], measured)
            device_peak[0] = max(device_peak[0], cuda_device_used_bytes())
        except Exception as error:
            gpu_errors.append(str(error))
            return
        stopped.wait(SAMPLE_WAIT_SECONDS)


sampler = None
if args.accelerator == "cuda":
    if cuda_process_memory_bytes() is None:
        per_process_unattributed[0] = True
    # The baseline has to be read before the workload creates its CUDA context, so that a host
    # whose driver cannot enumerate compute apps can still be charged only for what this run added.
    device_baseline[0] = cuda_device_used_bytes()
    device_peak[0] = device_baseline[0]
    gpu_identity = cuda_device_identity()
    sampler = threading.Thread(target=sample_gpu, daemon=True)
    sampler.start()


def vram_measurement():
    """
    Per-process VRAM where the driver reports it, and only otherwise a device-wide delta.

    `nvidia-smi --query-compute-apps` attributes nothing to this process under WSL2 — no error,
    either no rows or `[N/A]` — so a real GPU run is indistinguishable from one that touched no
    GPU memory unless the two cases are separated here. The fallback is a coarser number: it
    charges this run for everything the device gained while it ran, including any other process,
    so it can only over-state. The method travels with the sample because a device-wide delta must
    never be compared against a per-process one.
    """
    if not per_process_unattributed[0] and gpu_peak[0] > 0:
        return {"peakVramBytes": gpu_peak[0], "vramMeasurementMethod": "per-process",
                "vramDeviceBaselineBytes": None}
    if args.accelerator == "cuda" and device_peak[0] > device_baseline[0]:
        return {"peakVramBytes": device_peak[0] - device_baseline[0],
                "vramMeasurementMethod": "device-wide-delta",
                "vramDeviceBaselineBytes": device_baseline[0]}
    return {"peakVramBytes": None, "vramMeasurementMethod": None, "vramDeviceBaselineBytes": None}
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
        **vram_measurement(),
        **gpu_identity,
        "vramSamplingIntervalMs": round(SAMPLE_WAIT_SECONDS * 1000) if sampler is not None else None,
        "vramMeasurementErrors": gpu_errors,
    }), file=sys.stderr, flush=True)
