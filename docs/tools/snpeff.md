# SnpEff

SnpEff annotates VCF variants with predicted biological effects such as missense, stop gained,
frameshift and splice-site changes.

## What it does

SnpEff adds an `ANN` field to each VCF record. That field identifies the affected gene and
transcript, the predicted effect, and an impact level: `HIGH`, `MODERATE`, `LOW` or `MODIFIER`.

## Requirements

SnpEff needs **Java 21 or newer**. Liatir checks Java separately because Java remains installed on
the computer; SnpEff and SnpSift themselves are managed together by Liatir.

## Setup

1. Click **Download and verify** in the **SnpEff + SnpSift suite** card. Liatir downloads one pinned
   official release, checks its checksum, and keeps it for reuse.
2. Choose a genome database. The species, genome assembly and annotation release are visible before
   download; Liatir checks the database checksum and installs it once.
3. Select a VCF and run the annotation.

The managed catalog currently includes Ensembl release 115 databases for human, mouse, zebrafish,
fruit fly, *C. elegans* and yeast. A database is offered only with the compatible SnpEff release.

Installations and downloads appear in Jobs, continue when you leave the page, and can be cancelled.
Reinstalling the same verified version reuses the local copy without downloading it again.

## Scientific provenance

Every run records:

- the exact SnpEff suite version and archive checksum;
- whether the suite was managed by Liatir or supplied externally;
- the database ID, series and archive checksum;
- the Java memory setting and input VCF.

This matters because changing the annotation release can change the reported effect of a variant.

## Existing external installations

The advanced section can use an existing `snpEff.jar` and database folder. Liatir never deletes or
overwrites those files. Because their origin and contents cannot be proven, runs record them as
**external and unverified**. The managed, verified installation is recommended.

## Output

The main result is an annotated VCF. SnpEff also writes an HTML summary and a gene statistics file;
Liatir records these as supporting files rather than presenting them as separate scientific results.

The annotated VCF can be passed directly to [SnpSift Filter](/tools/snpsift-filter), whose biological
presets read the `ANN` field.

## Pipeline use

SnpEff is also a pipeline node. Connect a VCF, choose a database ID, and Liatir uses the same verified
suite and database as the standalone page.

## Troubleshooting

**Java not found** — install Java 21 or newer. The Dependencies screen gives the command for your
system. On macOS, the built-in `java` placeholder is not a working Java installation; Liatir tests
the command rather than only checking that it exists.

**Out of memory** — increase the Java memory setting or close other memory-heavy applications.

**Database missing** — install the exact database selected in the SnpEff card. Liatir does not fall
back silently to a different annotation release.
