# UCE 4-layer

UCE, or Universal Cell Embeddings, creates a numeric representation of each
cell in a single-cell dataset. Those vectors can be used for comparison,
clustering, visualization, and downstream analysis.

## When to use it

Use UCE when you have an AnnData `.h5ad` file and want cell embeddings rather
than cell-type labels.

For a first-pass annotation, start with
[CellTypist Local Annotation](/ai/models/celltypist-local-annotation). For
foundation-model embeddings, use UCE.

## What Liatir installs

Liatir installs UCE as its own isolated AI Model runtime box:

- a Python 3.10/3.11 virtual environment;
- the official UCE source checkout pinned to a verified commit;
- the UCE Python requirements;
- the 4-layer model weights;
- token and species mapping files;
- protein embedding assets used by the model.

This runtime is separate from CellTypist and from every other AI Model.

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

## Technical notes

Liatir currently exposes the official 4-layer UCE workflow. It pins the source
checkout and installs the official package versions used by that workflow. The
larger 33-layer workflow is not exposed yet.

Supported species in the first Liatir runner are:

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
