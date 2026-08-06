# scGPT Whole-human

scGPT is a single-cell foundation model built for single-cell and multi-omics
data. Liatir currently exposes the Whole-human checkpoint for local cell
embeddings.

## What it does

scGPT learns representations of cells and genes from large single-cell
datasets. Those representations can support tasks such as cell embedding,
reference mapping, batch correction, and perturbation hypotheses.

## Current status in Liatir

scGPT is published as a signed macOS arm64 Metal Runtime Box on the beta
channel. Liatir installs the complete tested environment and records the exact
box release in Results provenance.

## Expected inputs

- AnnData `.h5ad` file.
- Expression matrix and gene metadata.
- Optional batch or cell metadata for integration workflows.

## Expected outputs

- Cell embeddings.
- UMAP-ready tables or matrices.
- Optional batch-corrected representations.
- JSON/CSV summaries and provenance.

## Hardware and installation

The current product target is Apple silicon with Metal. The model and its
dependencies live inside the Runtime Box and are never added to the base app or
the system Python.

## Official source

- [scGPT on GitHub](https://github.com/bowang-lab/scGPT)
