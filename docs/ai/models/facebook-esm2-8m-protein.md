# ESM-2 8M Protein

ESM-2 8M is a small protein language model for lightweight protein sequence
embeddings.

## What it does

The model turns amino acid sequences into embeddings. These embeddings can be
used to compare proteins, feed downstream tools, or inspect sequence-level
representations.

## When to use it

Use this model for fast protein embedding tests, smaller workflows, and local
pipeline validation. It is intentionally small compared with larger protein
language models.

## Inputs in Liatir

- FASTA/FAA file, or an inline protein sequence.
- Maximum token/window length.

## Outputs

Liatir can produce:

- per-sequence embeddings;
- JSON/CSV summaries;
- basic metrics such as embedding size;
- provenance with model ID, revision, runtime, input, and parameters.

## Hardware and installation

ESM-2 8M can run on CPU for short sequences. GPU or Apple Metal can improve
throughput when PyTorch can use it.

Liatir installs the model through a managed Python runtime using PyTorch and
Transformers.

## Limits and cautions

Protein embeddings summarize sequence patterns, but they do not by themselves
predict a reliable 3D structure or binding property. Use a structure-prediction
model for that.

Use embeddings when you want representation or comparison. Use Boltz-2 when you
want a structure file.

## Official source

- [ESM-2 8M on Hugging Face](https://huggingface.co/facebook/esm2_t6_8M_UR50D)

## Related tool

- [Sequence Embedding](/ai/tools/sequence-embedding)
