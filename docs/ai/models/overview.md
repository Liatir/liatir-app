# AI Models

AI Models are local model runtimes that Liatir can install, manage, and use on
your machine. They are different from Plugins: Plugins are `.lia` extensions,
while AI Models are model assets and runtime packages used by AI Tools.

## What AI Models do

An AI Model provides the local engine behind an AI Tool. For example, a
single-cell annotation tool may use CellTypist, while a sequence embedding tool
may use a Nucleotide Transformer or ESM-2 model.

You can use AI Models in two ways:

- run a model directly from the AI Models page when Liatir provides a direct
  runner;
- select a compatible model inside a pipeline AI Tool.

## Installation

AI Models are installed globally for the app, not per workspace. Once a model is
installed, every workspace can use it.

Liatir manages the runtime dependency box for each model. Heavy dependencies are
not bundled into the core app; they are installed only when the model needs
them.

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

## Available model pages

- [CellTypist Local Annotation](/ai/models/celltypist-local-annotation)
- [Nucleotide Transformer v2 50M](/ai/models/instadeep-nt-v2-50m-multi-species)
- [Nucleotide Transformer v2 500M](/ai/models/instadeep-nt-v2-500m-multi-species)
- [Enformer Regulatory Prediction](/ai/models/deepmind-enformer-regulatory)
- [Basenji2 Human Regulatory](/ai/models/calico-basenji2-human-regulatory)
- [Borzoi Mini K562 RNA-seq](/ai/models/calico-borzoi-mini-k562-rna)
- [ESM-2 8M Protein](/ai/models/facebook-esm2-8m-protein)
- [Boltz-2 Local Structure & Binding](/ai/models/boltz2-local-structure-binding)
