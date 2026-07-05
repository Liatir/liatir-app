# scFoundation 100M

scFoundation is a large single-cell foundation model candidate for expression
representation and downstream cell-state analysis.

## What it does

scFoundation is designed to learn from large-scale single-cell expression data.
In Liatir it is tracked as a future option for embeddings and related
single-cell analysis workflows.

## Current status in Liatir

This model is visible as a preview. Liatir does not expose install or run
controls yet because the runtime, checkpoint management, and output validation
need a dedicated implementation.

## Expected inputs

- Single-cell expression matrix or AnnData `.h5ad` file.
- Gene metadata.
- Optional cell metadata for downstream analysis.

## Expected outputs

- Cell embeddings or model representations.
- Summary tables.
- Provenance linked to the exact model and parameters.

## Hardware and installation

This is a large model family. It installs as a separate, optional environment
and is never bundled into the base app.

## Official source

- [scFoundation on GitHub](https://github.com/biomap-research/scFoundation)
