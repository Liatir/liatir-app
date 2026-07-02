# Protein Structure Prediction

Protein Structure Prediction predicts a 3D structure from a protein sequence and
can optionally include ligand or binding-related outputs when the selected model
supports them.

## Use it for

- predicting a structure from a protein FASTA;
- creating a structure file for the 3D viewer;
- testing protein-ligand settings with Boltz-2;
- building a sequence-to-structure pipeline.

## Inputs

- Protein FASTA/FA/FAA/TXT file, or inline protein sequence.
- Optional ligand SMILES.
- Optional ligand CCD identifier.
- MSA server setting.
- Accelerator setting.
- Output format: mmCIF or PDB.
- Recycling steps and diffusion samples.

If both a file and inline sequence are provided, Liatir uses the file.

## Compatible models

- [Boltz-2 Local Structure & Binding](/ai/models/boltz2-local-structure-binding)

Chai-1 is implemented but hidden until Linux CUDA validation is available.

## Outputs

- mmCIF or PDB structure file.
- JSON summary.
- Confidence scores when available.
- Affinity scores when available.
- Provenance.

## How to read the result

The structure file is the main artifact. Open it in the structure viewer and
check whether a file was actually produced.

Confidence and affinity outputs are model-derived estimates. They should guide
inspection, not replace experimental validation.

CPU runs can be slow. For short tests, use one diffusion sample and modest
recycling steps.

## Technical details

Tool ID: `ai-protein-structure`

The direct runner and pipeline tool both create Jobs and Results records. A run
that finishes without a structure file is treated as an error because the main
scientific artifact is missing.
