---
title: Liatir API bridge
description: Full app bridge access from Node, Python, R and Native Plugins.
---

# Liatir API bridge

The bridge connects a Plugin process to the running Liatir app through
authenticated local communication. Node, Python, R and Native all have access
to Jobs, dependency checks, storage, app information, logs, progress, paths and
low-level command invocation. WASM is isolated and has no app bridge.

## Language conventions

| Runtime | Bridge | Example |
| --- | --- | --- |
| Node | `Liatir` from the handler context | `await Liatir.deps.check("samtools")` |
| Python | `ctx.liatir` | `ctx.liatir.deps.check("samtools")` |
| R | `ctx$liatir` | `ctx$liatir$deps$check("samtools")` |
| Native Rust | `ctx.liatir`, with namespace methods | `ctx.liatir.deps().check("samtools")?` |

Node calls return promises. Python and R calls are synchronous and raise errors
on failure. Native Rust calls return `Result<serde_json::Value, Box<dyn std::error::Error>>`; propagate errors with `?`. In the Native examples,
`json!` means the macro imported with `use serde_json::json`. Reference signatures
shorten this return type to `Result<Value>`.

Responses retain the backend's JSON names in every language: for example,
`jobId` from spawn, `id` in a Job entry and `exitCode` in its status. App info
uses snake_case keys such as `is_debug`. R parses JSON objects as named lists;
Native returns JSON values rather than typed response structs.

## Available areas

| Area | Use it for | R | Native Rust |
| --- | --- | --- | --- |
| [Jobs](./api/jobs/spawn) | Start, wait for, inspect and stop processes. | `ctx$liatir$jobs` | `ctx.liatir.jobs()` |
| [Dependencies](./api/deps/check) | Check available command-line tools. | `ctx$liatir$deps` | `ctx.liatir.deps()` |
| [Storage](./api/desktop/file-system) | Read/write app data, cache and Plugin storage. | `ctx$liatir$desktop$fs` | `ctx.liatir.desktop().fs()` |
| [App info](./api/desktop/app) | Read app and system information. | `ctx$liatir$desktop$app` | `ctx.liatir.desktop().app()` |
| [Logs](./api/log) | Send structured messages to Jobs. | `ctx$liatir$log` | `ctx.liatir.log()` |
| [Progress](./api/progress) | Update the Job's progress display. | `ctx$liatir$progress` | `ctx.liatir.progress()` |
| Paths | Locate app data and cache roots. | `ctx$liatir$paths()` | `ctx.liatir.paths()?` |
| [Invoke](./api/invoke) | Call commands exposed by the Plugin bridge. | `ctx$liatir$invoke(cmd, payload)` | `ctx.liatir.invoke(cmd, payload)?` |

## Run ownership and development

Use the handler's bridge so logs and progress carry the current Job identity.
During `liatir dev`, the SDK adds the development-session identity automatically.
The app scopes storage paths and child Jobs to that session and workspace,
rejects access to another session's Jobs, and blocks global operations.

These scopes organize bridge access; they do not sandbox the language's own
operating-system APIs. Node, Python, R and Native can also use those APIs.
Native executable trust and desktop runtime preparation are desktop-only actions:
a Plugin cannot grant itself permission or prepare another runtime through
`invoke`.

A custom Native executable can use the same
[authenticated protocol](./r-and-native#authenticated-bridge-protocol) without the
Rust SDK. Never print the connection token or include it in result files.

- [API overview](./api/overview)
- [Plugin context](./plugin-context)
- [R and Native setup](./r-and-native)
