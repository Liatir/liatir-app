# Single-cell Viewer

The Single-cell Viewer opens a profiled AnnData artifact together with the
bounded preview produced by Single-cell Embedding.

## Use it for

- confirming that an embedded AnnData result is valid and reusable;
- inspecting the bounded two-dimensional PCA preview produced with the result;
- checking cell count, embedding key, dimensions, and validation state.

## Inputs

- A profiled AnnData `.h5ad` artifact.
- Optionally, the embedding preview CSV produced by Single-cell Embedding.
- Optionally, the `obsm` embedding key when it is not already in artifact metadata.

## How to read the result

Start with cell count, embedding key, validation state, and obvious outliers.
The displayed PCA is calculated only from the bounded preview rows; it is not a
whole-dataset UMAP, clustering, or cell-type annotation. The full embedding
matrix remains in the AnnData artifact.

If a result looks unexpected, inspect input preprocessing, gene identifiers,
species, model provenance, and warnings in Results.

## Related tools

- [Single-cell Embedding](/ai/tools/single-cell-embedding)
