# Liatir — Project Memory

Last updated: 2026-07-07 (session 2)

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
- 37 bridge modules in `src-tauri/src/bridge/`
- Key modules: `python_env.rs` (1411 lines, implemented), `plugins.rs` (WASM runtime, full), `plugin_log.rs` (structured logging), `plugin_progress.rs` (progress tracking), `fs.rs` (sandboxed FS), jobs, notifications, window management
- Dependencies: wasmtime (WASM), tauri_plugin_shell, serde, tokio
- WASM runtime fully operational; **sidecar module removed** — native tools now use `jobs.spawn()` with ToolRef

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
- `@liatir/core` v1.0.0: single source of truth — field schemas, step/pipeline types, plugin manifest, artifact/provenance, execution result, AI model catalog, **built-in native tools catalog** (`BUILT_IN_NATIVE_TOOLS`), **ToolRef types** (`LiatirToolRef`, `LiatirPluginLogEntry`, `LiatirJobProgress`)
- `@liatir/api`: API connector package — **re-exports `tools`, `models`, `plugin`, `api` ToolRefs; `buildLog()`/`buildProgress()` builders; `LiatirNode` includes `log` and `progress`**
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

## Recent Work (2026-07-07 — session 2)

### Plugin Log & Progress System
Implemented structured logging and progress tracking for plugins:

**@liatir/core**
- Created `native-tools.ts` with `BUILT_IN_NATIVE_TOOLS` catalog (samtools, bwa, minimap2, etc.)
- Added types: `LiatirToolRef`, `LiatirPluginLogEntry`, `LiatirJobProgress`, `LiatirLogLevel`
- Added factory functions: `nativeTool()`, `aiModel()`, `liaPlugin()`, `apiRequest()`

**@liatir/api**
- Re-exports: `tools`, `models`, `plugin`, `api` (typed ToolRef references)
- Builders: `buildLog(invoke, jobId)`, `buildProgress(invoke, jobId)`
- `LiatirNode` interface now includes `log: PluginLog` and `progress: PluginProgress`
- `createLiatir()` reads `LIATIR_JOB_ID` env var and injects log/progress instances

**Backend Rust**
- Created `plugin_log.rs`: `lia_plugin_log` command, emits `jobs:log:{jobId}` events
- Created `plugin_progress.rs`: `lia_plugin_progress` command, emits `jobs:progress:{jobId}` events
- Updated `jobs.rs`: added `progress: Option<JobProgress>` field to `JobEntry`, made `JobState` fields `pub(crate)`
- Registered commands in `main.rs` and modules in `mod.rs`

**Frontend**
- Updated `jobs.svelte.ts`: added `JobProgress`, `PluginLogEntry` types; `getLogs()`, `getProgress()`, `subscribeToJob()` methods; auto-subscribes to events on spawn
- Created `JobProgressBar.svelte`: progress bar component with determinate/indeterminate states
- Created `JobLogViewer.svelte`: collapsible log viewer with level colors, copy/export features

### Sidecar Removal
- Removed `sidecar.rs` module
- Removed `lia_sidecar_run` from `main.rs` invoke handler
- Removed sidecar dispatch from `ipc_server.rs`
- Removed `pub mod sidecar` and `pub use sidecar::*` from `mod.rs`
- Native tools now use `jobs.spawn(tools.samtools, args)` pattern

### Build Verification
- ✅ `cargo check` — 0 errors (56 warnings, mostly unused imports)
- ✅ `svelte-check` — 0 errors, 1 benign warning
- ✅ `@liatir/core` build (tsc)
- ✅ `@liatir/api` build:bundle (tsup) — 346 KB JS, 40 KB d.ts
  - Fixed DTS build error by changing `tsconfig.json` path alias from `../liatir-core/src` to `../liatir-core/dist` (rollup-plugin-dts needs compiled declarations)

---

## Recent Work (2026-07-07 — session 1)

### Plugin API Refactoring
- **`@liatir/api` (Node)**: Removed bio/ai/desktop bloat from `packages/liatir-api/src/index.ts`
  - Deleted `src/bio/` (align.ts, qc.ts, variants.ts, _threads.ts) and `src/ai/` (index.ts)
  - Created specific types: `PluginFs`, `PluginFsScope`, `PluginFsPluginScope`, `PluginAppInfo`, `PluginDesktop`, `PluginSidecar`
  - `LiatirNode` now exposes only: `jobs`, `deps`, `sidecar`, `desktop` (fs + app), `paths`, `invoke`
  - `desktop.fs` exposes only `data`, `cache`, `pluginFs`, `paths` (removed `trash` and `diagnostics`)
  - `desktop.app` exposes only `info()` (removed `exit()`)
  - Removed `align`, `qc`, `variants`, `ai`, `pipeline` from top-level

- **`liatir.py` (Python)**: Aligned with Node API in `packages/liatir-cli/src/assets/liatir.py`
  - Removed classes: `_Files`, `_Events`, `_GlobalVariables`, `_Network`, `_Clipboard`, `_Notifications`, `_FsTrash`, `_FsDiagnostics`, `_Pipeline`
  - `_Desktop` now contains only `fs` (data, cache, plugin_fs) and `app` (only info)
  - `Liatir` now exposes: `jobs`, `deps`, `sidecar`, `desktop`, `paths()`, `invoke()`
  - File reduced from 891 to ~530 lines

### Documentation Updates
- Updated all pages in `docs/plugins/api/` with dual Node + Python examples using VitePress code groups
- Created `docs/plugins/api/sidecar.md` with full documentation
- All tables now show both naming conventions:
  - Node (camelCase) | Python (snake_case) | Type | Description
- Added `::: tip` notes explaining that JSON response fields are always camelCase in both languages

### Plugin API Surface (final — updated session 2)
```
Liatir (plugin context)
├── jobs          → spawn, run, kill, status, list, getOutput, clearDone
├── deps          → check, checkMany
├── desktop
│   ├── fs        → data, cache, pluginFs/plugin_fs, paths
│   └── app       → info
├── log           → info, warn, error, debug (structured logging)
├── progress      → start, advance, update, done (progress tracking)
├── paths()       → { data, cache, temp, home, ... }
└── invoke()      → raw escape hatch

ToolRef re-exports:
├── tools         → { samtools, bwa, minimap2, ... } (native tools)
├── models        → { scgpt, enformer, ... } (AI models)
├── plugin(name)  → create ToolRef for .lia plugin
└── api(name)     → create ToolRef for API endpoint
```

### Build Verification
- ✅ `@liatir/api` build (tsup) — 312 KB JS, 37 KB d.ts
- ✅ `@liatir/core` build (tsc)
- ✅ Frontend typecheck (svelte-check) — 0 errors, 0 warnings
- ✅ Unit tests — 48/48 passed (9 test files)

## Architecture Rules (from .clinerules)
- "Plugins" = only `.lia` plugins
- "AI Models" = locally installable model assets
- Heavy deps must be modular and installed on demand
- `packages/liatir-core` is the single source of truth for shared contracts
- State must be owned by the correct entity (workspace, pipeline, run, etc.)
- Never use single global state when domain allows multiple instances
- Always verify: parent identity, per-instance state, navigation behavior, Jobs/Results, provenance
