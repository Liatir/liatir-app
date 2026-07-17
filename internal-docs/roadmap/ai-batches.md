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

Status: implemented and under heavy validation.

- Larger Nucleotide Transformer support.
- Variant effect scoring based on reference/alternate sequence windows.
- `.vcf` and `.vcf.gz` inputs for sequential variant scoring.
- Genome-track-compatible BED outputs for JBrowse workflows.
- Enformer, Basenji2, and Borzoi Mini K562 RNA-seq as isolated predictive
  genomics runtime boxes.
- Inputs: FASTA/VCF/VCF.GZ/BED/sequence window depending on tool.
- Outputs: scores, embeddings, tracks, and reports.

Remaining work is validation rather than architecture: heavy install/run test
coverage, scientific output sanity checks, and better model-target UX for the
regulatory target index.

## Batch 5: Single-cell foundation models

Status: in progress. UCE 4-layer and Geneformer V1 10M are implemented as
installable/runnable slices. UCE now has a clean, reproducible macOS arm64
Runtime Box recipe with signed installed-size metadata and post-extraction
self-test evidence. Its KMS-signed beta box is live through the existing
single-cell runner. The exact product runner has passed focused CPU and Apple
Metal runs, complete output-contract validation, numeric backend parity, and a
fresh-home native lifecycle covering signed install, a tracked direct Job, a
finite 1,280-dimensional Result with provenance, Jobs/Results visibility,
removal, and Result artifact survival.
Geneformer uses the live signed Runtime Box distribution for macOS arm64/Metal
and Linux x86_64/CPU, with repeatable native lifecycle plus scientific-parity
evidence on both targets. scGPT has a live signed macOS arm64 Runtime Box,
hash-locked dependencies, real CPU/Metal inference gates, and targeted native
install, Jobs, and removal evidence.
scFoundation remains preview-only because its model license prohibits Liatir
from redistributing the checkpoint.

- scGPT for embeddings, batch correction, and perturbation hypotheses.
- Geneformer for cell representations and gene/network insights.
- UCE 4-layer for zero-shot single-cell embeddings from AnnData.
- scFoundation as an advanced candidate.
- Inputs: `.h5ad`, matrix, metadata.
- Outputs: embeddings, UMAP-ready data, labels, gene programs, perturbation
  predictions.
- Visualization with Vitessce.

Do not enable Install or Run for the remaining preview models until each model
has a validated managed runtime box, explicit model-asset handling, input
validation, output parsing, Jobs, Results, and provenance.

### AI Runtime Box Distribution Foundation

Status: production distribution path live; partially native-verified.

The canonical cross-platform CI implementation plan and gate status are tracked
in [Runtime Box CI foundation](./runtime-box-ci-foundation.md).

- Shared release, channel, target, rollout, revocation, signature, and
  compatibility contracts live in `packages/liatir-core`.
- Repository CLI supports key generation, dependency locking, native build,
  post-extraction verification, local registry serving, immutable R2 publish,
  trust-root publish, channel promotion, and signed revocations.
- The macOS arm64 builder packages full standalone Python plus hash-locked
  dependencies; it does not depend on a user-installed Python at runtime.
- The Runtime Box Registry Worker serves small signed control documents and
  performs authenticated, signature-verified promotions through its R2 binding.
- Production signing is isolated in the `liatir-release-security` Google Cloud
  project. A private Cloud Run service validates exact payload bytes against a
  versioned AI Model/target/origin allowlist, then uses a non-exportable
  Ed25519 Cloud KMS key. Cloudflare never receives signing authority.
- Native installation uses resumable downloads, signed manifest and target
  checks, safe ZIP extraction, a self-test, atomic activation, and rollback per
  `runtimeId`.
- Geneformer V1 10M is the first production recipe. Its signed macOS arm64/Metal
  and Linux x86_64/CPU boxes pass verification, post-extraction imports,
  scientific parity, and native product lifecycle gates; both are published
  under `assets.models.liatir.com` and promoted through the beta channel at
  `models.liatir.com`.
- UCE 4-layer `1.0.0-beta.1` is KMS-signed, published as an immutable
  8,862,120,348-byte archive, promoted through the beta channel, and selected by
  the catalog. Its 10,142,871,337-byte installed payload passed the targeted
  native install/direct-run/Jobs/Results/removal gate on macOS arm64/Metal.

Geneformer evidence now covers a fresh isolated home, interrupted download and
resume, signed install, real inference, atomic replacement, rollback, removal,
and exact CPU parity with the pinned official tokenizer/embedding algorithm on
native macOS arm64 and Linux x86_64 targets.
The remaining distribution gates are a true cross-version native update and
client-persisted anti-replay state for signed channel generations. The KMS
signing key is non-exportable, IAM-restricted, and independently hosted from R2;
same-version atomic replacement and rollback are already covered natively.

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
