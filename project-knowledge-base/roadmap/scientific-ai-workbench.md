# Scientific AI Workbench Product Plan

Last reviewed: 2026-08-11

This document is the canonical product direction and execution sequence for
Liatir during and after the current Runtime Box CI foundation program. It turns
the existing feature inventory into one coherent product: a local-first
scientific AI workbench for life sciences.

It does not replace the evidence ledgers:

- [Runtime Box CI foundation](./runtime-box-ci-foundation.md) preserves the
  completed cross-platform foundation gate record;
- [AI development batches](./ai-batches.md) records what has been implemented
  or validated by model family;
- [Beta 1 readiness](./beta-readiness.md) owns cross-surface release evidence.

## Current execution boundary

The Runtime Box CI foundation completed Gates 0 through 10 on 2026-07-22, and
the subsequent pixi/Scrollcase migration and protected re-release are now
complete. The public `beta` matrix has nine schema-v2 targets: Geneformer on
macOS Metal plus Linux CUDA 12.9 and Windows CUDA 12.8; scGPT on macOS Metal,
Linux/Windows CPU and both CUDA targets; and UCE on macOS Metal. The old CUDA
12.4 identities were deleted rather than renamed, and the successor targets are
published. Geneformer and scGPT `beta.1` are revoked; UCE `beta.1` remains an
explicit retirement decision.

Scrollcase adoption P5.0 through P5.7 is complete. The Runtime Box security
implementation and its macOS slice are also complete: a lightweight signed
fixture proves a real cross-version update, app restart, rollback, replay and
equivocation rejection, and corrupt-state isolation. The complete Gate 1 still
needs the same native evidence on supported Linux x86_64 and Windows hosts.
After that, work closes asynchronous settlement and the common execution spine
before widening scientific scope. Every paid or remote action still requires
its exact local gate, workflow/input/revision readback, cost declaration, and
fresh explicit approval.

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

Liatir may save and execute a Nextflow pipeline as a standalone External
Workflow, or reference that same saved definition as one node in a Liatir
pipeline. In either mode it may consume declared outputs, inspect the engine
trace, and pass a result into an AI Tool or Plugin. It must not reproduce
Nextflow DSL2, its scheduler, its executor ecosystem, or its cache/resume
implementation.

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
| AI Models and AI Tools | Runtime Box-only catalog with Geneformer, scGPT, and UCE plus the shared Single-cell Embedding Tool; legacy and mock integrations were removed on 2026-07-22 | Complete the common execution spine and product update guarantees before adding another family |
| Runtime Box distribution | Nine current schema-v2 targets are live and product-lifecycle verified; Scrollcase P5 is complete; app-global anti-replay and true A-to-B rollback are natively verified on macOS across an app restart | Repeat the focused security lifecycle on supported Linux x86_64 and Windows hosts, then decide whether UCE `beta.1` belongs in revocations |
| Scientific viewers | Protein, genome, and single-cell surfaces exist but need native visual/runtime validation | Make viewer completion part of each scientific vertical |
| Artifact semantics | Files have paths, extensions, media types, producer, parent run, and lifecycle role; scientific meaning is not yet a versioned compatibility contract | Add semantic profiles without replacing original formats |
| External workflow engines | Nextflow and Snakemake dependencies are recognized, but no first-class External Workflow entity exists yet | Build Nextflow first, runnable both standalone and as a pipeline node, after the artifact contract |
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

## Active delivery sequence

Execution is linear and gate-based. Finish, verify, document, and hand off one
bounded slice before starting the next heavy slice.

Indicators used below:

- **Difficulty** is indicative implementation complexity from `1/5` to `5/5`.
- **Codex effort** is the recommended reasoning effort for implementation.
- **Windows** or **Linux** appears only when the gate requires a real machine
  on that platform, not merely portable unit coverage.

### Gate 1: secure Runtime Box updates

**Difficulty:** `4/5` · **Codex effort:** `xhigh` · **Windows** · **Linux**

**Status (2026-08-11): macOS slice complete; Linux x86_64 and Windows native
evidence pending.**

Prove a real version A to version B update and rollback. Persist anti-replay
state globally for the app rather than per workspace. A signed control document
older than the accepted floor must be rejected; the same signed timestamp with
a different payload must fail as equivocation. Corrupt security state must
block new installs or updates with actionable recovery, while already installed
models remain runnable offline.

The implementation stores one atomic app-global
`runtime-box-control-floors.json`. Each channel identity is scoped by Registry,
channel, box and target; revocations are scoped by Registry. The accepted value
is the signed `updatedAt` instant plus `payloadSha256`: an older instant is a
replay, while the same instant with another digest is equivocation. A malformed
state file fails closed only on install/update paths; installed activation keeps
using its immutable signed release.

`npm run runtime-box:test:security` generates two tiny schema-v2 boxes and an
ephemeral signing key, then drives two consecutive native app processes over the
same isolated app-data root. On macOS arm64 it proves A install, A-to-B update,
persisted channel and revocation floors, rollback to A, restart survival, older
and equivocal channel/revocation rejection, corrupt-state blocking, and the
rolled-back runtime still executing. The existing Lima VM was inspected and
returned to its original stopped state; it is Linux aarch64 with no Node, Rust,
GTK or Xvfb, so it cannot prove Liatir's supported Linux x86_64 target without a
separately provisioned VM.

### Gate 2: audit asynchronous pipeline settlement

**Difficulty:** `4/5` · **Codex effort:** `high`

Audit Native Tools, Plugins, AI Tools, API Connector requests and sub-pipelines.
A step may launch background work, but it remains `running` until every required
child process is terminal and every declared output is durable. A downstream
step must never start merely because a Job returned from spawn. Cover
cancellation, navigation, restart reconciliation, child-process attribution and
premature Result finalization.

For Beta 1, keep ready nodes within one Liatir pipeline sequential. Independent
pipeline runs remain concurrent, and Nextflow retains the parallelism of its own
engine. Parallel DAG scheduling inside Liatir is a later optimization, not part
of this correctness gate.

### Gate 3: close the common execution spine

**Difficulty:** `5/5` · **Codex effort:** `max`

Unify identity, Jobs, Results, logs, progress, cancellation, failure and restart
recovery across direct and pipeline execution. Add the nested-run contract and
stable External Workflow Run identity needed by workflow engines. Every
terminal path must finalize exactly once, retain the correct parent, and leave
unrelated work usable.

### Gate 4: standardize scientific I/O

**Difficulty:** `5/5` · **Codex effort:** `xhigh`

Extend `packages/liatir-core` with backward-compatible, versioned scientific
artifact profiles. Separate transport, format and scientific compatibility;
preserve the original format, digest, provenance, lineage and transformations.
Adopt the contract incrementally, beginning with AnnData and single-cell
artifacts.

### Gate 5: complete the single-cell lighthouse

**Difficulty:** `4/5` · **Codex effort:** `xhigh`

Prove AnnData validation, the Single-cell Embedding Tool, supported AI Models,
viewer handoff and downstream reuse as one coherent workflow. Direct and
pipeline execution must produce equivalent artifacts and provenance. Add one
useful no-code preset only after the individual nodes and viewer pass.

### Gate 6: integrate Nextflow as an External Workflow

**Difficulty:** `5/5` · **Codex effort:** `max` · **Windows** · **Linux**

Introduce External Workflow as a first-class saved entity and add
`external-workflow` to the shared contracts. Nextflow is the first adapter; it
is neither a `.lia` Plugin nor an ordinary Native Tool. One saved definition
owns the engine, local or version-pinned source, parameter schema, declared
inputs and output mapping.

Expose the definition under Tools / External Workflows for standalone runs and
allow a Liatir pipeline node to reference the same definition by ID. A
standalone run owns a top-level External Workflow Run, Job and Result. A nested
run also carries its parent `pipelineRunId`; both paths use the same adapter,
parameters, output rules and provenance.

The first slice uses system-installed Nextflow and Java. It stages inputs
without modifying originals; records source revision, profile, configuration,
environment, work/output locations, logs, trace, report, timeline and exit
state; and converts only declared outputs into reusable Liatir artifacts.
Ambiguous outputs require explicit mapping. Nextflow continues to own DSL2,
scheduling, internal parallelism, cache and resume.

### Gate 7: close Beta 1 readiness

**Difficulty:** `4/5` · **Codex effort:** `high` · **Windows** · **Linux**

Run the complete single-cell and Nextflow verticals, including standalone and
nested Nextflow execution and downstream output reuse. Close signed installer,
update, migration, recovery and uninstall evidence for every platform claimed
by the beta. Finish public installation, first-analysis, limitations and
troubleshooting documentation. Do not claim unsupported platforms or
implemented-but-unverified features.

### Gate 8: expose controlled MCP access after Beta 1

**Difficulty:** `5/5` · **Codex effort:** `max`

Provide a local Liatir MCP server with read-only resources and controlled
execution of saved pipelines. A start request returns a stable asynchronous run
identity; status, logs, cancellation and Results are queried separately. Require
an explicit allowlist, user authorization, audit records and correct
Jobs/Results attribution, and verify the boundary with a real MCP client.

The first MCP surface excludes arbitrary shell access, autonomous pipeline
mutation and models that silently choose scientific data, preprocessing or
parameters. MCP is an interoperability boundary, not an autonomous owner of
scientific execution.

## Detailed capability specifications

The following sections retain the implementation detail and exit criteria for
the active gates and later expansion. The numbered gate sequence above, not the
historical section order below, is authoritative.

Execution remains linear and gate-based. Finish, verify, document, and hand off
one bounded slice before starting the next heavy slice.

### Completed Runtime Box CI foundation

Objective: complete the infrastructure program already in progress without
mixing it with new product scope.

Status: complete on 2026-07-22. See the
[production report](./runtime-box-production-report.md).

Work:

1. complete Gate 9 with the private on-demand macOS heavy runner;
2. complete Gate 10 operational documentation and handoff;
3. separately complete the later pixi/Scrollcase migration and protected
   schema-v2 re-release.

The historical Windows CUDA 12.4 target was never validated or published and
was deleted. Its `windows-x86_64-cuda12.8` successor is a distinct, natively
validated and published identity; no evidence is inferred from Linux CUDA.

Exit criteria:

- every status claim is backed by reviewed evidence;
- no target is inferred from another target's success;
- the active catalog and support matrix match actual published artifacts;
- production signing, immutable publication, install, inference, Jobs, Results,
  replacement, rollback, removal, and cleanup are covered as required;
- no paid or remote run is used as an iterative debugger.

### Common execution spine

Objective: ensure that every node class behaves like part of the same product
before adding another class of orchestration.

Work:

1. audit the settlement contract of every pipeline runner: returning from spawn
   is not completion, and downstream nodes wait for terminal child work plus
   durable outputs;
2. add native lifecycle coverage for Node and WASM Plugins, including progress,
   logs, failure, cancellation, Jobs, Results, and navigation isolation;
3. extend direct AI Model and Plugin runs to the same exactly-once Results and
   restart-reconciliation guarantees already verified for pipelines;
4. validate API Connector execution, authentication handling, malformed
   responses, rate/error states, cancellation, and provenance;
5. close dependency update interruption and recovery behavior;
6. define a shared nested-run contract suitable for external workflow engines
   without implementing an engine adapter yet;
7. keep all state owned by the actual workspace, pipeline, pipeline run,
   external workflow run, model run, tool run, or dependency install.

Exit criteria:

- direct and pipeline execution use the same backend lifecycle semantics;
- one running entity never disables or corrupts an unrelated entity;
- every terminal path finalizes once and remains coherent after navigation or
  restart;
- a delayed child Job cannot release a downstream node or finalize its parent
  Result before terminal status and durable output registration;
- new node kinds can reuse the contract without a parallel state system.

### Scientific artifact semantics

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

### Single-cell lighthouse vertical

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
2. present Geneformer, UCE, and scGPT through the shared Single-cell Embedding
   Tool rather than unrelated model-specific execution paths;
3. retain model-specific expert controls and exact model provenance;
4. validate each supported model one at a time with realistic bounded fixtures;
5. complete native single-cell viewer coverage and artifact handoff;
6. provide one useful no-code preset only after the individual nodes pass;
7. add no additional model until a legally valid, signed Runtime Box product
   path is approved and validated.

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

### Nextflow External Workflow

Objective: demonstrate that Liatir is a laboratory above multiple execution
systems, not another isolated pipeline editor, and that an external workflow is
useful both independently and as one component of a larger Liatir pipeline.

The first slice should use a system-installed Nextflow, matching the current
dependency boundary. Managed Nextflow installation, remote executors, HPC, and
cloud backends can follow only after the local adapter is reliable.

Work:

1. add a first-class, saved External Workflow definition and stable External
   Workflow Run identity in the shared core rather than hiding production
   integration inside a bespoke Plugin or ordinary Native Tool;
2. support a saved local or version-pinned repository pipeline source;
3. expose pipeline parameters through a generated form when a machine-readable
   schema exists and a structured fallback when it does not;
4. map Liatir artifacts into Nextflow parameters or staged input paths without
   mutating the originals;
5. expose the saved definition under Tools / External Workflows and run it
   directly with its own Job, Result and provenance;
6. let a Liatir pipeline node reference that same definition by ID and run it as
   a child of the owning pipeline run without duplicating configuration;
7. capture command, revision, profile, configuration, environment, work/output
   locations, logs, trace, report, timeline, and engine exit status where
   available;
8. support cancellation and make engine-native resume an explicit expert action
   rather than pretending Liatir owns Nextflow cache semantics;
9. map declared outputs into Liatir artifacts and require user mapping for
   ambiguous outputs instead of guessing;
10. display workflow-level progress first and process/task detail as nested
   observability, without flattening every process into unrelated top-level
   Jobs;
11. allow a Nextflow run's outputs to feed an AI Tool, Plugin, native tool,
    API Connector request, viewer, or another Liatir pipeline.

First proof workflows:

```text
Liatir input artifact -> standalone Nextflow External Workflow
  -> declared scientific output artifact
  -> top-level Liatir Result

Liatir input artifact -> Nextflow External Workflow node
  -> declared scientific output artifact
  -> Liatir validation/profile enrichment
  -> existing AI Tool or viewer
  -> final Result with combined provenance
```

Exit criteria:

- pipeline source and revision are reproducible;
- parameters, engine configuration, inputs, outputs, and reports remain
  inspectable;
- direct and nested runs reference one saved definition and produce equivalent
  declared artifacts and engine provenance;
- cancellation, failure, navigation, restart reconciliation, and Results
  finalization follow Liatir lifecycle rules;
- an output can be used downstream without manually searching the Nextflow work
  directory;
- Liatir does not claim ownership of Nextflow scheduling, caching, or DSL.

Do not start a visual Nextflow DSL builder in this phase. Revisit it only if
real user evidence shows that schema-generated parameter forms, presets, and
result inspection are insufficient.

### Later genomics and protein verticals

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

The earlier Nucleotide Transformer, Enformer, Basenji2, and Borzoi product
integrations were removed during the Runtime Box-only cutover. A future
predictive-genomics family must start from a new Runtime Box plan and make
reference build, sequence window, target index, preprocessing, and output
meaning explicit before entering the product catalog.

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

The earlier Boltz-2 and Chai product integrations were removed during the
Runtime Box-only cutover. A future structure model must first obtain a legal,
target-specific Runtime Box and full scientific/product lifecycle evidence.

Each vertical exits only when it has:

- a realistic bounded golden dataset;
- one successful direct path and one successful pipeline path;
- scientific sanity assertions, not only process exit success;
- malformed and incompatible input coverage;
- complete Jobs, Results, provenance, and viewer behavior;
- an evidence-backed hardware and license support matrix;
- one useful no-code preset built from already verified nodes.

### Reproducible extension quality

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

### Deferred advanced expansion

Potential later programs include:

- simulations and biophysics engines;
- advanced generative protein or genomic models;
- model comparisons and ensembles;
- remote, HPC, and cloud workflow executors;
- training and fine-tuning;
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
5. one saved Nextflow External Workflow that runs both standalone and as a
   pipeline node, emitting equivalent reusable Liatir artifacts;
6. readable Jobs, Results, logs, provenance, compatibility explanations, and
   failure recovery across those paths;
7. signed desktop install/update/migration/uninstall evidence for every claimed
   platform;
8. public documentation for installation, first analysis, limitations, and
   troubleshooting.

Beta 1 does not need every implemented model, every future scientific vertical,
Quenta, MCP, simulations, or generative design to be called complete. It must
state its support matrix honestly and avoid presenting
implemented-but-unverified features as production-ready.

## Ordered backlog from the current state

This is the default sequence unless a later evidence-backed decision explicitly
reorders it:

1. repeat the completed Runtime Box security lifecycle on supported Linux
   x86_64 and Windows hosts to close Gate 1 platform evidence;
2. audit asynchronous pipeline settlement and prevent premature downstream or
   Result finalization;
3. close Plugin, direct AI, API Connector, dependency and nested-run lifecycle
   gaps needed by the common execution spine;
4. design and land the backward-compatible semantic artifact contract in
   `packages/liatir-core`;
5. implement the AnnData/single-cell profiles and lighthouse workflow;
6. complete single-cell viewer and preset evidence;
7. implement one saved local Nextflow External Workflow with direct and nested
   execution;
8. prove Nextflow output reuse through an existing AI Tool or viewer;
9. close the desktop release matrix and public Beta 1 documentation;
10. implement controlled local MCP access with a real client after Beta 1;
11. validate the predictive/variant genomics and protein structure/binding
    verticals;
12. publish useful verified Plugin and pipeline templates;
13. evaluate another external workflow engine only from the reusable adapter
    contract, then reconsider other advanced expansion.

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
