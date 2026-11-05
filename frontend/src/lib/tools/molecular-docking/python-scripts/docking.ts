/**
 * Offline docking adapter shared by Receptor Preparation and Molecular Docking.
 *
 * Preflight actions stay inside the Python standard library. Real actions deny network sockets,
 * pin OpenMM to one CPU thread, and import PDBFixer, Meeko, Vina and Ringtail only after an
 * accepted measured hardware envelope. Nothing is removed from a structure unless named.
 */
export const MOLECULAR_DOCKING_SCRIPT = String.raw`
"""Offline molecular docking adapter shared by receptor preparation, docking and screening.

Every action reads one JSON payload on stdin and prints one JSON result as its last stdout line.
Network sockets are denied before any scientific import, OpenMM is pinned to its single-threaded
CPU platform, and nothing is removed from a structure unless the payload names it.
"""
import csv
import hashlib
import json
import math
import os
import pathlib
import re
import shlex
import shutil
import socket
import sqlite3
import subprocess
import sys
import tempfile
import time

VINA_VERSION = "1.2.7"
MEEKO_VERSION = "0.8.0"
RINGTAIL_VERSION = "2.3.1"
PDBFIXER_VERSION = "1.12.0"
OPENMM_VERSION = "8.5.1"
RDKIT_VERSION = "2024.9.6"
RUNTIME_ID = "molecular-docking-vina-1-2-7"
MAX_STRUCTURE_BYTES = 64 * 1024 * 1024
MAX_RECEPTOR_PDBQT_BYTES = 64 * 1024 * 1024
MAX_LIGAND_LIBRARY_BYTES = 256 * 1024 * 1024
MAX_STRUCTURE_ATOMS = 500_000
MAX_LIGANDS = 100_000
MAX_LIGAND_HEAVY_ATOMS = 150
MAX_BOX_SIDE_ANGSTROM = 126.0
# Vina prints its own warning above this search volume; the report repeats it rather than inventing one.
VINA_LARGE_SEARCH_VOLUME = 27_000.0
WATER_NAMES = {"HOH", "WAT", "H2O", "DOD", "TIP", "TIP3", "SOL"}
# Elements AutoDock Vina's scoring function types for a ligand; anything else is refused by name.
VINA_LIGAND_ELEMENTS = {"H", "C", "N", "O", "F", "P", "S", "Cl", "Br", "I"}
EXPERIMENT_TABLE = "liatir_docking_experiment"


def fail(message):
    raise ValueError(message)


def log(message):
    print(message, file=sys.stderr, flush=True)


def deny_network():
    original_connect = socket.socket.connect
    original_connect_ex = socket.socket.connect_ex

    def blocked(*_args, **_kwargs):
        raise RuntimeError("Network access is disabled for this local docking run.")

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


def canonical_json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


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
        fail("A measured hardware preflight must accept this input before the docking runtime is loaded.")
    for key in ("workloadId", "tokenCount", "atomCount", "stepCount", "outputItemCount"):
        if estimate.get(key) != metrics.get(key):
            fail("Hardware preflight no longer matches the selected input (%s)." % key)
    if not str(estimate.get("evidenceRecord") or "").strip():
        fail("Hardware preflight has no retained evidence record.")


# ── stdlib-only input inspection ────────────────────────────────────────────

def structure_records(path):
    """Yields (group, residue name, author chain, residue number, label chain) per atom.

    A PDB file has one chain identifier. An mmCIF file has two: the author's (what the PDB, viewers
    and users call chain A) and the label one, which gives every ligand, ion and water group a chain
    of its own. Liatir speaks author chains; the label chain is kept only to translate OpenMM's.
    """
    text = path.read_text(encoding="utf-8", errors="strict")
    if path.name.lower().endswith(".pdb"):
        if sum(1 for line in text.splitlines() if line.startswith("MODEL ")) > 1:
            fail("Select a single structure model before preparing a receptor.")
        for line in text.splitlines():
            if line.startswith(("ATOM  ", "HETATM")):
                yield line[:6].strip(), line[17:20].strip(), line[21].strip(), line[22:27].strip(), line[21].strip()
        return
    lines = text.splitlines()
    index = 0
    while index < len(lines):
        if lines[index].strip() != "loop_":
            index += 1
            continue
        index += 1
        headers = []
        while index < len(lines) and lines[index].lstrip().startswith("_"):
            headers.append(lines[index].strip().split()[0])
            index += 1
        if "_atom_site.group_PDB" not in headers:
            continue
        def column(*names):
            for name in names:
                if "_atom_site." + name in headers:
                    return headers.index("_atom_site." + name)
            fail("The mmCIF atom_site table lacks %s." % names[0])
        group, residue, chain, number, label = (column("group_PDB"), column("auth_comp_id", "label_comp_id"),
                                                column("auth_asym_id", "label_asym_id"),
                                                column("auth_seq_id", "label_seq_id"),
                                                column("label_asym_id", "auth_asym_id"))
        model = headers.index("_atom_site.pdbx_PDB_model_num") if "_atom_site.pdbx_PDB_model_num" in headers else None
        models = set()
        while index < len(lines):
            stripped = lines[index].strip()
            if not stripped or stripped.startswith("#") or stripped == "loop_" or stripped.startswith("_"):
                break
            fields = shlex.split(lines[index], comments=False, posix=True)
            index += 1
            if len(fields) != len(headers):
                fail("The mmCIF atom_site table has a row that is split or truncated; supply a standard mmCIF file.")
            if model is not None:
                models.add(fields[model])
                if len(models) > 1:
                    fail("Select a single structure model before preparing a receptor.")
            yield fields[group], fields[residue], fields[chain], fields[number], fields[label]
        return


def author_chain_names(path):
    """Maps the chain names OpenMM reads (label chains, for mmCIF) to the author chains users see."""
    mapping = {}
    for _, _, author, _, label in structure_records(path):
        mapping.setdefault(label, author)
    return mapping


def structure_summary(path):
    atoms = 0
    chains = []
    residues = {}
    for group, name, chain, number, _ in structure_records(path):
        atoms += 1
        if atoms > MAX_STRUCTURE_ATOMS:
            fail("The structure exceeds the %s-atom limit." % MAX_STRUCTURE_ATOMS)
        if chain not in chains:
            chains.append(chain)
        if group == "HETATM" or name in WATER_NAMES:
            key = (chain, number, name)
            residues[key] = residues.get(key, 0) + 1
    if atoms < 1:
        fail("The structure contains no atoms.")
    groups = {}
    for (_, _, name), count in residues.items():
        kind = "water" if name in WATER_NAMES else ("ion" if count == 1 else "ligand-or-cofactor")
        entry = groups.setdefault(name, {"name": name, "kind": kind, "residues": 0})
        entry["residues"] += 1
    return {"atoms": atoms, "chains": chains,
            "heterogens": sorted(groups.values(), key=lambda item: (item["kind"], item["name"]))}


def pdbqt_atom_count(path):
    count = 0
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith(("ATOM  ", "HETATM")):
                count += 1
            elif line.startswith(("BRANCH", "TORSDOF", "ROOT")):
                fail("The receptor PDBQT contains ligand torsion records; supply a rigid receptor PDBQT.")
    if count < 1:
        fail("The receptor PDBQT contains no atoms.")
    return count


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


def sdf_records(path):
    """Yields (index, name, atom count, heavy atoms, coordinates) per SDF record without RDKit."""
    for index, lines in enumerate(sdf_blocks(path)):
        if len(lines) < 4:
            fail("SDF record %d is truncated." % (index + 1))
        name = lines[0].strip()
        counts = lines[3]
        coordinates = []
        heavy = 0
        if "V3000" in counts:
            in_atoms = False
            closed = False
            for line in lines[4:]:
                if line.startswith("M  V30 BEGIN ATOM"):
                    in_atoms = True
                elif line.startswith("M  V30 END ATOM"):
                    closed = True
                    break
                elif in_atoms and line.startswith("M  V30 "):
                    fields = line[7:].split()
                    element = fields[1]
                    coordinates.append(tuple(finite_number(value, "SDF coordinate") for value in fields[2:5]))
                    heavy += element not in ("H", "D")
            if not closed:
                fail("SDF record %d is truncated: its atom block never ends." % (index + 1))
        else:
            try:
                atom_count = int(counts[0:3])
            except ValueError:
                fail("SDF record %d has an unreadable counts line." % (index + 1))
            if len(lines) < 4 + atom_count:
                fail("SDF record %d is truncated: it declares %d atoms and holds %d."
                     % (index + 1, atom_count, len(lines) - 4))
            for line in lines[4:4 + atom_count]:
                if len(line) < 34:
                    fail("SDF record %d has a truncated atom line." % (index + 1))
                coordinates.append(tuple(finite_number(line[offset:offset + 10], "SDF coordinate")
                                         for offset in (0, 10, 20)))
                heavy += line[31:34].strip() not in ("H", "D")
        if not coordinates:
            fail("SDF record %d contains no atoms." % (index + 1))
        yield index, name, len(coordinates), heavy, coordinates


def box_from_coordinates(coordinates, padding):
    minimum = [min(point[axis] for point in coordinates) for axis in range(3)]
    maximum = [max(point[axis] for point in coordinates) for axis in range(3)]
    center = [round((minimum[axis] + maximum[axis]) / 2.0, 3) for axis in range(3)]
    size = [round(maximum[axis] - minimum[axis] + 2.0 * padding, 3) for axis in range(3)]
    return center, size


def binding_site(payload):
    site = payload.get("site") or {}
    mode = site.get("mode")
    if mode == "box":
        center = [finite_number(site.get("center", [None] * 3)[axis], "Box centre %s" % "xyz"[axis])
                  for axis in range(3)]
        size = [finite_number(site.get("size", [None] * 3)[axis], "Box size %s" % "xyz"[axis], 1.0,
                              MAX_BOX_SIDE_ANGSTROM) for axis in range(3)]
        source = {"mode": "box"}
    elif mode == "reference-ligand":
        reference, _ = checked_file(site.get("referenceLigand"), "Reference ligand", MAX_LIGAND_LIBRARY_BYTES,
                                    (".sdf",))
        padding = finite_number(site.get("paddingAngstrom", 5.0), "Box padding", 0.0, 30.0)
        records = list(sdf_records(reference))
        if len(records) != 1:
            fail("The reference ligand SDF must contain exactly one molecule.")
        center, size = box_from_coordinates(records[0][4], padding)
        for axis in range(3):
            if size[axis] > MAX_BOX_SIDE_ANGSTROM:
                fail("The box around the reference ligand exceeds %s Å." % MAX_BOX_SIDE_ANGSTROM)
        source = {"mode": "reference-ligand", "referenceLigandSha256": sha256_file(reference),
                  "paddingAngstrom": padding}
    else:
        fail("The binding site must be an explicit box or a reference ligand.")
    volume = size[0] * size[1] * size[2]
    return {**source, "center": center, "size": size, "volumeCubicAngstrom": round(volume, 3),
            "largeSearchSpace": volume > VINA_LARGE_SEARCH_VOLUME}


def docking_options(payload):
    options = payload.get("docking") or {}
    scoring = options.get("scoringFunction", "vina")
    if scoring not in ("vina", "vinardo"):
        fail("The scoring function must be vina or vinardo.")
    cpu_limit = max(1, os.cpu_count() or 1)
    return {
        "scoringFunction": scoring,
        "exhaustiveness": integer(options.get("exhaustiveness", 8), "Exhaustiveness", 1, 512),
        "numPoses": integer(options.get("numPoses", 9), "Number of poses", 1, 50),
        "energyRangeKcalPerMol": finite_number(options.get("energyRangeKcalPerMol", 3.0), "Energy range", 0.1, 20.0),
        "minRmsdAngstrom": finite_number(options.get("minRmsdAngstrom", 1.0), "Minimum pose RMSD", 0.1, 10.0),
        "seed": integer(options.get("seed", 42), "Seed", 1, 2_147_483_647),
        "cpu": integer(options.get("cpu", min(4, cpu_limit)), "CPU threads", 1, cpu_limit),
        "addLigandHydrogens": options.get("addLigandHydrogens", True) is True,
    }


def preflight_docking(payload):
    receptor, receptor_bytes = checked_file(payload.get("receptorPdbqt"), "Receptor PDBQT",
                                            MAX_RECEPTOR_PDBQT_BYTES, (".pdbqt",))
    ligands, ligand_bytes = checked_file(payload.get("ligandsSdf"), "Ligand SDF", MAX_LIGAND_LIBRARY_BYTES, (".sdf",))
    receptor_atoms = pdbqt_atom_count(receptor)
    records = list(sdf_records(ligands))
    if len(records) > MAX_LIGANDS:
        fail("The ligand library exceeds %s molecules." % MAX_LIGANDS)
    oversized = [name or "molecule %d" % (index + 1) for index, name, _, heavy, _ in records
                 if heavy > MAX_LIGAND_HEAVY_ATOMS]
    options = docking_options(payload)
    site = binding_site(payload)
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-docking-preflight",
        "action": "dock",
        "workloadId": "vina:dock:%s" % options["scoringFunction"],
        "tokenCount": len(records),
        "atomCount": receptor_atoms,
        "stepCount": options["exhaustiveness"],
        "outputItemCount": len(records) * options["numPoses"],
        "ligandCount": len(records),
        "maxLigandHeavyAtoms": max(heavy for _, _, _, heavy, _ in records),
        "oversizedLigands": oversized[:20],
        "site": site,
        "options": options,
        "inputBytes": receptor_bytes + ligand_bytes,
        "networkAccess": False,
    }


def preflight_receptor(payload):
    structure, size = checked_file(payload.get("inputStructure"), "Input structure", MAX_STRUCTURE_BYTES,
                                   (".pdb", ".cif", ".mmcif"))
    summary = structure_summary(structure)
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-docking-preflight",
        "action": "prepare-receptor",
        "workloadId": "docking:receptor-preparation",
        "tokenCount": 1,
        "atomCount": summary["atoms"],
        "chains": summary["chains"],
        "heterogens": summary["heterogens"],
        "stepCount": 1,
        "outputItemCount": 1,
        "inputBytes": size,
        "networkAccess": False,
    }


def sdf_properties(lines):
    """The data items of one SDF record, by name."""
    values = {}
    for index, line in enumerate(lines[:-1]):
        # A data header is ">  <name>", which some writers follow with the record number.
        start = line.find("<") + 1
        end = line.find(">", start)
        if line.startswith(">") and start > 0 and end > start:
            values[line[start:end]] = lines[index + 1].strip()
    return values


def preflight_select_complex(payload):
    poses, poses_bytes = checked_file(payload.get("posesSdf"), "Docked poses", MAX_LIGAND_LIBRARY_BYTES, (".sdf",))
    structure, structure_bytes = checked_file(payload.get("receptorStructure"), "Prepared receptor",
                                              MAX_STRUCTURE_BYTES, (".pdb",))
    receptor, receptor_bytes = checked_file(payload.get("receptorPdbqt"), "Receptor PDBQT", MAX_RECEPTOR_PDBQT_BYTES,
                                            (".pdbqt",))
    available = []
    for lines in sdf_blocks(poses):
        properties = sdf_properties(lines)
        if "liatir_ligand" in properties and "liatir_pose_rank" in properties:
            score = properties.get("vina_score_kcal_per_mol")
            available.append({"ligand": properties["liatir_ligand"],
                              "poseRank": integer(properties["liatir_pose_rank"], "Pose rank", 1),
                              "scoreKcalPerMol": finite_number(score, "Vina score") if score else None})
    if not available:
        fail("These poses do not come from Liatir's Molecular Docking; select a complex from its docked poses.")
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-docking-preflight",
        "action": "select-complex",
        "workloadId": "docking:select-complex",
        "tokenCount": 1,
        "atomCount": structure_summary(structure)["atoms"],
        "stepCount": 1,
        "outputItemCount": 1,
        "poses": available[:1000],
        "inputBytes": poses_bytes + structure_bytes + receptor_bytes,
        "networkAccess": False,
    }


# ── receptor preparation ────────────────────────────────────────────────────

def residue_label(residue, chains):
    insertion = getattr(residue, "insertionCode", "") or ""
    return "%s:%s%s %s" % (chains.get(residue.chain.id, residue.chain.id), residue.id, insertion.strip(), residue.name)


def heterogen_kind(residue, standard):
    if residue.name in WATER_NAMES:
        return "water"
    if residue.name in standard:
        return "polymer"
    if len(list(residue.atoms())) == 1:
        return "ion"
    return "ligand-or-cofactor"


def composition(topology, standard, names):
    chains = {}
    heterogens = []
    for chain in topology.chains():
        residues = list(chain.residues())
        author = names.get(chain.id, chain.id)
        chains[author] = chains.get(author, 0) + len(residues)
        for residue in residues:
            kind = heterogen_kind(residue, standard)
            if kind != "polymer":
                heterogens.append({"residue": residue_label(residue, names), "name": residue.name, "kind": kind,
                                   "atoms": len(list(residue.atoms()))})
    return {"atoms": topology.getNumAtoms(), "residues": topology.getNumResidues(), "chains": chains,
            "heterogens": heterogens}


def receptor_preparation_options(payload):
    options = payload.get("preparation") or {}
    keep_chains = [str(value).strip() for value in options.get("keepChains") or [] if str(value).strip()]
    remove_names = sorted({str(value).strip().upper() for value in options.get("removeResidueNames") or []
                           if str(value).strip()})
    return {
        "keepChains": keep_chains,
        "removeWaters": options.get("removeWaters", True) is True,
        "removeResidueNames": remove_names,
        "addMissingAtoms": options.get("addMissingAtoms", True) is True,
        "addMissingResidues": options.get("addMissingResidues", False) is True,
        "replaceNonstandardResidues": options.get("replaceNonstandardResidues", False) is True,
        "ph": finite_number(options.get("ph", 7.4), "Protonation pH", 0.0, 14.0),
    }


def prepare_receptor(payload, output_dir):
    options = receptor_preparation_options(payload)
    structure, _ = checked_file(payload.get("inputStructure"), "Input structure", MAX_STRUCTURE_BYTES,
                                (".pdb", ".cif", ".mmcif"))
    # Read by OpenMM's CPU platform when it creates a context; one thread keeps repaired coordinates
    # bit-for-bit reproducible on every host.
    os.environ["OPENMM_CPU_THREADS"] = "1"
    import openmm
    from openmm import Platform
    from openmm.app import Modeller, PDBFile
    from openmm.app.internal.pdbstructure import PdbStructure
    import pdbfixer
    import prody
    from meeko import MoleculePreparation, PDBQTWriterLegacy, Polymer, PolymerCreationError, ResidueChemTemplates
    prody.confProDy(verbosity="none")
    from pdbfixer.pdbfixer import proteinResidues, dnaResidues, rnaResidues
    standard = set(proteinResidues) | set(dnaResidues) | set(rnaResidues)

    cpu = Platform.getPlatformByName("CPU")
    fixer = pdbfixer.PDBFixer(filename=str(structure), platform=cpu)
    names = author_chain_names(structure)
    before = composition(fixer.topology, standard, names)
    changes = []

    input_hydrogens = [atom for atom in fixer.topology.atoms()
                       if atom.element is not None and atom.element.symbol == "H"]
    if input_hydrogens:
        # Every residue is re-protonated by OpenMM's rules at one pH, whatever tool wrote the input.
        # Hydrogen names differ between tools (Reduce's HN/HB1 against OpenMM's H/HB3), so adding
        # hydrogens on top of foreign ones duplicates them; a receptor protonated elsewhere enters
        # docking directly as its own PDBQT instead.
        modeller = Modeller(fixer.topology, fixer.positions)
        modeller.delete(input_hydrogens)
        fixer.topology = modeller.topology
        fixer.positions = modeller.positions
        changes.append({"step": "remove-input-hydrogens", "count": len(input_hydrogens)})

    if options["keepChains"]:
        present = list(before["chains"])
        unknown = [chain for chain in options["keepChains"] if chain not in present]
        if unknown:
            fail("Chains %s are not in the structure (present: %s)." % (", ".join(unknown), ", ".join(present)))
        # A chain keeps its own ligands, ions and waters, which an mmCIF file files under label chains.
        dropped = [chain for chain in fixer.topology.chains() if names.get(chain.id, chain.id) not in options["keepChains"]]
        if dropped:
            changes.append({"step": "remove-chains",
                            "chains": sorted({names.get(chain.id, chain.id) for chain in dropped}),
                            "residues": [{"residue": residue_label(residue, names), "kind": heterogen_kind(residue, standard)}
                                         for chain in dropped for residue in chain.residues()
                                         if heterogen_kind(residue, standard) != "polymer"]})
            fixer.removeChains(chainIds=sorted({chain.id for chain in dropped}))

    delete = []
    for residue in fixer.topology.residues():
        kind = heterogen_kind(residue, standard)
        if (kind == "water" and options["removeWaters"]) or residue.name in options["removeResidueNames"]:
            delete.append(residue)
    if delete:
        removed = [{"residue": residue_label(residue, names), "kind": heterogen_kind(residue, standard)} for residue in delete]
        modeller = Modeller(fixer.topology, fixer.positions)
        modeller.delete(delete)
        fixer.topology = modeller.topology
        fixer.positions = modeller.positions
        changes.append({"step": "remove-residues", "residues": removed})
    missing_names = [name for name in options["removeResidueNames"]
                     if not any(item["name"] == name for item in before["heterogens"])]
    if missing_names:
        fail("Residue names %s were selected for removal but are not in the structure." % ", ".join(missing_names))

    fixer.findMissingResidues()
    chains_by_index = {chain.index: chain for chain in fixer.topology.chains()}
    gaps = []
    for (chain_index, position), gap_residues in sorted(fixer.missingResidues.items()):
        chain = chains_by_index[chain_index]
        residues = list(chain.residues())
        terminal = position == 0 or position == len(residues)
        gaps.append({"chain": names.get(chain.id, chain.id),
                     "afterResidue": residues[position - 1].id if position > 0 else None,
                     "residues": gap_residues, "terminal": terminal})
    if options["addMissingResidues"]:
        # Unresolved termini are not modelled: their placement is unconstrained by the structure.
        fixer.missingResidues = {key: value for key, value in fixer.missingResidues.items()
                                 if not (key[1] == 0 or key[1] == len(list(chains_by_index[key[0]].residues())))}
        if fixer.missingResidues:
            changes.append({"step": "add-missing-residues",
                            "gaps": [gap for gap in gaps if not gap["terminal"]]})
    else:
        fixer.missingResidues = {}

    fixer.findNonstandardResidues()
    nonstandard = [{"residue": residue_label(residue, names), "standardName": replacement}
                   for residue, replacement in fixer.nonstandardResidues]
    if nonstandard and options["replaceNonstandardResidues"]:
        fixer.replaceNonstandardResidues()
        changes.append({"step": "replace-nonstandard-residues", "residues": nonstandard})
    elif nonstandard:
        fail("Non-standard residues %s have no docking template. Enable replacement with their standard "
             "equivalents, or remove them." % ", ".join(item["residue"] for item in nonstandard[:10]))

    # Meeko builds every receptor residue from a template, and fetches unknown ones from the PDB.
    # Offline, a residue without a bundled template (a drug-like ligand, a cofactor such as HEM or NAD)
    # is refused here by name, before PDBFixer could silently leave it without hydrogens.
    templates = ResidueChemTemplates.create_from_defaults()
    untemplated = {}
    for residue in fixer.topology.residues():
        if residue.name not in templates.residue_templates and residue.name not in templates.ambiguous:
            untemplated.setdefault(residue.name, []).append(residue_label(residue, names))
    if untemplated:
        fail("These residues have no docking template, so they cannot be part of the receptor: %s. Remove a "
             "co-crystallized ligand you will dock again; a bound cofactor needs a residue template this tool "
             "does not provide yet." % "; ".join("%s (%s)" % (name, ", ".join(labels[:3]))
                                                for name, labels in sorted(untemplated.items())))

    fixer.findMissingAtoms()
    missing_atoms = [{"residue": residue_label(residue, names), "atoms": [atom.name for atom in atoms]}
                     for residue, atoms in fixer.missingAtoms.items()]
    missing_terminals = [{"residue": residue_label(residue, names), "atoms": list(atoms)}
                         for residue, atoms in fixer.missingTerminals.items()]
    if (missing_atoms or missing_terminals or fixer.missingResidues) and options["addMissingAtoms"]:
        fixer.addMissingAtoms(seed=1)
        changes.append({"step": "add-missing-atoms", "residues": missing_atoms, "terminals": missing_terminals})
    elif missing_atoms:
        fail("%d residues are missing heavy atoms (first: %s). Enable missing-atom repair, or supply a "
             "complete structure." % (len(missing_atoms), missing_atoms[0]["residue"]))

    remaining = [item for item in composition(fixer.topology, standard, names)["heterogens"] if item["kind"] != "water"]
    try:
        fixer.addMissingHydrogens(pH=options["ph"])
    except RuntimeError as error:
        if "Network access is disabled" not in str(error):
            raise
        fail("Hydrogens cannot be added to %s offline: PDBFixer would download their chemical definitions "
             "from the PDB. Remove these residues, or prepare the receptor PDBQT with another tool and "
             "dock against it directly." % ", ".join(sorted({item["name"] for item in remaining})))
    changes.append({"step": "add-hydrogens", "ph": options["ph"]})

    prepared_pdb = output_dir / "prepared-receptor.pdb"
    with open(prepared_pdb, "w", encoding="utf-8", newline="\n") as handle:
        PDBFile.writeFile(fixer.topology, fixer.positions, handle, keepIds=True)
    after = composition(fixer.topology, standard, names)

    # Meeko's own mk_prepare_receptor path for -i: ProDy keeps every altloc, and charges come from the
    # residue templates. Unmatched residues raise; nothing is deleted on Meeko's side.
    parsed = prody.parsePDB(str(prepared_pdb), altloc="all")
    try:
        polymer = Polymer.from_prody(parsed, templates, MoleculePreparation.from_config({"compute_charges": False}))
    except PolymerCreationError as error:
        fail("The prepared receptor has residues Meeko cannot match to a template: %s" % str(error).strip()[:800])
    except RuntimeError as error:
        if "Network access is disabled" not in str(error):
            raise
        fail("Meeko tried to download a residue definition from the PDB, which this offline tool does not do.")
    rigid_pdbqt, flexible = PDBQTWriterLegacy.write_from_polymer(polymer)
    if flexible:
        fail("Flexible receptor residues are not supported by this tool.")
    receptor_pdbqt = output_dir / "receptor.pdbqt"
    receptor_pdbqt.write_text(rigid_pdbqt, encoding="utf-8")

    templates_used = {}
    for residue_id, monomer in polymer.monomers.items():
        key = getattr(monomer, "residue_template_key", None)
        if key:
            templates_used[key] = templates_used.get(key, 0) + 1
    protonation = {key: count for key, count in sorted(templates_used.items())
                   if key.rstrip("0123456789") in {"HID", "HIE", "HIP", "CYX", "CYM", "ASH", "GLH", "LYN",
                                                   "NHID", "NHIE", "NHIP", "CHID", "CHIE", "CHIP"}}
    charge = 0.0
    for line in rigid_pdbqt.splitlines():
        if line.startswith(("ATOM  ", "HETATM")):
            charge += float(line[70:76])
    report = {
        "schemaVersion": 1,
        "kind": "liatir.receptor-preparation-report",
        "inputStructureSha256": sha256_file(structure),
        "options": options,
        "before": before,
        "after": after,
        "changes": changes,
        "missingResidueGaps": gaps,
        "nonstandardResidues": nonstandard,
        "protonationTemplates": protonation,
        "residueTemplates": templates_used,
        "receptorPdbqtAtoms": sum(1 for line in rigid_pdbqt.splitlines() if line.startswith(("ATOM  ", "HETATM"))),
        "receptorPdbqtSha256": sha256_file(receptor_pdbqt),
        "netPartialCharge": round(charge, 3),
        "versions": versions(openmm=True),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    report_path = output_dir / "receptor-preparation.json"
    write_json_atomic(report_path, report)
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-docking-result",
        "action": "prepare-receptor",
        "paths": {"preparedReceptorPdb": str(prepared_pdb), "receptorPdbqt": str(receptor_pdbqt),
                  "reportJson": str(report_path)},
        "summary": report,
    }


def versions(openmm=False):
    import importlib.metadata as metadata
    names = ["vina", "meeko", "ringtail", "rdkit"] + (["pdbfixer", "openmm"] if openmm else [])
    found = {name: metadata.version(name) for name in names}
    expected = {"vina": VINA_VERSION, "meeko": MEEKO_VERSION, "ringtail": RINGTAIL_VERSION, "rdkit": RDKIT_VERSION,
                "pdbfixer": PDBFIXER_VERSION, "openmm": OPENMM_VERSION}
    for name, version in found.items():
        if version != expected[name]:
            fail("Installed %s %s does not match the reviewed %s." % (name, version, expected[name]))
    return found


# ── ligand preparation and docking ──────────────────────────────────────────

def prepare_ligand(Chem, molecule, options):
    """Returns (molecule with explicit hydrogens, facts) or raises ValueError with the reason."""
    if molecule is None:
        fail("RDKit could not read or sanitize this molecule.")
    if molecule.GetNumConformers() != 1 or not molecule.GetConformer().Is3D():
        fail("The molecule has no 3D coordinates.")
    fragments = Chem.GetMolFrags(molecule)
    if len(fragments) != 1:
        fail("The molecule has %d disconnected fragments (salts or mixtures); supply one parent molecule."
             % len(fragments))
    unsupported = sorted({atom.GetSymbol() for atom in molecule.GetAtoms()} - VINA_LIGAND_ELEMENTS)
    if unsupported:
        fail("Elements %s are outside AutoDock Vina's ligand atom types." % ", ".join(unsupported))
    heavy = molecule.GetNumHeavyAtoms()
    if heavy > MAX_LIGAND_HEAVY_ATOMS:
        fail("The molecule has %d heavy atoms, above the %d limit." % (heavy, MAX_LIGAND_HEAVY_ATOMS))
    implicit = sum(atom.GetNumImplicitHs() for atom in molecule.GetAtoms())
    added = 0
    if implicit:
        if not options["addLigandHydrogens"]:
            fail("The molecule lacks %d hydrogens; enable adding hydrogens to the drawn charge state." % implicit)
        molecule = Chem.AddHs(molecule, addCoords=True)
        added = implicit
    Chem.AssignStereochemistryFrom3D(molecule)
    unassigned = [center for center in Chem.FindMolChiralCenters(molecule, includeUnassigned=True,
                                                                 useLegacyImplementation=False)
                  if center[1] == "?"]
    identity = Chem.MolToSmiles(Chem.RemoveHs(molecule), isomericSmiles=True)
    return molecule, {"heavyAtoms": heavy, "hydrogensAdded": added, "unassignedStereocenters": len(unassigned),
                      "formalCharge": Chem.GetFormalCharge(molecule), "inputSmiles": identity}


def unique_name(raw, index, used):
    base = re.sub(r"[^A-Za-z0-9_.-]+", "_", raw.strip())[:64].strip("._") or "ligand"
    name = base
    if name in used:
        name = "%s_%d" % (base, index + 1)
    used.add(name)
    return name


def experiment_identity(receptor_pdbqt, site, options):
    return {
        "schemaVersion": 1,
        "receptorPdbqtSha256": sha256_file(receptor_pdbqt),
        "center": site["center"],
        "size": site["size"],
        "scoringFunction": options["scoringFunction"],
        "exhaustiveness": options["exhaustiveness"],
        "vina": VINA_VERSION,
        "meeko": MEEKO_VERSION,
    }


def check_experiment(database, identity):
    """Refuses to append docking results that belong to a different experiment."""
    if not database.exists():
        return
    connection = sqlite3.connect(str(database))
    try:
        row = connection.execute(
            "SELECT identity FROM %s WHERE id = 1" % EXPERIMENT_TABLE).fetchone()
    except sqlite3.OperationalError:
        fail("The selected screening database was not created by Liatir's docking tool, so its receptor, "
             "binding site and settings cannot be confirmed. Start a new database.")
    finally:
        connection.close()
    stored = json.loads(row[0]) if row else None
    if stored != identity:
        differing = sorted(key for key in identity if (stored or {}).get(key) != identity[key])
        fail("The screening database belongs to a different docking experiment (%s differ). Results from "
             "different receptors, binding sites or settings cannot be ranked together; start a new database."
             % ", ".join(differing))


def record_experiment(database, identity):
    connection = sqlite3.connect(str(database))
    try:
        connection.execute("CREATE TABLE IF NOT EXISTS %s (id INTEGER PRIMARY KEY CHECK (id = 1), identity TEXT NOT NULL)"
                           % EXPERIMENT_TABLE)
        connection.execute("INSERT OR IGNORE INTO %s (id, identity) VALUES (1, ?)" % EXPERIMENT_TABLE,
                           (json.dumps(identity, sort_keys=True),))
        connection.commit()
    finally:
        connection.close()


def heavy_atom_coordinates(path, pdbqt):
    """Heavy-atom coordinates rounded to 0.01 Å; PDBQT columns 78-79 hold the AutoDock type."""
    found = set()
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            if not line.startswith(("ATOM  ", "HETATM")):
                continue
            kind = (line[77:79] if pdbqt else line[76:78]).strip().upper()
            if kind.startswith("H") and kind not in ("HG",):
                continue
            found.add(tuple(round(float(line[offset:offset + 8]), 2) for offset in (30, 38, 46)))
    return found


def check_receptor_structure(structure, receptor_pdbqt):
    """The complex is drawn from the PDB, so it must be the very receptor the PDBQT was written from."""
    docked = heavy_atom_coordinates(receptor_pdbqt, True)
    drawn = heavy_atom_coordinates(structure, False)
    missing = len(docked - drawn)
    if missing:
        fail("The receptor structure does not match the receptor PDBQT: %d of its %d heavy atoms are not in "
             "the structure. Use the prepared receptor PDB written together with this PDBQT." % (missing, len(docked)))


def write_complex(Chem, structure, pose, output_path):
    """Receptor atoms then one pose as residue LIG in a chain of its own, with the pose's bonds.

    OpenMM reads the CONECT records for the ligand, so the file is also the hand-off for a later
    simulation of this complex.
    """
    receptor_lines = []
    chains = set()
    serial = 0
    with open(structure, encoding="utf-8") as handle:
        for line in handle:
            if line.startswith(("ATOM  ", "HETATM")):
                serial += 1
                chains.add(line[21])
                receptor_lines.append("%s%5d%s" % (line[:6], serial, line[11:].rstrip("\n")))
            elif line.startswith("TER"):
                receptor_lines.append("TER")
    ligand = Chem.Mol(pose)
    if serial + ligand.GetNumAtoms() > 99_999:
        return None
    chain = next(letter for letter in "LZYXWVUTSRQPONMKJIHGFEDCBA" if letter not in chains)
    counts = {}
    for atom in ligand.GetAtoms():
        symbol = atom.GetSymbol()
        counts[symbol] = counts.get(symbol, 0) + 1
        label = "%s%d" % (symbol.upper(), counts[symbol])
        info = Chem.AtomPDBResidueInfo()
        info.SetName((" " + label).ljust(4)[:4] if len(symbol) == 1 and len(label) < 4 else label.ljust(4)[:4])
        info.SetResidueName("LIG")
        info.SetResidueNumber(1)
        info.SetChainId(chain)
        info.SetIsHeteroAtom(True)
        atom.SetMonomerInfo(info)
    offset = serial
    ligand_lines = []
    for line in Chem.MolToPDBBlock(ligand).splitlines():
        if line.startswith("HETATM"):
            ligand_lines.append("%s%5d%s" % (line[:6], int(line[6:11]) + offset, line[11:]))
        elif line.startswith("CONECT"):
            numbers = [int(line[start:start + 5]) + offset for start in range(6, len(line), 5) if line[start:start + 5].strip()]
            ligand_lines.append("CONECT" + "".join("%5d" % number for number in numbers))
    output_path.write_text("\n".join(receptor_lines + ["TER"] + ligand_lines + ["END", ""]), encoding="utf-8")
    return {"chain": chain, "receptorAtoms": serial, "ligandAtoms": ligand.GetNumAtoms()}


def select_complex(payload, output_dir):
    """One docked pose with its receptor, written as the two files a molecular simulation starts from.

    The pose must record the receptor PDBQT it was docked into, and the receptor structure must be the
    one that PDBQT was written from, so the complex places the ligand where it was actually docked.
    """
    poses_path, _ = checked_file(payload.get("posesSdf"), "Docked poses", MAX_LIGAND_LIBRARY_BYTES, (".sdf",))
    receptor, _ = checked_file(payload.get("receptorPdbqt"), "Receptor PDBQT", MAX_RECEPTOR_PDBQT_BYTES, (".pdbqt",))
    structure, _ = checked_file(payload.get("receptorStructure"), "Prepared receptor", MAX_STRUCTURE_BYTES, (".pdb",))
    ligand = str(payload.get("ligand") or "").strip()
    if not ligand:
        fail("Choose the docked ligand to take into a simulation.")
    rank = integer(payload.get("poseRank", 1), "Pose rank", 1)
    check_receptor_structure(structure, receptor)
    from rdkit import Chem, RDLogger
    RDLogger.DisableLog("rdApp.*")
    matches = []
    for index, molecule in enumerate(Chem.SDMolSupplier(str(poses_path), removeHs=False, sanitize=True)):
        if molecule is None:
            fail("Docked pose %d could not be read." % (index + 1))
        if (molecule.HasProp("liatir_ligand") and molecule.GetProp("liatir_ligand") == ligand
                and molecule.HasProp("liatir_pose_rank") and molecule.GetProp("liatir_pose_rank") == str(rank)):
            matches.append(molecule)
    if len(matches) != 1:
        fail("The docked poses hold %d poses of %s at rank %d; choose a ligand and rank from this docking run."
             % (len(matches), ligand, rank))
    pose = matches[0]
    if not pose.HasProp("liatir_receptor_pdbqt_sha256"):
        fail("These poses do not record the receptor they were docked into; dock them again to select a complex.")
    if pose.GetProp("liatir_receptor_pdbqt_sha256") != sha256_file(receptor):
        fail("These poses were not docked into this receptor PDBQT.")
    if Chem.AddHs(pose).GetNumAtoms() != pose.GetNumAtoms():
        fail("The pose lacks hydrogens, and a simulation needs every one; dock with ligand hydrogens added.")
    complex_path = output_dir / "docked-complex.pdb"
    facts = write_complex(Chem, structure, pose, complex_path)
    if facts is None:
        fail("The complex exceeds the 99,999 atoms a PDB file can number.")
    ligand_path = output_dir / "docked-ligand.sdf"
    writer = Chem.SDWriter(str(ligand_path))
    writer.write(pose)
    writer.close()
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.docked-complex-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": versions(),
        "ligand": ligand,
        "poseRank": rank,
        "scoreKcalPerMol": float(pose.GetProp("vina_score_kcal_per_mol")),
        "smiles": pose.GetProp("liatir_input_smiles") if pose.HasProp("liatir_input_smiles") else None,
        "complex": facts,
        "receptorPdbqtSha256": pose.GetProp("liatir_receptor_pdbqt_sha256"),
        "posesSha256": sha256_file(poses_path),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "docked-complex.json"
    write_json_atomic(summary_path, summary)
    return {"schemaVersion": 1, "kind": "liatir.molecular-docking-result", "action": "select-complex",
            "paths": {"complexPdb": str(complex_path), "ligandSdf": str(ligand_path), "summaryJson": str(summary_path)},
            "summary": summary}


def ingest_in_fresh_process(output_dir, request):
    """Stores Vina results with Ringtail from a new interpreter that never ran Vina's threads.

    Ringtail forks worker processes. A fork taken after a multithreaded run can inherit a lock held by
    another thread, so the parent hands its results to a fresh interpreter rather than forking itself.
    """
    script = globals().get("__file__")
    if not script or not pathlib.Path(script).is_file():
        fail("The docking adapter must run from a file to store screening results.")
    request_path = output_dir / ".ringtail-request.json"
    write_json_atomic(request_path, request)
    completed = subprocess.run(
        [sys.executable, "-I", str(pathlib.Path(script).resolve())],
        input=json.dumps({"action": "ringtail-ingest", "request": str(request_path)}),
        capture_output=True, text=True, timeout=24 * 3600,
    )
    request_path.unlink(missing_ok=True)
    if completed.returncode != 0:
        fail("Ringtail could not store the docking results: %s" % (completed.stderr.strip()[-2000:] or "no output"))


def ringtail_ingest(payload):
    request = json.loads(pathlib.Path(str(payload["request"])).read_text(encoding="utf-8"))
    from ringtail import RingtailCore
    ringtail = RingtailCore(db_file=request["database"], docking_mode="vina", logging_level="WARNING")
    ringtail.add_results_from_vina_string(results_strings=request["results"], receptor_file=request["receptorPdbqt"],
                                          save_receptor=request["saveReceptor"], max_poses=request["maxPoses"],
                                          # Ringtail starts max_proc - 1 readers beside one writer, so 2
                                          # is its smallest working value; 1 starts no reader and waits forever.
                                          add_interactions=True, max_proc=2)
    return {"schemaVersion": 1, "kind": "liatir.ringtail-ingest", "ligands": len(request["results"])}


def dock(payload, output_dir, metrics):
    options = metrics["options"]
    site = metrics["site"]
    receptor, _ = checked_file(payload.get("receptorPdbqt"), "Receptor PDBQT", MAX_RECEPTOR_PDBQT_BYTES, (".pdbqt",))
    ligands_path, _ = checked_file(payload.get("ligandsSdf"), "Ligand SDF", MAX_LIGAND_LIBRARY_BYTES, (".sdf",))
    database = None
    if str(payload.get("screeningDatabase") or "").strip():
        database = pathlib.Path(str(payload["screeningDatabase"])).expanduser().resolve()
        if not database.is_file():
            fail("The selected screening database does not exist.")
    identity = experiment_identity(receptor, site, options)
    if database is not None:
        check_experiment(database, identity)
    receptor_structure = None
    if str(payload.get("receptorStructure") or "").strip():
        receptor_structure, _ = checked_file(payload["receptorStructure"], "Receptor structure",
                                             MAX_STRUCTURE_BYTES, (".pdb",))
        check_receptor_structure(receptor_structure, receptor)

    from meeko import MoleculePreparation, PDBQTMolecule, PDBQTWriterLegacy, RDKitMolCreate
    from rdkit import Chem, RDLogger
    from vina import Vina
    RDLogger.DisableLog("rdApp.*")
    found_versions = versions()

    vina = Vina(sf_name=options["scoringFunction"], cpu=options["cpu"], seed=options["seed"], verbosity=0)
    vina.set_receptor(str(receptor))
    vina.compute_vina_maps(center=site["center"], box_size=site["size"])
    preparation = MoleculePreparation()

    supplier = Chem.SDMolSupplier(str(ligands_path), removeHs=False, sanitize=True)
    used_names = set()
    rows = []
    rejected = []
    vina_strings = {}
    poses_path = output_dir / "docked-poses.sdf"
    writer = Chem.SDWriter(str(poses_path))
    best_poses = {}
    started = time.time()
    total = len(supplier)
    for index in range(total):
        raw_name = ""
        try:
            molecule = supplier[index]
            raw_name = molecule.GetProp("_Name") if molecule is not None and molecule.HasProp("_Name") else ""
            name = unique_name(raw_name or "ligand_%d" % (index + 1), index, used_names)
            molecule, facts = prepare_ligand(Chem, molecule, options)
            setups = preparation.prepare(molecule)
            if len(setups) != 1:
                fail("Meeko produced %d setups for this molecule; supply a single molecule." % len(setups))
            ligand_pdbqt, ok, error = PDBQTWriterLegacy.write_string(setups[0])
            if not ok:
                fail("Meeko could not write this molecule: %s" % error)
            vina.set_ligand_from_string(ligand_pdbqt)
            vina.dock(exhaustiveness=options["exhaustiveness"], n_poses=max(20, options["numPoses"]),
                      min_rmsd=options["minRmsdAngstrom"])
            energies = vina.energies(n_poses=options["numPoses"], energy_range=options["energyRangeKcalPerMol"])
            poses_pdbqt = vina.poses(n_poses=options["numPoses"], energy_range=options["energyRangeKcalPerMol"])
            remarks = [float(line.split()[3]) for line in poses_pdbqt.splitlines()
                       if line.startswith("REMARK VINA RESULT:")]
            if len(remarks) != len(energies) or any(abs(remarks[i] - float(energies[i][0])) > 0.001
                                                     for i in range(len(remarks))):
                fail("Vina's pose remarks disagree with its energies.")
            exported = RDKitMolCreate.from_pdbqt_mol(PDBQTMolecule(poses_pdbqt, skip_typing=True))
            if len(exported) != 1 or exported[0] is None:
                fail("Docked poses could not be rebuilt as a molecule.")
            posed = exported[0]
            pose_identity = Chem.MolToSmiles(Chem.RemoveHs(posed), isomericSmiles=True)
            if pose_identity != facts["inputSmiles"]:
                fail("The docked molecule's identity changed during export (%s became %s)."
                     % (facts["inputSmiles"], pose_identity))
            vina_strings[name] = poses_pdbqt
            for rank, conformer in enumerate(posed.GetConformers(), start=1):
                score, inter, intra = (float(value) for value in energies[rank - 1][:3])
                single = Chem.Mol(posed, confId=conformer.GetId())
                pose = Chem.Mol(single)
                pose.RemoveAllConformers()
                pose.AddConformer(Chem.Conformer(single.GetConformer(conformer.GetId())), assignId=True)
                pose.SetProp("_Name", name)
                for key, value in (("liatir_ligand", name), ("liatir_input_index", str(index + 1)),
                                   ("liatir_pose_rank", str(rank)), ("vina_score_kcal_per_mol", "%.3f" % score),
                                   ("vina_inter_kcal_per_mol", "%.3f" % inter),
                                   ("vina_intra_kcal_per_mol", "%.3f" % intra),
                                   ("liatir_input_smiles", facts["inputSmiles"]),
                                   ("liatir_receptor_pdbqt_sha256", identity["receptorPdbqtSha256"])):
                    pose.SetProp(key, value)
                writer.write(pose)
                if rank == 1:
                    best_poses[name] = pose
                rows.append({"ligand": name, "inputIndex": index + 1, "inputName": raw_name, "poseRank": rank,
                             "scoreKcalPerMol": round(score, 3), "interKcalPerMol": round(inter, 3),
                             "intraKcalPerMol": round(intra, 3), "heavyAtoms": facts["heavyAtoms"],
                             "ligandEfficiency": round(score / facts["heavyAtoms"], 4),
                             "hydrogensAdded": facts["hydrogensAdded"],
                             "unassignedStereocenters": facts["unassignedStereocenters"],
                             "smiles": facts["inputSmiles"]})
            log("docked %d/%d %s best %.3f kcal/mol" % (index + 1, total, name, float(energies[0][0])))
        except ValueError as error:
            rejected.append({"inputIndex": index + 1, "inputName": raw_name, "reason": str(error)})
            log("rejected %d/%d %s: %s" % (index + 1, total, raw_name or "molecule", error))
    writer.close()
    if not rows:
        fail("No ligand could be docked: %s" % "; ".join("#%d %s" % (item["inputIndex"], item["reason"])
                                                     for item in rejected[:5]))
    if len(set(row["inputIndex"] for row in rows)) + len(rejected) != total:
        fail("Batch accounting failed: every input molecule must be docked or rejected exactly once.")

    scores_path = output_dir / "docking-scores.csv"
    with open(scores_path, "w", encoding="utf-8", newline="") as handle:
        fields = ["ligand", "inputIndex", "inputName", "poseRank", "scoreKcalPerMol", "interKcalPerMol",
                  "intraKcalPerMol", "heavyAtoms", "ligandEfficiency", "hydrogensAdded",
                  "unassignedStereocenters", "smiles"]
        table = csv.DictWriter(handle, fieldnames=fields)
        table.writeheader()
        for row in sorted(rows, key=lambda item: (item["scoreKcalPerMol"], item["ligand"], item["poseRank"])):
            table.writerow(row)

    # A transformation never mutates its input: an extended database is a copy in this run's Results,
    # and the file the user chose keeps exactly the results it had.
    database_path = output_dir / "screening.db"
    if database is not None:
        shutil.copyfile(database, database_path)
    ingest_in_fresh_process(output_dir, {
        "database": str(database_path),
        "receptorPdbqt": str(receptor),
        "saveReceptor": database is None,
        "maxPoses": options["numPoses"],
        "results": vina_strings,
    })
    record_experiment(database_path, identity)
    connection = sqlite3.connect(str(database_path))
    try:
        stored_ligands = connection.execute("SELECT COUNT(*) FROM Ligands").fetchone()[0]
        stored_poses = connection.execute("SELECT COUNT(*) FROM Results").fetchone()[0]
    finally:
        connection.close()

    best = {}
    for row in rows:
        if row["poseRank"] == 1:
            best[row["ligand"]] = row
    ranked = sorted(best.values(), key=lambda item: (item["scoreKcalPerMol"], item["ligand"]))
    complex_facts = None
    complex_path = output_dir / "best-pose-complex.pdb"
    if receptor_structure is not None:
        top = ranked[0]
        complex_facts = write_complex(Chem, receptor_structure, best_poses[top["ligand"]], complex_path)
        if complex_facts is not None:
            complex_facts.update({"ligand": top["ligand"], "poseRank": 1, "scoreKcalPerMol": top["scoreKcalPerMol"]})
    summary = {
        "schemaVersion": 1,
        "kind": "liatir.docking-summary",
        "runtimeId": RUNTIME_ID,
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "versions": found_versions,
        "experiment": identity,
        "site": site,
        "options": options,
        "ligandCount": total,
        "dockedLigands": len(best),
        "rejectedLigands": rejected,
        "poseCount": len(rows),
        "ranking": ranked[:100],
        "bestPoseComplex": complex_facts,
        "database": {"path": str(database_path), "appended": database is not None,
                     "sourceSha256": sha256_file(database) if database is not None else None,
                     "storedLigands": stored_ligands, "storedPoses": stored_poses},
        "elapsedSeconds": round(time.time() - started, 3),
        "networkAccess": False,
        "hardwareEstimate": payload.get("hardwareEstimate"),
    }
    summary_path = output_dir / "docking-summary.json"
    write_json_atomic(summary_path, summary)
    return {
        "schemaVersion": 1,
        "kind": "liatir.molecular-docking-result",
        "action": "dock",
        "paths": {"posesSdf": str(poses_path), "scoresCsv": str(scores_path),
                  "screeningDatabase": str(database_path), "summaryJson": str(summary_path),
                  **({"bestPoseComplexPdb": str(complex_path)} if complex_facts is not None else {})},
        "summary": summary,
    }


def main():
    payload = json.load(sys.stdin)
    action = payload.get("action")
    if action == "preflight-receptor":
        print(json.dumps(preflight_receptor(payload), separators=(",", ":")))
        return
    if action == "preflight-dock":
        print(json.dumps(preflight_docking(payload), separators=(",", ":")))
        return
    if action == "preflight-select-complex":
        print(json.dumps(preflight_select_complex(payload), separators=(",", ":")))
        return
    deny_network()
    if action == "prepare-receptor":
        metrics = preflight_receptor(payload)
        require_measured_envelope(payload, metrics)
        result = prepare_receptor(payload, output_directory(payload))
    elif action == "dock":
        metrics = preflight_docking(payload)
        require_measured_envelope(payload, metrics)
        result = dock(payload, output_directory(payload), metrics)
    elif action == "select-complex":
        metrics = preflight_select_complex(payload)
        require_measured_envelope(payload, metrics)
        result = select_complex(payload, output_directory(payload))
    elif action == "ringtail-ingest":
        result = ringtail_ingest(payload)
    else:
        fail("Unsupported docking action.")
    print(json.dumps(result, separators=(",", ":")))


if __name__ == "__main__":
    main()
`;
