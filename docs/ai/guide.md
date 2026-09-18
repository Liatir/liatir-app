# Local AI for bioinformatics

Liatir runs supported scientific AI Models locally through signed Runtime Boxes.
A Runtime Box contains the model weights, Python interpreter, packages, and
Liatir runner that were tested together. Liatir does not install model packages
into your system Python.

## AI Models and AI Tools

An **AI Model** is the packaged scientific model. An **AI Tool** is the task
that sends an input to a compatible installed model and turns its output into
Jobs, Results, files, and provenance.

The current product catalog contains:

| AI Model | Current published targets | Main use |
| --- | --- | --- |
| [Geneformer V1 10M](/ai/models/ctheodoris-geneformer-v1-10m) | macOS arm64 Metal; Linux CUDA 12.9; Windows through WSL2 | human single-cell embeddings |
| [scGPT Whole-human](/ai/models/bowang-scgpt-whole-human) | macOS arm64 Metal; Linux CPU; Linux CUDA 12.9; Windows through WSL2 | human single-cell embeddings |
| [UCE 4-layer](/ai/models/snap-stanford-uce-4layer) | macOS arm64 Metal | multi-species single-cell embeddings |
| [Boltz-2](/ai/models/jwohlwend-boltz-2) | Linux CUDA 12.9; Windows through WSL2 | structure prediction and protein–ligand affinity |
| [Protenix base v1.0.0](/ai/models/bytedance-protenix-base-v1-0-0) | Linux CUDA 12.6; Windows through WSL2 | structure prediction |

The AI Tools are [Single-cell Embedding](/ai/tools/single-cell-embedding), and
Structure Prediction and Protein–Ligand Affinity under Tools: the first runs
Boltz-2 or Protenix, the second Boltz-2.
No other AI Model or AI Tool is available until it has its own reviewed,
published Runtime Box path.

## Installation

1. Open **AI Models**.
2. Choose a model compatible with the detected computer.
3. Select **Install**.
4. Liatir downloads the target-specific Runtime Box, verifies its signature and
   hashes, and activates it atomically.
5. The installed model becomes available to direct runs and pipelines.

AI Models are installed once per device and are available to all workspaces.
Removing a model removes its activated Runtime Box and reclaims its disk space.

## Input requirements

All three models accept AnnData `.h5ad` files with raw scRNA-seq counts in
`.X`, but gene identifiers differ:

- Geneformer is human-only and expects Ensembl IDs in `var["ensembl_id"]` or
  `var_names`.
- scGPT is human-only and expects gene symbols in `var["gene_name"]`,
  `var["feature_name"]`, or `var_names`.
- UCE supports the species listed in its run form and expects gene symbols in
  `var_names`.

## Outputs

A successful run creates:

- an embedded AnnData file;
- a lightweight CSV preview;
- a JSON summary;
- model-specific intermediate artifacts when required;
- Runtime Box provenance identifying the exact box release and native target.

The embedded AnnData file is the main scientific artifact. An embedding is a
numeric representation for comparison, clustering, visualization, or later
analysis; it is not a final biological conclusion.

## Hardware support

Liatir installs only a published target that exactly matches the operating
system, architecture, accelerator, memory, and driver constraints.

On Windows, AI Models run through WSL2, the Linux environment Liatir already
requires on Windows: the model you install is the Linux one, on your own NVIDIA
GPU. There are no native Windows model packages, and none are inferred from the
Linux ones.

## Related pages

- [AI Models](/ai/models/overview)
- [AI Tools](/ai/tools/overview)
- [Single-cell Viewer](/visualization/single-cell-viewer)
