# AI Tools

AI Tools are the pipeline-ready tasks that use local AI Models. They are not
Plugins: Plugins are `.lia` extensions, while AI Tools are built-in capabilities
that run compatible AI Models.

## Available AI Tools

| AI Tool | Compatible AI Models | Main output |
| --- | --- | --- |
| [CellTypist Annotation](/ai/tools/celltypist-annotation) | CellTypist Local Annotation | cell labels and summary |
| [Sequence Embedding](/ai/tools/sequence-embedding) | Nucleotide Transformer 50M/500M, ESM-2 8M | embedding CSV and JSON summary |
| [Single-cell Embedding](/ai/tools/single-cell-embedding) | UCE 4-layer | embedded AnnData, embedding preview, JSON summary |
| [Genomic Variant Effect](/ai/tools/genomic-variant-effect) | Nucleotide Transformer 50M/500M | variant scores and BED track |
| [Regulatory Prediction](/ai/tools/regulatory-prediction) | Enformer, Basenji2, Borzoi Mini | signal tracks and optional variant deltas |
| [Protein Structure Prediction](/ai/tools/protein-structure-prediction) | Boltz-2 | mmCIF/PDB structure and confidence metadata |

## Direct run or pipeline?

Direct model pages are useful for quick tests. Pipelines are better when you
want repeatable workflows, connected outputs, and a full run history across
multiple steps.

Use a pipeline when:

- one output file should feed another tool;
- you want to repeat the same workflow on more samples;
- you need Results to show the whole parent pipeline;
- you are testing model outputs together with viewers or downstream tools.

## How model selection works

Each AI Tool exposes an AI Model dropdown. Liatir only shows installed models
that match the tool contract.

For example, Protein Structure Prediction will not accept a Nucleotide
Transformer model, because that model creates sequence embeddings and does not
predict structures.

## Common outputs

AI Tools usually create both human-readable Results sections and output files.
Output files are important because later pipeline steps can consume them.

| Output type | What it means |
| --- | --- |
| CSV | Table you can inspect or pass to other tools |
| JSON | Structured summary, metrics, warnings, and provenance |
| BED | Genome-browser track |
| PDB/mmCIF | Protein structure file |
| embeddings | Numeric vectors for comparison, clustering, or downstream analysis |

## Reading scientific confidence

Liatir helps you inspect output, but it does not turn model output into a final
scientific conclusion. Always check:

- the model page;
- input preprocessing requirements;
- warnings;
- provenance;
- whether the model is meant for your organism, tissue, assay, or sequence type.
