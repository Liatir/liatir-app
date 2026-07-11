export const GENEFORMER_EMBEDDING_SCRIPT = String.raw`
import csv
import json
import os
from pathlib import Path
import pickle
import sys

payload = json.loads(sys.stdin.read() or "{}")
runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
    os.environ.setdefault("XDG_CACHE_HOME", os.path.join(runtime_path, "model-cache"))
    os.environ.setdefault("HF_HOME", os.path.join(runtime_path, "model-cache", "huggingface"))

if not runtime_path:
    raise SystemExit("Geneformer runtime path is missing.")
if not cache_dir:
    raise SystemExit("Geneformer model cache directory is missing.")

input_file = Path(payload["inputFile"]).resolve()
output_dir = Path(payload["outputDir"]).resolve()
batch_size = max(1, min(int(payload.get("batchSize") or 25), 256))
max_csv_rows = max(1, min(int(payload.get("maxCsvRows") or 500), 5000))
species = payload.get("species") or "human"

if species != "human":
    raise SystemExit("Geneformer V1 10M supports human single-cell transcriptomes only.")
if not input_file.is_file():
    raise SystemExit(f"AnnData file not found: {input_file.name}")

cache_root = Path(cache_dir).resolve()
model_dir = cache_root / "model"
dictionaries_dir = cache_root / "dictionaries"
required_paths = {
    "model configuration": model_dir / "config.json",
    "model weights": model_dir / "model.safetensors",
    "token dictionary": dictionaries_dir / "token_dictionary_gc30M.pkl",
    "gene median dictionary": dictionaries_dir / "gene_median_dictionary_gc30M.pkl",
    "Ensembl mapping dictionary": dictionaries_dir / "ensembl_mapping_dict_gc30M.pkl",
}
missing = [label for label, path in required_paths.items() if not path.is_file()]
if missing:
    raise SystemExit("Geneformer installation is incomplete. Missing: " + ", ".join(missing))

import anndata
import numpy as np
import scipy.sparse as sp
import torch
from transformers import AutoModelForMaskedLM

with required_paths["token dictionary"].open("rb") as fh:
    token_dictionary = pickle.load(fh)
with required_paths["gene median dictionary"].open("rb") as fh:
    gene_medians = pickle.load(fh)
with required_paths["Ensembl mapping dictionary"].open("rb") as fh:
    ensembl_mapping = pickle.load(fh)

adata = anndata.read_h5ad(str(input_file))
input_cell_count = int(adata.n_obs)
input_gene_count = int(adata.n_vars)
if input_cell_count == 0 or input_gene_count == 0:
    raise SystemExit("Geneformer requires an AnnData file with at least one cell and one gene.")

summary_warnings = [
    "Geneformer V1 embeddings are exploratory representations and are not cell-type labels.",
]

if "ensembl_id" in adata.var.columns:
    raw_gene_ids = [str(value) for value in adata.var["ensembl_id"].tolist()]
    gene_id_source = 'var["ensembl_id"]'
else:
    raw_gene_ids = [str(value) for value in adata.var_names.tolist()]
    gene_id_source = "var_names"
    summary_warnings.append('No var["ensembl_id"] column was found; Liatir used var_names as Ensembl IDs.')

def canonical_gene_id(value):
    gene_id = str(value).strip().upper().split(".", 1)[0]
    return str(ensembl_mapping.get(gene_id, gene_id)).strip().upper().split(".", 1)[0]

canonical_ids = np.asarray([canonical_gene_id(value) for value in raw_gene_ids], dtype=object)
supported_mask = np.asarray([
    gene_id in token_dictionary and gene_id in gene_medians and float(gene_medians[gene_id]) > 0
    for gene_id in canonical_ids
], dtype=bool)
supported_indices = np.flatnonzero(supported_mask)
if supported_indices.size < 50:
    raise SystemExit(
        "Geneformer matched fewer than 50 genes. Provide human raw-count data with Ensembl IDs in "
        'var["ensembl_id"] or var_names.'
    )

matrix = adata.X
if not sp.issparse(matrix):
    matrix = sp.csr_matrix(np.asarray(matrix))
else:
    matrix = matrix.tocsr()
if matrix.data.size and (not np.all(np.isfinite(matrix.data)) or np.min(matrix.data) < 0):
    raise SystemExit("Geneformer requires finite, non-negative raw expression counts in AnnData .X.")
count_sample = matrix.data[: min(matrix.data.size, 100_000)]
if count_sample.size and np.mean(np.abs(count_sample - np.rint(count_sample)) > 1e-4) > 0.01:
    raise SystemExit(
        "Geneformer requires raw counts, but AnnData .X appears normalized or log-transformed."
    )

selected_ids = canonical_ids[supported_indices]
unique_ids, inverse = np.unique(selected_ids, return_inverse=True)
projection = sp.csr_matrix(
    (np.ones(supported_indices.size, dtype=np.float32), (np.arange(supported_indices.size), inverse)),
    shape=(supported_indices.size, unique_ids.size),
)
expression = (matrix[:, supported_indices] @ projection).tocsr()
gene_tokens = np.asarray([int(token_dictionary[gene_id]) for gene_id in unique_ids], dtype=np.int64)
median_vector = np.asarray([float(gene_medians[gene_id]) for gene_id in unique_ids], dtype=np.float64)

if "filter_pass" in adata.obs.columns:
    filter_values = np.asarray(adata.obs["filter_pass"])
    def filter_passes(value):
        try:
            return float(value) == 1.0
        except (TypeError, ValueError):
            return str(value).strip().lower() == "true"
    selected_cells = np.flatnonzero(np.asarray([filter_passes(value) for value in filter_values]))
    summary_warnings.append("Applied AnnData obs filter_pass and embedded only passing cells.")
else:
    selected_cells = np.arange(input_cell_count)

if selected_cells.size == 0:
    raise SystemExit("No cells remain after applying AnnData filter_pass.")

if "n_counts" in adata.obs.columns:
    total_counts = np.asarray(adata.obs["n_counts"], dtype=np.float64)[selected_cells]
    count_source = 'obs["n_counts"]'
else:
    total_counts = np.asarray(matrix[selected_cells].sum(axis=1)).reshape(-1).astype(np.float64)
    count_source = "computed from .X"
    summary_warnings.append('No obs["n_counts"] column was found; Liatir computed total counts from .X.')

expression = expression[selected_cells].tocsr()
tokenized_cells = []
kept_positions = []
for local_index in range(expression.shape[0]):
    row = expression.getrow(local_index)
    total = float(total_counts[local_index])
    if not np.isfinite(total) or total <= 0 or row.nnz == 0:
        continue
    scaled = (row.data.astype(np.float64) / total * 10_000.0) / median_vector[row.indices]
    order = np.argsort(-scaled, kind="stable")
    tokens = gene_tokens[row.indices][order][:2048]
    if tokens.size == 0:
        continue
    tokenized_cells.append(tokens)
    kept_positions.append(int(selected_cells[local_index]))

excluded_cells = int(selected_cells.size - len(kept_positions))
if excluded_cells:
    summary_warnings.append(
        f"Excluded {excluded_cells} cells with zero counts or no genes in the Geneformer V1 dictionary."
    )
if not tokenized_cells:
    raise SystemExit("Geneformer found no cells with usable human Ensembl gene counts.")

if torch.cuda.is_available():
    device = torch.device("cuda")
    accelerator = "CUDA"
elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
    device = torch.device("mps")
    accelerator = "Apple Metal"
else:
    device = torch.device("cpu")
    accelerator = "CPU"

model = AutoModelForMaskedLM.from_pretrained(
    str(model_dir),
    local_files_only=True,
    output_hidden_states=True,
)
model.eval()
model.to(device)

embedding_batches = []
with torch.no_grad():
    for start in range(0, len(tokenized_cells), batch_size):
        sequences = tokenized_cells[start : start + batch_size]
        max_length = max(len(sequence) for sequence in sequences)
        input_ids = torch.zeros((len(sequences), max_length), dtype=torch.long)
        attention_mask = torch.zeros((len(sequences), max_length), dtype=torch.long)
        for row_index, sequence in enumerate(sequences):
            length = len(sequence)
            input_ids[row_index, :length] = torch.as_tensor(sequence, dtype=torch.long)
            attention_mask[row_index, :length] = 1
        input_ids = input_ids.to(device)
        attention_mask = attention_mask.to(device)
        outputs = model(input_ids=input_ids, attention_mask=attention_mask, output_hidden_states=True)
        hidden = outputs.hidden_states[-2]
        mask = attention_mask.unsqueeze(-1).to(hidden.dtype)
        pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1)
        embedding_batches.append(pooled.detach().cpu().numpy().astype(np.float32))

embeddings = np.concatenate(embedding_batches, axis=0)
result_adata = adata[kept_positions].copy()
result_adata.obsm["X_geneformer"] = embeddings
result_adata.uns["liatir_geneformer"] = {
    "model": "Geneformer V1 10M",
    "upstream_revision": "04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5",
    "gene_id_source": gene_id_source,
    "count_source": count_source,
    "normalization": "total-count 10000, Geneformer Genecorpus-30M median scaling, rank encoding",
    "embedding_layer": "second-to-last hidden layer, mean pooled",
}

output_dir.mkdir(parents=True, exist_ok=True)
embedded_path = output_dir / f"{input_file.stem}_geneformer_adata.h5ad"
result_adata.write_h5ad(str(embedded_path))

preview_rows = min(max_csv_rows, embeddings.shape[0])
preview_path = output_dir / "geneformer-embedding-preview.csv"
with preview_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["cell_id"] + [f"dim_{index}" for index in range(embeddings.shape[1])])
    for index in range(preview_rows):
        writer.writerow([str(result_adata.obs_names[index])] + [float(value) for value in embeddings[index]])

summary = {
    "cellCount": int(embeddings.shape[0]),
    "geneCount": int(unique_ids.size),
    "matchedGeneCount": int(unique_ids.size),
    "inputCellCount": input_cell_count,
    "inputGeneCount": input_gene_count,
    "embeddingDim": int(embeddings.shape[1]),
    "embeddingKey": "X_geneformer",
    "embeddingLayer": "second-to-last hidden layer, mean pooled",
    "normalization": "Genecorpus-30M median-scaled rank encoding",
    "model": "Geneformer V1 10M",
    "species": "human",
    "batchSize": batch_size,
    "previewRows": preview_rows,
    "intermediateCount": 0,
    "accelerator": accelerator,
    "warnings": summary_warnings,
}
summary_path = output_dir / "geneformer-embedding-summary.json"
with summary_path.open("w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "embeddedAnnDataPath": str(embedded_path),
    "embeddingPreviewPath": str(preview_path),
    "summaryPath": str(summary_path),
    "intermediatePaths": [],
    "summary": summary,
    "preview": embeddings[: min(3, embeddings.shape[0]), : min(8, embeddings.shape[1])].tolist(),
}))
`;
