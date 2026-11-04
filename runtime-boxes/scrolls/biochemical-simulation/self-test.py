"""Builder-only self-test for the biochemical simulation Runtime Box.

Proves the exact PySB version, BioNetGen's presence, offline operation, PySB's Robertson model against
the IVP test set's reference solution, and stochastic replicates that differ when their seeds differ
and repeat when they do not.
"""

import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import tempfile

EXPECTED_PYSB = "1.17.0"
# Mazzia and Magherini, Test Set for IVP Solvers, problem ROBER: y(1e11) in extended precision.
ROBERTSON_REFERENCE = {"A": 0.2083340149701255e-07, "B": 0.8333360770334713e-13, "C": 0.9999999791665050}


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the biochemical simulation Runtime Box self-test.")


socket.create_connection = blocked
socket.getaddrinfo = blocked
original_connect = socket.socket.connect


def blocked_connect(sock, address):
    if sock.family == socket.AF_UNIX:
        return original_connect(sock, address)
    return blocked()


socket.socket.connect = blocked_connect

assert importlib.metadata.version("pysb") == EXPECTED_PYSB, importlib.metadata.version("pysb")
bng = Path("bionetgen-release/BioNetGen-2.9.3").resolve()
for relative in ("BNG2.pl", "bin/run_network", "LICENSE"):
    assert (bng / relative).is_file(), relative
assert not list(bng.parent.rglob("._*")), "macOS resource forks were not pruned"
os.environ["BNGPATH"] = str(bng)
# BioNetGen's BNG2.pl runs on the box's own Perl, never on one the host happens to have.
os.environ["PATH"] = os.pathsep.join([str(Path(sys.executable).parent), os.environ.get("PATH", "")])

import numpy as np
from pysb.bng import BngFileInterface
from pysb.examples import robertson, synth_deg
from pysb.simulator import ScipyOdeSimulator

# LSODA with a Python right-hand side: nothing is compiled. PySB's default integrator, VODE, fails here.
result = ScipyOdeSimulator(robertson.model, tspan=np.concatenate([[0.0], np.logspace(-5, 11, 81)]), compiler="python",
                           integrator="lsoda", integrator_options={"rtol": 1e-10, "atol": 1e-22}).run()
final = {name: float(result.observables[name + "_total"][-1]) for name in "ABC"}
errors = {name: abs(final[name] - value) / value for name, value in ROBERTSON_REFERENCE.items()}
assert max(errors.values()) < 1e-6, errors

with tempfile.TemporaryDirectory(prefix="liatir-self-test-") as scratch:
    def replicates(seeds):
        with BngFileInterface(synth_deg.model, cleanup=True, output_dir=scratch) as interface:
            interface.action("generate_network", overwrite=True)
            for index, seed in enumerate(seeds):
                interface.action("simulate", method="ssa", t_start=0, t_end=50, n_steps=50, seed=seed,
                                 prefix="run%d" % index, print_functions=True)
                interface.action("resetConcentrations")
            interface.execute()
            return [record["A_total"] for record in BngFileInterface.read_simulation_results_multi(
                [os.path.join(interface.base_directory, "run%d" % index) for index in range(len(seeds))])]

    first = replicates([11, 12])
    again = replicates([11])
    assert not np.array_equal(first[0], first[1]), "different seeds gave identical stochastic runs"
    assert np.array_equal(first[0], again[0]), "the same seed did not repeat its stochastic run"

print(json.dumps({
    "status": "passed",
    "pysb": EXPECTED_PYSB,
    "robertsonRelativeError": {name: float("%.2e" % value) for name, value in errors.items()},
    "networkAccess": False,
}, sort_keys=True))
