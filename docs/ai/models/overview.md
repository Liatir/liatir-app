# AI Models

Liatir exposes only AI Models distributed as signed Runtime Boxes. Each box is
an immutable, target-specific bundle containing the model, interpreter,
dependencies, scientific runner, and legal notices tested together.

## Available models

| AI Model | Input | Published support |
| --- | --- | --- |
| [Geneformer V1 10M](/ai/models/ctheodoris-geneformer-v1-10m) | human AnnData | macOS arm64 Metal; Linux CUDA 12.9; Windows through WSL2 |
| [scGPT Whole-human](/ai/models/bowang-scgpt-whole-human) | human AnnData | macOS arm64 Metal; Linux CPU; Linux CUDA 12.9; Windows through WSL2 |
| [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) | multi-species AnnData | macOS arm64 Metal |
| [Boltz-2](/ai/models/jwohlwend-boltz-2) | protein, DNA and RNA sequences; small molecules | Linux CUDA 12.9; Windows through WSL2 |
| [Protenix base v1.0.0](/ai/models/bytedance-protenix-base-v1-0-0) | protein, DNA and RNA sequences; small molecules | Linux CUDA 12.6; Windows through WSL2 |
| [MHCflurry Class I Presentation](/ai/models/openvax-mhcflurry-class1-presentation) | protein sequences or peptide lists | macOS arm64 Metal; Linux CPU; Windows through WSL2 |

These are the complete product catalog. Models without a published Runtime Box
are not shown as previews and cannot be installed through a legacy path.

## Installation and removal

AI Models are installed globally for the app, not per workspace. Liatir checks
host compatibility before downloading, verifies the selected box before
activation, and records the exact activated release. Removing a model removes
its Runtime Box from the device.

## Running a model

Each model runs through its [AI Tool](/ai/tools/overview):

| AI Model | AI Tool |
| --- | --- |
| Geneformer V1 10M, scGPT Whole-human, UCE 4-layer | [Single-cell Embedding](/ai/tools/single-cell-embedding) |
| Boltz-2, Protenix base v1.0.0 | [Structure Prediction](/ai/tools/structure-prediction) |
| Boltz-2 | [Protein–Ligand Affinity](/ai/tools/protein-ligand-affinity) |
| MHCflurry Class I Presentation | [MHC-I Epitope Prediction](/ai/tools/mhc-epitope-prediction) |

Each can run directly from the model's page or as a pipeline step. Runs produce
Jobs, Results, durable output files, and Runtime Box provenance.
