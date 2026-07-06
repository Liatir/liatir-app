# Liatir — Project Memory

Last updated: 2026-07-06

## Project Identity

- **Name:** Liatir
- **Repo:** `tauri-builder` (GitHub: `Liatir/tauri-builder`)
- **Website:** https://liatir.com
- **Type:** Local-first Rust/Tauri 2 desktop app for bioinformatics
- **Current version:** 0.2.1 (package), Tauri identifier `app.liatir.app`
- **Target:** Beta production-level release

## Architecture Summary

### Backend (Rust — `src-tauri/`)
- Tauri v2 with ~120 commands exposed via `main.rs`
- 36 bridge modules in `src-tauri/src/bridge/`
- Key modules: `python_env.rs` (1411 lines, implemented), `plugins.rs` (WASM runtime, full), `sidecar.rs` (native binary runner, scaffold), `fs.rs` (sandboxed FS), jobs, notifications, window management
- Dependencies: wasmtime (WASM), tauri_plugin_shell (sidecar), serde, tokio
- WASM runtime fully operational; sidecar abstraction exists but real binaries not yet bundled

### TypeScript Bridge (`src-ts/`)
- IIFE bridge exposing `window.Liatir` via builder pattern
- Modules: core, liatir, modules (rs/, bio/, ai/, viewers/), utils, worker, sdk
- Pipeline orchestrator in `src-ts/modules/bio/pipeline/` — chains WASM + sidecar steps sequentially
- TODO: step output → next step input chaining (currently each step is independent)

### Frontend (`frontend/`)
- SvelteKit 2.48 + Svelte 5 (runes) + Vite 7 + Tailwind CSS 4
- Static adapter with SPA fallback
- Routes: Dashboard, Workspaces, Tools, AI Models, AI Tools, Pipelines (visual editor with @xyflow/svelte), Plugins, Viewers (genome track, single-cell, structure), Jobs, Results, Settings, Dependencies
- Key deps: @xyflow/svelte, codemirror, plotly.js, iconify/lucide

### Shared Packages (`packages/`)
- `@liatir/core` v1.0.0: single source of truth — field schemas, step/pipeline types, plugin manifest, artifact/provenance, execution result, AI model catalog, built-in tool definitions
- `@liatir/api`: API connector package
- `@liatir/cli`: CLI for plugin development
- `sdk/`: public SDK with generated types from core

### Test Infrastructure (`tests/`)
- Multi-profile test matrix: fast, verify, build, ui, visual, heavy-ai, all
- 10 suites: unit (Vitest), sdk-types, core-build, frontend-check, frontend-build, src-ts-compile, tauri-e2e, visual-e2e, heavy-ai-e2e
- E2E runs on real Tauri webview binary

## AI Roadmap Status

| Batch | Description | Status |
|-------|-------------|--------|
| 0 | AI foundations | ✅ Completed |
| 1 | Lightweight AI Tools (CellTypist, NT embeddings) | ✅ Implemented, under validation |
| 2 | Scientific visualizations (viewers) | ✅ Implemented, under visual validation |
| 3 | Proteomics AI (Boltz-2, Chai-1) | ✅ Implemented, under scientific validation |
| 4 | Predictive genomics (Enformer, Basenji2, Borzoi) | ✅ Implemented, under heavy validation |
| 5 | Single-cell foundation models (UCE, scGPT, Geneformer) | 🔄 In progress (UCE done, others preview) |
| 6 | Simulations/biophysics (OpenMM, GROMACS) | 📋 Planned |
| 7 | Advanced generative AI (BioEmu, RFdiffusion, Evo 2) | 📋 Planned |
| 8 | Preset pipelines | 📋 Planned after tools stable |

## Key Gaps for Beta (identified 2026-07-06)

### Critical
1. **Sidecar binaries not bundled** — samtools, minimap2, bwa, fastp, seqkit, bcftools, snpEff exist as tool definitions but real platform binaries need to be packaged under `src-tauri/binaries/`
2. **Pipeline step chaining incomplete** — steps run independently; output→input wiring between steps is a TODO
3. **Batch 5 AI models** — scGPT, Geneformer, scFoundation still preview-only without managed runtime boxes

### Important
4. **Error handling robustness** — needs real-world testing with malformed inputs, large files, interrupted runs
5. **Cross-platform validation** — macOS primary dev; Windows/Linux need testing
6. **Build/publish pipeline** — scripts exist but production signing, notarization, and distribution need verification
7. **Documentation completeness** — public docs exist but may need user-facing guides and API reference polish

### Nice-to-have for beta
8. **Preset pipelines** (Batch 8) — not started, depends on tool stability
9. **Heavy AI validation** — test infrastructure exists but coverage of all AI tools needs expansion
10. **Performance optimization** — large file handling, memory usage, WASM compilation speed

## Development Commands

```sh
# Local dev setup
bash scripts/local-dev-conf.sh
cargo tauri dev

# Build
npm run build          # production build
npm run build:dev      # dev build

# Test
npm run test:fast      # unit tests only
npm run test:verify    # quality gate (no native)
npm run test:full      # everything
npm run test:heavy:ai  # include heavy AI tests

# Publish
npm run liatir:publish -- --patch
npm run sdk:publish
```

## Architecture Rules (from .clinerules)
- "Plugins" = only `.lia` plugins
- "AI Models" = locally installable model assets
- Heavy deps must be modular and installed on demand
- `packages/liatir-core` is the single source of truth for shared contracts
- State must be owned by the correct entity (workspace, pipeline, run, etc.)
- Never use single global state when domain allows multiple instances
- Always verify: parent identity, per-instance state, navigation behavior, Jobs/Results, provenance