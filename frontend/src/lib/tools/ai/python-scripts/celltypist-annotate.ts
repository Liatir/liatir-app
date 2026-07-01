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
