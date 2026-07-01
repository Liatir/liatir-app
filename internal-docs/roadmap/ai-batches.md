# AI Development Batches

This page tracks the local AI roadmap for Liatir. Keep it updated when a batch
is completed, partially completed, or deliberately deferred.

## Global rule

Before choosing or integrating real models, verify official sources for license,
hardware requirements, artifact layout, and installation/runtime requirements.

## Batch 0: AI foundations

Status: completed and under stabilization.

- AI Models page for installed and available local models.
- First mock AI Tool for validating pipeline I/O, model selection, logs,
  metrics, artifacts, and provenance.
- Runtime abstraction for Python/venv/managed runtimes, model cache, and initial
  hardware detection.
- Provenance in outputs: model, version, parameters, runtime, inputs, and shared
  I/O contract compliance.

## Batch 1: Practical lightweight AI Tools

Status: implemented and under real-file validation.

- CellTypist for local single-cell annotation.
- AnnData `.h5ad` support for AI single-cell workflows.
- Nucleotide Transformer small/base sequence embeddings.
- Generic DNA/protein sequence embedding tool.
- Outputs: embeddings, labels, CSV/JSON, basic metrics.
- Simple result UI with tables, confidence, and summary.

## Batch 2: Scientific visualizations

Status: implemented and under visual validation.

- Modular viewers for protein structures and genomic tracks.
- Viewer runtime dependencies installed only when needed.
- Viewer artifacts connected to pipeline outputs and Results.
- Reusable output panels for non-AI tools as well.

Vitessce remains an adapter-oriented future extension rather than a heavy
always-bundled dependency.

## Batch 3: Proteomics AI

Status: implemented and under scientific validation.

- Boltz-2 as the primary local structure/binding runtime.
- Chai-1 as a Linux CUDA-only runtime.
- Inputs: protein FASTA/sequence, optional ligand information, structure
  prediction options.
- Outputs: PDB/mmCIF where available, confidence/affinity metadata where
  available, and viewer-compatible artifacts.

## Batch 4: Predictive genomics

Status: variant-effect slice consolidated; regulatory prediction model coverage
is deliberately deferred to a dedicated managed-runtime slice.

- Larger Nucleotide Transformer support.
- Variant effect scoring based on reference/alternate sequence windows.
- `.vcf` and `.vcf.gz` inputs for sequential variant scoring.
- Genome-track-compatible BED outputs for JBrowse workflows.
- Inputs: FASTA/VCF/VCF.GZ/BED/sequence window depending on tool.
- Outputs: scores, embeddings, tracks, and reports.

Regulatory prediction candidates such as Enformer, Basenji, and Borzoi need a
separate runtime/dependency plan before being added as installable AI Models.

## Batch 5: Single-cell foundation models

Status: planned.

- scGPT for embeddings, batch correction, and perturbation hypotheses.
- Geneformer for cell representations and gene/network insights.
- UCE/scFoundation as advanced candidates.
- Inputs: `.h5ad`, matrix, metadata.
- Outputs: embeddings, UMAP-ready data, labels, gene programs, perturbation
  predictions.
- Visualization with Vitessce.

## Batch 6: Simulations and biophysics

Status: planned.

- OpenMM as the first managed local engine.
- GROMACS as a more advanced external dependency.
- Workflows: prepare system, minimize, run molecular dynamics, analyze
  trajectory.
- Outputs: trajectories, energies, plots, and structure snapshots.
- 3D viewer support for trajectories and frames.

## Batch 7: Advanced generative AI

Status: planned.

- BioEmu for protein conformational ensembles.
- RFdiffusion plus ProteinMPNN for protein design.
- Evo 2 as an optional advanced genomic model for serious hardware.
- Clear license, resource, and hardware warnings.
- Dedicated pipelines rather than dumping advanced tools into the general menu.

## Batch 8: Preset pipelines

Status: planned after the underlying tools are stable.

Examples:

- protein sequence to structure prediction to 3D report;
- VCF to variant effect scoring to genome browser track;
- single-cell h5ad to annotation to embeddings to Vitessce;
- FASTA window to regulatory prediction to report;
- protein structure to BioEmu ensemble to comparison viewer.
