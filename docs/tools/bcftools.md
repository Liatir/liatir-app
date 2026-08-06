# BCFtools

BCFtools is the standard toolkit for manipulating VCF and BCF variant files. Liatir uses the `stats` subcommand to compute summary statistics from a variant callset.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `bcftools` |
| Subcommand | `stats` |

## Installation

BCFtools must be installed and available in your system PATH.

::: code-group

```bash [macOS (Homebrew)]
brew install bcftools
```

```bash [Ubuntu/Debian]
sudo apt install bcftools
```

```bash [conda]
conda install -c bioconda bcftools
```

:::

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.vcf` | Uncompressed VCF |
| `.vcf.gz` | Bgzip-compressed VCF (requires `.tbi` index for random access; not needed for `stats`) |
| `.bcf` | Binary call format |
| `.bcf.gz` | Compressed BCF |

::: info VCF vs BCF
BCF is the binary equivalent of VCF, roughly analogous to BAM vs SAM. BCF files are faster to parse and smaller on disk but require BCFtools or htslib to inspect. For `bcftools stats`, either format works identically.
:::

## Running BCFtools stats

1. Navigate to **Tools → BCFtools**.
2. Select a VCF or BCF file from your Data library.
3. Click **Run**.

The run executes `bcftools stats <path>` and parses the structured output sections.

## Output metrics

### Summary counts

| Metric | Description |
|--------|-------------|
| Total records | All variant records in the file |
| SNPs | Single-nucleotide polymorphisms (REF and ALT are both single bases) |
| Indels | Insertions and deletions |
| MNPs | Multi-nucleotide polymorphisms |
| Other | Complex variants not in the above categories |
| Multiallelic sites | Sites with more than one ALT allele |

### Transitions and transversions

Transitions (Ts) are substitutions between chemically similar bases: A↔G (purines) and C↔T (pyrimidines). Transversions (Tv) are substitutions between dissimilar bases: A↔C, A↔T, G↔C, G↔T.

Biological mutation rates favour transitions over transversions, so the Ts/Tv ratio is a standard quality indicator:

| Ts/Tv ratio | Context |
|-------------|---------|
| ≥ 2.8 | Expected for whole-exome sequencing |
| ~2.0–2.1 | Expected for whole-genome sequencing |
| ≥ 1.8 | Generally acceptable for WGS |
| < 1.8 | May indicate false positives or low-quality calls |

::: warning Low Ts/Tv
A Ts/Tv below 1.8 often signals a high false-positive rate in the callset. This typically appears when variant caller quality thresholds are too permissive, or when the sample has very low coverage. Consider tightening QUAL or FILTER thresholds before downstream analysis.
:::

### Per-sample statistics (multi-sample VCF)

When the input VCF contains multiple samples, `bcftools stats` reports per-sample counts:

| Metric | Description |
|--------|-------------|
| Homozygous ref | Sites where the sample is homozygous reference |
| Homozygous alt | Sites where the sample is homozygous alternate |
| Heterozygous | Sites where the sample is heterozygous |
| Ts/Tv (per sample) | Per-sample transition-to-transversion ratio |

High variability in per-sample Ts/Tv within the same cohort may indicate technical differences between samples (e.g., different sequencing batches or coverage levels).
