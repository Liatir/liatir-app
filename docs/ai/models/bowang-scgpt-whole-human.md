# scGPT Whole-human

scGPT is a single-cell foundation model built for single-cell and multi-omics
data. Liatir currently exposes the Whole-human checkpoint for local cell
embeddings.

## What it does

scGPT learns representations of cells and genes from large single-cell
datasets. Those representations can support tasks such as cell embedding,
reference mapping, batch correction, and perturbation hypotheses.

## Current status in Liatir

scGPT is published as signed Runtime Boxes for macOS arm64 Metal, Linux x86_64
CPU and Linux x86_64 CUDA 12.9. Windows x86_64 runs both Linux boxes through
WSL2.
Liatir installs the complete target-specific environment and records the exact
box release in Results provenance.

## Expected inputs

- AnnData `.h5ad` file.
- Expression matrix and gene metadata.
- Optional batch or cell metadata for integration workflows.

## Expected outputs

- Embedded AnnData with cell embeddings in `obsm["X_scgpt"]`.
- A bounded CSV preview for visualization.
- JSON summary, warnings and Runtime Box provenance.

## Hardware and installation

Use only the exact published target compatible with the host. The CUDA target
is CUDA 12.9, on Linux or on Windows through WSL2; support for it does not imply
other CUDA or driver combinations. The model and its dependencies live inside
the Runtime Box and are never added to the base app or system Python.

## Official source

- [scGPT on GitHub](https://github.com/bowang-lab/scGPT)
