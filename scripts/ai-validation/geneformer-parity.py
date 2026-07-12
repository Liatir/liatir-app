#!/usr/bin/env python3
"""Compare Liatir Geneformer embeddings with the pinned upstream algorithm."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import pickle
import subprocess
import sys
import types

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch
from transformers import AutoModelForMaskedLM


PINNED_REVISION = "04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5"
TOKENIZER_SHA256 = "689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_upstream_tokenizer(tokenizer_path: Path, dictionaries_dir: Path):
    """Load the pinned tokenizer without installing Geneformer's optional stack."""
    geneformer = types.ModuleType("geneformer")
    geneformer.__path__ = [str(tokenizer_path.parent)]
    names = {
        "ENSEMBL_MAPPING_FILE": "ensembl_mapping_dict_gc30M.pkl",
        "GENE_MEDIAN_FILE": "gene_median_dictionary_gc30M.pkl",
        "TOKEN_DICTIONARY_FILE": "token_dictionary_gc30M.pkl",
        "ENSEMBL_MAPPING_FILE_30M": "ensembl_mapping_dict_gc30M.pkl",
        "GENE_MEDIAN_FILE_30M": "gene_median_dictionary_gc30M.pkl",
        "TOKEN_DICTIONARY_FILE_30M": "token_dictionary_gc30M.pkl",
    }
    for name, filename in names.items():
        setattr(geneformer, name, dictionaries_dir / filename)
    sys.modules["geneformer"] = geneformer

    # These imports are required at module load time, but the h5ad validation
    # path only needs read_h5ad and AnnData from scanpy's public surface.
    scanpy = types.ModuleType("scanpy")
    scanpy.read_h5ad = anndata.read_h5ad
    scanpy.AnnData = anndata.AnnData
    scanpy.concat = anndata.concat
    sys.modules.setdefault("scanpy", scanpy)
    sys.modules.setdefault("loompy", types.ModuleType("loompy"))
    datasets = types.ModuleType("datasets")
    datasets.Dataset = object
    sys.modules.setdefault("datasets", datasets)

    spec = importlib.util.spec_from_file_location("geneformer.tokenizer", tokenizer_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Cannot load the pinned Geneformer tokenizer.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module.TranscriptomeTokenizer


def create_fixture(path: Path, dictionaries_dir: Path) -> tuple[int, int]:
    with (dictionaries_dir / "token_dictionary_gc30M.pkl").open("rb") as source:
        tokens = pickle.load(source)
    with (dictionaries_dir / "gene_median_dictionary_gc30M.pkl").open("rb") as source:
        medians = pickle.load(source)
    genes = sorted(
        gene
        for gene in tokens
        if gene.startswith("ENSG") and gene in medians and float(medians[gene]) > 0
    )[:128]
    if len(genes) != 128:
        raise RuntimeError("The runtime does not contain 128 supported Geneformer genes.")
    counts = np.asarray(
        [
            [((gene_index * 17 + cell_index * 29) % 97) + 1 for gene_index in range(len(genes))]
            for cell_index in range(4)
        ],
        dtype=np.int32,
    )
    obs = pd.DataFrame(
        {"n_counts": counts.sum(axis=1), "filter_pass": np.ones(4, dtype=np.int8)},
        index=[f"cell-{index + 1}" for index in range(4)],
    )
    var = pd.DataFrame({"ensembl_id": genes}, index=genes)
    anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(path)
    return counts.shape


def run_product_script(
    python: Path,
    script: Path,
    runtime_dir: Path,
    fixture: Path,
    output_dir: Path,
) -> dict:
    payload = {
        "runtimePath": str(runtime_dir),
        "modelCacheDir": str(runtime_dir / "model-cache" / "geneformer-v1-10m"),
        "inputFile": str(fixture),
        "outputDir": str(output_dir),
        "batchSize": 2,
        "maxCsvRows": 4,
        "species": "human",
    }
    environment = {**os.environ, "LIATIR_AI_FORCE_CPU": "1"}
    completed = subprocess.run(
        [str(python), str(script)],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=environment,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"Liatir Geneformer runner failed:\n{completed.stderr}")
    return json.loads(completed.stdout.strip().splitlines()[-1])


def upstream_embeddings(
    tokenizer_path: Path,
    dictionaries_dir: Path,
    model_dir: Path,
    fixture: Path,
) -> tuple[list[np.ndarray], np.ndarray]:
    TranscriptomeTokenizer = load_upstream_tokenizer(tokenizer_path, dictionaries_dir)
    tokenizer = TranscriptomeTokenizer(nproc=1, chunk_size=512, model_version="V1")
    tokenized_cells, _, _ = tokenizer.tokenize_anndata(fixture, file_format="h5ad")

    model = AutoModelForMaskedLM.from_pretrained(
        str(model_dir),
        local_files_only=True,
        output_hidden_states=True,
    )
    model.eval()
    rows = []
    with torch.no_grad():
        for tokens in tokenized_cells:
            input_ids = torch.as_tensor(tokens[:2048], dtype=torch.long).unsqueeze(0)
            attention_mask = torch.ones_like(input_ids)
            outputs = model(
                input_ids=input_ids,
                attention_mask=attention_mask,
                output_hidden_states=True,
            )
            rows.append(outputs.hidden_states[-2].mean(dim=1).squeeze(0).numpy().astype(np.float32))
    return tokenized_cells, np.stack(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-dir", type=Path, required=True)
    parser.add_argument("--product-script", type=Path, required=True)
    parser.add_argument("--upstream-tokenizer", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    args = parser.parse_args()

    if sha256(args.upstream_tokenizer) != TOKENIZER_SHA256:
        raise SystemExit(
            "Pinned Geneformer tokenizer checksum mismatch; refusing an unreviewed upstream source."
        )
    cache_dir = args.runtime_dir / "model-cache" / "geneformer-v1-10m"
    dictionaries_dir = cache_dir / "dictionaries"
    model_dir = cache_dir / "model"
    args.work_dir.mkdir(parents=True, exist_ok=True)
    fixture = args.work_dir / "geneformer-parity-input.h5ad"
    output_dir = args.work_dir / "liatir-output"
    cell_count, gene_count = create_fixture(fixture, dictionaries_dir)
    product = run_product_script(
        args.runtime_dir / "venv" / "bin" / "python",
        args.product_script,
        args.runtime_dir,
        fixture,
        output_dir,
    )
    official_tokens, reference = upstream_embeddings(
        args.upstream_tokenizer,
        dictionaries_dir,
        model_dir,
        fixture,
    )
    product_adata = anndata.read_h5ad(product["embeddedAnnDataPath"])
    actual = np.asarray(product_adata.obsm["X_geneformer"], dtype=np.float32)
    if actual.shape != reference.shape:
        raise SystemExit(f"Embedding shape mismatch: Liatir {actual.shape}, upstream {reference.shape}.")

    difference = np.abs(actual - reference)
    max_absolute_error = float(difference.max(initial=0.0))
    cosine = np.sum(actual * reference, axis=1) / (
        np.linalg.norm(actual, axis=1) * np.linalg.norm(reference, axis=1)
    )
    if not np.allclose(actual, reference, rtol=1e-5, atol=1e-6):
        raise SystemExit(
            f"Geneformer scientific parity failed: max absolute error {max_absolute_error:.8g}."
        )

    print(json.dumps({
        "status": "passed",
        "upstreamRevision": PINNED_REVISION,
        "upstreamTokenizerSha256": TOKENIZER_SHA256,
        "cells": int(cell_count),
        "genes": int(gene_count),
        "tokenLengths": [int(len(tokens)) for tokens in official_tokens],
        "embeddingShape": list(actual.shape),
        "maxAbsoluteError": max_absolute_error,
        "minimumCosineSimilarity": float(np.min(cosine)),
        "device": "CPU",
    }, indent=2))


if __name__ == "__main__":
    main()
