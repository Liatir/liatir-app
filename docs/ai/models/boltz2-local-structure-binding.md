# Boltz-2 Local Structure & Binding

Boltz-2 is a local structure prediction and binding-oriented model. In Liatir it
is used for protein structure prediction and optional protein-ligand affinity
workflows.

## What it does

Boltz-2 takes protein sequence input and predicts a structure file. When ligand
inputs and the selected options support it, it can also produce binding-related
outputs.

## When to use it

Use Boltz-2 when you want a local protein structure prediction workflow that can
feed directly into Liatir structure viewers and reports.

## Inputs in Liatir

- Protein FASTA/FAA file, or an inline protein sequence.
- Optional ligand SMILES or CCD identifier.
- Prediction options such as output format, recycling steps, diffusion samples,
  MSA server use, and accelerator choice.

## Outputs

Liatir can produce:

- PDB or mmCIF structure files when prediction succeeds;
- confidence and binding metadata where available;
- logs and runtime warnings;
- viewer-compatible artifacts;
- provenance with model, runtime, input, parameters, and output files.

## Hardware and installation

Boltz-2 can be installed for CPU-only use, but CPU inference can take a long
time. CUDA GPU inference is strongly preferred for serious use.

Liatir installs Boltz-2 in an isolated managed Python runtime. The runtime
currently requires Python 3.10, 3.11, or 3.12.

## Limits and cautions

Structure prediction can be slow and resource-heavy. A completed run without a
structure file is treated as an error in Liatir because the main scientific
artifact is missing.

Predicted structures and affinities should be interpreted carefully and, where
important, validated with additional methods.

The structure file is the main artifact. If a run produces logs but no PDB or
mmCIF file, the scientific output is incomplete.

## Official source

- [Boltz on GitHub](https://github.com/jwohlwend/boltz)

## Related tool

- [Protein Structure Prediction](/ai/tools/protein-structure-prediction)
