# Regulatory Prediction

Regulatory Prediction uses long-context genomic models to predict signal across
a DNA sequence window. It can also compare reference and alternate windows for
selected variants.

## Use it for

- exploring predicted regulatory signal from DNA sequence;
- creating BED tracks for genome-viewer inspection;
- comparing variant effects on predicted regulatory output;
- testing Enformer, Basenji2, or Borzoi Mini workflows locally.

## Inputs

- Reference FASTA/FA/FNA file, or an inline DNA sequence.
- Optional VCF or VCF.GZ file.
- Reference name when needed.
- Window start.
- Output head, usually `Human`.
- Target index.
- Max variants.

## Compatible models

- [Enformer Regulatory Prediction](/ai/models/deepmind-enformer-regulatory)
- [Basenji2 Human Regulatory](/ai/models/calico-basenji2-human-regulatory)
- [Borzoi Mini K562 RNA-seq](/ai/models/calico-borzoi-mini-k562-rna)

## Outputs

- Regulatory signal CSV.
- Signal BED track.
- Optional variant scores CSV.
- Optional variant score BED track.
- JSON summary.
- Bin count.
- Variant count.
- Top variant delta.
- Warnings.
- Provenance.

## How to read the result

Start with the signal track. It shows predicted model output across bins in the
input sequence window.

The `targetIndex` selects which output track to inspect. This is currently a
technical parameter. Index `0` is useful for a first smoke test, but scientific
interpretation requires knowing which biological assay or target that index
represents.

If a VCF is provided, variant scores show how much the predicted signal changed
between reference and alternate windows.

## Technical details

Tool ID: `ai-regulatory-prediction`

Each model has its own isolated TensorFlow runtime box. Liatir does not share
these runtimes with Nucleotide Transformer or CellTypist because package
versions, model files, and input windows differ.
