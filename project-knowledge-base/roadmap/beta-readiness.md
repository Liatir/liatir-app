# Beta 1 Readiness

Last reviewed: 2026-08-20

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
| Scientific artifact semantics | **Verified — AnnData/single-cell** | Core-owned `org.liatir.scientific.anndata@1.0.0`; streamed native SHA-256/HDF5 identity; separate transport, format and scientific compatibility; persisted validation and lineage; viewer handoff and downstream Data reuse; unit plus native E2E | Add other profiles incrementally without creating a parallel artifact system |
| TypeScript/frontend build | **Verified** | `npm run test:verify`; blocking Ubuntu CI quality job | Keep the verify profile blocking |
| Rust bridge compilation/tests | **Verified** | Blocking macOS `cargo test` CI job; local `cargo check` | Reduce the existing warning baseline; make Clippy blocking |
| Plugin build contracts | **Verified** | Generated Node, Python, and WASM fixtures exercise the common manifest/schema contract | Keep fixtures generated and isolated |
| Plugin native execution | **Verified** | Python has native execution coverage; delayed Node Plugin work has pipeline Job/Result, output and cancellation E2E; standalone WASM execution has native success, failure, progress, logs, off-page cancellation, Jobs and exactly-once Results coverage | Keep every Plugin runtime on the shared execution identity and lifecycle contract |
| Jobs log/progress transport | **Verified** | Native lifecycle E2E proves child and standalone Job attribution, streaming, progress, completion, failure and owner-scoped cancellation through the shared backend | Keep new runners on the shared backend and identity metadata |
| Results/provenance finalization | **Verified** | Native and restart E2E prove first-writer/exactly-once Results for pipeline and direct API Connector, Native Tool, Plugin and AI Model identities across success, failure, cancellation, navigation and restart | Keep Result publication behind terminal work and durable artifacts |
| Pipeline editor | **Implemented — unverified** | Saved graphs, typed nodes, notes, history, async viewport fitting; frontend checks pass | Native UI/visual coverage for load-fit, large graphs, notes, undo/redo, save/reopen |
| Pipeline runtime isolation | **Verified** | Runtime/cancellation are keyed by pipeline/run identity; all pipeline Native Tool runners use shared Jobs; native E2E proves navigation isolation, off-page completion, failure, restart reconciliation, child identity, cancellation, and an unrelated pipeline actually completing concurrently | Keep new runners on the shared execution context |
| Pipeline asynchronous settlement | **Verified** | One shared Job barrier covers Native Tools, Node/Python Plugins and AI Tools; API and sub-pipeline children are awaited; outputs are durable before terminal nodes and Results. Native E2E proves spawn/downstream ordering, cancellation and failure across Plugin, API and nested pipelines, plus sequential Native Tool Jobs and concurrent independent pipelines. A two-process suite proves exactly-once interrupted restart recovery | Keep the native lifecycle and `pipeline:test:settlement-restart` suites blocking for new runners |
| Native Tool execution | **Verified** | Pipeline and every standalone Native Tool page use the shared Jobs backend; process-backed tools use the managed-bin/PATH resolver. Native E2E covers direct FastQC WASM Job/Result success and cancellation plus real SeqKit and typed minimap2-to-samtools paths | Expand real scientific sanity fixtures tool by tool |
| Managed Native Tool installation | **Verified** | Checksummed immutable release registry and heavy native SeqKit install/execute/remove E2E; unsupported upstream host assets are explicitly absent | Keep the [support matrix](./native-tool-support.md) and digests current |
| Dependencies page | **Partial** | Dependency operations have independent execution identity; native E2E proves cancellation retains partial bytes and the next attempt resumes with HTTP Range, while source contracts pin actionable interrupted recovery. The broad page-navigation test is stale because the sidebar route is intentionally hidden | Restore a user-facing page-level recovery assertion when Dependencies navigation is finalized |
| API Connector | **Verified** | Native E2E covers direct and pipeline success, failure, cancellation, nested execution, durable outputs, isolation and Result provenance; contract tests classify OAuth, malformed structured responses, HTTP and rate-limit failures | Keep direct and pipeline calls on the same validated response and execution path |
| Legacy AI batches | **Removed** | The pre-release mock, local-build, direct-download, CellTypist, sequence/genomics, regulatory, and structure model paths were removed on 2026-07-22 | Do not restore a legacy installer; reintroduce a family only after its signed Runtime Box and product lifecycle are validated |
| Runtime Box AI Model distribution | **Verified — cross-platform security** | The public `beta` catalog serves nine KMS-signed schema-v2 targets and every target has reviewed native product-lifecycle evidence. Scrollcase P5 and security Gate 1 are complete. One lightweight native suite proves true A-to-B update, rollback, app-global persisted anti-replay across restart, old/equivocal channel and revocation rejection, accepted-revocation retention across 404, and corrupt-state isolation on macOS arm64, Windows x86_64, and Linux x86_64. Geneformer and scGPT `beta.1` are jointly revoked; UCE `beta.1` is unselected and v2-incompatible but not revoked | Keep the security lifecycle repeatable on all three platforms and decide explicitly whether UCE `beta.1` belongs in revocations |
| Single-cell Embedding AI Tool | **Verified — lighthouse orchestration; model evidence varies by target** | One shared Tool runs Geneformer, scGPT, and UCE through their signed boxes and produces profiled immutable AnnData, bounded PCA preview, summary, Jobs, Results, Runtime Box provenance, digest and lineage through the common execution identity. Native Gate 5 E2E proves viewer handoff and Data reuse without re-running heavy models | Keep model-specific product gates repeatable and label bounded previews separately from full scientific analyses |
| Future AI families | **Deferred** | No preview entries or dormant product integrations remain | Re-plan each family from legal review through published Runtime Box evidence after current workbench gates close |
| Scientific viewers | **Partial — single-cell verified** | Native Gate 5 E2E proves profiled AnnData handoff, bounded preview rendering, validation/provenance display and Result-to-Data-to-viewer reuse. Protein and genome surfaces remain unverified | Add native visual/runtime coverage for the remaining viewers, failures, fullscreen and capture |
| External Workflows / Nextflow | **Verified — cross-platform Gate 6** | Core-owned saved definitions and one direct/pipeline adapter are verified on macOS arm64, native Linux x86_64, and the native Windows x86_64 app through WSL2 Linux x86_64. The Windows backend owns safe path mapping, per-run staging/control, token-scoped process-tree cancellation, exact output collection, provenance, parent identity, and two-process restart cleanup. Windows app-to-WSL and Linux Xvfb suites are each 3/3; Windows restart is 2/2 phases; both platforms pass 51 files / 296 tests, Rust tests, and Clippy | Keep the focused product and restart gates repeatable; do not infer native-Windows Nextflow, WSL1/ARM64, managed installation, or HPC/cloud support |
| Quenta | **Partial** | Read-only Ollama MVP with shared contracts, local retrieval, Result/Job deep links, cited reports, unit tests, Rust loopback tests, and mock-Ollama Tauri E2E | Real local Ollama evaluation matrix with recommended model(s), report-quality review, latency/error expectations, and no-tool-call audit |
| Liatir MCP server | **Planned** | Product boundary agreed: resources plus controlled saved-pipeline execution | Threat model, allowlist, asynchronous run identity, audit, Jobs/Results attribution, real client test |
| Plugin templates | **Partial** | CLI scaffolds supported runtimes | Replace toy examples with useful, tested scientific templates for every supported runtime |
| API/pipeline presets | **Partial — single-cell verified** | The saved `single-cell-embedding-viewer-v1` preset connects typed Tool outputs to the viewer; unit and native E2E verify creation and persisted references | Add further presets only from individually verified nodes and realistic bounded fixtures |
| Public/internal documentation | **Verified — Gate 7 core path** | Both VitePress sites build successfully; public install, platform matrix, first single-cell analysis, Nextflow handoff, update, recovery, uninstall and troubleshooting paths are present and distinguish local evidence from public release claims | Keep the support matrix synchronized with signed package evidence on each platform |
| macOS distribution | **Partial — Gate 7 local layer closed** | Production UI is bundled for offline startup; explicit signed-updater UI and Job guard are natively verified; an ad-hoc non-publishable DMG was built, `codesign`/`hdiutil` verified and mounted on the current revision; two native processes prove one-time migration, restart recovery and Results retention after app removal; corrupt-index startup recovery is natively 1/1; Gate 5 is 1/1 and real Nextflow is 3/3. The desktop lifecycle proof is a declared `desktop-beta-lifecycle-e2e` suite in the `ui` profile. Re-executed in full on 2026-08-20 against the shared Windows/Linux changes: the complete `ui` profile is green for the first time on macOS at 31 passed / 0 failed / 24 skipped, `test:verify` is 53 files / 318 tests, `cargo test` is 58/2 ignored, Clippy exits 0, and the ad-hoc DMG gate passes with `codesign` and `hdiutil` verified | Developer ID signing, Apple notarization/stapling, clean-machine install and real signed updater A-to-B/reinstall proof |
| Windows desktop distribution | **Partial — Gate 7 local layer closed** | The real NSIS installer is built and inspected by `desktop-beta:package:windows`: `MZ` and `NullsoftInst` structure, `NotSigned` Authenticode on the installer and on both the packaged and installed executables, then a real silent per-user install into a test-owned directory and removal by the generated uninstaller, leaving no registry entry, shortcut or directory behind. Two native processes prove migration, restart recovery and Results retention after uninstall; updater/Job safety is 1/1, Gate 5 is 1/1, and Gate 6 through WSL2 is 3/3 plus 2/2 restart phases. `build-desktop-release.mjs` now implements the Windows signing/artifact contract | Settle the Microsoft Store route chosen on 2026-08-20 — package format, a build without the in-app updater, and MSIX containment against managed binaries, Python environments and Runtime Boxes — then a clean-machine install and a real signed update proof. This NSIS evidence is not evidence for a Store submission |
| Linux desktop distribution | **Partial — Gate 7 local layer closed** | An independently compiled x86_64 ELF app in a Linux-filesystem checkout passes the desktop lifecycle, updater/Job safety, Gate 5 and native Nextflow under Xvfb. `desktop-beta:package:linux` builds and inspects the claimed `.deb`, `.rpm` and AppImage formats and requires that no updater signature is produced | A signed, distributable package per format, its update feed, and a clean-machine install/update/uninstall proof; `build-desktop-release.mjs` still deliberately rejects Linux |
| Runtime Box OS coverage | **Verified — model distribution** | The current Linux and Windows Runtime Box targets are published and product-lifecycle verified, including CUDA on both systems and scGPT CPU. This is model-distribution evidence, not a desktop application release matrix | Keep target evidence current as boxes are re-released |

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
8. A spawned asynchronous child cannot release a downstream node or finalize
   its parent Result before terminal state and durable output registration.

## Immediate execution order

1. Implement controlled local MCP access with a real client (Gate 8). Gate 7
   closed at its local layer on 2026-08-20, so this is no longer queued behind
   a purchase.
2. Complete public-shaped signing, notarization and real signed-update evidence
   on macOS, Windows and Linux — the
   [Release gate](./release-signed-distribution.md). Every platform's local
   packaging, lifecycle and documentation is complete and executed; what remains
   depends on credentials, a paid account and the Windows Store decision rather
   than on engineering, so it does not block other work and must not be started
   from inference.

Quenta expansion, simulations, generative model families, additional scientific
verticals, and additional workflow engines remain deferred until the workbench
product gate above is coherent. See the product plan for the full rationale and
gate exit criteria.

Update this ledger only when evidence changes. Every status promotion must cite
a repeatable gate, not a manual implementation claim.
