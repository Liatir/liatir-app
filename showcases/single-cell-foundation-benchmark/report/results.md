# Single-cell showcase: measured results, study in progress

This is an interim report for the Windows/WSL2 transfer on 2026-10-05.
The complete two-dataset study is **not finished**. PBMC has final biological,
batch and computational measurements; pancreas has four saved representations
but has not reached common evaluation. No missing scientific scores are inferred.

## Complete PBMC measurements

Native Liatir run `7afd5cd1-2911-45c7-be7f-28cb212734ca` evaluated all 11,990
cells, using the shared stratified split of 9,592 training and 2,398 test cells,
seed 23. The source is scvi-tools 1.3.3's PBMC dataset, derived from original
10x Cell Ranger 2.1.0 PBMC8k and PBMC4k. The prepared input has 3,346 genes,
two batches and nine cell labels. Exact source and input hashes are retained in
[the native-run manifest](../validation/native-study-runs.json).

All runs below used Apple M1, 16 GiB RAM, macOS 14.4.1, CPU only, one numerical
thread and one-cell pretrained-model batches. ARI and NMI quantify agreement
between clusters and supplied labels. Macro-F1 averages classifier performance
equally across cell labels. Runtime includes the recorded worker's imports and
serialization; it excludes shared data preparation and downstream evaluation.

| Method | ARI | NMI | kNN macro-F1 | Logistic macro-F1 | Runtime, seconds |
| --- | ---: | ---: | ---: | ---: | ---: |
| PCA | 0.753176 | 0.785865 | 0.930080 | 0.928797 | 7.514707 |
| Geneformer V1 10M | 0.289057 | 0.467074 | 0.783323 | 0.839462 | 804.100734 |
| Harmony | 0.706194 | 0.786775 | 0.922990 | 0.932409 | 15.195992 |
| scVI | 0.541796 | 0.730091 | 0.927143 | 0.949159 | 249.217064 |
| scGPT whole-human | 0.669258 | 0.785832 | 0.927564 | 0.956852 | 4994.065955 |
| UCE 4-layer | null | null | null | null | preflight only |

The exact, unrounded scores, cell-type silhouettes, batch silhouettes, ASW-batch,
graph connectivity, neighborhood mixing and all measured costs are in
[summary.csv](../validation/completed-pbmc/summary.csv) and
[summary.json](../validation/completed-pbmc/summary.json). They contain only
the six PBMC configurations, not the required final twelve-row combined study.
The separately transferred native output contains all PBMC figures and logs.

UCE's checkpoint storage requires 3,403,469,828 resident bytes, exceeding the
approved 2,147,483,648-byte process-family ceiling. The actual preflight refused
allocation and retained its failure configuration and logs. Its elapsed time and
memory are preflight costs, not embedding-generation costs or model scores.

## Pancreas progress and interruption

The canonical scIB pancreas source is Figshare file 24539828, source SHA-256
`97e6dfd65553e4d10aa3ef5d904362970a75c677c31d70fabc9234191a09db8c`.
It supplies 16,382 cells, 19,093 genes, nine batches and fourteen cell labels.
Its original count-layer values are preserved, including fractional values.

Native run `6071da5e-c592-4ee3-8544-7bbe5b12be8f` saved PCA, Geneformer,
Harmony and scVI embeddings, provenance and final telemetry. Their measured
worker runtimes are respectively 7.941703, 8448.011730, 22.929402 and
333.287910 seconds. These are completed representation stages, not final
biological or batch scores. The inference host and approved limits are unchanged.

scGPT logged 10,752 / 16,382 cells before the session interruption. It saved no
partial embedding and no final telemetry; that work cannot be resumed from the
progress log. UCE had not yet been attempted in this run. Pancreas evaluation,
figures, final summaries and independent reproduction remain open.

## Interpretation boundaries

These are observations from one fixed seed and one PBMC dataset. They establish
neither statistical superiority nor generalization to unseen studies. scVI trains
on the evaluation data and is interpreted separately from zero-shot pretrained
inference. Individual quality and cost metrics remain visible; no combined
winner score is defined. Any resumed Linux execution must retain its own host
identity and must not be presented as a same-host runtime comparison with Mac
measurements. See [limitations.md](limitations.md).
