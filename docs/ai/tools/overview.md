# AI Tools

AI Tools are built-in scientific tasks that use compatible installed AI Models.
They are not `.lia` Plugins and they do not install their own model dependencies.

## Available AI Tools

| AI Tool | Compatible AI Models | Main output |
| --- | --- | --- |
| [Single-cell Embedding](/ai/tools/single-cell-embedding) | Geneformer V1 10M, scGPT Whole-human, UCE 4-layer | embedded AnnData, CSV preview, JSON summary, provenance |
| [Structure Prediction](/ai/tools/structure-prediction) | Boltz-2, Protenix base v1.0.0 | predicted structure as mmCIF, confidence scores |
| [Protein–Ligand Affinity](/ai/tools/protein-ligand-affinity) | Boltz-2 | binding probability, predicted strength, predicted complex |
| [MHC-I Epitope Prediction](/ai/tools/mhc-epitope-prediction) | MHCflurry Class I Presentation | ranked peptide–allele table, top peptides as FASTA |

In the app, Single-cell Embedding and MHC-I Epitope Prediction run from their AI
Model's page, and Structure Prediction and Protein–Ligand Affinity under
**Tools → Structure Prediction**. All four are also pipeline steps.

The model selector shows only installed models allowed by the tool contract.
The same tool can run directly from an AI Model page or as a repeatable pipeline
step.

## Reading results

Check the input gene identifiers, species, warnings, embedding dimensions, and
Runtime Box provenance before using an embedding downstream. Model output is a
scientific artifact to validate, not an automatic biological conclusion.
