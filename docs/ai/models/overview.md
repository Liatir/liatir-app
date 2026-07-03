# AI Models

AI Models are local model runtimes that Liatir can install, manage, and use on
your machine. They are different from Plugins: Plugins are `.lia` extensions,
while AI Models are model assets and runtime packages used by AI Tools.

If you are new to this area, start with [Local AI for bioinformatics](/ai/guide)
before choosing a model.

## What AI Models do

An AI Model provides the local engine behind an AI Tool. For example, a
single-cell annotation tool may use CellTypist, while a sequence embedding tool
may use a Nucleotide Transformer or ESM-2 model.

You can use AI Models in two ways:

- run a model directly from the AI Models page when Liatir provides a direct
  runner;
- select a compatible model inside a pipeline AI Tool.

## Choosing a model

| Goal | Start with | Why |
| --- | --- | --- |
| Annotate single-cell `.h5ad` data | CellTypist Local Annotation | CPU-friendly and practical for first-pass labels |
| Embed DNA/RNA sequence | Nucleotide Transformer v2 50M | Lightest genomic embedding model currently exposed |
| Embed protein sequence | ESM-2 8M Protein | Small protein language model for quick local tests |
| Score small VCF examples | Nucleotide Transformer v2 50M | Faster variant-effect smoke tests |
| Predict regulatory signal | Basenji2 or Enformer | Managed regulatory runtimes with BED outputs |
| Predict protein structure | Boltz-2 | Current primary local structure model |
| Create single-cell foundation embeddings | UCE 4-layer | First managed Batch 5 runtime with AnnData embedding outputs |
| Explore future single-cell foundation models | scGPT, Geneformer, scFoundation | Preview entries documented but not installable yet |

## Installation

AI Models are installed globally for the app, not per workspace. Once a model is
installed, every workspace can use it.

Liatir manages the runtime dependency box for each model. Heavy dependencies are
not bundled into the core app; they are installed only when the model needs
them.

Preview models are different: they are visible in the catalog so you can see the
roadmap and read the docs, but Liatir does not expose Install or Run until the
runtime box and scientific output contract are validated.

## Results and provenance

AI Model runs are recorded like other Liatir analysis runs. Outputs can include
tables, JSON summaries, embeddings, structure files, genome tracks, and viewer
artifacts depending on the model and tool.

Each output should carry provenance:

- model ID and version;
- runtime kind and runtime version;
- input files or sequences;
- user-selected parameters;
- generated output files and metrics.

## Hardware warnings

Some models can run on CPU but may be slow. Others require CUDA GPUs or a
specific operating system. Liatir shows compatibility warnings before install
when the current machine cannot run a model.

Always check the model page before using a result for important scientific
decisions.

## Related AI Tools

- [CellTypist Annotation](/ai/tools/celltypist-annotation)
- [Sequence Embedding](/ai/tools/sequence-embedding)
- [Single-cell Embedding](/ai/tools/single-cell-embedding)
- [Genomic Variant Effect](/ai/tools/genomic-variant-effect)
- [Regulatory Prediction](/ai/tools/regulatory-prediction)
- [Protein Structure Prediction](/ai/tools/protein-structure-prediction)

## Available model pages

- [CellTypist Local Annotation](/ai/models/celltypist-local-annotation)
- [Nucleotide Transformer v2 50M](/ai/models/instadeep-nt-v2-50m-multi-species)
- [Nucleotide Transformer v2 500M](/ai/models/instadeep-nt-v2-500m-multi-species)
- [Enformer Regulatory Prediction](/ai/models/deepmind-enformer-regulatory)
- [Basenji2 Human Regulatory](/ai/models/calico-basenji2-human-regulatory)
- [Borzoi Mini K562 RNA-seq](/ai/models/calico-borzoi-mini-k562-rna)
- [scGPT Whole-human](/ai/models/bowang-scgpt-whole-human)
- [Geneformer V1 10M](/ai/models/ctheodoris-geneformer-v1-10m)
- [UCE 4-layer](/ai/models/snap-stanford-uce-4layer)
- [scFoundation 100M](/ai/models/biomap-scfoundation-100m)
- [ESM-2 8M Protein](/ai/models/facebook-esm2-8m-protein)
- [Boltz-2 Local Structure & Binding](/ai/models/boltz2-local-structure-binding)
