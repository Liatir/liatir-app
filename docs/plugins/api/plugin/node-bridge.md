---
title: Liatir Node bridge
description: Node bridge available inside a .lia plugin main handler.
---

# Liatir Node bridge

The `Liatir` object passed to `.main(...)` is the Node plugin bridge. It connects
the plugin process to the running Liatir desktop app through local IPC.

Python plugins get the same bridge on their handler context as `ctx.liatir`,
using snake_case method names (e.g. `ctx.liatir.jobs.run(...)`,
`ctx.liatir.deps.check(...)`, `ctx.liatir.invoke(...)`). It covers the same
areas below except the typed bio helpers (`align`/`qc`/`variants`), which Python
reaches through `ctx.liatir.invoke`. WASM plugins are sandboxed and have no bridge.

```ts
export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {
  const node = await Liatir.deps.check("node");

  return {
    available: node.available,
  };
});
```

## Available areas

| Area | Use it for |
| --- | --- |
| `Liatir.jobs` | Spawn, wait for, stream, and inspect local processes. |
| `Liatir.deps` | Check whether command-line binaries are available. |
| `Liatir.desktop.fs` | Scoped Liatir storage. |
| `Liatir.desktop.files` | Native file dialogs when appropriate. |
| `Liatir.desktop.events` | App event bridge. |
| `Liatir.desktop.app` | App information. |
| `Liatir.desktop.network` | Network status and simple diagnostics. |
| `Liatir.desktop.clipboard` | Clipboard access. |
| `Liatir.desktop.notifications` | Native notifications. |
| `Liatir.desktop.diagnostics` | Diagnostic helpers. |
| `Liatir.desktop.globalVariables` | Shared string variables. |
| `Liatir.align` | Typed alignment helpers. |
| `Liatir.qc` | Typed quality-control helpers. |
| `Liatir.variants` | Typed variant-analysis helpers. |
| `Liatir.ai` | Local AI models: list, prepare, and run in a managed runtime. |
| `Liatir.sidecar` | Registered sidecar binaries. |
| `Liatir.pipeline` | Chain sidecar steps into a sequential pipeline. |
| `Liatir.paths()` | App filesystem paths. |
| `Liatir.invoke` | Low-level IPC escape hatch. |

GUI-only browser/webview areas such as window controls, menu integration,
shortcuts, badge, autostart, and context menu are intentionally not part of the
Node plugin bridge.

## Running a command

```ts
const stdoutLines: string[] = [];
const stderrLines: string[] = [];

const job = await Liatir.jobs.run("seqkit", ["stats", input.fastq], {
  onStdout: (line) => stdoutLines.push(line),
  onStderr: (line) => stderrLines.push(line),
});

return {
  status: job.status.type,
  stdout: stdoutLines.join("\n"),
  stderr: stderrLines.join("\n"),
};
```

Use `Liatir.deps.check(...)` first if the plugin depends on a local binary that
may not be installed.
