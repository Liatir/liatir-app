export const CELLTYPIST_ANNOTATE_SCRIPT = String.raw`
import json
import os
import sys
import warnings

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
    os.environ.setdefault("XDG_CACHE_HOME", os.path.join(runtime_path, "model-cache"))

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL.*")

import celltypist
import anndata
import numpy as np
from celltypist import models
from scipy import sparse

input_file = payload["inputFile"]
output_dir = payload["outputDir"]
model_name = payload.get("celltypistModel") or "Immune_All_Low.pkl"
majority_voting = bool(payload.get("majorityVoting", False))
os.makedirs(output_dir, exist_ok=True)

def normalize_log1p_10000(adata):
    adata = adata.copy()
    target_sum = 10000.0
    x = adata.X
    if sparse.issparse(x):
        x = x.tocsr(copy=True)
        counts = np.asarray(x.sum(axis=1)).ravel().astype(np.float64)
        scale = np.divide(target_sum, counts, out=np.zeros_like(counts, dtype=np.float64), where=counts > 0)
        x = x.multiply(scale[:, None]).tocsr()
        x.data = np.log1p(x.data)
        adata.X = x
    else:
        x = np.asarray(x, dtype=np.float32)
        counts = x.sum(axis=1).astype(np.float64)
        scale = np.divide(target_sum, counts, out=np.zeros_like(counts, dtype=np.float64), where=counts > 0)
        adata.X = np.log1p(x * scale[:, None])
    return adata

def annotate_with_auto_preprocessing():
    try:
        return celltypist.annotate(input_file, model=model_name, majority_voting=majority_voting), "as_provided"
    except ValueError as exc:
        if "Invalid expression matrix" not in str(exc):
            raise
        print("Input .X is not CellTypist-normalized; applying normalize_total(target_sum=10000) + log1p.", file=sys.stderr)
        adata = anndata.read_h5ad(input_file)
        adata = normalize_log1p_10000(adata)
        return celltypist.annotate(adata, model=model_name, majority_voting=majority_voting), "normalized_log1p_10000"

models.download_models(model=[model_name], force_update=False)
prediction, preprocessing = annotate_with_auto_preprocessing()
labels = prediction.predicted_labels
labels_path = os.path.join(output_dir, "celltypist-labels.csv")
summary_path = os.path.join(output_dir, "celltypist-summary.json")

labels.to_csv(labels_path)

label_column = "majority_voting" if majority_voting and "majority_voting" in labels.columns else "predicted_labels"
counts = labels[label_column].astype(str).value_counts().to_dict()
cell_count = int(labels.shape[0])
label_count = int(len(counts))
top_label = max(counts, key=counts.get) if counts else None
top_count = int(counts[top_label]) if top_label else 0
top_fraction = (top_count / cell_count) if cell_count else 0

summary = {
    "cellCount": cell_count,
    "labelCount": label_count,
    "labelColumn": label_column,
    "topLabel": top_label,
    "topCount": top_count,
    "topFraction": top_fraction,
    "counts": counts,
    "model": model_name,
    "majorityVoting": majority_voting,
    "preprocessing": preprocessing,
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "labelsPath": labels_path,
    "summaryPath": summary_path,
    "summary": summary,
}))
`;

export const SEQUENCE_EMBEDDING_SCRIPT = String.raw`
import csv
import json
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", cache_dir)
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)

import numpy as np
import torch
from transformers import AutoModel, AutoModelForMaskedLM, AutoTokenizer

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
            current_id = line[1:].strip() or f"seq_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current)))
    return records

def load_sequences():
    input_file = payload.get("inputFile")
    inline = (payload.get("sequence") or "").strip()
    if input_file:
        with open(input_file, "r", encoding="utf-8", errors="replace") as fh:
            text = fh.read()
        records = parse_fasta(text)
        if records:
            return records
        compact = "".join(line.strip() for line in text.splitlines() if line.strip())
        return [("sequence_1", compact)] if compact else []
    if inline.startswith(">"):
        return parse_fasta(inline)
    return [("sequence_1", inline)] if inline else []

model_id = payload["hubModelId"]
revision = payload.get("hubRevision") or None
molecule_type = payload.get("moleculeType", "dna")
output_dir = payload["outputDir"]
max_length = int(payload.get("maxLength") or 1024)
os.makedirs(output_dir, exist_ok=True)

records = load_sequences()
if not records:
    raise SystemExit("No input sequence provided")

if molecule_type in ("dna", "rna"):
    cleaned = []
    for seq_id, seq in records:
        seq = seq.upper().replace("U", "T")
        cleaned.append((seq_id, "".join(ch for ch in seq if ch in "ACGTN")))
    records = cleaned
else:
    records = [(seq_id, seq.upper().replace("*", "")) for seq_id, seq in records]

device = "cpu"
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"

tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
is_nucleotide_transformer = model_id.startswith("InstaDeepAI/nucleotide-transformer")
if is_nucleotide_transformer:
    model = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
else:
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model.eval()
model.to(device)

ids = [seq_id for seq_id, _ in records]
seqs = [seq for _, seq in records]
with torch.no_grad():
    if is_nucleotide_transformer:
        encoded = tokenizer.batch_encode_plus(
            seqs,
            return_tensors="pt",
            padding="max_length",
            truncation=True,
            max_length=max_length,
        )
        input_ids = encoded["input_ids"].to(device)
        mask = (input_ids != tokenizer.pad_token_id).to(device)
        output = model(
            input_ids,
            attention_mask=mask,
            encoder_attention_mask=mask,
            output_hidden_states=True,
        )
        hidden = output["hidden_states"][-1]
    else:
        encoded = tokenizer(
            seqs,
            return_tensors="pt",
            padding=True,
            truncation=True,
            max_length=max_length,
        )
        encoded = {k: v.to(device) for k, v in encoded.items()}
        output = model(**encoded)
        hidden = output.last_hidden_state
        mask = encoded.get("attention_mask")
    if mask is None:
        pooled = hidden.mean(dim=1)
    else:
        expanded = mask.unsqueeze(-1).expand(hidden.size()).float()
        pooled = (hidden * expanded).sum(dim=1) / expanded.sum(dim=1).clamp(min=1.0)
    embeddings = pooled.detach().cpu().numpy()

embedding_path = os.path.join(output_dir, "sequence-embeddings.csv")
summary_path = os.path.join(output_dir, "sequence-embedding-summary.json")
with open(embedding_path, "w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    dim = embeddings.shape[1]
    writer.writerow(["sequence_id", "length"] + [f"dim_{i}" for i in range(dim)])
    for seq_id, seq, emb in zip(ids, seqs, embeddings):
        writer.writerow([seq_id, len(seq)] + [float(x) for x in emb])

summary = {
    "sequenceCount": int(len(records)),
    "embeddingDim": int(embeddings.shape[1]),
    "model": model_id,
    "revision": revision,
    "moleculeType": molecule_type,
    "device": device,
    "meanSequenceLength": float(np.mean([len(seq) for seq in seqs])),
    "maxLength": max_length,
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "embeddingPath": embedding_path,
    "summaryPath": summary_path,
    "summary": summary,
    "preview": embeddings[:3, :8].tolist(),
}))
`;

export const GENOMIC_VARIANT_EFFECT_SCRIPT = String.raw`
import csv
import json
import math
import os
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if cache_dir:
    os.makedirs(cache_dir, exist_ok=True)
    os.environ.setdefault("HF_HOME", cache_dir)
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)

import numpy as np
import torch
from transformers import AutoModelForMaskedLM, AutoTokenizer

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
            current_id = line[1:].strip().split()[0] or f"sequence_{len(records) + 1}"
            current = []
        else:
            current.append(line)
    if current_id is not None:
        records.append((current_id, "".join(current)))
    return records

def load_reference():
    reference_file = payload.get("referenceFile") or ""
    inline = (payload.get("sequence") or "").strip()
    reference_name = (payload.get("referenceName") or "").strip()
    if reference_file:
        with open(reference_file, "r", encoding="utf-8", errors="replace") as fh:
            records = parse_fasta(fh.read())
    elif inline:
        records = parse_fasta(inline) if inline.startswith(">") else [(reference_name or "sequence_1", inline)]
    else:
        records = []
    if not records:
        raise SystemExit("Reference FASTA or inline reference sequence is required.")
    if reference_name:
        for seq_id, seq in records:
            if seq_id == reference_name:
                return seq_id, clean_dna(seq)
        raise SystemExit(f"Reference name '{reference_name}' was not found in the FASTA input.")
    seq_id, seq = records[0]
    return seq_id, clean_dna(seq)

def clean_dna(seq):
    return "".join(ch for ch in seq.upper().replace("U", "T") if ch in "ACGTN")

def parse_vcf(path, reference_name, max_variants):
    variants = []
    with open(path, "r", encoding="utf-8", errors="replace") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            cols = line.split("\t")
            if len(cols) < 5:
                continue
            chrom, pos_raw, variant_id, ref, alts = cols[:5]
            if reference_name and chrom != reference_name:
                continue
            try:
                pos = int(pos_raw)
            except ValueError:
                continue
            alt = alts.split(",")[0].strip().upper()
            if not alt or alt == ".":
                continue
            variants.append({
                "chrom": chrom,
                "pos": pos,
                "id": variant_id if variant_id and variant_id != "." else f"{chrom}:{pos}:{ref}>{alt}",
                "ref": clean_dna(ref),
                "alt": clean_dna(alt),
            })
            if len(variants) >= max_variants:
                break
    return variants

def variant_windows(reference_seq, variants, window_start, flank_size):
    windows = []
    warnings = []
    seq_len = len(reference_seq)
    for variant in variants:
        local = variant["pos"] - window_start
        ref = variant["ref"]
        alt = variant["alt"]
        if local < 0 or local >= seq_len:
            warnings.append(f"{variant['id']} is outside the provided reference window.")
            continue
        observed = reference_seq[local:local + len(ref)]
        ref_match = observed == ref
        if not ref_match:
            warnings.append(f"{variant['id']} REF mismatch: VCF={ref}, FASTA={observed or 'out-of-range'}.")
        left = max(0, local - flank_size)
        right = min(seq_len, local + max(1, len(ref)) + flank_size)
        prefix = reference_seq[left:local]
        suffix = reference_seq[local + len(ref):right]
        ref_window = reference_seq[left:right]
        alt_window = prefix + alt + suffix
        windows.append({
            **variant,
            "local": local,
            "windowStart": window_start + left,
            "windowEnd": window_start + right - 1,
            "refWindow": ref_window,
            "altWindow": alt_window,
            "refMatch": ref_match,
        })
    return windows, warnings

def embed_sequences(model, tokenizer, seqs, max_length, device):
    encoded = tokenizer.batch_encode_plus(
        seqs,
        return_tensors="pt",
        padding="max_length",
        truncation=True,
        max_length=max_length,
    )
    input_ids = encoded["input_ids"].to(device)
    mask = (input_ids != tokenizer.pad_token_id).to(device)
    with torch.no_grad():
        output = model(
            input_ids,
            attention_mask=mask,
            encoder_attention_mask=mask,
            output_hidden_states=True,
        )
        hidden = output["hidden_states"][-1]
        expanded = mask.unsqueeze(-1).expand(hidden.size()).float()
        pooled = (hidden * expanded).sum(dim=1) / expanded.sum(dim=1).clamp(min=1.0)
    return pooled.detach().cpu().numpy()

def cosine_distance(a, b):
    denom = np.linalg.norm(a) * np.linalg.norm(b)
    if denom <= 0:
        return 0.0
    return float(1.0 - (np.dot(a, b) / denom))

model_id = payload["hubModelId"]
revision = payload.get("hubRevision") or None
output_dir = payload["outputDir"]
variant_file = payload.get("variantFile") or ""
window_start = int(payload.get("windowStart") or 1)
flank_size = max(1, min(int(payload.get("flankSize") or 256), 4096))
max_variants = max(1, min(int(payload.get("maxVariants") or 20), 1000))
max_length = max(16, min(int(payload.get("maxLength") or 1024), 4096))
os.makedirs(output_dir, exist_ok=True)

if not variant_file:
    raise SystemExit("Variant VCF file is required.")

reference_name, reference_seq = load_reference()
variants = parse_vcf(variant_file, reference_name, max_variants)
if not variants:
    raise SystemExit("No variants from the VCF overlap the selected reference sequence/window.")

windows, warnings = variant_windows(reference_seq, variants, window_start, flank_size)
if not windows:
    raise SystemExit("No variants could be converted into reference/alternate windows.")

device = "cpu"
if torch.cuda.is_available():
    device = "cuda"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = "mps"

tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir, revision=revision)
model.eval()
model.to(device)

seqs = []
for item in windows:
    seqs.append(item["refWindow"])
    seqs.append(item["altWindow"])
embeddings = embed_sequences(model, tokenizer, seqs, max_length, device)

rows = []
for index, item in enumerate(windows):
    ref_emb = embeddings[index * 2]
    alt_emb = embeddings[index * 2 + 1]
    cos = cosine_distance(ref_emb, alt_emb)
    l2 = float(np.linalg.norm(alt_emb - ref_emb))
    rows.append({
        "variantId": item["id"],
        "chrom": item["chrom"],
        "pos": item["pos"],
        "ref": item["ref"],
        "alt": item["alt"],
        "windowStart": item["windowStart"],
        "windowEnd": item["windowEnd"],
        "refMatch": item["refMatch"],
        "cosineDistance": cos,
        "l2Delta": l2,
        "score": min(1000, max(0, int(round(cos * 1000)))),
    })

scores_path = os.path.join(output_dir, "variant-effect-scores.csv")
bed_path = os.path.join(output_dir, "variant-effect-scores.bed")
summary_path = os.path.join(output_dir, "variant-effect-summary.json")

with open(scores_path, "w", newline="", encoding="utf-8") as fh:
    writer = csv.DictWriter(fh, fieldnames=list(rows[0].keys()))
    writer.writeheader()
    writer.writerows(rows)

with open(bed_path, "w", encoding="utf-8") as fh:
    for row in rows:
        start0 = max(0, int(row["pos"]) - 1)
        end0 = start0 + max(1, len(row["ref"]))
        fh.write(f"{row['chrom']}\t{start0}\t{end0}\t{row['variantId']}\t{row['score']}\n")

top = max(rows, key=lambda row: row["cosineDistance"])
summary = {
    "variantCount": len(rows),
    "referenceName": reference_name,
    "windowStart": window_start,
    "referenceLength": len(reference_seq),
    "model": model_id,
    "revision": revision,
    "device": device,
    "flankSize": flank_size,
    "maxLength": max_length,
    "topVariant": top,
    "warnings": warnings[:100],
}
with open(summary_path, "w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "scoresPath": scores_path,
    "bedPath": bed_path,
    "summaryPath": summary_path,
    "summary": summary,
    "preview": rows[:10],
}))
`;

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
