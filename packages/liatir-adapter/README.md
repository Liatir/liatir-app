# `@liatir/sdk`

The runtime SDK for **Liatir Plugins** (`.lia` bundles with `runtime: "node"`). It gives a
plugin the **same bridge** that `window.Liatir` exposes inside the app, over a local IPC
channel to the running Liatir desktop process.

## Type names

- `LiatirNode` is the Node.js plugin bridge available as `lia` inside `.main(...)`.
- `LiatirBrowserAPI` is only for the browser/webview bridge exposed as `window.Liatir`.
- `LiatirAPI` is a deprecated compatibility alias for `LiatirBrowserAPI`; avoid it in new code.

```ts
import { defineModule, field } from "@liatir/sdk";

export default defineModule({
  inputs: {
    reference: field.file({ label: "Reference FASTA", accept: ["fa", "fasta"], required: true }),
    reads: field.file({ label: "Reads FASTQ", accept: ["fq", "fastq"], required: true }),
  },
  outputs: {
    exit: field.string({ label: "Job status" }),
  },
}).main(async ({ input, lia }) => {
  // Run a system tool with streamed output.
  const job = await lia.jobs.run("bwa", ["mem", input.reference, input.reads], {
    onStdout: (line) => console.log(line),
  });

  // Scoped app storage, not raw Node filesystem.
  await lia.desktop.fs.data.writeText("log.txt", "done");

  // Typed bio helpers are available from the same bridge.
  await lia.align.bwaMem({ reference: input.reference, reads: input.reads });

  return { exit: job.status.type };
});
```

## What's available

`createLiatir()` returns the bridge, composed from the **same source of truth** as the
in-app SDK (no duplicated types or logic — only the transport differs):

- **`jobs`** — spawn / kill / status / list system processes, plus `run()` and `getOutput()`
  for buffered streaming (Node polls the app over IPC).
- **`deps`** — check whether a binary is installed and its version.
- **`desktop.fs`** — scoped app storage (`data` / `cache` / `pluginFs` / `trash` / `diagnostics`),
  with safe-join — **not** the raw Node filesystem.
- **`desktop.files`** — native open/save dialogs.
- **`desktop.events`** — emit app events.
- **`desktop.app`** — app info / exit.
- **`desktop.network`** — status, ping, resolve, bandwidth.
- **`desktop.globalVariables`**, **`desktop.clipboard`**, **`desktop.notifications`**,
  **`desktop.diagnostics`** — the rest of the non-GUI bridge.
- **`plugins`**, **`sidecar`** — WASM custom-tool runtime and bundled sidecars.
- **`align` / `qc` / `variants`** — typed wrappers over the native bio tools that return a
  structured `ToolOutput`.

GUI-only areas (window, menu, shortcuts, badge, autostart, context menu) are intentionally
excluded — they have no meaning in a headless process.

## Requirements

The Liatir desktop app must be running: `createLiatir()` reads the app's IPC endpoint and
authenticates with a per-session token. If the app is not running it throws with a clear
message. You normally don't depend on this package directly — `lia init` and `lia build`
(`@liatir/lia`) wire it up for you.
