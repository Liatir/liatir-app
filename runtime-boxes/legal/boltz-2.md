# Boltz-2 redistribution record

Verification date: 2026-09-11

## Decision

**Approved.** The code and the model weights are cleanly MIT, every one of the 144 locked
distributions carries a reviewed licence, and both questions that held approval open are answered.

- `frozendict==2.4.7` (LGPL-3.0-or-later) may ship, because it travels as an unmodified,
  replaceable package inside the box's own packed environment with its licence text — and so may the
  sixteen copyleft conda packages beside it, on the same basis and the same precedent as every box
  already published. See
  [Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).
- `mols.tar` is a derivative of the wwPDB **Chemical Component Dictionary**, which the PDB archive
  places in the **public domain under CC0 1.0**. The chain is traced below, from the upstream script
  that built it to the contents of the archive itself.

This is an engineering compliance record, not legal advice.

## Pinned source and artifact identity

- Code repository: `https://github.com/jwohlwend/boltz`
- Source tag `v2.2.1`, exact commit `cb04aeccdd480fd4db707f0bbafde538397fa2ac`, MIT
- Model repository: `https://huggingface.co/boltz-community/boltz-2`
- Exact model revision `6fdef46d763fee7fbb83ca5501ccceff43b85607`, declared `mit`
- Reviewed source revision, exactly as the scroll pins it:
  `cb04aeccdd480fd4db707f0bbafde538397fa2ac+weights-6fdef46d763fee7fbb83ca5501ccceff43b85607`
  (confirmed against the model API on 2026-09-11; the revision is still the repository head)

| Asset | Bytes | SHA-256 |
| --- | ---: | --- |
| `boltz2_conf.ckpt` | 2286561469 | `090e82ac8c92f5e943fa1b39e7410a44027bea7243c0bbb3caa67a77fc1428e1` |
| `boltz2_aff.ckpt` | 2062139170 | `dcc5cd3722b1c9eaa34267e4ae32f55cbbf1963f4c19319381ccfa30fdd2ca9e` |
| `mols.tar` | 1855662080 | `39e076d96dbec6b4e86982bbda16f3a53a2a60c9bdc17828d88f6f9a0c7d1fd7` |

Every download must address that revision, never `main`, and the builder must verify each byte
against these digests rather than trusting the repository's own metadata.

## Dependency licence review

- Recipe: `boltz-2-linux-x86_64-cuda12.9`
- Python `3.11`, pixi `0.73.0`, dependency lock SHA-256
  `f1e4a595010fe5c2d98e103c0b6b77ee8a80408ea80e25c661df29b2c4a1e88f`
- 144 locked distributions: **93 conda, 51 PyPI**

The conda half is derived from the lock, which carries an SPDX licence per package. **The PyPI half
is not in the lock at all** — pixi records no licence for a PyPI distribution, in any version tested
(0.73.0 and 0.77.0 produce identical package sets and zero PyPI licences). It was therefore read
from the distributions themselves: each of the 51 was downloaded, checked against the SHA-256 the
lock pins, and its own `METADATA` or `PKG-INFO` read. The result is
`runtime-boxes/legal/audits/boltz-2-linux-x86_64-cuda12.9-pypi.json`, reproducible with
`scripts/runtime-box/pypi-license-inventory.py`.

| Licence | Distributions |
| --- | ---: |
| BSD-3-Clause | 20 |
| MIT | 14 |
| Apache-2.0 | 9 |
| MPL-2.0 | 2 |
| Apache-2.0 OR BSD-2-Clause | 1 |
| Apache-2.0 OR BSD-3-Clause | 1 |
| **LGPL-3.0-or-later** | **1** |
| LicenseRef-Biopython | 1 |
| MIT-CMU | 1 |
| MPL-2.0 AND MIT | 1 |

Four distributions needed a human reading rather than a machine-readable field:

- **`boltz==2.2.1` declares no licence at all** in its wheel metadata — no `License-Expression`, no
  `License`, no classifier. Its wheel does carry `boltz-2.2.1.dist-info/licenses/LICENSE`, which is
  the MIT text, copyright 2024 Jeremy Wohlwend, Gabriele Corso, Saro Passaro. That file, and the
  repository's own `LICENSE` at the reviewed commit, are what settle it as MIT.
- **`fairscale==0.4.13` declares `License: UNKNOWN`**, with a `BSD License` classifier and bundled
  `LICENSE` and `NOTICE` files from Meta. Recorded as BSD-3-Clause on that basis.
- **`biopython==1.84`** ships the Biopython License Agreement, with some files dual-licensed
  BSD-3-Clause. Recorded as `LicenseRef-Biopython` because no SPDX identifier fits.
- **`python-dateutil==2.9.0.post0`** declares `Dual License`; its classifiers resolve it to
  Apache-2.0 OR BSD-3-Clause.

## Settled: the copyleft dependencies

The complete inventory lists **seventeen GPL-family distributions**, not one. `frozendict==2.4.7`
(LGPL-3.0-or-later) is simply the first that was *visible*, because until the PyPI half could be
inventoried at all the conda half was the only one anyone read.

| Where | Licence | Distributions |
| --- | --- | ---: |
| PyPI | LGPL-3.0-or-later | `frozendict` |
| conda | GPL-3.0-only WITH GCC-exception-3.1 | `libgcc`, `libgcc-ng`, `libstdcxx`, `libstdcxx-ng` |
| conda | GPL-3.0-only | `readline`, `ld_impl_linux-64` |
| conda | GPL-2.0-or-later OR LGPL-3.0-or-later | `gmp` |
| conda | LGPL-3.0-or-later / -only | `gmpy2`, `mpc`, `mpfr` |
| conda | LGPL-2.1-or-later / -only | `libnl`, `libsystemd0`, `libudev1`, `libxcrypt`, `libiconv`, `libnsl` |

Every one of them ships, on the basis the project has been applying since its first published box:
an unmodified, separable component inside the box's own packed environment, carrying its own licence
text, replaceable by anyone who extracts the box. The GCC runtime exception on `libgcc` and
`libstdcxx` exists precisely so that linking against them imposes nothing on the linked work. The
policy and the boundary it draws are in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).

Three non-open-source licence references are also present, and **none is new to this project**:
`LicenseRef-NVIDIA-End-User-License-Agreement` (19 conda packages, the CUDA runtime libraries),
`LicenseRef-cuDNN-Software-License-Agreement` (3), and `LicenseRef-IntelSimplifiedSoftwareOct2022`
(`mkl`, `onemkl-license`). The scGPT and Geneformer CUDA boxes, both already published, carry
**exactly the same 19, 3 and 2** — checked against their audits rather than assumed. Boltz-2 adds no
non-open-source term the project has not already shipped, so its basis is whatever theirs was; if
that basis needs revisiting, it is a question about every CUDA box at once and not about this one.

## Settled: where the molecule dictionary comes from

**`mols.tar` is a derivative of the wwPDB Chemical Component Dictionary**, and that dictionary is
public-domain data. It carries no separate licence statement of its own because it needs none: the
input is CC0, and the packager redistributes the derived form under the model repository's `mit`.

The chain was traced rather than assumed, in three steps:

1. **The upstream script says so.** `scripts/process/ccd.py` at the reviewed commit takes a
   `--components` file, reads it with `pdbeccdutils.core.ccd_reader.read_pdb_components_file`,
   generates 3D conformers with RDKit ETKDG, computes symmetries, and writes one pickle per
   component. `pdbeccdutils` is PDBe's own reader for exactly one file — the PDB components
   dictionary.
2. **The archive's contents match that description exactly.** The first 6 MB of `mols.tar` were
   listed without downloading the rest: every member is `mols/<id>.pkl`, where `<id>` is a PDB
   chemical component identifier — three characters (`T9E`, `L7A`, `CNH`) or the newer five
   (`A1BFJ`). There is no other kind of entry, and no metadata file claiming another origin.
   The complete listing is re-checked at build time; see the self-test below.
3. **That dictionary is part of the PDB archive.** It is published at
   `https://files.wwpdb.org/pub/pdb/data/monomers/components.cif.gz` — verified reachable on
   2026-09-11, 118,929,769 bytes — inside the `/pub/pdb/` archive tree, and updated with each weekly
   PDB release. The wwPDB usage policy states that "data files contained in the PDB archive are
   available under the CC0 1.0 Universal (CC0 1.0) Public Domain Dedication".

CC0 places no condition on redistribution, modification or relicensing of the derived form. Neither
tool in the chain adds one: `pdbeccdutils` is Apache-2.0 and RDKit is BSD-3-Clause, and both are
permissive licences over the *software*, not over what it computes.

wwPDB asks that the original authors of structure data be attributed where possible, which is a
request rather than a condition. The box answers it by naming the dictionary and its source in this
record, which ships inside the box as `THIRD_PARTY_NOTICES/boltz-2.md`.

One boundary worth stating: this covers the chemical component definitions Boltz bundles. It does
not extend to any PDB *structure* a user later supplies as a template — that file is the user's
input, is never redistributed by Liatir, and carries whatever terms its own depositor set.

## Sources

- [Boltz source licence at the reviewed commit](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/LICENSE)
- [Boltz-2 model repository](https://huggingface.co/boltz-community/boltz-2/tree/6fdef46d763fee7fbb83ca5501ccceff43b85607)
- [The script that builds the molecule dictionary](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/scripts/process/ccd.py)
- [wwPDB usage policies](https://www.wwpdb.org/about/usage-policies) — PDB archive data is CC0 1.0
- [The Chemical Component Dictionary and where it is published](https://www.wwpdb.org/data/ccd)
- [frozendict licence](https://github.com/Marco-Sulla/python-frozendict/blob/master/LICENSE.txt)
- [Biopython licence agreement](https://github.com/biopython/biopython/blob/master/LICENSE.rst)
