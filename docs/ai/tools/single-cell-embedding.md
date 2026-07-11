# Single-cell Embedding

Single-cell Embedding is an AI Tool that creates numeric vectors for cells in an
AnnData `.h5ad` dataset.

Supported backends are [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) and
[Geneformer V1 10M](/ai/models/ctheodoris-geneformer-v1-10m).

## What it does

The tool reads a single-cell dataset and asks the selected foundation model to
compute one embedding vector per cell. Similar cells should usually have more
similar vectors, so the output can be useful for exploration, visualization,
clustering, and downstream analysis.

This is different from annotation. Annotation gives cells labels. Embedding
creates a representation that other tools can inspect.

## Inputs

| Input | Meaning |
| --- | --- |
| AI Model | Installed UCE 4-layer or Geneformer V1 10M |
| AnnData file | `.h5ad` file from Data |
| Species | Organism matching the dataset |
| Batch size | Number of cells processed together |
| CSV preview rows | Number of cells exported to the lightweight CSV preview |

The AnnData `.X` matrix should contain raw scRNA-seq counts. UCE expects gene
symbols in `var_names`. Geneformer V1 is human-only and expects Ensembl IDs in
`var["ensembl_id"]` or `var_names`.

## Outputs

| Output | Meaning |
| --- | --- |
| Embedded AnnData | Main `.h5ad` artifact with `obsm["X_uce"]` or `obsm["X_geneformer"]` |
| Embedding preview CSV | Small table for quick inspection |
| Summary JSON | Counts, dimensions, settings, warnings, and provenance |
| Intermediate files | UCE processing artifacts when UCE is selected, marked as intermediate |

Use the embedded AnnData file for downstream scientific work. The CSV preview is
only meant for quick inspection.

## In pipelines

Use this tool when you want:

- `h5ad -> single-cell embedding -> viewer/report`;
- `h5ad -> embedding -> downstream script/plugin`;
- a reusable cell-embedding step before visualization.

In the pipeline editor, the AI Model dropdown only shows compatible installed
models.

## Reading the result

Check:

- cell count and gene count;
- embedding dimensions;
- warnings about input format;
- provenance;
- whether the species matches the dataset.

Embeddings are not a final biological conclusion. They are a representation to
inspect, compare, and validate.
