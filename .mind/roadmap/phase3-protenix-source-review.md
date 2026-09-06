# Protenix v2 and Mini Default candidate source review

Reviewed 2026-09-06 from source commit `2475421477ab414b571149ad4a875c390ff8a35d`.
These are authoring inputs, not a built or distributable Runtime Box. The product remains hidden.

## Separate identities and payloads

Both components use the Protenix 2.0.0 Python package, with separate candidate manifests and asset
lists under `runtime-boxes/scrolls/protenix-v2/` and
`runtime-boxes/scrolls/protenix-mini-default-v0-5-0/`. Neither installs the other's checkpoint.
The [official release](https://github.com/bytedance/Protenix/releases/tag/v2.0.0) identifies the
reviewed source revision. Package dependencies come from the exact source, not a mutable branch.

| Component | Exact upstream model | Recycles | Diffusion steps | Templates | ESM weights |
| --- | --- | ---: | ---: | --- | --- |
| Protenix v2 | `protenix-v2` | 10 | 200 | Local HHR/A3M search files plus referenced structures | None |
| Protenix Mini Default v0.5.0 | `protenix_mini_default_v0.5.0` | 4 | 5 | Unsupported | None |

Sources: [model definitions](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/configs/configs_model_type.py),
[model documentation](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/docs/supported_models.md).
The shared base configuration has `esm.enable = false`. Mini Default does not override it.
Upstream includes the small `fair-esm==2.0.0` Python library as a package dependency; this is not the
ESM2-3B model payload and does not authorize downloading that payload. The loader downloads ESM/ISM
weights only for the explicitly named ESM/ISM model variants, which are outside both candidate lists.
Mini's source configuration defaults `load_strict` to false with an inference-specific comment;
the product must explicitly select true and verify the complete checkpoint architecture.

## Exact offline dependencies

The [requirements](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/requirements.txt)
pin Torch 2.7.1, torchvision 0.22.1, torchaudio 2.7.1, NumPy 2.4.1, cuEquivariance 0.8.0,
DeepSpeed 0.17.5 and Triton 3.3.1, among other dependencies. The package requires Python >=3.11.
Conda-forge's [2.7.1 release inventory](https://api.anaconda.org/release/conda-forge/pytorch/2.7.1)
contains Linux `cuda129` builds, so both candidate manifests retain the agreed CUDA 12.9 identity.
This is source availability only: the full solve, ABI checks and GPU scientific evidence remain open.
Do not loosen upstream constraints to obtain a lock. Resolve source-build dependencies on Linux.

The [inference loader](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/runner/inference.py)
can download caches automatically. The product runner must set `PROTENIX_ROOT_DIR` to its own
installed model cache, verify every required asset before constructing the model, and deny network
access in parent and child processes. `use_msa` and `use_template` must follow the user's local inputs;
they must not invoke the batch CLI's online search path. Template search hits require actual local
structure files as well as the HHR/A3M file: a filename alone does not prove offline readiness.
The v2 runner checks 2560 tokens, but this upstream ceiling is not a measured Liatir hardware profile.

## Asset availability and integrity gate

The pinned [URL inventory](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/protenix/web_service/dependency_url.py)
points to official ByteDance storage. HEAD requests on this host reported:

| Asset | Response | Advertised bytes |
| --- | --- | ---: |
| `checkpoint/protenix-v2.pt` | HTTP 403 Forbidden | Unknown |
| `checkpoint/protenix_mini_default_v0.5.0.pt` | HTTP 200 | 537049294 |
| `common/components.cif` | HTTP 200 | 490777362 |
| `common/components.cif.rdkit_mol.pkl` | HTTP 200 | 142498117 |
| `common/clusters-by-entity-40.txt` | HTTP 200 | 21699572 |
| `common/obsolete_release_date.csv` | HTTP 200 | 134716 |
| `common/obsolete_to_successor.json` (v2 templates) | HTTP 200 | 86882 |
| `common/release_date_cache.json` (v2 templates) | HTTP 200 | 12754898 |

A bounded GET requesting one byte of v2 also returned HTTP 403. No weights were downloaded.
The public headers supply no SHA-256. Candidate hashes remain explicitly null; these files cannot
be used as Scrollcase assets until official bytes are obtained, hashed and independently checked.
A community mirror was found but was not adopted as an authoritative source. Full redistribution
review for source, model weights, dictionary data and the complete locked environment remains open;
the upstream source LICENSE is Apache-2.0 and separately attributes reused LayerNorm/OpenFold code.

## Next bounded steps

1. Resolve and audit each Linux environment, without a GPU or model weights. The shared manual
   `.github/workflows/phase3-dependency-lock.yml` resolves `protenix-v2` and
   `protenix-mini-default-v0-5-0` on `ubuntu-24.04` from the pinned commit; it has not been
   dispatched, and needs the file on the default branch before it can be.
2. Obtain reachable official v2 bytes or an upstream-authenticated mirror and pin asset hashes.
3. Prepare verified offline asset packaging, strict checkpoint self-tests and full legal records.
4. Implement runners, local input inspection and output validation before requesting GPU approval.
5. Run measured scientific and native product gates on each intended target before publication.

Any R2 source mirroring or Runtime Box publication must occur exclusively through reviewed GitHub
Actions from clean committed bytes, using production signing for release. No Phase 3 workflow was
dispatched during this review.
