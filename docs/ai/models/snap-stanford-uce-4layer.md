# UCE 4-layer

UCE, or Universal Cell Embeddings, is a zero-shot foundation model for
single-cell gene expression data.

## What it does

UCE embeds cells from AnnData datasets so they can be compared or visualized in a
shared representation space. The official workflow focuses on `.h5ad` inputs.

## Current status in Liatir

This model is visible as a preview. Install and run are not enabled until Liatir
adds a dedicated runtime box for the UCE scripts, requirements, model files, and
output contract.

## Expected inputs

- AnnData `.h5ad` file.
- Species selection.
- Batch size and embedding options.

## Expected outputs

- Cell embeddings.
- Intermediate processing files when needed.
- CSV/JSON summaries and provenance.

## Hardware and installation

The official repository includes a PyTorch workflow. Model files can be
downloaded by the official script, but Liatir still needs to manage those assets
directly before exposing the model as installable.

## Official source

- [UCE on GitHub](https://github.com/snap-stanford/UCE)
