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
import transformers
from transformers import AutoModelForMaskedLM


PINNED_REVISION = "04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5"
TOKENIZER_SHA256 = "689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002"
CPU_ABSOLUTE_TOLERANCE = 1e-6
CPU_RELATIVE_TOLERANCE = 1e-5
ACCELERATOR_ABSOLUTE_TOLERANCE = 1e-5
ACCELERATOR_RELATIVE_TOLERANCE = 1e-4
ACCELERATOR_MINIMUM_COSINE = 0.99999
CUDA_TARGET_ID = "linux-x86_64-cuda12.4"
CUDA_VERSION = "12.4"
MINIMUM_NVIDIA_DRIVER = "550.54.14"
EXPECTED_T4_MODEL = "Tesla T4"
EXPECTED_T4_CAPABILITY = (7, 5)
MINIMUM_T4_MEMORY_BYTES = 15_000_000_000


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def numeric_version_at_least(actual: str, minimum: str) -> bool:
    """Compare dotted numeric driver versions without treating them as decimals."""
    try:
        actual_parts = [int(part) for part in actual.split(".")]
        minimum_parts = [int(part) for part in minimum.split(".")]
    except ValueError:
        return False
    length = max(len(actual_parts), len(minimum_parts))
    actual_parts.extend([0] * (length - len(actual_parts)))
    minimum_parts.extend([0] * (length - len(minimum_parts)))
    return actual_parts >= minimum_parts


def nvidia_smi_identity() -> tuple[str, str]:
    """Read the exact GPU and driver exposed by the native runner."""
    completed = subprocess.run(
        [
            "nvidia-smi",
            "--query-gpu=name,driver_version",
            "--format=csv,noheader,nounits",
        ],
        text=True,
        capture_output=True,
        check=False,
    )
    if completed.returncode != 0:
        raise RuntimeError(f"nvidia-smi failed:\n{completed.stderr}")
    devices = [line.strip() for line in completed.stdout.splitlines() if line.strip()]
    if len(devices) != 1:
        raise RuntimeError(f"Expected one T4 GPU, found {len(devices)}.")
    gpu_model, driver_version = [value.strip() for value in devices[0].split(",", 1)]
    return gpu_model, driver_version


def compare_embeddings(actual: np.ndarray, reference: np.ndarray) -> tuple[float, float, bool]:
    """Return maximum absolute error, minimum cosine similarity, and finiteness."""
    difference = np.abs(actual - reference)
    maximum_absolute_error = float(difference.max(initial=0.0))
    denominator = np.linalg.norm(actual, axis=1) * np.linalg.norm(reference, axis=1)
    cosine = np.divide(
        np.sum(actual * reference, axis=1),
        denominator,
        out=np.zeros_like(denominator, dtype=np.float32),
        where=denominator > 0,
    )
    return maximum_absolute_error, float(np.min(cosine)), bool(np.isfinite(actual).all())


def product_embeddings(product: dict) -> np.ndarray:
    """Load the canonical embedding matrix emitted by the shipped product runner."""
    product_adata = anndata.read_h5ad(product["embeddedAnnDataPath"])
    return np.asarray(product_adata.obsm["X_geneformer"], dtype=np.float32)


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
    force_cpu: bool,
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
    environment = dict(os.environ)
    if force_cpu:
        environment["LIATIR_AI_FORCE_CPU"] = "1"
    else:
        environment.pop("LIATIR_AI_FORCE_CPU", None)
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
    parser.add_argument("--target-id", required=True)
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
    cell_count, gene_count = create_fixture(fixture, dictionaries_dir)
    cpu_product = run_product_script(
        args.runtime_dir / "venv" / "bin" / "python",
        args.product_script,
        args.runtime_dir,
        fixture,
        args.work_dir / "liatir-output-cpu",
        force_cpu=True,
    )
    official_tokens, reference = upstream_embeddings(
        args.upstream_tokenizer,
        dictionaries_dir,
        model_dir,
        fixture,
    )
    cpu_actual = product_embeddings(cpu_product)
    if cpu_actual.shape != reference.shape:
        raise SystemExit(
            f"CPU baseline shape mismatch: Liatir {cpu_actual.shape}, upstream {reference.shape}."
        )
    cpu_error, cpu_cosine, cpu_finite = compare_embeddings(cpu_actual, reference)
    if (
        cpu_product.get("summary", {}).get("accelerator") != "CPU"
        or not cpu_finite
        or not np.allclose(
            cpu_actual,
            reference,
            rtol=CPU_RELATIVE_TOLERANCE,
            atol=CPU_ABSOLUTE_TOLERANCE,
        )
    ):
        raise SystemExit(
            f"Geneformer CPU baseline parity failed: max absolute error {cpu_error:.8g}."
        )

    actual = cpu_actual
    max_absolute_error = cpu_error
    minimum_cosine = cpu_cosine
    finite = cpu_finite
    device = "CPU"
    accelerator_kind = "cpu"
    gpu_model = None
    gpu_memory_bytes = None
    compute_capability = None
    driver_version = None
    reported_cuda = torch.version.cuda
    peak_vram_bytes = None
    backend = f"transformers-{transformers.__version__}-cpu"
    tolerances = {
        "absolute": CPU_ABSOLUTE_TOLERANCE,
        "relative": CPU_RELATIVE_TOLERANCE,
    }
    parity = {
        "reference": "pinned-upstream-tokenizer-and-model",
        "passed": True,
        "maximumAbsoluteDifference": cpu_error,
        "minimumCosineSimilarity": cpu_cosine,
        "cpuBaselinePassed": True,
        "cpuBaselineMaximumAbsoluteDifference": cpu_error,
        "cpuBaselineMinimumCosineSimilarity": cpu_cosine,
    }

    if args.target_id == CUDA_TARGET_ID:
        if torch.version.cuda != CUDA_VERSION or not torch.cuda.is_available():
            raise SystemExit(
                f"CUDA target requires available CUDA {CUDA_VERSION}; torch reports {torch.version.cuda}."
            )
        torch_gpu_model = torch.cuda.get_device_name(0)
        capability = torch.cuda.get_device_capability(0)
        total_memory = int(torch.cuda.get_device_properties(0).total_memory)
        smi_gpu_model, driver_version = nvidia_smi_identity()
        if torch_gpu_model != EXPECTED_T4_MODEL or smi_gpu_model != EXPECTED_T4_MODEL:
            raise SystemExit(
                f"CUDA pilot requires {EXPECTED_T4_MODEL}; torch={torch_gpu_model}, nvidia-smi={smi_gpu_model}."
            )
        if capability != EXPECTED_T4_CAPABILITY:
            raise SystemExit(f"T4 compute capability mismatch: expected 7.5, found {capability}.")
        if total_memory < MINIMUM_T4_MEMORY_BYTES:
            raise SystemExit(f"T4 usable memory is below {MINIMUM_T4_MEMORY_BYTES} bytes.")
        if not numeric_version_at_least(driver_version, MINIMUM_NVIDIA_DRIVER):
            raise SystemExit(
                f"NVIDIA driver {driver_version} is below required {MINIMUM_NVIDIA_DRIVER}."
            )

        accelerator_product = run_product_script(
            args.runtime_dir / "venv" / "bin" / "python",
            args.product_script,
            args.runtime_dir,
            fixture,
            args.work_dir / "liatir-output-cuda",
            force_cpu=False,
        )
        summary = accelerator_product.get("summary", {})
        if (
            summary.get("accelerator") != "CUDA"
            or summary.get("reportedCudaCompatibility") != CUDA_VERSION
            or summary.get("gpuModel") != EXPECTED_T4_MODEL
            or summary.get("computeCapability") != "7.5"
            or not isinstance(summary.get("peakVramBytes"), int)
            or summary["peakVramBytes"] <= 0
        ):
            raise SystemExit("The shipped product runner did not report complete T4 CUDA evidence.")
        accelerator_actual = product_embeddings(accelerator_product)
        if accelerator_actual.shape != cpu_actual.shape:
            raise SystemExit(
                f"CUDA embedding shape mismatch: CUDA {accelerator_actual.shape}, CPU {cpu_actual.shape}."
            )
        accelerator_error, accelerator_cosine, accelerator_finite = compare_embeddings(
            accelerator_actual,
            cpu_actual,
        )
        if (
            not accelerator_finite
            or not np.allclose(
                accelerator_actual,
                cpu_actual,
                rtol=ACCELERATOR_RELATIVE_TOLERANCE,
                atol=ACCELERATOR_ABSOLUTE_TOLERANCE,
            )
            or accelerator_cosine < ACCELERATOR_MINIMUM_COSINE
        ):
            raise SystemExit(
                "Geneformer CUDA parity failed: "
                f"max absolute error {accelerator_error:.8g}, minimum cosine {accelerator_cosine:.8g}."
            )
        actual = accelerator_actual
        max_absolute_error = accelerator_error
        minimum_cosine = accelerator_cosine
        finite = accelerator_finite
        device = EXPECTED_T4_MODEL
        accelerator_kind = "cuda"
        gpu_model = EXPECTED_T4_MODEL
        gpu_memory_bytes = total_memory
        compute_capability = "7.5"
        reported_cuda = CUDA_VERSION
        peak_vram_bytes = summary["peakVramBytes"]
        backend = f"transformers-{transformers.__version__}-cu124"
        tolerances = {
            "absolute": ACCELERATOR_ABSOLUTE_TOLERANCE,
            "relative": ACCELERATOR_RELATIVE_TOLERANCE,
            "minimumCosineSimilarity": ACCELERATOR_MINIMUM_COSINE,
            "cpuBaselineAbsolute": CPU_ABSOLUTE_TOLERANCE,
            "cpuBaselineRelative": CPU_RELATIVE_TOLERANCE,
        }
        parity.update({
            "reference": "same-lock-cpu-baseline",
            "maximumAbsoluteDifference": accelerator_error,
            "minimumCosineSimilarity": accelerator_cosine,
            "acceleratorPassed": True,
            "acceleratorVsCpuMaximumAbsoluteDifference": accelerator_error,
            "acceleratorVsCpuMinimumCosineSimilarity": accelerator_cosine,
            "computeCapability": "7.5",
            "gpuMemoryBytes": total_memory,
        })
    elif args.target_id == "macos-aarch64-metal":
        if not hasattr(torch.backends, "mps") or not torch.backends.mps.is_available():
            raise SystemExit("Apple Metal target requires an available MPS backend.")
        accelerator_product = run_product_script(
            args.runtime_dir / "venv" / "bin" / "python",
            args.product_script,
            args.runtime_dir,
            fixture,
            args.work_dir / "liatir-output-metal",
            force_cpu=False,
        )
        if accelerator_product.get("summary", {}).get("accelerator") != "Apple Metal":
            raise SystemExit("The shipped product runner did not use Apple Metal.")
        accelerator_actual = product_embeddings(accelerator_product)
        if accelerator_actual.shape != cpu_actual.shape:
            raise SystemExit(
                f"Metal embedding shape mismatch: Metal {accelerator_actual.shape}, CPU {cpu_actual.shape}."
            )
        accelerator_error, accelerator_cosine, accelerator_finite = compare_embeddings(
            accelerator_actual,
            cpu_actual,
        )
        if (
            not accelerator_finite
            or not np.allclose(
                accelerator_actual,
                cpu_actual,
                rtol=ACCELERATOR_RELATIVE_TOLERANCE,
                atol=ACCELERATOR_ABSOLUTE_TOLERANCE,
            )
            or accelerator_cosine < ACCELERATOR_MINIMUM_COSINE
        ):
            raise SystemExit(
                "Geneformer Metal parity failed: "
                f"max absolute error {accelerator_error:.8g}, minimum cosine {accelerator_cosine:.8g}."
            )
        actual = accelerator_actual
        max_absolute_error = accelerator_error
        minimum_cosine = accelerator_cosine
        finite = accelerator_finite
        device = "Apple Metal"
        accelerator_kind = "metal"
        gpu_model = "Apple Metal"
        backend = f"transformers-{transformers.__version__}-mps"
        tolerances = {
            "absolute": ACCELERATOR_ABSOLUTE_TOLERANCE,
            "relative": ACCELERATOR_RELATIVE_TOLERANCE,
            "minimumCosineSimilarity": ACCELERATOR_MINIMUM_COSINE,
            "cpuBaselineAbsolute": CPU_ABSOLUTE_TOLERANCE,
            "cpuBaselineRelative": CPU_RELATIVE_TOLERANCE,
        }
        parity.update({
            "reference": "same-lock-cpu-baseline",
            "maximumAbsoluteDifference": accelerator_error,
            "minimumCosineSimilarity": accelerator_cosine,
            "acceleratorPassed": True,
            "acceleratorVsCpuMaximumAbsoluteDifference": accelerator_error,
            "acceleratorVsCpuMinimumCosineSimilarity": accelerator_cosine,
        })
    elif args.target_id != "linux-x86_64-cpu":
        raise SystemExit(f"Unsupported Geneformer parity target: {args.target_id}")

    print(json.dumps({
        "status": "passed",
        "upstreamRevision": PINNED_REVISION,
        "upstreamTokenizerSha256": TOKENIZER_SHA256,
        "cells": int(cell_count),
        "genes": int(gene_count),
        "tokenLengths": [int(len(tokens)) for tokens in official_tokens],
        "embeddingShape": list(actual.shape),
        "maxAbsoluteError": max_absolute_error,
        "minimumCosineSimilarity": minimum_cosine,
        "device": device,
        "evidence": {
            "fixture": {
                "id": "geneformer-pinned-4-cell-128-gene-v1",
                "sha256": sha256(fixture),
                "inputShapes": {"counts": [int(cell_count), int(gene_count)]},
            },
            "framework": {
                "name": "torch",
                "version": torch.__version__,
                "backend": backend,
                "reportedCudaCompatibility": reported_cuda,
            },
            "accelerator": {
                "kind": accelerator_kind,
                "gpuModel": gpu_model,
                "gpuMemoryBytes": gpu_memory_bytes,
                "computeCapability": compute_capability,
                "driverVersion": driver_version,
                "reportedCudaCompatibility": reported_cuda,
            },
            "outputShapes": {"embeddings": list(actual.shape)},
            "finiteValues": finite,
            "tolerances": tolerances,
            "parity": parity,
            "peakRamBytes": None,
            "peakVramBytes": peak_vram_bytes,
            "outputContract": "passed",
            "provenanceContract": "passed",
        },
    }, indent=2))


if __name__ == "__main__":
    main()
