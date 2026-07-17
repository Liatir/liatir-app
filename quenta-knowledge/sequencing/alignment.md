---
id: bio:alignment
sourceKind: bioinformatics
title: Read alignment
locator: Bioinformatics / Alignment
---

# Read alignment

Aligning reads to a reference is where most provenance is either preserved or lost. Interpretation
depends on knowing exactly how the alignment was produced.

## What to interpret

Alignment interpretation should include reference build, aligner and version, preset, paired-end
handling, mapping rate, secondary and supplementary alignments, MAPQ, insert size where relevant,
duplicate policy, and reference compatibility.

## Alignment formats — SAM, BAM, CRAM

SAM is textual; BAM and CRAM are compressed alignment formats. They carry the same information at
different sizes and access costs.

## Mapping rate is not validity

A high mapping rate alone does not establish biological validity. It must be read together with the
reference used, mapping quality, and the assay design.
