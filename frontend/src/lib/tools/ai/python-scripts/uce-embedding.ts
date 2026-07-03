export const UCE_EMBEDDING_SCRIPT = String.raw`
import csv
import json
import os
from pathlib import Path
import runpy
import sys
import warnings

payload = json.loads(sys.stdin.read() or "{}")

runtime_path = payload.get("runtimePath")
cache_dir = payload.get("modelCacheDir")
if runtime_path:
    os.environ.setdefault("HOME", runtime_path)
    os.environ.setdefault("XDG_CACHE_HOME", os.path.join(runtime_path, "model-cache"))

warnings.filterwarnings("ignore", message="pkg_resources is deprecated.*")

if not runtime_path:
    raise SystemExit("UCE runtime path is missing.")
if not cache_dir:
    raise SystemExit("UCE model cache directory is missing.")

input_file = Path(payload["inputFile"]).resolve()
output_dir = Path(payload["outputDir"]).resolve()
species = payload.get("species") or "human"
batch_size = max(1, min(int(payload.get("batchSize") or 25), 256))
max_csv_rows = max(1, min(int(payload.get("maxCsvRows") or 500), 5000))

supported_species = {
    "human",
    "mouse",
    "frog",
    "zebrafish",
    "mouse_lemur",
    "pig",
    "macaca_fascicularis",
    "macaca_mulatta",
}
if species not in supported_species:
    raise SystemExit(f"Unsupported UCE species: {species}")
if not input_file.is_file():
    raise SystemExit(f"AnnData file not found: {input_file.name}")

output_dir.mkdir(parents=True, exist_ok=True)

runtime_root = Path(runtime_path).resolve()
source_dir = Path(payload.get("sourceDir") or runtime_root / "source" / "UCE").resolve()
script_path = source_dir / "eval_single_anndata.py"
if not script_path.is_file():
    raise SystemExit("UCE source checkout is missing eval_single_anndata.py. Reinstall the AI Model.")

model_files = Path(cache_dir).resolve() / "model_files"
required_paths = {
    "model weights": model_files / "4layer_model.torch",
    "token file": model_files / "all_tokens.torch",
    "species chromosome CSV": model_files / "species_chrom.csv",
    "species offsets": model_files / "species_offsets.pkl",
    "protein embeddings": model_files / "protein_embeddings",
}
missing = [label for label, path in required_paths.items() if not path.exists()]
if missing:
    raise SystemExit("UCE installation is incomplete. Missing: " + ", ".join(missing))

summary_warnings = [
    "UCE expects .X to contain scRNA-seq counts and var_names to contain gene symbols, not Ensembl IDs.",
]

input_cell_count = None
input_gene_count = None
ensembl_like_gene_names = 0
try:
    import anndata

    input_adata = anndata.read_h5ad(str(input_file), backed="r")
    input_cell_count = int(input_adata.n_obs)
    input_gene_count = int(input_adata.n_vars)
    gene_sample = [str(name) for name in input_adata.var_names[: min(100, input_adata.n_vars)]]
    ensembl_like_gene_names = sum(1 for name in gene_sample if name.upper().startswith("ENS"))
    if gene_sample and ensembl_like_gene_names / len(gene_sample) > 0.5:
        summary_warnings.append("Most sampled var_names look like Ensembl IDs; UCE expects gene symbols.")
    try:
        input_adata.file.close()
    except Exception:
        pass
except Exception as exc:
    print(f"Could not inspect AnnData metadata before UCE run: {exc}", file=sys.stderr)

output_dir_arg = str(output_dir)
if not output_dir_arg.endswith(os.sep):
    output_dir_arg += os.sep

argv = [
    str(script_path),
    "--adata_path",
    str(input_file),
    "--dir",
    output_dir_arg,
    "--species",
    species,
    "--model_loc",
    str(model_files / "4layer_model.torch"),
    "--batch_size",
    str(batch_size),
    "--nlayers",
    "4",
    "--output_dim",
    "1280",
    "--d_hid",
    "5120",
    "--token_dim",
    "5120",
    "--spec_chrom_csv_path",
    str(model_files / "species_chrom.csv"),
    "--token_file",
    str(model_files / "all_tokens.torch"),
    "--protein_embeddings_dir",
    str(model_files / "protein_embeddings"),
    "--offset_pkl_path",
    str(model_files / "species_offsets.pkl"),
]

previous_argv = sys.argv[:]
previous_cwd = os.getcwd()
sys.path.insert(0, str(source_dir))
sys.argv = argv
try:
    os.chdir(source_dir)
    runpy.run_path(str(script_path), run_name="__main__")
finally:
    os.chdir(previous_cwd)
    sys.argv = previous_argv
    try:
        sys.path.remove(str(source_dir))
    except ValueError:
        pass

dataset_name = input_file.name.replace(".h5ad", "")
embedded_path = output_dir / f"{dataset_name}_uce_adata.h5ad"
if not embedded_path.is_file():
    matches = sorted(output_dir.glob("*_uce_adata.h5ad"))
    if len(matches) == 1:
        embedded_path = matches[0]
    else:
        raise SystemExit("UCE completed but no embedded AnnData file was found in the output directory.")

import anndata
import numpy as np

embedded = anndata.read_h5ad(str(embedded_path))
if "X_uce" not in embedded.obsm:
    raise SystemExit('UCE output is missing obsm["X_uce"].')

embeddings = np.asarray(embedded.obsm["X_uce"])
if embeddings.ndim != 2:
    raise SystemExit('UCE output obsm["X_uce"] is not a 2D matrix.')

preview_rows = min(max_csv_rows, embeddings.shape[0])
preview_path = output_dir / "uce-embedding-preview.csv"
with preview_path.open("w", newline="", encoding="utf-8") as fh:
    writer = csv.writer(fh)
    writer.writerow(["cell_id"] + [f"dim_{i}" for i in range(embeddings.shape[1])])
    for idx in range(preview_rows):
        writer.writerow([str(embedded.obs_names[idx])] + [float(value) for value in embeddings[idx]])

intermediate_names = [
    f"{dataset_name}_proc.h5ad",
    f"{dataset_name}_chroms.pkl",
    f"{dataset_name}_counts.npz",
    f"{dataset_name}_pe_idx.torch",
    f"{dataset_name}_shapes_dict.pkl",
    f"{dataset_name}_starts.pkl",
]
intermediate_paths = [
    str(output_dir / name) for name in intermediate_names if (output_dir / name).is_file()
]

summary = {
    "cellCount": int(embeddings.shape[0]),
    "geneCount": int(embedded.n_vars),
    "inputCellCount": input_cell_count,
    "inputGeneCount": input_gene_count,
    "embeddingDim": int(embeddings.shape[1]),
    "embeddingKey": "X_uce",
    "model": "UCE 4-layer",
    "species": species,
    "batchSize": batch_size,
    "previewRows": preview_rows,
    "intermediateCount": len(intermediate_paths),
    "warnings": summary_warnings,
}
summary_path = output_dir / "uce-embedding-summary.json"
with summary_path.open("w", encoding="utf-8") as fh:
    json.dump(summary, fh, indent=2)

print(json.dumps({
    "embeddedAnnDataPath": str(embedded_path),
    "embeddingPreviewPath": str(preview_path),
    "summaryPath": str(summary_path),
    "intermediatePaths": intermediate_paths,
    "summary": summary,
    "preview": embeddings[: min(3, embeddings.shape[0]), : min(8, embeddings.shape[1])].tolist(),
}))
`;
