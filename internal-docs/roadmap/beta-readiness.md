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
| Jobs log/progress transport | **Verified** | Native lifecycle E2E proves child Job attribution, streaming, completion, failure, and kill-on-pipeline-cancel through the shared backend | Extend equivalent gates to direct Plugin and AI Model runtimes |
| Results/provenance finalization | **Verified** | Native E2E proves exactly-once pipeline Results for success, failure, interrupted restart, cancellation, and typed scientific artifacts with correct parent attribution | Extend equivalent gates to every direct Tool and AI Model runtime |
| Pipeline editor | **Implemented — unverified** | Saved graphs, typed nodes, notes, history, async viewport fitting; frontend checks pass | Native UI/visual coverage for load-fit, large graphs, notes, undo/redo, save/reopen |
| Pipeline runtime isolation | **Verified** | Runtime/cancellation are keyed by pipeline/run identity; all pipeline Native Tool runners use shared Jobs; native E2E proves navigation isolation, off-page completion, failure, reload reconciliation, child identity, cancellation, and an unrelated runnable pipeline | Keep new runners on the shared execution context |
| Native Tool execution | **Verified** | Native E2E executes a real managed SeqKit binary and a typed minimap2-to-samtools workflow through the shared managed-bin/PATH Jobs resolver | Expand real scientific sanity fixtures tool by tool |
| Managed Native Tool installation | **Verified** | Checksummed immutable release registry and heavy native SeqKit install/execute/remove E2E; unsupported upstream host assets are explicitly absent | Keep the [support matrix](./native-tool-support.md) and digests current |
| Dependencies page | **Partial** | Real bridge checks plus native managed install/execute/remove coverage | Add update interruption and actionable recovery-state E2E |
| API Connector | **Implemented — unverified** | Saved requests and pipeline node integration exist | Native request/run E2E, auth handling, malformed responses, rate/error states, Results provenance |
| AI Batches 1–4 | **Implemented — unverified** | Managed runtimes and Tools exist for lightweight embeddings, proteomics, and predictive genomics | Targeted real install/inference runs with scientific sanity fixtures and output validation |
| AI Runtime Box distribution | **Production path live — partially native-verified** | Live R2/Worker distribution plus targeted fresh-home native coverage for interruption/resume, signed install, real Geneformer inference, atomic replacement, rollback, and removal | Add a true cross-version native update and document completed offline signing-key backup/rotation operations |
| AI Batch 5 | **Partial** | UCE remains runnable; Geneformer has live Runtime Box lifecycle and exact pinned-upstream parity evidence; scGPT has a hash-locked box recipe and real CPU inference gate; scFoundation checkpoint redistribution is license-blocked | Publish/cut over scGPT and prove its native lifecycle; choose a legally distributable replacement or user-supplied flow for scFoundation |
| AI Batches 6–8 | **Planned** | Roadmap only | Complete prerequisite runtime/tool gates before implementation |
| Scientific viewers | **Implemented — unverified** | Optional local viewer runtimes and visual pages exist | Native visual/runtime coverage with real artifacts, failures, fullscreen, and capture |
| Quenta | **Partial** | Read-only Ollama MVP with shared contracts, local retrieval, Result/Job deep links, cited reports, unit tests, Rust loopback tests, and mock-Ollama Tauri E2E | Real local Ollama evaluation matrix with recommended model(s), report-quality review, latency/error expectations, and no-tool-call audit |
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

1. Finish the remaining heavy AI Model integrations on the signed Runtime Box
   foundation without widening scope to new model families.
2. Validate the live R2/Worker distribution and existing AI Batches 1–5 with
   targeted real runtime and scientific fixtures.
3. Run the real local Ollama Quenta evaluation matrix and document recommended
   model choices.
4. Add the MCP server with allowlisted saved-pipeline execution.
5. Finish useful plugin, API Connector, and pipeline presets.
6. Close macOS distribution gates and run the release-candidate matrix.

Update this ledger only when evidence changes. Every status promotion must cite
a repeatable gate, not a manual implementation claim.
