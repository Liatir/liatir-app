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

## Re-checked 2026-09-11: one blocker is upstream's, the other is ours

### v2 is withheld on purpose, and upstream has said so

**Answered 2026-09-12, by ByteDance rather than by inference.** The 403 is not a misconfiguration
and not a transient fault: the checkpoint is deliberately closed while an internal authorisation
runs. Collaborator `@zhangyuxuann` posted the same reply on two issues on 2026-04-09:

> the accessibility of the protenix-v2 checkpoint is currently under review as part of our
> company-level internal evaluation process. We are unable to provide a specific timeline at this
> stage.

Five months on there is no update, and four issues remain open —
[#294](https://github.com/bytedance/Protenix/issues/294),
[#296](https://github.com/bytedance/Protenix/issues/296),
[#309](https://github.com/bytedance/Protenix/issues/309),
[#332](https://github.com/bytedance/Protenix/issues/332).

The restriction is precise rather than broad. Of the **19 URLs `dependency_url.py` publishes, 18
serve and exactly one does not**: the ESM2 3B weights, every other Protenix checkpoint — base,
mini, tiny, both v0.5.0 and v1.0.0 — and all five common data files answer 206 to a ranged request.
Only `checkpoint/protenix-v2.pt` returns `{"Code":"AccessDenied", ... "DetailErrCode":14006}` from
TosServer. `AccessDenied` rather than `NoSuchKey` says the object exists and its permissions forbid
reading, which matches what the collaborator described. The URL on `main` today is byte-identical to
the one at the reviewed commit, so nothing has moved.

**The community mirror is now definitively rejected, on its uploader's own word.** A Hugging Face
copy circulates in #309, and the owner of that repository commented there:

> just be aware I have no affiliation with the Protenix team

Asked directly how they obtained the weights, they did not answer. Redistributing, inside a box
Liatir signs, a file the publisher deliberately withheld — re-uploaded by someone who disclaims
affiliation and will not say where it came from — would be asserting a provenance we cannot show.

**This is not a Liatir blocker to solve.** It is ByteDance's authorisation to finish. The component
waits, and Boltz-2 already covers structure prediction with validated evidence.

### The original observation, and why there is no second source

`checkpoint/protenix-v2.pt` returned **HTTP 403** again, five days after the first observation, while
every other object in the same bucket answered 200 on the same request — `protenix_mini_default_v0.5.0.pt`
(537,049,294 bytes) and `common/components.cif` (490,777,362 bytes) among them. A single object being
refused while its neighbours are served is not an outage or a regional block; that file is not
public.

Nothing authoritative replaces it. ByteDance publishes **no** Protenix weights on Hugging Face and
attaches **no** assets to any GitHub release, `v2.0.0` included — both checked directly through their
APIs. What exists is third-party re-uploads (`TMF001/protenix-v2-weights` and others), and those stay
rejected: a box's provenance claim is only worth the source it names, and we cannot show that
someone else's copy is the file ByteDance built.

**Protenix v2 is blocked on upstream and cannot be unblocked from here.** Either ByteDance makes the
object public, or the component waits.

### Mini does not resolve as written, and the reason is worth keeping

`pixi lock` on the reviewed manifest fails. Three conflicts, all traceable to the same place:

- conda-forge's `torchvision 0.22.1` CUDA builds for **CUDA 13** require `cudnn >=9.13`, which needs
  `cuda-version >=13`; the manifest pins 12.9. A `cuda129_py311` build does exist, so this alone is
  not fatal.
- That build **constrains `numpy <2.4`**, and upstream pins `numpy==2.4.1`. This one is fatal, and it
  is a conda-forge packaging constraint rather than an upstream torchvision requirement.
- The only remaining `torchvision 0.22.1` option is a CPU build, which contradicts `pytorch cuda129*`.

A second attempt — conda `pytorch` plus PyPI `protenix` — failed differently and more clearly:
conda's pytorch pins `numpy==2.4.6` into the PyPI solve, and `protenix==2.0.0` requires
`numpy==2.4.1`. **Conda's PyTorch and Protenix's own pins cannot both be satisfied.**

**What solves**: conda supplies Python and the CUDA virtual package, and the entire scientific stack
comes from PyPI at upstream's exact pins — `torch 2.7.1`, `torchvision 0.22.1`, `torchaudio 2.7.1`,
`numpy 2.4.1`, `deepspeed 0.17.5`, `triton 3.3.1`, `rdkit 2025.9.3`, `protenix 2.0.0`. 24 conda and
116 PyPI entries. **No upstream constraint is loosened** — this is the shape that honours them, and
the conda-first shape is the one that could not.

That makes Mini the first box whose CUDA runtime would come from PyPI's `nvidia-*` wheels rather than
conda-forge. Fifteen of them appear in the lock. It is a real difference from every other box here
and needs its own decision before it is adopted, not a quiet lock commit.

### Two facts about Protenix's requirements that a packager needs

- **`torchvision` and `torchaudio` are never imported.** Across all 145 Python files at the reviewed
  commit there is not one `import torchvision`, and not one mention of either name anywhere. They
  are in `requirements.txt`, `setup.py` reads that file verbatim into `install_requires`, and so a
  resolver must satisfy two libraries the code never touches. `cuequivariance` is the same: pinned in
  requirements, imported nowhere. Dropping them from *our* manifest does not help, because the
  package itself still declares them.
- `deepspeed`, `esm` (`fair-esm`), `biotite` (22 files), `gemmi` and `pdbeccdutils` are genuinely
  imported and must be present.

### Mini's lock is resolved

The manifest now declares what the paragraph above describes, and
`runtime-boxes/scrolls/protenix-mini-default-v0-5-0/linux-x86_64-cuda12.9/pixi.lock` exists.
`pixi lock --check` reports it already up to date, so it is stable rather than merely produced.

| Artifact | SHA-256 |
| --- | --- |
| `pixi.toml` | `b926d7ab5d4943414081f307f530d9450e2c5c040ffa955becd240c9ebe4f141` |
| `pixi.lock` | `87eb4e5b819ef85cbb61e0c75afd13efad378849f56151de6bf1c3e39ff9dc01` |

Resolution only, on this machine inside WSL2 with pixi 0.73.0 — the same pair of commands the manual
authoring workflow runs. Nothing installed, no checkpoint downloaded, no GPU used, no workflow
dispatched. The reasoning behind the shape is in
[Protenix resolves through PyPI](../../decisions/protenix-resolves-through-pypi.md).

### Mini's PyPI licences are all reviewed, and two of them should not be there

All **116** PyPI distributions now carry a reviewed licence, read from the distributions the lock
pins rather than from anyone's summary:

| Licence | Distributions |
| --- | ---: |
| BSD-3-Clause | 41 |
| MIT | 32 |
| Apache-2.0 | 14 |
| **LicenseRef-NVIDIA-CUDA-EULA** | **10** |
| BSD-2-Clause, ISC, MPL-2.0 | 2 each |
| **LicenseRef-NVIDIA-Proprietary** | **2** |
| **LicenseRef-NVIDIA-SDK-License-Agreement** | **2** |
| LGPL-2.1-or-later (`biotraj`) | 1 |
| LicenseRef-Matplotlib | 1 |
| everything else | 1 each |

NVIDIA declares the same uninformative `NVIDIA Proprietary Software` for libraries under two
different agreements, so the identifier is taken from the first line of the agreement each wheel
actually carries: the CUDA Toolkit EULA for the runtime libraries, and the SDK License Agreement for
cuDNN and cuSPARSELt. That is the same split conda-forge records, so the same library carries the
same term whichever channel a box took it from.

**The finding that needs a decision**: `cuequivariance-ops-cu12` and `cuequivariance-ops-torch-cu12`
are **closed-source NVIDIA kernels**, and **Protenix never imports cuequivariance** — not once in
145 files. They reach the box only because `requirements.txt` lists them and `setup.py` reads that
file verbatim. Shipping two proprietary libraries that nothing calls is a redistribution obligation
taken on for no capability, and it is worth raising upstream rather than absorbing.

The Python halves of the same family, `cuequivariance` and `cuequivariance-torch`, are Apache-2.0.
`matplotlib` gets `LicenseRef-Matplotlib` rather than the `PSF-2.0` its classifier implies, because
its agreement is derived from the PSF licence and is not it.

### Mini's assets are downloaded, hashed and pinnable

The published headers carry no digest, so every file was fetched from official ByteDance storage and
hashed here. These are the values a scroll can pin; nothing was taken on trust from a header or a
mirror.

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `checkpoint/protenix_mini_default_v0.5.0.pt` | 537,049,294 | `3803340c5d9958c038e799ddd2b53b532db21855f261592ad455a5f003791f81` |
| `common/components.cif` | 490,777,362 | `bb31ae5cf6c8bc669924313077cb4231ee5ffefd3a20118cd14f3ec89f8bb6a5` |
| `common/components.cif.rdkit_mol.pkl` | 142,498,117 | `d1cfb71f5993a3ebea7c47877022d7f597bbfbaf86e28a4770e957da6c50cd35` |
| `common/clusters-by-entity-40.txt` | 21,699,572 | `1ab4af905e75b382eda8dec59917dc3608bee0729e36b9e71baf860bbe86850c` |
| `common/obsolete_release_date.csv` | 134,716 | `a4f3f63ac5d7eebd78b07995cc669b9eccd6f5d8813c9492c9df02868893cf33` |

Every advertised size matched the bytes actually received. `components.cif` is the same wwPDB
Chemical Component Dictionary that Boltz-2 bundles in a different form, so the CC0 provenance
established in the Boltz legal record, `runtime-boxes/legal/boltz-2.md`, covers it too.

### The target is CUDA 12.6, because that is what the box contains

The first successful build reported its own environment and caught a label that was wrong:

```json
{"torchVersion": "2.7.1+cu126", "cudaVersion": "12.6", "numpyVersion": "2.4.1", "status": "passed"}
```

The scroll said `cuda12.9`. Taking PyTorch from PyPI means the CUDA runtime arrives in the
`nvidia-*` wheels rather than from conda-forge, and those wheels are built against **12.6**. Every
other CUDA box in this project is labelled 12.9 and genuinely contains 12.9; this one would have
been the exception that quietly said otherwise.

The target is therefore **`linux-x86_64-cuda12.6`**, and the pixi manifest's system requirement
matches. Nothing about installation changes: the app gates a CUDA box on
`minNvidiaDriverVersion`, not on this field, and `525.60.13` covers 12.6 as it covers 12.9. What
changes is that the identity a signature vouches for is true. The box had never been published, so
the rename cost a rebuild and nothing else.

### Three defaults a self-contained box has to turn off

Every one of these was found by running the thing, not by reading it, and all three are the same
shape: a model optimised for a workstation its authors control, defaulting to something an
installed, offline, signed box cannot have.

1. **`--use_msa` defaults to True**, and True means Protenix contacts its own alignment server. An
   offline box cannot. Predictions are made without an alignment, which is less accurate, and the
   result says so rather than letting a caller assume otherwise.
2. **`--trimul_kernel` and `--triatt_kernel` default to `cuequivariance`** — the same closed-source
   NVIDIA kernels Boltz reaches for. Both are set to `torch`, the pure-PyTorch implementation of the
   same operations.
3. **`LAYERNORM_TYPE` defaults to `fast_layernorm`**, a CUDA extension Protenix **compiles on first
   use**. The first build failed its self-test on exactly that:

   ```text
   ModuleNotFoundError: No module named 'fast_layer_norm_cuda_v2'
   RuntimeError: Ninja is required to load C++ extensions
   ```

   A packed box carries no compiler, and asking a user's machine to build a CUDA kernel mid-
   prediction would be slow where it worked and baffling where it did not. `LAYERNORM_TYPE=torch` is
   the native implementation, it is read at *import* time so it has to be set before Protenix is
   touched, and it is the value **upstream's own tests set**.

The box declares the third in its scroll `environment`, so it holds however the box is started, and
the self-test and the product runner each set all of what they need explicitly rather than trusting
an inherited variable.

### The git dependency should become a wheel pin

The reviewed manifest takes `protenix` from a pinned git commit. That leaves the **one lock entry
with no SHA-256**: a git revision addresses a tree, but a signed box verifies bytes, and the licence
inventory reads a distribution it can download and hash. `protenix==2.0.0` is published on PyPI as
`protenix-2.0.0-py3-none-any.whl` (517,318 bytes), which removes the exception entirely.

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
