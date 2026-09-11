# Protenix takes its scientific stack from PyPI, not conda-forge

Taken 2026-09-11, when Protenix Mini Default turned out to have no conda-first solution at all.

## Decision

`protenix-mini-default-v0-5-0/linux-x86_64-cuda12.9` declares **only `python` on the conda side**,
plus the CUDA system requirement. PyTorch, torchvision, torchaudio, NumPy, Triton, DeepSpeed, RDKit
and everything else come from PyPI, at the versions `protenix==2.0.0` itself requires. The package
is pinned to its **published wheel**, not to the git commit it was built from.

Every other Runtime Box in this project takes PyTorch from conda-forge. Protenix is the exception,
and the exception is confined to Protenix.

## Why

The reviewed manifest restated upstream's pins as conda specifications, and that combination does not
exist. Three separate conflicts, all verified by running the solver rather than read off metadata:

1. conda-forge's `torchvision 0.22.1` CUDA build **constrains `numpy <2.4`**, while Protenix pins
   `numpy==2.4.1`. That constraint comes from how conda-forge built the package; PyPI's torchvision
   does not carry it.
2. conda-forge's `pytorch 2.7.1` pins `numpy==2.4.6` into the PyPI half of the solve, and
   `protenix==2.0.0` requires `numpy==2.4.1`. Those cannot both hold.
3. The remaining `torchvision 0.22.1` candidates are CPU-only builds, which contradict a CUDA target.

So the conda-first shape forces a choice between loosening an upstream pin and not building at all.
**Taking the stack from PyPI honours every pin exactly** — `torch 2.7.1`, `torchvision 0.22.1`,
`torchaudio 2.7.1`, `numpy 2.4.1`, `deepspeed 0.17.5`, `triton 3.3.1`, `rdkit 2025.9.3` — and
resolves in one pass: 24 conda entries, 116 PyPI entries, and **no entry without a SHA-256**.

The rule this follows is the one already in force: *do not loosen upstream constraints to obtain a
lock*. What had to give was our own habit of expressing someone else's requirements in conda terms.

## What this costs, stated plainly

**The CUDA runtime arrives as fifteen PyPI `nvidia-*` wheels** instead of conda-forge packages. They
carry the same NVIDIA licence terms, and the licence inventory names them the same way, but they are
a different set of artefacts from the ones every other CUDA box ships. A Protenix box and a Boltz box
on the same machine carry two independent copies of the CUDA libraries.

**The substrate guarantee narrows.** conda-forge builds its packages against a known toolchain;
PyPI wheels are whatever the publisher uploaded. The protection that remains is the one that
matters most and is unchanged: every distribution is pinned by SHA-256 in the lock, verified on
download, and listed in the box's licence inventory.

This is why the decision is written down rather than folded into a lock commit. It is visible in the
manifest, and it stops at Protenix.

## What was rejected

**Pinning `numpy<2.4` to satisfy conda-forge.** It would have solved, and it would have shipped a
NumPy that Protenix says it does not support, in a scientific box, to avoid writing this page.

**Moving the target to CUDA 13.** conda-forge's newer torchvision builds want it. That would give
Protenix a driver floor no other box has, for a dependency Protenix never imports.

**Dropping `torchvision` and `torchaudio` from the manifest.** They are declared but never used —
across all 145 Python files at the reviewed commit neither is imported, or even mentioned. Removing
them from *our* manifest changes nothing, because `setup.py` reads `requirements.txt` verbatim into
`install_requires`, so the resolver must satisfy them regardless. Worth knowing, not worth acting on.

**Keeping the git dependency.** A git revision pins a tree, and a signed box verifies bytes. The git
form left the only lock entry with no SHA-256; the published wheel removes the exception.

## Related

- [Protenix source review](../state/roadmap/phase3-protenix-source-review.md) — the failing solves in
  full, and why v2 is blocked on a checkpoint that is not ours to unblock.
