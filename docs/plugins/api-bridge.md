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

| Area | Use it for |
| --- | --- |
| [Jobs](./api/jobs/spawn) | Start, wait for, inspect and stop processes. |
| [Dependencies](./api/deps/check) | Check available command-line tools. |
| [Storage](./api/desktop/file-system) | Read/write app data, cache and Plugin storage. |
| [App info](./api/desktop/app) | Read app and system information. |
| [Logs](./api/log) | Send structured messages to Jobs. |
| [Progress](./api/progress) | Update the Job's progress display. |
| Paths | Locate app data and cache roots using the calls below. |
| [Invoke](./api/invoke) | Call commands exposed by the Plugin bridge. |

::: code-group

```ts [Node]
const paths = await Liatir.paths();
```

```python [Python]
paths = ctx.liatir.paths()
```

```r [R]
paths <- ctx$liatir$paths()
```

```rust [Native Rust]
let paths = ctx.liatir.paths()?;
```

:::

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

## Authenticated bridge protocol

The supplied SDKs handle this transport for Node, Python, R and Native Rust.
Authors implementing another client can use the same protocol directly.

Read the JSON file named by `LIATIR_IPC_FILE`: `{ "port": 12345, "token": "..." }`.
Never log its token. Send an HTTP request to `http://127.0.0.1:<port>/invoke`:

```http
POST /invoke HTTP/1.0
Authorization: Bearer <token>
Content-Type: application/json
Connection: close

{"cmd":"lia_deps_check","payload":{"binary":"node"}}
```

Include the correct byte `Content-Length` header. The response is
`{ "ok": true, "result": ... }` or `{ "ok": false, "error": "..." }`.
Treat transport failures and `ok: false` as errors. Log/progress calls include
`jobId: LIATIR_JOB_ID` using the same command payloads in every language.
Use the [namespace helpers](#available-areas) whenever possible.

During development, every call must include this payload member:

```json
{
  "__liatirDevContext": {
    "scope": "plugin-dev",
    "sessionId": "<LIATIR_DEV_SESSION_ID>",
    "workspaceId": "<LIATIR_WORKSPACE_ID>"
  }
}
```

The supplied Node, Python, R and Native Rust SDKs add it automatically when `LIATIR_RUN_SCOPE=plugin-dev`. The server
scopes filesystem namespaces and child Jobs to the session, rejects global
commands, and prevents access to another session's Jobs. This scopes bridge
operations; it is not an OS sandbox for untrusted code. Plugins cannot grant
Native executable trust or call desktop runtime preparation through this endpoint.

- [API overview](./api/overview)
- [Plugin context](./plugin-context)
- [Runtime preparation](./getting-started#runtime-preparation)
