/**
 * Offline GNINA adapter for Neural Pose Rescoring.
 *
 * Reads Liatir Molecular Docking poses and the receptor they were docked into with the Python standard
 * library, runs GNINA's official binary on them with the box's own CUDA libraries, and reads GNINA's
 * scores back from the SD file it writes.
 */
export const GNINA_SCRIPT = String.raw`
"""Offline neural rescoring of docked poses with GNINA.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line, and
both read SD files with the Python standard library only. The poses must come from Liatir's Molecular
Docking and record the receptor PDBQT they were docked into, so GNINA scores every pose, without
moving it, against exactly that receptor. GNINA is the official 1.3.3 binary, which Liatir's installer
fetched from GNINA's own release and checked by digest. It runs with every library it links preloaded
from the box and from an empty directory, and its scores are read back from the SD file it writes.
"""
import csv
import ctypes
import hashlib
import json
import math
import os
import pathlib
import resource
import socket
import subprocess
import sys
import tempfile
import threading
import time

GNINA_VERSION = "1.3.3"
GNINA_BUILD = "gnina v1.3.3 master:6fe1ce2"
RUNTIME_ID = "gnina-1-3-3"
EXECUTABLE = "gnina/bin/gnina"
EXECUTABLE_SHA256 = "3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172"
EXECUTABLE_BYTES = 2056131000
# Every library GNINA 1.3.3 names as NEEDED apart from glibc's. Its RPATH puts /usr/local/lib,
# /usr/local/cuda/lib64 and the working directory ahead of LD_LIBRARY_PATH, so a CUDA installed on
# the host would otherwise be loaded first; preloading by absolute path leaves the loader nothing to
# search for. The box's self-test preloads the same list.
PRELOADED_LIBRARIES = (
    "libstdc++.so.6", "libgcc_s.so.1", "libcudart.so.12", "libcublasLt.so.12", "libcublas.so.12",
    "libcufft.so.11", "libcusparse.so.12", "libcusolver.so.11", "libcudnn.so.9",
)
# GNINA prints this and carries on with the CPU when it cannot use a GPU.
NO_GPU_WARNING = "No GPU detected"
# The interval at which device memory is sampled while GNINA runs, as the OpenMM runner samples it.
GPU_SAMPLE_SECONDS = 0.05
MAX_POSES_BYTES = 256 * 1024 * 1024
MAX_RECEPTOR_PDBQT_BYTES = 64 * 1024 * 1024
MAX_POSES = 100_000
MAX_PLOTTED_LIGANDS = 20
# What GNINA writes on each pose, and the names the rescored poses carry them under.
GNINA_PROPERTIES = (
    ("minimizedAffinity", "gnina_vina_score_kcal_per_mol"),
    ("CNNscore", "gnina_cnn_pose_score"),
    ("CNNaffinity", "gnina_cnn_affinity_pk"),
    ("CNNaffinity_variance", "gnina_cnn_affinity_variance"),
    ("CNN_VS", "gnina_cnn_vs"),
)
SCIENTIFIC_NOTICE = (
    "GNINA's CNN pose score estimates how likely a pose is to lie within 2 Å of the true binding mode, "
    "and its CNN affinity is a predicted binding affinity in pK units; both are predictions of neural "
    "networks trained on known complexes, not measurements, and a rescored pose is still a hypothesis "
    "to test."
)


def fail(message):
    raise ValueError(message)


def deny_network():
    original_connect = socket.socket.connect

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local pose rescoring.")

    def blocked_connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect(sock, address)
        return blocked()

    socket.socket.connect = blocked_connect
    socket.create_connection = blocked
    socket.getaddrinfo = blocked


def finite_number(value, label):
    try:
        number = float(value)
    except (TypeError, ValueError):
        fail("%s is not a number." % label)
    if not math.isfinite(number):
        fail("%s is not finite." % label)
    return number


def checked_file(raw_path, label, max_bytes, extensions):
    path = pathlib.Path(str(raw_path or "")).expanduser().resolve()
    if not path.is_file():
        fail("%s does not exist: %s" % (label, path.name or raw_path))
    if not path.name.lower().endswith(extensions):
        fail("%s must use one of these formats: %s." % (label, ", ".join(extensions)))
    size = path.stat().st_size
    if size < 1 or size > max_bytes:
        fail("%s must hold between 1 and %d bytes." % (label, max_bytes))
    return path, size


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path, value):
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def payload_root():
    """The box's root: the interpreter is venv/bin/python inside it."""
    return pathlib.Path(sys.executable).resolve().parents[2]


# ── SD files, read and written with the standard library ────────────────────

def sdf_blocks(path):
    """The lines of each SD record, without its $$$$ terminator.

    A record's first line is its title, which may be blank, so records are split only at their
    terminators and never trimmed.
    """
    records = [[]]
    with open(path, encoding="utf-8", errors="strict") as handle:
        for line in handle.read().splitlines():
            if line.strip() == "$$$$":
                records.append([])
            else:
                records[-1].append(line)
    return [record for record in records if any(line.strip() for line in record)]


def sdf_properties(lines):
    """The data items of one SD record, by name."""
    values = {}
    for index, line in enumerate(lines[:-1]):
        # A data header is ">  <name>", which some writers follow with the record number.
        start = line.find("<") + 1
        end = line.find(">", start)
        if line.startswith(">") and start > 0 and end > start:
            values[line[start:end]] = lines[index + 1].strip()
    return values


def heavy_atom_coordinates(lines, label):
    """The heavy-atom coordinates of a V2000 record, rounded to the precision both writers keep."""
    if len(lines) < 4 or "V2000" not in lines[3]:
        fail("%s is not a V2000 molecule record." % label)
    try:
        atoms = int(lines[3][:3])
        rows = lines[4:4 + atoms]
        found = sorted((round(float(row[0:10]), 3), round(float(row[10:20]), 3), round(float(row[20:30]), 3))
                       for row in rows if row[31:34].strip() not in ("H", "D"))
    except (ValueError, IndexError):
        fail("%s has an unreadable atom block." % label)
    if len(rows) != atoms or not found:
        fail("%s has no heavy atoms." % label)
    return found


def receptor_atoms(path):
    count = 0
    with open(path, encoding="utf-8", errors="strict") as handle:
        for line in handle:
            if line.startswith(("ATOM  ", "HETATM")):
                count += 1
    if count < 1:
        fail("The receptor PDBQT holds no atoms.")
    return count


# ── preflight ───────────────────────────────────────────────────────────────

def read_inputs(payload):
    """The docked poses and the receptor they were docked into, checked against each other."""
    poses_path, poses_bytes = checked_file(payload.get("posesSdf"), "Docked poses", MAX_POSES_BYTES, (".sdf",))
    receptor_path, receptor_bytes = checked_file(payload.get("receptorPdbqt"), "Receptor PDBQT",
                                                 MAX_RECEPTOR_PDBQT_BYTES, (".pdbqt",))
    receptor_sha256 = sha256_file(receptor_path)
    poses = []
    seen = set()
    for index, lines in enumerate(sdf_blocks(poses_path)):
        properties = sdf_properties(lines)
        if "liatir_ligand" not in properties or "liatir_pose_rank" not in properties:
            fail("Pose %d does not come from Liatir's Molecular Docking; rescore the poses a docking run wrote."
                 % (index + 1))
        if "liatir_receptor_pdbqt_sha256" not in properties:
            fail("These poses do not record the receptor they were docked into; dock them again to rescore them.")
        if properties["liatir_receptor_pdbqt_sha256"] != receptor_sha256:
            fail("These poses were not docked into this receptor PDBQT; choose the receptor the docking run used.")
        key = (properties["liatir_ligand"], properties["liatir_pose_rank"])
        if key in seen:
            fail("The poses hold %s rank %s twice; rescore the poses of one docking run." % key)
        seen.add(key)
        poses.append({"ligand": key[0], "poseRank": int(key[1]),
                      "vinaScoreKcalPerMol": finite_number(properties.get("vina_score_kcal_per_mol"),
                                                           "The Vina score of %s rank %s" % key),
                      "lines": lines})
        if len(poses) > MAX_POSES:
            fail("The file holds more than %d poses." % MAX_POSES)
    if not poses:
        fail("The docked poses file holds no poses.")
    return poses_path, receptor_path, poses, poses_bytes + receptor_bytes, receptor_sha256


def preflight_rescoring(payload):
    poses_path, receptor_path, poses, size, receptor_sha256 = read_inputs(payload)
    ligands = sorted({pose["ligand"] for pose in poses})
    return {
        "schemaVersion": 1,
        "kind": "liatir.gnina-preflight",
        "action": "rescore-poses",
        "workloadId": "gnina:rescore",
        "tokenCount": len(poses),
        "atomCount": receptor_atoms(receptor_path),
        "stepCount": 1,
        "outputItemCount": len(poses),
        "ligands": len(ligands),
        "inputBytes": size,
        "networkAccess": False,
    }, (poses_path, receptor_path, poses, receptor_sha256)


def require_measured_envelope(payload, metrics):
    """A run needs an accepted measured preflight that still matches the input."""
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before GNINA runs.")
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)


# ── the run ─────────────────────────────────────────────────────────────────

def executable():
    """GNINA as the installer placed it.

    Scrollcase verified its SHA-256 when the installer placed it; hashing 2 GB again would add seconds
    to every run, so a run checks that the same file is still there.
    """
    path = payload_root() / EXECUTABLE
    if not path.is_file() or not os.access(path, os.X_OK) or path.stat().st_size != EXECUTABLE_BYTES:
        fail("The GNINA program is missing from the Runtime Box or cannot run; reinstall the tool.")
    return path


def cuda_device():
    """The GPU GNINA will use, read through the NVIDIA driver without creating a GPU context.

    Also returns its PCI bus, which is what ties it to NVML's own numbering of devices.
    """
    try:
        driver = ctypes.CDLL("libcuda.so.1")
    except OSError:
        fail("No NVIDIA driver was found on this computer; GNINA rescoring needs an NVIDIA GPU.")
    count, device, version = ctypes.c_int(0), ctypes.c_int(0), ctypes.c_int(0)
    if driver.cuInit(0) != 0 or driver.cuDeviceGetCount(ctypes.byref(count)) != 0 or count.value < 1:
        fail("The NVIDIA driver reports no usable GPU; GNINA rescoring needs one.")
    name = ctypes.create_string_buffer(256)
    bus = ctypes.create_string_buffer(64)
    major, minor = ctypes.c_int(0), ctypes.c_int(0)
    # GNINA uses device 0 of the GPUs this process can see; CU_DEVICE_ATTRIBUTE_COMPUTE_CAPABILITY_* are 75, 76.
    if (driver.cuDeviceGet(ctypes.byref(device), 0) != 0 or driver.cuDeviceGetName(name, 256, device) != 0
            or driver.cuDeviceGetAttribute(ctypes.byref(major), 75, device) != 0
            or driver.cuDeviceGetAttribute(ctypes.byref(minor), 76, device) != 0
            or driver.cuDriverGetVersion(ctypes.byref(version)) != 0
            or driver.cuDeviceGetPCIBusId(bus, 64, device) != 0):
        fail("The NVIDIA driver could not describe its GPU.")
    # GNINA 1.3.3 ships compiled GPU code from compute capability 6.0 (Pascal) on, almost none for Maxwell.
    if major.value < 6:
        fail("GNINA 1.3.3 runs on NVIDIA GPUs of compute capability 6.0 (Pascal) or newer; %s is %d.%d."
             % (name.value.decode("utf-8", "replace"), major.value, minor.value))
    return {"index": 0, "name": name.value.decode("utf-8", "replace"),
            "computeCapability": "%d.%d" % (major.value, minor.value),
            "driverCudaVersion": "%d.%d" % (version.value // 1000, version.value % 1000 // 10)}, bus.value


def box_cuda_version():
    """The CUDA runtime the box carries and GNINA runs on, read from the box's own libcudart."""
    version = ctypes.c_int(0)
    runtime = ctypes.CDLL(str(payload_root() / "venv" / "lib" / "libcudart.so.12"))
    if runtime.cudaRuntimeGetVersion(ctypes.byref(version)) != 0:
        fail("The Runtime Box's CUDA runtime could not report its version; reinstall the tool.")
    return "%d.%d" % (version.value // 1000, version.value % 1000 // 10)


class NvmlMemory(ctypes.Structure):
    _fields_ = [("total", ctypes.c_ulonglong), ("free", ctypes.c_ulonglong), ("used", ctypes.c_ulonglong)]


class DeviceMemory:
    """GPU memory while GNINA runs: the device's total use sampled every 50 ms, over a baseline read first.

    NVML attributes no memory to a process under WSL2, so this measures the whole device, the method the
    scientific validator records; like it, it can only over-state. Without NVML the readings stay None:
    they are provenance, and a run never depends on them.
    """

    def __init__(self, bus_id):
        self.handle = None
        self.peak = self.baseline = self.total = None
        self.stopped = threading.Event()
        self.thread = None
        try:
            self.nvml = ctypes.CDLL("libnvidia-ml.so.1")
        except OSError:
            return
        handle = ctypes.c_void_p()
        if self.nvml.nvmlInit_v2() != 0 or self.nvml.nvmlDeviceGetHandleByPciBusId_v2(bus_id, ctypes.byref(handle)) != 0:
            return
        self.handle = handle
        reading = self.read()
        if reading is None:
            self.handle = None
            return
        self.baseline = self.peak = reading.used
        self.total = reading.total
        self.thread = threading.Thread(target=self.sample, daemon=True)
        self.thread.start()

    def read(self):
        memory = NvmlMemory()
        return memory if self.nvml.nvmlDeviceGetMemoryInfo(self.handle, ctypes.byref(memory)) == 0 else None

    def sample(self):
        while not self.stopped.wait(GPU_SAMPLE_SECONDS):
            reading = self.read()
            if reading is None:
                self.peak = None
                return
            self.peak = max(self.peak, reading.used)

    def finish(self):
        self.stopped.set()
        if self.thread is not None:
            self.thread.join(timeout=5)
        if self.handle is None or self.peak is None or self.peak <= self.baseline:
            return {"gpuMemoryBytes": self.total, "peakVramBytes": None, "vramMeasurementMethod": None}
        return {"gpuMemoryBytes": self.total, "peakVramBytes": self.peak - self.baseline,
                "vramMeasurementMethod": "device-wide-delta"}


def gnina_environment():
    library_dir = payload_root() / "venv" / "lib"
    libraries = [library_dir / name for name in PRELOADED_LIBRARIES]
    for library in libraries:
        if not library.is_file():
            fail("The Runtime Box is missing %s; reinstall the tool." % library.name)
    return {**os.environ, "LD_PRELOAD": " ".join(str(path) for path in libraries), "LD_LIBRARY_PATH": str(library_dir)}


def gnina_arguments(receptor, poses, output):
    """Score every pose as it lies, with GNINA's default CNN ensemble, on GPU 0."""
    return ["--receptor", receptor, "--ligand", poses, "--score_only", "--cnn_scoring", "rescore", "--device", "0",
            "--out", output]


def scored_pose(record, pose, label):
    """GNINA's values for one pose, after checking it is that pose, unmoved."""
    properties = sdf_properties(record)
    if (properties.get("liatir_ligand"), properties.get("liatir_pose_rank")) != (pose["ligand"], str(pose["poseRank"])):
        fail("GNINA's output is out of step with the input at %s." % label)
    if heavy_atom_coordinates(record, "GNINA's %s" % label) != heavy_atom_coordinates(pose["lines"], label):
        fail("GNINA moved %s while scoring it." % label)
    values = {}
    for source, _ in GNINA_PROPERTIES:
        if source not in properties:
            fail("GNINA wrote no %s for %s." % (source, label))
        values[source] = finite_number(properties[source], "GNINA's %s for %s" % (source, label))
    return values


def rescore(payload, output_dir, metrics, inputs, started):
    poses_path, receptor_path, poses, receptor_sha256 = inputs
    exe = executable()
    raw_output = output_dir / "gnina-output.sdf"
    log_path = output_dir / "gnina.log"
    # A crash of a 2 GB program must not leave a core file of that size; GNINA inherits the limit.
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    with tempfile.TemporaryDirectory(prefix="gnina-run-") as scratch:
        # The NVIDIA driver creates its compute cache in the user's home as soon as it starts, although
        # nothing here is compiled; the cache lives and dies with the run instead.
        os.environ["CUDA_CACHE_PATH"] = os.path.join(scratch, "nv-cache")
        # An empty working directory: GNINA's RPATH ends in an empty entry, which the loader reads as ".".
        empty = os.path.join(scratch, "cwd")
        os.mkdir(empty)
        device, bus_id = cuda_device()
        device["reportedCudaCompatibility"] = box_cuda_version()
        environment = gnina_environment()
        memory = DeviceMemory(bus_id)
        try:
            with open(log_path, "w", encoding="utf-8") as log:
                completed = subprocess.run([str(exe)] + gnina_arguments(str(receptor_path), str(poses_path),
                                                                        str(raw_output)),
                                           cwd=empty, env=environment, stdout=log, stderr=subprocess.STDOUT,
                                           stdin=subprocess.DEVNULL, check=False)
        finally:
            device.update(memory.finish())
    text = log_path.read_text(encoding="utf-8", errors="replace")
    if completed.returncode != 0:
        fail("GNINA stopped with exit code %d:\n%s" % (completed.returncode, text[-1500:]))
    if GNINA_BUILD not in text:
        fail("The program that ran is not GNINA %s." % GNINA_VERSION)
    if NO_GPU_WARNING in text:
        fail("GNINA could not use the GPU and would have scored on the CPU instead; check the NVIDIA driver.")
    if not raw_output.is_file():
        fail("GNINA wrote no scored poses.")
    records = sdf_blocks(raw_output)
    if len(records) != len(poses):
        fail("GNINA scored %d of the %d poses." % (len(records), len(poses)))
    rows = []
    rescored_path = output_dir / "rescored-poses.sdf"
    with open(rescored_path, "w", encoding="utf-8", newline="\n") as handle:
        for record, pose in zip(records, poses):
            label = "%s rank %d" % (pose["ligand"], pose["poseRank"])
            values = scored_pose(record, pose, label)
            # The pose exactly as docking wrote it, with GNINA's values added as data items.
            lines = list(pose["lines"])
            if lines and lines[-1].strip() == "":
                lines.pop()
            for source, name in GNINA_PROPERTIES:
                lines += [">  <%s>" % name, repr(values[source]), ""]
            handle.write("\n".join(lines) + "\n$$$$\n")
            rows.append({"ligand": pose["ligand"], "poseRank": pose["poseRank"],
                         "vinaScoreKcalPerMol": pose["vinaScoreKcalPerMol"],
                         "gninaVinaScoreKcalPerMol": values["minimizedAffinity"],
                         "cnnPoseScore": values["CNNscore"], "cnnAffinityPk": values["CNNaffinity"],
                         "cnnAffinityVariance": values["CNNaffinity_variance"], "cnnVs": values["CNN_VS"]})
    ligands = []
    for name in dict.fromkeys(row["ligand"] for row in rows):
        mine = [row for row in rows if row["ligand"] == name]
        by_cnn = sorted(mine, key=lambda row: (-row["cnnPoseScore"], row["poseRank"]))
        for rank, row in enumerate(by_cnn, start=1):
            row["cnnRank"] = rank
        best_vina = min(mine, key=lambda row: row["poseRank"])
        ligands.append({"ligand": name, "poses": len(mine), "bestVinaPoseRank": best_vina["poseRank"],
                        "bestCnnPoseRank": by_cnn[0]["poseRank"], "bestCnnPoseScore": by_cnn[0]["cnnPoseScore"],
                        "bestCnnAffinityPk": by_cnn[0]["cnnAffinityPk"],
                        "agree": by_cnn[0]["poseRank"] == best_vina["poseRank"]})
    scores_path = output_dir / "rescoring-scores.csv"
    fields = ["ligand", "poseRank", "cnnRank", "vinaScoreKcalPerMol", "gninaVinaScoreKcalPerMol", "cnnPoseScore",
              "cnnAffinityPk", "cnnAffinityVariance", "cnnVs"]
    with open(scores_path, "w", encoding="utf-8", newline="") as handle:
        table = csv.DictWriter(handle, fieldnames=fields)
        table.writeheader()
        table.writerows(rows)
    plot = {"data": [{"type": "scatter", "mode": "markers", "name": item["ligand"],
                      "x": [row["vinaScoreKcalPerMol"] for row in rows if row["ligand"] == item["ligand"]],
                      "y": [row["cnnPoseScore"] for row in rows if row["ligand"] == item["ligand"]],
                      "text": ["rank %d" % row["poseRank"] for row in rows if row["ligand"] == item["ligand"]]}
                     for item in ligands[:MAX_PLOTTED_LIGANDS]],
            "layout": {"title": "Vina score and CNN pose score of every pose",
                       "xaxis": {"title": "Vina score (kcal/mol, lower ranks first)"},
                       "yaxis": {"title": "CNN pose score (0 to 1)", "range": [0, 1]}}}
    plot_path = output_dir / "rescoring-plot.json"
    write_json_atomic(plot_path, plot)
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.gnina-rescoring-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": {"gnina": GNINA_VERSION, "build": GNINA_BUILD, "executableSha256": EXECUTABLE_SHA256},
        "device": device,
        "inputs": {"posesSha256": sha256_file(poses_path), "receptorPdbqtSha256": receptor_sha256,
                   "poses": len(rows), "ligands": len(ligands)},
        "command": ["gnina"] + gnina_arguments(receptor_path.name, poses_path.name, raw_output.name),
        "ligands": ligands,
        "agreeing": sum(1 for item in ligands if item["agree"]),
        "method": "GNINA %s, score only with its default CNN ensemble, on %s" % (GNINA_VERSION, device["name"]),
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "rescoring-summary.json"
    write_json_atomic(summary_path, summary)
    return {"schemaVersion": 1, "kind": "liatir.gnina-result", "action": "rescore-poses",
            "paths": {"rescoredPosesSdf": str(rescored_path), "scoresCsv": str(scores_path), "plot": str(plot_path),
                      "summaryJson": str(summary_path), "gninaLog": str(log_path)},
            "summary": summary}


def main():
    started = time.time()
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action not in ("preflight-rescore-poses", "rescore-poses"):
        fail("Unsupported GNINA action.")
    metrics, inputs = preflight_rescoring(payload)
    if action == "preflight-rescore-poses":
        print(json.dumps(metrics, separators=(",", ":")))
        return
    require_measured_envelope(payload, metrics)
    raw_output = str(payload.get("outputDir") or "").strip()
    if not raw_output:
        fail("An output directory is required.")
    output_dir = pathlib.Path(raw_output).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    deny_network()
    result = rescore(payload, output_dir, metrics, inputs, started)
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
