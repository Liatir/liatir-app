---
title: Liatir API bridge
description: API bridge available inside a .lia plugin main handler.
---

# Liatir API bridge

The `Liatir` object passed to `.main(...)` is the Node plugin bridge. It connects
the plugin process to the running Liatir desktop app through local IPC.

Python plugins get the same bridge on their handler context as `ctx.liatir`,
using snake_case method names (e.g. `ctx.liatir.jobs.list()`,
`ctx.liatir.deps.check(...)`, `ctx.liatir.invoke(...)`). It covers the same
areas below except the typed bio helpers (`align`/`qc`/`variants`), which Python
reaches through `ctx.liatir.invoke`. WASM plugins are sandboxed and do not have API bridge access.

## Available areas

| Area | Use it for |
| --- | --- |
| `Jobs` | Spawn, wait for, stream, and inspect Liatir jobs. |
| `Deps` | Check whether command-line binaries are available. |
| `Desktop fs` | Scoped Liatir storage. |
| `Desktop app info` | App and OS information. |
| `Invoke method` | Low-level IPC escape hatch. |

- [API overview](/plugins/api/overview) 
- [Plugin context](/plugins/plugin-context) 