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

tokenizer = AutoTokenizer.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
is_nucleotide_transformer = model_id.startswith("InstaDeepAI/nucleotide-transformer")
if is_nucleotide_transformer:
    model = AutoModelForMaskedLM.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
else:
    model = AutoModel.from_pretrained(model_id, trust_remote_code=True, cache_dir=cache_dir)
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
