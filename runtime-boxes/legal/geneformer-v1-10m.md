# Geneformer V1 10M redistribution record

Verification date: 2026-07-16

## Decision

The pinned Geneformer V1 10M source and model assets are eligible for the
Linux CPU Runtime Box under Apache License 2.0. The upstream model card at the
reviewed revision declares `apache-2.0`; that revision does not contain a
standalone `LICENSE` or `NOTICE` file. The Runtime Box therefore includes the
complete Apache 2.0 license and a source-attribution notice next to the
unmodified model assets.

The reviewed upstream revision is
`04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`, and the model assets in the
recipe are content-addressed. Any source revision, asset, Python runtime, or
dependency-lock change requires a new audit.

The exact Linux CPU dependency lock is separately reviewed in
`runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cpu.json`. All 34
installed distributions declare redistributable open-source terms, their
wheel-provided license and notice files remain in the installed `.dist-info`
directories, and the audited PyTorch distribution is exactly
`torch==2.4.1+cpu`. The build rejects a package, version, license declaration,
or license-file layout that differs from this reviewed audit.

This approval does not cover a future CUDA dependency lock. CUDA wheels and
their bundled NVIDIA components require a distinct audit against the exact
generated lock and NVIDIA's redistribution terms before publication.

This is an engineering compliance record, not legal advice.

## Pinned source and artifact identity

- Repository: `https://huggingface.co/ctheodoris/Geneformer`
- Exact source commit: `04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5`
- Source tag: none; the commit is the release identity
- Checkpoint: `Geneformer-V1-10M/model.safetensors`, 41,183,536 bytes,
  SHA-256 `a5e33a757431643b3697de7ef6127950cdc49e06e58d4266b3a3ab191b683f14`
- Configuration: `Geneformer-V1-10M/config.json`, 565 bytes, SHA-256
  `9cf69ca3bdb0215c4188b54c451b6f02adfe68b8f66011a57d0f32845133fd4b`
- Token dictionary: SHA-256
  `ab9dc40973fa5224d77b793e2fd114cacf3d08423ed9c4c49caf0ba9c7f218f1`
- Median dictionary: SHA-256
  `b3b589bb5ec75040d05fc44dd6bf0184cf87f3c362cf158d196a6ed3b7fe5f39`
- Ensembl mapping: SHA-256
  `eac0fb0b3007267871b6305ac0003ceba19d4f28d85686cb9067ecf142787869`
- Pinned upstream tokenizer used for parity: SHA-256
  `689b71a916b75fa618fbb460a7fc460c3ab32d41e4f98064efb0ebb3ee921002`

## Linux CPU dependency and layout review

- Recipe: `geneformer-v1-10m-linux-x86_64-cpu`
- Python: `3.11.9`
- Resolver: `uv 0.11.28`
- Wheel target: `x86_64-unknown-linux-gnu`
- PyTorch backend: `cpu`
- Dependency lock SHA-256:
  `73a31b39b7f2f3eee6a1c7628d13728490ed4db31095c50ab5ce0211b98829f1`
- Dependency payload measured before standalone Python and model assets:
  approximately 1.1 GiB extracted
- Build disk gate: 6 GiB; actual peak and installed/archive sizes must be
  recorded by the native Linux run
- Declared minimum RAM: 8 GiB. Upstream does not publish a numeric CPU RAM
  minimum, so actual peak RAM remains a required native-run measurement.

The payload layout is fixed as follows:

- standalone Python and distributions under `venv/`;
- checkpoint and configuration under
  `model-cache/geneformer-v1-10m/model/`;
- pinned dictionaries under
  `model-cache/geneformer-v1-10m/dictionaries/`;
- upstream license and source notice under `licenses/` and
  `THIRD_PARTY_NOTICES/`;
- deterministic dependency-license evidence at
  `THIRD_PARTY_NOTICES/python-distributions.json`.

## CUDA 12.4 and T4 preconditions

PyTorch 2.4.1 publishes official Linux wheels for CUDA 12.4. NVIDIA documents
the Tesla T4 as a 16 GiB Turing GPU with compute capability 7.5, which is
supported by CUDA 12.x. CUDA 12.x minor-version compatibility requires at least
Linux driver 525.60.13. These are only compatibility preconditions: the exact
CUDA lock, bundled component licenses, driver identity, peak VRAM, numeric
tolerances, and real T4 inference remain unapproved until the CPU target is
closed and the dedicated T4 run passes.

## Sources

- [Pinned Geneformer repository and assets](https://huggingface.co/ctheodoris/Geneformer/tree/04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [Apache redistribution FAQ](https://www.apache.org/foundation/license-faq.html)
- [PyTorch 2.4.1 CPU and CUDA 12.4 wheels](https://docs.pytorch.org/get-started/previous-versions/)
- [uv PyTorch backend selection](https://docs.astral.sh/uv/guides/integration/pytorch/)
- [NVIDIA T4 specifications](https://www.nvidia.com/en-us/data-center/tesla-t4/)
- [NVIDIA CUDA GPU compute capabilities](https://developer.nvidia.com/cuda/gpus)
- [CUDA 12.4 minimum driver versions](https://docs.nvidia.com/cuda/archive/12.4.0/cuda-toolkit-release-notes/index.html)
- [NVIDIA CUDA Toolkit redistribution terms](https://docs.nvidia.com/cuda/eula/index.html)
