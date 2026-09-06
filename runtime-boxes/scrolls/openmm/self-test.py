"""Builder-only OpenMM Runtime Box self-test shared by every signed target."""

import hashlib
import importlib.metadata
import json
import math
import os
from pathlib import Path
import socket
import sys


ROOT = Path.cwd()
SOURCE = ROOT / "source" / "openmmforcefields"
NAGL_MODEL = "openff-gnn-am1bcc-1.0.0.pt"
NAGL_SHA256 = "7981e7f5b0b1e424c9e10a40d9e7606d96dcd3dd2b095cb4eeff6829f92238ee"


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the OpenMM Runtime Box self-test.")


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
sys.path.insert(0, str(SOURCE))

import openff.toolkit
import openmm
import openmmforcefields
from openff.nagl_models import _dynamic_fetch as nagl_dynamic_fetch
from openff.nagl_models import validate_nagl_model_path
from openff.toolkit import Molecule
from openmm import Context, Platform, VerletIntegrator, unit
from openmm.app import ForceField, NoCutoff
from openmmforcefields.generators import SMIRNOFFTemplateGenerator


assert importlib.metadata.version("openmm") == "8.5.1"
assert openmmforcefields.__version__ == "0.16.0"
assert openff.toolkit.__version__ == "0.17.1"
assert importlib.metadata.version("openff-interchange") == "0.4.11"
assert importlib.metadata.version("openforcefields") == "2026.1.0"
assert importlib.metadata.version("openff-nagl-models") == "2025.9.0"
assert importlib.metadata.version("rdkit") == "2025.3.6"
import torch
assert importlib.metadata.version("torch") == "2.10.0"
assert torch.version.cuda is None

prefix = Path(sys.prefix)
for licence_name in ("Licenses.txt", "LGPL.txt", "GPL.txt"):
    assert any(path.is_file() for path in prefix.rglob(licence_name)), licence_name

nagl_cache = ROOT / "model-cache" / "openmm" / "self-test-nagl"
nagl_cache.mkdir(parents=True, exist_ok=True)
nagl_dynamic_fetch.CACHE_DIR = nagl_cache
nagl_path = Path(validate_nagl_model_path(NAGL_MODEL)).resolve()
assert hashlib.sha256(nagl_path.read_bytes()).hexdigest() == NAGL_SHA256

ligand = Molecule.from_smiles("CCO")
ligand.generate_conformers(n_conformers=1)
ligand.assign_partial_charges(partial_charge_method=NAGL_MODEL)
generator = SMIRNOFFTemplateGenerator(molecules=[ligand], forcefield="openff-2.3.0.offxml")
forcefield = ForceField("amber19-all.xml", "amber19/tip3pfb.xml")
forcefield.registerTemplateGenerator(generator.generator)
topology = ligand.to_topology().to_openmm()
system = forcefield.createSystem(topology, nonbondedMethod=NoCutoff)
assert system.getNumParticles() == ligand.n_atoms

expected = os.environ["LIATIR_EXPECTED_OPENMM_ACCELERATOR"]
platform_name = {"cpu": "CPU", "cuda": "CUDA"}[expected]
platform = Platform.getPlatformByName(platform_name)
properties = {"Threads": "1"} if expected == "cpu" else {
    "Precision": "mixed",
    "DeterministicForces": "true",
}
integrator = VerletIntegrator(0.001 * unit.picoseconds)
context = Context(system, integrator, platform, properties)
context.setPositions(ligand.conformers[0].to_openmm())
energy = context.getState(getEnergy=True).getPotentialEnergy().value_in_unit(unit.kilojoule_per_mole)
assert math.isfinite(float(energy))
del context, integrator

print(json.dumps({
    "status": "passed",
    "openmmVersion": openmm.version.short_version,
    "openmmforcefieldsVersion": openmmforcefields.__version__,
    "openffForceFieldsVersion": importlib.metadata.version("openforcefields"),
    "forceField": "amber19-all+tip3p-fb+openff-2.3.0+nagl-am1bcc-1.0.0",
    "naglModelSha256": NAGL_SHA256,
    "platform": platform_name,
    "particles": system.getNumParticles(),
    "networkAccess": False,
}, sort_keys=True))
