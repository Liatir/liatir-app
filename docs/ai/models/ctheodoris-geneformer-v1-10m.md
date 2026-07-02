# Geneformer V1 10M

Geneformer is a single-cell transcriptome foundation model designed to learn
gene-network context from many human single-cell transcriptomes.

## What it does

Geneformer can produce cell representations and supports downstream workflows
such as cell or gene classification, embedding extraction, and in-silico
perturbation analysis.

## Current status in Liatir

This model is visible as a preview. Liatir does not enable install or run
controls yet because the official setup depends on Git LFS and model assets that
must be managed explicitly inside a dedicated runtime box.

## Expected inputs

- Single-cell transcriptome data prepared for Geneformer tokenization.
- Gene expression matrix and metadata.
- Optional task labels for future fine-tuning workflows.

## Expected outputs

- Cell embeddings.
- Gene-network or perturbation summaries where supported.
- CSV/JSON outputs and provenance.

## Hardware and installation

The official documentation strongly recommends GPU resources for efficient use.
Liatir will keep Geneformer in its own managed runtime instead of mixing it with
CellTypist or other single-cell tools.

## Official source

- [Geneformer on Hugging Face](https://huggingface.co/ctheodoris/Geneformer)
- [Geneformer documentation](https://geneformer.readthedocs.io/en/latest/getstarted.html)
