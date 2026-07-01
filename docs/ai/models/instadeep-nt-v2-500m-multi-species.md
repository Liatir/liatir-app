# Nucleotide Transformer v2 500M

Nucleotide Transformer v2 500M is a larger DNA/RNA language model for genomic
embeddings and embedding-delta variant scoring.

## What it does

The model reads nucleotide sequence windows and produces embeddings. In variant
effect workflows, Liatir can compare embeddings from reference and alternate
sequence windows to create a local effect score.

## When to use it

Use this model when you need stronger genomic representations than the smaller
50M model and your machine has enough memory. It is better suited to repeated
scoring and higher-quality embeddings, but it is heavier.

## Inputs in Liatir

- FASTA/FA/FNA file, or an inline DNA/RNA sequence.
- For variant effect workflows: reference/alternate sequence windows derived
  from FASTA plus `.vcf` or `.vcf.gz` inputs.
- Maximum token/window length.

## Outputs

Liatir can produce:

- embeddings;
- variant effect scores based on reference/alternate embedding differences;
- JSON/CSV summaries;
- genome-track-compatible artifacts where supported by the tool;
- provenance with model ID, runtime, input, and parameters.

## Hardware and installation

CPU can work for short windows, but GPU or Apple Metal through PyTorch is
strongly preferred for repeated variant scoring. Plan for more RAM than the 50M
model.

Liatir installs the model through a managed Python runtime using PyTorch and
Transformers.

## Limits and cautions

The model license is non-commercial. Check whether your use case is allowed
before using it in commercial or restricted work.

Embedding-delta scoring is a useful local signal, not a replacement for a
validated variant interpretation pipeline.

## Official source

- [Nucleotide Transformer v2 500M on Hugging Face](https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-500m-multi-species)
