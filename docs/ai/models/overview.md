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

These are the complete product catalog. Models without a published Runtime Box
are not shown as previews and cannot be installed through a legacy path.

## Installation and removal

AI Models are installed globally for the app, not per workspace. Liatir checks
host compatibility before downloading, verifies the selected box before
activation, and records the exact activated release. Removing a model removes
its Runtime Box from the device.

## Running a model

All current models run through
[Single-cell Embedding](/ai/tools/single-cell-embedding), either directly from
the model page or as a pipeline step. Runs produce Jobs, Results, durable output
files, and Runtime Box provenance.
