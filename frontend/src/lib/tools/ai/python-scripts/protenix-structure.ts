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
# Protenix's default LayerNorm is a CUDA extension compiled on first use, which needs ninja and a
# compiler toolchain. A packed box carries neither, and asking a user's machine to build a kernel
# mid-prediction would be slow where it worked and baffling where it did not. Upstream reads this at
# import time and its own tests set exactly this value.
os.environ["LAYERNORM_TYPE"] = "torch"
# One half of what upstream's own deterministic mode needs. cuBLAS reads this when it creates its
# handle, so it has to be in the environment before torch touches the GPU; the other half is the
# configuration switch set just before Protenix builds its runner.
os.environ["CUBLAS_WORKSPACE_CONFIG"] = ":4096:8"
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
        "This Runtime Box is incomplete: " + ", ".join(missing)
        + (" is" if len(missing) == 1 else " are") + " missing from "
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
# Protenix draws a whole prediction from its seed, trunk included, so every sample inside one seed
# shares that seed's fate: measured on ubiquitin without an alignment, five samples drawn at a bad
# seed were all equally wrong, and doubling the recycling did not rescue them. Independent seeds are
# what helps. Upstream already scores structures so they can be ranked, and that score separated the
# folded from the misfolded runs cleanly here, so the seeds compete and the best-scoring one is
# returned. Consecutive values keep one number in the caller's hands and the whole draw reproducible.
seed_count = max(1, min(int(payload.get("seedCount") or 5), 10))
seeds = [seed + offset for offset in range(seed_count)]
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
    # An offline box has no alignment server, so every prediction here is alignment-free. That is
    # the largest single caveat on the accuracy of the result, so the caller is told before
    # anything is loaded, not afterwards in the summary.
    print(json.dumps({
        "kind": "liatir.protenix-preflight",
        "workloadId": "structure",
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "sampleCount": samples,
        # What the run will actually cost: one trajectory per seed, each drawing its own samples.
        "seedCount": seed_count,
        "structureCount": seed_count * samples,
        "accelerator": accelerator,
        "usedMsa": False,
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
from configs.configs_base import configs as protenix_configs

# Upstream defaults this to False, which lets CUDA pick kernels whose summation order varies from
# one process to the next. A diffusion model amplifies that: at one fixed seed this box produced
# ubiquitin at 1.39 A twice and at 12.3 A once, so the seed promised a reproducibility it did not
# deliver. True is upstream's own switch — seed_everything() then pins cuDNN and torch's
# non-deterministic kernels. Refusing beats predicting something nobody can reproduce.
if "deterministic" not in protenix_configs:
    raise SystemExit(
        "This Protenix build has no determinism switch, so a prediction could not be reproduced. "
        "Refusing to predict."
    )
protenix_configs["deterministic"] = True

arguments = [
    "-i", str(input_json),
    "-o", str(output_dir),
    "-n", MODEL_NAME,
    "-s", ",".join(str(value) for value in seeds),
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
# name is an internal detail. Finding the structures by shape rather than by path keeps this working
# when that detail changes.
structures = list(output_dir.rglob("*_sample_*.cif"))
if not structures:
    raise SystemExit("Protenix produced no structure.")

def seed_of(structure):
    digits = re.match(r"^seed_(\d+)$", structure.parent.parent.name)
    return int(digits.group(1)) if digits else None

def read_json(path):
    if not path.is_file():
        return None
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)

def confidence_for(structure):
    name = structure.name.replace("_sample_", "_summary_confidence_sample_").replace(".cif", ".json")
    return read_json(structure.parent / name)

def plddt_fraction(value):
    # Protenix reports pLDDT on 0-100, Boltz-2 on 0-1. A product that shows both side by side needs
    # one number to mean one thing, so confidence leaves here as a fraction in every model.
    return None if value is None else float(value) / 100.0

def ranking_of(structure):
    value = (confidence_for(structure) or {}).get("ranking_score")
    return float(value) if isinstance(value, (int, float)) else float("-inf")

# Best first, by the score Protenix itself uses to order the samples drawn at one seed, applied
# across the seeds as well. The path breaks ties so two runs of one input cannot disagree about
# which structure came first.
structures.sort(key=lambda path: (-ranking_of(path), str(path)))

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

# Measured on this box against the experimental ubiquitin structure: runs that found the fold scored
# 0.93 and above, and the runs that missed it entirely — 12 A of backbone error — scored 0.71. The
# confidence separates the two cleanly, so a low one is said out loud here rather than left for a
# reader to notice in a JSON file.
LOW_CONFIDENCE = 0.85
primary_plddt = plddt_fraction(primary_confidence.get("plddt"))
if primary_plddt is not None and primary_plddt < LOW_CONFIDENCE:
    warnings.append(
        "Confidence is low (pLDDT " + format(primary_plddt, ".2f") + " against " +
        format(LOW_CONFIDENCE, ".2f") + " for a prediction that can be relied on). On this model a "
        "score this low has meant the fold itself is wrong, not merely imprecise. Treat this "
        "structure as unreliable."
    )

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
        "deterministic": True,
        "seed": seed,
        "seedCount": len(seeds),
        "selectedSeed": seed_of(primary),
        "structureCount": len(structures),
        "tokenEstimate": token_estimate,
        "chainCount": chain_count,
        "sampleCount": samples,
        "recyclingSteps": cycles,
        "diffusionSteps": steps,
        "elapsedMs": elapsed_ms,
        "rankingScore": primary_confidence.get("ranking_score"),
        "plddt": primary_plddt,
        "ptm": primary_confidence.get("ptm"),
        "iptm": primary_confidence.get("iptm"),
        "gpuModel": device.get("gpuModel"),
        "gpuMemoryBytes": device.get("gpuMemoryBytes"),
        "computeCapability": device.get("computeCapability"),
        # The CUDA this torch was built for, which a release holds to the target's, and the peak
        # its allocator reached in this process, where Protenix ran.
        "reportedCudaCompatibility": torch.version.cuda if accelerator == "cuda" else None,
        "peakVramBytes": int(torch.cuda.max_memory_allocated()) if accelerator == "cuda" else None,
    },
    "paths": paths,
    "warnings": warnings,
}, sort_keys=True))
`;
