"""Builder-only self-test for the molecular docking Runtime Box.

Proves exact versions, retained licence texts, offline operation and one real receptor-ligand
evaluation on the official AutoDock Vina 1IEP example: Meeko prepares both molecules, PDBFixer
reads the receptor through the box's OpenMM, and Vina scores the crystal pose.
"""

import importlib.metadata
import io
import json
import math
from pathlib import Path
import socket
import sys
import tempfile


ROOT = Path.cwd()
REFERENCE = ROOT / "reference" / "vina-1iep"
# Box centre and size from the official 1iep_receptor.box.txt.
BOX_CENTER = [15.190, 53.903, 16.917]
BOX_SIZE = [20.0, 20.0, 20.0]
EXPECTED_VERSIONS = {
    "vina": "1.2.7",
    "meeko": "0.8.0",
    "ringtail": "2.3.1",
    "pdbfixer": "1.12.0",
    "openmm": "8.5.1",
    "rdkit": "2024.9.6",
    "gemmi": "0.7.5",
    "prody": "2.6.1",
}


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the molecular docking Runtime Box self-test.")


socket.create_connection = blocked
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex


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

for name, version in EXPECTED_VERSIONS.items():
    installed = importlib.metadata.version(name)
    assert installed == version, f"{name} {installed} is not the reviewed {version}"

prefix = Path(sys.prefix)
for licence_name in ("Licenses.txt", "LGPL.txt", "GPL.txt"):
    assert any(path.is_file() for path in prefix.rglob(licence_name)), licence_name

from meeko import MoleculePreparation, PDBQTWriterLegacy, Polymer, ResidueChemTemplates
from openmm import Platform
from pdbfixer import PDBFixer
import prody
from rdkit import Chem
import ringtail
from vina import Vina

prody.confProDy(verbosity="none")

# The conda OpenMM build is unified, so GPU plugins may load on a GPU host; the runner always names
# the CPU platform for PDBFixer, which therefore has to be present.
platforms = sorted(Platform.getPlatform(index).getName() for index in range(Platform.getNumPlatforms()))
assert {"CPU", "Reference"} <= set(platforms), platforms

receptor_text = (REFERENCE / "1iep_receptorH.pdb").read_text(encoding="utf-8")
fixer = PDBFixer(pdbfile=io.StringIO(receptor_text), platform=Platform.getPlatformByName("CPU"))
fixer.findMissingResidues()
fixer.findMissingAtoms()
receptor_atoms = fixer.topology.getNumAtoms()
assert receptor_atoms > 4000, receptor_atoms

ligand = Chem.MolFromMolFile(str(REFERENCE / "1iep_ligand.sdf"), removeHs=False)
assert ligand is not None and ligand.GetNumAtoms() == 69, "official imatinib SDF did not load"
ligand_setups = MoleculePreparation().prepare(ligand)
assert len(ligand_setups) == 1
ligand_pdbqt, ligand_ok, ligand_error = PDBQTWriterLegacy.write_string(ligand_setups[0])
assert ligand_ok, ligand_error

# The path Meeko's own mk_prepare_receptor takes for -i: ProDy keeps every altloc and groups atoms by
# residue (the official receptor lists one Ser438 hydrogen apart from its residue), and charges come
# from the residue templates rather than being recomputed.
templates = ResidueChemTemplates.create_from_defaults()
structure = prody.parsePDB(str(REFERENCE / "1iep_receptorH.pdb"), altloc="all")
polymer = Polymer.from_prody(structure, templates, MoleculePreparation.from_config({"compute_charges": False}))
receptor_pdbqt, flexible = PDBQTWriterLegacy.write_from_polymer(polymer)
assert not flexible

with tempfile.TemporaryDirectory() as scratch:
    receptor_path = Path(scratch) / "receptor.pdbqt"
    receptor_path.write_text(receptor_pdbqt, encoding="utf-8")
    vina = Vina(sf_name="vina", cpu=1, seed=1, verbosity=0)
    vina.set_receptor(str(receptor_path))
    vina.set_ligand_from_string(ligand_pdbqt)
    vina.compute_vina_maps(center=BOX_CENTER, box_size=BOX_SIZE)
    crystal_score = float(vina.score()[0])
assert math.isfinite(crystal_score) and crystal_score < 0, crystal_score

print(json.dumps({
    "status": "passed",
    "versions": EXPECTED_VERSIONS,
    "openmmPlatforms": platforms,
    "ringtailModule": ringtail.__name__,
    "receptorAtoms": receptor_atoms,
    "ligandAtoms": ligand.GetNumAtoms(),
    "crystalPoseVinaScoreKcalPerMol": round(crystal_score, 3),
    "networkAccess": False,
}, sort_keys=True))
