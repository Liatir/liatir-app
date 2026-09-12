/**
 * The exact script Liatir runs inside the Protenix base v1.0.0 Runtime Box.
 *
 * It receives the Protenix input document `adaptProtenixInput` already produced, so the shape of a
 * prediction is decided once, in the shared contract, and never re-derived here.
 */
export const PROTENIX_STRUCTURE_SCRIPT = String.raw`
import json
import os
from pathlib import Path
import re
import shutil
import socket
import sys
import time

payload = json.loads(sys.stdin.read() or "{}")
action = payload.get("action") or "run"
runtime_path = payload.get("runtimePath")
if not runtime_path:
    raise SystemExit("Protenix runtime path is missing.")
runtime = Path(runtime_path).resolve()
cache_dir = Path(payload.get("modelCacheDir")
                 or (runtime / "model-cache" / "protenix-base-v1-0-0")).resolve()

MODEL_NAME = "protenix_base_default_v1.0.0"

# Every data path inside Protenix is derived from this at import time, so it is set before the
# package is touched. Left unset it resolves to the user's home directory, finds nothing, and
# Protenix downloads the whole cache from ByteDance — which is precisely what an installed,
# offline box exists to avoid.
os.environ["PROTENIX_ROOT_DIR"] = str(cache_dir)
os.environ["WANDB_MODE"] = "disabled"
os.environ["WANDB_DISABLED"] = "true"
os.environ["WANDB_SILENT"] = "true"
os.environ["HF_HUB_OFFLINE"] = "1"

def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in a Liatir Protenix run.")

socket.create_connection = blocked
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex

def _blocked_connect(sock, address):
    # Local sockets stay open: PyTorch's own inter-process machinery uses them and they reach
    # nothing outside this machine.
    if sock.family == getattr(socket, "AF_UNIX", None):
        return _connect(sock, address)
    return blocked()

def _blocked_connect_ex(sock, address):
    if sock.family == getattr(socket, "AF_UNIX", None):
        return _connect_ex(sock, address)
    return blocked()

socket.socket.connect = _blocked_connect
socket.socket.connect_ex = _blocked_connect_ex

REQUIRED = {
    "the structure model": cache_dir / "checkpoint" / (MODEL_NAME + ".pt"),
    "the chemical component dictionary": cache_dir / "common" / "components.cif",
    "the precomputed molecule dictionary": cache_dir / "common" / "components.cif.rdkit_mol.pkl",
    "the entity cluster file": cache_dir / "common" / "clusters-by-entity-40.txt",
    "the obsolete-entry dates": cache_dir / "common" / "obsolete_release_date.csv",
}
missing = [label for label, path in REQUIRED.items() if not path.exists()]
if missing:
    raise SystemExit(
        "This Runtime Box is incomplete: " + ", ".join(missing) + " is missing from "
        + str(cache_dir) + ". Reinstall the model rather than letting Protenix download it, which "
        "would leave the box carrying assets nobody signed."
    )

document = payload.get("protenixInput")
if not isinstance(document, list) or not document:
    raise SystemExit("Protenix received no complex to predict.")
entry = document[0]
if not isinstance(entry, dict) or not entry.get("sequences"):
    raise SystemExit("Protenix received no complex to predict.")

accelerator = (payload.get("accelerator") or "cpu").lower()
if accelerator not in ("cpu", "cuda"):
    raise SystemExit("Protenix supports the cpu and cuda accelerators.")

seed = int(payload.get("seed", 101))
samples = max(1, min(int(payload.get("sampleCount") or 5), 25))
cycles = max(1, min(int(payload.get("recyclingSteps") or 10), 20))
steps = max(10, min(int(payload.get("diffusionSteps") or 200), 1000))

def entity_length(item):
    for kind in ("proteinChain", "dnaSequence", "rnaSequence"):
        if kind in item:
            body = item[kind]
            return len(body.get("sequence") or "") * int(body.get("count") or 1)
    body = item.get("ligand") or {}
    # A ligand's token cost is its atoms; the SMILES or CCD string is a cheap upper bound, and the
    # caller only needs an order of magnitude before anything is loaded.
    return len(str(body.get("ligand") or body.get("smiles") or "")) * int(body.get("count") or 1)

token_estimate = sum(entity_length(item) for item in entry["sequences"])
chain_count = sum(int(next(iter(item.values())).get("count") or 1) for item in entry["sequences"])

if action == "preflight":
    print(json.dumps({
        "kind": "liatir.protenix-preflight",
        "workloadId": "structure",
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "sampleCount": samples,
        "accelerator": accelerator,
    }, sort_keys=True))
    raise SystemExit(0)

output_dir = Path(payload["outputDir"]).resolve()
output_dir.mkdir(parents=True, exist_ok=True)
job_name = re.sub(r"[^A-Za-z0-9_-]", "-", str(payload.get("jobName") or "complex"))[:48] or "complex"

import torch

if accelerator == "cuda" and not torch.cuda.is_available():
    raise SystemExit("This Protenix Runtime Box needs an NVIDIA GPU, and none is available.")

# Read the card from the process that will use it. The evidence contract cross-checks these against
# what the host reports independently, so a run that quietly fell back to the CPU cannot pass.
device = {}
if accelerator == "cuda":
    properties = torch.cuda.get_device_properties(0)
    device = {
        "gpuModel": torch.cuda.get_device_name(0),
        "gpuMemoryBytes": int(properties.total_memory),
        "computeCapability": str(properties.major) + "." + str(properties.minor),
    }

input_dir = output_dir / "input"
input_dir.mkdir(parents=True, exist_ok=True)
input_json = input_dir / (job_name + ".json")
entry = dict(entry)
entry["name"] = job_name
input_json.write_text(json.dumps([entry], indent=2), encoding="utf-8")

from runner.batch_inference import protenix_cli

arguments = [
    "-i", str(input_json),
    "-o", str(output_dir),
    "-n", MODEL_NAME,
    "-s", str(seed),
    "-c", str(cycles),
    "-p", str(steps),
    "-e", str(samples),
    # Upstream defaults this to True, and True means Protenix contacts its own MSA server to build
    # an alignment. An offline box cannot and must not. Predictions are therefore single-sequence,
    # which is less accurate, and the result says so rather than leaving the caller to assume.
    "--use_msa", "False",
    # Both kernels default to cuEquivariance — closed-source NVIDIA libraries reached through pins
    # Protenix never imports. The torch setting is the pure-PyTorch implementation of the same
    # operations: slower, same mathematics, and nothing proprietary on the execution path.
    "--trimul_kernel", "torch",
    "--triatt_kernel", "torch",
    "--use_template", "False",
    "--use_rna_msa", "False",
]

started = time.monotonic()
try:
    protenix_cli.main(args=["pred", *arguments], standalone_mode=False)
except SystemExit as stop:
    if stop.code not in (None, 0):
        raise
elapsed_ms = int((time.monotonic() - started) * 1000)

# Protenix writes under <out_dir>/<dataset>/<sample>/seed_<n>/predictions/, and the exact dataset
# name is an internal detail. Finding the structures by shape rather than by path keeps this
# working when that detail changes, and the rank suffix is what orders them.
def sample_rank(path):
    digits = re.search(r"_sample_(\d+)$", path.stem)
    return int(digits.group(1)) if digits else 0

structures = sorted(output_dir.rglob("*_sample_*.cif"), key=sample_rank)
if not structures:
    raise SystemExit("Protenix produced no structure.")

def read_json(path):
    if not path.is_file():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)

def confidence_for(structure):
    name = structure.name.replace("_sample_", "_summary_confidence_sample_").replace(".cif", ".json")
    return read_json(structure.parent / name)

primary = structures[0]
primary_confidence = confidence_for(primary) or {}
result_structure = output_dir / (job_name + ".cif")
shutil.copyfile(primary, result_structure)

paths = {"structure": str(result_structure), "inputDocument": str(input_json)}
for index, path in enumerate(structures):
    paths["sample" + str(index)] = str(path)
confidence_path = output_dir / (job_name + "-confidence.json")
confidence_path.write_text(json.dumps(primary_confidence, indent=2, sort_keys=True), encoding="utf-8")
paths["confidence"] = str(confidence_path)

warnings = [
    "Protenix predictions are computational models, not experimental structures.",
    "This prediction ran without a multiple sequence alignment, which is markedly less accurate "
    "than upstream's recommended configuration. An offline Runtime Box has no alignment server.",
]

print(json.dumps({
    "kind": "liatir.protenix-result",
    "summary": {
        "runtimeId": payload.get("runtimeId"),
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "protenixVersion": "2.0.0",
        "modelName": MODEL_NAME,
        "accelerator": accelerator,
        "networkAccess": False,
        "usedMsa": False,
        "kernels": "torch",
        "seed": seed,
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "sampleCount": len(structures),
        "recyclingSteps": cycles,
        "diffusionSteps": steps,
        "elapsedMs": elapsed_ms,
        "rankingScore": primary_confidence.get("ranking_score"),
        "plddt": primary_confidence.get("plddt"),
        "ptm": primary_confidence.get("ptm"),
        "iptm": primary_confidence.get("iptm"),
        "gpuModel": device.get("gpuModel"),
        "gpuMemoryBytes": device.get("gpuMemoryBytes"),
        "computeCapability": device.get("computeCapability"),
    },
    "paths": paths,
    "warnings": warnings,
}, sort_keys=True))
`;
