/**
 * The exact script Liatir runs inside the Boltz-2 Runtime Box.
 *
 * It receives the Boltz YAML document `adaptBoltz2Input` already produced, so the shape of a
 * prediction is decided once, in the shared contract, and never re-derived here.
 */
export const BOLTZ_STRUCTURE_SCRIPT = String.raw`
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
    raise SystemExit("Boltz-2 runtime path is missing.")
runtime = Path(runtime_path).resolve()
cache_dir = Path(payload.get("modelCacheDir") or (runtime / "model-cache" / "boltz-2")).resolve()

# A prediction reads only what the box already carries. Boltz's own CLI would reach for the network
# to fill a missing cache, and the entry point in the box replaces that step with a refusal; denying
# sockets here is the second half, and it also covers the MSA server the product never asks for.
def blocked(*_args, **_kwargs):
    raise RuntimeError("Network access is forbidden in a Liatir Boltz-2 run.")

socket.create_connection = blocked
_connect = socket.socket.connect
_connect_ex = socket.socket.connect_ex

def _blocked_connect(sock, address):
    # Local sockets stay open: PyTorch's own inter-process machinery uses them, and they reach
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

REQUIRED_CACHE = {
    "structure model": cache_dir / "boltz2_conf.ckpt",
    "affinity model": cache_dir / "boltz2_aff.ckpt",
    "molecule dictionary": cache_dir / "mols",
}
missing = [label for label, path in REQUIRED_CACHE.items() if not path.exists()]
if missing:
    raise SystemExit("Boltz-2 installation is incomplete. Missing: " + ", ".join(missing))

boltz_input = payload.get("boltzInput")
if not isinstance(boltz_input, dict) or not boltz_input.get("sequences"):
    raise SystemExit("Boltz-2 received no complex to predict.")

predict_affinity = bool(boltz_input.get("properties"))
accelerator = (payload.get("accelerator") or "cpu").lower()
if accelerator not in ("cpu", "cuda"):
    raise SystemExit("Boltz-2 supports the cpu and cuda accelerators.")

seed = int(payload.get("seed", 0))
diffusion_samples = max(1, min(int(payload.get("diffusionSamples") or 1), 25))
recycling_steps = max(0, min(int(payload.get("recyclingSteps") or 3), 10))
sampling_steps = max(10, min(int(payload.get("samplingSteps") or 200), 1000))

# Token count drives both runtime and memory, so it is reported before anything is loaded and the
# caller can refuse a job the measured envelope does not cover.
def entity_length(entry):
    for kind in ("protein", "dna", "rna"):
        if kind in entry:
            body = entry[kind]
            copies = body.get("id")
            count = len(copies) if isinstance(copies, list) else 1
            return len(body.get("sequence") or "") * count
    body = entry.get("ligand") or {}
    copies = body.get("id")
    count = len(copies) if isinstance(copies, list) else 1
    # A ligand's token cost is its atoms; SMILES length is an upper bound cheap enough to compute
    # without a chemistry toolkit, and the caller only needs an order of magnitude here.
    return len(body.get("smiles") or body.get("ccd") or "") * count

token_estimate = sum(entity_length(entry) for entry in boltz_input["sequences"])
chain_count = sum(
    len(body["id"]) if isinstance(body.get("id"), list) else 1
    for entry in boltz_input["sequences"] for body in [next(iter(entry.values()))]
)
single_sequence_chains = sum(
    1 for entry in boltz_input["sequences"]
    if "protein" in entry and entry["protein"].get("msa") == "empty"
)

if action == "preflight":
    print(json.dumps({
        "kind": "liatir.boltz-2-preflight",
        "workloadId": "affinity" if predict_affinity else "structure",
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "singleSequenceChains": single_sequence_chains,
        "diffusionSamples": diffusion_samples,
        "accelerator": accelerator,
    }, sort_keys=True))
    raise SystemExit(0)

output_dir = Path(payload["outputDir"]).resolve()
output_dir.mkdir(parents=True, exist_ok=True)
job_name = re.sub(r"[^A-Za-z0-9_-]", "-", str(payload.get("jobName") or "complex"))[:48] or "complex"

sys.path.insert(0, str(runtime / "runners"))
import boltz_predict  # replaces Boltz's download step with a check over the bundled cache
import torch
import yaml

if accelerator == "cuda" and not torch.cuda.is_available():
    raise SystemExit("This Boltz-2 Runtime Box needs an NVIDIA GPU, and none is available.")

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
input_yaml = input_dir / (job_name + ".yaml")
input_yaml.write_text(yaml.safe_dump(boltz_input, sort_keys=False), encoding="utf-8")

arguments = [
    str(input_yaml),
    "--out_dir", str(output_dir),
    "--cache", str(cache_dir),
    "--accelerator", "gpu" if accelerator == "cuda" else "cpu",
    "--devices", "1",
    # Dataloader workers fork the interpreter, which would carry neither the patched download step
    # nor the socket refusal above into the child. Staying in one process keeps both, and makes the
    # measured peak memory the real one.
    "--num_workers", "0",
    "--preprocessing-threads", "1",
    "--recycling_steps", str(recycling_steps),
    "--sampling_steps", str(sampling_steps),
    "--diffusion_samples", str(diffusion_samples),
    "--output_format", "mmcif",
    "--seed", str(seed),
    "--override",
    "--model", "boltz2",
    # Boltz's CUDA path imports cuEquivariance's triangular-multiplication kernels unless this is
    # passed, and that import fails in a box that does not carry them. They are closed-source NVIDIA
    # libraries reached through an extra Boltz calls optional, and boltz/model/layers/triangular_mult
    # keeps a pure PyTorch implementation of the same operation for exactly this case. Slower, same
    # mathematics, and no proprietary dependency shipped for a speed-up nobody has measured here yet.
    "--no_kernels",
]

started = time.monotonic()
try:
    boltz_predict.boltz.main.cli.main(args=["predict", *arguments], standalone_mode=False)
except SystemExit as stop:
    if stop.code not in (None, 0):
        raise
elapsed_ms = int((time.monotonic() - started) * 1000)

predictions = output_dir / ("boltz_results_" + input_yaml.stem) / "predictions" / input_yaml.stem
if not predictions.is_dir():
    raise SystemExit("Boltz-2 produced no prediction directory.")

def model_rank(path):
    # Boltz ranks its samples and names them model_0, model_1, ... Sorting the names as text puts
    # model_10 ahead of model_2, which would hand the caller the wrong "best" structure as soon as
    # more than ten samples are asked for.
    digits = re.search(r"_model_(\d+)$", path.stem)
    return int(digits.group(1)) if digits else 0

structures = sorted(predictions.glob(input_yaml.stem + "_model_*.cif"), key=model_rank)
if not structures:
    raise SystemExit("Boltz-2 produced no structure.")

def read_json(path):
    if not path.is_file():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)

confidences = [read_json(predictions / ("confidence_" + path.stem + ".json")) for path in structures]
affinity = read_json(predictions / ("affinity_" + input_yaml.stem + ".json"))
if predict_affinity and affinity is None:
    raise SystemExit("Boltz-2 was asked for an affinity and returned none.")

# The ranked-first model is what a user sees, so it is copied out under a stable name rather than
# leaving the caller to work out Boltz's own file naming.
primary = structures[0]
primary_confidence = confidences[0] or {}
result_structure = output_dir / (job_name + ".cif")
shutil.copyfile(primary, result_structure)

paths = {"structure": str(result_structure), "inputDocument": str(input_yaml)}
for index, path in enumerate(structures):
    paths["model" + str(index)] = str(path)
confidence_path = output_dir / (job_name + "-confidence.json")
confidence_path.write_text(json.dumps(primary_confidence, indent=2, sort_keys=True), encoding="utf-8")
paths["confidence"] = str(confidence_path)
if affinity is not None:
    affinity_path = output_dir / (job_name + "-affinity.json")
    affinity_path.write_text(json.dumps(affinity, indent=2, sort_keys=True), encoding="utf-8")
    paths["affinity"] = str(affinity_path)

warnings = [
    "Boltz-2 predictions are computational models, not experimental structures.",
]
if single_sequence_chains:
    warnings.append(
        str(single_sequence_chains) + " protein chain(s) were predicted without an alignment. "
        "Single-sequence mode is markedly less accurate and upstream does not recommend it."
    )
if predict_affinity:
    warnings.append(
        "Predicted affinity is a ranking signal for one binder against one target, not a measured "
        "binding constant."
    )

print(json.dumps({
    "kind": "liatir.boltz-2-result",
    "summary": {
        "runtimeId": payload.get("runtimeId"),
        "runtimeBoxRelease": payload.get("runtimeBoxRelease"),
        "targetId": payload.get("targetId"),
        "boltzVersion": "2.2.1",
        "accelerator": accelerator,
        "networkAccess": False,
        "seed": seed,
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "singleSequenceChains": single_sequence_chains,
        "modelCount": len(structures),
        "diffusionSamples": diffusion_samples,
        "recyclingSteps": recycling_steps,
        "samplingSteps": sampling_steps,
        "elapsedMs": elapsed_ms,
        "confidenceScore": primary_confidence.get("confidence_score"),
        "complexPlddt": primary_confidence.get("complex_plddt"),
        "ptm": primary_confidence.get("ptm"),
        "iptm": primary_confidence.get("iptm"),
        "affinityPredValue": (affinity or {}).get("affinity_pred_value"),
        "affinityProbabilityBinary": (affinity or {}).get("affinity_probability_binary"),
        "gpuModel": device.get("gpuModel"),
        "gpuMemoryBytes": device.get("gpuMemoryBytes"),
        "computeCapability": device.get("computeCapability"),
    },
    "paths": paths,
    "warnings": warnings,
}, sort_keys=True))
`;
