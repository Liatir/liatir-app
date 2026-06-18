# fastp

fastp is an all-in-one FASTQ pre-processing tool. It performs adapter trimming, quality filtering, per-read quality correction, and QC report generation in a single pass — typically faster than any pipeline that chains separate tools.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `fastp` |
| Pipeline ID | `fastp` |

## Installation

fastp must be installed and available in your system PATH.

::: code-group

```bash [macOS (Homebrew)]
brew install fastp
```

```bash [Ubuntu/Debian]
sudo apt install fastp
```

```bash [conda]
conda install -c bioconda fastp
```

:::

## Accepted inputs

| Field | Extension(s) | Required |
|-------|-------------|---------|
| R1 (read 1) | `.fastq`, `.fastq.gz`, `.fq`, `.fq.gz` | Yes |
| R2 (read 2) | `.fastq`, `.fastq.gz`, `.fq`, `.fq.gz` | No (paired-end only) |

Providing only R1 runs fastp in **single-end** mode. Providing both R1 and R2 activates **paired-end** mode automatically. Paired-end mode enables additional QC checks (overlap analysis, insert size estimation) and correct adapter detection without needing to specify adapter sequences.

## Running fastp

1. Navigate to **Tools → fastp**.
2. Select an R1 file from your Data library.
3. Optionally select an R2 file for paired-end mode.
4. Click **Run**.

Liatir runs fastp with auto-detected adapter trimming and writes trimmed output files to `{app_data_dir}/tool-outputs/`.

## Output files

fastp produces trimmed FASTQ files:

- **Single-end**: one trimmed R1 file named `fastp-<run-id>-R1.fastq.gz`
- **Paired-end**: trimmed R1 and R2 files

Each output file appears in the results panel above the QC stats, with two actions:

- **Add to Data** — registers the trimmed file in the Data library immediately. The file is available in any subsequent tool's file picker (e.g., as input to an aligner .lia module) without any manual import step.
- **Save as…** — opens the system save dialog to copy the file to a location you choose.

::: tip After trimming
In a typical short-read DNA sequencing pipeline, trimmed reads from fastp feed directly into an aligner (BWA-MEM2, STAR, Bowtie2). With Liatir's pipeline system, the trimmed files can be automatically wired to the aligner step's input.
:::

## QC statistics

fastp reports detailed statistics before and after filtering:

### Read counts

| Metric | Description |
|--------|-------------|
| Total reads (before) | Total reads input to fastp |
| Total bases (before) | Total base count before filtering |
| Total reads (after) | Reads remaining after all filters |
| Total bases (after) | Base count after filtering |

### Quality rates

| Metric | Description |
|--------|-------------|
| Q20 rate (before/after) | Fraction of bases with Phred quality ≥ 20 (error rate < 1%) |
| Q30 rate (before/after) | Fraction of bases with Phred quality ≥ 30 (error rate < 0.1%) |
| GC content | Overall GC percentage |

### Filter results

| Category | Description |
|----------|-------------|
| Passed filter | Reads retained after all filters |
| Low quality | Reads with too many bases below the quality threshold |
| Too many N | Reads exceeding the maximum allowed ambiguous bases |
| Too short | Reads shorter than the minimum length cutoff after trimming |

::: tip Interpreting Q30 rate
A Q30 rate above 80% after filtering is generally considered good for modern short-read Illumina data. Q30 rates below 70% may indicate run quality issues at the sequencing level.

Compare Q30 before and after to assess how much low-quality data was present. A large gain in Q30 from filtering means the raw data had significant noise at 3′ ends.
:::

## What fastp does automatically

By default, Liatir runs fastp with:

- **Auto adapter detection** — fastp detects adapter sequences from the data without needing adapter sequences specified. For paired-end data it uses read overlap; for single-end it uses built-in adapter profiles.
- **Per-read quality trimming** — trims low-quality bases from 3′ ends.
- **Minimum length filtering** — discards reads shorter than 15 bp after trimming.
- **Gzip-compressed output** — trimmed files are always written as `.fastq.gz`.
