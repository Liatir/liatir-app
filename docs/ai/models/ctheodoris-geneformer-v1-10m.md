# Geneformer V1 10M

Geneformer is a single-cell transcriptome foundation model designed to learn
gene-network context from many human single-cell transcriptomes.

## What it does

Geneformer can produce cell representations and supports downstream workflows
such as cell or gene classification, embedding extraction, and in-silico
perturbation analysis.

## Current status in Liatir

Geneformer V1 10M is installable as an isolated managed runtime. Liatir pins the
official V1 checkpoint and matching Genecorpus-30M dictionaries to one upstream
revision instead of following the repository's changing default model.

## Expected inputs

- Human AnnData `.h5ad` data with non-negative raw counts in `.X`.
- Ensembl gene IDs in `var["ensembl_id"]`, or Ensembl IDs as `var_names`.
- Optional `obs["n_counts"]`; Liatir computes totals from `.X` when absent.
- Optional `obs["filter_pass"]` to include only passing cells.

## Expected outputs

- Embedded AnnData with `obsm["X_geneformer"]`.
- Lightweight CSV preview and JSON summary.
- Input warnings, metrics, Jobs, Results, and reproducible provenance.

The current Liatir slice produces cell embeddings only. Gene-network inference,
classification, fine-tuning, and in-silico perturbation are not exposed by this
runtime.

## Hardware and installation

The 10M-parameter V1 model can run on CPU for small datasets. CUDA or Apple
Metal is preferred for larger cell batches. Liatir keeps Geneformer in its own
isolated environment, separate from CellTypist, UCE, and other single-cell
tools.

The input matrix is normalized per cell to 10,000 counts, scaled by the official
Genecorpus-30M gene medians, converted to the V1 rank-value encoding, and capped
at 2,048 gene tokens. Cell embeddings are mean-pooled from the second-to-last
hidden layer. The original input file is never modified.

## Official source

- [Geneformer on Hugging Face](https://huggingface.co/ctheodoris/Geneformer)
- [Geneformer documentation](https://geneformer.readthedocs.io/en/latest/getstarted.html)
