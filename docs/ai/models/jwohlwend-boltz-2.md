# Boltz-2

Boltz-2 predicts the 3D structure of proteins and molecular complexes from their
sequences, and estimates how strongly a small molecule binds a protein. Liatir
runs it entirely on your computer.

## What it does

- **Structure Prediction**: from one or more protein, DNA or RNA sequences and
  optional small molecules, Boltz-2 predicts where every atom sits, with a
  confidence score for each part of the structure.
- **Protein–Ligand Affinity**: for one protein and one small molecule written as
  SMILES, it predicts the probability that the molecule binds, and an estimate
  of binding strength as log10(IC50) in micromolar. Lower values mean stronger
  binding.

## Current status in Liatir

Boltz-2 2.2.1 is published as a signed Runtime Box for Linux x86_64 with an
NVIDIA GPU (CUDA 12.9). Windows computers with an NVIDIA GPU run the same box
through WSL2. There is no macOS version.

Before publication, the exact box you download was checked against known
science:

- From the sequence of ubiquitin alone, it reproduced the experimentally solved
  structure (PDB 1UBQ) to within 1.99 Å.
- For human carbonic anhydrase II it called acetazolamide a binder with
  probability 0.99 and ranked it stronger than sulfanilamide, matching
  laboratory measurements.

## What to keep in mind

- Affinity values are estimates, not measurements. Boltz-2 predicts IC50, which
  is not the same quantity as a measured Ki, and on the molecules above its
  values were weaker than the laboratory ones. Use them to compare and rank
  candidates, not as exact numbers.
- Telling a real binder from a molecule that does not bind was not part of the
  checks above.
- Predictions run without a multiple sequence alignment, because Liatir works
  offline. Proteins with few known relatives may be predicted less accurately.

## Expected inputs

- Structure Prediction: sequences of the chains in the complex, and optionally
  small molecules as SMILES.
- Protein–Ligand Affinity: one protein sequence and one small molecule as
  SMILES. Following Boltz-2's own limits, Liatir warns above 56 heavy atoms and
  refuses above 128.

## Expected outputs

- The predicted structure as mmCIF, which opens in the 3D Structure Viewer.
- Confidence scores, and for affinity the binding probability and log10(IC50).
- Jobs, Results and Runtime Box provenance, like every Liatir run.

## Hardware and installation

You need an NVIDIA GPU. On the computer the box was validated on, a GeForce RTX
4060 Ti with 8 GB of memory, a 76-residue protein took about one minute, and a
260-residue protein with a small molecule took about two minutes, using up to
3.6 GB of GPU memory and under 10 GB of RAM. Before a larger run, Liatir tells you
that it goes beyond what was measured and asks you to confirm.

The download is about 12.7 GB and needs about 20 GB of disk once installed.
Everything Boltz-2 needs lives inside the Runtime Box and is never added to
your system.

## Official source

- [Boltz on GitHub](https://github.com/jwohlwend/boltz/tree/v2.2.1), MIT
  License, for both the code and the model weights.
