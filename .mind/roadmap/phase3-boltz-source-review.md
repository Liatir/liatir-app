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

## Next gates

First resolution failed before installation: the conda PyTorch solve selected NumPy 2.4.6,
contradicting Boltz's `<2` requirement in the subsequent PyPI solve. The candidate now carries the
same NumPy bound on the conda side. One corrected lock retry is permitted; inspect any new failure
before another attempt. No upstream constraint is loosened.

The corrected attempt passed that conflict but Pixi then failed initializing the source-build
dispatcher because this Linux-only workspace cannot execute on macOS arm64. PyPI confirms that
`fairscale==0.4.13` has only an sdist, not a wheel; conda-forge's Linux builds require PyTorch <1.14,
incompatible with Boltz's >=2.2 requirement. Do not substitute those packages or add a fictitious
macOS CUDA target. Resolve/build source dependencies on a Linux CPU authoring host next; that step
does not need GPU execution. The manifest is intentionally not yet accompanied by a lock or scroll.
[PyPI metadata](https://pypi.org/pypi/fairscale/0.4.13/json),
[conda-forge metadata](https://api.anaconda.org/package/conda-forge/fairscale).

- Resolve and inspect the candidate lock without installing GPU dependencies on this Mac.
  The prepared manual `.github/workflows/phase3-dependency-lock.yml` runs only on `ubuntu-24.04`
  and retains the lock plus an exact source/manifest/hash receipt. It takes a `component` input, so
  Protenix v2 and Mini Default use the same reviewed path instead of copies. No GPU runner,
  model-weight download, production environment or R2 write is part of that workflow. It has not
  been dispatched, and `workflow_dispatch` cannot see it until the file is on the default branch.
  Inspect the returned dependency graph before committing the authored lock.
- Author the complete scroll, bounded offline self-test, legal inventory and product runner.
- Validate local MSA/template content and capture per-run resource estimates and scientific outputs.
- Request separate GPU CI authorization only when the first expensive run is prepared.
- No model weights downloaded, no GPU job launched, no remote write or publication in this review.
