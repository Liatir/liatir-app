# Beta 1 Readiness

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
| AI Batches 1–4 | **Implemented — unverified** | Managed runtimes and Tools exist for lightweight embeddings, proteomics, and predictive genomics | Targeted real install/inference runs with scientific sanity fixtures and output validation |
| AI Runtime Box distribution | **Production path live — partially native-verified** | Live R2/Worker distribution; private Cloud Run signer backed by non-exportable Ed25519 Cloud KMS key; Geneformer is published and beta-promoted for macOS arm64 Metal, Linux x86_64 CPU/CUDA 12.4, and Windows x86_64 CPU with native install, inference, Jobs, Results, provenance, replacement, rollback, and removal evidence | Add a true cross-version native update and persist signed anti-replay channel state in the client; keep Windows CUDA explicitly unsupported until native evidence exists |
| AI Batch 5 | **Partial** | UCE has a live KMS-signed macOS arm64 beta box, focused exact-runner CPU/Metal parity, and a targeted native install/direct Job/finite Result/Jobs/Results/removal gate; Geneformer has reviewed lifecycle and scientific evidence on macOS Metal, Linux CPU/CUDA, and Windows CPU; scGPT has a live signed box plus real CPU/Metal and native install/Jobs/removal evidence; scFoundation checkpoint redistribution is license-blocked | Choose a legally distributable replacement or user-supplied flow for scFoundation; keep model-specific scientific gates repeatable and do not infer Windows CUDA from Linux CUDA |
| AI Batches 6–8 | **Planned** | Roadmap only | Complete prerequisite runtime/tool gates before implementation |
| Scientific viewers | **Implemented — unverified** | Optional local viewer runtimes and visual pages exist | Native visual/runtime coverage with real artifacts, failures, fullscreen, and capture |
| Quenta | **Partial** | Read-only Ollama MVP with shared contracts, local retrieval, Result/Job deep links, cited reports, unit tests, Rust loopback tests, and mock-Ollama Tauri E2E | Real local Ollama evaluation matrix with recommended model(s), report-quality review, latency/error expectations, and no-tool-call audit |
| Liatir MCP server | **Planned** | Product boundary agreed: resources plus controlled saved-pipeline execution | Threat model, allowlist, asynchronous run identity, audit, Jobs/Results attribution, real client test |
| Plugin templates | **Partial** | CLI scaffolds supported runtimes | Replace toy examples with useful, tested scientific templates for every supported runtime |
| API/pipeline presets | **Planned** | Individual tools and demo files exist | Versioned useful presets backed by small realistic fixtures and end-to-end tests |
| Public/internal documentation | **Partial** | Both VitePress sites build successfully | Remove stale architecture, finish first-workflow and troubleshooting paths |
| macOS distribution | **Partial** | macOS is the primary compile/test platform | Clean-machine signed and notarized install, update, migration, and uninstall validation |
| Windows/Linux distribution | **Partial** | The Geneformer Runtime Box path is published and native-verified on Linux CPU/CUDA and Windows CPU; this does not establish the complete desktop application release matrix | Complete signed desktop packaging, install/update/migration/uninstall, and native UI coverage per supported OS; Windows CUDA remains unsupported |

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

1. Finish the active Runtime Box CI foundation from Gate 9 through Gate 10 in
   the exact order and approval boundary defined by its canonical plan.
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
8. Close the evidence-backed release matrix and public documentation.

Quenta expansion, MCP, simulations, generative model families, and additional
workflow engines remain deferred until the workbench product gate above is
coherent. See the product plan for the full rationale and phase exit criteria.

Update this ledger only when evidence changes. Every status promotion must cite
a repeatable gate, not a manual implementation claim.
