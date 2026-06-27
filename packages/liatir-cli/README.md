# `@liatir/lia` — build Liatir extensions

A `.lia` bundle is one file that holds either kind of tool, told apart by the
`runtime` in its manifest:

| Kind | Language | Capabilities |
|------|----------|--------------|
| **Module** (`node`) | TypeScript | the full Liatir bridge (`jobs`, `deps`, `desktop.fs`, …) + Node |
| **Custom tool** (`wasm`) | Rust → wasm | pure, sandboxed computation (no network, fs read-only) |

Both are imported the same way and run standalone or as a pipeline step.

```bash
npm i @liatir/lia        # then use `npx lia …`  (or `npm i -g @liatir/lia`)
```

## Module (Node)

```bash
npx lia init my-module
cd my-module && npm install
npx lia dev --input '{"fastq":"/absolute/path/sample.fastq"}'
npx lia build            # → my-module.lia
```

The **schema is declared once, in code** — the input/output types are inferred
from it and the manifest is generated from it at build time. You never hand-write
types or a manifest:

```ts
import { defineModule, field } from "@liatir/sdk";

export default defineModule({
  inputs: {
    fastq: field.file({ label: "FASTQ file", accept: ["fastq", "fq"], required: true }),
  },
  outputs: {
    reads: field.number({ label: "Reads" }),
  },
  // `input.fastq` is string (inferred); the return is checked against `outputs`.
  // `lia` is the Liatir bridge.
  async run({ input, lia }) {
    const out = await lia.jobs.run("seqkit", ["stats", input.fastq]);
    return { reads: 0 };
  },
});
```

`field.*` builders: `field.string`, `field.number`, `field.boolean`,
`field.file({ accept })`. Each takes `{ label?, description?, required?, default? }`.

## Custom tool (WASM)

```bash
npx lia init my-tool --wasm   # scaffolds the Rust crate AND adds the wasm target
cd my-tool
npx lia build                 # compiles Rust → my-tool.lia
```

A WASM tool reads its JSON input from **stdin** and writes JSON to **stdout**:

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
    let out = Output { length: input.text.len() as u64 };
    io::stdout().write_all(serde_json::to_string(&out).unwrap().as_bytes()).unwrap();
}
```

For WASM the schema lives in `.lia-manifest.json` (`inputSchema`/`outputSchema`),
since Rust can't export a JS schema at build time. Sandbox: no network, and only
the directories of `file` inputs are mounted read-only; a scratch dir is at `/storage`.

## Install into Liatir

`lia build` produces `<name>.lia`. In the app: **Modules → Import** → pick the file.
It then shows up on the Modules page (auto-generated form + Run) and in the
pipeline tool palette (drag in as a step). Re-run `lia build` and re-import the
same file to update it.
