# Scientific AI Workbench Product Plan

This document is the canonical product direction and execution sequence for
Liatir during and after the current Runtime Box CI foundation program. It turns
the existing feature inventory into one coherent product: a local-first
scientific AI workbench for life sciences.

It does not replace the evidence ledgers:

- [Runtime Box CI foundation](./runtime-box-ci-foundation.md) owns the active
  cross-platform Runtime Box gate state;
- [AI development batches](./ai-batches.md) records what has been implemented
  or validated by model family;
- [Beta 1 readiness](./beta-readiness.md) owns cross-surface release evidence.

## Current execution boundary

The active implementation program is the Runtime Box CI foundation. Gate 8.1
is complete. Work must continue in its existing order:

1. Gate 8.2 Windows CPU pilot;
2. Gate 8.2 Windows CUDA pilot only after the CPU target succeeds;
3. Gate 8.3 cross-platform closure;
4. Gate 9 on-demand macOS arm64 heavy runner;
5. Gate 10 operational handoff.

This product plan must not interrupt, widen, or silently reorder those gates.
Every paid or remote run still requires the clean local gate and explicit user
approval defined in the Runtime Box plan. Product expansion begins only after
the active bounded gate is closed and documented.

## Product decision

Liatir is an **AI-first, not AI-only, local scientific workbench for life
sciences**.

Its job is not to replace Nextflow, Snakemake, individual bioinformatics tools,
model repositories, or scientific file formats. Its job is to make those
components work together as one inspectable analysis environment:

- data enters through a shared, versioned artifact contract;
- native tools, Plugins, API Connector requests, AI Tools, sub-pipelines, and
  external workflow engines can consume and produce those artifacts;
- every execution is represented in Jobs with stable parent and child identity;
- every durable output is represented in Results with provenance and lineage;
- compatible viewers open artifacts without manual export or path hunting;
- a result can become the typed input of another tool or workflow;
- non-technical users work through capability-oriented forms and presets while
  experts retain access to parameters, files, logs, and engine-native details.

The product promise is therefore not "Liatir can launch many tools." The
promise is:

> Liatir turns local scientific tools, workflow engines, and AI models into one
> traceable laboratory where results remain understandable and reusable.

## Differentiation and ownership

Liatir and external workflow engines overlap at orchestration, but they own
different layers.

| Concern | Liatir owns | External engine owns |
| --- | --- | --- |
| Scientific workspace | Data, Jobs, Results, viewers, provenance, lineage, and downstream reuse | No product-wide ownership |
| User experience | No-code-first capability forms, presets, compatibility explanations, and result exploration | Engine-native CLI, DSL, configuration, and reports |
| Shared contracts | Liatir node I/O, artifact profiles, validation, and adapter boundaries | Its own channels, rules, processes, and internal dataflow semantics |
| Execution | Native Liatir nodes and parent orchestration across heterogeneous systems | Scheduling and executing the workflow defined for that engine |
| AI | Installable AI Models, capability-oriented AI Tools, hardware/license preflight, scientific output validation | Only AI steps explicitly authored inside an external workflow |
| Observability | Cross-system Jobs and Results with stable identities and normalized provenance | Engine-specific trace, timeline, logs, and cache/resume behavior |

Liatir may execute a Nextflow pipeline as one node, consume its declared
outputs, inspect its trace, and pass a result into an AI Tool or Plugin. It must
not reproduce Nextflow DSL2, its scheduler, its executor ecosystem, or its
cache/resume implementation.

## Initial product boundary

The first product domain remains life sciences. Liatir should not claim to be a
universal laboratory for every scientific discipline until the life-science
contract and user experience have been proven.

The initial scientific verticals are:

1. single-cell analysis;
2. predictive and variant genomics;
3. protein structure and binding.

Single-cell is the first lighthouse vertical because the repository already has
the deepest Runtime Box, runner, and native lifecycle evidence there.

## What Liatir must not try to do now

- Do not become a Nextflow or Snakemake replacement.
- Do not build a visual editor for another engine's DSL before the execution
  adapter and artifact boundary have proven user value.
- Do not invent a new universal scientific file format.
- Do not describe extension matching as scientific compatibility.
- Do not become a generic model hub or support arbitrary model repositories as
  if every repository were safely runnable.
- Do not add many model families before existing integrations have scientific,
  native lifecycle, licensing, and result-viewing evidence.
- Do not build model training, fine-tuning, distributed training, or a general
  cloud compute platform in the initial product.
- Do not make Quenta or an autonomous agent the owner of scientific execution.
- Do not make MCP a prerequisite for the core workbench experience.
- Do not bundle every dependency into the desktop installer.
- Do not claim that one Runtime Box works across operating systems,
  architectures, or accelerators.
- Do not treat upstream download or user-supplied weights as an automatic
  workaround for restrictive model terms.

## State at the start of this plan

The current repository is not an empty prototype. It already has a substantial
execution foundation, but some product claims are ahead of their evidence.

| Area | Current state | Planning consequence |
| --- | --- | --- |
| Shared pipeline I/O | Verified common schemas and execution results in `packages/liatir-core` | Extend the core rather than create a second contract layer |
| Pipeline execution | Per-pipeline runtime identity, Jobs, cancellation, and exactly-once Results are verified | Reuse this path for every new adapter and AI Tool |
| Plugins | Build contracts are verified; native Node/WASM lifecycle coverage is incomplete | Close parity before treating every runtime as equally production-ready |
| API Connector | Saved requests and pipeline integration exist but native execution evidence is incomplete | Validate it as another first-class node type |
| AI Models and AI Tools | Batches 1–4 are implemented but not fully scientifically validated; Batch 5 is partial | Validate existing capabilities before adding new families |
| Runtime Box distribution | Live signed distribution with strong evidence on several targets; cross-platform foundation Gate 8.1 complete | Finish the active foundation program before widening scope |
| Scientific viewers | Protein, genome, and single-cell surfaces exist but need native visual/runtime validation | Make viewer completion part of each scientific vertical |
| Artifact semantics | Files have paths, extensions, media types, producer, parent run, and lifecycle role; scientific meaning is not yet a versioned compatibility contract | Add semantic profiles without replacing original formats |
| External workflow engines | Nextflow and Snakemake dependencies are recognized, but their Tools are still marked as coming soon | Build one first-class Nextflow vertical slice after the artifact contract |
| Quenta | Read-only explanatory MVP | Keep it explanatory until the workbench is trustworthy without it |

## Target architecture

The architecture should have six layers, all connected through contracts owned
by `packages/liatir-core`:

```text
Scientific files and data
        |
        v
Artifact identity, validation, and semantic profiles
        |
        v
Capabilities and typed Liatir nodes
        |
        +--> Native Tools / Plugins / API Connector / AI Tools
        |
        +--> External workflow adapters such as Nextflow
        |
        v
Jobs, logs, cancellation, provenance, and Results
        |
        v
Viewers, reports, comparison, and downstream reuse
```

### Universal execution envelope

Every executable component should share:

- stable definition and version identity;
- structured inputs and outputs;
- a parent run and optional child runs;
- progress, logs, cancellation, and terminal status;
- file artifacts, scalar values, metrics, and rich result sections;
- environment, dependency, model, parameter, and source provenance;
- exactly-once finalization into Results.

This envelope is universal inside Liatir. The scientific contents are not.

### Semantic artifact profiles

Liatir should standardize how files are described and connected, not rewrite
all files into one format. A versioned artifact profile should be able to carry:

- physical identity: path, size, digest, media type, and concrete format;
- scientific type: sequence collection, variant set, interval track, expression
  matrix, embedding, molecular structure, table, report, or another registered
  type;
- domain qualifiers when relevant: organism or taxon, genome assembly,
  reference digest, coordinate system, assay, modality, sample identity, units,
  feature namespace, and preprocessing state;
- validation result: profile and version used, valid/invalid/partial status,
  warnings, and actionable errors;
- lineage: source artifacts, transformation, producer, parameters, and parent
  run;
- optional viewer and indexing hints that do not redefine the scientific data.

Profiles must be incremental and domain-specific. The first profile set should
cover the formats already central to the product:

- AnnData `.h5ad` and derived single-cell embeddings/annotations;
- FASTA sequence collections;
- VCF/VCF.GZ variant sets;
- BED interval or score tracks;
- PDB and mmCIF molecular structures;
- generic delimited tables and JSON reports.

Connection validation must distinguish:

1. **transport compatibility**: the value can physically be passed;
2. **format compatibility**: the consumer can parse the format;
3. **scientific compatibility**: reference, organism, modality, units,
   preprocessing, or other declared assumptions are compatible.

Unknown metadata should remain unknown, not be guessed. Adapters may enrich or
convert artifacts, but every transformation must create a new artifact and
preserve the original.

### Capability layer

Users should choose scientific capabilities first and models second. Examples:

- Annotate cells;
- Create single-cell embeddings;
- Score variant effects;
- Predict regulatory activity;
- Predict a protein structure;
- Estimate protein-ligand binding.

An AI Tool owns the scientific input/output contract. Compatible AI Models are
implementations of that capability. The UI may select a recommended installed
model or let an expert choose explicitly, but it must show why a model is or is
not compatible with the current data and hardware.

### Model delivery modes

Every model integration must explicitly choose one legally and technically
validated delivery mode:

1. a Liatir-distributed signed Runtime Box including model assets when all
   redistribution terms permit it;
2. a signed runtime with model assets fetched from the authorized upstream
   source, including authentication or license acceptance where required;
3. user-supplied model assets validated against an expected layout and digest;
4. an API Connector integration when local execution is neither legal nor
   practical and the user explicitly accepts data egress.

These are product modes, not loopholes. Each model still needs a legal review,
hardware matrix, input contract, output parser, scientific validation, and
provenance record.

## Delivery phases

Execution remains linear and gate-based. Finish, verify, document, and hand off
one bounded slice before starting the next heavy slice.

### Phase 1: finish the active Runtime Box CI foundation

Objective: complete the infrastructure program already in progress without
mixing it with new product scope.

Work:

1. execute Gate 8.2 Windows CPU from a clean local preflight;
2. execute Gate 8.2 Windows CUDA only after CPU evidence is accepted;
3. close Gate 8.3 across macOS, Linux CPU/CUDA, and Windows CPU/CUDA;
4. complete Gate 9 with the private on-demand macOS heavy runner;
5. complete Gate 10 operational documentation and handoff;
6. separately close the product-level true cross-version update and persisted
   anti-replay state before calling Runtime Box distribution complete.

Exit criteria:

- every status claim is backed by reviewed evidence;
- no target is inferred from another target's success;
- the active catalog and support matrix match actual published artifacts;
- production signing, immutable publication, install, inference, Jobs, Results,
  replacement, rollback, removal, and cleanup are covered as required;
- no paid or remote run is used as an iterative debugger.

### Phase 2: close the common execution spine

Objective: ensure that every node class behaves like part of the same product
before adding another class of orchestration.

Work:

1. add native lifecycle coverage for Node and WASM Plugins, including progress,
   logs, failure, cancellation, Jobs, Results, and navigation isolation;
2. extend direct AI Model and Plugin runs to the same exactly-once Results and
   restart-reconciliation guarantees already verified for pipelines;
3. validate API Connector execution, authentication handling, malformed
   responses, rate/error states, cancellation, and provenance;
4. close dependency update interruption and recovery behavior;
5. define a shared nested-run contract suitable for external workflow engines
   without implementing an engine adapter yet;
6. keep all state owned by the actual workspace, pipeline, pipeline run,
   external workflow run, model run, tool run, or dependency install.

Exit criteria:

- direct and pipeline execution use the same backend lifecycle semantics;
- one running entity never disables or corrupts an unrelated entity;
- every terminal path finalizes once and remains coherent after navigation or
  restart;
- new node kinds can reuse the contract without a parallel state system.

### Phase 3: add scientific artifact semantics

Objective: make downstream composition scientifically safer than passing paths
and extensions.

Work:

1. write a focused core RFC for versioned artifact identity, semantic profiles,
   validation, lineage, and compatibility diagnostics;
2. extend `packages/liatir-core` backward-compatibly and regenerate all derived
   consumers rather than mirroring types;
3. implement profile validators for the initial file set;
4. add explicit adapter nodes for legitimate conversions, indexing, metadata
   enrichment, and reference normalization;
5. show compatibility errors before expensive execution when possible;
6. expose profile, validation, lineage, source, and transformation information
   in Results and relevant input selectors;
7. add fixtures for valid, invalid, ambiguous, mismatched-reference, and
   partially described artifacts.

Exit criteria:

- an artifact can move through multiple nodes without losing identity or
  provenance;
- reference or modality mismatches produce actionable errors before compute;
- conversions never mutate the original file;
- old nodes continue to work while profiles are adopted incrementally;
- the contract does not claim scientific equivalence merely because extensions
  match.

### Phase 4: ship the single-cell lighthouse vertical

Objective: prove the full workbench experience with the strongest existing AI
foundation.

Reference workflow:

```text
AnnData input
  -> profile and scientific validation
  -> cell annotation or embedding capability
  -> compatible installed AI Model
  -> tracked Job and reproducible Result
  -> single-cell viewer
  -> downstream Plugin, AI Tool, or pipeline node
```

Work:

1. make `.h5ad` validation explicit about matrix shape, layer, feature
   identifiers, organism, preprocessing assumptions, and mutation policy;
2. present CellTypist, Geneformer, UCE, and scGPT through capability-oriented AI
   Tools rather than a collection of unrelated model pages;
3. retain model-specific expert controls and exact model provenance;
4. validate each supported model one at a time with realistic bounded fixtures;
5. complete native single-cell viewer coverage and artifact handoff;
6. provide one useful no-code preset only after the individual nodes pass;
7. keep scFoundation unavailable unless a legally valid product path is
   approved; do not present user-supplied weights as an automatic legal fix.

Exit criteria:

- a non-technical user can obtain and understand a valid result without a
  terminal;
- an expert can inspect inputs, preprocessing, parameters, logs, model/runtime
  versions, outputs, and limitations;
- direct and pipeline paths produce equivalent scientific artifacts and
  provenance;
- failure cases are readable and do not leave partial state presented as a
  result;
- the final artifact can be consumed by another node without manual file path
  copying.

### Phase 5: integrate Nextflow as a first-class external workflow adapter

Objective: demonstrate that Liatir is a laboratory above multiple execution
systems, not another isolated pipeline editor.

The first slice should use a system-installed Nextflow, matching the current
dependency boundary. Managed Nextflow installation, remote executors, HPC, and
cloud backends can follow only after the local adapter is reliable.

Work:

1. add a core external-workflow definition and run identity rather than hiding
   production integration inside a bespoke Plugin;
2. support a saved local or version-pinned repository pipeline source;
3. expose pipeline parameters through a generated form when a machine-readable
   schema exists and a structured fallback when it does not;
4. map Liatir artifacts into Nextflow parameters or staged input paths without
   mutating the originals;
5. run Nextflow as a child of the owning Liatir pipeline run or as a direct
   external workflow run;
6. capture command, revision, profile, configuration, environment, work/output
   locations, logs, trace, report, timeline, and engine exit status where
   available;
7. support cancellation and make engine-native resume an explicit expert action
   rather than pretending Liatir owns Nextflow cache semantics;
8. map declared outputs into Liatir artifacts and require user mapping for
   ambiguous outputs instead of guessing;
9. display workflow-level progress first and process/task detail as nested
   observability, without flattening every process into unrelated top-level
   Jobs;
10. allow a Nextflow node's outputs to feed an AI Tool, Plugin, native tool,
    API Connector request, viewer, or another Liatir pipeline.

First proof workflow:

```text
Liatir input artifact
  -> Nextflow pipeline node
  -> declared scientific output artifact
  -> Liatir validation/profile enrichment
  -> existing AI Tool or viewer
  -> final Result with combined provenance
```

Exit criteria:

- pipeline source and revision are reproducible;
- parameters, engine configuration, inputs, outputs, and reports remain
  inspectable;
- cancellation, failure, navigation, restart reconciliation, and Results
  finalization follow Liatir lifecycle rules;
- an output can be used downstream without manually searching the Nextflow work
  directory;
- Liatir does not claim ownership of Nextflow scheduling, caching, or DSL.

Do not start a visual Nextflow DSL builder in this phase. Revisit it only if
real user evidence shows that schema-generated parameter forms, presets, and
result inspection are insufficient.

### Phase 6: complete the genomics and protein verticals

Objective: prove that the artifact and capability architecture generalizes
beyond single-cell data.

#### Predictive and variant genomics

Reference workflow:

```text
VCF plus reference context
  -> assembly/reference validation
  -> variant-effect capability
  -> score table and BED track
  -> genome viewer
  -> report or downstream filter
```

Validate the already implemented Nucleotide Transformer, Enformer, Basenji2,
and Borzoi paths before adding another genomics family. Each integration must
make reference build, sequence window, target index, preprocessing, and output
meaning explicit.

#### Protein structure and binding

Reference workflow:

```text
Protein sequence plus optional ligand
  -> input and hardware preflight
  -> structure or binding capability
  -> PDB/mmCIF plus confidence metadata
  -> structure viewer
  -> downstream analysis or report
```

Validate Boltz-2 on supported targets before widening the model set. Keep
hardware- or license-incompatible candidates unavailable rather than presenting
them as nominally integrated.

Each vertical exits only when it has:

- a realistic bounded golden dataset;
- one successful direct path and one successful pipeline path;
- scientific sanity assertions, not only process exit success;
- malformed and incompatible input coverage;
- complete Jobs, Results, provenance, and viewer behavior;
- an evidence-backed hardware and license support matrix;
- one useful no-code preset built from already verified nodes.

### Phase 7: make extension quality reproducible

Objective: let Liatir grow without turning the official catalog into unverified
wrappers.

Work:

1. define conformance suites for Plugins, AI Model adapters, AI Tools, artifact
   profiles, viewers, and external workflow adapters;
2. replace toy Plugin templates with small useful scientific examples for Node,
   Python, and WASM;
3. document the supported model delivery modes and adapter contract;
4. introduce an evidence-based `Liatir Verified` status only when legal,
   platform, lifecycle, scientific, and provenance gates pass;
5. create presets immediately after their nodes are verified instead of waiting
   for a large final preset batch;
6. add Snakemake or another workflow engine only after the Nextflow adapter has
   produced a reusable engine boundary and conformance fixture.

Third-party extensions may be powerful, but official support must remain
distinguishable from locally installed, user-trusted code.

### Phase 8: defer advanced expansion until the core thesis is proven

Potential later programs include:

- simulations and biophysics engines;
- advanced generative protein or genomic models;
- model comparisons and ensembles;
- remote, HPC, and cloud workflow executors;
- training and fine-tuning;
- controlled MCP access;
- Quenta-assisted explanation and report drafting;
- carefully bounded agentic workflows.

These are not part of the immediate execution queue. Quenta remains read-only
and explanatory; an autonomous model must not silently choose data,
preprocessing, parameters, or execute scientific workflows on behalf of the
user.

## Recommended Beta 1 product gate

Beta 1 should demonstrate the product thesis, not the number of menu entries.
The recommended minimum coherent beta includes:

1. the verified common execution spine;
2. the evidence-backed platform and Runtime Box support matrix;
3. semantic artifact profiles for the first lighthouse workflow;
4. one complete single-cell AI workflow with viewer and downstream reuse;
5. one first-class local Nextflow integration that emits reusable Liatir
   artifacts;
6. readable Jobs, Results, logs, provenance, compatibility explanations, and
   failure recovery across those paths;
7. public documentation for installation, first analysis, limitations, and
   troubleshooting.

Beta 1 does not need every implemented model, every operating system, Quenta,
MCP, simulations, or generative design to be called complete. It must state its
support matrix honestly and avoid presenting implemented-but-unverified
features as production-ready.

## Ordered backlog from the current state

This is the default sequence unless a later evidence-backed decision explicitly
reorders it:

1. finish Runtime Box Gate 8.2 Windows CPU;
2. finish Runtime Box Gate 8.2 Windows CUDA;
3. finish Gate 8.3 cross-platform closure;
4. finish Gate 9 and Gate 10;
5. close true cross-version Runtime Box update and persisted anti-replay state;
6. close Plugin, direct AI, API Connector, and dependency lifecycle gaps needed
   by the common execution spine;
7. design and land the backward-compatible semantic artifact contract in
   `packages/liatir-core`;
8. implement the AnnData/single-cell profiles and lighthouse workflow;
9. complete single-cell viewer and preset evidence;
10. implement the local first-class Nextflow adapter;
11. prove Nextflow output reuse through an existing AI Tool or viewer;
12. validate the predictive/variant genomics vertical;
13. validate the protein structure/binding vertical;
14. publish useful verified Plugin and pipeline templates;
15. evaluate another external workflow engine only from the reusable adapter
    contract;
16. reconsider simulations, generative models, MCP, Quenta expansion, and
    training only after the beta evidence is complete.

## Definition of done for every integration

An integration is not complete because it builds, launches, or produces a file.
It is complete only when all applicable gates pass:

- **Contract:** schemas, artifacts, and generated consumers derive from
  `packages/liatir-core`.
- **Identity:** workspace, parent run, child run, node, Job, and Result
  identities are stable and correctly associated.
- **Lifecycle:** install, run, progress, logs, cancellation, failure, restart,
  update, rollback, removal, and cleanup behave coherently where applicable.
- **Scientific:** realistic fixtures validate assumptions, preprocessing,
  output shapes, finite values, invariants, and known limitations.
- **Compatibility:** operating system, architecture, accelerator, memory,
  dependency, format, and scientific metadata requirements are explicit.
- **Legal:** source, code, dependencies, weights, redistribution, attribution,
  and downstream-use restrictions have been reviewed.
- **Results:** outputs finalize once, remain inspectable, open in the appropriate
  viewer, and can be consumed downstream.
- **Provenance:** source revision, model/runtime versions, parameters,
  environment, transformations, references, and parent artifacts are recorded.
- **UX:** non-technical users see task-oriented language and actionable errors;
  experts can inspect engine-native detail.
- **Evidence:** repeatable automated gates and reviewed evidence support every
  status promotion.

## How progress should be measured

Use controlled test corpora and release gates rather than mandatory product
telemetry. Track:

- time from fresh install to first valid scientific Result;
- percentage of invalid or incompatible inputs rejected before expensive work;
- percentage of produced artifacts that open directly in a suitable viewer;
- percentage of declared outputs that can connect downstream without manual
  path entry or format guessing;
- direct-run and pipeline-run parity;
- successful restart, cancellation, update, rollback, and removal scenarios;
- complete provenance coverage;
- reproducibility of golden workflows on every claimed target;
- failure quality: actionable error rather than raw stack trace or silent
  partial output.

Targets should be set only after collecting a first baseline from the
single-cell lighthouse workflow.

## Decision rule for new work

Before adding a model, tool, viewer, engine, or AI feature, answer:

1. Which user capability or complete scientific workflow does it unlock?
2. Can an existing Liatir component already provide that capability?
3. Does it exercise and improve the shared contract, or create a special path?
4. What is the exact state owner and lifecycle?
5. What realistic fixture proves scientific value?
6. How will its output be viewed and reused downstream?
7. What are the legal, hardware, platform, and distribution boundaries?
8. What work is displaced by adding it now?

If these answers are not concrete, keep the item out of the active queue.

## Roadmap maintenance

- Update this document only when product direction, phase order, or exit
  criteria change.
- Update `runtime-box-ci-foundation.md` when the active Runtime Box gate changes.
- Update `ai-batches.md` when implementation or model-specific evidence changes.
- Update `beta-readiness.md` only when repeatable evidence changes a readiness
  status.
- Keep detailed implementation designs in focused documents linked from the
  relevant phase; do not turn this plan into a transient incident log.
