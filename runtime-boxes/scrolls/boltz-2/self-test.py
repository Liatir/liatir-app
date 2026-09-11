"""Builder-only Boltz-2 Runtime Box self-test.

Bounded on purpose. This proves the box is assembled the way the scroll says and that the whole
dependency stack starts; it does not predict a structure. A prediction needs minutes of GPU time and
a reference to compare against, which is the scientific validator's job on the same signed payload.
"""

import importlib.metadata
import json
import os
from pathlib import Path
import re
import socket
import sys
import zipfile


ROOT = Path.cwd()
CACHE = ROOT / "model-cache" / "boltz-2"
MOLS = CACHE / "mols"
# A PDB chemical component identifier: up to three characters historically, five since that space
# ran out. The bound is deliberately loose on length and strict on alphabet, because the alphabet is
# what rules out a path, a nested directory or anything else that is not one component's pickle.
CCD_ID = re.compile(r"^[0-9A-Z]{1,5}$")
CONF_CKPT_BYTES = 2286561469
AFF_CKPT_BYTES = 2062139170


def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in the Boltz-2 Runtime Box self-test.")


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

import numpy
import torch

assert importlib.metadata.version("boltz") == "2.2.1"
# Read off the module rather than the distribution: PyTorch arrives from conda-forge, where the
# package is named `pytorch`, and what `torch` reports for itself is the version that will run.
assert torch.__version__.startswith("2.8.0"), torch.__version__
assert torch.version.cuda == "12.9"
# Boltz requires numpy<2 and the conda side carries the same bound, so a drift here means the two
# halves of the lock disagreed and the box would fail on the first array crossing between them.
assert numpy.__version__.startswith("1.26."), numpy.__version__
assert torch.cuda.is_available()
assert torch.cuda.device_count() >= 1

# `pandas>=2.2.2` is Boltz's one loose upstream bound, and the resolver took 3.0.5 — a major release
# published after Boltz 2.2.1. Importing the CLI is what settles whether that combination works,
# because it pulls the entire stack the way a real run does.
sys.path.insert(0, str(ROOT / "runners"))
import boltz_predict  # noqa: E402  (the path above is what makes it importable)
import pandas  # noqa: E402

assert boltz_predict.boltz.main.download_boltz2 is boltz_predict.validate_bundled_cache
assert os.environ["WANDB_MODE"] == "disabled"

# The bundled cache is what the entry point checks in place of downloading, so the check itself is
# exercised here rather than trusted: it must pass on a complete box.
boltz_predict.validate_bundled_cache(CACHE)

for name, expected_bytes in (
    ("boltz2_conf.ckpt", CONF_CKPT_BYTES),
    ("boltz2_aff.ckpt", AFF_CKPT_BYTES),
):
    checkpoint = CACHE / name
    assert checkpoint.stat().st_size == expected_bytes, name
    # A torch checkpoint is a ZIP holding a pickle and a format version. Reading the directory
    # proves it survived download and packing intact, without materialising 2 GB of tensors.
    with zipfile.ZipFile(checkpoint) as archive:
        entries = archive.namelist()
    assert any(entry.endswith("/data.pkl") for entry in entries), name
    assert any(entry.endswith("/version") for entry in entries), name

# The molecule dictionary is redistributed on the strength of being PDB Chemical Component
# Dictionary data, which is CC0. That claim is only as good as the contents, so the contents are
# checked: every member is one component's pickle, named by its CCD identifier and nothing else.
pickles = sorted(path.name for path in MOLS.iterdir())
assert len(pickles) > 40000, len(pickles)
unexpected = [name for name in pickles
              if not name.endswith(".pkl") or not CCD_ID.match(name[:-4])]
assert not unexpected, unexpected[:10]
for well_known in ("ATP.pkl", "HEM.pkl", "NAD.pkl"):
    assert well_known in pickles, well_known

print(json.dumps({
    "status": "passed",
    "boltzVersion": importlib.metadata.version("boltz"),
    "torchVersion": torch.__version__,
    "cudaVersion": torch.version.cuda,
    "numpyVersion": numpy.__version__,
    "pandasVersion": pandas.__version__,
    "moleculeDefinitions": len(pickles),
    "downloadPathReplaced": True,
    "networkAccess": False,
}, sort_keys=True))
