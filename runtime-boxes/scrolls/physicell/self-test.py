"""Builder-only self-test for the PhysiCell Runtime Box.

Proves the reviewed executable is present and runnable, runs PhysiCell's template model for two
simulated hours on one thread in a temporary directory, and reads the cells and substrate it wrote.
Nothing is written inside the payload: Scrollcase packs the payload after this test.
"""

import hashlib
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import xml.etree.ElementTree as ET

EXECUTABLE = Path("physicell/bin/physicell-1.14.2-template-linux-x86_64").resolve()
EXECUTABLE_SHA256 = "2dd954ad781fe9088a483a070b120701ce70b57a2ef253276617142fe34952f1"
SETTINGS = Path("physicell/config/PhysiCell_settings.xml").resolve()


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the PhysiCell Runtime Box self-test.")


socket.create_connection = blocked
socket.getaddrinfo = blocked

import numpy as np  # noqa: E402
import scipy.io  # noqa: E402

assert hashlib.sha256(EXECUTABLE.read_bytes()).hexdigest() == EXECUTABLE_SHA256, "not the reviewed executable"

with tempfile.TemporaryDirectory(prefix="physicell-self-test-") as work:
    run = Path(work)
    (run / "config").mkdir()
    (run / "output").mkdir()
    # The build directory holds the downloaded file without modes; the archive marks it executable from
    # the scroll's declaration. The test runs a copy, so the payload stays exactly as it will be packed.
    copy = run / "physicell"
    shutil.copyfile(EXECUTABLE, copy)
    copy.chmod(0o755)
    root = ET.parse(SETTINGS).getroot()
    for path, value in (("overall/max_time", "120"), ("parallel/omp_num_threads", "1"),
                        ("options/random_seed", "7"), ("save/folder", "output")):
        root.find(path).text = value
    ET.ElementTree(root).write(run / "config/PhysiCell_settings.xml", encoding="utf-8", xml_declaration=True)
    completed = subprocess.run([str(copy), "config/PhysiCell_settings.xml"], cwd=run,
                               stdout=subprocess.PIPE, stderr=subprocess.STDOUT, stdin=subprocess.DEVNULL,
                               env={**os.environ, "OMP_NUM_THREADS": "1"}, check=False)
    assert completed.returncode == 0, completed.stdout.decode("utf-8", "replace")[-2000:]
    cells = scipy.io.loadmat(run / "output/final_cells.mat")["cells"]
    environment = scipy.io.loadmat(run / "output/final_microenvironment0.mat")["multiscale_microenvironment"]
    # The template places five cells of its one type; none die or divide within two hours.
    assert cells.shape[1] == 5, cells.shape
    assert np.isfinite(cells).all() and np.isfinite(environment).all()
    print("PhysiCell self-test passed: %d cells, %d voxels" % (cells.shape[1], environment.shape[1]))
