# Architecture

Liatir is a Tauri 2 desktop application with a Rust backend and a SvelteKit frontend. Understanding the layering matters when you want to add a new tool, write a `.lia` plugin, or contribute to the codebase.

## High-level overview


<div style="display: flex; justify-content: center; margin: 2rem 0;">
  <img
    src="/static/Liatir arch.png"
    alt="Desktopr Companion Playground"
    style="max-width: 100%; border-radius: 12px;"
  />
</div>

## Frontend stack

| Layer | Technology |
|-------|-----------|
| Framework | SvelteKit |
| Styling | Tailwind CSS v4 |
| Reactivity | Svelte 5 runes (`$state`, `$derived`, `$effect`) |
| Charts | Plotly.js |
| Build | Vite |

The frontend communicates with Rust exclusively through `window.Liatir`, typed publicly as `LiatirBrowserAPI`. Direct `__TAURI__` calls are avoided — always use the `liatir()` helper from `$lib/api.ts`:

```typescript
import { liatir } from '$lib/api'
import type { LiatirBrowserAPI } from '@liatir/sdk'

const api = liatir() as LiatirBrowserAPI | null  // window.Liatir ?? null
const size = await api.invoke('lia_file_size', { path }) as number
```

If the local helper returns `any`, use `as` casts to narrow return types. Do **not** rely on generic type parameters on `api.invoke<T>()` when the receiver is `any`.

## Rust backend

The backend is split into bridge modules under `src-tauri/src/bridge/`:

| Module | Responsibility |
|--------|---------------|
| `managed_bins.rs` | Filesystem ops, file preview, dep checks |
| `job_runner.rs` | Process spawning, stdout/stderr streaming, job registry |
| `ipc_server.rs` | Axum server that proxies `lia_*` calls for Node.js plugins |
| `lia_runtime.rs` | `.lia` bundle validation, manifest parsing, execution |

Every `lia_*` command must be:
1. Implemented as a `#[tauri::command]` function in a bridge module
2. Registered in `src-tauri/src/main.rs` in the `invoke_handler!` macro
3. Declared in `src-tauri/permissions/liatir-bridge.toml`

Missing the permissions file entry causes a "command not allowed" error at runtime even if the command is registered in the invoke handler.

## IPC server

An [Axum](https://github.com/tokio-rs/axum) HTTP server starts on a random port when the app launches. Its address and a Bearer token are written to `{app_data_dir}/.ipc`.

The IPC server is how `.lia` plugins call back into the Rust backend while they execute. The `liatir-adapter` Node.js package reads `.ipc` at plugin startup and authenticates with the Bearer token. This lets plugin code call `lia_fs_paths`, read files, stream job output, and write results — all from within the JavaScript bundle — without exposing any Tauri APIs directly.

```
{app_data_dir}/
  .ipc                     ← "http://127.0.0.1:PORT Bearer TOKEN"
  analysis-runs/
    samtools/
      <run-id>.json
    bcftools/
      <run-id>.json
  tool-outputs/
    fastp-<run-id>-R1.fastq.gz
    fastp-<run-id>-R2.fastq.gz
  plugins/
    my-plugin.lia
```

## Capability system

Tauri 2 has a strict capability model. Every `lia_*` command that can be invoked from the frontend must appear in `src-tauri/permissions/liatir-bridge.toml` under `[[permission.commands.allow]]`. This file is the **authoritative access control list** — the invoke handler registration alone is not sufficient.

## Cargo.toml — NEVER edit directly

`conf-templates/Cargo.template.toml` is the source of truth for `src-tauri/Cargo.toml`. The actual `Cargo.toml` is generated from the template by a config script that swaps in the correct identifiers for dev / local / production environments.

```bash
# Regenerate after editing the template
npm run localdevconf
```

Editing `src-tauri/Cargo.toml` directly will be overwritten on the next config run.

## State management (frontend)

Persistent stores live in `frontend/src/lib/stores/` and are built with Svelte 5 runes:

| Store | Contents |
|-------|---------|
| `dataFiles.svelte.ts` | File registry — all imported files with metadata |
| `analysisRuns.svelte.ts` | Run history for all tools, persisted to `{app_data_dir}/analysis-runs/` |

Both stores hydrate from disk on app startup and write back on every mutation.

## Tool pattern

Every native tool page follows the same pattern:

```
mount → dep check (lia_deps_check)
      → if missing: show install instructions
      → if found: show version + input form
        → run (runNativeTool utility)
        → parse stdout → ToolOutput
        → analysisRuns.add(meta)
        → render via ToolResultView
```

This ensures consistent UI, run history, and pipeline compatibility across all tools.
