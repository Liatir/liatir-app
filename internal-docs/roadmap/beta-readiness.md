# Beta 1 Readiness

This page is the cross-surface readiness ledger for the first production-grade
Liatir beta. It complements the detailed [AI batch roadmap](./ai-batches.md)
and [testing strategy](../testing/overview.md); it does not duplicate their
registries or runtime contracts.

## Status definitions

- **Verified**: covered by a repeatable automated gate at the layer where the
  feature actually runs.
- **Implemented — unverified**: the production path exists and builds, but its
  real native/runtime behavior is not yet covered by the required gate.
- **Partial**: a useful vertical slice exists, but known product or platform
  paths are missing.
- **Planned**: no production-ready vertical slice exists yet.

Build success alone never upgrades a native, scientific, or heavy-runtime
feature to Verified.

## Current readiness ledger

| Area | Status | Current evidence | Gate required to advance |
| --- | --- | --- | --- |
| Shared pipeline I/O contract | **Verified** | `packages/liatir-core`; contract/unit tests; SDK type generation; CI verify profile | Keep generated consumers drift-free |
| TypeScript/frontend build | **Verified** | `npm run test:verify`; blocking Ubuntu CI quality job | Keep the verify profile blocking |
| Rust bridge compilation/tests | **Verified** | Blocking macOS `cargo test` CI job; local `cargo check` | Reduce the existing warning baseline; make Clippy blocking |
| Plugin build contracts | **Verified** | Generated Node, Python, and WASM fixtures exercise the common manifest/schema contract | Keep fixtures generated and isolated |
| Plugin native execution | **Partial** | Python has a native Tauri E2E; Node/WASM build and IPC contract tests exist | Native run E2E for Node and WASM, including failure, logs, progress, Jobs, and Results |
| Jobs log/progress transport | **Implemented — unverified** | Backend IPC dispatch, per-job identity injection, Jobs UI wiring | Native E2E for concurrent jobs, navigation, failure, cancellation, and late completion |
| Results/provenance finalization | **Implemented — unverified** | Pipeline and AI finalizers write structured Results and parent metadata; native E2E proves exactly-once successful pipeline finalization off-page | Add failure, cancellation, tool-job parent attribution, and restart coverage |
| Pipeline editor | **Implemented — unverified** | Saved graphs, typed nodes, notes, history, async viewport fitting; frontend checks pass | Native UI/visual coverage for load-fit, large graphs, notes, undo/redo, save/reopen |
| Pipeline runtime isolation | **Implemented — unverified** | Runtime state is keyed by `pipelineId`; native E2E proves run A remains attached while B opens and stays runnable, then A finalizes off-page | Add reload, failure, cancellation, and spawned Jobs coverage |
| Native Tool execution | **Partial** | Shared catalog and backend managed-bin/PATH resolver exist | Install and execute every supported tool through the same backend path on supported hosts |
| Managed Native Tool installation | **Partial** | Verified release metadata currently covers minimap2 and bwa-mem2 only | Add checksummed, versioned install/update/remove paths for the beta tool set |
| Dependencies page | **Partial** | Real bridge dependency checks have a native E2E | Native install/update/remove/interruption tests and actionable recovery states |
| API Connector | **Implemented — unverified** | Saved requests and pipeline node integration exist | Native request/run E2E, auth handling, malformed responses, rate/error states, Results provenance |
| AI Batches 1–4 | **Implemented — unverified** | Managed runtimes and Tools exist for lightweight embeddings, proteomics, and predictive genomics | Targeted real install/inference runs with scientific sanity fixtures and output validation |
| AI Batch 5 | **Partial** | UCE is runnable; scGPT, Geneformer, and scFoundation remain preview entries | Complete one model at a time with managed assets, runtime, Jobs, Results, provenance, and native E2E |
| AI Batches 6–8 | **Planned** | Roadmap only | Complete prerequisite runtime/tool gates before implementation |
| Scientific viewers | **Implemented — unverified** | Optional local viewer runtimes and visual pages exist | Native visual/runtime coverage with real artifacts, failures, fullscreen, and capture |
| Local Tutor | **Planned** | Product boundary agreed: read-only explanation, guidance, and cited reports | Base model + RAG evaluation before any fine-tuning decision |
| Liatir MCP server | **Planned** | Product boundary agreed: resources plus controlled saved-pipeline execution | Threat model, allowlist, asynchronous run identity, audit, Jobs/Results attribution, real client test |
| Plugin templates | **Partial** | CLI scaffolds supported runtimes | Replace toy examples with useful, tested scientific templates for every supported runtime |
| API/pipeline presets | **Planned** | Individual tools and demo files exist | Versioned useful presets backed by small realistic fixtures and end-to-end tests |
| Public/internal documentation | **Partial** | Both VitePress sites build successfully | Remove stale architecture, finish first-workflow and troubleshooting paths |
| macOS distribution | **Partial** | macOS is the primary compile/test platform | Clean-machine signed and notarized install, update, migration, and uninstall validation |
| Windows/Linux distribution | **Planned** | No production release matrix | Native CI/build/runtime matrix and explicit supported-platform decision |

## Release-blocking scenarios

The beta cannot ship until automated native coverage proves:

1. Pipeline A can run while pipeline B is opened or edited.
2. A run can finish while the user is on another page.
3. Failure and cancellation leave Jobs, Results, and inputs coherent.
4. Reload or app restart never leaves a process falsely marked as running.
5. Results finalize once with complete provenance and the correct parent.
6. Unrelated pipelines, plugins, tools, and models remain usable.
7. User-facing paths and errors are readable and do not expose avoidable
   absolute paths.

## Immediate execution order

1. Add the missing native lifecycle E2E coverage for pipelines, Jobs, and
   Results.
2. Complete the managed Native Tool beta set and its install/recovery tests.
3. Validate existing AI Batches 1–4 with targeted real runtime fixtures.
4. Build the read-only Tutor vertical slice and evaluation suite.
5. Add the MCP server with allowlisted saved-pipeline execution.
6. Finish useful plugin, API Connector, and pipeline presets.
7. Close macOS distribution gates and run the release-candidate matrix.

Update this ledger only when evidence changes. Every status promotion must cite
a repeatable gate, not a manual implementation claim.
