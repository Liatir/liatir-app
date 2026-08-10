# Beta 1 Readiness

Last reviewed: 2026-08-10

This page is the cross-surface readiness ledger for the first production-grade
Liatir beta. It complements the canonical
[Scientific AI Workbench product plan](./scientific-ai-workbench.md), detailed
[AI batch ledger](./ai-batches.md), and
[testing strategy](../testing/overview.md); it does not duplicate their
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
| Legacy AI batches | **Removed** | The pre-release mock, local-build, direct-download, CellTypist, sequence/genomics, regulatory, and structure model paths were removed on 2026-07-22 | Do not restore a legacy installer; reintroduce a family only after its signed Runtime Box and product lifecycle are validated |
| Runtime Box AI Model distribution | **Partial** | The public `beta` catalog serves nine KMS-signed schema-v2 targets: Geneformer on macOS Metal plus Linux CUDA 12.9 and Windows CUDA 12.8; scGPT on macOS Metal, Linux/Windows CPU and both CUDA targets; UCE on macOS Metal. Every target has reviewed native product-lifecycle evidence. Geneformer and scGPT `beta.1` are jointly revoked. UCE `beta.1` is unselected and v2-incompatible but not revoked | Complete the P5 consumer/deletion boundary, prove a true cross-version native update, persist signed anti-replay/version-floor state, and decide explicitly whether UCE `beta.1` belongs in revocations |
| Single-cell Embedding AI Tool | **Implemented — model evidence varies by target** | One shared Tool runs Geneformer, scGPT, and UCE through their signed boxes and produces AnnData, preview, summary, Jobs, Results, and Runtime Box provenance | Complete common execution-spine parity and keep model-specific scientific gates repeatable |
| Future AI families | **Deferred** | No preview entries or dormant product integrations remain | Re-plan each family from legal review through published Runtime Box evidence after current workbench gates close |
| Scientific viewers | **Implemented — unverified** | Optional local viewer runtimes and visual pages exist | Native visual/runtime coverage with real artifacts, failures, fullscreen, and capture |
| Quenta | **Partial** | Read-only Ollama MVP with shared contracts, local retrieval, Result/Job deep links, cited reports, unit tests, Rust loopback tests, and mock-Ollama Tauri E2E | Real local Ollama evaluation matrix with recommended model(s), report-quality review, latency/error expectations, and no-tool-call audit |
| Liatir MCP server | **Planned** | Product boundary agreed: resources plus controlled saved-pipeline execution | Threat model, allowlist, asynchronous run identity, audit, Jobs/Results attribution, real client test |
| Plugin templates | **Partial** | CLI scaffolds supported runtimes | Replace toy examples with useful, tested scientific templates for every supported runtime |
| API/pipeline presets | **Planned** | Individual tools and demo files exist | Versioned useful presets backed by small realistic fixtures and end-to-end tests |
| Public/internal documentation | **Partial** | Both VitePress sites build successfully | Remove stale architecture, finish first-workflow and troubleshooting paths |
| macOS distribution | **Partial** | macOS is the primary compile/test platform | Clean-machine signed and notarized install, update, migration, and uninstall validation |
| Windows/Linux distribution | **Partial** | The current Linux and Windows Runtime Box targets are published and product-lifecycle verified, including CUDA on both systems and scGPT CPU. This is model-distribution evidence, not a complete desktop application release matrix | Complete signed desktop packaging, install/update/migration/uninstall, and native UI coverage per supported OS |

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

1. Close the remaining Scrollcase P5 consumer-boundary and legacy-deletion work.
2. Close true cross-version Runtime Box update and client-persisted anti-replay
   state.
3. Close the Plugin, direct AI, API Connector, and dependency lifecycle gaps
   required by the common execution spine.
4. Add backward-compatible scientific artifact profiles in
   `packages/liatir-core` and prove them first through the single-cell
   lighthouse workflow.
5. Complete the single-cell viewer, downstream artifact reuse, and one useful
   no-code preset.
6. Implement a first-class local Nextflow adapter and prove that one declared
   output can feed an existing AI Tool or viewer.
7. Validate the implemented predictive genomics and protein verticals before
   adding new model families.
8. Close the evidence-backed desktop release matrix and public documentation.

Quenta expansion, MCP, simulations, generative model families, and additional
workflow engines remain deferred until the workbench product gate above is
coherent. See the product plan for the full rationale and phase exit criteria.

Update this ledger only when evidence changes. Every status promotion must cite
a repeatable gate, not a manual implementation claim.
