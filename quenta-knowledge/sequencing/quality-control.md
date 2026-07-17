---
id: bio:fastq-qc
sourceKind: bioinformatics
title: FASTQ quality control
locator: Bioinformatics / Sequencing QC
---

# FASTQ quality control

Quality control of raw sequencing reads decides how much the downstream analysis can be trusted.
Read the numbers relative to the assay and the platform, not against a single universal threshold.

## What to inspect

FASTQ QC should consider read count, base-quality profiles, adapter content, duplication, sequence
length, GC distribution, overrepresented sequences, and the assay design.

## Trimming trade-offs

Trimming can remove adapters and low-quality tails, but aggressive trimming may shorten reads, bias
composition, or reduce mappability.

## Interpreting thresholds

Interpret thresholds relative to platform and downstream analysis. A value that is acceptable for one
assay may be a problem for another.
