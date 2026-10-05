
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


import hashlib
import importlib.metadata
import platform
import sqlite3
import time
import uuid

scgpt_attempt_started = time.monotonic()

def scgpt_file_hash(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()

def scgpt_checkpoint_identity(payload, paths, source_package, accelerator):
    runner_hash = payload.get("runnerSha256")
    if not runner_hash:
        runner_path = globals().get("__file__")
        if not runner_path:
            raise ValueError("Cannot establish the scGPT runner identity for durable saving.")
        runner_hash = scgpt_file_hash(runner_path)
    return {
        "format_version": 1,
        "input_sha256": scgpt_file_hash(input_file),
        "runner_sha256": runner_hash,
        "model_files": {name: scgpt_file_hash(path) for name, path in paths.items()},
        "activation_sha256": scgpt_file_hash(runtime_path / "runtime-box-activation.json") if (runtime_path / "runtime-box-activation.json").exists() else None,
        "box_sha256": scgpt_file_hash(runtime_path / "box.json") if (runtime_path / "box.json").exists() else None,
        "runtime_identity_scope": "Activated box" if (runtime_path / "runtime-box-activation.json").exists() else "Pre-activation validator: exact model and source file hashes",
        "source_files": {str(path.relative_to(source_package)): scgpt_file_hash(path)
                         for path in sorted(source_package.rglob("*.py"))},
        "seed": int(payload.get("randomSeed", 23)), "batch_size": batch_size,
        "species": species, "accelerator": accelerator,
        "source_count_provenance": payload.get("sourceCountProvenance", {}),
        "python": sys.version, "platform": platform.platform(), "host": platform.node(),
        "packages": {name: importlib.metadata.version(name) for name in ("numpy", "torch", "anndata", "scipy")},
        "threads": {name: os.environ.get(name) for name in
                    ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS")},
    }

class ScGPTCheckpoint:
    def __init__(self, directory, identity, started=None):
        self.directory = Path(directory)
        self.directory.mkdir(parents=True, exist_ok=True)
        self.started = time.monotonic() if started is None else started
        self.identity_json = json.dumps(identity, sort_keys=True, separators=(",", ":"), allow_nan=False)
        self.connection = sqlite3.connect(self.directory / "scgpt-checkpoint.sqlite3", timeout=0)
        self.connection.execute("PRAGMA journal_mode=DELETE")
        self.connection.execute("PRAGMA synchronous=FULL")
        self.connection.execute("CREATE TABLE IF NOT EXISTS identity (value TEXT NOT NULL)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS batches (start INTEGER PRIMARY KEY, stop INTEGER NOT NULL, dimensions INTEGER NOT NULL, data BLOB NOT NULL, sha256 TEXT NOT NULL)")
        self.connection.execute("CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, started_at REAL NOT NULL, updated_at REAL NOT NULL, elapsed REAL NOT NULL, peak_rss INTEGER, status TEXT NOT NULL)")
        self.connection.commit()
        # Hold a writer lock throughout inference. A second process cannot own the same checkpoint.
        self.connection.execute("BEGIN IMMEDIATE")
        rows = self.connection.execute("SELECT value FROM identity").fetchall()
        if rows and (len(rows) != 1 or rows[0][0] != self.identity_json):
            self.connection.close()
            raise ValueError("scGPT checkpoint input, model, runner, seed, environment or host identity changed.")
        if not rows:
            self.connection.execute("INSERT INTO identity VALUES (?)", (self.identity_json,))
        self.connection.execute("UPDATE attempts SET status='interrupted' WHERE status='running'")
        self.attempt = str(uuid.uuid4())
        self.connection.execute("INSERT INTO attempts VALUES (?,?,?,?,?,?)",
                                (self.attempt, time.time(), time.time(), time.monotonic()-self.started, self.peak_rss(), "running"))
        self.commit()

    @staticmethod
    def peak_rss():
        try:
            import resource
            peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            return int(peak if sys.platform == "darwin" else peak * 1024)
        except ImportError:
            return None

    def commit(self):
        self.connection.commit()
        self.connection.execute("BEGIN IMMEDIATE")

    def load(self, cell_ids, dimensions):
        import numpy as np
        actual = {"cell_ids_sha256": hashlib.sha256(json.dumps(list(cell_ids), separators=(",", ":")).encode()).hexdigest(),
                  "cells": len(cell_ids), "dimensions": dimensions}
        expected = json.loads(self.identity_json)["embedding"]
        if actual != expected:
            raise ValueError("scGPT checkpoint cell order or embedding shape changed.")
        values = np.empty((len(cell_ids), dimensions), dtype=np.float32)
        completed = 0
        for start, stop, width, data, checksum in self.connection.execute("SELECT * FROM batches ORDER BY start"):
            if start != completed or not start < stop <= len(cell_ids) or width != dimensions:
                raise ValueError("Noncontiguous scGPT checkpoint batches.")
            if len(data) != (stop-start)*dimensions*4 or hashlib.sha256(data).hexdigest() != checksum:
                raise ValueError("scGPT checkpoint batch checksum or size changed.")
            batch = np.frombuffer(data, dtype="<f4").reshape(stop-start, dimensions)
            if not np.isfinite(batch).all():
                raise ValueError("Nonfinite scGPT checkpoint values.")
            values[start:stop] = batch
            completed = stop
        self.completed = completed
        self.dimensions = dimensions
        self.cells = len(cell_ids)
        return values, completed

    def save(self, start, values):
        import numpy as np
        values = np.asarray(values, dtype="<f4")
        stop = start + len(values)
        if start != self.completed or values.ndim != 2 or values.shape[1] != self.dimensions or not start < stop <= self.cells or not np.isfinite(values).all():
            raise ValueError("Invalid scGPT checkpoint batch.")
        data = values.tobytes()
        self.connection.execute("INSERT INTO batches VALUES (?,?,?,?,?)",
                                (start, stop, self.dimensions, data, hashlib.sha256(data).hexdigest()))
        self.update_attempt("running")
        self.commit()
        self.completed = stop

    def update_attempt(self, status):
        self.connection.execute("UPDATE attempts SET updated_at=?, elapsed=?, peak_rss=?, status=? WHERE id=?",
                                (time.time(), time.monotonic()-self.started, self.peak_rss(), status, self.attempt))

    def finish(self):
        if self.completed != self.cells:
            raise ValueError("Cannot finalize an incomplete scGPT checkpoint.")
        self.update_attempt("completed")
        self.connection.commit()
        rows = [dict(zip(("id", "started_at", "updated_at", "elapsed_seconds", "peak_rss_bytes", "status"), row))
                for row in self.connection.execute("SELECT * FROM attempts ORDER BY started_at")]
        result = {"attempts": rows, "wall_seconds_lower_bound": sum(row["elapsed_seconds"] for row in rows),
                  "peak_rss_bytes": max((row["peak_rss_bytes"] for row in rows if row["peak_rss_bytes"] is not None), default=None),
                  "unmeasured_time_reason": "Interrupted attempts record elapsed time through their last committed batch; any unsaved tail is unknown.",
                  "identity": json.loads(self.identity_json)}
        temporary = self.directory / "scgpt-checkpoint-accounting.json.tmp"
        with temporary.open("w", encoding="utf-8") as stream:
            json.dump(result, stream, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(self.directory / "scgpt-checkpoint-accounting.json")
        self.connection.close()
        return result


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
gene_tokenizer = importlib.import_module("scgpt.tokenizer.gene_tokenizer")
GeneVocab = gene_tokenizer.GeneVocab

with required_paths["model configuration"].open("r", encoding="utf-8") as source:
    model_config = json.load(source)
# The pinned JSON loader rebuilds its index after every insertion. Construct the
# same public vocabulary in order once, then verify every original token ID.
with required_paths["gene vocabulary"].open("r", encoding="utf-8") as source:
    recorded_vocabulary = json.load(source)
ordered_vocabulary = sorted(recorded_vocabulary.items(), key=lambda item: item[1])
if any(type(index) is not int or index != position for position, (_, index) in enumerate(ordered_vocabulary)):
    raise SystemExit("scGPT vocabulary requires consecutive integer token IDs.")
vocab = GeneVocab(gene_tokenizer.BuiltinVocab([token for token, _ in ordered_vocabulary]))
if vocab.get_stoi() != recorded_vocabulary:
    raise SystemExit("scGPT vocabulary token identity changed during loading.")
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

def validate_source_counts(matrix, input_file, payload, summary_warnings, model_name):
    sample = matrix.data[: min(matrix.data.size, 100_000)]
    if not sample.size or np.mean(np.abs(sample - np.rint(sample)) > 1e-4) <= 0.01:
        return
    provenance = payload.get("sourceCountProvenance")
    # Only the independently identified canonical pancreas count layer is accepted.
    # A generic user file still follows the existing strict count-input guard.
    canonical_sha = "97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c"
    if not isinstance(provenance, dict) or provenance.get("kind") != "canonical-source-count-layer" \
            or provenance.get("source_layer") != "counts" or provenance.get("source_sha256") != canonical_sha:
        raise SystemExit(f"{model_name} requires raw counts, but AnnData .X appears normalized or log-transformed.")
    import hashlib
    digest = hashlib.sha256()
    with input_file.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    if provenance.get("prepared_sha256") != digest.hexdigest():
        raise SystemExit("The source-count provenance does not match the selected AnnData checksum.")
    summary_warnings.append(
        "Retained fractional values from the canonical pancreas source count layer without rounding. "
        "These are source-supplied quantification values; integer count assumptions are imperfect."
    )

validate_source_counts(matrix, input_file, payload, summary_warnings, "scGPT")

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

checkpoint_identity = scgpt_checkpoint_identity(payload, required_paths, source_package, accelerator)

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
# Loaded parameters own their values; retaining the checkpoint duplicates weights.
del checkpoint, compatible, model_state
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
def sequence_for_cell(cell_index):
    row = expression.getrow(cell_index)
    random_state = np.random.default_rng(cell_index)
    values = bin_values(row.data.astype(np.float64), random_state)
    genes = gene_ids[row.indices]
    if genes.size + 1 > max_length:
        selected = random_state.permutation(genes.size)[: max_length - 1]
        genes = genes[selected]
        values = values[selected]
    return (
        np.concatenate(([cls_token_id], genes)),
        np.concatenate(([pad_value], values.astype(np.float32))),
    )

# Encode the same rows with the same cell-index seeds, retaining only one batch's
# token arrays. Full-dataset token lists would compete with checkpoint/output RAM.
kept_positions = np.flatnonzero(np.diff(expression.indptr) > 0).tolist()
if not kept_positions:
    raise SystemExit("scGPT found no cells with usable human gene counts.")

checkpoint_identity["embedding"] = {
    "cell_ids_sha256": hashlib.sha256(json.dumps([str(adata.obs_names[i]) for i in kept_positions], separators=(",", ":")).encode()).hexdigest(),
    "cells": len(kept_positions), "dimensions": int(model_config["embsize"]),
}
batch_checkpoint = ScGPTCheckpoint(output_dir, checkpoint_identity, scgpt_attempt_started)
checkpoint_embeddings, completed_cells = batch_checkpoint.load([str(adata.obs_names[i]) for i in kept_positions], int(model_config["embsize"]))
if completed_cells:
    print(f"scGPT: reused {completed_cells}/{len(kept_positions)} committed cells", file=sys.stderr, flush=True)
with torch.no_grad():
    for start in range(completed_cells, len(kept_positions), batch_size):
        batch = [sequence_for_cell(cell_index) for cell_index in kept_positions[start : start + batch_size]]
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
        batch_values = embeddings.detach().cpu().numpy().astype(np.float32)
        batch_checkpoint.save(start, batch_values)
        checkpoint_embeddings[start:start + len(batch_values)] = batch_values
        if (start + batch_size) % 128 == 0 or start + batch_size >= len(kept_positions):
            print(f"scGPT: {min(start + batch_size, len(kept_positions))}/{len(kept_positions)} cells", file=sys.stderr, flush=True)

embeddings = checkpoint_embeddings
del expression, model
result_adata = adata[kept_positions].copy()
result_adata.obsm["X_scGPT"] = embeddings
result_adata.uns["liatir_scgpt"] = {
    "model": "scGPT Whole-human",
    "upstream_revision": "cebd6fae655b9c585a4807daa3ac31bb764f06b4",
    "gene_name_source": gene_name_source,
    "source_count_provenance": payload.get("sourceCountProvenance", {}),
    "value_encoding": "per-cell 51-bin quantile encoding with deterministic tie handling",
    "embedding_layer": "CLS token from the final encoder layer, L2 normalized",
}

output_dir.mkdir(parents=True, exist_ok=True)
embedded_path = output_dir / f"{input_file.stem}_scgpt_adata.h5ad"
result_adata.write_h5ad(str(embedded_path))
preview_rows = min(max_csv_rows, embeddings.shape[0])
viewer_preview_rows = min(preview_rows, 1000)
viewer_embeddings = np.asarray(embeddings[:viewer_preview_rows], dtype=np.float64)
if viewer_embeddings.shape[0] > 0 and viewer_embeddings.shape[1] > 0:
    centered = viewer_embeddings - viewer_embeddings.mean(axis=0, keepdims=True)
    _, _, components = np.linalg.svd(centered, full_matrices=False)
    components = components[:2]
    max_abs_columns = np.argmax(np.abs(components), axis=1)
    signs = np.sign(components[np.arange(components.shape[0]), max_abs_columns])
    signs[signs == 0] = 1
    viewer_projection = centered @ (components * signs[:, None]).T
    viewer_projection = np.pad(viewer_projection, ((0, 0), (0, max(0, 2 - viewer_projection.shape[1]))))
else:
    viewer_projection = np.zeros((viewer_embeddings.shape[0], 2), dtype=np.float64)
preview_path = output_dir / "scgpt-embedding-preview.csv"
with preview_path.open("w", newline="", encoding="utf-8") as target:
    writer = csv.writer(target)
    writer.writerow(["cell_id", "preview_pc_1", "preview_pc_2"] + [f"dim_{index}" for index in range(embeddings.shape[1])])
    for index in range(preview_rows):
        projection = viewer_projection[index] if index < viewer_preview_rows else (None, None)
        writer.writerow([str(result_adata.obs_names[index]), projection[0], projection[1]] + [float(value) for value in embeddings[index]])

excluded_cells = input_cell_count - len(kept_positions)
if excluded_cells:
    summary_warnings.append(f"Excluded {excluded_cells} cells with no genes in the scGPT vocabulary.")
summary = {
    "cellCount": int(embeddings.shape[0]),
    "geneCount": int(supported_indices.size),
    "outputGeneCount": int(result_adata.n_vars),
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
    # GPU identity, so the scientific evidence can be checked against the host that produced it.
    "gpuModel": torch.cuda.get_device_name(device) if device.type == "cuda" else None,
    "gpuMemoryBytes": int(torch.cuda.get_device_properties(device).total_memory) if device.type == "cuda" else None,
    "computeCapability": (
        "%d.%d" % torch.cuda.get_device_capability(device) if device.type == "cuda" else None
    ),
    "reportedCudaCompatibility": torch.version.cuda if device.type == "cuda" else None,
    "warnings": summary_warnings,
}
summary_path = output_dir / "scgpt-embedding-summary.json"
with summary_path.open("w", encoding="utf-8") as target:
    json.dump(summary, target, indent=2)

batch_checkpoint.finish()

print(json.dumps({
    "embeddedAnnDataPath": str(embedded_path),
    "embeddingPreviewPath": str(preview_path),
    "summaryPath": str(summary_path),
    "intermediatePaths": [],
    "summary": summary,
    "previewCellIds": [str(value) for value in result_adata.obs_names[: min(3, embeddings.shape[0])]],
    "preview": embeddings[: min(3, embeddings.shape[0]), : min(8, embeddings.shape[1])].tolist(),
    "viewerPreviewCellIds": [str(value) for value in result_adata.obs_names[:viewer_preview_rows]],
    "viewerPreview": viewer_projection.tolist(),
    "viewerProjection": "bounded-preview-pca",
}))
