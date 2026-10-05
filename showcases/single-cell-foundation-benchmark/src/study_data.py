"""Canonical public data, with one count matrix and one split per dataset."""
import gzip
from pathlib import Path
import re
import urllib.request

from common import SEED, read_json, sha256, write_json

PANCREAS_URL = "https://api.figshare.com/v2/file/download/24539828"
PANCREAS_SHA256 = "97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c"
GENCODE_URL = "https://ftp.ebi.ac.uk/pub/databases/gencode/Gencode_human/release_47/gencode.v47.basic.annotation.gtf.gz"


def download(url, path, headers=None):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if not path.exists():
        print(f"Downloading {url}", flush=True)
        temporary = path.with_suffix(path.suffix + ".partial")
        request = urllib.request.Request(url, headers=headers) if headers else url
        with urllib.request.urlopen(request, timeout=120) as source, temporary.open("wb") as dest:
            while block := source.read(8 * 1024 * 1024):
                dest.write(block)
        temporary.rename(path)
    return {"url": url, "file": path.name, "sha256": sha256(path), "bytes": path.stat().st_size}


def prepare(root, dataset, cache, stability_check=False):
    import anndata as ad
    import numpy as np
    import pandas as pd
    from scipy import sparse
    from sklearn.model_selection import train_test_split

    directory = root / "datasets" / dataset
    directory.mkdir(parents=True, exist_ok=True)
    prepared = directory / "counts.h5ad"
    if prepared.exists():
        manifest = read_json(directory / "manifest.json")
        if sha256(prepared) != manifest["prepared_sha256"]:
            raise ValueError("Prepared count matrix checksum changed.")
        return manifest
    source_dir = cache / dataset
    source_dir.mkdir(parents=True, exist_ok=True)
    if dataset == "pbmc":
        import scvi
        data = scvi.data.pbmc_dataset(save_path=str(source_dir), remove_extracted_data=False)
        source = "scvi.data.pbmc_dataset, scvi-tools 1.3.3; original 10x Cell Ranger 2.1.0 PBMC8k + PBMC4k"
        urls = ["https://github.com/YosefLab/scVI-data/raw/master/gene_info.csv",
                "https://github.com/YosefLab/scVI-data/raw/master/pbmc_metadata.pickle",
                "https://cf.10xgenomics.com/samples/cell-exp/2.1.0/pbmc8k/pbmc8k_filtered_gene_bc_matrices.tar.gz",
                "https://cf.10xgenomics.com/samples/cell-exp/2.1.0/pbmc4k/pbmc4k_filtered_gene_bc_matrices.tar.gz"]
        label, batch, count_layer = "str_labels", "batch", "X"
        data.var["ensembl_id"] = data.var_names.astype(str)
        symbol_column = next((key for key in ("gene_symbols", "gene_symbols-0", "gene_symbols-1") if key in data.var), None)
        if symbol_column is None:
            raise ValueError(f"PBMC loader omitted gene symbols: {list(data.var.columns)}")
        symbols = data.var[symbol_column].astype(str).to_numpy()
        symbol_source = f"10x original var[{symbol_column!r}]"
    elif dataset == "pancreas":
        source_file = download(PANCREAS_URL, source_dir / "scib-pancreas-24539828.h5ad")
        if source_file["sha256"] != PANCREAS_SHA256:
            raise ValueError("Canonical pancreas checksum changed; review the upstream source before running.")
        # Read only the supplied count layer, in bounded blocks. The source also
        # stores a dense normalized copy; loading both exceeds this host's budget.
        import h5py
        with h5py.File(source_dir / "scib-pancreas-24539828.h5ad", "r") as file:
            if "counts" not in file["layers"]:
                raise ValueError("Canonical pancreas has no supplied count layer.")
            layer = file["layers/counts"]
            chunks = [sparse.csr_matrix(layer[start:start + 128]) for start in range(0, layer.shape[0], 128)]
            counts = sparse.vstack(chunks, format="csr")
            del chunks
            data = ad.AnnData(X=counts, obs=ad.io.read_elem(file["obs"]), var=ad.io.read_elem(file["var"]))
        source = "scIB pancreas, canonical scvi-tools reference-mapping tutorial distribution, Figshare file 24539828"
        urls = [PANCREAS_URL]
        label, batch, count_layer = "celltype", "tech", "counts"
        symbols = data.var_names.astype(str).to_numpy()
        symbol_source = "original var_names"
        mapping_source = download(GENCODE_URL, cache / "gencode.v47.basic.annotation.gtf.gz")
        mapping = {}
        with gzip.open(cache / mapping_source["file"], "rt") as handle:
            for line in handle:
                if line.startswith("#"):
                    continue
                columns = line.rstrip().split("\t")
                if columns[2] != "gene":
                    continue
                attrs = dict(re.findall(r'(\w+) "([^"]+)"', columns[8]))
                mapping.setdefault(attrs["gene_name"], set()).add(attrs["gene_id"].split(".")[0])
        data.var["ensembl_id"] = [next(iter(mapping[x])) if x in mapping and len(mapping[x]) == 1 else "" for x in symbols]
        write_json(directory / "gene_mapping_source.json", {**mapping_source, "release": "GENCODE human v47 GRCh38 basic", "policy": "Exact case-sensitive symbol; only unique Ensembl mappings; no guessing."})
    else:
        raise ValueError(f"Unknown dataset: {dataset}")

    original_shape = list(data.shape)
    counts = sparse.csr_matrix(data.X)
    if not np.isfinite(counts.data).all() or (counts.data < 0).any():
        raise ValueError("Raw counts are non-finite or negative.")
    fractional = sum(int(np.count_nonzero(np.abs(block - np.rint(block)) > 1e-4))
                     for start in range(0, len(counts.data), 1_000_000)
                     for block in [counts.data[start:start + 1_000_000]])
    # The canonical pancreas count layer includes fractional quantification values.
    # Preserve the supplied layer exactly: rounding would invent different measurements.
    totals = np.asarray(counts.sum(axis=1)).ravel()
    keep = (totals > 0) & data.obs[label].notna().to_numpy() & data.obs[batch].notna().to_numpy()
    # Stable identities preserve the original barcode and its row, including repeated 10x barcodes.
    original_ids = data.obs_names.astype(str).to_numpy()
    data.obs["source_cell_id"] = original_ids
    data.obs_names = [f"{dataset}:{i}:{value}" for i, value in enumerate(original_ids)]
    excluded = [{"cell_id": str(data.obs_names[i]), "reason": "zero count total or absent label/batch"}
                for i in np.flatnonzero(~keep)]
    obs = data.obs.iloc[np.flatnonzero(keep)].copy()
    obs["cell_type"] = obs[label].astype(str).to_numpy()
    obs["batch"] = obs[batch].astype(str).to_numpy()
    obs["n_counts"] = totals[keep]
    var = pd.DataFrame(index=data.var_names.copy())
    var["ensembl_id"] = data.var["ensembl_id"].astype(str).to_numpy()
    var["gene_name"] = symbols
    var["gene_symbol"] = symbols
    if not keep.all():
        counts = counts[keep]
    # No gene filtering here. Only representation-specific vocabulary selection follows.
    canonical = ad.AnnData(X=counts, obs=obs, var=var)
    canonical.var_names = symbols
    if stability_check:
        selected = canonical.obs.groupby("cell_type", observed=True, sort=True).head(8).index
        canonical = canonical[selected].copy()
    if canonical.obs["cell_type"].value_counts().min() < 2:
        raise ValueError("A label has fewer than two cells; cannot make the fixed stratified split.")
    train, test = train_test_split(np.arange(canonical.n_obs), test_size=0.2,
                                  stratify=canonical.obs["cell_type"], random_state=SEED)
    canonical.obs["split"] = "train"
    canonical.obs.iloc[test, canonical.obs.columns.get_loc("split")] = "test"
    canonical.write_h5ad(prepared, compression="gzip")
    split_path = directory / "split.csv"
    canonical.obs[["source_cell_id", "cell_type", "batch", "split"]].to_csv(split_path, index_label="cell_id")
    var.to_csv(directory / "genes.csv", index_label="source_gene_id")
    source_paths = [source_dir / "scib-pancreas-24539828.h5ad"] if dataset == "pancreas" else sorted(source_dir.rglob("*"))
    sources = [{"file": str(p.relative_to(cache)), "sha256": sha256(p), "bytes": p.stat().st_size}
               for p in source_paths if p.is_file() and p.suffix in (".gz", ".csv", ".pickle", ".h5ad")]
    manifest = {
        "dataset": dataset, "source": source, "urls": urls,
        "stability_check_only": stability_check,
        "upstream_shape": original_shape, "cell_count": canonical.n_obs, "gene_count": canonical.n_vars,
        "label_field": label, "batch_field": batch, "raw_count_source": count_layer,
        "cell_types": canonical.obs["cell_type"].value_counts().to_dict(),
        "batches": canonical.obs["batch"].value_counts().to_dict(),
        "source_files": sources, "gene_identifiers": "gene symbols plus Ensembl gene IDs",
        "gene_symbol_source": symbol_source, "ensembl_mapped_genes": int((var.ensembl_id != "").sum()),
        "filtering": {"minimum_total_count_exclusive": 0, "require_label_and_batch": True, "gene_filter": None},
        "excluded_cells": excluded, "fractional_count_entries": fractional,
        "count_integrality": "integer-valued" if not fractional else "Source-supplied nonnegative count layer contains fractional values; retained without rounding or reconstruction.",
        "seed": SEED, "test_fraction": 0.2, "split_sha256": sha256(split_path),
        "prepared_sha256": sha256(prepared), "prepared_path": str(prepared),
        "prepared_bytes": prepared.stat().st_size,
        "source_count_provenance": {
            "kind": "canonical-source-count-layer", "source_layer": "counts",
            "source_sha256": PANCREAS_SHA256, "prepared_sha256": sha256(prepared),
        } if dataset == "pancreas" and fractional else None,
    }
    write_json(directory / "manifest.json", manifest)
    manifests = [read_json(p) for p in sorted((root / "datasets").glob("*/manifest.json"))]
    write_json(root / "datasets" / "manifest.json", manifests)
    return manifest
