---
title: lia context
description: Node bridge available inside a .lia plugin main handler.
---

# lia context

The `lia` object passed to `.main(...)` is the Node plugin bridge. It connects
the plugin process to the running Liatir desktop app through local IPC.

```ts
export default liatirPlugin.main(async ({ input, lia }: PluginContext<typeof liatirPlugin>) => {
  const node = await lia.deps.check("node");

  return {
    available: node.available,
  };
});
```

## Available areas

| Area | Use it for |
| --- | --- |
| `lia.jobs` | Spawn, wait for, stream, and inspect local processes. |
| `lia.deps` | Check whether command-line binaries are available. |
| `lia.desktop.fs` | Scoped Liatir storage. |
| `lia.desktop.files` | Native file dialogs when appropriate. |
| `lia.desktop.events` | App event bridge. |
| `lia.desktop.app` | App information. |
| `lia.desktop.network` | Network status and simple diagnostics. |
| `lia.desktop.clipboard` | Clipboard access. |
| `lia.desktop.notifications` | Native notifications. |
| `lia.desktop.diagnostics` | Diagnostic helpers. |
| `lia.desktop.globalVariables` | Shared string variables. |
| `lia.align` | Typed alignment helpers. |
| `lia.qc` | Typed quality-control helpers. |
| `lia.variants` | Typed variant-analysis helpers. |
| `lia.plugins` | Low-level WASM plugin runtime. |
| `lia.sidecar` | Registered sidecar binaries. |
| `lia.paths()` | App filesystem paths. |
| `lia.invoke` | Low-level IPC escape hatch. |

GUI-only browser/webview areas such as window controls, menu integration,
shortcuts, badge, autostart, and context menu are intentionally not part of the
Node plugin bridge.

## Running a command

```ts
const stdoutLines: string[] = [];
const stderrLines: string[] = [];

const job = await lia.jobs.run("seqkit", ["stats", input.fastq], {
  onStdout: (line) => stdoutLines.push(line),
  onStderr: (line) => stderrLines.push(line),
});

return {
  status: job.status.type,
  stdout: stdoutLines.join("\n"),
  stderr: stderrLines.join("\n"),
};
```

Use `lia.deps.check(...)` first if the plugin depends on a local binary that may
not be installed.

