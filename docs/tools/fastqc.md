# FastQC

FastQC performs comprehensive quality control analysis on raw sequencing reads. The Liatir implementation is compiled to **WebAssembly** — it runs entirely inside the app with no installation required.

## Details

| Property | Value |
|----------|-------|
| Type | WASM plugin |
| Installation | None (bundled with Liatir) |

## Why WASM?

The FastQC WASM plugin is compiled from a high-performance Rust implementation rather than wrapping the original Java binary. This gives it two advantages:

1. **No installation** — the binary is embedded in the app bundle.
2. **Native speed** — Rust + WASM is significantly faster than the JVM-based original for per-read parsing.

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.fastq` | Uncompressed FASTQ |
| `.fastq.gz` | Gzip-compressed FASTQ |
| `.fq` | Uncompressed FASTQ (alternate extension) |
| `.fq.gz` | Gzip-compressed FASTQ (alternate extension) |

FASTQ files follow the standard 4-line format: `@identifier`, sequence, `+`, quality scores (Phred+33 encoding).

## Running FastQC

1. Navigate to **Tools → FastQC**.
2. Select one or more FASTQ files from your Data library.
3. Click **Run**.

Analysis runs in the background. The run history sidebar on the left updates when complete.

## Output metrics

### Per-base sequence quality

Mean Phred quality score at each position across all reads. Positions are numbered from the 5′ end of the read. A declining curve toward the 3′ end is normal for most short-read platforms and reflects signal degradation in the flow cell.

Phred quality interpretation:

| Score | Error rate | Accuracy |
|-------|-----------|----------|
| Q10 | 10% | 90% |
| Q20 | 1% | 99% |
| Q30 | 0.1% | 99.9% |
| Q40 | 0.01% | 99.99% |

### GC content

Overall GC percentage across all reads. Most organisms have a characteristic GC content; significant deviation from the expected value can indicate contamination or library preparation problems.

### Adapter detection

Identified adapter sequences and their frequency per position. Common adapters (Illumina universal, TruSeq, Nextera) are screened automatically. High adapter content toward the 3′ end indicates short inserts and typically warrants trimming before downstream analysis.

### Sequence length distribution

Distribution of read lengths. Uniform length is expected for most platforms. Variable-length distributions appear after adapter trimming or with long-read data.

### Duplication level

Estimated percentage of reads that are likely duplicates (identical or near-identical sequences). Elevated duplication can result from PCR over-amplification during library prep, and can bias downstream quantification.

::: tip What counts as good?

A practical rule of thumb for short-read Illumina data:

- Per-base Q30 > 80% across the full read length: good
- Adapter content < 5% at any position: acceptable without trimming
- Duplication level < 30% for DNA-seq: normal; higher for RNA-seq due to transcript abundance
:::
