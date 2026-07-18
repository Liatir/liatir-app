# Geneformer V1 10M redistribution record

Verification date: 2026-07-18

## Decision

The pinned Geneformer V1 10M source and model assets are eligible for the
reviewed Linux and Windows Runtime Box targets under Apache License 2.0. The upstream
model card at the reviewed revision declares `apache-2.0`; that revision does
not contain a standalone `LICENSE` or `NOTICE` file. Each Runtime Box therefore
includes the complete Apache 2.0 license and a source-attribution notice next
to the unmodified model assets.

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

The exact Linux CUDA dependency lock is separately reviewed in
`runtime-boxes/legal/audits/geneformer-v1-10m-linux-x86_64-cuda12.4.json`.
All 47 wheel distributions are hash-locked. The 12 NVIDIA distributions retain
their wheel-provided `License.txt` files in `.dist-info`; CUDA Toolkit runtime
libraries are covered by the NVIDIA SDK agreement and CUDA supplement, cuDNN
has its own runtime redistribution grant, and NCCL uses its bundled BSD-style
license. Liatir ships the unmodified Linux object code as part of the
materially functional Geneformer application and does not bundle the NVIDIA
driver. The build re-creates this inventory from the installed payload and
rejects any metadata, version, license-file, or lock drift before signing.

Four wheels do not expose a license file inside `.dist-info`. The shared Apache
2.0 text plus the named dependency inventory covers `safetensors==0.4.5` and
`tokenizers==0.19.1`. The CUDA recipe additionally includes the exact upstream
MIT texts and copyright notices for `array-api-compat==1.15.0` from tag `1.15`
(commit `076218e4f5aa18578418c7d04fad9ab581a16bb8`) and `triton==3.0.0` from tag
`v3.0.0` (commit `55a4ab051c88ba2baa031e520a339d3fded6468f`).
The Windows CPU recipe also includes and self-tests the exact
`array-api-compat==1.15.0` MIT text. The already-published Linux CPU artifact
predates that supplemental inclusion; it must be replaced in a separately
authorized corrective release rather than being described as if its immutable
payload had changed.

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

## Linux CUDA 12.4 dependency and layout review

- Recipe: `geneformer-v1-10m-linux-x86_64-cuda12.4`
- Python: `3.11.9`
- Resolver: `uv 0.11.28`
- Wheel target: `x86_64-unknown-linux-gnu`
- PyTorch backend: `cu124`
- Dependency lock SHA-256:
  `4cc737f7bb6580de2fc6da0d89f2a17a2f200a35c82f5734f7e503c1772579ed`
- Exact PyTorch distribution: `torch==2.4.1+cu124`
- Locked wheel count: 47, including 12 NVIDIA distributions
- Supplemental exact MIT notices:
  `array-api-compat-1.15.0-MIT.txt` SHA-256
  `4ffd978e3fa18d058d98c66771cfea7ed634aaf7023cf9612b8b55eee9a8f0fe`
  and `triton-3.0.0-MIT.txt` SHA-256
  `92640fb97222fd0a698ff28ce0c3782c172623f8d6c609b557636a80f28fb946`
- Selected wheel bytes: 2,984,892,298 compressed and 5,443,678,121 expanded
- Conservative build disk gate: 20 GiB, including a 6 GiB installed-payload
  estimate, 3 GiB archive estimate, and 6 GiB safety/cache margin
- Declared minimum RAM: 8 GiB
- Declared minimum NVIDIA driver: `550.54.14`, the Linux driver paired with
  CUDA 12.4 GA rather than the looser CUDA 12.x minor-compatibility floor
- Validated runner contract: one Tesla T4, compute capability 7.5, and at least
  15,000,000,000 usable GPU bytes; the official runner specification is 16 GB
  VRAM, 28 GB RAM, and 176 GB SSD

The CUDA audit was first prepared from hash-verified Linux wheel metadata on a
non-Linux host. Gate 8.1 run `29643382673` then installed the full lock on the
native T4 runner, reproduced the audit, passed CUDA imports and self-test, and
recorded installed/archive size, peak disk, peak VRAM, GPU identity, driver,
and scientific tolerances.

## Windows CPU dependency and layout review

- Recipe: `geneformer-v1-10m-windows-x86_64-cpu`
- Python: `3.11.9`
- Resolver: `uv 0.11.28`
- Wheel target: `x86_64-pc-windows-msvc`
- PyTorch backend: `cpu`
- Dependency lock SHA-256:
  `b0e070dbcbf7c236db06afd086bd39dec99721221f0019ce12f9cb1affd28e7c`
- Exact PyTorch distribution: `torch==2.4.1+cpu`
- Locked wheel count: 35
- Selected wheel bytes: 306,063,118 compressed and 1,484,068,521 expanded
- Supplemental exact MIT notice:
  `array-api-compat-1.15.0-MIT.txt` SHA-256
  `4ffd978e3fa18d058d98c66771cfea7ed634aaf7023cf9612b8b55eee9a8f0fe`
- Conservative build disk gate: 6 GiB, including a 2 GiB installed-payload
  estimate, 1 GiB archive estimate, and 2 GiB safety/cache margin
- Declared minimum RAM: 8 GiB. Actual peak RAM remains a required native-run
  measurement.

This audit inspected only hash-verified Windows wheel metadata and license
files on the local non-Windows host; it did not execute foreign binaries. The
native Windows build must still install the lock into standalone Python,
reproduce the audit, pass DLL/import and scientific self-tests, and record
actual installed/archive size, peak disk, and peak RAM.

The payload layout is fixed as follows:

- standalone Python and distributions under `venv/`;
- checkpoint and configuration under
  `model-cache/geneformer-v1-10m/model/`;
- pinned dictionaries under
  `model-cache/geneformer-v1-10m/dictionaries/`;
- upstream license and source notice under `licenses/` and
  `THIRD_PARTY_NOTICES/`;
- exact supplemental MIT notices for wheel metadata that omits bundled license
  files under `THIRD_PARTY_NOTICES/`;
- deterministic dependency-license evidence at
  `THIRD_PARTY_NOTICES/python-distributions.json`.

## CUDA 12.4 and T4 execution gate

PyTorch 2.4.1 publishes official Linux wheels for CUDA 12.4. NVIDIA documents
the Tesla T4 as a 16 GB Turing GPU with compute capability 7.5, which is
supported by CUDA 12.x. The Linux target deliberately requires the CUDA 12.4
GA driver floor of 550.54.14 and was validated and published by Gate 8.1. The
Windows target will require the separate Windows GA floor of 551.61. Its
dependency lock and redistribution audit are not approved until the Windows
CPU target closes and the CUDA recipe is reviewed.

## Sources

- [Pinned Geneformer repository and assets](https://huggingface.co/ctheodoris/Geneformer/tree/04c2b2e84da7c0f385c3f9ad8f3ec24bab6650e5)
- [Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0)
- [Apache redistribution FAQ](https://www.apache.org/foundation/license-faq.html)
- [PyTorch 2.4.1 CPU and CUDA 12.4 wheels](https://docs.pytorch.org/get-started/previous-versions/)
- [uv managed Python platforms](https://docs.astral.sh/uv/concepts/python-versions/)
- [uv PyTorch backend selection](https://docs.astral.sh/uv/guides/integration/pytorch/)
- [NVIDIA T4 specifications](https://www.nvidia.com/en-us/data-center/tesla-t4/)
- [NVIDIA CUDA GPU compute capabilities](https://developer.nvidia.com/cuda/gpus)
- [CUDA 12.4 minimum driver versions](https://docs.nvidia.com/cuda/archive/12.4.0/cuda-toolkit-release-notes/index.html)
- [NVIDIA CUDA Toolkit redistribution terms](https://docs.nvidia.com/cuda/eula/index.html)
- [GitHub-hosted T4 runner specifications](https://docs.github.com/en/actions/reference/runners/larger-runners)
- [array-api-compat 1.15 license](https://github.com/data-apis/array-api-compat/blob/1.15/LICENSE)
- [Triton v3.0.0 license](https://github.com/triton-lang/triton/blob/v3.0.0/LICENSE)
