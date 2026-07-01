export const PROTEIN_STRUCTURE_SCRIPT = String.raw`
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("BOLTZ_CACHE", cache_dir)
    os.environ.setdefault("CHAI_DOWNLOADS_DIR", cache_dir)

base_output_dir = Path(payload["outputDir"])
run_id = re.sub(r"[^A-Za-z0-9_-]", "_", str(payload.get("runId") or uuid.uuid4().hex[:12]))
output_dir = base_output_dir / f"run_{run_id}"
output_dir.mkdir(parents=True, exist_ok=True)

def parse_fasta(text):
    records = []
    current_id = None
    current = []
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith(">"):
            if current_id is not None:
                records.append((current_id, "".join(current)))
            current_id = line[1:].strip() or f"chain_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current)))
    return records

def load_protein_records():
    input_file = payload.get("inputFile") or ""
    inline = (payload.get("sequence") or "").strip()
    if input_file:
        text = Path(input_file).read_text(encoding="utf-8", errors="replace")
        records = parse_fasta(text)
        if records:
            return records
        inline = text.strip()
    if inline.startswith(">"):
        return parse_fasta(inline)
    return [("protein", inline)] if inline else []

def clean_protein_sequence(sequence):
    cleaned = re.sub(r"[^A-Za-z]", "", sequence).upper().replace("U", "C")
    allowed = set("ACDEFGHIKLMNPQRSTVWYBXZJO")
    invalid = sorted(set(cleaned) - allowed)
    if invalid:
        raise SystemExit(f"Unsupported amino acid code(s): {', '.join(invalid)}")
    if not cleaned:
        raise SystemExit("Protein sequence is empty after cleaning.")
    return cleaned

def chain_id(index):
    alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if index < len(alphabet):
        return alphabet[index]
    return f"A{index + 1}"

def write_boltz_yaml(path, records):
    import yaml

    use_msa_server = bool(payload.get("useMsaServer", True))
    sequences = []
    for index, (_, sequence) in enumerate(records):
        protein = {
            "id": chain_id(index),
            "sequence": clean_protein_sequence(sequence),
        }
        if not use_msa_server:
            protein["msa"] = "empty"
        sequences.append({"protein": protein})

    ligand_smiles = (payload.get("ligandSmiles") or "").strip()
    ligand_ccd = (payload.get("ligandCcd") or "").strip()
    binder_id = None
    if ligand_smiles and ligand_ccd:
        raise SystemExit("Provide either ligand SMILES or ligand CCD, not both.")
    if ligand_smiles:
        binder_id = "L"
        sequences.append({"ligand": {"id": binder_id, "smiles": ligand_smiles}})
    elif ligand_ccd:
        binder_id = "L"
        sequences.append({"ligand": {"id": binder_id, "ccd": ligand_ccd.upper()}})

    data = {
        "version": 1,
        "sequences": sequences,
    }
    if binder_id and bool(payload.get("predictAffinity", True)):
        data["properties"] = [{"affinity": {"binder": binder_id}}]

    path.write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    return binder_id

def write_chai_fasta(path, records):
    lines = []
    for index, (_, sequence) in enumerate(records):
        lines.append(f">protein|name=chain_{chain_id(index)}")
        lines.append(clean_protein_sequence(sequence))
    ligand_smiles = (payload.get("ligandSmiles") or "").strip()
    if ligand_smiles:
        lines.append(">ligand|name=ligand_smiles")
        lines.append(ligand_smiles)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")

def run_subprocess(command):
    print("$ " + " ".join(command), file=sys.stderr)
    result = subprocess.run(command, text=True, capture_output=True)
    if result.stdout.strip():
        print(result.stdout.strip(), file=sys.stderr)
    if result.stderr.strip():
        print(result.stderr.strip(), file=sys.stderr)
    return result.returncode

def first_existing(patterns):
    matches = []
    for pattern in patterns:
        matches.extend(glob.glob(str(pattern), recursive=True))
    return sorted(set(matches))[0] if matches else None

def read_json(path):
    if not path:
        return {}
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception:
        return {}

def run_boltz(records):
    input_path = output_dir / "liatir_boltz_input.yaml"
    binder_id = write_boltz_yaml(input_path, records)
    boltz_result_dir = output_dir / f"boltz_results_{input_path.stem}"
    output_format = payload.get("outputFormat") or "mmcif"
    accelerator = payload.get("accelerator") or "cpu"
    command = [
        sys.executable,
        "-m",
        "boltz.main",
        "predict",
        str(input_path),
        "--out_dir",
        str(output_dir),
        "--cache",
        str(cache_dir or (output_dir / "boltz-cache")),
        "--output_format",
        output_format,
        "--override",
        "--recycling_steps",
        str(int(payload.get("recyclingSteps") or 3)),
        "--diffusion_samples",
        str(int(payload.get("diffusionSamples") or 1)),
        "--accelerator",
        accelerator,
    ]
    if bool(payload.get("useMsaServer", True)):
        command.append("--use_msa_server")
    if bool(payload.get("usePotentials", False)):
        command.append("--use_potentials")
    if bool(payload.get("noKernels", False)):
        command.append("--no_kernels")
    return_code = run_subprocess(command)

    prediction_roots = [
        boltz_result_dir / "predictions",
        output_dir / "predictions",
    ]
    structure_path = first_existing([
        root / "**" / "*.cif" for root in prediction_roots
    ] + [
        root / "**" / "*.mmcif" for root in prediction_roots
    ] + [
        root / "**" / "*.pdb" for root in prediction_roots
    ])
    confidence_path = first_existing([root / "**" / "confidence_*.json" for root in prediction_roots])
    affinity_path = first_existing([root / "**" / "affinity_*.json" for root in prediction_roots])
    confidence = read_json(confidence_path)
    affinity = read_json(affinity_path)
    if not structure_path:
        searched = ", ".join(str(root) for root in prediction_roots)
        if return_code != 0:
            raise SystemExit(f"Model command failed with exit code {return_code}; no structure file was found under: {searched}")
        raise SystemExit(f"Boltz completed but no structure file was found under: {searched}")
    warning = None
    if return_code != 0:
        warning = f"Boltz exited with code {return_code}, but structure artifacts were found and preserved."
        print(warning, file=sys.stderr)
    return {
        "backend": "boltz2",
        "structurePath": structure_path,
        "structureFormat": "pdb" if structure_path.endswith(".pdb") else "mmcif",
        "confidencePath": confidence_path,
        "affinityPath": affinity_path,
        "confidence": confidence,
        "affinity": affinity,
        "binderId": binder_id,
        "warning": warning,
    }

def run_chai(records):
    try:
        import torch
        from chai_lab.chai1 import run_inference
    except Exception as exc:
        raise SystemExit(f"Chai-1 runtime import failed: {exc}")
    if not torch.cuda.is_available():
        raise SystemExit("Chai-1 requires CUDA. This host does not report a CUDA device.")

    input_path = output_dir / "liatir_chai_input.fasta"
    chai_output_dir = output_dir / "chai-output"
    if chai_output_dir.exists():
        shutil.rmtree(chai_output_dir)
    chai_output_dir.mkdir(parents=True, exist_ok=True)
    write_chai_fasta(input_path, records)
    candidates = run_inference(
        fasta_file=input_path,
        output_dir=chai_output_dir,
        num_trunk_recycles=int(payload.get("recyclingSteps") or 3),
        seed=int(payload.get("seed") or 42),
        device="cuda:0",
        use_esm_embeddings=True,
    )
    cif_paths = [str(path) for path in candidates.cif_paths]
    if not cif_paths:
        raise SystemExit("Chai-1 completed but did not return any CIF structure paths.")
    scores = []
    for ranking in candidates.ranking_data:
        try:
            scores.append(float(ranking.aggregate_score.item()))
        except Exception:
            pass
    return {
        "backend": "chai1",
        "structurePath": cif_paths[0],
        "structureFormat": "mmcif",
        "confidencePath": None,
        "affinityPath": None,
        "confidence": {"aggregate_score": scores[0] if scores else None},
        "affinity": {},
        "binderId": "L" if payload.get("ligandSmiles") else None,
    }

records = [(name, clean_protein_sequence(seq)) for name, seq in load_protein_records()]
if not records:
    raise SystemExit("Provide a protein FASTA file or inline protein sequence.")

backend = payload["backend"]
if backend == "boltz2":
    result = run_boltz(records)
elif backend == "chai1":
    result = run_chai(records)
else:
    raise SystemExit(f"Unsupported protein structure backend: {backend}")

summary = {
    "backend": result["backend"],
    "sequenceCount": len(records),
    "sequenceLengths": [len(seq) for _, seq in records],
    "structurePath": result["structurePath"],
    "structureFormat": result["structureFormat"],
    "confidencePath": result.get("confidencePath"),
    "affinityPath": result.get("affinityPath"),
    "confidence": result.get("confidence") or {},
    "affinity": result.get("affinity") or {},
    "binderId": result.get("binderId"),
    "warnings": [result["warning"]] if result.get("warning") else [],
    "parameters": {
        "useMsaServer": bool(payload.get("useMsaServer", True)),
        "usePotentials": bool(payload.get("usePotentials", False)),
        "predictAffinity": bool(payload.get("predictAffinity", True)),
        "recyclingSteps": int(payload.get("recyclingSteps") or 3),
        "diffusionSamples": int(payload.get("diffusionSamples") or 1),
        "accelerator": payload.get("accelerator") or "cpu",
    },
}
summary_path = output_dir / "protein-structure-summary.json"
summary_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")

print(json.dumps({
    "structurePath": result["structurePath"],
    "summaryPath": str(summary_path),
    "confidencePath": result.get("confidencePath"),
    "affinityPath": result.get("affinityPath"),
    "summary": summary,
}))
`;
