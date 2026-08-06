# UCE 4-layer redistribution audit

Verification date: 2026-07-13

This record is the legal and dependency gate for a future UCE 4-layer Runtime
Box. It does not claim that a Runtime Box has been built or published.

## Decision

UCE 4-layer is eligible for redistribution provided that the Runtime Box keeps
all upstream license, copyright, attribution, and third-party notice files.
The packaged Python environment must also keep the shipped source for LGPL and
MPL components. No proprietary, non-commercial, or redistribution-prohibited
dependency was found in the resolved macOS arm64 Python graph.

This is an engineering compliance record, not legal advice. Any dependency or
artifact change requires a new audit.

## Independently licensed components

| Component | Version | License | Official source and attribution |
| --- | --- | --- | --- |
| UCE source code | `8ead6e07af0c80f75653598138bb704e865b45c8` | MIT | [Pinned source](https://github.com/snap-stanford/UCE/tree/8ead6e07af0c80f75653598138bb704e865b45c8). Copyright (c) 2023 Yanay Rosen, Yusuf Roohani, Jure Leskovec. |
| UCE model assets | Figshare item 24320806, version 5 | CC BY 4.0 | Roohani, Yusuf (2023). Universal Cell Embedding Model Files. figshare. Dataset. <https://doi.org/10.6084/m9.figshare.24320806.v5>. |
| Standalone Python | CPython 3.11.9 | PSF License Version 2 and bundled third-party terms | Preserve the Python license and all bundled notices from the exact runtime artifact selected by the Runtime Box recipe. |

The pinned UCE revision remains deliberate: the current upstream revision
`9c416007be15ad6753dc84af4468c1dc10421ab9` changes the README citation only;
the license, requirements, and inference sources are unchanged.

## Model asset provenance

All five files were streamed independently from the official Figshare record.
The observed byte size and MD5 matched the Figshare API metadata, and SHA-256
was computed locally without retaining an unverified copy. Total compressed
asset size is 9,122,228,658 bytes (about 8.496 GiB).

| Figshare file ID | File | Size in bytes | MD5 | SHA-256 |
| --- | --- | ---: | --- | --- |
| 42706555 | `species_offsets.pkl` | 139 | `ddf9143508857e62607f323b338ff383` | `abda5b2bc4018187e408623b292686a061912f449daceb4c9c9603caf0d62538` |
| 42706558 | `species_chrom.csv` | 4,097,781 | `42a9b5871b1ed955fd05414b3ab89081` | `a9e801829ffaf05b5d7e6c6ef12404326cf6796ad561ad62ce701884f07969f5` |
| 42706576 | `4layer_model.torch` | 3,403,514,339 | `3e2f59d6da6eaa5396aa297edfcec08f` | `acb28f3f0a1d803e4a4ffe891b9bab38bf93c84762dc06b2452f0d515da91560` |
| 42706585 | `all_tokens.torch` | 2,979,205,876 | `3523ea431c403f95701b6eeb0c30b997` | `07397ab3828502fb7d0bab658125c47f145f989f384db8f55fe106f6826b2a54` |
| 42715213 | `protein_embeddings.tar.gz` | 2,735,410,523 | `6756d7fa8348e0f70b5e5b11e324f023` | `dc0138b50a3238979e32ccb65caab4e3f99d49146b8bc3b975f79683d9ce9ec9` |

## Dependency audit method

The official pinned `requirements.txt` was resolved on macOS arm64 for CPython
3.11 with `uv 0.11.28`. The resulting 65-package hash-generated audit lock had
SHA-256 `d9c187f10851aac43d609029a2470f1672d5a0036922d5cf2d9a23c7e728558d`.
The graph was installed into an isolated CPython 3.11.9 environment and its
imports were exercised. The final Runtime Box recipe must regenerate and
commit its own immutable lock; this audit hash is evidence, not the recipe
lock.

PyPI metadata was checked for every resolved distribution. Where metadata was
missing or ambiguous, the license files embedded in the wheel were inspected.
In particular, `google-crc32c` is Apache-2.0 and `scverse-misc` is
BSD-3-Clause.

| Package | Version | License |
| --- | --- | --- |
| accelerate | 0.24.0 | Apache-2.0 |
| anndata | 0.12.19 | BSD-3-Clause |
| anyio | 4.14.2 | MIT |
| array-api-compat | 1.15.0 | MIT |
| certifi | 2026.6.17 | MPL-2.0 |
| chardet | 4.0.0 | LGPL-2.1-or-later |
| click | 8.4.2 | BSD-3-Clause |
| contourpy | 1.3.3 | BSD-3-Clause |
| cycler | 0.12.1 | BSD-3-Clause |
| donfig | 0.8.1.post1 | MIT |
| filelock | 3.29.7 | MIT |
| fonttools | 4.63.0 | MIT and bundled third-party terms |
| fsspec | 2026.6.0 | BSD-3-Clause |
| google-crc32c | 1.8.0 | Apache-2.0 |
| h11 | 0.16.0 | MIT |
| h5py | 3.16.0 | BSD-3-Clause and bundled third-party terms |
| hf-xet | 1.5.1 | Apache-2.0 |
| httpcore | 1.0.9 | BSD-3-Clause |
| httpx | 0.28.1 | BSD-3-Clause |
| huggingface-hub | 1.23.0 | Apache-2.0 |
| idna | 2.10 | BSD-3-Clause-like |
| jinja2 | 3.1.6 | BSD-3-Clause |
| joblib | 1.5.3 | BSD-3-Clause |
| kiwisolver | 1.5.0 | BSD-3-Clause |
| legacy-api-wrap | 1.5 | MPL-2.0 |
| llvmlite | 0.48.0 | BSD-2-Clause AND Apache-2.0 WITH LLVM-exception |
| markupsafe | 3.0.3 | BSD-3-Clause |
| matplotlib | 3.11.0 | PSF-based license |
| mpmath | 1.3.0 | BSD-3-Clause |
| narwhals | 2.23.0 | MIT |
| natsort | 8.4.0 | MIT |
| networkx | 3.6.1 | BSD-3-Clause |
| numba | 0.66.0 | BSD |
| numcodecs | 0.16.5 | MIT and bundled third-party terms |
| numpy | 1.26.4 | BSD-3-Clause and bundled third-party terms |
| packaging | 26.2 | Apache-2.0 OR BSD-2-Clause |
| pandas | 2.2.2 | BSD-3-Clause |
| patsy | 1.0.2 | BSD-2-Clause |
| pillow | 12.3.0 | MIT-CMU |
| psutil | 7.2.2 | BSD-3-Clause |
| pynndescent | 0.6.0 | BSD-2-Clause |
| pyparsing | 3.3.2 | MIT |
| python-dateutil | 2.9.0.post0 | Apache-2.0 OR BSD-3-Clause |
| pytz | 2026.2 | MIT |
| pyyaml | 6.0.3 | MIT |
| requests | 2.25.1 | Apache-2.0 |
| scanpy | 1.10.2 | BSD-3-Clause |
| scikit-learn | 1.9.0 | BSD-3-Clause |
| scipy | 1.14.1 | BSD-3-Clause and bundled third-party terms |
| scverse-misc | 0.0.3 | BSD-3-Clause |
| seaborn | 0.13.2 | BSD-3-Clause |
| session-info | 1.0.1 | BSD-3-Clause |
| session-info2 | 0.4.1 | MPL-2.0 |
| six | 1.17.0 | MIT |
| statsmodels | 0.14.6 | BSD-3-Clause |
| stdlib-list | 0.12.0 | MIT |
| sympy | 1.14.0 | BSD-3-Clause |
| threadpoolctl | 3.6.0 | BSD-3-Clause |
| torch | 2.1.1 | BSD-3-Clause and bundled NOTICE terms |
| tqdm | 4.66.5 | MPL-2.0 AND MIT |
| typing-extensions | 4.16.0 | PSF-2.0 |
| tzdata | 2026.3 | Apache-2.0 |
| umap-learn | 0.5.12 | BSD-3-Clause |
| urllib3 | 1.26.6 | MIT |
| zarr | 3.1.5 | MIT |

## Packaging obligations

- Include the pinned UCE MIT license and copyright notice.
- Include the CC BY 4.0 terms, Figshare attribution, DOI, item version, and a
  statement of any changes to the model assets.
- Preserve every Python distribution's `.dist-info` license files plus bundled
  `LICENSE`, `COPYING`, `NOTICE`, and third-party notice files.
- Preserve the distributed source and applicable license terms for `chardet`,
  `certifi`, `legacy-api-wrap`, `session-info2`, and `tqdm`; do not prune them
  as unused metadata.
- Preserve CPython's PSF license and bundled third-party notices.
- Re-run this audit if the source revision, Python artifact, resolved dependency
  graph, or any model asset changes.
