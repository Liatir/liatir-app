# CellTypist Local Annotation

CellTypist helps annotate single-cell RNA-seq datasets by comparing cells to
trained reference models. In Liatir, it is used for local `.h5ad` / AnnData
workflows.

## What it does

CellTypist takes an AnnData file and predicts likely cell labels. It can also
apply majority voting to smooth labels across nearby cells when that option is
enabled.

## When to use it

Use this model when you have a single-cell dataset and want a first-pass cell
type annotation. It is useful for exploration, quality checks, and preparing a
dataset for deeper single-cell analysis.

## Inputs in Liatir

- AnnData `.h5ad` file.
- CellTypist model name, such as `Immune_All_Low.pkl`.
- Optional majority voting.

CellTypist expects normalized single-cell expression data. If the matrix is raw
counts, the run may fail or produce misleading labels.

## Outputs

Liatir can produce:

- predicted labels;
- confidence-like scores where available;
- CSV/JSON summaries;
- output provenance with model, parameters, input file, and runtime metadata.

## How to interpret results

Read the label distribution first. If the top label covers nearly all cells,
check whether that matches the biology of the dataset.

CellTypist labels are reference-based suggestions. A wrong tissue, species,
assay, or preprocessing method can produce confident but misleading labels.

## Hardware and installation

CellTypist runs on CPU and does not require a GPU. Memory use depends mostly on
the size of the AnnData matrix.

Liatir installs CellTypist in an isolated managed Python runtime.

## Limits and cautions

Cell annotation depends on the reference model. A label can be wrong if the
dataset, species, tissue, assay, or preprocessing does not match the reference
well. Treat the result as an annotation aid, not as a final biological claim.

## Official source

- [CellTypist on GitHub](https://github.com/Teichlab/celltypist)

## Related tool

- [CellTypist Annotation](/ai/tools/celltypist-annotation)
