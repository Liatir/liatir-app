# GNINA Tool Runtime

- Runtime identity: `gnina-pose-rescoring` / `gnina-1-3-3`.
- Reviewed source revision: `gnina-1.3.3+6fe1ce2bb9c3+binary-3340c1f49cd3`: the `v1.3.3` tag's commit
  `6fe1ce2bb9c35c8067de9f49bb9169857dfbad70` and the binary GNINA released from it.
- GNINA 1.3.3: <https://github.com/gnina/gnina/releases/tag/v1.3.3>. GNINA is dual licensed under GPL
  and Apache; its README states that the GPL is necessitated by its use of OpenBabel (GPL-2.0-only), so
  the released binary as a whole is GPL-2.0.

## GNINA is not in this box

The release asset `gnina.cuda12.8.static` (2,056,131,000 bytes, SHA-256
`3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172`) is declared as an on-demand asset.
When a user installs the tool, Liatir downloads it from GNINA's own GitHub release, checks its size
and SHA-256, and places it at `gnina/bin/gnina`. The signed box never contains it, and Liatir
redistributes no GNINA code
([decision](../../.context/decisions/gnina-binary-fetched-at-install.md)).

## What the box carries

- The libraries the binary links dynamically — NVIDIA's CUDA runtime, cuBLAS, cuFFT, cuSPARSE,
  cuSOLVER and cuDNN — and Python, as unmodified conda-forge packages with their
  licence files, on the basis recorded in
  [Copyleft dependencies in signed boxes](../../.context/decisions/copyleft-dependencies-in-signed-boxes.md).
  The complete transitive inventory is `runtime-boxes/legal/audits/gnina-linux-x86_64-cuda12.8.json`.
- Reference data for the scientific validator, unmodified and pinned by SHA-256:
  - GNINA's regression data from that commit (`test/gnina/data/`: `noelem`, `3rod`, `184l`), structures
    derived from PDB entries (wwPDB data are CC0 1.0), used under GNINA's Apache-2.0 option;
  - AutoDock Vina's 1IEP basic-docking example (Apache-2.0), the receptor and crystal ligand the
    Molecular Docking box also carries.
- `licenses/Apache-2.0.txt`, for that reference data.

Pruned from the payload: `venv/lib/python3.1` (conda's link to `python3.11`, which the build would
otherwise copy in full).

The binary needs glibc 2.35 or newer on the host (Ubuntu 22.04 or later), and an NVIDIA driver.

## Scientific limits

GNINA's CNN pose score estimates how likely a pose is to lie within 2 Å of the true binding mode, and
its CNN affinity is a predicted binding affinity in pK units; both are predictions of neural networks
trained on known complexes, not measurements, and a rescored pose is still a hypothesis to test.
