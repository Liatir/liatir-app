# `@liatir/sdk`

The runtime SDK for **Liatir Modules** (`.lia` bundles with `runtime: "node"`). It gives a
module the **same bridge** that `window.Liatir` exposes inside the app, over a local IPC
channel to the running Liatir desktop process.

```ts
import { createLiatir } from "@liatir/sdk";

export async function run(input: { reference: string; reads: string }) {
  const Liatir = await createLiatir();   // connects to the running app's IPC

  // Run a system tool with streamed output
  const job = await Liatir.jobs.run("bwa", ["mem", input.reference, input.reads], {
    onStdout: (line) => console.log(line),
  });

  // Scoped app storage (NOT raw node fs)
  await Liatir.desktop.fs.data.writeText("log.txt", "done");

  // Typed bio helpers
  const aln = await Liatir.align.bwaMem({ reference: input.reference, reads: input.reads });

  return { exit: job.status.type };
}
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
