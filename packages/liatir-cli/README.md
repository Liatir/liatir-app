# `@liatir/lia` — build Liatir extensions

Liatir is extensible with **`.lia` bundles**. A single `.lia` file can hold either of
two kinds of tool, distinguished by the `runtime` field in its manifest:

| Kind | `runtime` | Payload | Runs as | Best for |
|------|-----------|---------|---------|----------|
| **Module** | `node` (default) | `index.js` | Node.js subprocess with the **full Liatir bridge** | orchestration, shell-out to system tools, pipelines |
| **Custom tool** | `wasm` | `module.wasm` | sandboxed WASM (wasmtime) | pure, fast, dependency-free computation |

Both are imported the same way and run identically — standalone (like a native tool)
or as a step inside a pipeline. The difference in capabilities is shown in the UI with
a **🔒 Sandbox** badge on WASM tools.

```
npm install -g @liatir/lia
```

## Module (Node)

```
lia init my-module
cd my-module
npm install
lia dev          # watch mode against the running Liatir app
lia build        # → my-module.lia
```

`src/index.ts` exports a `run(input)` function and has the **entire Liatir bridge**
available via `@liatir/sdk` (see that package's README):

```ts
import { createLiatir } from "@liatir/sdk";

export async function run(input: { filePath: string }) {
  const Liatir = await createLiatir();
  const job = await Liatir.jobs.run("samtools", ["flagstat", input.filePath], {
    onStdout: (l) => console.log(l),
  });
  if (job.status.type !== "done") throw new Error("samtools failed");
  return { ok: true };
}
```

The value you `return` is the module's structured result. Internally the runner emits
it on stdout as a `__LIATIR_RESULT__<json>` marker line, which Liatir parses — you
never write that marker yourself, just `return` a JSON-serializable value.

## Custom tool (WASM)

```
rustup target add wasm32-wasip1   # once
lia init my-tool --wasm
cd my-tool
lia build        # compiles Rust → wasm32-wasip1, packages → my-tool.lia
```

A WASM tool reads its JSON input from **stdin** and writes its JSON result to
**stdout** — that's the entire contract:

```rust
use std::io::{self, Read, Write};
use serde::{Deserialize, Serialize};

#[derive(Deserialize)] #[serde(rename_all = "camelCase")]
struct Input { text: String }

#[derive(Serialize)] #[serde(rename_all = "camelCase")]
struct Output { length: u64 }

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).unwrap();
    let input: Input = serde_json::from_str(&buf).unwrap();
    let output = Output { length: input.text.len() as u64 };
    io::stdout().write_all(serde_json::to_string(&output).unwrap().as_bytes()).unwrap();
}
```

**Sandbox guarantees:** no network, and no arbitrary filesystem access. Liatir mounts
only the directories of your `file`-typed inputs, **read-only** — so a WASM tool can
read an input FASTQ/BAM but cannot touch anything else. A persistent scratch directory
is available at `/storage`.

## Manifest — `.lia-manifest.json`

```jsonc
{
  "name": "my-tool",
  "version": "1.0.0",
  "description": "...",
  "runtime": "node",        // or "wasm"
  "inputSchema":  { "<key>": { "type": "file|string|number|boolean", "label": "...", "required": true, "accept": ["bam"] } },
  "outputSchema": { "<key>": { "type": "file|string|number", "label": "..." } }
}
```

The `inputSchema` drives the **auto-generated input form** and the pipeline node's input
handles; `outputSchema` drives the output handles. `file` outputs are saved to `Results/`
and can be chained into the next pipeline step; `number` outputs become connectable
values (→ Math / Condition nodes).

## Install into Liatir

`lia build` produces `<name>.lia`. In the app open **Modules → Import** and pick the file.
The tool then appears both on the Modules page (run standalone) and in the pipeline tool
palette (drag in as a step). Node tools require Node.js ≥18 on the host; WASM tools have
no host runtime requirement.
