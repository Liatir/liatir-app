# Protenix base v1.0.0 redistribution record

Verification date: 2026-09-12

## Decision

**Approved.** Code and model parameters are both Apache-2.0 by upstream's own statement, the
bundled chemical data is public-domain PDB material, and every one of the locked distributions
carries a reviewed licence.

This is an engineering compliance record, not legal advice.

## Pinned source and artifact identity

- Code repository: `https://github.com/bytedance/Protenix`
- Reviewed source revision `2475421477ab414b571149ad4a875c390ff8a35d`, Apache-2.0
- Reviewed source revision, exactly as the scroll pins it:
  `2475421477ab414b571149ad4a875c390ff8a35d+weights-protenix_base_default_v1.0.0`
- Package: `protenix==2.0.0`, taken from its published PyPI wheel rather than from a git checkout,
  so every byte the box installs is pinned by SHA-256
- Model: `protenix_base_default_v1.0.0`, 368.48 M parameters, the largest publicly available
  Protenix checkpoint and the CLI's own default

The `protenix-v2` checkpoint is **not** in this box and is not a substitute for what is: ByteDance
withholds it pending an internal review, and the two are separate components. See
[Protenix ships as base v1.0.0](../../.context/decisions/protenix-ships-v1-while-v2-waits.md).

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `checkpoint/protenix_base_default_v1.0.0.pt` | 1,475,950,125 | `2b7d5a8b30494514fc47fd2271a16260528cdba170ba09cc112fdecd8f85ec04` |
| `common/components.cif` | 490,777,362 | `bb31ae5cf6c8bc669924313077cb4231ee5ffefd3a20118cd14f3ec89f8bb6a5` |
| `common/components.cif.rdkit_mol.pkl` | 142,498,117 | `d1cfb71f5993a3ebea7c47877022d7f597bbfbaf86e28a4770e957da6c50cd35` |
| `common/clusters-by-entity-40.txt` | 21,699,572 | `1ab4af905e75b382eda8dec59917dc3608bee0729e36b9e71baf860bbe86850c` |
| `common/obsolete_release_date.csv` | 134,716 | `a4f3f63ac5d7eebd78b07995cc669b9eccd6f5d8813c9492c9df02868893cf33` |

Upstream publishes no digest for any of these, so each was downloaded from official ByteDance
storage and hashed here. Every advertised size matched the bytes received.

## Code and model weights

Upstream states it in one sentence, and it covers both halves:

> The Protenix project including both code and model parameters is released under the Apache 2.0
> License. It is free for both academic research and commercial use.

Apache-2.0 permits redistribution provided the licence and notices travel with the work, which the
box does: the package's own `LICENSE` stays inside the packed environment, and this record ships as
`THIRD_PARTY_NOTICES/protenix-base-v1-0-0.md`.

## The bundled chemical data

`components.cif` is the wwPDB **Chemical Component Dictionary**, and
`components.cif.rdkit_mol.pkl` is that same dictionary precomputed into RDKit molecules. The PDB
archive places its data in the public domain under **CC0 1.0**, so redistribution carries no
condition. The provenance chain is the one established for Boltz-2, which bundles the same
dictionary in a different form — see
[the Boltz-2 record](./boltz-2.md#settled-where-the-molecule-dictionary-comes-from).

`clusters-by-entity-40.txt` and `obsolete_release_date.csv` are likewise derived from PDB archive
metadata: entity clusters at 40 % identity, and the release dates of superseded entries.

## Dependency licence review

- Python `3.11`, pixi `0.73.0`
- 24 conda and **116 PyPI** distributions, every one reviewed

The PyPI half is not in the lock — pixi records no licence for a PyPI distribution — so it was read
from the distributions themselves: each downloaded, checked against the SHA-256 the lock pins, and
its own metadata parsed. The result is
`runtime-boxes/legal/audits/protenix-base-v1-0-0-linux-x86_64-cuda12.9-pypi.json`, reproducible with
`scripts/runtime-box/pypi-license-inventory.py`.

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

Three entries needed a human reading rather than a machine-readable field:

- **The NVIDIA CUDA wheels declare only `NVIDIA Proprietary Software`**, which identifies nothing,
  while shipping two different agreements. The identifier is therefore taken from the first line of
  the agreement each wheel actually carries: the **CUDA Toolkit EULA** for the ten runtime
  libraries, and the **SDK License Agreement** for `nvidia-cudnn-cu12` and `nvidia-cusparselt-cu12`.
  That is the same split conda-forge records, so the same library carries the same term whichever
  channel a box took it from.
- **`matplotlib==3.10.5`** is recorded as `LicenseRef-Matplotlib`, not the `PSF-2.0` its classifier
  implies: its agreement is derived from the PSF licence and is not it.
- **The cuEquivariance family declares nothing at all** and splits two ways once opened. See below.

## Open point: two proprietary libraries this box does not use

`cuequivariance-ops-cu12` and `cuequivariance-ops-torch-cu12` are **closed-source NVIDIA kernels**,
and **Protenix never imports `cuequivariance`** — not once across 145 Python files at the reviewed
commit. They reach the box only because `requirements.txt` lists them and `setup.py` reads that file
verbatim into `install_requires`, so any resolver must satisfy them.

They are also not used at run time: Protenix's `--trimul_kernel` and `--triatt_kernel` default to
`cuequivariance`, and the product runner sets both to `torch` instead, which is the pure-PyTorch
implementation of the same operations.

So the box carries a redistribution obligation for two libraries nothing calls. That is disclosed
here rather than quietly absorbed, and it is worth raising upstream: the right fix is for Protenix
to move those pins into an optional extra, as Boltz already does.

The Python halves of the same family, `cuequivariance` and `cuequivariance-torch`, are Apache-2.0.

## Sources

- [Protenix licence at the reviewed commit](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/LICENSE)
- [Upstream's statement that code and model parameters are both Apache-2.0](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/README.md)
- [Supported models and their parameter counts](https://github.com/bytedance/Protenix/blob/2475421477ab414b571149ad4a875c390ff8a35d/docs/supported_models.md)
- [wwPDB usage policies](https://www.wwpdb.org/about/usage-policies) — PDB archive data is CC0 1.0
