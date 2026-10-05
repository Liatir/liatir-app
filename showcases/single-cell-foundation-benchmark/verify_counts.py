"""Compare every prepared count with the canonical source, in bounded row blocks."""
import argparse
import os
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).parent / "src"))
from common import read_json, sha256, write_json
from resource_guard import ResourceGuard


def verify(root, cache, output, dataset=None):
    record_directory = root if (root / "liatir-run.json").is_file() else root / "datasets" / str(dataset)
    recorded = read_json(record_directory / "liatir-run.json")
    if dataset is not None and recorded["dataset"] != dataset:
        raise ValueError("The selected dataset does not match the recorded native run.")
    dataset = recorded["dataset"]
    if recorded.get("stability_check"):
        raise ValueError("This source-preservation check requires the full dataset.")
    with ResourceGuard(output.with_suffix(".monitor"), recorded["resource_limits"]):
        import anndata as ad
        import h5py
        import numpy as np
        from scipy import sparse
        manifest = read_json(root / "datasets" / dataset / "manifest.json")
        prepared_path = root / "datasets" / dataset / "counts.h5ad"
        if sha256(prepared_path) != manifest["prepared_sha256"]:
            raise ValueError("Prepared input checksum changed.")
        for source in manifest["source_files"]:
            if sha256(cache / source["file"]) != source["sha256"]:
                raise ValueError(f"Canonical source changed: {source['file']}")
        prepared = ad.read_h5ad(prepared_path, backed="r")
        positions = np.array([int(name.split(":", 2)[1]) for name in prepared.obs_names])
        source_file = None
        if dataset == "pbmc":
            import scvi
            original = scvi.data.pbmc_dataset(save_path=str(cache / dataset), remove_extracted_data=False)
            counts, obs = original.X, original.obs
            genes = original.var_names.astype(str).tolist()
            if prepared.var.ensembl_id.astype(str).tolist() != genes:
                raise ValueError("Prepared PBMC gene order differs from its source.")
            symbol_field = next(name for name in ("gene_symbols", "gene_symbols-0", "gene_symbols-1") if name in original.var)
            if prepared.var_names.astype(str).tolist() != original.var[symbol_field].astype(str).tolist():
                raise ValueError("Prepared PBMC gene symbols differ from their source annotations.")
        elif dataset == "pancreas":
            source_file = h5py.File(cache / dataset / "scib-pancreas-24539828.h5ad", "r")
            counts = source_file["layers/counts"]
            obs = ad.io.read_elem(source_file["obs"])
            genes = ad.io.read_elem(source_file["var"]).index.astype(str).tolist()
            if prepared.var_names.astype(str).tolist() != genes:
                raise ValueError("Prepared pancreas gene order differs from its source.")
            mapping_source = read_json(root / "datasets" / dataset / "gene_mapping_source.json")
            if sha256(cache / mapping_source["file"]) != mapping_source["sha256"]:
                raise ValueError("The recorded gene-mapping reference changed.")
        else:
            raise ValueError("Unknown dataset.")
        try:
            if list(counts.shape) != manifest["upstream_shape"]:
                raise ValueError("Source shape differs from the manifest.")
            totals = np.empty(counts.shape[0], dtype=np.float64)
            fractional = 0
            for start in range(0, counts.shape[0], 128):
                block = counts[start:start + 128]
                if sparse.issparse(block):
                    block = block.toarray()
                totals[start:start + len(block)] = block.sum(axis=1)
                fractional += int(np.count_nonzero(np.abs(block - np.rint(block)) > 1e-4))
                selected = np.flatnonzero((positions >= start) & (positions < start + len(block)))
                if not len(selected):
                    continue
                actual = prepared.X[selected]
                if sparse.issparse(actual):
                    actual = actual.toarray()
                if not np.array_equal(actual, block[positions[selected] - start]):
                    raise ValueError(f"Prepared counts changed in source rows {start}:{start + len(block)}")
            keep = (totals > 0) & obs[manifest["label_field"]].notna().to_numpy() & obs[manifest["batch_field"]].notna().to_numpy()
            if not np.array_equal(positions, np.flatnonzero(keep)):
                raise ValueError("Prepared cells differ from the recorded shared filter.")
            if fractional != manifest["fractional_count_entries"]:
                raise ValueError("Source count-integrality measurement changed.")
            if prepared.obs.source_cell_id.astype(str).tolist() != obs.index[positions].astype(str).tolist():
                raise ValueError("Prepared source cell identities changed.")
            write_json(output, {"status": "passed", "run_id": recorded["run_id"], "dataset": dataset,
                "cells": prepared.n_obs, "genes": prepared.n_vars, "all_count_values_exactly_equal": True,
                "gene_order_preserved": True, "cell_filter_preserved": True,
                "source_checksums_verified": True, "fractional_count_entries": fractional,
                "prepared_sha256": manifest["prepared_sha256"]})
            print(f"Verified every count for {dataset}: {prepared.n_obs} cells × {prepared.n_vars} genes", flush=True)
        finally:
            prepared.file.close()
            if source_file is not None:
                source_file.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("run", type=Path)
    parser.add_argument("--cache", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--dataset", choices=("pbmc", "pancreas"),
                        help="Required when checking the assembled two-dataset export.")
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Choose a new verification output.")
    for variable in ("OMP_NUM_THREADS", "OPENBLAS_NUM_THREADS", "MKL_NUM_THREADS", "NUMBA_NUM_THREADS"):
        os.environ[variable] = "1"
    os.environ["JAX_PLATFORMS"] = "cpu"
    verify(args.run.resolve(), args.cache.resolve(), args.output.resolve(), args.dataset)
