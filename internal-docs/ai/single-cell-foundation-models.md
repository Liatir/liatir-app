# Single-cell Foundation Models

This page tracks Batch 5 implementation constraints. Keep this aligned with the
AI Model registry and public docs.

## Current status

Batch 5 now has two installable/runnable slices: UCE 4-layer and Geneformer V1
10M. scGPT and scFoundation stay visible as preview entries so users can
understand the roadmap, but they are not installable or runnable until each
runtime box has validated package installation, model asset handling, input
preprocessing, output parsing, Jobs, Results, and provenance.

## Official sources checked on 2026-07-02 and 2026-07-03

- [scGPT](https://github.com/bowang-lab/scGPT)
  - official codebase for scGPT;
  - MIT license;
  - PyPI package available as `scgpt`;
  - Python package supports Python `>=3.7.12,<4`;
  - pretrained checkpoints are external assets and must be modeled explicitly.
- [Geneformer](https://huggingface.co/ctheodoris/Geneformer)
  - official Hugging Face repository;
  - Apache 2.0 license;
  - V1 10M checkpoint, configuration, token dictionary, gene medians, and
    Ensembl mapping are pinned to revision
    `04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`;
  - Liatir downloads only those V1 assets instead of cloning the moving default
    repository with unrelated V2 checkpoints;
  - the managed runner accepts human raw-count AnnData with Ensembl IDs and can
    use CPU, CUDA, or Apple Metal.
- [UCE](https://github.com/snap-stanford/UCE)
  - MIT license;
  - official workflow embeds AnnData `.h5ad` files;
  - requirements are pinned and include PyTorch, Scanpy, Accelerate, NumPy,
    SciPy, Pandas, Requests, and urllib3;
  - Liatir manages the 4-layer source checkout, model weights, token file,
    species maps, offsets, and protein embeddings directly before run.
- [scFoundation](https://github.com/biomap-research/scFoundation)
  - Apache 2.0 license;
  - 100M-parameter model family;
  - requires a dedicated runtime and checkpoint-management pass before install.

## Runtime-box rule

Do not share these runtimes with CellTypist. CellTypist is a practical
annotation runtime; foundation models need separate boxes because package sets,
model files, preprocessing, and output semantics differ materially.

## Implemented slices

UCE 4-layer is the first real Batch 5 implementation. It uses an isolated
runtime ID (`single-cell-foundation-uce`), a pinned UCE source checkout, managed
Figshare assets, and a dedicated `ai-single-cell-embedding` AI Tool.

Geneformer V1 10M is the second slice. It uses the isolated runtime ID
`single-cell-foundation-geneformer-v1-10m` and the first signed Runtime Box
recipe for macOS arm64/Metal. The 201 MB archive contains standalone Python
3.11.9, a fully hash-locked dependency graph, checksummed V1-only assets, and
build provenance. A post-extraction self-test proves that the packaged runtime
is relocatable. Scientific/numerical parity and native app install/run E2E are
still required. The product catalog deliberately remains on the existing
managed-runtime installer until R2, production trust, and channel publication
are live; the cutover must not point users at an unavailable registry. The
runner uses Genecorpus-30M median-scaled rank encoding and the same compatible
`ai-single-cell-embedding` AI Tool.

The tool outputs:

- embedded AnnData with the model-specific `obsm["X_uce"]` or
  `obsm["X_geneformer"]` matrix;
- lightweight embedding preview CSV;
- summary JSON;
- intermediate UCE processing artifacts when UCE is selected;
- metrics, values, warnings, logs, and provenance.

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
