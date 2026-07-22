export const SCGPT_EMBEDDING_SCRIPT = String.raw`
import csv
import importlib
import json
import logging
import os
from pathlib import Path
import re
import sys
import types

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = Path(payload.get("runtimePath") or "").resolve()
cache_dir = Path(payload.get("modelCacheDir") or "").resolve()
if not runtime_path.is_dir():
    raise SystemExit("scGPT runtime path is missing.")
if not cache_dir.is_dir():
    raise SystemExit("scGPT model cache directory is missing.")

input_file = Path(payload["inputFile"]).resolve()
output_dir = Path(payload["outputDir"]).resolve()
batch_size = max(1, min(int(payload.get("batchSize") or 8), 64))
max_csv_rows = max(1, min(int(payload.get("maxCsvRows") or 500), 5000))
species = payload.get("species") or "human"
requested_accelerator = str(payload.get("accelerator") or "auto").lower()
if requested_accelerator not in {"auto", "cpu", "mps", "cuda"}:
    raise SystemExit(f"Unsupported scGPT accelerator: {requested_accelerator}")
if species != "human":
    raise SystemExit("scGPT Whole-human supports human single-cell transcriptomes only.")
if not input_file.is_file():
    raise SystemExit(f"AnnData file not found: {input_file.name}")

source_package = runtime_path / "source" / "scGPT" / "scgpt"
required_paths = {
    "model configuration": cache_dir / "args.json",
    "model weights": cache_dir / "best_model.pt",
    "gene vocabulary": cache_dir / "vocab.json",
    "pinned scGPT source": source_package / "model" / "model.py",
}
missing = [label for label, path in required_paths.items() if not path.is_file()]
if missing:
    raise SystemExit("scGPT installation is incomplete. Missing: " + ", ".join(missing))

import anndata
import numpy as np
import scipy.sparse as sp
import torch

# Load only the reviewed inference modules from the pinned upstream tree. The
# upstream package root imports training frameworks that cell embedding does
# not use, so the Runtime Box deliberately keeps those dependencies out.
scgpt_package = types.ModuleType("scgpt")
scgpt_package.__path__ = [str(source_package)]
scgpt_package.logger = logging.getLogger("scGPT")
sys.modules["scgpt"] = scgpt_package
for package_name, package_path in (
    ("scgpt.model", source_package / "model"),
    ("scgpt.tokenizer", source_package / "tokenizer"),
):
    package = types.ModuleType(package_name)
    package.__path__ = [str(package_path)]
    sys.modules[package_name] = package

TransformerModel = importlib.import_module("scgpt.model.model").TransformerModel
GeneVocab = importlib.import_module("scgpt.tokenizer.gene_tokenizer").GeneVocab

with required_paths["model configuration"].open("r", encoding="utf-8") as source:
    model_config = json.load(source)
vocab = GeneVocab.from_file(required_paths["gene vocabulary"])
for token in ("<pad>", "<cls>", "<eoc>"):
    if token not in vocab:
        vocab.append_token(token)
vocab.set_default_index(vocab["<pad>"])

adata = anndata.read_h5ad(str(input_file))
input_cell_count = int(adata.n_obs)
input_gene_count = int(adata.n_vars)
if input_cell_count == 0 or input_gene_count == 0:
    raise SystemExit("scGPT requires an AnnData file with at least one cell and one gene.")

summary_warnings = [
    "scGPT embeddings are exploratory representations and are not cell-type labels.",
]
if "gene_name" in adata.var.columns:
    raw_gene_names = [str(value) for value in adata.var["gene_name"].tolist()]
    gene_name_source = 'var["gene_name"]'
elif "feature_name" in adata.var.columns:
    raw_gene_names = [str(value) for value in adata.var["feature_name"].tolist()]
    gene_name_source = 'var["feature_name"]'
else:
    raw_gene_names = [str(value) for value in adata.var_names.tolist()]
    gene_name_source = "var_names"
    summary_warnings.append(
        'No var["gene_name"] column was found; Liatir used var_names as human gene symbols.'
    )

matrix = adata.X
if not sp.issparse(matrix):
    matrix = sp.csr_matrix(np.asarray(matrix))
else:
    matrix = matrix.tocsr()
if matrix.data.size and (not np.all(np.isfinite(matrix.data)) or np.min(matrix.data) < 0):
    raise SystemExit("scGPT requires finite, non-negative expression counts in AnnData .X.")
count_sample = matrix.data[: min(matrix.data.size, 100_000)]
if count_sample.size and np.mean(np.abs(count_sample - np.rint(count_sample)) > 1e-4) > 0.01:
    raise SystemExit("scGPT requires counts, but AnnData .X appears normalized or log-transformed.")

supported_indices = np.asarray(
    [index for index, gene in enumerate(raw_gene_names) if gene in vocab],
    dtype=np.int64,
)
if supported_indices.size < 50:
    raise SystemExit(
        "scGPT matched fewer than 50 genes. Provide human count data with gene symbols in "
        'var["gene_name"], var["feature_name"], or var_names.'
    )
matched_gene_names = [raw_gene_names[index] for index in supported_indices]
gene_ids = np.asarray(vocab(matched_gene_names), dtype=np.int64)
expression = matrix[:, supported_indices].tocsr()

force_cpu = os.environ.get("LIATIR_AI_FORCE_CPU") == "1"
if force_cpu and requested_accelerator not in {"auto", "cpu"}:
    raise SystemExit("LIATIR_AI_FORCE_CPU conflicts with the requested scGPT accelerator.")
if force_cpu:
    requested_accelerator = "cpu"

if requested_accelerator == "cuda" and not torch.cuda.is_available():
    raise SystemExit("scGPT CUDA was requested, but CUDA is not available.")
if requested_accelerator == "mps" and not (
    hasattr(torch.backends, "mps") and torch.backends.mps.is_available()
):
    raise SystemExit("scGPT Apple Metal was requested, but MPS is not available.")

if requested_accelerator == "cuda" or (
    requested_accelerator == "auto" and torch.cuda.is_available()
):
    device = torch.device("cuda")
    accelerator = "CUDA"
elif requested_accelerator == "mps" or (
    requested_accelerator == "auto"
    and hasattr(torch.backends, "mps")
    and torch.backends.mps.is_available()
):
    device = torch.device("mps")
    accelerator = "Apple Metal"
else:
    device = torch.device("cpu")
    accelerator = "CPU"

if requested_accelerator != "auto" and device.type != requested_accelerator:
    raise SystemExit(
        f"scGPT requested {requested_accelerator}, but selected {device.type}."
    )

model = TransformerModel(
    ntoken=len(vocab),
    d_model=model_config["embsize"],
    nhead=model_config["nheads"],
    d_hid=model_config["d_hid"],
    nlayers=model_config["nlayers"],
    nlayers_cls=model_config["n_layers_cls"],
    n_cls=1,
    vocab=vocab,
    dropout=model_config["dropout"],
    pad_token=model_config["pad_token"],
    pad_value=model_config["pad_value"],
    do_mvc=True,
    do_dab=False,
    use_batch_labels=False,
    domain_spec_batchnorm=False,
    explicit_zero_prob=False,
    use_fast_transformer=False,
    pre_norm=False,
)
checkpoint = torch.load(required_paths["model weights"], map_location="cpu", weights_only=False)
checkpoint = {
    re.sub(r"self_attn\.Wqkv\.", "self_attn.in_proj_", key): value
    for key, value in checkpoint.items()
}
model_state = model.state_dict()
compatible = {
    key: value
    for key, value in checkpoint.items()
    if key in model_state and value.shape == model_state[key].shape
}
critical_prefixes = ("encoder.", "value_encoder.", "transformer_encoder.")
missing_critical = [
    key for key in checkpoint
    if key.startswith(critical_prefixes) and key not in compatible
]
if len(compatible) < 130 or missing_critical:
    raise SystemExit(
        "scGPT checkpoint compatibility validation failed "
        f"({len(compatible)} tensors matched, {len(missing_critical)} critical tensors missing)."
    )
model_state.update(compatible)
model.load_state_dict(model_state)
# PyTorch 2.4 enables nested-tensor conversion inside TransformerEncoder, but
# its mask-alignment operator is unavailable on MPS. The regular tensor path is
# numerically equivalent for inference and keeps the remaining model on Metal.
if hasattr(model.transformer_encoder, "use_nested_tensor"):
    model.transformer_encoder.use_nested_tensor = False
model.eval()
model.to(device)

def digitize(values, bins, random_state):
    left = np.digitize(values, bins)
    right = np.digitize(values, bins, right=True)
    random_values = random_state.random(len(values))
    return np.ceil(random_values * (right - left) + left).astype(np.int64)

def bin_values(values, random_state):
    bins = np.quantile(values, np.linspace(0, 1, int(model_config["n_bins"]) - 1))
    return digitize(values, bins, random_state)

max_length = min(int(model_config.get("max_seq_len") or 1200), 1200)
pad_token_id = int(vocab[model_config["pad_token"]])
pad_value = float(model_config["pad_value"])
cls_token_id = int(vocab["<cls>"])
sequences = []
kept_positions = []
for cell_index in range(expression.shape[0]):
    row = expression.getrow(cell_index)
    if row.nnz == 0:
        continue
    random_state = np.random.default_rng(cell_index)
    values = bin_values(row.data.astype(np.float64), random_state)
    genes = gene_ids[row.indices]
    if genes.size + 1 > max_length:
        selected = random_state.permutation(genes.size)[: max_length - 1]
        genes = genes[selected]
        values = values[selected]
    sequences.append((
        np.concatenate(([cls_token_id], genes)),
        np.concatenate(([pad_value], values.astype(np.float32))),
    ))
    kept_positions.append(cell_index)
if not sequences:
    raise SystemExit("scGPT found no cells with usable human gene counts.")

embedding_batches = []
with torch.no_grad():
    for start in range(0, len(sequences), batch_size):
        batch = sequences[start : start + batch_size]
        batch_length = max(len(genes) for genes, _ in batch)
        input_genes = torch.full((len(batch), batch_length), pad_token_id, dtype=torch.long)
        input_values = torch.full((len(batch), batch_length), pad_value, dtype=torch.float32)
        for row_index, (genes, values) in enumerate(batch):
            length = len(genes)
            input_genes[row_index, :length] = torch.as_tensor(genes, dtype=torch.long)
            input_values[row_index, :length] = torch.as_tensor(values, dtype=torch.float32)
        input_genes = input_genes.to(device)
        input_values = input_values.to(device)
        encoded = model._encode(
            input_genes,
            input_values,
            src_key_padding_mask=input_genes.eq(pad_token_id),
        )
        embeddings = encoded[:, 0, :]
        embeddings = embeddings / torch.linalg.vector_norm(embeddings, dim=1, keepdim=True).clamp(min=1e-12)
        embedding_batches.append(embeddings.detach().cpu().numpy().astype(np.float32))

embeddings = np.concatenate(embedding_batches, axis=0)
result_adata = adata[kept_positions].copy()
result_adata.obsm["X_scGPT"] = embeddings
result_adata.uns["liatir_scgpt"] = {
    "model": "scGPT Whole-human",
    "upstream_revision": "cebd6fae655b9c585a4807daa3ac31bb764f06b4",
    "gene_name_source": gene_name_source,
    "value_encoding": "per-cell 51-bin quantile encoding with deterministic tie handling",
    "embedding_layer": "CLS token from the final encoder layer, L2 normalized",
}

output_dir.mkdir(parents=True, exist_ok=True)
embedded_path = output_dir / f"{input_file.stem}_scgpt_adata.h5ad"
result_adata.write_h5ad(str(embedded_path))
preview_rows = min(max_csv_rows, embeddings.shape[0])
preview_path = output_dir / "scgpt-embedding-preview.csv"
with preview_path.open("w", newline="", encoding="utf-8") as target:
    writer = csv.writer(target)
    writer.writerow(["cell_id"] + [f"dim_{index}" for index in range(embeddings.shape[1])])
    for index in range(preview_rows):
        writer.writerow([str(result_adata.obs_names[index])] + [float(value) for value in embeddings[index]])

excluded_cells = input_cell_count - len(kept_positions)
if excluded_cells:
    summary_warnings.append(f"Excluded {excluded_cells} cells with no genes in the scGPT vocabulary.")
summary = {
    "cellCount": int(embeddings.shape[0]),
    "geneCount": int(supported_indices.size),
    "matchedGeneCount": int(supported_indices.size),
    "inputCellCount": input_cell_count,
    "inputGeneCount": input_gene_count,
    "embeddingDim": int(embeddings.shape[1]),
    "embeddingKey": "X_scGPT",
    "embeddingLayer": "final encoder CLS token, L2 normalized",
    "normalization": "scGPT 51-bin per-cell quantile value encoding",
    "model": "scGPT Whole-human",
    "species": "human",
    "batchSize": batch_size,
    "previewRows": preview_rows,
    "intermediateCount": 0,
    "accelerator": accelerator,
    "requestedAccelerator": requested_accelerator,
    "peakVramBytes": int(torch.cuda.max_memory_allocated()) if device.type == "cuda" else None,
    "warnings": summary_warnings,
}
summary_path = output_dir / "scgpt-embedding-summary.json"
with summary_path.open("w", encoding="utf-8") as target:
    json.dump(summary, target, indent=2)

print(json.dumps({
    "embeddedAnnDataPath": str(embedded_path),
    "embeddingPreviewPath": str(preview_path),
    "summaryPath": str(summary_path),
    "intermediatePaths": [],
    "summary": summary,
    "preview": embeddings[: min(3, embeddings.shape[0]), : min(8, embeddings.shape[1])].tolist(),
}))
`;
