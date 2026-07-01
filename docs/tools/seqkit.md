# seqkit

seqkit is a cross-platform toolkit for FASTA/FASTQ file manipulation. Liatir uses the `stats` subcommand to compute sequence statistics — read/sequence counts, length distribution, GC content, N50, and quality rates.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `seqkit` |
| Subcommand | `stats` |

## Installation

seqkit must be installed and available in your system PATH.

::: code-group

```bash [macOS (Homebrew)]
brew install seqkit
```

```bash [conda]
conda install -c bioconda seqkit
```

```bash [Ubuntu/Debian]
sudo apt install seqkit
```

:::

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.fasta`, `.fa`, `.fna` | Uncompressed FASTA |
| `.fasta.gz`, `.fa.gz` | Gzip-compressed FASTA |
| `.fastq`, `.fq` | Uncompressed FASTQ |
| `.fastq.gz`, `.fq.gz` | Gzip-compressed FASTQ |

seqkit handles both compressed and uncompressed formats natively without piping through gunzip first.

## Running seqkit stats

1. Navigate to **Tools → seqkit**.
2. Select a FASTA or FASTQ file from your Data library.
3. Optionally enable **extended stats** to include N50, Q20, Q30, and GC content (adds a small overhead for large files).
4. Click **Run stats**.

## Output metrics

### Basic stats (always included)

| Metric | Description |
|--------|-------------|
| Sequences | Total number of sequences (reads for FASTQ, entries for FASTA) |
| Total length | Sum of all sequence lengths |
| Min length | Shortest sequence |
| Avg length | Mean sequence length |
| Max length | Longest sequence |

### Extended stats (`-a` flag)

| Metric | Description |
|--------|-------------|
| N50 | Half of total assembly length is contained in sequences ≥ N50. Primary assembly quality metric. |
| GC content | Percentage of guanine + cytosine bases |
| Q20 rate | Fraction of bases with Phred quality ≥ 20 (FASTQ only) |
| Q30 rate | Fraction of bases with Phred quality ≥ 30 (FASTQ only) |

::: tip N50 for assemblies
N50 is a key metric for genome assemblies. A higher N50 means larger contigs. For chromosome-level assemblies N50 ≈ chromosome length; for fragmented assemblies N50 may be a few hundred Kb. A low N50 in a FASTA intended to be a complete genome suggests the assembly is highly fragmented.
:::
