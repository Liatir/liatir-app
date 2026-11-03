"""Builder-only self-test for the molecular analysis Runtime Box.

Proves exact versions, retained licence texts, offline operation, one MDAnalysis superposition on
ProLIF's packaged protein-ligand trajectory, and one ProLIF hydrogen-bond detection on its packaged
donor/acceptor pair.
"""

import importlib.metadata
import json
import math
from pathlib import Path
import socket
import sys


EXPECTED_VERSIONS = {"MDAnalysis": "2.11.0", "prolif": "2.2.3", "rdkit": "2026.9.1"}


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the molecular analysis Runtime Box self-test.")


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

for distribution in ("MDAnalysis", "prolif"):
    files = importlib.metadata.files(distribution) or []
    assert any("LICENSE" in str(path).upper() or "COPYING" in str(path).upper() for path in files), distribution

import MDAnalysis as mda
from MDAnalysis.analysis import rms
import prolif
from prolif import datafiles
from rdkit import Chem

universe = mda.Universe(datafiles.TOP, datafiles.TRAJ)
assert universe.atoms.n_atoms == 5067 and universe.trajectory.n_frames == 250
analysis = rms.RMSD(universe, select="protein and name CA").run(stop=5)
first = analysis.results.rmsd[0][2]
assert abs(first) < 1e-6 and all(math.isfinite(value) for value in analysis.results.rmsd[:, 2])

# ProLIF's own packaged pair and its negative control: a donor must bond to the acceptor and must
# not bond to the decoy whose geometry its test suite marks as no hydrogen bond. Calling an
# interaction returns a generator, which is always truthy; `any` returns True or None.
data = Path(prolif.__file__).parent / "data"


def molecule(name):
    return prolif.Molecule.from_rdkit(Chem.MolFromMol2File(str(data / name), removeHs=False))


donor, acceptor, decoy = molecule("donor.mol2"), molecule("acceptor.mol2"), molecule("acceptor_false.mol2")
fingerprint = prolif.Fingerprint(["HBDonor"])
assert fingerprint.hbdonor.any(donor[0], acceptor[0]) is True
assert fingerprint.hbdonor.any(donor[0], decoy[0]) is None

print(json.dumps({
    "status": "passed",
    "versions": EXPECTED_VERSIONS,
    "trajectoryAtoms": universe.atoms.n_atoms,
    "trajectoryFrames": universe.trajectory.n_frames,
    "caRmsdFrame4Angstrom": round(float(analysis.results.rmsd[4][2]), 4),
    "networkAccess": False,
}, sort_keys=True))
