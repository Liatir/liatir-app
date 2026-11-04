"""Builder-only self-test for the metabolic modeling Runtime Box.

Proves exact versions, retained licence texts, offline operation, that COBRApy reaches HiGHS through
optlang's hybrid interface, and that HiGHS and GLPK both reproduce COBRApy's documented optimum for
the E. coli core model it ships.
"""

import importlib.metadata
import json
import os
from pathlib import Path
import socket
import tempfile

EXPECTED_VERSIONS = {"cobra": "0.32.1", "optlang": "1.9.1", "highspy": "1.15.1", "osqp": "1.1.3",
                     "swiglpk": "5.0.13", "python-libsbml": "5.21.2"}
# COBRApy's documentation ("Simulating with FBA") reports this optimum for the textbook model.
DOCUMENTED_TEXTBOOK_GROWTH = 0.8739215069684307


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the metabolic modeling Runtime Box self-test.")


socket.create_connection = blocked
socket.getaddrinfo = blocked
original_connect = socket.socket.connect


def blocked_connect(sock, address):
    if sock.family == socket.AF_UNIX:
        return original_connect(sock, address)
    return blocked()


socket.socket.connect = blocked_connect

for name, version in EXPECTED_VERSIONS.items():
    installed = importlib.metadata.version(name)
    assert installed == version, f"{name} {installed} is not the reviewed {version}"
for distribution in ("cobra", "optlang", "highspy", "osqp"):
    files = importlib.metadata.files(distribution) or []
    assert any("LICENSE" in str(path).upper() or "COPYING" in str(path).upper() for path in files), distribution

with tempfile.TemporaryDirectory(prefix="liatir-self-test-") as scratch:
    # COBRApy creates its model cache directory on import; keep it out of the builder's home.
    os.environ["XDG_CACHE_HOME"] = scratch
    import cobra
    from cobra.util.solver import solvers

    assert {"glpk", "hybrid"} <= set(solvers), sorted(solvers)
    assert Path(cobra.Configuration().cache_directory).is_relative_to(scratch)
    textbook = cobra.io.read_sbml_model(str(Path(cobra.__file__).parent / "data" / "textbook.xml.gz"))
    optima = {}
    for solver in ("hybrid", "glpk"):
        model = textbook.copy()
        model.solver = solver
        solution = model.optimize()
        assert solution.status == "optimal", (solver, solution.status)
        assert abs(solution.objective_value - DOCUMENTED_TEXTBOOK_GROWTH) < 1e-9, (solver, solution.objective_value)
        optima[solver] = solution.objective_value

print(json.dumps({
    "status": "passed",
    "versions": EXPECTED_VERSIONS,
    "textbookGrowthPerHour": {solver: round(value, 12) for solver, value in optima.items()},
    "networkAccess": False,
}, sort_keys=True))
