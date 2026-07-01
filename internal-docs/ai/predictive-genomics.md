# Predictive Genomics

This page tracks the current Batch 4 implementation and the constraints that
matter when extending it.

## Current implemented slice

Liatir currently supports a pragmatic variant-effect workflow built on
Nucleotide Transformer embeddings:

1. read a reference FASTA or inline reference sequence;
2. read variants from `.vcf` or `.vcf.gz`;
3. create reference and alternate sequence windows around each variant;
4. embed both windows with a selected Nucleotide Transformer model;
5. score each variant by embedding delta;
6. write CSV, JSON summary, BED track, Results sections, Jobs metadata, and
   provenance.

The tool is `ai-genomic-variant-effect`. It is intentionally an AI Tool rather
than a direct model-only runner because it needs coordinated reference, variant,
window, and model inputs.

## File formats

VCF is a tabular variant format. The important columns for the current scorer
are:

- `CHROM`: reference sequence name, such as `chr1`;
- `POS`: 1-based variant position;
- `ID`: variant identifier;
- `REF`: reference allele;
- `ALT`: alternate allele.

`.vcf.gz` is accepted for sequential scoring. The current scorer reads it with
gzip streaming and does not require a `.tbi` index because it scans records in
order and stops at `Max variants`.

BED is a simple interval-track format. Liatir writes a BED output so the scores
can be visualized as genome-track artifacts:

- column 1: reference name;
- column 2: 0-based start;
- column 3: 0-based end;
- column 4: feature name;
- column 5: score.

## Demo fixtures

Batch 4 demo files live under `src-tauri/resources/demo-files`:

- `fasta/demo_genome.fasta`;
- `vcf/demo_variant_effect.vcf`;
- `vcf/demo_variant_effect.vcf.gz`;
- `genome/demo_variant_effect_scores.bed`.

The small variant-effect VCF is aligned to `demo_genome.fasta`; unit tests check
that the REF alleles still match the FASTA.

## Scientific limits

The current score is `1 - cosine_similarity(reference_embedding,
alternate_embedding)`. It is useful as a local prioritization signal, not as a
validated pathogenicity score or regulatory assay prediction.

Keep warnings visible when:

- VCF `REF` does not match the selected FASTA sequence;
- no variants overlap the selected reference/window;
- only a subset of variants is scored because of `Max variants`;
- CPU execution is expected to be slow.

## Deferred regulatory model candidates

Do not add these as installable AI Models until the runtime box, dependency
isolation, hardware checks, and artifact layout are designed and tested.

Official sources checked on 2026-07-01:

- [Nucleotide Transformer v2 50M](https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-50m-multi-species):
  Hugging Face model card lists Transformers/PyTorch usage and
  `cc-by-nc-sa-4.0` licensing.
- [Nucleotide Transformer v2 500M](https://huggingface.co/InstaDeepAI/nucleotide-transformer-v2-500m-multi-species):
  Hugging Face model card lists Transformers/PyTorch usage, 0.5B parameters,
  and `cc-by-nc-sa-4.0` licensing.
- [Enformer](https://github.com/google-deepmind/deepmind-research/tree/master/enformer):
  official DeepMind research code uses TensorFlow/TF Hub, long input windows,
  and dedicated requirements.
- [Basenji](https://github.com/calico/basenji): official Calico repository
  uses TensorFlow and environment-specific setup.
- [Borzoi](https://github.com/calico/borzoi): official Calico repository
  requires Python 3.10, TensorFlow 2.15.x, related repositories, environment
  variables, and separate model-weight downloads.

These are more complex than the current Transformers/PyTorch Nucleotide
Transformer stack. Treat them as a dedicated expansion slice, not as entries in
the current model registry.
