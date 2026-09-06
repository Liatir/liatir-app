"""Keep OpenMM's native libraries relative to this relocatable Python environment."""

import os
from pathlib import Path
import sys


# OpenMM's conda build records its original build prefix in version.py. The documented
# override must be set before any import, including consumer checks and OpenFF imports.
_library = Path(sys.prefix) / ("Library/lib" if sys.platform == "win32" else "lib")
os.environ["OPENMM_PLUGIN_DIR"] = str(_library / "plugins")

# Python 3.8+ does not use PATH for extension DLL dependencies on Windows. Keep the
# handles alive for the interpreter lifetime; closing them removes the search paths.
_liatir_openmm_dll_handles = []
if sys.platform == "win32":
    for _directory in (_library.parent / "bin", _library):
        if _directory.is_dir():
            _liatir_openmm_dll_handles.append(os.add_dll_directory(str(_directory)))
