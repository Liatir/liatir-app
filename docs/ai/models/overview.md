# AI Models

Liatir exposes only AI Models distributed as signed Runtime Boxes. Each box is
an immutable, target-specific bundle containing the model, interpreter,
dependencies, scientific runner, and legal notices tested together.

## Available models

| AI Model | Input | Published support |
| --- | --- | --- |
| [Geneformer V1 10M](/ai/models/ctheodoris-geneformer-v1-10m) | human AnnData | macOS arm64 Metal; Linux CUDA 12.9; Windows CUDA 12.8 |
| [scGPT Whole-human](/ai/models/bowang-scgpt-whole-human) | human AnnData | macOS arm64 Metal; Linux/Windows CPU; Linux CUDA 12.9; Windows CUDA 12.8 |
| [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) | multi-species AnnData | macOS arm64 Metal |
| [Boltz-2](/ai/models/jwohlwend-boltz-2) | protein, DNA and RNA sequences; small molecules | Linux CUDA 12.9; Windows through WSL2 |

These are the complete product catalog. Models without a published Runtime Box
are not shown as previews and cannot be installed through a legacy path.

## Installation and removal

AI Models are installed globally for the app, not per workspace. Liatir checks
host compatibility before downloading, verifies the selected box before
activation, and records the exact activated release. Removing a model removes
its Runtime Box from the device.

## Running a model

The single-cell models run through
[Single-cell Embedding](/ai/tools/single-cell-embedding), either directly from
the model page or as a pipeline step. Boltz-2 runs from the Structure Prediction
and Protein–Ligand Affinity pages under Tools. Runs produce Jobs, Results,
durable output files, and Runtime Box provenance.
