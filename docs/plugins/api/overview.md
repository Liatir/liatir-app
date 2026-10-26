---
title: Liatir Plugin API
description: Comprehensive overview of the Liatir Plugin API, its lifecycle, usage, and platform specifics.
---


# Liatir Plugin API

This is the API you need to use in order to develop a `.lia` plugin that can run inside the Liatir local environment. The Liatir Plugin API allows you to define the plugin, providing the entry point and the context where you can implement your logic and use the API bridge.

## Runtimes

- **Node** declares it with `definePlugin({...})` from `@liatir/api`.
- **Python** declares it with `define_plugin(...)` from the CLI-managed
  `liatir` module scaffolded next to the entry point.
- **R** uses the CLI-managed `liatir.R` module.
- **Native** uses a compiled executable and the shared contract protocol.
- **WASM** declares it with `define_plugin()` from the CLI-managed
  `src/liatir.rs` module.

## Authoring

Every `.lia` plugin declares its inputs and outputs **once**, in code, and
attaches the implementation to that contract. `liatir build` reads the contract
back and generates `manifest.json` from it — **there is no schema to write or keep
in sync by hand**.

This is the **same API shape in all five runtimes**:

- **Node** — `definePlugin({ inputs, outputs }).main(handler)` from `@liatir/api`.
- **Python** — `define_plugin(inputs=..., outputs=...)` + `@plugin.main` from the
  CLI-managed `liatir` module.
- **WASM (Rust)** — `define_plugin().input(...).output(...).main(handler)` from the
  CLI-managed `liatir` module.
- **R** — `define_plugin(inputs=..., outputs=...)` + `plugin$main(handler)`.
- **Native (Rust)** — the same contract builder as WASM, with full bridge access.
  Other compiled languages implement the [executable protocol](/plugins/format#executable-protocol-version-1).

- [Plugin context](/plugins/plugin-context) 
- [Defining plugin](/plugins/define-plugin)
- [Declaring I/O fields](/plugins/field)

## API bridge

Node, Python, R and Native can all use Liatir Jobs, dependency checks, storage,
app information, logging, progress, paths and raw command invocation. WASM has
no bridge.

| Runtime | Handler access | Calling convention |
| --- | --- | --- |
| Node | `Liatir` | Async methods, for example `await Liatir.jobs.list()`. |
| Python | `ctx.liatir` | Synchronous, snake_case methods. |
| R | `ctx$liatir` | Synchronous, snake_case methods accessed with `$`. |
| Native Rust | `ctx.liatir` | Namespace methods, for example `ctx.liatir.jobs().list()?`. |

See [the bridge reference](/plugins/api-bridge) for language conventions,
response types, all available areas and development-session isolation.
