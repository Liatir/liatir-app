---
id: bio:single-cell
sourceKind: bioinformatics
title: Single-cell analysis
locator: Bioinformatics / Single-cell
---

# Single-cell analysis

Single-cell workflows chain many preprocessing and modelling steps, and each one shapes the final
clusters and labels. Interpretation has to stay aware of that chain.

## What to track

Single-cell interpretation should track assay, species, genome build, feature identifiers, count
preprocessing, quality filtering, normalization, batch effects, embedding method, clustering
resolution, marker evidence, and uncertainty.

## Embeddings and automated labels need validation

Foundation-model embeddings and automated labels require validation against known biology and
independent markers. A confident label is not, on its own, evidence.
