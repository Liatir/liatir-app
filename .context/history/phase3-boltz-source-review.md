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
- Boltz's optional `cuda` extra (`cuequivariance-*`) is **not** selected, matching the decision to
  leave those kernels off until they have their own parity evidence.
  **Corrected 2026-09-11: not selecting the extra is not enough.** Boltz's CUDA path imports
  `cuequivariance_torch` unless `--no_kernels` is passed, so the first real prediction died on
  `ModuleNotFoundError: No module named 'cuequivariance_torch'` inside
  `boltz/model/layers/triangular_mult.py`. That file keeps a pure PyTorch implementation of the same
  triangular multiplication for exactly this case, and the product runner passes the flag. An
  "optional" extra that the default GPU path requires is a trap only a real run finds.

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

## The licence inventory exists, and it exposed a blocker (2026-09-11)

**Every one of the 144 locked distributions now has a reviewed licence**, and the legal record is
`runtime-boxes/legal/boltz-2.md`. Getting there uncovered a structural blocker that stops Boltz-2,
Protenix v2 and Protenix Mini alike, because all three are the project's only recipes with
`[pypi-dependencies]`; every published box to date is pure conda.

**pixi records an SPDX licence for a conda package and nothing at all for a PyPI one.** Boltz's lock
has 93 conda and 51 PyPI entries, and the PyPI entries carry only name, version, sha256,
`requires_dist` and `requires_python`. Verified against pixi 0.73.0 and 0.77.0: both resolve the
same package set and both record zero PyPI licences.

Scrollcase derives the box's licence inventory from the lock and **refuses to ship a package whose
licence it cannot name** — `lockedCondaDistributions` throws `<name>==<version> lacks a declared
license in pixi.lock`. That refusal is correct; the problem is that for PyPI there is nothing in the
lock to read. Checked in the installed `scrollcase@0.8.0` and in `scrollcase@1.0.0`: identical, and
1.0.0's new *declared* inventory covers dependencies compiled into shipped binaries (`linkedInto`
payload files), not PyPI distributions. **No released Scrollcase can build a box whose lock contains
a PyPI package.** No catalog entry can be added either, because `validatePixiRecipeLockAndAudit`
requires an audit whose package set equals what that same function returns.

The licences themselves were therefore read from the distributions the lock already pins:
downloaded, checked against the pinned SHA-256, and their own `METADATA` or `PKG-INFO` parsed, by
`scripts/runtime-box/pypi-license-inventory.py` into
`runtime-boxes/legal/audits/boltz-2-linux-x86_64-cuda12.9-pypi.json`. That file is the input any fix
needs, whichever side it lands on.

Two findings from it block legal approval on their own, and both are in the legal record:
`frozendict==2.4.7` is **LGPL-3.0-or-later**, the first copyleft dependency the project has met; and
`mols.tar`, 1.86 GB of molecule definitions, has no licence of its own beyond the model
repository's blanket `mit`, with its upstream provenance unstated.

`boltz==2.2.1` also declares no licence in its wheel metadata at all; the MIT text inside the wheel
and the repository `LICENSE` settle it, and `fairscale==0.4.13` declares `UNKNOWN` against a
`BSD License` classifier.

## Both legal questions are answered, and the box is built (2026-09-11)

**The redistribution record is approved.** `mols.tar` is a derivative of the wwPDB **Chemical
Component Dictionary**, which the PDB archive places under **CC0 1.0**. Traced rather than assumed:
upstream's `scripts/process/ccd.py` reads a PDB components file through `pdbeccdutils` and writes one
pickle per component; the archive's own members are exactly `mols/<CCD id>.pkl`; and the dictionary
is published inside the `/pub/pdb/` archive tree the CC0 policy covers. Details and sources are in
[the legal record](../../runtime-boxes/legal/boltz-2.md).

**A claim in that record was wrong and is corrected**: `frozendict` was not the project's first
copyleft dependency. The complete inventory has **seventeen** GPL-family distributions, sixteen of
them conda packages that every published box already carries. What was new is that it was the first
one anyone could *see*, because the PyPI half of a lock had no licences until `scrollcase@1.1.0`.

**The licence inventory is complete** — 144 distributions, 93 conda and 51 PyPI, the PyPI half
marked `licenseDeclaredBy: project` so a reader can tell derived from declared. This is the first
Liatir box with PyPI dependencies to produce one at all.

**The box builds and passes its own self-test**, on this machine inside WSL2 with a development key:

```json
{"boltzVersion": "2.2.1", "cudaVersion": "12.9", "downloadPathReplaced": true,
 "moleculeDefinitions": 45227, "networkAccess": false, "numpyVersion": "1.26.4",
 "pandasVersion": "3.0.5", "status": "passed", "torchVersion": "2.8.0"}
```

Two of the three open findings from the dependency review are settled by that line. **`pandas 3.0.5`
works with Boltz 2.2.1** — the one loose upstream bound, left for the self-test to answer rather than
pinned pre-emptively, and the self-test imports the whole CLI the way a real run does. And **the
telemetry stack is neutralised**: `WANDB_MODE=disabled` is asserted, not hoped for.

The molecule dictionary expands to **45,227 pickles**, every one named by a PDB chemical component
identifier and nothing else — which is the legal claim above, checked at build time rather than
asserted once in a document.

The archive is **12,688,668,518 bytes**, 20,301,778,253 installed — about 1.6× scGPT's CUDA box,
which is the largest published so far. Independent `runtime-box verify --self-test` passed on a
fresh extraction of the signed release: `Verified boltz-2 2.2.1-beta.1 (linux-x86_64-cuda12.9)`.

One discrepancy worth naming rather than leaving to be discovered: that box was built from scroll
**1.0.0**, and the repository now holds **1.0.1**. The only difference is the wording of the
third-party notice, which the scroll pins by hash; the scroll version was bumped rather than the
edit slipped under the same identity. Since publication requires a rebuild from a clean tree in CI
against the released Scrollcase anyway, the artefact is transient and the repository is what
describes the box that will ship.

### It predicts a real protein, and the number is good

The scientific validator runs the product runner against **PDB 1UBQ** — ubiquitin at 1.8 Å, the most
thoroughly determined small protein there is, and a case where a wrong fold is unmistakable rather
than arguable. The input is the 76-residue sequence and nothing else: **single-sequence mode**,
because an offline box has no alignment server, and that is therefore the accuracy this product can
actually promise.

| Measure | Result |
| --- | --- |
| Backbone RMSD to the experimental structure | **1.99 Å** (limit 3 Å) |
| Largest single CA deviation | 11.5 Å, on the mobile C-terminal tail |
| `complex_plddt` | 0.925 |
| `ptm` | 0.905 |
| Same seed, second run | difference **exactly 0** |
| Same seed, separate validator run | RMSD identical to the last decimal |
| Peak RAM / VRAM | 5,685,682,176 / 2,500,853,760 bytes |
| Time per prediction | ~55 s on an RTX 4060 Ti |

Two refusals passed alongside: an incomplete installation and an empty complex are rejected rather
than answered. VRAM is not the constraint at this size — 2.5 GB of an 8 GB card for 76 tokens — but
that says nothing about a large complex, which has not been measured.

**The evidence is bound to the signed box, not to a directory.** The validator verified the release
signature itself and walked the payload digest before running anything:
`signedPayloadVerified: true`, archive `609a3cc5…`, payload digest `df018405…`, manifest
`fd0f9416…`. Retained as
`runtime-boxes/measurements/boltz-2-linux-x86_64-cuda12.9-development-2026-09-11.json`.
It is **development evidence**: a development key, and a tree that was dirty at build time. A
production build makes a different archive and has to be measured there.

Comparison is by Kabsch superposition on CA atoms, computed inside the box with its own NumPy and
gemmi so the check uses the same numerics as the prediction. The reference is pinned by hash
(`d4a6812d…`) and committed at `runtime-boxes/fixtures/structures/1ubq.pdb`.

### It needed a third Scrollcase fix

`mols.tar` is an **uncompressed** tar, and `assetArchives` accepted only `zip` and `tar.gz`. Fixed
upstream in [PR #14](https://github.com/suffro/scrollcase/pull/14), which also drops a `gzip: true`
that read like a guarantee and was not one — node-tar detects compression itself.

Released as **`scrollcase@1.2.0`**, and Liatir is pinned to it as of 2026-09-12. The box on disk was
built against a local pack of that branch; the scroll now validates against the published package,
so a clean checkout builds it.

### How the download step is replaced rather than suffered

Boltz's `predict` calls `download_boltz2(cache)` unconditionally, and that function fetches
`mols.tar` whenever the archive is absent — which it always is in a box, because carrying 1.86 GB
twice to satisfy an existence check would be absurd. `runtime-boxes/scrolls/boltz-2/boltz_predict.py`
replaces that one function with a check over the bundled cache and leaves everything else upstream's.
`--model boltz1` is refused outright, since this box holds no Boltz-1 weights.

## Next gates

- **Decide where PyPI licences are expressed** — in Scrollcase (recommended: it owns the inventory
  contract) or in a Liatir-side declared inventory. Nothing downstream can start until this is
  settled; see [current status](../state/current.md).
- Answer the two legal questions above.
- Then: author the scroll with the assets pinned to the SHA-256 values above and a bounded offline
  self-test; build locally with a development key; `verify --self-test`.
- Only then: product runner, scientific validator, real inputs, and RAM/VRAM/time measurements.
- No model weights downloaded, no GPU job launched, no remote write or publication so far. The 51
  PyPI distributions were downloaded to read their metadata; they are dependency archives, not
  model weights.

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
