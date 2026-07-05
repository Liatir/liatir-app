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

The next step is a managed environment that can install the model, download a
selected checkpoint, validate AnnData inputs, and write embeddings with full
provenance.

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
use a GPU. scGPT is heavy, so it installs in its own isolated environment and is
never added to the base app.

## Official source

- [scGPT on GitHub](https://github.com/bowang-lab/scGPT)
