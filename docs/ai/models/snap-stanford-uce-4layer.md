# UCE 4-layer

UCE, or Universal Cell Embeddings, creates a numeric representation of each
cell in a single-cell dataset. Those vectors can be used for comparison,
clustering, visualization, and downstream analysis.

## When to use it

Use UCE when you have an AnnData `.h5ad` file and want cell embeddings rather
than cell-type labels.

Use UCE when a multi-species foundation-model embedding is the required output.

## What Liatir installs

Liatir installs the signed UCE macOS arm64 Metal Runtime Box, including the
4-layer weights and complete tested environment. Nothing is added to the base
app or system Python.

## Inputs

The direct runner and pipeline AI Tool expect:

- an AnnData `.h5ad` file;
- a species selection;
- optional batch size and CSV preview size settings.

UCE expects the AnnData `.X` matrix to contain scRNA-seq counts. It also expects
`var_names` to contain gene symbols, not Ensembl IDs.

## Outputs

Liatir creates:

- an embedded `.h5ad` file with embeddings stored in `obsm["X_uce"]`;
- a lightweight CSV preview of the first embedded cells;
- a JSON summary with cell count, gene count, embedding size, settings, and
  warnings;
- intermediate files produced by the UCE workflow, marked as intermediate
  artifacts in Results.

The `.h5ad` output is the main scientific artifact. The CSV is intentionally a
preview so large datasets do not create huge duplicate embedding tables.

## Hardware

The UCE model card lists GPU as the system requirement. Liatir allows CPU runs
for small validation datasets, but they can be slow. For repeated or large
single-cell runs, use a GPU-capable workstation.

## Good to know

Liatir currently exposes the official 4-layer UCE workflow. The larger 33-layer
workflow is not available yet.

Supported species are:

- human;
- mouse;
- frog;
- zebrafish;
- mouse lemur;
- pig;
- crab-eating macaque;
- rhesus macaque.

## Official source

- [UCE on GitHub](https://github.com/snap-stanford/UCE)
