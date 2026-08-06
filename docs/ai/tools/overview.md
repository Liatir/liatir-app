# AI Tools

AI Tools are built-in scientific tasks that use compatible installed AI Models.
They are not `.lia` Plugins and they do not install their own model dependencies.

## Available AI Tool

| AI Tool | Compatible AI Models | Main output |
| --- | --- | --- |
| [Single-cell Embedding](/ai/tools/single-cell-embedding) | Geneformer V1 10M, scGPT Whole-human, UCE 4-layer | embedded AnnData, CSV preview, JSON summary, provenance |

The model selector shows only installed models allowed by the tool contract.
The same tool can run directly from an AI Model page or as a repeatable pipeline
step.

## Reading results

Check the input gene identifiers, species, warnings, embedding dimensions, and
Runtime Box provenance before using an embedding downstream. Model output is a
scientific artifact to validate, not an automatic biological conclusion.
