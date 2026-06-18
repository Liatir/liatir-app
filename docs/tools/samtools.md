# Samtools

Samtools is the standard toolkit for working with sequence alignment data. Liatir uses the `flagstat` subcommand to produce a quick summary of alignment statistics from BAM, SAM, or CRAM files.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `samtools` |
| Subcommand | `flagstat` |
| Pipeline ID | `samtools-flagstat` |

## Installation

Samtools must be installed and available in your system PATH.

::: code-group

```bash [macOS (Homebrew)]
brew install samtools
```

```bash [Ubuntu/Debian]
sudo apt install samtools
```

```bash [conda]
conda install -c bioconda samtools
```

:::

Liatir checks for `samtools` on page load. If it is not found, the dependency card shows these same instructions.

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.bam` | Binary alignment map (the standard format) |
| `.sam` | Text alignment map |
| `.cram` | Compressed, reference-based alignment format |

BAM is the most common format. SAM files are large (text) and uncommon in practice; most pipelines write BAM directly.

::: tip BAM indexing
`samtools flagstat` reads the entire file sequentially — it does not need a `.bai` index. Other samtools operations (like `view -r` for region queries) do require an index.
:::

## Running Samtools flagstat

1. Navigate to **Tools → Samtools**.
2. Select a BAM, SAM, or CRAM file from your Data library.
3. Click **Run**.

The run spawns `samtools flagstat <path>` and captures stdout. Results are parsed and stored in run history.

## Output metrics

`samtools flagstat` counts reads in each category defined by the SAM bitwise FLAG field. Each count is reported twice: reads that pass QC filters and reads that fail them (the latter shown in parentheses).

| Metric | FLAG bits | Description |
|--------|-----------|-------------|
| Total reads | — | All records in the file (QC-passed + QC-failed) |
| Mapped | 0x4 unset | Reads with at least one reported alignment |
| Mapped % | — | Mapped / total × 100 |
| Duplicates | 0x400 | Reads marked as optical or PCR duplicate |
| Properly paired | 0x2 | Both mates aligned, within expected distance and orientation |
| Secondary | 0x100 | Alternative alignments for multi-mapping reads |
| Supplementary | 0x800 | Chimeric alignments (e.g., from structural variant evidence) |
| Paired in sequencing | 0x1 | Reads from paired-end library |
| Read 1 | 0x40 | First mate in a pair |
| Read 2 | 0x80 | Second mate in a pair |

### Interpreting results

| Metric | Good range | Concern |
|--------|-----------|---------|
| Mapped % | ≥ 95% (WGS human) | < 80% may indicate wrong reference, contamination, or damaged library |
| Properly paired % | Close to mapping rate | Large gap may indicate structural rearrangements or library quality issues |
| Duplicate % | < 20% (WGS) | > 40% suggests over-amplification; may bias variant calling and coverage |
| Secondary | Low (< 5%) | High secondary counts mean many reads map to multiple locations |

::: tip Duplicate rate context
Duplicate percentages are expected to be higher for:
- Amplicon sequencing (by design)
- Very low-input libraries
- High-depth targeted panels

For whole-genome or whole-exome, 10–25% is typical. Above 40% is worth investigating.
:::
