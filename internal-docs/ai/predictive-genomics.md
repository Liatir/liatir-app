# Predictive Genomics

This page tracks the current Batch 4 implementation and the constraints that
matter when extending it.

## Current implemented slices

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

Liatir also supports a dedicated regulatory prediction workflow:

1. read a reference FASTA or inline DNA sequence;
2. optionally read variants from `.vcf` or `.vcf.gz`;
3. fit the sequence into the selected model context window;
4. run Enformer, Basenji2 human, or Borzoi Mini K562 RNA-seq from its own
   isolated TensorFlow runtime box;
5. write signal CSV, BED signal track, optional variant score CSV/BED, JSON
   summary, Results sections, Jobs metadata, and provenance.

The tool is `ai-regulatory-prediction`. It uses `supportedModelIds` because the
existing capability labels are too broad to distinguish embedding-delta variant
scoring from regulatory-signal variant scoring.

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

## Regulatory model boxes

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

Current Liatir model boxes:

- `deepmind-enformer-regulatory`
  - runtime: `regulatory-enformer`;
  - preload: TensorFlow Hub asset cache;
  - Python: 3.10 or 3.11;
  - context window: 393,216 bp.
- `calico-basenji2-human-regulatory`
  - runtime: `regulatory-basenji2-human`;
  - preload: official `model_human.h5`, `params_human.json`, and
    `targets_human.txt`;
  - Python: 3.10 or 3.11;
  - context window: 131,072 bp.
- `calico-borzoi-mini-k562-rna`
  - runtime: `regulatory-borzoi-mini-k562-rna`;
  - preload: official Mini Borzoi K562 RNA-seq fold 0 weights, parameters, and
    targets;
  - Python: 3.10;
  - context window: 524,288 bp.

Keep these boxes isolated. Do not merge them into the Nucleotide Transformer
runtime or a generic TensorFlow bucket unless package specs, host requirements,
and artifact payloads are identical.
