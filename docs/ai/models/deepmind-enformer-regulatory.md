# Enformer Regulatory Prediction

Enformer is a long-context DNA model for predicting regulatory activity from
genomic sequence.

## What it does

Liatir uses Enformer to read a large DNA window and produce regulatory signal
tracks. When a VCF file is provided, Liatir can compare the reference and
alternate windows to estimate how much a variant changes the predicted signal.

## When to use it

Use Enformer when you want to explore regulatory effects from DNA sequence and
you need longer context than a short embedding model provides.

## Inputs in Liatir

- Reference FASTA/FA/FNA file, or an inline DNA sequence.
- Optional VCF or VCF.GZ file for variant scoring.
- Output head, usually `Human`.
- Target index. Start with `0` for a first test, then choose a more specific
  track once target labels are exposed in the UI.

## Outputs

Liatir writes:

- predicted regulatory signal as CSV;
- BED genome track for the signal;
- optional variant score CSV and BED track;
- JSON summary;
- Results panels and provenance.

## Hardware and installation

Enformer uses a large input window, so CPU runs can be slow. A GPU is preferred
for repeated scoring.

Liatir installs Enformer and its model files in an isolated environment, so
nothing is added to the base app until you install it.

## Limits and cautions

Predictions are useful for exploration and prioritization, not automatic
biological conclusions. Always check the input reference, selected target index,
model notes, and provenance.

The current `targetIndex` is technical. Start with `0` for a smoke test, but do
not make biological claims until you know which target the selected index
represents.

## Official source

- [DeepMind Enformer repository](https://github.com/google-deepmind/deepmind-research/tree/master/enformer)

## Related tool

- [Regulatory Prediction](/ai/tools/regulatory-prediction)
