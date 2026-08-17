# Your first analysis

This path creates a local single-cell embedding, opens its preview, and keeps
the produced AnnData available for another tool or pipeline.

## Before you start

You need:

- a compatible AnnData `.h5ad` file;
- enough free disk space for one supported AI Model;
- a macOS arm64 machine for the currently complete local Beta path.

Geneformer and scGPT expect human data. UCE supports additional species but
has different gene-identifier requirements. Review the model page before
interpreting an output.

## Run the no-code workflow

1. Open **Data** and add the `.h5ad` file. Liatir records its path without
   copying or uploading it.
2. Open **AI Models**, choose a model compatible with your machine and select
   **Install**. This is an explicit network operation and may use substantial
   disk space.
3. Open **Pipelines** and choose **Single-cell embedding and preview**.
4. Select the AnnData input and installed AI Model, then run the pipeline.
5. Follow the analysis in **Jobs**. You can navigate elsewhere while it runs.
6. Open the final entry in **Results** and inspect the single-cell preview,
   warnings and provenance.
7. Add the embedded AnnData to **Data** or connect it to a downstream pipeline
   step. Use the AnnData output for scientific work; the bounded CSV/PCA view is
   only a preview.

The direct **Single-cell Embedding** AI Tool uses the same input contract and
finalizer as the pipeline step.

## Try a Nextflow workflow

If Nextflow and Java are already installed on a supported execution host, save
the workflow under **Tools → External Workflows**. The same saved definition can
run by itself or appear in a Liatir pipeline. Declare outputs explicitly so
they become Liatir artifacts that can feed later tools without searching the
Nextflow work directory.

See [External Workflows](/tools/external-workflows) for platform requirements,
reproducible revisions, cancellation and resume behavior.

## What to record

Before sharing a result, keep the Liatir Result and check:

- input identity and scientific compatibility;
- model/runtime or Nextflow/Java versions;
- parameters, warnings and exit status;
- output digest and lineage;
- whether the preview represents the whole dataset or a bounded sample.

An embedding is not a cell annotation or a clinical conclusion.

