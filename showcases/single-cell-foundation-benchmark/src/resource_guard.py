"""A separate, standard-library-only watchdog for a single study process.

It stays responsive when the numerical worker is busy and exits when its parent
disappears. It never discovers or terminates unrelated system processes.
"""
import json
import os
from pathlib import Path
import re
import shutil
import signal
import subprocess
import sys
import time


def write_record(path, value):
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(value, indent=2) + "\n")
    temporary.replace(path)


def gpu_snapshot():
    command = shutil.which("nvidia-smi") or "/usr/lib/wsl/lib/nvidia-smi"
    output = subprocess.check_output([command, "--id=0", "--query-gpu=memory.used,memory.total",
                                      "--format=csv,noheader,nounits"], text=True, timeout=3)
    used, total = [int(value.strip()) * 1024**2 for value in output.strip().split(",")]
    if not 0 <= used <= total:
        raise RuntimeError("Invalid NVIDIA memory measurement.")
    return {"gpu_used_bytes": used, "gpu_total_bytes": total,
            "gpu_memory_scope": "Whole NVIDIA device 0, including display and other processes"}


def snapshot(pid, directory, limits=None):
    if sys.platform == "darwin":
        vm = subprocess.check_output(["/usr/bin/vm_stat"], text=True, timeout=3)
        page_size = int(re.search(r"page size of (\d+)", vm).group(1))
        pages = dict((name, int(value)) for name, value in re.findall(r"([^\n:]+):\s+(\d+)\.", vm))
        available = (pages["Pages free"] + pages["Pages inactive"]) * page_size
        swap = subprocess.check_output(["/usr/sbin/sysctl", "-n", "vm.swapusage"], text=True, timeout=3)
        amount, unit = re.search(r"used = ([\d.]+)([KMG])", swap).groups()
        swap_used = int(float(amount) * {"K": 1024, "M": 1024**2, "G": 1024**3}[unit])
    elif sys.platform.startswith("linux"):
        info = dict((key, int(value) * 1024) for key, value in
                    re.findall(r"(\w+):\s+(\d+) kB", Path("/proc/meminfo").read_text()))
        available = info["MemAvailable"]
        swap_used = info["SwapTotal"] - info["SwapFree"]
    else:
        raise RuntimeError("The study resource monitor currently supports native macOS and Linux.")
    rows = subprocess.check_output(["/bin/ps", "-axo", "pid=,ppid=,rss="], text=True, timeout=3)
    processes = [tuple(map(int, row.split())) for row in rows.splitlines() if row.strip()]
    family = {pid}
    while True:
        expanded = family | {child for child, parent, _ in processes if parent in family}
        if expanded == family:
            break
        family = expanded
    rss = sum(kib * 1024 for child, _, kib in processes if child in family)
    residents = {str(child): kib * 1024 for child, _, kib in processes if child in family}
    sample = {"rss_bytes": rss, "tracked_pids": sorted(family), "process_rss_bytes": residents,
            "available_bytes": available, "swap_used_bytes": swap_used,
            "disk_free_bytes": shutil.disk_usage(directory).free}
    if limits and "maxGpuUsedBytes" in limits:
        sample.update(gpu_snapshot())
    return sample


def violation(sample, initial_swap, limits):
    if "maxGpuUsedBytes" in limits:
        if sample["gpu_used_bytes"] > limits["maxGpuUsedBytes"]:
            return f"Resource limit: gpu_used_bytes={sample['gpu_used_bytes']}, maxGpuUsedBytes={limits['maxGpuUsedBytes']}"
        if sample["gpu_total_bytes"] - limits["maxGpuUsedBytes"] < 1024**3:
            return "Resource limit: the GPU budget must leave at least 1 GiB of device headroom."
    comparisons = [("rss_bytes", "maxRssBytes", True), ("available_bytes", "minAvailableBytes", False),
                   ("disk_free_bytes", "minDiskBytes", False)]
    for key, limit_key, maximum in comparisons:
        exceeded = sample[key] > limits[limit_key] if maximum else sample[key] < limits[limit_key]
        if exceeded:
            return f"Resource limit: {key}={sample[key]}, {limit_key}={limits[limit_key]}"
    if sample["swap_used_bytes"] - initial_swap > limits["maxSwapGrowthBytes"]:
        return f"Resource limit: swap grew by {sample['swap_used_bytes'] - initial_swap} bytes"
    return None


def watch(pid, directory, limits, initial_swap):
    directory = Path(directory)
    path = directory / "resource-monitor.json"
    record = {"pid": pid, "limits": limits, "status": "monitoring", "peak_rss_bytes": 0,
              "initial_swap_bytes": initial_swap, "started_at": time.time()}
    if "maxGpuUsedBytes" in limits:
        record["peak_gpu_used_bytes"] = 0
    while os.getppid() == pid:
        try:
            current = snapshot(pid, directory, limits)
            record.update(last_sample=current, updated_at=time.time(),
                          peak_rss_bytes=max(record["peak_rss_bytes"], current["rss_bytes"]))
            if "maxGpuUsedBytes" in limits:
                record["peak_gpu_used_bytes"] = max(record["peak_gpu_used_bytes"], current["gpu_used_bytes"])
            reason = violation(current, initial_swap, limits)
        except Exception as error:
            # Losing the monitor is a failure, not permission to continue unbounded.
            reason = f"Resource monitoring failed: {error}"
        if reason:
            if os.getppid() != pid:
                return
            if sys.platform.startswith("linux"):
                # Process names identify the failed phase without recording command-line secrets.
                record["stopped_process_names"] = {}
                for child in record.get("last_sample", {}).get("tracked_pids", []):
                    try:
                        record["stopped_process_names"][str(child)] = Path(f"/proc/{child}/comm").read_text().strip()
                    except OSError:
                        pass
            record.update(status="stopped", reason=reason)
            write_record(path, record)
            print(reason, file=sys.stderr, flush=True)
            for child in reversed(record.get("last_sample", {}).get("tracked_pids", [])):
                if child not in (pid, os.getpid()):
                    try:
                        os.kill(child, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            os.kill(pid, signal.SIGTERM)
            time.sleep(1)
            if os.getppid() == pid:
                os.kill(pid, signal.SIGKILL)
            return
        write_record(path, record)
        time.sleep(0.25)


class ResourceGuard:
    def __init__(self, directory, limits):
        self.directory = Path(directory)
        self.limits = limits
        self.process = None

    def __enter__(self):
        self.directory.mkdir(parents=True, exist_ok=True)
        current = snapshot(os.getpid(), self.directory, self.limits)
        reason = violation(current, current["swap_used_bytes"], self.limits)
        if reason:
            write_record(self.directory / "resource-monitor.json",
                         {"status": "refused", "reason": reason, "limits": self.limits, "last_sample": current})
            raise RuntimeError(reason)
        self.process = subprocess.Popen([sys.executable, "-S", str(Path(__file__).resolve()), "--watch",
                                         str(os.getpid()), str(self.directory), json.dumps(self.limits),
                                         str(current["swap_used_bytes"])], stdin=subprocess.DEVNULL)
        # A readiness record proves the independent monitor started before any heavy import.
        path = self.directory / "resource-monitor.json"
        for _ in range(100):
            if self.process.poll() is not None:
                raise RuntimeError("The resource monitor exited before the worker started.")
            if path.exists() and json.loads(path.read_text()).get("pid") == os.getpid():
                return self
            time.sleep(0.05)
        self.process.terminate()
        self.process.wait(timeout=3)
        raise RuntimeError("The resource monitor did not become ready.")

    def __exit__(self, exc_type, _exc, _trace):
        if self.process is not None:
            self.process.terminate()
            self.process.wait(timeout=3)
        path = self.directory / "resource-monitor.json"
        if path.exists():
            record = json.loads(path.read_text())
            if record.get("status") == "monitoring":
                record.update(status="completed" if exc_type is None else "worker_failed", ended_at=time.time())
                write_record(path, record)


if __name__ == "__main__":
    if len(sys.argv) != 6 or sys.argv[1] != "--watch":
        raise SystemExit("This module is launched only by ResourceGuard.")
    watch(int(sys.argv[2]), sys.argv[3], json.loads(sys.argv[4]), int(sys.argv[5]))
