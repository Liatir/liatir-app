# Protenix base v1.0.0

Protenix predicts the 3D structure of proteins and molecular complexes from their
sequences. It is an independent model from Boltz-2, built by a different team,
so it is useful as a second opinion on a structure. Liatir runs it entirely on
your computer.

## What it does

From one or more protein, DNA or RNA sequences and optional small molecules,
Protenix predicts where every atom sits, with a confidence score for each part
of the structure.

Liatir runs it from five different random seeds, draws five structures from
each, and returns the one Protenix itself ranks highest. On ubiquitin, a single
seed produced the wrong fold in 6 of 11 tries; competing seeds recovered the
right one each time.

## Current status in Liatir

Protenix base v1.0.0 is published as a signed Runtime Box for Linux x86_64 with
an NVIDIA GPU (CUDA 12.6). Windows computers with an NVIDIA GPU run the same box
through WSL2. There is no macOS version.

Before publication, the exact box you download was checked against known
science: from the sequence of ubiquitin alone, it reproduced the experimentally
solved structure (PDB 1UBQ) to within 2.15 Å, and two runs from the same seed
gave the same structure.

## What to keep in mind

- Predictions run without a multiple sequence alignment, because Liatir works
  offline. This is markedly less accurate for many proteins, and each result
  says so.
- On ubiquitin, Protenix was slightly less accurate and about four times slower
  than Boltz-2. Its value is that it is independent: when both models agree,
  the structure is more trustworthy.
- Protenix predicts structures only. For binding strength, use
  [Boltz-2](/ai/models/jwohlwend-boltz-2).

## Expected inputs

Sequences of the chains in the complex, and optionally small molecules as
SMILES.

## Expected outputs

- The best-ranked predicted structure as mmCIF, which opens in the 3D Structure
  Viewer, plus every structure drawn.
- Confidence scores (pLDDT, pTM).
- Jobs, Results and Runtime Box provenance, like every Liatir run.

## Hardware and installation

You need an NVIDIA GPU. On the computer the box was validated on, a GeForce RTX
4060 Ti with 8 GB of memory, a 76-residue protein took about four minutes, using
up to 3.4 GB of GPU memory and 4.3 GB of RAM. Before a larger run, Liatir tells
you that it goes beyond what was measured and asks you to confirm.

Everything Protenix needs lives inside the Runtime Box and is never added to
your system.

## Official source

- [Protenix on GitHub](https://github.com/bytedance/Protenix/blob/v2.0.0/docs/supported_models.md),
  Apache License 2.0, for both the code and the model weights.
