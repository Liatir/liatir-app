# SnpEff

Annotate VCF variants with predicted functional effects — missense, stop gained, frameshift, splice-site disruption, and more.

## What it does

SnpEff maps each variant to the transcripts it overlaps and assigns:

- **Effect** — `missense_variant`, `stop_gained`, `splice_donor_variant`, etc. (Sequence Ontology terms)
- **Impact** — `HIGH`, `MODERATE`, `LOW`, or `MODIFIER`
- **Gene / transcript** — gene symbol, Ensembl ID, HGVS notation (coding + protein)

Results are written to the `ANN` INFO field of the output VCF so every downstream tool can read them.

## Requirements

| Dependency | Why |
|---|---|
| **Java ≥ 8** | SnpEff is a Java application |
| **snpEff.jar** | The SnpEff JAR — configure or download inside Liatir |
| **Genome database** | Per-genome annotation data (`snpEffectPredictor.bin`) |

## Setup

### Step 1 — Configure the JAR

You can either:

- **Browse** for an existing `snpEff.jar` on your machine, or
- **Download** the latest SnpEff bundle from the official source directly inside Liatir. The download runs in the background with progress, speed, and pause/resume support.

The JAR path is saved to `{app_data}/snpeff-config.json` and persists across restarts.

### Step 2 — Download a genome database

Select a genome from the dropdown or type a custom ID (e.g. `GRCh38.p14`). Liatir runs:

```
java -jar snpEff.jar download <genome> -dataDir <dir>
```

Available built-in genomes:

| ID | Build |
|---|---|
| `hg38` | Human GRCh38 |
| `hg19` | Human GRCh37 |
| `GRCh38.105` | Human GRCh38.105 (Ensembl) |
| `mm39` | Mouse GRCm39 |
| `mm10` | Mouse GRCm38 |
| `rn7` | Rat mRatBN7.2 |
| `danRer11` | Zebrafish GRCz11 |
| `dm6` | Drosophila BDGP6 |
| `ce11` | C. elegans WBcel235 |
| `sacCer3` | Yeast R64 |

## Running annotation

With JAR and genome ready, select a VCF/VCF.gz file and click **Annotate**. Liatir runs:

```
java -Xmx4g -jar snpEff.jar ann \
  -dataDir <dir> \
  -noStats -noLog \
  <genome> \
  <input.vcf>
```

Output is written to `{data}/tool-outputs/snpeff-{runId}.vcf`.

## Output

### Summary stats

| Stat | Description |
|---|---|
| Total variants | All records processed |
| HIGH impact | Stop gained, frameshift, splice site |
| MODERATE impact | Missense, in-frame indel |
| LOW impact | Synonymous, splice region |

### ANN field

Each variant gets an `ANN=` INFO field with one entry per overlapping transcript:

```
ANN=A|missense_variant|MODERATE|BRCA1|ENSG00000012048|
    transcript|ENST00000357654.9|protein_coding|
    18/23|c.5266dupC|p.Gln1756fs|...
```

Pipe-separated fields (simplified): allele | effect | impact | gene name | gene ID | feature type | feature ID | biotype | exon rank | HGVS.c | HGVS.p | …

## Pipeline use

```json
{
  "id": "annotate-variants",
  "type": "native-tool",
  "tool": "snpeff",
  "inputs": {
    "inputFile": "{{ outputs.filter.vcf }}",
    "genome": "hg38"
  }
}
```

## Troubleshooting

**Java not found** — install Java 8+ from your package manager and make sure `java` is on `PATH`.

**Database download fails** — SnpEff fetches databases from `snpeff.sourceforge.net`. Check your network or firewall settings.

**Out of memory** — the default heap is `-Xmx4g`. For very large VCFs on memory-constrained machines consider closing other apps first.

**Wrong genome ID** — SnpEff genome IDs are case-sensitive. Check the full list at `snpeff.sourceforge.net/download.html`.
