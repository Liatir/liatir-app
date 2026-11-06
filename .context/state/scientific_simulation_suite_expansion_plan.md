# Liatir — Scientific Simulation Suite Expansion

Repository: https://github.com/Liatir/liatir-app

## Mission

Build a comprehensive, scientifically reliable, local-first simulation suite for Liatir, covering molecular docking, virtual screening, molecular trajectory analysis, biochemical networks, metabolic modeling, and multicellular simulation.

The suite must be useful for oncology research while remaining general-purpose for molecular biology, pharmacology, biotechnology, and computational research.

**Work autonomously through four major phases, maintaining a persistent plan and rigorous scientific validation throughout.**

Prioritize correctness, reproducibility, efficient execution, maintainability, and a genuinely usable Liatir experience.

This is a production engineering project, not a collection of experimental CLI wrappers.

## Scope

Integrate the following software:

**Molecular preparation and docking**
- AutoDock Vina
- RDKit
- Meeko
- PDBFixer
- Ringtail

**Advanced docking and molecular analysis**
- GNINA
- MDAnalysis
- ProLIF

**Systems and cellular biology**
- PySB and BioNetGen
- COBRApy
- PhysiCell

Preserve and extend interoperability with the existing OpenMM integration.

Out of scope:
- macOS support or validation.
- Native Windows Runtime Boxes.
- GROMACS, AutoDock-GPU, OpenFE, ADMET-AI.
- Automatic multiscale molecular-to-cellular coupling.
- Unrelated architectural refactoring.

---

# Mandatory Development Environment — WSL2

**All development, builds, scientific validation, packaging, and primary testing must take place inside Ubuntu WSL2.**

Do not develop or build these components using native Windows environments.

## Environment rules

1. Use the existing Linux repository checkout within the WSL2 filesystem, not `/mnt/c/`.
2. Reuse the existing Ubuntu environment, Linux toolchain, and repository configurations.
3. Use Scrollcase v3 for reproducible Runtime Box packaging.
4. Use the existing Liatir CUDA-enabled WSL2 environment and NVIDIA GPU.
5. Detect the actual hardware and available resources before running expensive tests.
6. Reuse existing self-hosted runners and CI infrastructure.
7. Avoid duplicating repositories, environments, or dependency installations.
8. Avoid introducing Docker unless an existing project requirement explicitly necessitates it.
9. Never assume hardcoded local paths.
10. Preserve all existing environment and security configurations.

## Initial target matrix

| Host | CPU tools | CUDA tools |
|---|---|---|
| Linux x86_64 | Supported target | Supported target |
| Windows 11 through WSL2 | Supported target | Supported target |
| Native Windows | Excluded | Excluded |
| macOS | Excluded | Excluded |

Windows users must use the established Liatir WSL2 execution mechanism.

Build Linux Runtime Boxes and validate their behavior through Liatir's existing Windows/WSL2 bridge.

Do not introduce separate native Windows packages.

**macOS is explicitly deferred to a future project.**

Do not spend time implementing, testing, packaging, or preparing macOS targets during this task.

If an upstream dependency supports macOS, simply record that information when relevant; do not expand scope.

---

# Global Engineering Principles

## 1. Understand the repository before implementing

Read the relevant current documentation, including:

- `AGENTS.md`
- `.context/index.md`
- `.context/state/current.md`
- `.context/truth/architecture.md`
- `.context/truth/architecture/component-boxes.md`
- `.context/state/roadmap/scientific-ai-workbench.md`
- Existing Runtime Box specifications and publication infrastructure.
- Existing OpenMM implementation and scientific validation.
- Relevant decisions and testing conventions.

Inspect the current branch, recent commits, and uncommitted changes.

The actual implementation and current repository state are authoritative.

Never assume an existing component is missing without checking.

## 2. Reuse established Liatir infrastructure

Use:

- Scrollcase v3.
- Signed Runtime Boxes.
- Existing Tool Runtime mechanisms.
- Shared schemas in `packages/liatir-core`.
- Existing scientific artifact contracts.
- Jobs and Results.
- Provenance and reproducibility metadata.
- Pipeline execution infrastructure.
- Existing 3D visualization when applicable.
- Existing hardware preflight and resource estimation.
- Existing publication and rollback workflows.

Avoid new architectural layers unless demonstrably necessary.

Heavy dependencies must remain isolated in appropriately scoped Runtime Boxes.

Do not install scientific dependencies globally or add them to the core Liatir application.

## 3. Persistent plan and Syngraphe

Before implementation, create:

`.context/state/roadmap/scientific-simulation-suite.md`

This must become the **canonical persistent execution plan**.

Include:

- Verified initial project state.
- Architecture and dependencies.
- Selected upstream versions.
- Runtime Box boundaries.
- Supported platforms and hardware.
- Four implementation phases.
- Scientific validation criteria.
- Security and licensing reviews.
- Risks and unresolved blockers.
- Progress, decisions, and checkpoints.
- Next concrete actions.

Integrate the plan into the existing `.context` navigation and Syngraphe conventions.

Run `syngraphe check` and `syngraphe status` where appropriate.

After each completed component or significant milestone, update the plan with verified progress, tests, evidence, relevant commits, and next actions.

Maintain one authoritative plan rather than generating redundant documents.

**Always consult this plan before continuing work.**

It must allow another Codex session to resume without reconstructing previous decisions.

## 4. Reasoning and decision quality

Use maximum available reasoning effort.

Before substantial changes, internally examine assumptions, possible approaches, compatibility issues, scientific validity, and failure modes.

Evaluate alternatives when necessary.

Document concise, auditable engineering decisions:

- What was decided.
- Why.
- Evidence supporting the decision.
- Relevant alternatives.
- How correctness is verified.

Do not produce lengthy private chain-of-thought transcripts.

Never present assumptions, approximations, or preliminary tests as verified results.

## 5. Resource efficiency

- Use targeted tests during development.
- Run full verification at meaningful milestones.
- Avoid unnecessarily repeated expensive workloads.
- Do not download large models or datasets before checking feasibility.
- Use compact, scientifically meaningful fixtures during initial development.
- Measure actual CPU, RAM, VRAM, execution time, and disk use when appropriate.
- Reuse valid cached assets and existing test fixtures.
- Pin dependencies, source revisions, and required assets.
- Preserve existing CI cost controls.
- Do not initiate paid infrastructure without authorization.

Keep changes small, reviewable, and recoverable.

---

# Phase 1 — Architecture and Scientific Feasibility

**Goal:** Establish a reliable implementation strategy before writing substantial code.

## Tasks

1. Inspect the existing Liatir Runtime Box architecture.
2. Examine the current OpenMM integration and its artifact formats.
3. Review official upstream sources for every requested scientific package.
4. Select compatible, supported versions.
5. Audit transitive dependencies and redistribution requirements.
6. Define runtime boundaries and installation targets.
7. Identify official scientific reference examples.
8. Define validation criteria and failure handling.
9. Establish the implementation order and dependencies.
10. Create and initialize the persistent execution plan.

## Proposed Runtime Box organization

Evaluate this initial design:

| Runtime Box | Components | Target |
|---|---|---|
| Molecular Docking | Vina, RDKit, Meeko, PDBFixer, Ringtail | Linux CPU |
| Neural Docking | GNINA | Linux CUDA |
| Molecular Analysis | MDAnalysis, ProLIF | Linux CPU |
| Biochemical Simulation | PySB, BioNetGen | Linux CPU |
| Metabolic Modeling | COBRApy, solver | Linux CPU |
| Multicellular Simulation | PhysiCell | Linux CPU |

All targets must support Windows through WSL2 where compatible.

This grouping is provisional.

Consolidate or separate components only when justified by dependency compatibility, licensing, runtime size, security, and isolation requirements.

Do not create one Runtime Box per Python package merely for convenience.

Do not combine incompatible or independently versioned heavy runtimes simply to reduce the number of boxes.

## Critical feasibility checks

Investigate:

- Overlap between PDBFixer and existing OpenMM preparation.
- RDKit and Meeko interoperability.
- Vina output compatibility with Ringtail.
- GNINA binary, CUDA, bundled weights, and OpenBabel licensing requirements.
- ProLIF's RDKit and MDAnalysis dependencies.
- OpenMM DCD/topology compatibility.
- PySB and BioNetGen execution requirements.
- COBRApy solver availability and licensing.
- PhysiCell native C++ compilation, runtime assets, and output formats.

Review exact dependency licenses, including transitive and bundled components.

Separate packaging is not automatically sufficient to resolve GPL or other redistribution obligations.

Document genuine blockers before proceeding.

## Acceptance criteria

Phase 1 is complete when:

- The persistent plan is established.
- Every component has a verified integration strategy.
- Runtime Box boundaries are justified.
- Versions and dependencies have been evaluated.
- Scientific validation fixtures are identified.
- License and redistribution risks are documented.
- Hardware requirements and validation targets are defined.
- No known blocking architectural issue is being ignored.

Proceed autonomously to Phase 2.

---

# Phase 2 — Molecular Preparation, Docking and Virtual Screening

**Components:** AutoDock Vina, RDKit, Meeko, PDBFixer, Ringtail.

**Goal:** Deliver a complete, independently usable molecular docking workflow.

## Molecular preparation

Implement the necessary preparation functionality using RDKit, Meeko, and PDBFixer.

Support:

- PDB and mmCIF receptor inputs.
- SDF ligand inputs.
- Appropriate PDBQT conversions.
- Missing-atom detection.
- Optional supported structural repairs.
- Correct hydrogen handling.
- Explicit protonation assumptions.
- Preservation of atom identity and stereochemistry.
- Validation of bond orders and molecular structure.
- Detection of unsupported chemistry.

Reuse existing OpenMM preparation capabilities whenever appropriate.

Avoid duplicate scientific logic.

Never silently remove residues, cofactors, ligands, metal ions, or biologically significant waters.

All consequential modifications must be documented in the resulting provenance.

## AutoDock Vina

Implement:

- Receptor and ligand input validation.
- Binding-site definition and validation.
- Configurable docking parameters.
- Single-ligand docking.
- Multi-ligand batch screening.
- CPU parallelism and resource limits.
- Random seed configuration.
- Docking poses and score extraction.
- Structured, exportable results.
- Clear failure reporting.

Use the official Vina interface and supported file formats.

Do not treat docking scores as measured binding affinities.

## Ringtail

Integrate Ringtail for:

- Persistent screening result storage.
- Result filtering.
- Candidate ranking.
- Search and comparison.
- Exportable data.
- Links between original input molecules and docking results.

Maintain correct separation of receptor identities, binding sites, and screening configurations.

Do not accidentally mix scientifically incompatible docking experiments.

## Liatir integration

Expose user-facing Tools and pipeline steps.

Target workflow:

`Protein + Ligands → Preparation → Docking → Screening → Results`

Use existing:

- Typed inputs and outputs.
- Scientific artifact validation.
- Jobs and progress reporting.
- Results and provenance.
- Pipeline execution.
- Existing compatible molecular visualization.

Provide useful defaults with advanced options where appropriate.

Users should not need to manually run external CLI commands.

## Scientific validation

Use official examples and experimentally resolved protein–ligand complexes.

Where appropriate, include the official Vina imatinib/BCR-ABL example.

Test:

- Chemical identity preservation.
- Correct coordinate and unit handling.
- Successful known-complex redocking.
- Pose RMSD against an experimental reference.
- Correct score extraction.
- Batch completeness.
- Database integrity.
- Fixed-seed reproducibility expectations.
- Malformed or unsupported chemical inputs.
- Resource limits and cancellation.

Define meaningful reference-based acceptance thresholds.

Do not invent arbitrary scientific accuracy criteria.

## Product validation

Test the complete workflow in the actual Liatir application, using the packaged Runtime Box.

Verify:

- Installation.
- Input selection.
- Execution.
- Progress.
- Results.
- Visualization.
- Pipeline interoperability.
- Cancellation.
- Provenance.
- Uninstallation and recovery.

### Phase 2 completion gate

All components must pass their relevant scientific and product tests.

Prepare and publish the validated Runtime Box through existing infrastructure where authorized.

Verify the actual production artifact, not just the development environment.

Update Syngraphe and the persistent plan.

---

# Phase 3 — Neural Docking and Molecular Analysis

**Components:** GNINA, MDAnalysis, ProLIF.

**Goal:** Improve docking analysis and integrate molecular trajectory analysis with OpenMM.

## GNINA

Implement:

- CNN-based pose scoring.
- Supported CNN rescoring.
- Optional supported pose refinement and docking.
- Comparison with Vina results.
- Clear score interpretation.
- CUDA compatibility checks.
- GPU resource monitoring.
- Input and output validation.

Prefer rescoring as the initial workflow, expanding to more computationally expensive methods only when validated and justified.

Review the exact GNINA release, its model assets, and its dependency licensing.

Do not assume that neural scores are calibrated probabilities of successful binding.

Avoid unsupported affinity claims.

## MDAnalysis

Implement scientifically appropriate trajectory analyses:

- DCD trajectory loading.
- Matching topology validation.
- RMSD.
- RMSF.
- Selected distance and contact analyses.
- Time-series outputs.
- Structured metrics and exportable results.

Respect atom selections, coordinate units, trajectory metadata, and periodic boundary conditions.

## ProLIF

Implement protein–ligand interaction analysis:

- Interaction fingerprints.
- Hydrogen bonds.
- Hydrophobic contacts.
- Other supported interaction types.
- Interaction frequency and persistence.
- Time-resolved interaction summaries.
- Exportable tables and visualization.

Do not duplicate functionality already provided appropriately by MDAnalysis.

## OpenMM interoperability

The existing OpenMM implementation is already published and must remain functional.

Validate the complete supported workflow:

`Docking → Selected Complex → OpenMM → Trajectory Analysis`

Pay particular attention to:

- Atom mappings.
- Ligand identity.
- Bond orders.
- Protonation.
- Topology consistency.
- Force-field parameterization.
- Trajectory/topology matching.
- Correct handling of unsupported chemistry.

A docking pose alone is not a fully parameterized OpenMM system.

Do not silently generate approximate force-field parameters or invent unsupported conversion steps.

If an integration cannot support a particular chemical system, reject it with a clear explanation.

## Scientific validation

Use official examples and independently verifiable reference calculations.

Verify:

- GNINA score extraction and pose outputs.
- Actual CUDA execution.
- Reproducible inference expectations.
- MDAnalysis trajectory calculations.
- ProLIF interaction detection.
- Valid OpenMM trajectory interoperability.
- Correct handling of atom mapping and topology errors.
- GPU/CPU resource consumption.
- Jobs, Results, cancellation, and provenance.

Where possible, test against trajectories produced by the actual published OpenMM Runtime Box.

### Phase 3 completion gate

GNINA, MDAnalysis, and ProLIF must pass independent validation.

The supported OpenMM interoperability workflow must be demonstrated end-to-end.

Incomplete chemical compatibility must be explicitly documented, never hidden.

Complete release-readiness checks and publish independently where authorized.

Update the persistent plan and Syngraphe.

---

# Phase 4 — Biochemical, Metabolic and Multicellular Simulation

**Components:** PySB, BioNetGen, COBRApy, PhysiCell.

**Goal:** Expand Liatir beyond atomic simulation into biochemical networks, cellular metabolism, and multicellular modeling.

Treat the three capabilities below as independently testable and releasable.

## A. PySB + BioNetGen

Implement biochemical reaction network simulation.

Support:

- Loading supported biochemical models.
- Parameter configuration.
- Reaction network simulation.
- Deterministic simulations.
- Stochastic simulations where supported.
- Time-series results.
- Comparison between simulation runs.
- Exportable model and result metadata.

Validate against official upstream reference models.

Respect solver constraints and numerical tolerances.

Because PySB models can contain executable Python, do not silently execute arbitrary untrusted source code.

Use existing Liatir trust and execution policies.

## B. COBRApy

Integrate COBRApy with a reviewed open-source optimization solver.

Support:

- SBML model import.
- Flux Balance Analysis.
- Flux Variability Analysis.
- Gene knockout experiments.
- Metabolic reaction flux outputs.
- Objective function reporting.
- Model constraints.
- Solver diagnostics.
- Exportable results.

Use official, established reference models.

Validate numerical behavior and expected solver status.

Handle infeasible models, invalid constraints, and missing reactions correctly.

Do not treat predicted fluxes as experimentally measured metabolism.

## C. PhysiCell

Integrate PhysiCell using Liatir's existing Native Tool Runtime mechanisms.

PhysiCell is a C++ multicellular simulation framework.

Use a reproducibly compiled, version-pinned execution environment.

Do not build a separate native execution architecture.

Start with reviewed, supported model templates.

Include suitable upstream examples covering:

- General multicellular behavior.
- Tumor growth or cellular heterogeneity.
- Tumor–immune interactions, where supported by the selected release.

Expose meaningful parameters:

- Initial populations.
- Simulation duration.
- Random seed.
- Selected cellular behaviors.
- Environmental/substrate parameters.
- Output intervals.
- CPU thread and resource limits.

Validate configuration files and parameter values before execution.

Do not silently compile arbitrary user-provided C++ code.

## PhysiCell results

Support useful result inspection:

- Cell population counts.
- Cell-state distributions.
- Spatial cell data.
- Time-series statistics.
- Supported substrate outputs.
- Structured and exportable results.

Reuse Liatir's existing visualization infrastructure where appropriate.

Do not build a replacement for PhysiCell Studio or a complex general-purpose cellular modeling IDE.

## Scientific validation

For all three integrations:

- Pin official source versions.
- Use official reference examples.
- Reproduce known results within justified tolerances.
- Verify input parameter handling.
- Validate output consistency.
- Test invalid configurations.
- Measure actual resource consumption.
- Test cancellation and failure handling.
- Verify installation and execution in Liatir.
- Preserve complete provenance.

PhysiCell simulations must be clearly distinguished from experimentally calibrated tumor models.

Do not claim therapeutic efficacy or accurate clinical tumor prediction without appropriate evidence.

### Phase 4 completion gate

Each integration must independently satisfy:

- Scientific correctness.
- Runtime correctness.
- Liatir integration.
- Security.
- Reproducibility.
- Resource management.
- Release readiness.

One failed component must not invalidate the others.

Publish validated components independently where authorized.

Update the persistent plan and project state.

---

# Cross-Phase Quality Requirements

Apply these requirements to every new component.

## Scientific correctness

- Reference-based validation.
- Accurate physical and mathematical units.
- Correct chemical and biological identities.
- Explicit model assumptions.
- Meaningful numerical tolerances.
- Clear scientific limitations.
- No fabricated accuracy or performance claims.
- No silent fallback to scientifically invalid approximations.

## Runtime and security

- Reproducible Scrollcase builds.
- Verified dependencies and assets.
- Licensing and redistribution review.
- Safe file handling.
- No uncontrolled network access during execution.
- Isolated runtime environments.
- Correct GPU and CPU compatibility checks.
- Appropriate memory and execution limits.
- No unsafe shell command construction.
- No arbitrary execution of untrusted model code.
- Safe cancellation, cleanup, and recovery.

## Product integration

- Real Liatir Tools.
- Typed pipeline interfaces.
- Existing Jobs lifecycle.
- Results persistence.
- Scientific provenance.
- Useful progress and error messages.
- Independent concurrent execution where applicable.
- Correct installation and removal.
- User-facing documentation.
- No regressions in existing functionality.

## Verification and releases

For each component:

1. Develop using focused tests.
2. Validate against independent scientific references.
3. Build the exact production Runtime Box.
4. Run scientific validation against the packaged artifact.
5. Run applicable Liatir product lifecycle tests.
6. Record measured performance and resource use.
7. Complete licensing and security gates.
8. Run full relevant verification.
9. Use established signing and distribution workflows.
10. Independently verify public release and installation if authorized.

Do not bypass required approvals, security controls, or publication restrictions.

A successful import, CLI execution, or local build is not sufficient evidence of production readiness.

Do not publish unsupported platforms.

---

# Execution Strategy

Work autonomously and systematically through the four phases.

## Development workflow

For each component:

1. Inspect existing code and prerequisites.
2. Confirm the relevant architecture and scientific reference.
3. Implement the smallest complete vertical slice.
4. Run focused tests.
5. Validate scientific output.
6. Integrate the user-facing workflow.
7. Validate the complete Liatir lifecycle.
8. Prepare the production artifact.
9. Complete applicable release checks.
10. Update Syngraphe and the persistent plan.

Prefer fully functional, independently validated components over partially implemented features across many runtimes.

Avoid broad refactoring or adding speculative abstractions.

Use small, reviewable commits.

Do not repeatedly run expensive tests when existing evidence remains valid and applicable.

## Handling blockers

When a problem occurs:

1. Reproduce it.
2. Identify the root cause.
3. Examine reasonable alternatives.
4. Choose a justified solution.
5. Validate the fix.
6. Record the outcome.
7. Continue unaffected work.

Do not bypass scientific validation or weaken acceptance thresholds merely to make a test pass.

Do not hide unresolved problems behind skipped tests.

Do not stop for routine implementation decisions.

Request intervention only when required by authorization, missing credentials, unacceptable scientific limitations, or genuine blocking constraints.

---

# Progress Reporting

Maintain the canonical plan throughout the project.

At every major checkpoint record:

- Implemented components.
- Validated scientific functionality.
- Runtime Box state.
- Test results.
- Actual resource measurements.
- Decisions and risks.
- Changed files and commits.
- Outstanding blockers.
- Exact next action.

At the end of each major phase, provide a concise progress report.

Use clear evidence-backed status categories:

- IMPLEMENTED
- SCIENTIFICALLY VALIDATED
- PRODUCT VALIDATED
- RELEASE READY
- PUBLISHED
- BLOCKED

Do not mark a component complete merely because it compiles.

## Final Definition of Done

The project is complete when every requested scientific capability has:

1. A working integration in Liatir.
2. A reproducible, isolated Runtime Box.
3. Scientific validation using reference evidence.
4. A usable interface and pipeline integration.
5. Complete Jobs, Results, and provenance behavior.
6. Resource and compatibility validation.
7. Reviewed licensing and security.
8. User documentation.
9. A verified production-ready artifact.
10. Publication completed wherever authorized.

Initial support must cover **Linux x86_64 and Windows through WSL2 only**, using CPU or CUDA as appropriate.

macOS is explicitly excluded and must not delay development or release.

Preserve all existing OpenMM, AI Models, Tools, Plugins, and published Runtime Boxes.

## When you start

1. Inspect the existing repository and WSL2 environment.
2. Read the relevant architecture and Syngraphe context.
3. Create the persistent execution plan.
4. Verify upstream dependencies and scientific feasibility.
5. Complete Phase 1.
6. Continue autonomously into implementation, validation, and release preparation.

**Do not stop after generating the plan. Work through the phases, preserve durable progress checkpoints, and prioritize scientifically valid, production-quality results over implementation speed alone.**