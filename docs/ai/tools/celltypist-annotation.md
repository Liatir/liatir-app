# CellTypist Annotation

CellTypist Annotation labels cells in a single-cell dataset using a local
CellTypist AI Model.

## Use it for

- first-pass cell-type annotation;
- checking whether a dataset roughly matches a known reference;
- preparing a single-cell dataset for later exploration.

## Inputs

- AnnData `.h5ad` file.
- CellTypist model name, for example `Immune_All_Low.pkl`.
- Optional majority voting.

The `.h5ad` file should contain normalized expression values. Raw counts can
fail or produce poor labels.

## Outputs

- CSV with predicted labels.
- JSON summary.
- Cell count.
- Label count.
- Top label fraction.
- Provenance.

## How to read the result

Start with the label distribution table. If one label dominates almost all
cells, ask whether that makes sense for the dataset.

The top label fraction is the fraction of cells assigned to the most common
label. A very high value can be correct for a purified dataset, but suspicious
for a diverse tissue sample.

## Good first pipeline

1. Add a small `.h5ad` file to Data.
2. Install CellTypist Local Annotation.
3. Add CellTypist Annotation to a pipeline.
4. Select the `.h5ad` file and model.
5. Run and inspect labels in Results.

## Technical details

Tool ID: `ai-celltypist-annotate`

Compatible model:

- [CellTypist Local Annotation](/ai/models/celltypist-local-annotation)

Outputs follow the shared Liatir tool output contract and include provenance
with model ID, runtime, input file, selected CellTypist model, and majority
voting setting.
