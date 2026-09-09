# Boltz-2 candidate source review

Checked 2026-09-06. This records authoring inputs, not build or release evidence.

- Source tag `v2.2.1` resolves to commit `cb04aeccdd480fd4db707f0bbafde538397fa2ac`.
  [Official tag API](https://api.github.com/repos/jwohlwend/boltz/git/ref/tags/v2.2.1).
- The official package requires Python >=3.10,<3.13, PyTorch >=2.2 and NumPy >=1.26,<2;
  its remaining direct requirements are pinned by upstream or resolved in the candidate Pixi lock.
  [Package definition](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/pyproject.toml).
- Candidate dependency resolution: Python 3.11, PyTorch 2.8.0 CUDA 12.9 on Linux x86_64,
  Pixi 0.73.0. This is not yet a measured compatibility claim. Optional cuEquivariance kernels
  are not enabled; any later enablement requires its own parity and hardware evidence.
- Upstream code is MIT. The upstream-linked model repository declares MIT, but the complete
  molecule dictionary and dependency redistribution review remains open.
  [Source license](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/LICENSE).

## Immutable model inputs

The public model API reported repository revision `6fdef46d763fee7fbb83ca5501ccceff43b85607`.
All download URLs must use that revision, never `main`. Values below are LFS metadata, not hashes
of bytes downloaded locally; the box builder must independently verify every downloaded byte.
[Metadata source](https://huggingface.co/api/models/boltz-community/boltz-2?blobs=true).

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `boltz2_conf.ckpt` | 2286561469 | `090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1` |
| `boltz2_aff.ckpt` | 2062139170 | `dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e` |
| `mols.tar` | 1855662080 | `39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7` |

Both checkpoints and the molecule dictionary are mandatory. The stock `download_boltz2` checks
for `mols.tar` even when the extracted `mols` directory exists. The product runner must instead
validate the bundled assets and refuse missing data without invoking this download path. Extraction
belongs in authoring, with traversal/symlink checks, not in an installed runtime's prediction run.
[Exact download implementation](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/src/boltz/main.py#L185).

## The lock is resolved (2026-09-08)

`runtime-boxes/scrolls/boltz-2/linux-x86_64-cuda12.9/pixi.lock` exists. This is the first time any
Phase 3 AI Model has passed dependency resolution, and it closes the macOS blocker below.

Resolved on the maintainer's Windows 11 host inside WSL2 — Ubuntu 26.04 LTS, `x86_64`, pixi 0.73.0
from the official installer — using the same two commands as
`.github/workflows/phase3-dependency-lock.yml`: `pixi lock` then `pixi lock --check`, which reported
the lock already up to date. Running locally on a Linux host is not CI; no workflow was dispatched.

| Artifact | SHA-256 |
| --- | --- |
| `pixi.toml` | `9a9ce69316b8b122288bfca10d4c397ca7bf096b5c2c64b05e088690cdacc6ec` |
| `pixi.lock` | `f1e4a595010fe5c2d98e103c0b6b77ee8a80408ea80e25c661df29b2c4a1e88f` |

Resolution only. Nothing was installed, no model weight was downloaded, no GPU job ran, and no
upstream constraint was loosened — the manifest is byte-identical to the reviewed candidate.

### What the dependency graph actually contains

Inspected before the lock was placed in the repository:

- **`fairscale==0.4.13` resolves from its sdist**, `sha256:1b797825c427f5dba92253fd0d8daa574e8bd651a2423497775fab1b30cfb768`.
  This is the exact package that made resolution impossible on macOS arm64.
- The environment is `linux-64` only, with virtual package `__cuda=12.9`. PyTorch is
  `2.8.0 cuda129_mkl_py311`, Triton `3.4.0 cuda129py311`, NumPy `1.26.4` — Boltz's `numpy<2.0`
  requirement is respected on both the conda and the PyPI side.
- Four source distributions in total: `fairscale`, `antlr4-python3-runtime`, `ihm`, `modelcif`.
  Every entry, sdist or wheel, carries a pinned SHA-256. There is **no** Git or bare-URL dependency.
- Boltz's optional `cuda` extra (`cuequivariance-*`) is correctly **not** selected, matching the
  decision to leave those kernels off until they have their own parity evidence.

Three findings that the runner and the legal inventory have to answer, recorded now so they are not
rediscovered later:

1. **`wandb==0.18.7` and `sentry-sdk==2.69.1` are hard requirements of Boltz**, not optional extras.
   They are a training-telemetry stack and an error-reporting client. The product runner must
   neutralise them explicitly (offline mode plus the already-required process-level network denial),
   and both need entries in the licence inventory.
2. **`pandas` is the one loose upstream bound**: Boltz declares `pandas>=2.2.2`, so the resolver
   selected `pandas 3.0.5`, a major version released after Boltz 2.2.1. This may or may not break at
   runtime. The correct order is to let the offline self-test find out, then pin inside the declared
   range only if it actually fails — never before.
3. Pixi warned that `fsspec==2026.7.0` has no `http` extra, requested by `pytorch-lightning`. The
   consequence is that `aiohttp` is absent, so no remote-filesystem path exists. Harmless, and
   aligned with an offline box, but it is a real difference from a stock Boltz install.

## Next gates

- Author the complete scroll: assets pinned to the SHA-256 values above, bounded offline self-test,
  legal record with the source revision, and the licence inventory.
- Build the box locally with a development key, then `verify --self-test`.
- Only then: product runner, scientific validator, real inputs, and RAM/VRAM/time measurements.
- Request separate GPU CI authorization only when the first expensive remote run is prepared.
- No model weights downloaded, no GPU job launched, no remote write or publication so far.

### Superseded: why this could not be done before

First resolution failed before installation: the conda PyTorch solve selected NumPy 2.4.6,
contradicting Boltz's `<2` requirement in the subsequent PyPI solve. The candidate now carries the
same NumPy bound on the conda side.

The corrected attempt passed that conflict but Pixi then failed initializing the source-build
dispatcher because this Linux-only workspace cannot execute on macOS arm64. PyPI confirms that
`fairscale==0.4.13` has only an sdist, not a wheel; conda-forge's Linux builds require PyTorch <1.14,
incompatible with Boltz's >=2.2 requirement. That is the blocker the WSL2 run above cleared.
[PyPI metadata](https://pypi.org/pypi/fairscale/0.4.13/json),
[conda-forge metadata](https://api.anaconda.org/package/conda-forge/fairscale).
