# Genomic Variant Effect

Genomic Variant Effect scores variants by comparing model embeddings for
reference and alternate sequence windows.

## Use it for

- local variant prioritization experiments;
- quick checks on small VCF/VCF.GZ files;
- generating BED tracks from model-derived variant scores;
- building exploratory genomics pipelines.

## Inputs

- Reference FASTA/FA/FNA file, or an inline reference sequence.
- VCF or VCF.GZ variant file.
- Reference name when needed.
- Window start.
- Flank size.
- Max variants.
- Max tokens.
- Nucleotide Transformer AI Model.

## Compatible models

- [Nucleotide Transformer v2 50M](/ai/models/instadeep-nt-v2-50m-multi-species)
- [Nucleotide Transformer v2 500M](/ai/models/instadeep-nt-v2-500m-multi-species)

## Outputs

- Variant scores CSV.
- BED genome track.
- JSON summary.
- Variant count.
- Top embedding delta.
- Warnings.
- Provenance.

## How to read the result

The main score is based on how much the alternate sequence changes the model
embedding compared with the reference sequence.

A higher score means a bigger model-representation change. It does not mean the
variant is automatically pathogenic, causal, or clinically important.

Always check warnings. The most important warning is a REF mismatch: it means the
VCF reference allele does not match the FASTA sequence Liatir used.

## Good first pipeline

1. Reference FASTA input.
2. VCF input.
3. Genomic Variant Effect with Nucleotide Transformer 50M.
4. BED output into a genome viewer.
5. Inspect top scores and provenance.

## How the score is computed

The score measures how much the alternate sequence embedding differs from the
reference embedding — higher means a bigger change in the model's
representation. Variants are read in file order and scoring stops at `Max
variants`, so no `.tbi` index is needed.
