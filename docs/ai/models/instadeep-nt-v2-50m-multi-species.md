# Nucleotide Transformer v2 50M

Nucleotide Transformer v2 50M is a small DNA/RNA language model used for
sequence embeddings and lightweight genomic representation tasks.

## What it does

The model turns nucleotide sequences into numerical embeddings. Embeddings are
vectors that summarize sequence patterns in a way downstream tools can compare,
cluster, or score.

## When to use it

Use this model when you want a faster, lighter sequence embedding option. It is
appropriate for short windows, demos, and early pipeline design before moving to
larger models.

## Inputs in Liatir

- FASTA/FA/FNA file, or an inline DNA/RNA sequence.
- For variant effect workflows: reference FASTA plus `.vcf` or `.vcf.gz`
  variants.
- Molecule type: DNA or RNA.
- Maximum token/window length.

## Outputs

Liatir can produce:

- per-sequence embeddings;
- variant effect scores for small local VCF/VCF.GZ batches;
- BED tracks for genome viewer inspection;
- JSON/CSV summaries;
- basic metrics such as sequence count and embedding size;
- provenance with model ID, revision, runtime, input, and parameters.

## Hardware and installation

This model can run on CPU for small batches. GPU or Apple Metal through PyTorch
can be faster when available.

Liatir installs the model through a managed Python runtime using PyTorch and
Transformers.

## Limits and cautions

The model license is non-commercial. Check whether your use case is allowed
before using it in commercial or restricted work.

Embeddings are not direct biological conclusions. They are numerical
representations that need downstream interpretation.

For variant effect scoring, a higher embedding delta means the model
representation changed more. It does not mean the variant is automatically
pathogenic or clinically important.

## Official source

- [Nucleotide Transformer v2 50M on Hugging Face](https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-50m-multi-species)

## Related tools

- [Sequence Embedding](/ai/tools/sequence-embedding)
- [Genomic Variant Effect](/ai/tools/genomic-variant-effect)
