# AI Tools

AI Tools are pipeline capabilities that use AI Models. They are not Plugins.
Plugins are `.lia` bundles; AI Tools are built-in Liatir tools that can select
and run compatible local AI Models.

## How they work

An AI Tool receives typed pipeline inputs, selects a compatible AI Model, runs a
local runtime, and writes normal Liatir outputs. The output can then be connected
to other tools, visualizations, or reports.

AI Tools follow the same workflow expectations as other Liatir tools:

- clear inputs;
- disabled controls only while that specific run is active;
- visible Jobs entry during long work;
- Results entry after completion;
- logs and understandable errors;
- output provenance.

## Current AI Tool families

### Single-cell annotation

Uses CellTypist to annotate `.h5ad` / AnnData files and produce labels,
summaries, and confidence-like outputs.

### Sequence embedding

Uses Nucleotide Transformer models for DNA/RNA and ESM-2 for protein sequences.
Outputs embeddings and basic metrics.

### Protein structure prediction

Uses Boltz-2 or Chai-1 where compatible. Outputs structure files and
viewer-compatible artifacts when prediction succeeds.

### Genomic variant effect scoring

Uses sequence model embeddings to compare reference and alternate sequence
windows. Outputs scores, summaries, and genome-browser-friendly artifacts where
supported.

## Reading results

AI outputs are useful signals, not automatic biological conclusions. Check the
input preparation, model page, license, hardware notes, and provenance before
using a result in important decisions.
