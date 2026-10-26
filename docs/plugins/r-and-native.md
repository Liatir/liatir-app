---
title: R and Native Plugins
description: Create R and compiled Native Plugins with the shared I/O contract, full app bridge, dependency locks and executable permissions.
---

# R and Native Plugins

R and Native Plugins use the same `.lia` inputs, outputs, Jobs, Results and pipeline
connections as Node and Python. WASM remains the isolated runtime. Use an app
and CLI build containing R/Native support; older versions may not recognize them.
Start with [getting started](./getting-started) and the
[complete entry points](./define-plugin) for examples in each language.

## Create an R Plugin

```sh
liatir init expression-check --r --yes
cd expression-check
liatir build
liatir dev
```

Install R >= 4.1 first; the CLI uses `Rscript` from PATH, or `LIATIR_RSCRIPT`.
The app also discovers standard macOS and Windows R installations. R is optional:
other Plugins and app startup do not require it. There is currently no signed,
on-demand R interpreter distribution in Liatir. A missing or incompatible R
installation produces an actionable error on the Plugin's screen.

`src/main.R` declares its contract using `define_plugin(inputs, outputs)` and
`field$string`, `number`, `boolean`, `file`, `json` or `stats`. Finish it with
`plugin$main(function(ctx) { ... })`. The handler receives `ctx$input`,
`ctx$raw_input` and `ctx$liatir`. Inputs allow string, number, boolean and file;
JSON and stats are output types. Required fields, defaults, types and undeclared
outputs are checked by the SDK.

The CLI supplies `liatir.R`. Contract extraction sources the entry with
`LIATIR_EMIT_CONTRACT=1`; the SDK emits its declaration and does not call the
handler. Keep package loading and scientific computation **inside the handler**.
Top-level code is still R code and must not perform analyses or side effects.

Declare packages in `.lia-manifest.json`, for example:

```json
{
  "name": "Expression check",
  "version": "1.0.0",
  "runtime": "r",
  "r": {
    "entry": "src/main.R",
    "minVersion": "4.1",
    "packages": ["bioc::limma"]
  }
}
```

The first build installs dependencies in `.liatir/r-build-library` and writes
`renv.lock`. Commit that lock with your Plugin project. Later builds restore the
lock and refuse a missing declared package. To change package versions, update
that author library deliberately and run `renv::snapshot()` with the explicit
package list, including `jsonlite`, before rebuilding.

The bundle carries the lock. **Prepare R packages** on the Plugin's page restores
its exact versions into a separate library, keyed by Plugin name/version, lock
and interpreter identity.
CRAN and Bioconductor sources are recorded by [renv](https://rstudio.github.io/renv/reference/restore.html).
Preparation may need network access and platform build tools; later runs use the
prepared library offline. Changing only Plugin code reuses its library. Development
sessions use separate libraries and remove them when the session ends.

## Create a Native Plugin

```sh
liatir init text-summary --native --yes
cd text-summary
liatir build
liatir dev
```

The default scaffold uses Rust and Cargo. Its field builders and input/output
validation are shared with the WASM Rust SDK. Native adds `ctx.liatir`, with
`jobs()`, `deps()`, `desktop().fs()`, `desktop().app()`, `log()`, `progress()`,
`paths()` and raw `invoke()`. R exposes the same namespaces using `$` and
snake_case method names, matching Python. The [bridge reference](./api-bridge)
includes R and Native examples for every area. Native Rust methods return `Result<serde_json::Value, Box<dyn std::error::Error>>`;
use `?` in the handler to propagate a failure. R bridge calls return parsed JSON
values (named lists for objects) and raise errors on failure. File scope helpers
include read/write text and bytes, list, stat, exists, mkdir, move, copy, remove,
path and clear.

Native Plugins are separate executable processes, with ordinary operating-system
access. They are not shared libraries and are not sandboxed. Importing one does
not execute it. On its page, review the author and choose **Allow executable
access** before running it. Permission applies to the complete bundle's SHA-256;
a changed bundle requires permission again. Signature verification detects altered
signed bundles; a signature alone does not grant executable permission.
`liatir dev` runs the local project you explicitly opened in its temporary session.

### Executable protocol, version 1

Any compiled language can implement this protocol without the Rust SDK:

1. When `LIATIR_EMIT_CONTRACT=1` is set, print one line and exit successfully:

   ```text
   __LIATIR_CONTRACT__{"liatirContract":1,"inputs":{"file":{"type":"file","required":true}},"outputs":{"length":{"type":"number"}}}
   ```

   Generate this from the same declarations used to validate execution. Do not
   perform analysis or bridge calls during introspection.

2. During execution, read the UTF-8 JSON object from `LIATIR_INPUT_FILE`. The app
   creates this private file for the Job; it avoids command-line size limits and
   quoting differences. The Rust SDK also accepts stdin when run directly.
3. Validate input values, run the analysis, validate outputs, and print exactly
   one `__LIATIR_RESULT__` line followed by the JSON output object. Use ordinary
   stdout or stderr lines for diagnostic output. Exit nonzero on failure.
4. The working directory and extracted executable are temporary and are removed
   when the Job ends. Return file content as `{ "content": "...", "fileName": "..." }`,
   or use bridge-managed cache/data storage and return an absolute path. Do not
   return a path inside the temporary working directory. The standard Liatir
   result handler saves and associates file outputs with their run.
5. The app injects `LIATIR_JOB_ID` and `LIATIR_IPC_FILE`. Use them for the bridge.

### Targets

The bundle manifest maps exact targets to executable paths:

```json
{
  "native": {
    "protocol": 1,
    "targets": {
      "macos-aarch64": "native/macos-aarch64/tool",
      "linux-x86_64": "native/linux-x86_64/tool",
      "windows-x86_64": "native/windows-x86_64/tool.exe"
    }
  }
}
```

Author manifests use paths relative to the project. `native.cargo: true` builds the
host Rust executable automatically and merges any additional `native.targets`.
Supported OS names are `macos`, `linux`, `windows`; architectures are `aarch64`
and `x86_64`. Selection is exact, with an explicit unsupported-host error. Include
`.exe` on Windows. macOS arm64 does not silently run an Intel executable.

The CLI introspects host executables directly and automatically writes
`<executable>.contract.json` beside each host executable. This generated metadata
contains its code-declared contract and executable SHA-256. Build on each target,
then copy that target's executable and metadata into the multi-target project;
`liatir build` refuses stale metadata whose hash does not match the executable.
This is generated build metadata, not a manually maintained schema.
All target contracts must agree. Bundle signatures cover every executable and the
generated manifest. The app rejects unsafe archive paths, symlinks and duplicates,
and restores Unix executable permissions itself. Bundles are limited to 512 MiB
compressed and 1 GiB expanded. Package required dynamic libraries
in a self-contained executable or arrange documented system requirements; the
current protocol bundles executable variants, not a separate native dependency manager.

### Authenticated bridge protocol

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
`jobId: LIATIR_JOB_ID` with the same command payloads as Node and Python.
See [the bridge reference](./api-bridge) for the available namespaces.

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

Both SDKs add it automatically when `LIATIR_RUN_SCOPE=plugin-dev`. The server
scopes filesystem namespaces and child Jobs to the session, rejects global
commands, and prevents access to another session's Jobs. This scopes bridge
operations; it is not an OS sandbox for untrusted code. Plugins cannot grant
Native executable trust or call desktop runtime preparation through this endpoint.

## Examples and platform validation

The repository contains `examples/plugins/r-limma` (a limma differential-expression
analysis) and `examples/plugins/native-file-summary` (a Rust text-file summary tool). Both return standard file outputs.
The test suite includes a mixed Node → R → Native → Python pipeline.

Executable target support is defined for macOS, Linux and Windows. A passing
macOS test does not establish Linux or Windows compatibility: run the same
subprocess Plugin tests and native UI suite on each target before distributing it.
