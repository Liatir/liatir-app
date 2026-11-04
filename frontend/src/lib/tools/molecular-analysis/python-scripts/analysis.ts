/**
 * Offline analysis adapter shared by Trajectory Analysis and Interaction Fingerprint.
 *
 * Preflight actions read file headers with the Python standard library only. Real actions deny
 * network sockets and import MDAnalysis and ProLIF only after an accepted measured hardware
 * envelope. A ligand's bonds come from its input file; the runner never guesses them.
 */
export const MOLECULAR_ANALYSIS_SCRIPT = String.raw`
"""Offline trajectory analysis and protein-ligand interaction fingerprints.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line.
Preflight actions read file headers with the standard library only, so a request is sized before
the scientific stack loads. Network sockets are denied before any scientific import, and nothing
is guessed about a ligand: its bonds come from the input file or the action refuses.
"""
import csv
import hashlib
import json
import math
import os
import pathlib
import socket
import struct
import sys
import tempfile
import time
import warnings

MDANALYSIS_VERSION = "2.11.0"
PROLIF_VERSION = "2.2.3"
RDKIT_VERSION = "2026.9.1"
RUNTIME_ID = "molecular-analysis-mdanalysis-2-11-0"
MAX_TOPOLOGY_BYTES = 512 * 1024 * 1024
MAX_TRAJECTORY_BYTES = 128 * 1024 * 1024 * 1024
MAX_POSES_BYTES = 256 * 1024 * 1024
MAX_SMALL_FILE_BYTES = 64 * 1024 * 1024
MAX_ATOMS = 5_000_000
MAX_POSES = 100_000
MAX_SERIES = 16
MAX_SELECTION_CHARACTERS = 512
# A distance compares every atom of one selection with every atom of the other in each frame.
MAX_DISTANCE_PAIRS = 25_000_000
# DCD headers store the integration timestep in CHARMM's AKMA time unit.
AKMA_PICOSECONDS = 0.04888821
XTC_MAGIC = 1995
# ProLIF 2.2.3's default interactions, mirrored so a preflight can size a request before ProLIF loads.
DEFAULT_INTERACTIONS = ("Hydrophobic", "HBDonor", "HBAcceptor", "PiStacking", "Anionic", "Cationic",
                        "CationPi", "PiCation", "VdWContact")
# Every explicit-hydrogen interaction ProLIF detects without extra inputs. The implicit-hydrogen
# variants exist for structures without hydrogens, which this tool refuses.
OFFERED_INTERACTIONS = DEFAULT_INTERACTIONS + ("FaceToFace", "EdgeToFace", "XBDonor", "XBAcceptor",
                                               "MetalDonor", "MetalAcceptor")
WATER_NAMES = {"HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "TIP4", "TIP5", "SPC", "SOL", "T3P", "T4P"}
PROTEIN_NAMES = {"ALA", "ARG", "ASN", "ASP", "CYS", "GLN", "GLU", "GLY", "HIS", "ILE", "LEU", "LYS", "MET",
                 "PHE", "PRO", "SER", "THR", "TRP", "TYR", "VAL", "HID", "HIE", "HIP", "HSD", "HSE", "HSP",
                 "CYX", "CYM", "ASH", "GLH", "LYN", "ACE", "NME", "NMA", "MSE"}
DEFAULT_ANALYSIS = {
    "fitSelection": "protein and name CA",
    "rmsd": [{"label": "Protein C-alpha", "selection": "protein and name CA"}],
    "rmsf": {"selection": "protein and name CA"},
    "distances": [],
}
SCIENTIFIC_NOTICE = (
    "Trajectory measures describe the simulation that produced the trajectory, under its force field "
    "and sampling; they are not experimental observations. A detected interaction is a geometric "
    "criterion met in a frame or pose, not a measured binding contribution."
)


def fail(message):
    raise ValueError(message)


def log(message):
    print(message, file=sys.stderr, flush=True)


def deny_network():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local analysis run.")

    def blocked_connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect(sock, address)
        return blocked()

    def blocked_connect_ex(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect_ex(sock, address)
        return blocked()

    socket.socket.connect = blocked_connect
    socket.socket.connect_ex = blocked_connect_ex
    socket.create_connection = blocked
    socket.getaddrinfo = blocked
    socket.gethostbyname = blocked
    socket.gethostbyname_ex = blocked
    socket.gethostbyaddr = blocked


def finite_number(value, label, minimum=None, maximum=None):
    if isinstance(value, bool):
        fail("%s must be a number." % label)
    try:
        number = float(value)
    except (TypeError, ValueError):
        fail("%s must be a number." % label)
    if not math.isfinite(number):
        fail("%s must be finite." % label)
    if minimum is not None and number < minimum:
        fail("%s must be at least %s." % (label, minimum))
    if maximum is not None and number > maximum:
        fail("%s must be at most %s." % (label, maximum))
    return number


def integer(value, label, minimum=None, maximum=None):
    if isinstance(value, bool):
        fail("%s must be an integer." % label)
    try:
        number = int(str(value).strip())
    except (TypeError, ValueError):
        fail("%s must be an integer." % label)
    if minimum is not None and number < minimum:
        fail("%s must be at least %s." % (label, minimum))
    if maximum is not None and number > maximum:
        fail("%s must be at most %s." % (label, maximum))
    return number


def checked_file(raw_path, label, max_bytes, extensions):
    path = pathlib.Path(str(raw_path or "")).expanduser().resolve()
    if not path.is_file():
        fail("%s does not exist: %s" % (label, path.name or raw_path))
    if not any(path.name.lower().endswith(extension) for extension in extensions):
        fail("%s must use one of these formats: %s." % (label, ", ".join(extensions)))
    size = path.stat().st_size
    if size < 1:
        fail("%s is empty." % label)
    if size > max_bytes:
        fail("%s exceeds the %s-byte limit." % (label, max_bytes))
    return path, size


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def write_json_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True, allow_nan=False)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def write_csv(path, header, rows):
    with open(path, "w", encoding="utf-8", newline="") as handle:
        table = csv.writer(handle)
        table.writerow(header)
        table.writerows(rows)


def output_directory(payload):
    raw = str(payload.get("outputDir") or "").strip()
    if not raw:
        fail("An output directory is required.")
    path = pathlib.Path(raw).expanduser().resolve()
    path.mkdir(parents=True, exist_ok=True)
    return path


def require_measured_envelope(payload, metrics):
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before the analysis runtime is loaded.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")


def statistics(values):
    return {"minimum": round(min(values), 4), "maximum": round(max(values), 4),
            "mean": round(sum(values) / len(values), 4), "final": round(values[-1], 4)}


def line_plot(traces, title, x_title, y_title):
    return {"data": [{"type": "scatter", "mode": "lines", "name": name, "x": x, "y": y} for name, x, y in traces],
            "layout": {"title": title, "xaxis": {"title": x_title}, "yaxis": {"title": y_title}}}


# ── stdlib-only input inspection ────────────────────────────────────────────

def pdb_topology(path):
    """Atoms, residues, hydrogens and bond records of the first model of a PDB file."""
    atoms = 0
    hydrogens = 0
    missing_elements = 0
    residues = []
    serials = {}
    duplicate_serials = False
    bonded = set()
    with open(path, encoding="utf-8", errors="replace") as handle:
        for line in handle:
            record = line[:6]
            if record in ("ATOM  ", "HETATM"):
                atoms += 1
                if atoms > MAX_ATOMS:
                    fail("The topology exceeds the %s-atom limit." % MAX_ATOMS)
                if len(line.rstrip("\r\n")) < 54:
                    fail("Topology atom %d has a truncated record." % atoms)
                for offset in (30, 38, 46):
                    finite_number(line[offset:offset + 8], "Topology atom %d coordinate" % atoms)
                serial = line[6:11].strip()
                duplicate_serials = duplicate_serials or serial in serials
                serials[serial] = atoms - 1
                element = line[76:78].strip().upper()
                missing_elements += not element
                hydrogen = element in ("H", "D")
                hydrogens += hydrogen
                key = (line[21].strip(), line[22:27].strip(), line[17:21].strip())
                if not residues or residues[-1]["key"] != key:
                    residues.append({"key": key, "atoms": 0, "hydrogens": 0, "serials": []})
                residues[-1]["atoms"] += 1
                residues[-1]["hydrogens"] += hydrogen
                residues[-1]["serials"].append(serial)
            elif record == "CONECT":
                text = line.rstrip("\r\n")
                for start in range(6, min(len(text), 31), 5):
                    field = text[start:start + 5].strip()
                    if field:
                        bonded.add(field)
            elif record == "ENDMDL":
                break
    if atoms < 1:
        fail("The topology contains no atoms.")
    counts = {"protein": 0, "water": 0, "ion": 0}
    candidates = []
    chains = []
    for residue in residues:
        chain, number, name = residue["key"]
        if chain not in chains:
            chains.append(chain)
        if name in PROTEIN_NAMES:
            counts["protein"] += 1
        elif name in WATER_NAMES:
            counts["water"] += 1
        elif residue["atoms"] == 1:
            counts["ion"] += 1
        elif len(candidates) < 50:
            selection = "resname %s and resid %s" % (name, number) + (" and chainID %s" % chain if chain else "")
            candidates.append({"residueName": name, "chain": chain, "residueNumber": number,
                               "atoms": residue["atoms"], "hydrogens": residue["hydrogens"],
                               "bondRecords": all(serial in bonded for serial in residue["serials"]),
                               "selection": selection})
    return {"atoms": atoms, "residues": len(residues), "chains": chains, "hydrogens": hydrogens,
            "elementsComplete": missing_elements == 0, "bondRecords": len(bonded) > 0,
            "duplicateSerials": duplicate_serials, "proteinResidues": counts["protein"],
            "waterResidues": counts["water"], "ions": counts["ion"], "ligandCandidates": candidates}


def dcd_summary(path, size):
    """Frame count, periodicity and frame times of a CHARMM-format DCD, as MDAnalysis reads them."""
    with open(path, "rb") as handle:
        prefix = handle.read(4)
        if len(prefix) != 4:
            fail("The DCD trajectory is truncated.")
        endian = "<" if struct.unpack("<i", prefix)[0] == 84 else (">" if struct.unpack(">i", prefix)[0] == 84 else None)
        if endian is None:
            fail("The trajectory is not a DCD file.")

        def record():
            head = handle.read(4)
            if len(head) != 4:
                fail("The DCD trajectory has a truncated header.")
            length = struct.unpack(endian + "i", head)[0]
            if length < 0 or length > 1024 * 1024:
                fail("The DCD trajectory has an invalid header record.")
            data = handle.read(length)
            tail = handle.read(4)
            if len(data) != length or len(tail) != 4 or struct.unpack(endian + "i", tail)[0] != length:
                fail("The DCD trajectory has a truncated header.")
            return data

        handle.seek(0)
        header = record()
        if len(header) != 84 or header[:4] != b"CORD":
            fail("The DCD trajectory is not a coordinate trajectory.")
        control = struct.unpack(endian + "20i", header[4:84])
        if control[19] == 0:
            fail("X-PLOR-format DCD files are not supported; write the trajectory in CHARMM format.")
        if control[8] != 0:
            fail("DCD trajectories with fixed atoms are not supported.")
        if control[11] != 0:
            fail("DCD trajectories with a fourth dimension are not supported.")
        delta = struct.unpack(endian + "f", header[40:44])[0]
        record()
        atom_record = record()
        if len(atom_record) != 4:
            fail("The DCD trajectory has no readable atom count.")
        atoms = struct.unpack(endian + "i", atom_record)[0]
        header_bytes = handle.tell()
    periodic = control[10] != 0
    frame_bytes = (56 if periodic else 0) + 3 * (8 + 4 * atoms)
    body = size - header_bytes
    if atoms < 1 or body < frame_bytes:
        fail("The DCD trajectory contains no frames.")
    if body % frame_bytes:
        fail("The DCD trajectory is truncated: its last frame is incomplete.")
    frames = body // frame_bytes
    if control[0] not in (0, frames):
        fail("The DCD header declares %d frames but the file holds %d." % (control[0], frames))
    if not math.isfinite(delta) or delta <= 0 or control[2] < 1:
        fail("The DCD header has no usable timestep or save interval.")
    return {"format": "dcd", "atoms": atoms, "frames": frames, "periodic": periodic,
            "startTimePs": control[1] * delta * AKMA_PICOSECONDS,
            "frameIntervalPs": control[2] * delta * AKMA_PICOSECONDS}


def xtc_summary(path, size):
    """Frame count, periodicity and frame times of a GROMACS XTC file, read frame header by header."""
    frames = 0
    atoms = None
    times = []
    periodic = None
    with open(path, "rb") as handle:
        while True:
            head = handle.read(56)
            if not head:
                break
            if len(head) != 56:
                fail("The XTC trajectory is truncated after frame %d." % frames)
            magic, count, _step = struct.unpack(">3i", head[:12])
            frame_time = struct.unpack(">f", head[12:16])[0]
            box = struct.unpack(">9f", head[16:52])
            if magic != XTC_MAGIC:
                fail("Frame %d of the trajectory is not a supported XTC frame." % (frames + 1))
            if count < 1 or struct.unpack(">i", head[52:56])[0] != count or (atoms is not None and count != atoms):
                fail("The XTC trajectory has inconsistent atom counts.")
            atoms = count
            if count <= 9:
                skip = 12 * count
            else:
                extra = handle.read(36)
                if len(extra) != 36:
                    fail("The XTC trajectory is truncated after frame %d." % frames)
                payload_bytes = struct.unpack(">i", extra[32:36])[0]
                if payload_bytes < 0:
                    fail("The XTC trajectory has an invalid frame.")
                skip = (payload_bytes + 3) // 4 * 4
            if handle.seek(skip, 1) > size:
                fail("The XTC trajectory is truncated: its last frame is incomplete.")
            boxed = any(value != 0.0 for value in box)
            if periodic is None:
                periodic = boxed
            elif periodic != boxed:
                fail("Some XTC frames have a periodic box and others do not.")
            if not math.isfinite(frame_time):
                fail("XTC frame %d has a non-finite time." % (frames + 1))
            times.append(frame_time)
            frames += 1
    if frames < 1:
        fail("The XTC trajectory contains no frames.")
    steps = [times[index + 1] - times[index] for index in range(len(times) - 1)]
    # XTC stores times as 32-bit floats, so equal intervals can differ by the precision of the times.
    tolerance = 2.4e-7 * max(abs(times[0]), abs(times[-1])) + 1e-6
    regular = bool(steps) and all(abs(step - steps[0]) <= tolerance for step in steps)
    return {"format": "xtc", "atoms": atoms, "frames": frames, "periodic": bool(periodic),
            "startTimePs": times[0], "frameIntervalPs": steps[0] if regular else None}


def trajectory_summary(payload, topology):
    path, size = checked_file(payload.get("trajectory"), "Trajectory", MAX_TRAJECTORY_BYTES, (".dcd", ".xtc"))
    summary = dcd_summary(path, size) if path.name.lower().endswith(".dcd") else xtc_summary(path, size)
    if summary["atoms"] != topology["atoms"]:
        fail("The trajectory has %d atoms per frame but the topology has %d. Use the topology written with "
             "this trajectory." % (summary["atoms"], topology["atoms"]))
    return path, size, summary


def state_times(payload, frames):
    """Frame times recorded by the simulation itself, to hold the trajectory's time axis against."""
    if not str(payload.get("stateCsv") or "").strip():
        return None
    path, _ = checked_file(payload["stateCsv"], "Simulation state record", MAX_SMALL_FILE_BYTES, (".csv",))
    with open(path, encoding="utf-8-sig", newline="") as handle:
        rows = list(csv.reader(handle))
    if not rows:
        fail("The simulation state record is empty.")
    header = [name.strip().lstrip("#").strip('"') for name in rows[0]]
    column = next((index for index, name in enumerate(header) if name == "Time (ps)"), None)
    if column is None:
        fail("The simulation state record has no Time (ps) column.")
    times = [finite_number(row[column], "Recorded time") for row in rows[1:] if row]
    if len(times) != frames:
        fail("The simulation state record has %d rows but the trajectory holds %d frames." % (len(times), frames))
    return times


def sdf_blocks(path):
    """The lines of each SDF record.

    A record's first line is its title, which RDKit leaves blank for an unnamed molecule, so records
    are split only at their $$$$ terminators and never trimmed.
    """
    records = [[]]
    with open(path, encoding="utf-8", errors="strict") as handle:
        for line in handle.read().splitlines():
            if line.strip() == "$$$$":
                records.append([])
            else:
                records[-1].append(line)
    return [record for record in records if any(line.strip() for line in record)]


def sdf_poses(path):
    """Atom and hydrogen counts per SDF record, without RDKit."""
    blocks = sdf_blocks(path)
    if not blocks:
        fail("The pose file contains no molecules.")
    if len(blocks) > MAX_POSES:
        fail("The pose file exceeds %s poses." % MAX_POSES)
    largest = 0
    for index, lines in enumerate(blocks):
        if len(lines) < 4 or "V3000" in lines[3]:
            fail("Pose %d is not a complete V2000 SDF record." % (index + 1))
        try:
            count = int(lines[3][0:3])
        except ValueError:
            fail("Pose %d has an unreadable counts line." % (index + 1))
        atom_lines = lines[4:4 + count]
        if count < 1 or len(atom_lines) != count or any(len(line) < 34 for line in atom_lines):
            fail("Pose %d is truncated." % (index + 1))
        if not any(line[31:34].strip() in ("H", "D") for line in atom_lines):
            fail("Pose %d has no hydrogens. Interaction fingerprints need every hydrogen; dock with hydrogens "
                 "added or export poses with hydrogens." % (index + 1))
        largest = max(largest, count)
    return {"poses": len(blocks), "maxPoseAtoms": largest}


# ── request options ─────────────────────────────────────────────────────────

def selection_text(value, label):
    text = " ".join(str(value or "").split())
    if not text:
        fail("%s needs an atom selection." % label)
    if len(text) > MAX_SELECTION_CHARACTERS:
        fail("%s is longer than %d characters." % (label, MAX_SELECTION_CHARACTERS))
    return text


def series_label(value, used):
    text = " ".join(str(value or "").split())
    if not text or len(text) > 64:
        fail("Every measurement needs a name of 1 to 64 characters.")
    if text.lower() in used:
        fail("Two measurements are both named %s." % text)
    used.add(text.lower())
    return text


def frame_window(options, frames):
    start = integer(options.get("start", 0), "First frame", 0, frames - 1)
    raw_stop = options.get("stop")
    stop = frames if raw_stop in (None, "") else integer(raw_stop, "Frame range end", start + 1, frames)
    stride = integer(options.get("stride", 1), "Frame step", 1, frames)
    return {"start": start, "stop": stop, "stride": stride, "frames": len(range(start, stop, stride))}


def analysis_options(payload, frames):
    raw = {**DEFAULT_ANALYSIS, **(payload.get("analysis") or {})}
    used = set()
    rmsd = [{"label": series_label(item.get("label"), used),
             "selection": selection_text(item.get("selection"), "An RMSD measurement")} for item in raw["rmsd"] or []]
    distances = [{"label": series_label(item.get("label"), used),
                  "selectionA": selection_text(item.get("selectionA"), "A distance's first group"),
                  "selectionB": selection_text(item.get("selectionB"), "A distance's second group")}
                 for item in raw["distances"] or []]
    rmsf = raw["rmsf"]
    if len(rmsd) > MAX_SERIES or len(distances) > MAX_SERIES:
        fail("Choose at most %d RMSD and %d distance measurements." % (MAX_SERIES, MAX_SERIES))
    if not rmsd and not distances and not rmsf:
        fail("Choose at least one measurement.")
    return {"fitSelection": selection_text(raw["fitSelection"], "The superposition"), "rmsd": rmsd,
            "rmsf": {"selection": selection_text(rmsf.get("selection"), "RMSF")} if rmsf else None,
            "distances": distances, "window": frame_window(raw, frames)}


def interaction_names(options):
    names = options.get("interactions")
    if names is None:
        return list(DEFAULT_INTERACTIONS)
    if not isinstance(names, list) or not names:
        fail("Choose at least one interaction.")
    if any(name not in OFFERED_INTERACTIONS for name in names):
        fail("Interactions must be chosen from: %s." % ", ".join(OFFERED_INTERACTIONS))
    return sorted(set(names), key=OFFERED_INTERACTIONS.index)


def frames_read(window, periodic):
    # Unwrapping a periodic trajectory follows every atom from one frame to the next, so every frame
    # up to the last analysed one is read even when only some are analysed.
    return window["stop"] if periodic else window["frames"]


def preflight_trajectory(payload):
    topology_path, topology_bytes = checked_file(payload.get("topology"), "Topology", MAX_TOPOLOGY_BYTES, (".pdb",))
    topology = pdb_topology(topology_path)
    trajectory_path, trajectory_bytes, trajectory = trajectory_summary(payload, topology)
    options = analysis_options(payload, trajectory["frames"])
    times = state_times(payload, trajectory["frames"])
    series = len(options["rmsd"]) + 2 * len(options["distances"]) + (1 if options["rmsf"] else 0)
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-analysis-preflight",
        "action": "analyze-trajectory",
        "workloadId": "mdanalysis:trajectory-analysis",
        "tokenCount": series,
        "atomCount": topology["atoms"],
        "stepCount": frames_read(options["window"], trajectory["periodic"]),
        "outputItemCount": options["window"]["frames"],
        "topology": topology,
        "trajectory": trajectory,
        "stateRecordFrames": None if times is None else len(times),
        "options": options,
        "inputBytes": topology_bytes + trajectory_bytes,
        "networkAccess": False,
    }


def preflight_fingerprint(payload):
    options = payload.get("fingerprint") or {}
    interactions = interaction_names(options)
    protein_selection = selection_text(options.get("proteinSelection", "protein"), "The protein")
    source = payload.get("source")
    if source == "trajectory":
        topology_path, topology_bytes = checked_file(payload.get("topology"), "Topology", MAX_TOPOLOGY_BYTES,
                                                     (".pdb",))
        topology = pdb_topology(topology_path)
        trajectory_path, trajectory_bytes, trajectory = trajectory_summary(payload, topology)
        window = frame_window(options, trajectory["frames"])
        details = {"topology": topology, "trajectory": trajectory, "window": window,
                   "ligandSelection": selection_text(options.get("ligandSelection"), "The ligand")}
        workload = ("prolif:trajectory-fingerprint", topology["atoms"], frames_read(window, trajectory["periodic"]),
                    window["frames"])
        input_bytes = topology_bytes + trajectory_bytes
    elif source == "poses":
        receptor_path, receptor_bytes = checked_file(payload.get("receptor"), "Receptor structure",
                                                     MAX_TOPOLOGY_BYTES, (".pdb",))
        topology = pdb_topology(receptor_path)
        poses_path, poses_bytes = checked_file(payload.get("poses"), "Poses", MAX_POSES_BYTES, (".sdf",))
        poses = sdf_poses(poses_path)
        details = {"topology": topology, "poses": poses}
        workload = ("prolif:pose-fingerprint", topology["atoms"], poses["poses"], poses["poses"])
        input_bytes = receptor_bytes + poses_bytes
    else:
        fail("Interaction fingerprints read a trajectory or a set of docked poses.")
    if not topology["elementsComplete"]:
        fail("Interaction fingerprints need an element symbol for every atom (PDB columns 77-78).")
    if topology["hydrogens"] == 0:
        fail("Interaction fingerprints need explicit hydrogens, and this structure has none.")
    if topology["duplicateSerials"] and topology["bondRecords"]:
        fail("The structure repeats atom serial numbers (it has more than 99,999 atoms), so its bond records "
             "are ambiguous.")
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-analysis-preflight",
        "action": "fingerprint",
        "source": source,
        "workloadId": workload[0],
        "tokenCount": len(interactions),
        "atomCount": workload[1],
        "stepCount": workload[2],
        "outputItemCount": workload[3],
        "interactions": interactions,
        "proteinSelection": protein_selection,
        **details,
        "inputBytes": input_bytes,
        "networkAccess": False,
    }


# ── shared scientific helpers ───────────────────────────────────────────────

def versions():
    import importlib.metadata
    found = {name: importlib.metadata.version(name) for name in ("MDAnalysis", "prolif", "rdkit")}
    for name, expected in (("MDAnalysis", MDANALYSIS_VERSION), ("prolif", PROLIF_VERSION), ("rdkit", RDKIT_VERSION)):
        if found[name] != expected:
            fail("Installed %s %s is not the reviewed %s." % (name, found[name], expected))
    return found


def load_universe(topology, trajectory, metrics, scratch):
    """Opens the trajectory through a link in this run's scratch directory.

    MDAnalysis caches an XTC file's frame offsets in hidden files beside the path it opens. Through the
    link they land in the scratch directory, so neither the user's data nor the Runtime Box is written to.
    """
    import MDAnalysis as mda
    link = scratch / trajectory.name
    link.symlink_to(trajectory)
    universe = mda.Universe(str(topology), str(link))
    if universe.atoms.n_atoms != metrics["topology"]["atoms"] or universe.trajectory.n_frames != metrics["trajectory"]["frames"]:
        fail("MDAnalysis read a different atom or frame count than the preflight.")
    return universe


def pick(universe, text, label, minimum=1):
    from MDAnalysis.exceptions import SelectionError
    try:
        group = universe.select_atoms(text)
    except (SelectionError, ValueError, TypeError, KeyError) as error:
        fail("%s selection '%s' is not valid: %s" % (label, text, error))
    if len(group) < minimum:
        fail("%s selection '%s' matched %d atoms; it needs at least %d." % (label, text, len(group), minimum))
    return group


def analysed_frames(universe, window, periodic, times):
    """Yields the analysed timesteps after checking each one.

    NoJump unwraps an atom from its position in the previous frame, so a periodic trajectory is read
    in order from its first frame even when only some frames are analysed.
    """
    import numpy as np
    frames = universe.trajectory[0:window["stop"]] if periodic else universe.trajectory[window["start"]:window["stop"]:window["stride"]]
    for ts in frames:
        if periodic and (ts.frame < window["start"] or (ts.frame - window["start"]) % window["stride"]):
            continue
        if not np.isfinite(universe.atoms.positions).all():
            fail("Frame %d holds a non-finite coordinate." % ts.frame)
        if periodic and (ts.dimensions is None or not all(value > 0 for value in ts.dimensions[:3])):
            fail("Frame %d has no periodic box although the trajectory is periodic." % ts.frame)
        if times is not None and abs(ts.time - times[ts.frame]) > 1e-4 + 1e-6 * abs(times[ts.frame]):
            fail("Frame %d is at %.6f ps in the trajectory but %.6f ps in the simulation's state record."
                 % (ts.frame, ts.time, times[ts.frame]))
        yield ts


def chain_of(atom):
    chain = getattr(atom, "chainID", "") or ""
    return chain.strip() or (getattr(atom, "segid", "") or "").strip()


# ── trajectory analysis ─────────────────────────────────────────────────────

def analyze_trajectory(payload, output_dir, metrics, scratch):
    import numpy as np
    from MDAnalysis.analysis.align import rotation_matrix
    from MDAnalysis.lib.distances import calc_bonds, distance_array
    from MDAnalysis.transformations.nojump import NoJump

    started = time.time()
    found_versions = versions()
    options = metrics["options"]
    window = options["window"]
    periodic = metrics["trajectory"]["periodic"]
    topology, _ = checked_file(payload.get("topology"), "Topology", MAX_TOPOLOGY_BYTES, (".pdb",))
    trajectory, _ = checked_file(payload.get("trajectory"), "Trajectory", MAX_TRAJECTORY_BYTES, (".dcd", ".xtc"))
    times = state_times(payload, metrics["trajectory"]["frames"])
    universe = load_universe(topology, trajectory, metrics, scratch)
    if periodic:
        universe.trajectory.add_transformations(NoJump())
    fit = pick(universe, options["fitSelection"], "The superposition", minimum=3)
    rmsd_groups = [(item, pick(universe, item["selection"], "RMSD %s" % item["label"])) for item in options["rmsd"]]
    rmsf_group = pick(universe, options["rmsf"]["selection"], "RMSF") if options["rmsf"] else None
    distance_groups = []
    for item in options["distances"]:
        first = pick(universe, item["selectionA"], "Distance %s" % item["label"])
        second = pick(universe, item["selectionB"], "Distance %s" % item["label"])
        if len(first) * len(second) > MAX_DISTANCE_PAIRS:
            fail("Distance %s compares %d with %d atoms; choose smaller groups." % (item["label"], len(first), len(second)))
        distance_groups.append((item, first, second))

    rows = []
    reference = None
    rmsf_count = 0
    rmsf_mean = rmsf_m2 = None
    for ts in analysed_frames(universe, window, periodic, times):
        fit_xyz = fit.positions.astype(np.float64)
        fit_center = fit_xyz.mean(axis=0)
        if reference is None:
            reference = {"frame": int(ts.frame), "timePs": float(ts.time), "center": fit_center,
                         "fit": fit_xyz - fit_center,
                         "rmsd": [group.positions.astype(np.float64) for _, group in rmsd_groups]}
        # Least-squares superposition (QCP) onto the reference frame; MDAnalysis returns R with b = R·a.
        rotation, _ = rotation_matrix(fit_xyz - fit_center, reference["fit"])
        rotation = np.asarray(rotation)

        def aligned(group):
            return (group.positions.astype(np.float64) - fit_center) @ rotation.T + reference["center"]

        row = [int(ts.frame), float(ts.time)]
        for (_, group), target in zip(rmsd_groups, reference["rmsd"]):
            delta = aligned(group) - target
            row.append(math.sqrt(float((delta * delta).sum()) / len(group)))
        if rmsf_group is not None:
            # Welford's running mean and squared deviation of each aligned atom.
            rmsf_count += 1
            current = aligned(rmsf_group)
            if rmsf_mean is None:
                rmsf_mean = np.zeros_like(current)
                rmsf_m2 = np.zeros_like(current)
            step = current - rmsf_mean
            rmsf_mean += step / rmsf_count
            rmsf_m2 += step * (current - rmsf_mean)
        box = ts.dimensions if periodic else None
        for _, first, second in distance_groups:
            row.append(float(distance_array(first.positions, second.positions, box=box).min()))
            row.append(float(calc_bonds(first.center_of_geometry()[None, :], second.center_of_geometry()[None, :],
                                        box=box)[0]))
        rows.append(row)
    if len(rows) != window["frames"]:
        fail("Analysed %d frames where the preflight accepted %d." % (len(rows), window["frames"]))

    paths = {}
    times_ps = [row[1] for row in rows]
    rmsd_summary = []
    if rmsd_groups:
        path = output_dir / "rmsd.csv"
        write_csv(path, ["Frame", "Time (ps)"] + ["%s RMSD (Å)" % item["label"] for item, _ in rmsd_groups],
                  [[row[0], "%.6f" % row[1]] + ["%.4f" % value for value in row[2:2 + len(rmsd_groups)]] for row in rows])
        paths["rmsdCsv"] = str(path)
        traces = []
        for index, (item, group) in enumerate(rmsd_groups):
            values = [row[2 + index] for row in rows]
            traces.append((item["label"], times_ps, [round(value, 4) for value in values]))
            rmsd_summary.append({**item, "atoms": len(group), **statistics(values)})
        plot = output_dir / "rmsd-plot.json"
        write_json_atomic(plot, line_plot(traces, "RMSD from the first analysed frame", "Time (ps)", "RMSD (Å)"))
        paths["rmsdPlot"] = str(plot)
    rmsf_summary = None
    if rmsf_group is not None:
        values = np.sqrt(rmsf_m2.sum(axis=1) / rmsf_count)
        path = output_dir / "rmsf.csv"
        write_csv(path, ["Atom index", "Chain", "Residue name", "Residue number", "Atom name", "RMSF (Å)"],
                  [[int(atom.index) + 1, chain_of(atom), atom.resname, int(atom.resid), atom.name, "%.4f" % value]
                   for atom, value in zip(rmsf_group, values)])
        paths["rmsfCsv"] = str(path)
        by_chain = {}
        for atom, value in zip(rmsf_group, values):
            entry = by_chain.setdefault(chain_of(atom) or "-", ([], []))
            entry[0].append(int(atom.resid))
            entry[1].append(round(float(value), 4))
        plot = output_dir / "rmsf-plot.json"
        write_json_atomic(plot, line_plot([("Chain %s" % chain, x, y) for chain, (x, y) in by_chain.items()],
                                          "Fluctuation of each atom (RMSF)", "Residue number", "RMSF (Å)"))
        paths["rmsfPlot"] = str(plot)
        rmsf_summary = {**options["rmsf"], "atoms": len(rmsf_group), "frames": rmsf_count,
                        "maximum": round(float(values.max()), 4), "mean": round(float(values.mean()), 4)}
    distance_summary = []
    if distance_groups:
        offset = 2 + len(rmsd_groups)
        header = ["Frame", "Time (ps)"]
        traces = []
        for index, (item, first, second) in enumerate(distance_groups):
            header += ["%s minimum distance (Å)" % item["label"], "%s centroid distance (Å)" % item["label"]]
            minimum = [row[offset + 2 * index] for row in rows]
            centroid = [row[offset + 2 * index + 1] for row in rows]
            traces += [("%s (minimum)" % item["label"], times_ps, [round(value, 4) for value in minimum]),
                       ("%s (centroid)" % item["label"], times_ps, [round(value, 4) for value in centroid])]
            distance_summary.append({**item, "atomsA": len(first), "atomsB": len(second),
                                     "minimumDistance": statistics(minimum), "centroidDistance": statistics(centroid)})
        path = output_dir / "distances.csv"
        write_csv(path, header, [[row[0], "%.6f" % row[1]] + ["%.4f" % value for value in row[offset:]] for row in rows])
        paths["distancesCsv"] = str(path)
        plot = output_dir / "distances-plot.json"
        write_json_atomic(plot, line_plot(traces, "Distances", "Time (ps)", "Distance (Å)"))
        paths["distancesPlot"] = str(plot)

    summary = {
        "schemaVersion": 1,
        "kind": "liatir.trajectory-analysis-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": found_versions,
        "inputs": {"topologySha256": sha256_file(topology), "trajectorySha256": sha256_file(trajectory)},
        "trajectory": metrics["trajectory"],
        "window": window,
        "framesAnalysed": len(rows),
        "periodic": periodic,
        # Unwrapping changes no distance between atoms in contact; it only removes the jumps an atom
        # makes when it leaves the box and re-enters on the opposite face.
        "periodicTreatment": "MDAnalysis NoJump unwrapping; distances use the minimum image" if periodic else None,
        "stateRecordChecked": times is not None,
        "reference": {"kind": "first-analysed-frame", "frame": reference["frame"], "timePs": reference["timePs"]},
        "superposition": {"selection": options["fitSelection"], "atoms": len(fit),
                          "method": "unweighted least-squares superposition (QCP, MDAnalysis)"},
        "rmsd": rmsd_summary,
        "rmsf": rmsf_summary,
        "distances": distance_summary,
        "units": {"length": "Å", "time": "ps"},
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "trajectory-analysis.json"
    write_json_atomic(summary_path, summary)
    paths["summaryJson"] = str(summary_path)
    return {"schemaVersion": 1, "kind": "liatir.molecular-analysis-result", "action": "analyze-trajectory",
            "paths": paths, "summary": summary}


# ── interaction fingerprints ────────────────────────────────────────────────

def add_disulfides(universe, protein):
    """Bonds cysteine sulfurs by OpenMM's rule: two SG atoms without a hydrogen within 0.3 nm.

    MDAnalysis's van der Waals criterion bonds two sulfurs only below 1.98 Å, so it misses the 2.0-2.1 Å
    disulfide, and an unbonded SG would then be read as a charged thiolate.
    """
    from MDAnalysis.lib.distances import capped_distance
    sulfurs = [atom for atom in protein.select_atoms("resname CYS CYX CYM and name SG")
               if not any(neighbour.element in ("H", "D") for neighbour in atom.bonded_atoms)]
    if len(sulfurs) < 2:
        return 0
    positions = universe.atoms[[atom.index for atom in sulfurs]].positions
    pairs = [(int(i), int(j)) for i, j in capped_distance(positions, positions, 3.0, box=universe.dimensions,
                                                         return_distances=False) if i < j]
    partners = {}
    for i, j in pairs:
        partners[i] = partners.get(i, 0) + 1
        partners[j] = partners.get(j, 0) + 1
    crowded = [sulfurs[index] for index, count in partners.items() if count > 1]
    if crowded:
        atom = crowded[0]
        fail("Cysteine %s%d has more than one possible disulfide partner within 3 Å; supply a topology that records "
             "its bonds." % (atom.resname, atom.resid))
    added = [(sulfurs[i].index, sulfurs[j].index) for i, j in pairs if sulfurs[j] not in sulfurs[i].bonded_atoms]
    if added:
        universe.add_bonds(added)
    return len(added)


def ensure_protein_bonds(universe, protein):
    """Standard residues need bonds that a PDB from OpenMM or PDBFixer does not record.

    Missing bonds are derived from interatomic distances with MDAnalysis's van der Waals criterion and
    disulfides by OpenMM's rule, added to any the file records, and accepted only if every hydrogen
    then has exactly one bond.
    """
    if hasattr(universe.atoms, "bonds") and all(len(atom.bonds) for atom in protein):
        method = "topology"
    else:
        try:
            protein.guess_bonds()
        except ValueError as error:
            fail("The protein's bonds could not be derived from its coordinates: %s" % error)
        add_disulfides(universe, protein)
        method = "distance-derived"
    for atom in protein:
        if atom.element in ("H", "D") and len(atom.bonds) != 1:
            fail("Hydrogen %d (%s %s%d) has %d bonds, so the protein's connectivity is not reliable."
                 % (atom.index + 1, atom.name, atom.resname, atom.resid, len(atom.bonds)))
    return method


def require_ligand_bonds(universe, ligand):
    if len(ligand) == 1:
        return
    if not hasattr(universe.atoms, "bonds") or any(len(atom.bonds) == 0 for atom in ligand):
        fail("The ligand has no bond records in the topology. Supply a topology whose CONECT records include "
             "the ligand, such as the one OpenMM writes.")


def same_chemistry(Chem, perceived, reference_path):
    """The ligand ProLIF perceives from the trajectory must be the molecule that was simulated."""
    supplier = Chem.SDMolSupplier(str(reference_path), removeHs=False, sanitize=True)
    if len(supplier) != 1 or supplier[0] is None:
        fail("The ligand reference SDF must contain exactly one readable molecule.")

    def constitution(molecule):
        return Chem.MolToSmiles(Chem.RemoveHs(Chem.Mol(molecule)), isomericSmiles=False)

    found, expected = constitution(perceived), constitution(supplier[0])
    if found != expected:
        fail("The ligand read from the trajectory (%s) is not the reference molecule (%s)." % (found, expected))
    return expected


def interaction_parameters(fingerprint):
    """The geometric thresholds each interaction applied, for the record."""
    parameters = {}
    for name, interaction in fingerprint.interactions.items():
        values = {}
        for key, value in vars(interaction).items():
            if key.startswith("_"):
                continue
            if isinstance(value, (int, float, str)) and not isinstance(value, bool):
                values[key] = value
            elif isinstance(value, (tuple, list)) and all(isinstance(item, (int, float)) for item in value):
                values[key] = list(value)
        parameters[name] = values
    return parameters


def periodic_contacts_guard(ligand, protein, ts, cutoff):
    """Refuses a frame whose contacts would differ between the placed system and its periodic images."""
    from MDAnalysis.lib.distances import capped_distance
    placed = capped_distance(ligand.positions, protein.positions, cutoff, return_distances=False)
    imaged = capped_distance(ligand.positions, protein.positions, cutoff, box=ts.dimensions, return_distances=False)
    if set(map(tuple, placed)) != set(map(tuple, imaged)):
        fail("In frame %d the ligand touches a periodic image of the protein, so its contacts cannot be read from "
             "one copy of the system." % ts.frame)


def fingerprint(payload, output_dir, metrics, scratch):
    import MDAnalysis as mda
    import prolif
    from prolif.fingerprint import DEFAULT_INTERACTIONS as PROLIF_DEFAULTS
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog("rdApp.*")

    started = time.time()
    found_versions = versions()
    if tuple(PROLIF_DEFAULTS) != DEFAULT_INTERACTIONS:
        fail("ProLIF's default interactions differ from the reviewed set.")
    source = metrics["source"]
    fp = prolif.Fingerprint(metrics["interactions"], count=False)
    ligand_identity = None
    entries = []
    inputs = {}
    if source == "trajectory":
        from MDAnalysis import transformations
        from MDAnalysis.transformations.nojump import NoJump
        topology, _ = checked_file(payload.get("topology"), "Topology", MAX_TOPOLOGY_BYTES, (".pdb",))
        trajectory, _ = checked_file(payload.get("trajectory"), "Trajectory", MAX_TRAJECTORY_BYTES, (".dcd", ".xtc"))
        universe = load_universe(topology, trajectory, metrics, scratch)
        ligand = pick(universe, metrics["ligandSelection"], "The ligand")
        protein = pick(universe, metrics["proteinSelection"], "The protein")
        if len(ligand & protein):
            fail("The ligand and protein selections share atoms.")
        for label, group in (("ligand", ligand), ("protein", protein)):
            if not any(element in ("H", "D") for element in group.elements):
                fail("The %s has no hydrogens; interaction fingerprints need every hydrogen." % label)
        require_ligand_bonds(universe, ligand)
        protein_bonds = ensure_protein_bonds(universe, protein)
        if str(payload.get("ligandReferenceSdf") or "").strip():
            reference, _ = checked_file(payload["ligandReferenceSdf"], "Ligand reference SDF", MAX_SMALL_FILE_BYTES,
                                        (".sdf",))
            ligand_identity = same_chemistry(Chem, prolif.Molecule.from_mda(ligand), reference)
            inputs["ligandReferenceSha256"] = sha256_file(reference)
        periodic = metrics["trajectory"]["periodic"]
        if periodic:
            # Continuous coordinates first, then the protein at the box centre and the ligand in the copy
            # of the box around it; each frame is then checked against every periodic image.
            universe.trajectory.add_transformations(NoJump(), transformations.center_in_box(protein, center="geometry"),
                                                    transformations.wrap(ligand, compound="group"))
        times = {}

        def frames():
            for ts in analysed_frames(universe, metrics["window"], periodic, None):
                if periodic:
                    periodic_contacts_guard(ligand, protein, ts, fp.vicinity_cutoff)
                times[int(ts.frame)] = float(ts.time)
                yield ts

        fp.run(frames(), ligand, protein, residues=None, progress=False, n_jobs=1, parallel_strategy="chunk")
        if len(times) != metrics["window"]["frames"] or set(fp.ifp) != set(times):
            fail("ProLIF fingerprinted %d frames where the preflight accepted %d." % (len(fp.ifp), metrics["window"]["frames"]))
        for frame in sorted(times):
            entries.append((frame, {"Frame": frame, "Time (ps)": "%.6f" % times[frame]}))
        ligand_indices, protein_indices = ligand.indices, protein.indices
        inputs.update({"topologySha256": sha256_file(topology), "trajectorySha256": sha256_file(trajectory)})
        ligand_bonds = "topology"
    else:
        receptor, _ = checked_file(payload.get("receptor"), "Receptor structure", MAX_TOPOLOGY_BYTES, (".pdb",))
        poses_path, _ = checked_file(payload.get("poses"), "Poses", MAX_POSES_BYTES, (".sdf",))
        universe = mda.Universe(str(receptor))
        protein = pick(universe, metrics["proteinSelection"], "The protein")
        if not any(element in ("H", "D") for element in protein.elements):
            fail("The protein has no hydrogens; interaction fingerprints need every hydrogen.")
        protein_bonds = ensure_protein_bonds(universe, protein)
        protein_mol = prolif.Molecule.from_mda(protein)
        supplier = Chem.SDMolSupplier(str(poses_path), removeHs=False, sanitize=True)
        poses = []
        for index, molecule in enumerate(supplier):
            if molecule is None:
                fail("Pose %d could not be read as a molecule." % (index + 1))
            poses.append(prolif.Molecule.from_rdkit(molecule))
            props = molecule.GetPropsAsDict()
            entries.append((index, {
                "Pose": index + 1,
                "Ligand": str(props.get("liatir_ligand", molecule.GetProp("_Name") if molecule.HasProp("_Name") else "")),
                "Pose rank": props.get("liatir_pose_rank", ""),
                "Vina score (kcal/mol)": props.get("vina_score_kcal_per_mol", ""),
            }))
        if len(poses) != metrics["poses"]["poses"]:
            fail("RDKit read %d poses where the preflight counted %d." % (len(poses), metrics["poses"]["poses"]))
        fp.run_from_iterable(poses, protein_mol, residues=None, progress=False, n_jobs=1)
        if set(fp.ifp) != set(range(len(poses))):
            fail("ProLIF fingerprinted %d poses of %d." % (len(fp.ifp), len(poses)))
        ligand_indices, protein_indices = None, protein.indices
        inputs.update({"receptorSha256": sha256_file(receptor), "posesSha256": sha256_file(poses_path)})
        ligand_bonds = "sdf"

    key_name = "Frame" if source == "trajectory" else "Pose"
    context_header = list(entries[0][1].keys())
    rows = []
    counts = {}
    for key, context in entries:
        for (ligand_residue, protein_residue), found in fp.ifp[key].items():
            for interaction, occurrences in found.items():
                pair = (str(ligand_residue), str(protein_residue), interaction)
                counts[pair] = counts.get(pair, 0) + 1
                first = occurrences[0]
                parents = first.get("parent_indices", {})
                ligand_atoms = [int(index) + 1 if ligand_indices is None else int(ligand_indices[index]) + 1
                                for index in parents.get("ligand", ())]
                protein_atoms = [int(protein_indices[index]) + 1 for index in parents.get("protein", ())]
                distance = first.get("distance")
                rows.append([context[name] for name in context_header] + [
                    pair[0], pair[1], interaction, "" if distance is None else "%.3f" % float(distance),
                    " ".join(map(str, ligand_atoms)), " ".join(map(str, protein_atoms))])
    interactions_path = output_dir / "interactions.csv"
    write_csv(interactions_path, context_header + ["Ligand residue", "Protein residue", "Interaction", "Distance (Å)",
                                                   "Ligand atoms", "Protein atoms"], rows)
    total = len(entries)
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    frequencies_path = output_dir / "interaction-frequencies.csv"
    write_csv(frequencies_path, ["Ligand residue", "Protein residue", "Interaction", "%ss" % key_name, "Fraction"],
              [[pair[0], pair[1], pair[2], count, "%.4f" % (count / total)] for pair, count in ranked])
    columns = [pair for pair, _ in sorted(counts.items(), key=lambda item: item[0])]
    matrix_path = output_dir / "fingerprint-matrix.csv"
    present = {key: {(str(l), str(p), name) for (l, p), found in fp.ifp[key].items() for name in found}
               for key, _ in entries}
    write_csv(matrix_path, [key_name] + ["%s|%s|%s" % pair for pair in columns],
              [[context[key_name]] + [int(pair in present[key]) for pair in columns] for key, context in entries])
    top = ranked[:40]
    plot_path = output_dir / "interaction-plot.json"
    write_json_atomic(plot_path, {
        "data": [{"type": "bar", "orientation": "h", "x": [round(count / total, 4) for _, count in reversed(top)],
                  "y": ["%s %s" % (pair[1], pair[2]) for pair, _ in reversed(top)]}],
        "layout": {"title": "How often each interaction occurs", "xaxis": {"title": "Fraction of %ss" % key_name.lower()},
                   "yaxis": {"automargin": True}},
    })
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.interaction-fingerprint-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": found_versions,
        "source": source,
        "inputs": inputs,
        "interactions": metrics["interactions"],
        "parameters": interaction_parameters(fp),
        "vicinityCutoffAngstrom": fp.vicinity_cutoff,
        "proteinSelection": metrics["proteinSelection"],
        "ligandSelection": metrics.get("ligandSelection"),
        "ligandReference": ligand_identity,
        "bonds": {"protein": protein_bonds, "ligand": ligand_bonds},
        "periodicTreatment": ("MDAnalysis NoJump, protein centred in the box, ligand wrapped as one group; every frame "
                              "checked against all periodic images" if source == "trajectory"
                              and metrics["trajectory"]["periodic"] else None),
        "window": metrics.get("window"),
        "count": total,
        "distinctInteractions": len(counts),
        "mostFrequent": [{"ligandResidue": pair[0], "proteinResidue": pair[1], "interaction": pair[2],
                          "count": count, "fraction": round(count / total, 4)} for pair, count in ranked[:25]],
        "scientificNotice": SCIENTIFIC_NOTICE,
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "interaction-fingerprint.json"
    write_json_atomic(summary_path, summary)
    return {"schemaVersion": 1, "kind": "liatir.molecular-analysis-result", "action": "fingerprint",
            "paths": {"interactionsCsv": str(interactions_path), "frequenciesCsv": str(frequencies_path),
                      "matrixCsv": str(matrix_path), "plot": str(plot_path), "summaryJson": str(summary_path)},
            "summary": summary}


def main():
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action == "preflight-trajectory":
        print(json.dumps(preflight_trajectory(payload), separators=(",", ":")))
        return
    if action == "preflight-fingerprint":
        print(json.dumps(preflight_fingerprint(payload), separators=(",", ":")))
        return
    deny_network()
    # MDAnalysis announces API moves planned for its 3.0 release; they change nothing in 2.11.
    warnings.filterwarnings("ignore", category=DeprecationWarning)
    if action not in ("analyze-trajectory", "fingerprint"):
        fail("Unsupported analysis action.")
    metrics = preflight_trajectory(payload) if action == "analyze-trajectory" else preflight_fingerprint(payload)
    require_measured_envelope(payload, metrics)
    output_dir = output_directory(payload)
    os.environ["MPLCONFIGDIR"] = str(output_dir / ".matplotlib")
    with tempfile.TemporaryDirectory(prefix="liatir-analysis-") as scratch:
        run = analyze_trajectory if action == "analyze-trajectory" else fingerprint
        result = run(payload, output_dir, metrics, pathlib.Path(scratch))
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
