# Geneformer V1 10M

Geneformer is a single-cell transcriptome foundation model designed to learn
gene-network context from many human single-cell transcriptomes.

## What it does

Geneformer can produce cell representations and supports downstream workflows
such as cell or gene classification, embedding extraction, and in-silico
perturbation analysis.

## Current status in Liatir

This model is visible as a preview. Install and run controls are not enabled
yet, because its setup requires model assets that need dedicated handling.

## Expected inputs

- Single-cell transcriptome data prepared for Geneformer tokenization.
- Gene expression matrix and metadata.
- Optional task labels for future fine-tuning workflows.

## Expected outputs

- Cell embeddings.
- Gene-network or perturbation summaries where supported.
- CSV/JSON outputs and provenance.

## Hardware and installation

The official documentation strongly recommends a GPU for efficient use. Liatir
will keep Geneformer in its own isolated environment, separate from CellTypist
and other single-cell tools.

## Official source

- [Geneformer on Hugging Face](https://huggingface.co/ctheodoris/Geneformer)
- [Geneformer documentation](https://geneformer.readthedocs.io/en/latest/getstarted.html)
