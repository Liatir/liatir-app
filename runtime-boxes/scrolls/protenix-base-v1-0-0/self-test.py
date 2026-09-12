"""Builder-only Protenix base v1.0.0 Runtime Box self-test.

Bounded on purpose: this proves the box is assembled the way the scroll says and that the whole
dependency stack starts, not that a prediction is right. The scientific validator does the latter,
against the same signed payload.
"""

import importlib.metadata
import json
import os
from pathlib import Path
import socket
import sys
import zipfile


ROOT = Path.cwd()
CACHE = ROOT / "model-cache" / "protenix-base-v1-0-0"
CHECKPOINT = CACHE / "checkpoint" / "protenix_base_default_v1.0.0.pt"
CHECKPOINT_BYTES = 1475950125
# Protenix reads all four through `PROTENIX_ROOT_DIR`, and downloads any it cannot find. The box
# carries every one, which is what keeps an installed run off the network.
COMMON = {
    "components.cif": 490777362,
    "components.cif.rdkit_mol.pkl": 142498117,
    "clusters-by-entity-40.txt": 21699572,
    "obsolete_release_date.csv": 134716,
}


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the Protenix Runtime Box self-test.")


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

# Set before Protenix is imported: its configuration module reads this at import time and every
# data path in the package is derived from it.
os.environ["PROTENIX_ROOT_DIR"] = str(CACHE)
# Protenix's default LayerNorm is a CUDA extension it compiles on first use, which needs ninja and a
# compiler that a packed box does not carry and a user's machine should never be asked for. Upstream
# reads this at import time and its own tests set exactly this value; "torch" is the native
# implementation of the same operation.
os.environ["LAYERNORM_TYPE"] = "torch"
os.environ["WANDB_MODE"] = "disabled"
os.environ["WANDB_DISABLED"] = "true"

import numpy
import torch

assert importlib.metadata.version("protenix") == "2.0.0"
assert torch.__version__.startswith("2.7.1"), torch.__version__
assert torch.cuda.is_available()
assert torch.cuda.device_count() >= 1
# Protenix pins numpy==2.4.1 exactly, and this box honours it rather than restating it in conda
# terms — a drift here would mean the lock stopped meaning what upstream asked for.
assert numpy.__version__ == "2.4.1", numpy.__version__

# The checkpoint is a torch archive: reading its directory proves it survived download and packing
# without materialising 1.4 GB of tensors.
assert CHECKPOINT.stat().st_size == CHECKPOINT_BYTES
with zipfile.ZipFile(CHECKPOINT) as archive:
    entries = archive.namelist()
assert any(entry.endswith("/data.pkl") for entry in entries)
assert any(entry.endswith("/version") for entry in entries)

for name, expected_bytes in COMMON.items():
    path = CACHE / "common" / name
    assert path.stat().st_size == expected_bytes, name

# Importing the configuration is what proves `PROTENIX_ROOT_DIR` actually redirects every path into
# the box. A stale default would send an installed run to the user's home directory and, finding
# nothing there, to the network.
from configs.configs_data import data_configs  # noqa: E402
from configs.configs_inference import inference_configs  # noqa: E402

for key, expected in (
    ("ccd_components_file", CACHE / "common" / "components.cif"),
    ("ccd_components_rdkit_mol_file", CACHE / "common" / "components.cif.rdkit_mol.pkl"),
    ("pdb_cluster_file", CACHE / "common" / "clusters-by-entity-40.txt"),
    ("obsolete_release_data_csv", CACHE / "common" / "obsolete_release_date.csv"),
):
    assert Path(data_configs[key]) == expected, f"{key} -> {data_configs[key]}"
assert Path(inference_configs["load_checkpoint_dir"]) == CACHE / "checkpoint"

# The CLI is the surface the product drives, and importing it pulls the whole stack the way a real
# run does — which is what settles whether this pinned combination actually works together.
from runner.batch_inference import protenix_cli  # noqa: E402

assert "pred" in protenix_cli.commands

print(json.dumps({
    "status": "passed",
    "protenixVersion": importlib.metadata.version("protenix"),
    "modelName": "protenix_base_default_v1.0.0",
    "torchVersion": torch.__version__,
    "cudaVersion": torch.version.cuda,
    "numpyVersion": numpy.__version__,
    "cacheRedirected": True,
    "networkAccess": False,
}, sort_keys=True))
