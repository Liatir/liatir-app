# scGPT Whole-human

scGPT is a single-cell foundation model built for single-cell and multi-omics
data. In Liatir it is tracked as a preview AI Model for future embedding,
integration, perturbation, and gene-network workflows.

## What it does

scGPT learns representations of cells and genes from large single-cell
datasets. Those representations can support tasks such as cell embedding,
reference mapping, batch correction, and perturbation hypotheses.

## Current status in Liatir

This model is visible as a preview. Liatir documents the model and keeps its
metadata in the AI Model registry, but install and run controls are not enabled
yet.

The next implementation step is a dedicated managed runtime box that can install
the Python package, download a selected checkpoint, validate AnnData inputs, and
write embeddings/provenance through the shared Liatir I/O contract.

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

Small examples may load on CPU, but practical foundation-model workflows should
use a GPU. scGPT is a heavy scientific runtime and will stay isolated from the
core app.

## Official source

- [scGPT on GitHub](https://github.com/bowang-lab/scGPT)
