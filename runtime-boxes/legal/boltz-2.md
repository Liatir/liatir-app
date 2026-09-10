# Boltz-2 redistribution record

Verification date: 2026-09-11

## Decision

**Not yet approved**, on one remaining question: the redistribution basis of the bundled molecule
dictionary. The code and the model weights are cleanly MIT, and every one of the 144 locked
distributions now carries a reviewed licence.

The copyleft question is answered: `frozendict==2.4.7` (LGPL-3.0-or-later) may ship, because it
travels as an unmodified, replaceable package inside the box's own packed environment with its licence text —
see [Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).

This is an engineering compliance record, not legal advice.

## Pinned source and artifact identity

- Code repository: `https://github.com/jwohlwend/boltz`
- Source tag `v2.2.1`, exact commit `cb04aeccdd480fd4db707f0bbafde538397fa2ac`, MIT
- Model repository: `https://huggingface.co/boltz-community/boltz-2`
- Exact model revision `6fdef46d763fee7fbb83ca5501ccceff43b85607`, declared `mit`
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

## Settled: the one copyleft dependency

`frozendict==2.4.7` is LGPL-3.0-or-later, the only copyleft dependency in the graph, reached
indirectly rather than by Boltz's own choice. It ships. LGPL permits redistribution inside a larger
work provided the licence text travels with it and the user can replace the library, and an
unmodified Python package inside the box's packed environment satisfies both. The policy, and the boundary it
draws, are in
[Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).

## Open question, blocking approval

**The molecule dictionary `mols.tar` has no separate stated licence.** It is 1.86 GB of small
molecule definitions distributed under the model repository's blanket `mit`. The underlying chemical
component data originates upstream of Boltz, and the repository does not say where. Redistributing
it inside a Liatir box needs that provenance established, not assumed from the repository tag.

## Sources

- [Boltz source licence at the reviewed commit](https://github.com/jwohlwend/boltz/blob/cb04aeccdd480fd4db707f0bbafde538397fa2ac/LICENSE)
- [Boltz-2 model repository](https://huggingface.co/boltz-community/boltz-2/tree/6fdef46d763fee7fbb83ca5501ccceff43b85607)
- [frozendict licence](https://github.com/Marco-Sulla/python-frozendict/blob/master/LICENSE.txt)
- [Biopython licence agreement](https://github.com/biopython/biopython/blob/master/LICENSE.rst)
