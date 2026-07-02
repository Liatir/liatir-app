# Basenji2 Human Regulatory

Basenji2 predicts regulatory activity from DNA sequence using a convolutional
TensorFlow model trained on human regulatory targets.

## What it does

Liatir uses the official Calico Basenji2 human model files to predict regulatory
signal from a DNA window. With a VCF file, it can compare reference and
alternate windows for focused variant-effect exploration.

## When to use it

Use Basenji2 when you want a managed local regulatory model that is lighter than
very large long-context stacks and you are working with human regulatory
sequence examples.

## Inputs in Liatir

- Reference FASTA/FA/FNA file, or an inline DNA sequence.
- Optional VCF or VCF.GZ file.
- Output head: `Human`.
- Target index.
- Maximum variants to score.

## Outputs

Liatir writes:

- regulatory signal CSV;
- BED signal track;
- optional variant score CSV and BED track;
- JSON summary;
- Results panels and provenance.

## Hardware and installation

Basenji2 runs through a dedicated Python/TensorFlow runtime box. Liatir downloads
the official human model weights, model parameters, and target table into that
box.

CPU runs are possible for small tests. GPU acceleration is preferred for larger
or repeated workflows.

## Limits and cautions

The first Liatir integration exposes a practical target-index workflow. It does
not yet include a friendly target-label browser, so target index `0` is the
default starting point.

Treat signal tracks as model predictions. They are useful for comparing windows
and variants, but they are not direct measurements from an experiment.

## Official source

- [Calico Basenji cross2020 models](https://github.com/calico/basenji/tree/master/manuscripts/cross2020)

## Related tool

- [Regulatory Prediction](/ai/tools/regulatory-prediction)
