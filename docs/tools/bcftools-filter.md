# BCFtools filter

`bcftools filter` removes variant records from a VCF or BCF file that do not meet a quality expression. The output is a bgzip-compressed VCF (`.vcf.gz`) that can be registered in the Data library and passed to downstream tools.

## Details

| Property | Value |
|----------|-------|
| Type | Native tool |
| Binary | `bcftools` |
| Subcommand | `filter -i` (include mode) |

## Installation

Nothing to install. This tool ships inside Liatir and runs at the version this
release was tested with; it updates when Liatir updates. The tool page shows
**Included with Liatir** and the version it is running.

On Windows it runs through WSL2 — see
[Windows and WSL2](/tools/overview#windows-and-wsl2).

## Accepted inputs

| Extension | Description |
|-----------|-------------|
| `.vcf` | Uncompressed VCF |
| `.vcf.gz` | Bgzip-compressed VCF |
| `.bcf` | Binary call format |
| `.bcf.gz` | Compressed BCF |

## Running BCFtools filter

1. Navigate to **Tools → BCFtools filter**.
2. Select a VCF or BCF file from your Data library.
3. Choose a preset or write a custom filter expression.
4. Click **Run filter**.

Liatir runs the selected filter expression and shows the compressed VCF output in the results panel.

## Filter expression syntax

The `-i` flag operates in **include** mode: only variants that satisfy the expression are kept. Variants that do not match are removed.

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `QUAL` | float | Phred-scaled variant quality |
| `DP` | integer | Total read depth at the site |
| `AF` | float | Allele frequency (if present in INFO) |
| `FILTER` | string | Filter field value (`"PASS"`, `"."`, etc.) |
| `TYPE` | string | Variant type: `"snp"`, `"indel"`, `"mnp"`, `"other"` |
| `INFO/DP` | integer | Depth from INFO field (same as `DP` for most callers) |
| `FORMAT/GQ` | integer | Genotype quality per sample |

### Operators

| Operator | Meaning |
|----------|---------|
| `>`, `<`, `>=`, `<=` | Numeric comparison |
| `=`, `==` | Equality |
| `!=` | Not equal |
| `&&` | Logical AND |
| `\|\|` | Logical OR |
| `!` | Logical NOT |

### Preset expressions

| Preset | Expression | Use case |
|--------|-----------|---------|
| PASS only | `FILTER="PASS"` | Keep only variants that passed the caller's internal filters |
| QUAL > 20 | `QUAL>20` | Basic quality gate; common minimum for variant analysis |
| QUAL > 30 | `QUAL>30` | Stricter quality gate |
| QUAL + depth | `QUAL>20 && DP>10` | Combined quality and coverage filter |
| SNPs only | `TYPE="snp"` | Keep only SNPs, discard indels |
| Indels only | `TYPE="indel"` | Keep only indels |

### Custom examples

```
# High-confidence SNPs
TYPE="snp" && QUAL>30 && DP>20

# Only PASS variants with allele frequency > 5%
FILTER="PASS" && AF>0.05

# Variants on a specific chromosome (requires region syntax instead)
# Use bcftools view -r chr1 for region filtering
```

::: tip Filter vs Annotate
`bcftools filter` removes non-matching records from the output entirely. If you want to keep all records but mark the filtered ones (soft-filtering), use `bcftools filter` without `-i`/`-x` and instead use the `-s` flag to set a FILTER tag. The Liatir implementation uses hard-filtering (`-i` include mode) for simplicity.
:::

## Output

The filtered output is a bgzip-compressed VCF (`.vcf.gz`). It appears in the results panel with:

- **Add to Data** — registers the filtered VCF in the Data library for immediate use as input to BCFtools stats, SnpEff, or any downstream step.
- **Save as…** — copies the file to a location you choose via the system save dialog.

After filtering, run [BCFtools stats](/tools/bcftools) on the filtered output to verify the Ts/Tv ratio and variant counts are within expected ranges.
