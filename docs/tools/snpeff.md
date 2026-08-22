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
| **Java ≥ 21** | SnpEff is a Java application, and recent releases need Java 21 |
| **snpEff.jar** | The SnpEff JAR — configure or download inside Liatir |
| **Genome database** | Per-genome annotation data (`snpEffectPredictor.bin`) |

## Setup

### Step 1 — Configure the JAR

You can either:

- **Browse** for an existing `snpEff.jar` on your machine, or
- **Download** the latest SnpEff bundle from the official source directly inside Liatir. The download runs in the background with progress, speed, and pause/resume support.

The JAR path is saved by Liatir and persists across restarts.

### Step 2 — Download a genome database

Select a genome from the dropdown or type a custom ID (e.g. `GRCh38.p14`). Liatir downloads the matching annotation database directly, with progress, speed, and pause/resume support, and installs it for you.

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

The annotated VCF appears in the results panel and can be added to the Data library.

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

SnpEff works as a normal pipeline node: connect a VCF output (for example from
[BCFtools filter](/tools/bcftools-filter)) into its input and pick a genome. See
the [Pipelines](/pipeline/overview) section.

## Troubleshooting

**Java not found** — install Java 21 or newer. Liatir's Dependencies screen lists the exact command
for your system.

On macOS, seeing a `java` command in a terminal does not mean Java is installed: the system ships a
placeholder of that name that is present even when no Java is. Liatir checks whether it answers, so
it can report Java as missing on a machine where the command appears to exist — that is the
placeholder, and installing a real JDK is the fix.

**Database download fails** — check your network or firewall settings, then try the download again.

**Out of memory** — very large VCFs on memory-constrained machines can run out of heap; consider closing other apps first.

**Wrong genome ID** — SnpEff genome IDs are case-sensitive. Pick one from the dropdown, or double-check a custom ID against the official [SnpEff database list](https://pcingola.github.io/SnpEff/).
