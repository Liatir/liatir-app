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
- **WASM** declares it with `define_plugin()` from the CLI-managed
  `src/liatir.rs` module.

## Authoring

Every `.lia` plugin declares its inputs and outputs **once**, in code, and
attaches the implementation to that contract. `liatir build` reads the contract
back and generates `manifest.json` from it — **there is no schema to write or keep
in sync by hand**.

This is the **same API shape in all three runtimes**:

- **Node** — `definePlugin({ inputs, outputs }).main(handler)` from `@liatir/api`.
- **Python** — `define_plugin(inputs=..., outputs=...)` + `@plugin.main` from the
  CLI-managed `liatir` module.
- **WASM (Rust)** — `define_plugin().input(...).output(...).main(handler)` from the
  CLI-managed `liatir` module.

- [Plugin context](/plugins/plugin-context) 
- [Defining plugin](plugins/api/define-plugin)
- [Declaring I/O fields](plugins/api/define-plugin)

## API bridge

The `Liatir` object passed to `.main(...)` is the Node plugin bridge. It connects
the plugin process to the running Liatir desktop app through local IPC.

Python plugins get the same bridge on their handler context as `ctx.liatir`,
using snake_case method names (e.g. `ctx.liatir.jobs.list()`,
`ctx.liatir.deps.check(...)`, `ctx.liatir.invoke(...)`). It covers the same
areas below except the typed bio helpers (`align`/`qc`/`variants`), which Python
reaches through `ctx.liatir.invoke`. WASM plugins are sandboxed and do not have API bridge access.

| Area | Use it for |
| --- | --- |
| `Jobs` | Spawn, wait for, stream, and inspect Liatir jobs. |
| `Deps` | Check whether command-line binaries are available. |
| `Desktop fs` | Scoped Liatir storage. |
| `Desktop app info` | App and OS information. |
| `Invoke method` | Low-level IPC escape hatch. |