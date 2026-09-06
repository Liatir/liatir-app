/**
 * Offline OpenMM adapter shared by the lightweight preflight and both simulation tools.
 *
 * The preflight path deliberately stays inside the Python standard library. A real run repeats
 * those checks, requires an accepted measured hardware envelope, denies network sockets, and only
 * then imports OpenMM and the optional ligand-parameterization stack.
 */
export const OPENMM_SCRIPT = String.raw`
import csv
import hashlib
import json
import math
import os
import pathlib
import random
import shlex
import socket
import struct
import sys
import tempfile

MAX_STRUCTURE_BYTES = 64 * 1024 * 1024
MAX_LIGAND_BYTES = 16 * 1024 * 1024
MAX_CHECKPOINT_BYTES = 8 * 1024 * 1024 * 1024
MAX_CHECKPOINT_METADATA_BYTES = 64 * 1024 * 1024
MAX_ATOMS = 2_000_000
OPENMM_VERSION = "8.5.1"
OPENMMFORCEFIELDS_VERSION = "0.16.0"
OPENFF_TOOLKIT_VERSION = "0.17.1"
OPENFF_FORCEFIELDS_VERSION = "2026.1.0"
OPENFF_NAGL_MODELS_VERSION = "2025.9.0"
OPENMM_RUNTIME_ID = "molecular-simulation-openmm-8-5-1"
PROTEIN_FORCE_FIELD = "amber19-all"
WATER_FORCE_FIELD = "tip3p-fb"
OPENFF_FORCE_FIELD = "openff-2.3.0"
NAGL_CHARGE_MODEL = "openff-gnn-am1bcc-1.0.0.pt"
NAGL_CHARGE_MODEL_SHA256 = "7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee"
FORCE_FIELD_ID = "amber19-all+tip3p-fb+openff-2.3.0+nagl-am1bcc-1.0.0"
TIMESTEP_FS = 2

def fail(message):
    raise ValueError(message)

def finite_number(value, label, minimum=None, maximum=None):
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
        number = int(value)
    except (TypeError, ValueError):
        fail("%s must be an integer." % label)
    if str(value).strip() not in (str(number), "%s.0" % number):
        fail("%s must be an integer." % label)
    if minimum is not None and number < minimum:
        fail("%s must be at least %s." % (label, minimum))
    if maximum is not None and number > maximum:
        fail("%s must be at most %s." % (label, maximum))
    return number

def checked_file(raw_path, label, max_bytes, extensions):
    path = pathlib.Path(str(raw_path or "")).expanduser().resolve()
    if not path.is_file():
        fail("%s does not exist: %s" % (label, path))
    suffix = path.name.lower()
    if not any(suffix.endswith(extension) for extension in extensions):
        fail("%s must use one of these formats: %s." % (label, ", ".join(extensions)))
    size = path.stat().st_size
    if size < 1:
        fail("%s is empty." % label)
    if size > max_bytes:
        fail("%s exceeds the %s-byte preflight limit." % (label, max_bytes))
    return path, size

def read_text(path, max_bytes):
    data = path.read_bytes()
    if len(data) > max_bytes:
        fail("Input grew beyond its preflight limit while it was being read.")
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        fail("Structure inputs must be UTF-8 text files.")

def update_bounds(bounds, coordinates):
    if bounds is not None:
        for axis, value in enumerate(coordinates):
            bounds[0][axis] = min(bounds[0][axis], value / 10.0)
            bounds[1][axis] = max(bounds[1][axis], value / 10.0)

def count_pdb_atoms(text, bounds=None):
    count = 0
    models = 0
    for raw in text.splitlines():
        if raw.startswith("MODEL "):
            models += 1
            if models > 1:
                fail("Select a single structure model before running OpenMM.")
        if not (raw.startswith("ATOM  ") or raw.startswith("HETATM")):
            continue
        if len(raw) < 54:
            fail("PDB coordinate record is truncated.")
        coordinates = [finite_number(field.strip(), "PDB coordinate") for field in (raw[30:38], raw[38:46], raw[46:54])]
        update_bounds(bounds, coordinates)
        count += 1
        if count > MAX_ATOMS:
            fail("Structure exceeds the absolute atom preflight limit.")
    return count

def count_mmcif_atoms(text, bounds=None):
    lines = text.splitlines()
    index = 0
    count = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue
        index += 1
        headers = []
        while index < len(lines) and lines[index].lstrip().startswith("_"):
            headers.append(lines[index].strip().split()[0])
            index += 1
        if "_atom_site.Cartn_x" not in headers:
            while index < len(lines) and lines[index].strip() not in ("#", "loop_"):
                index += 1
            continue
        try:
            x_index = headers.index("_atom_site.Cartn_x")
            y_index = headers.index("_atom_site.Cartn_y")
            z_index = headers.index("_atom_site.Cartn_z")
        except ValueError:
            fail("mmCIF atom_site loop has incomplete coordinates.")
        pending = []
        models = set()
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped or stripped.startswith("#") or stripped == "loop_" or stripped.startswith("_"):
                break
            pending.extend(shlex.split(lines[index], comments=False, posix=True))
            while len(pending) >= len(headers):
                row = pending[:len(headers)]
                pending = pending[len(headers):]
                coordinates = [finite_number(row[coordinate_index], "mmCIF coordinate") for coordinate_index in (x_index, y_index, z_index)]
                update_bounds(bounds, coordinates)
                if "_atom_site.pdbx_PDB_model_num" in headers:
                    models.add(row[headers.index("_atom_site.pdbx_PDB_model_num")])
                    if len(models) > 1:
                        fail("Select a single structure model before running OpenMM.")
                count += 1
                if count > MAX_ATOMS:
                    fail("Structure exceeds the absolute atom preflight limit.")
            index += 1
        if pending:
            fail("mmCIF atom_site row has the wrong number of fields.")
        if count:
            return count
    return count

def count_sdf_atoms(path):
    lines = read_text(path, MAX_LIGAND_BYTES).splitlines()
    if len(lines) < 4:
        fail("Ligand SDF is truncated.")
    try:
        atoms = int(lines[3][0:3].strip())
    except ValueError:
        fail("Ligand SDF has no readable V2000 atom count.")
    if atoms < 1:
        fail("Ligand SDF contains no atoms.")
    if len(lines) < 4 + atoms:
        fail("Ligand SDF atom block is truncated.")
    for line in lines[4:4 + atoms]:
        if len(line) < 30:
            fail("Ligand SDF coordinate record is truncated.")
        for field in (line[0:10], line[10:20], line[20:30]):
            finite_number(field.strip(), "Ligand SDF coordinate")
    if "$$$$" in lines and sum(1 for line in lines if line.strip() == "$$$$") > 1:
        fail("Supply exactly one ligand molecule in the SDF.")
    return atoms

def duration_ps(options):
    preset = options.get("preset")
    if preset == "verification-10ps":
        return 10.0
    if preset == "short-100ps":
        return 100.0
    if preset != "custom":
        fail("Molecular dynamics preset is not supported.")
    return finite_number(options.get("customDurationPs"), "Custom duration", 0.000001)

def preflight(payload, checkpoint_identity=None):
    mode = payload.get("mode")
    if mode not in ("relaxation", "dynamics"):
        fail("OpenMM mode must be relaxation or dynamics.")
    structure_path, structure_bytes = checked_file(
        payload.get("inputStructure"), "Input structure", MAX_STRUCTURE_BYTES,
        (".pdb", ".cif", ".mmcif"),
    )
    structure_text = read_text(structure_path, MAX_STRUCTURE_BYTES)
    bounds = [[math.inf] * 3, [-math.inf] * 3]
    if structure_path.name.lower().endswith(".pdb"):
        atom_count = count_pdb_atoms(structure_text, bounds)
    else:
        atom_count = count_mmcif_atoms(structure_text, bounds)
    if atom_count < 1:
        fail("Structure contains no finite ATOM or HETATM coordinates.")

    ligand_atom_count = 0
    ligand_bytes = 0
    if payload.get("ligandSdf"):
        ligand_path, ligand_bytes = checked_file(
            payload.get("ligandSdf"), "Ligand SDF", MAX_LIGAND_BYTES, (".sdf",),
        )
        ligand_atom_count = count_sdf_atoms(ligand_path)

    preparation = payload.get("preparation") or {}
    if not isinstance(preparation.get("addHydrogens"), bool):
        fail("Add hydrogens must be a boolean.")
    finite_number(preparation.get("ph"), "Preparation pH", 0, 14)
    solvent = preparation.get("solvent")
    if solvent not in ("none", WATER_FORCE_FIELD):
        fail("Solvent must be none or tip3p-fb.")
    if solvent == WATER_FORCE_FIELD:
        finite_number(preparation.get("solventPaddingNm"), "Solvent padding", 0.000001)
        finite_number(preparation.get("ionicStrengthM"), "Ionic strength", 0, 1)
    elif preparation.get("solventPaddingNm") is not None or preparation.get("ionicStrengthM") is not None:
        fail("Solvent padding and ionic strength require explicit TIP3P-FB solvent.")

    frame_count = 1
    step_count = 1
    if mode == "relaxation":
        relaxation = payload.get("relaxation") or {}
        step_count = integer(relaxation.get("maxIterations"), "Minimization iterations", 1, 10_000_000)
        finite_number(relaxation.get("toleranceKilojoulePerMoleNanometer"), "Minimization tolerance", 0.000001)
        integer(relaxation.get("seed"), "OpenMM seed", 1, 0x7FFFFFFF)
    else:
        dynamics = payload.get("dynamics") or {}
        duration = duration_ps(dynamics)
        temperature = finite_number(dynamics.get("temperatureKelvin"), "Temperature", 0.000001)
        del temperature
        save_interval = finite_number(dynamics.get("saveIntervalPs"), "Save interval", 0.000001)
        if save_interval > duration:
            fail("Save interval cannot exceed the simulation duration.")
        duration_steps = duration * 1000.0 / TIMESTEP_FS
        report_steps = save_interval * 1000.0 / TIMESTEP_FS
        if not duration_steps.is_integer() or not report_steps.is_integer():
            fail("Duration and save interval must align to the fixed 2 fs timestep.")
        step_count = integer(duration_steps, "Dynamics step count", 1, 0x7FFFFFFF)
        pressure = dynamics.get("pressureBar")
        if pressure is not None:
            finite_number(pressure, "Pressure", 0.000001)
            if solvent == "none":
                fail("Constant pressure requires an explicitly solvated periodic system.")
        integer(dynamics.get("seed"), "OpenMM seed", 1, 0x7FFFFFFF)
        starting_step = checkpoint_identity["currentStep"] if checkpoint_identity is not None else 0
        integer(starting_step + step_count, "Final dynamics step count", 1, 0x7FFFFFFF)
        frame_count = (starting_step + step_count) // int(report_steps) - starting_step // int(report_steps)

    # Bound preparation growth before importing or allocating the scientific system. The final
    # prepared atom count is checked again before a Context can allocate CPU/GPU resources.
    prepared_atom_bound = atom_count * (5 if preparation["addHydrogens"] else 1)
    if solvent == WATER_FORCE_FIELD:
        diagonal_nm = math.sqrt(sum((bounds[1][axis] - bounds[0][axis]) ** 2 for axis in range(3)))
        width_nm = diagonal_nm + 0.4 + 2 * float(preparation["solventPaddingNm"])
        water_atom_bound = width_nm ** 3 * 120
        if not math.isfinite(water_atom_bound) or water_atom_bound > MAX_ATOMS:
            fail("Solvated structure exceeds the absolute atom preflight limit.")
        prepared_atom_bound += math.ceil(water_atom_bound)
    if prepared_atom_bound > MAX_ATOMS:
        fail("Prepared structure exceeds the absolute atom preflight limit.")

    return {
        "schemaVersion": 1,
        "kind": "liatir.openmm-preflight",
        "mode": mode,
        "workloadId": "openmm:%s:%s:%s" % (mode, solvent, "openff" if ligand_atom_count else "standard"),
        "tokenCount": 1,
        "atomCount": prepared_atom_bound,
        "inputAtomCount": atom_count,
        "stepCount": step_count,
        "ligandAtomCount": ligand_atom_count,
        "outputItemCount": frame_count,
        "inputBytes": structure_bytes + ligand_bytes,
        "networkAccess": False,
    }

def require_measured_envelope(payload, metrics):
    if payload.get("measurementMode") is True:
        return
    estimate = payload.get("hardwareEstimate")
    if not isinstance(estimate, dict) or estimate.get("accepted") is not True:
        fail("A measured hardware preflight must accept this input before OpenMM is loaded.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")

def deny_network():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex
    def blocked_connect(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect(sock, address)
        raise RuntimeError("Network access is disabled for this local OpenMM run.")
    def blocked_connect_ex(sock, address):
        if sock.family == socket.AF_UNIX:
            return original_connect_ex(sock, address)
        raise RuntimeError("Network access is disabled for this local OpenMM run.")
    def blocked_create_connection(*args, **kwargs):
        raise RuntimeError("Network access is disabled for this local OpenMM run.")
    socket.socket.connect = blocked_connect
    socket.socket.connect_ex = blocked_connect_ex
    socket.create_connection = blocked_create_connection
    socket.getaddrinfo = blocked_create_connection
    socket.gethostbyname = blocked_create_connection
    socket.gethostbyname_ex = blocked_create_connection
    socket.gethostbyaddr = blocked_create_connection
    original_sendto = socket.socket.sendto
    def blocked_sendto(sock, *args, **kwargs):
        if sock.family == socket.AF_UNIX:
            return original_sendto(sock, *args, **kwargs)
        raise RuntimeError("Network access is disabled for this local OpenMM run.")
    socket.socket.sendto = blocked_sendto

def configure_runtime_source(payload):
    runtime_path = pathlib.Path(str(payload.get("runtimePath") or "")).expanduser().resolve()
    source_root = runtime_path / "source" / "openmmforcefields"
    required = (
        source_root / "openmmforcefields" / "__init__.py",
        source_root / "openmmforcefields" / "generators" / "template_generators.py",
        source_root / "LICENSE",
    )
    if not runtime_path.is_dir() or not all(path.is_file() for path in required):
        fail("The signed OpenMM Runtime Box is missing its reviewed OpenMMForceFields source.")
    sys.path.insert(0, str(source_root))

def sha256_bytes(data):
    return hashlib.sha256(data).hexdigest()

def sha256_file(path, max_bytes=None):
    digest = hashlib.sha256()
    total = 0
    with open(path, "rb") as handle:
        while True:
            block = handle.read(1024 * 1024)
            if not block:
                break
            total += len(block)
            if max_bytes is not None and total > max_bytes:
                fail("Checkpoint exceeds the allowed size.")
            digest.update(block)
    return digest.hexdigest()

def write_json_atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + ".", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            json.dump(value, handle, indent=2, sort_keys=True)
            handle.write("\n")
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)

def inspect_openmm_dcd(path, expected_atom_count):
    def read_record(handle, endian, allow_eof=False):
        prefix = handle.read(4)
        if not prefix and allow_eof:
            return None
        if len(prefix) != 4:
            fail("DCD trajectory has a truncated record header.")
        length = struct.unpack(endian + "i", prefix)[0]
        if length < 0 or length > max(1024 * 1024, expected_atom_count * 8):
            fail("DCD trajectory has an invalid record length.")
        data = handle.read(length)
        suffix = handle.read(4)
        if len(data) != length or len(suffix) != 4 or struct.unpack(endian + "i", suffix)[0] != length:
            fail("DCD trajectory has a truncated or mismatched record.")
        return data

    with open(path, "rb") as handle:
        prefix = handle.read(4)
        if len(prefix) != 4:
            fail("DCD trajectory is empty or truncated.")
        little = struct.unpack("<i", prefix)[0]
        big = struct.unpack(">i", prefix)[0]
        if little == 84:
            endian = "<"
        elif big == 84:
            endian = ">"
        else:
            fail("DCD trajectory has no supported 84-byte header.")
        handle.seek(0)
        header = read_record(handle, endian)
        if header[:4] != b"CORD":
            fail("DCD trajectory is not a coordinate trajectory.")
        read_record(handle, endian)
        atom_record = read_record(handle, endian)
        if len(atom_record) != 4:
            fail("DCD trajectory has no readable atom count.")
        atom_count = struct.unpack(endian + "i", atom_record)[0]
        if atom_count != expected_atom_count:
            fail("DCD atom count does not match the prepared topology.")
        coordinate_bytes = atom_count * 4
        frame_count = 0
        while True:
            first = read_record(handle, endian, allow_eof=True)
            if first is None:
                break
            x_values = read_record(handle, endian) if len(first) in (24, 48) else first
            y_values = read_record(handle, endian)
            z_values = read_record(handle, endian)
            for axis_values in (x_values, y_values, z_values):
                if len(axis_values) != coordinate_bytes:
                    fail("DCD coordinate record does not match the prepared topology.")
                if not all(math.isfinite(value[0]) for value in struct.iter_unpack(endian + "f", axis_values)):
                    fail("DCD trajectory contains a non-finite saved coordinate.")
            frame_count += 1
        if frame_count < 1:
            fail("DCD trajectory contains no saved frames.")
        return {"atomCount": atom_count, "frameCount": frame_count, "finiteCoordinates": True}

def checkpoint_metadata_before_import(payload):
    checkpoint_path = str(payload.get("checkpointPath") or "").strip()
    metadata_path = str(payload.get("checkpointMetadataPath") or "").strip()
    if bool(checkpoint_path) != bool(metadata_path):
        fail("Checkpoint bytes and checkpoint metadata must be supplied together.")
    if not checkpoint_path:
        return None, None, None
    checkpoint, checkpoint_size = checked_file(checkpoint_path, "Checkpoint", MAX_CHECKPOINT_BYTES, (".chk",))
    if payload["mode"] != "dynamics":
        fail("Molecular relaxation does not accept a dynamics checkpoint.")
    metadata, _ = checked_file(metadata_path, "Checkpoint metadata", MAX_CHECKPOINT_METADATA_BYTES, (".json",))
    try:
        identity = json.loads(metadata.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("Checkpoint metadata is not valid UTF-8 JSON.")
    if not isinstance(identity, dict):
        fail("Checkpoint metadata must be a JSON object.")
    expected = {
        "schemaVersion": 1,
        "kind": "liatir.openmm-checkpoint",
        "runtimeId": OPENMM_RUNTIME_ID,
        "runtimeBoxRelease": str(payload.get("runtimeBoxRelease") or ""),
        "targetId": str(payload.get("targetId") or ""),
        "forceFieldId": FORCE_FIELD_ID,
        "openmmVersion": OPENMM_VERSION,
        "platform": "CUDA" if payload.get("accelerator") == "cuda" else "CPU",
        "precision": "mixed",
    }
    for key, value in expected.items():
        if identity.get(key) != value:
            fail("Checkpoint %s %s does not match the selected runtime value %s." % (key, identity.get(key), value))
    recorded_hash = str(identity.get("checkpointSha256") or "")
    actual_hash = sha256_file(checkpoint, MAX_CHECKPOINT_BYTES)
    if recorded_hash != actual_hash:
        fail("Checkpoint byte hash does not match its metadata.")
    if identity.get("configurationSha256") != configuration_sha256(payload):
        fail("Checkpoint inputs or simulation settings do not match the selected run.")
    state = identity.get("state")
    if not isinstance(state, dict):
        fail("Checkpoint metadata is missing its exact prepared system.")
    for field, hash_key in (("systemXml", "systemSha256"), ("integratorXml", "integratorSha256")):
        value = state.get(field)
        if not isinstance(value, str) or sha256_bytes(value.encode("utf-8")) != identity.get(hash_key):
            fail("Checkpoint %s does not match its recorded hash." % field)
    if sha256_bytes(canonical_json(state.get("topology"))) != identity.get("topologySha256"):
        fail("Checkpoint topology does not match its recorded hash.")
    integer(identity.get("currentStep"), "Checkpoint current step", 0, 0x7FFFFFFF)
    return checkpoint, identity, checkpoint_size

def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")

def configuration_sha256(payload):
    dynamics = payload.get("dynamics") or {}
    return sha256_bytes(canonical_json({
        "inputStructureSha256": sha256_file(pathlib.Path(payload["inputStructure"]), MAX_STRUCTURE_BYTES),
        "ligandSdfSha256": sha256_file(pathlib.Path(payload["ligandSdf"]), MAX_LIGAND_BYTES) if payload.get("ligandSdf") else None,
        "preparation": payload["preparation"],
        "temperatureKelvin": float(dynamics.get("temperatureKelvin", 0)),
        "pressureBar": float(dynamics["pressureBar"]) if dynamics.get("pressureBar") is not None else None,
        "seed": int(dynamics.get("seed", 1)),
        "timestepFs": TIMESTEP_FS,
    }))

def topology_snapshot(topology, unit):
    vectors = topology.getPeriodicBoxVectors()
    box = None
    if vectors is not None:
        box_values = vectors.value_in_unit(unit.nanometer)
        box = [[float(component) for component in vector] for vector in box_values]
    return {
        "chains": [chain.id for chain in topology.chains()],
        "residues": [{"chain": residue.chain.index, "name": residue.name, "id": residue.id,
                      "insertionCode": residue.insertionCode} for residue in topology.residues()],
        "atoms": [{"name": atom.name, "id": atom.id, "residue": atom.residue.index,
                   "element": atom.element.symbol if atom.element is not None else None} for atom in topology.atoms()],
        "bonds": [[bond[0].index, bond[1].index, str(bond.type) if bond.type is not None else None, bond.order]
                  for bond in topology.bonds()],
        "boxNm": box,
    }

def restore_topology(snapshot, unit):
    import openmm.app as app
    from openmm import Vec3
    topology = app.Topology()
    if not isinstance(snapshot, dict) or not 0 < len(snapshot.get("atoms", [])) <= MAX_ATOMS:
        fail("Checkpoint prepared topology has an invalid atom count.")
    chains = [topology.addChain(chain_id) for chain_id in snapshot["chains"]]
    residues = [topology.addResidue(row["name"], chains[row["chain"]], row["id"], row["insertionCode"])
                for row in snapshot["residues"]]
    atoms = [topology.addAtom(row["name"], app.Element.getBySymbol(row["element"]) if row["element"] else None,
                             residues[row["residue"]], row["id"]) for row in snapshot["atoms"]]
    types = {name: getattr(app, name) for name in ("Single", "Double", "Triple", "Aromatic", "Amide")}
    for left, right, kind, order in snapshot["bonds"]:
        if kind is not None and kind not in types:
            fail("Checkpoint contains an unsupported bond type.")
        topology.addBond(atoms[left], atoms[right], types.get(kind), order)
    if snapshot["boxNm"] is not None:
        topology.setPeriodicBoxVectors([Vec3(*vector) for vector in snapshot["boxNm"]] * unit.nanometer)
    if canonical_json(topology_snapshot(topology, unit)) != canonical_json(snapshot):
        fail("Checkpoint prepared topology did not round-trip exactly.")
    return topology

def checkpoint_public_identity(identity):
    return {key: value for key, value in identity.items() if key != "state"} if identity is not None else None

def assert_finite_positions(positions, unit, label):
    values = positions.value_in_unit(unit.nanometer)
    if not values:
        fail("%s has no atom coordinates." % label)
    for index, position in enumerate(values):
        if not all(math.isfinite(float(value)) for value in position):
            fail("%s has non-finite coordinates at atom %s." % (label, index + 1))

def load_structure(path, PDBFile, PDBxFile):
    if path.name.lower().endswith(".pdb"):
        structure = PDBFile(str(path))
    else:
        structure = PDBxFile(str(path))
    return structure.topology, structure.positions

def write_structures(topology, positions, prepared_path, topology_pdb_path, PDBFile, PDBxFile):
    with open(prepared_path, "w", encoding="utf-8", newline="\n") as handle:
        PDBxFile.writeFile(topology, positions, handle, keepIds=True)
    with open(topology_pdb_path, "w", encoding="utf-8", newline="\n") as handle:
        PDBFile.writeFile(topology, positions, handle, keepIds=True)

def platform_for(payload, Platform):
    accelerator = payload.get("accelerator")
    if accelerator == "cuda":
        platform = Platform.getPlatformByName("CUDA")
        return platform, {"Precision": "mixed", "DeterministicForces": "true"}, "mixed"
    if accelerator == "cpu":
        platform = Platform.getPlatformByName("CPU")
        threads = max(1, min(os.cpu_count() or 1, 32))
        return platform, {"Threads": str(threads)}, "mixed"
    fail("OpenMM supports only the exact CPU or CUDA target selected by the Runtime Box.")

def prepare_system(payload, structure_path, checkpoint_identity, metrics):
    import importlib.metadata
    import openmm
    import openff.toolkit
    import openmmforcefields
    from openmm import LangevinMiddleIntegrator, MonteCarloBarostat, Platform, VerletIntegrator, XmlSerializer, unit
    from openmm.app import DCDReporter, ForceField, HBonds, Modeller, NoCutoff, PDBFile, PDBxFile, PME, Simulation, StateDataReporter

    installed_version = importlib.metadata.version("openmm")
    if installed_version != OPENMM_VERSION:
        fail("Installed OpenMM %s does not match required %s." % (installed_version, OPENMM_VERSION))
    if openmmforcefields.__version__ != OPENMMFORCEFIELDS_VERSION:
        fail("Installed OpenMMForceFields source does not match the reviewed version.")
    if openff.toolkit.__version__ != OPENFF_TOOLKIT_VERSION:
        fail("Installed OpenFF Toolkit does not match the reviewed version.")
    if importlib.metadata.version("openforcefields") != OPENFF_FORCEFIELDS_VERSION:
        fail("Installed OpenFF force-field data does not match the reviewed version.")
    if importlib.metadata.version("openff-nagl-models") != OPENFF_NAGL_MODELS_VERSION:
        fail("Installed OpenFF NAGL model package does not match the reviewed version.")
    if checkpoint_identity is not None:
        # Restoring the exact System avoids regenerating hydrogen/water positions or ion choices.
        from openmm import Vec3
        state = checkpoint_identity["state"]
        topology = restore_topology(state["topology"], unit)
        modeller = Modeller(topology, [Vec3(0, 0, 0)] * topology.getNumAtoms() * unit.nanometer)
        system = XmlSerializer.deserialize(state["systemXml"])
        integrator = XmlSerializer.deserialize(state["integratorXml"])
        return prepared_system(payload, modeller, system, integrator, state.get("naglModelSha256"), metrics)
    topology, positions = load_structure(structure_path, PDBFile, PDBxFile)
    assert_finite_positions(positions, unit, "Input structure")
    modeller = Modeller(topology, positions)
    forcefield = ForceField("amber19-all.xml", "amber19/tip3pfb.xml")

    nagl_model_sha256 = None
    matched_ligand_residues = set()
    ligand_sdf = str(payload.get("ligandSdf") or "").strip()
    if ligand_sdf:
        import torch
        if importlib.metadata.version("torch") != "2.10.0" or torch.version.cuda is not None:
            fail("OpenFF ligand charges require the reviewed PyTorch 2.10.0 CPU runtime.")
        from openff.nagl_models import validate_nagl_model_path
        from openff.nagl_models import _dynamic_fetch as nagl_dynamic_fetch
        from openff.toolkit import Molecule
        from openmmforcefields.generators import SMIRNOFFTemplateGenerator
        ligand = Molecule.from_file(ligand_sdf, allow_undefined_stereo=False)
        if isinstance(ligand, list):
            if len(ligand) != 1:
                fail("Supply exactly one ligand molecule in the SDF.")
            ligand = ligand[0]
        nagl_dynamic_fetch.CACHE_DIR = pathlib.Path(payload["outputDir"]) / ".nagl-cache"
        nagl_path = pathlib.Path(validate_nagl_model_path(NAGL_CHARGE_MODEL)).resolve()
        nagl_model_sha256 = sha256_file(nagl_path, 1024 * 1024 * 1024)
        if nagl_model_sha256 != NAGL_CHARGE_MODEL_SHA256:
            fail("Bundled NAGL charge model hash does not match the reviewed model.")
        ligand.assign_partial_charges(partial_charge_method=NAGL_CHARGE_MODEL)
        generator = SMIRNOFFTemplateGenerator(molecules=[ligand], forcefield=OPENFF_FORCE_FIELD)
        def generate_ligand_parameters(ff, residue):
            matched = generator.generator(ff, residue)
            if matched:
                matched_ligand_residues.add((residue.chain.index, residue.index))
            return matched
        forcefield.registerTemplateGenerator(generate_ligand_parameters)

    preparation = payload["preparation"]
    options = payload["relaxation"] if payload["mode"] == "relaxation" else payload["dynamics"]
    random.seed(int(options["seed"]))
    if preparation.get("addHydrogens") is True:
        modeller.addHydrogens(forcefield, pH=float(preparation["ph"]), platform=Platform.getPlatformByName("CPU"))
    if preparation["solvent"] == WATER_FORCE_FIELD:
        modeller.addSolvent(
            forcefield,
            model="tip3p",
            padding=float(preparation["solventPaddingNm"]) * unit.nanometer,
            ionicStrength=float(preparation["ionicStrengthM"]) * unit.molar,
        )
    assert_finite_positions(modeller.positions, unit, "Prepared structure")

    periodic = preparation["solvent"] == WATER_FORCE_FIELD
    create_system_options = {
        "nonbondedMethod": PME if periodic else NoCutoff,
        "constraints": HBonds,
        "rigidWater": True,
        "removeCMMotion": True,
    }
    if periodic:
        create_system_options["nonbondedCutoff"] = 1.0 * unit.nanometer
    system = forcefield.createSystem(modeller.topology, **create_system_options)
    if ligand_sdf and not matched_ligand_residues:
        fail("The SDF did not parameterize a ligand in the input structure. Supply the SDF for an existing ligand.")
    if payload["mode"] == "dynamics" and payload["dynamics"].get("pressureBar") is not None:
        barostat = MonteCarloBarostat(
            float(payload["dynamics"]["pressureBar"]) * unit.bar,
            float(payload["dynamics"]["temperatureKelvin"]) * unit.kelvin,
        )
        barostat.setRandomNumberSeed(int(payload["dynamics"]["seed"]))
        system.addForce(barostat)

    if payload["mode"] == "relaxation":
        integrator = VerletIntegrator(0.001 * unit.picoseconds)
    else:
        integrator = LangevinMiddleIntegrator(
            float(payload["dynamics"]["temperatureKelvin"]) * unit.kelvin,
            1.0 / unit.picosecond,
            TIMESTEP_FS * unit.femtoseconds,
        )
        integrator.setRandomNumberSeed(int(payload["dynamics"]["seed"]))
    return prepared_system(payload, modeller, system, integrator, nagl_model_sha256, metrics)

def prepared_system(payload, modeller, system, integrator, nagl_model_sha256, metrics):
    import openmm
    import openmmforcefields
    from openmm import Platform, XmlSerializer, unit
    from openmm.app import DCDReporter, PDBFile, PDBxFile, Simulation, StateDataReporter
    atom_count = modeller.topology.getNumAtoms()
    if atom_count > metrics["atomCount"]:
        fail("Prepared system exceeds the accepted preflight atom bound.")
    if system.getNumParticles() != atom_count:
        fail("Prepared System particles do not match the structure topology.")
    snapshot = topology_snapshot(modeller.topology, unit)
    system_xml = XmlSerializer.serialize(system)
    integrator_xml = XmlSerializer.serialize(integrator)
    checkpoint_state = {"topology": snapshot, "systemXml": system_xml, "integratorXml": integrator_xml,
                        "naglModelSha256": nagl_model_sha256}
    if len(canonical_json(checkpoint_state)) + 16384 > MAX_CHECKPOINT_METADATA_BYTES:
        fail("Prepared system is too large for a resumable checkpoint.")
    platform, platform_properties, precision = platform_for(payload, Platform)
    simulation = Simulation(modeller.topology, system, integrator, platform, platform_properties)
    return {
        "openmm": openmm,
        "unit": unit,
        "PDBFile": PDBFile,
        "PDBxFile": PDBxFile,
        "DCDReporter": DCDReporter,
        "StateDataReporter": StateDataReporter,
        "simulation": simulation,
        "modeller": modeller,
        "preparedAtomCount": atom_count,
        "topologySha256": sha256_bytes(canonical_json(snapshot)),
        "systemSha256": sha256_bytes(system_xml.encode("utf-8")),
        "integratorSha256": sha256_bytes(integrator_xml.encode("utf-8")),
        "checkpointState": checkpoint_state,
        "platform": platform.getName(),
        "platformProperties": platform_properties,
        "precision": precision,
        "openmmVersion": OPENMM_VERSION,
        "openmmforcefieldsVersion": openmmforcefields.__version__,
        "openffForceFieldsVersion": OPENFF_FORCEFIELDS_VERSION,
        "naglModelSha256": nagl_model_sha256,
        "periodic": payload["preparation"]["solvent"] == WATER_FORCE_FIELD,
    }

def energy_kj_per_mole(simulation, unit):
    value = simulation.context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
    value = float(value)
    if not math.isfinite(value):
        fail("OpenMM produced a non-finite potential energy.")
    return value

def common_summary(payload, prepared, metrics):
    return {
        "openmmVersion": prepared["openmmVersion"],
        "openmmforcefieldsVersion": prepared["openmmforcefieldsVersion"],
        "openffForceFieldsVersion": prepared["openffForceFieldsVersion"],
        "runtimeId": OPENMM_RUNTIME_ID,
        "runtimeBoxRelease": payload["runtimeBoxRelease"],
        "targetId": payload["targetId"],
        "accelerator": payload["accelerator"],
        "platform": prepared["platform"],
        "platformProperties": prepared["platformProperties"],
        "precision": prepared["precision"],
        "forceField": {
            "protein": PROTEIN_FORCE_FIELD,
            "water": WATER_FORCE_FIELD if payload["preparation"]["solvent"] == WATER_FORCE_FIELD else None,
            "ligand": OPENFF_FORCE_FIELD if payload.get("ligandSdf") else None,
            "ligandCharges": NAGL_CHARGE_MODEL if payload.get("ligandSdf") else None,
            "id": FORCE_FIELD_ID,
        },
        "naglModelSha256": prepared["naglModelSha256"],
        "topologySha256": prepared["topologySha256"],
        "systemSha256": prepared["systemSha256"],
        "atomCount": metrics["inputAtomCount"],
        "preparedAtomBound": metrics["atomCount"],
        "preparedAtomCount": prepared["preparedAtomCount"],
        "ligandAtomCount": metrics["ligandAtomCount"],
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }

def run_relaxation(payload, prepared, metrics, output_dir):
    simulation = prepared["simulation"]
    modeller = prepared["modeller"]
    unit = prepared["unit"]
    simulation.context.setPositions(modeller.positions)
    initial_energy = energy_kj_per_mole(simulation, unit)

    prepared_path = output_dir / "prepared-structure.cif"
    topology_pdb_path = output_dir / "prepared-topology.pdb"
    write_structures(
        modeller.topology, modeller.positions, prepared_path, topology_pdb_path,
        prepared["PDBFile"], prepared["PDBxFile"],
    )
    relaxation = payload["relaxation"]
    simulation.minimizeEnergy(
        tolerance=float(relaxation["toleranceKilojoulePerMoleNanometer"]) * unit.kilojoule_per_mole / unit.nanometer,
        maxIterations=int(relaxation["maxIterations"]),
    )
    state = simulation.context.getState(getPositions=True, getEnergy=True, enforcePeriodicBox=False)
    final_positions = state.getPositions()
    assert_finite_positions(final_positions, unit, "Relaxed structure")
    final_energy = float(state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole))
    if not math.isfinite(final_energy):
        fail("OpenMM produced a non-finite final potential energy.")
    if final_energy >= initial_energy:
        fail("Molecular relaxation did not reduce potential energy.")

    final_path = output_dir / "relaxed-structure.cif"
    with open(final_path, "w", encoding="utf-8", newline="\n") as handle:
        prepared["PDBxFile"].writeFile(modeller.topology, final_positions, handle, keepIds=True)
    summary = common_summary(payload, prepared, metrics)
    summary.update({
        "mode": "relaxation",
        "seed": int(relaxation["seed"]),
        "initialPotentialEnergyKilojoulePerMole": initial_energy,
        "finalPotentialEnergyKilojoulePerMole": final_energy,
        "energyReductionKilojoulePerMole": initial_energy - final_energy,
        "preparation": payload["preparation"],
        "relaxation": relaxation,
    })
    metrics_path = output_dir / "relaxation-metrics.json"
    write_json_atomic(metrics_path, summary)
    return {
        "schemaVersion": 1,
        "kind": "liatir.openmm-result",
        "mode": "relaxation",
        "paths": {
            "preparedStructurePath": str(prepared_path),
            "finalStructurePath": str(final_path),
            "topologyPdbPath": str(topology_pdb_path),
            "metricsJsonPath": str(metrics_path),
        },
        "summary": summary,
    }

def plot_payload(rows, x_key, y_key, title, y_label):
    return {
        "data": [{"type": "scatter", "mode": "lines", "x": [row[x_key] for row in rows], "y": [row[y_key] for row in rows], "name": y_label}],
        "layout": {"title": title, "xaxis": {"title": "Time (ps)"}, "yaxis": {"title": y_label}},
    }

def read_state_rows(path):
    with open(path, "r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        rows = []
        for row in reader:
            time_key = next((key for key in row if "Time" in key and "ps" in key), None)
            energy_key = next((key for key in row if "Potential Energy" in key), None)
            temperature_key = next((key for key in row if "Temperature" in key), None)
            if not time_key or not energy_key or not temperature_key:
                fail("OpenMM state CSV is missing time, potential energy, or temperature.")
            converted = {
                "timePs": finite_number(row[time_key], "Recorded time"),
                "potentialEnergyKilojoulePerMole": finite_number(row[energy_key], "Recorded potential energy"),
                "temperatureKelvin": finite_number(row[temperature_key], "Recorded temperature"),
            }
            rows.append(converted)
        if not rows:
            fail("OpenMM state CSV contains no saved frames.")
        return rows

def run_dynamics(payload, prepared, metrics, output_dir, resumed_checkpoint, checkpoint_identity):
    simulation = prepared["simulation"]
    modeller = prepared["modeller"]
    unit = prepared["unit"]
    dynamics = payload["dynamics"]
    duration = duration_ps(dynamics)
    total_steps = int(duration * 1000.0 / TIMESTEP_FS)
    report_steps = int(float(dynamics["saveIntervalPs"]) * 1000.0 / TIMESTEP_FS)

    if resumed_checkpoint is not None:
        simulation.loadCheckpoint(str(resumed_checkpoint))
        if simulation.currentStep != checkpoint_identity["currentStep"]:
            fail("Checkpoint step count does not match its metadata.")
    else:
        simulation.context.setPositions(modeller.positions)
        simulation.minimizeEnergy(maxIterations=1000)
        simulation.context.setVelocitiesToTemperature(
            float(dynamics["temperatureKelvin"]) * unit.kelvin,
            int(dynamics["seed"]),
        )

    topology_pdb_path = output_dir / "trajectory-topology.pdb"
    prepared_cif_path = output_dir / "prepared-structure.cif"
    state = simulation.context.getState(getPositions=True, enforcePeriodicBox=prepared["periodic"])
    starting_positions = state.getPositions()
    write_structures(
        modeller.topology, starting_positions, prepared_cif_path, topology_pdb_path,
        prepared["PDBFile"], prepared["PDBxFile"],
    )

    trajectory_path = output_dir / "trajectory.dcd"
    state_path = output_dir / "state.csv"
    simulation.reporters.append(prepared["DCDReporter"](
        str(trajectory_path), report_steps, enforcePeriodicBox=prepared["periodic"],
    ))
    simulation.reporters.append(prepared["StateDataReporter"](
        str(state_path), report_steps,
        step=True, time=True, potentialEnergy=True, kineticEnergy=True, totalEnergy=True,
        temperature=True, progress=True, remainingTime=True,
        speed=True, totalSteps=simulation.currentStep + total_steps, separator=",",
    ))
    simulation.step(total_steps)
    final_state = simulation.context.getState(
        getPositions=True, getEnergy=True, enforcePeriodicBox=prepared["periodic"],
    )
    final_positions = final_state.getPositions()
    assert_finite_positions(final_positions, unit, "Final dynamics structure")
    final_energy = float(final_state.getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole))
    if not math.isfinite(final_energy):
        fail("OpenMM produced a non-finite final potential energy.")

    final_path = output_dir / "final-structure.cif"
    with open(final_path, "w", encoding="utf-8", newline="\n") as handle:
        prepared["PDBxFile"].writeFile(modeller.topology, final_positions, handle, keepIds=True)
    checkpoint_path = output_dir / "openmm.chk"
    simulation.saveCheckpoint(str(checkpoint_path))
    checkpoint_metadata_path = output_dir / "openmm-checkpoint.json"
    next_identity = {
        "schemaVersion": 1,
        "kind": "liatir.openmm-checkpoint",
        "runtimeId": OPENMM_RUNTIME_ID,
        "runtimeBoxRelease": payload["runtimeBoxRelease"],
        "targetId": payload["targetId"],
        "topologySha256": prepared["topologySha256"],
        "systemSha256": prepared["systemSha256"],
        "integratorSha256": prepared["integratorSha256"],
        "configurationSha256": configuration_sha256(payload),
        "forceFieldId": FORCE_FIELD_ID,
        "checkpointSha256": sha256_file(checkpoint_path, MAX_CHECKPOINT_BYTES),
        "openmmVersion": prepared["openmmVersion"],
        "platform": prepared["platform"],
        "precision": prepared["precision"],
        "currentStep": simulation.currentStep,
        "state": prepared["checkpointState"],
    }
    write_json_atomic(checkpoint_metadata_path, next_identity)

    state_rows = read_state_rows(state_path)
    trajectory_inspection = inspect_openmm_dcd(trajectory_path, prepared["preparedAtomCount"])
    if trajectory_inspection["frameCount"] != len(state_rows):
        fail("DCD and state CSV frame counts do not match.")
    if trajectory_inspection["frameCount"] != metrics["outputItemCount"]:
        fail("Saved trajectory frames differ from the accepted preflight.")
    energy_plot_path = output_dir / "energy-plot.json"
    temperature_plot_path = output_dir / "temperature-plot.json"
    write_json_atomic(energy_plot_path, plot_payload(
        state_rows, "timePs", "potentialEnergyKilojoulePerMole", "Potential energy", "kJ/mol",
    ))
    write_json_atomic(temperature_plot_path, plot_payload(
        state_rows, "timePs", "temperatureKelvin", "Temperature", "K",
    ))
    summary = common_summary(payload, prepared, metrics)
    summary.update({
        "mode": "dynamics",
        "seed": int(dynamics["seed"]),
        "durationPs": duration,
        "timestepFs": TIMESTEP_FS,
        "saveIntervalPs": float(dynamics["saveIntervalPs"]),
        "frameCount": trajectory_inspection["frameCount"],
        "trajectoryFiniteCoordinates": trajectory_inspection["finiteCoordinates"],
        "totalSteps": total_steps,
        "finalPotentialEnergyKilojoulePerMole": final_energy,
        "resumed": resumed_checkpoint is not None,
        "resumedCheckpoint": checkpoint_public_identity(checkpoint_identity),
        "checkpoint": checkpoint_public_identity(next_identity),
        "preparation": payload["preparation"],
        "dynamics": dynamics,
    })
    metrics_path = output_dir / "dynamics-metrics.json"
    write_json_atomic(metrics_path, summary)
    return {
        "schemaVersion": 1,
        "kind": "liatir.openmm-result",
        "mode": "dynamics",
        "paths": {
            "trajectoryDcdPath": str(trajectory_path),
            "finalStructurePath": str(final_path),
            "topologyPdbPath": str(topology_pdb_path),
            "preparedStructurePath": str(prepared_cif_path),
            "stateCsvPath": str(state_path),
            "checkpointPath": str(checkpoint_path),
            "checkpointMetadataPath": str(checkpoint_metadata_path),
            "metricsJsonPath": str(metrics_path),
            "energyPlotPath": str(energy_plot_path),
            "temperaturePlotPath": str(temperature_plot_path),
        },
        "summary": summary,
    }

def main():
    payload = json.load(sys.stdin)
    checkpoint, checkpoint_identity, _ = checkpoint_metadata_before_import(payload)
    metrics = preflight(payload, checkpoint_identity)
    if payload.get("action") == "preflight":
        print(json.dumps(metrics, separators=(",", ":")))
        return
    if payload.get("action") != "run":
        fail("OpenMM action must be preflight or run.")
    require_measured_envelope(payload, metrics)
    if str(payload.get("runtimeBoxRelease") or "").strip() == "":
        fail("Runtime Box release identity is required.")
    if str(payload.get("targetId") or "").strip() == "":
        fail("Runtime Box target identity is required.")
    output_dir = pathlib.Path(str(payload.get("outputDir") or "")).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    structure_path, _ = checked_file(
        payload.get("inputStructure"), "Input structure", MAX_STRUCTURE_BYTES,
        (".pdb", ".cif", ".mmcif"),
    )

    configure_runtime_source(payload)
    os.environ["MPLCONFIGDIR"] = str(output_dir / ".matplotlib")
    deny_network()
    prepared = prepare_system(payload, structure_path, checkpoint_identity, metrics)
    if payload["mode"] == "relaxation":
        if checkpoint is not None:
            fail("Molecular relaxation does not accept a dynamics checkpoint.")
        result = run_relaxation(payload, prepared, metrics, output_dir)
    else:
        result = run_dynamics(payload, prepared, metrics, output_dir, checkpoint, checkpoint_identity)
    print(json.dumps(result, separators=(",", ":")))

if __name__ == "__main__":
    main()
`;
