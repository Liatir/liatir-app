# Single-cell Foundation Models

This page tracks Batch 5 implementation constraints. Keep this aligned with the
AI Model registry and public docs.

## Current status

Batch 5 is started as preview metadata only. The models below are visible in AI
Models so users can understand the roadmap, but they are not installable or
runnable until each runtime box has validated package installation, model asset
handling, input preprocessing, output parsing, Jobs, Results, and provenance.

## Official sources checked on 2026-07-02

- [scGPT](https://github.com/bowang-lab/scGPT)
  - official codebase for scGPT;
  - MIT license;
  - PyPI package available as `scgpt`;
  - Python package supports Python `>=3.7.12,<4`;
  - pretrained checkpoints are external assets and must be modeled explicitly.
- [Geneformer](https://huggingface.co/ctheodoris/Geneformer)
  - official Hugging Face repository;
  - Apache 2.0 license;
  - official docs require Git LFS, clone from Hugging Face, then `pip install .`;
  - package declares Python `>=3.10`;
  - GPU resources are strongly recommended for efficient usage.
- [UCE](https://github.com/snap-stanford/UCE)
  - MIT license;
  - official workflow embeds AnnData `.h5ad` files;
  - requirements are pinned and include PyTorch, Scanpy, Accelerate, NumPy,
    SciPy, Pandas, Requests, and urllib3;
  - official scripts can download model files, but Liatir should manage those
    files directly before exposing Install.
- [scFoundation](https://github.com/biomap-research/scFoundation)
  - Apache 2.0 license;
  - 100M-parameter model family;
  - requires a dedicated runtime and checkpoint-management pass before install.

## Runtime-box rule

Do not share these runtimes with CellTypist. CellTypist is a practical
annotation runtime; foundation models need separate boxes because package sets,
model files, preprocessing, and output semantics differ materially.

## First real implementation target

The first installable Batch 5 runtime should be the one with the smallest
validated asset surface. UCE is a strong candidate because the official workflow
is AnnData-focused and the repository documents a single embedding script, but
Liatir should still replace implicit script downloads with explicit managed
files wherever possible.

## Required acceptance checks before enabling Install or Run

- Model package install works in a clean runtime directory.
- Model files are downloaded by Liatir, not hidden inside uncontrolled script
  side effects.
- `.h5ad` input requirements are explained before run.
- Raw counts versus normalized/log-transformed matrices are validated where the
  model expects a specific representation.
- Outputs use the shared Liatir artifact contract.
- Results include embeddings, summary, warnings, and provenance.
- Jobs show the parent model/tool and useful stdout/stderr logs.
- Navigation away and back preserves running state.
