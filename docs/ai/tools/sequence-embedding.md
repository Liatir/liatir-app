# Sequence Embedding

Sequence Embedding turns DNA, RNA, or protein sequences into numeric vectors.

## Use it for

- comparing sequences by model representation;
- creating embedding tables for later analysis;
- testing local sequence models before building a larger pipeline;
- feeding embeddings into downstream custom tools.

## Inputs

- FASTA/FA/FNA/FAA/TXT file, or an inline sequence.
- Molecule type: DNA, RNA, or protein.
- Max tokens.
- Compatible installed AI Model.

If both a file and inline sequence are provided, Liatir uses the file.

## Compatible models

- [Nucleotide Transformer v2 50M](/ai/models/instadeep-nt-v2-50m-multi-species)
- [Nucleotide Transformer v2 500M](/ai/models/instadeep-nt-v2-500m-multi-species)
- [ESM-2 8M Protein](/ai/models/facebook-esm2-8m-protein)

## Outputs

- Embeddings CSV.
- JSON summary.
- Sequence count.
- Embedding dimension.
- Mean sequence length.
- Provenance.

## How to read the result

Do not try to interpret every embedding value manually. An embedding is a vector
that becomes useful when compared, clustered, visualized, or passed to another
tool.

Check:

- sequence count matches what you expected;
- embedding dimension is stable for a model;
- max tokens did not truncate important sequence context;
- molecule type matches the model.

## Good to know

Each sequence becomes a single embedding vector, written to a per-sequence
table. The output is a numeric representation, not a final biological label.
