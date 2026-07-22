# Single-cell Foundation Models

This page tracks Batch 5 implementation constraints. Keep this aligned with the
AI Model registry and public docs.

## Current status

Batch 5 has three installable/runnable slices: UCE 4-layer, Geneformer V1 10M,
and scGPT Whole-human. All three use signed Runtime Boxes. UCE's protected
macOS arm64 release completed in run `29909249357`; Geneformer has reviewed
production and native lifecycle evidence across macOS Metal, Linux CPU/CUDA,
and Windows CPU; scGPT has a signed macOS arm64 box. These three entries are
the complete product AI Model catalog; scFoundation is not registered or
visible.

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
  - source code is MIT at pinned revision
    `8ead6e07af0c80f75653598138bb704e865b45c8`;
  - the five official model assets are CC BY 4.0 under Figshare item 24320806,
    version 5, and require attribution to Yusuf Roohani;
  - official workflow embeds AnnData `.h5ad` files;
  - requirements are pinned and include PyTorch, Scanpy, Accelerate, NumPy,
    SciPy, Pandas, Requests, and urllib3;
  - Liatir manages the 4-layer source checkout, model weights, token file,
    species maps, offsets, and protein embeddings directly before run;
  - exact byte sizes, MD5 values, and SHA-256 values for all five assets were
    verified on 2026-07-13 and are recorded in
    `runtime-boxes/legal/uce-4layer.md` together with the dependency license
    audit.
- [scFoundation](https://github.com/biomap-research/scFoundation)
  - source code is Apache 2.0, but checkpoint redistribution is restricted to
    non-commercial research by its separate model license;
  - 100M-parameter model family;
  - remains a research note only and is absent from the product catalog.

## Runtime-box rule

Do not share these runtimes. Each model has a separate signed box because
package sets, model files, preprocessing, and output semantics differ
materially.

## Implemented slices

UCE 4-layer is the first real Batch 5 implementation. It uses an isolated
runtime ID (`single-cell-foundation-uce`), a pinned UCE source checkout, managed
Figshare assets, and a dedicated `ai-single-cell-embedding` AI Tool.

Geneformer V1 10M is the second slice. It uses the isolated runtime ID
`single-cell-foundation-geneformer-v1-10m` and the first signed Runtime Box
recipe for macOS arm64/Metal. The 201 MB archive contains standalone Python
3.11.9, a fully hash-locked dependency graph, checksummed V1-only assets, and
build provenance. A post-extraction self-test proves that the packaged runtime
is relocatable. Production-signed releases are published on R2 and live through
the Registry Worker beta channel for macOS arm64 Metal, Linux x86_64 CPU,
Linux x86_64 CUDA 12.4, and Windows x86_64 CPU. Reviewed scientific parity and
native lifecycle evidence covers all four targets. The runner uses
Genecorpus-30M median-scaled rank encoding and the same compatible
`ai-single-cell-embedding` AI Tool. CUDA is supported only on Linux; the
Windows CUDA recipe remains unvalidated, unpublished, and unsupported.

The tool outputs:

- embedded AnnData with the model-specific `obsm["X_uce"]` or
  `obsm["X_geneformer"]` matrix;
- lightweight embedding preview CSV;
- summary JSON;
- intermediate UCE processing artifacts when UCE is selected;
- metrics, values, warnings, logs, and provenance.

## Required acceptance checks before adding another model

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
