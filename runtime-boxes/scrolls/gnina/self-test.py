"""Self-test for the GNINA Runtime Box.

Loads every CUDA library GNINA links from the box itself. GNINA's official binary is an on-demand
asset: the build leaves it out, and Liatir's installer downloads it from GNINA's release, checks its
digest and places it before this test runs at install. Wherever it is present, the test starts it the
way the runner does and checks its build identity. Nothing is written inside the payload.
"""

import ctypes
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile

GNINA = Path("gnina/bin/gnina").resolve()
GNINA_BUILD = "gnina v1.3.3 master:6fe1ce2"
# Every library GNINA 1.3.3 names as NEEDED apart from glibc's; the runner preloads the same list.
PRELOADED_LIBRARIES = (
    "libstdc++.so.6", "libgcc_s.so.1", "libcudart.so.12", "libcublasLt.so.12", "libcublas.so.12",
    "libcufft.so.11", "libcusparse.so.12", "libcusolver.so.11", "libcudnn.so.9",
)


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the GNINA Runtime Box self-test.")


socket.create_connection = blocked
socket.getaddrinfo = blocked

library_dir = Path(sys.prefix) / "lib"
libraries = [library_dir / name for name in PRELOADED_LIBRARIES]
for library in libraries:
    ctypes.CDLL(str(library))

if GNINA.is_file():
    with tempfile.TemporaryDirectory(prefix="gnina-self-test-") as scratch:
        # The NVIDIA driver would otherwise create its compute cache in the user's home.
        environment = {**os.environ, "LD_PRELOAD": " ".join(str(path) for path in libraries),
                       "LD_LIBRARY_PATH": str(library_dir), "CUDA_CACHE_PATH": os.path.join(scratch, "nv-cache")}
        empty = os.path.join(scratch, "cwd")
        os.mkdir(empty)
        completed = subprocess.run([str(GNINA), "--version"], cwd=empty, env=environment, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=300, check=False)
    text = completed.stdout.decode("utf-8", "replace")
    assert completed.returncode == 0 and GNINA_BUILD in text, text[-2000:]
    print("GNINA self-test passed: %s, %d CUDA libraries from the box" % (GNINA_BUILD, len(libraries)))
else:
    print("GNINA self-test passed: %d CUDA libraries from the box; the GNINA binary is placed at install"
          % len(libraries))
