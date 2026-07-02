# Borzoi Mini K562 RNA-seq

Borzoi predicts RNA-seq-like signal from long DNA sequence windows. Liatir starts
with the official Mini Borzoi K562 RNA-seq model because it is a smaller managed
entry point into the Borzoi family.

## What it does

The model reads a long genomic sequence window and predicts a K562 RNA-seq
signal. With an optional VCF file, Liatir compares reference and alternate
windows to estimate signal changes for selected variants.

## When to use it

Use this model when you want to explore RNA-seq signal prediction from DNA
sequence with a managed local Borzoi runtime.

## Inputs in Liatir

- Reference FASTA/FA/FNA file, or an inline DNA sequence.
- Optional VCF or VCF.GZ file.
- Output head: `Human`.
- Target index.
- Maximum variants to score.

## Outputs

Liatir writes:

- predicted signal CSV;
- BED signal track;
- optional variant score CSV and BED track;
- JSON summary;
- Results panels and provenance.

## Hardware and installation

Borzoi is TensorFlow-based and uses very long input windows. Liatir installs it
as its own AI Model box and downloads the official Mini Borzoi K562 RNA-seq fold
0 weights, parameters, and targets.

The official Borzoi documentation recommends Python 3.10 with TensorFlow 2.15.x.
CPU can run small checks, but GPU is strongly preferred.

## Limits and cautions

This is a focused Mini Borzoi model, not the full multi-replicate Borzoi stack.
Use it to validate workflows and explore K562 RNA-seq signal prediction before
moving to larger Borzoi runs.

Because this model is K562-focused, interpret outputs as a model-specific signal
example rather than a universal regulatory prediction for every tissue or cell
type.

## Official source

- [Calico Borzoi repository](https://github.com/calico/borzoi)

## Related tool

- [Regulatory Prediction](/ai/tools/regulatory-prediction)
