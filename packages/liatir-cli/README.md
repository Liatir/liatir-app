# `@liatir/lia` — build Liatir extensions

A `.lia` bundle is one file that holds either kind of tool, told apart by the
`runtime` in its manifest:

| Kind | Language | Capabilities |
|------|----------|--------------|
| **Plugin** (`node`) | TypeScript | the full Liatir bridge (`jobs`, `deps`, `desktop.fs`, …) + Node |
| **Custom tool** (`wasm`) | Rust → wasm | pure, sandboxed computation (no network, fs read-only) |

Both are imported the same way and run standalone or as a pipeline step.

```bash
npm i @liatir/lia        # then use `npx lia …`  (or `npm i -g @liatir/lia`)
```

## Plugin (Node)

```bash
npx lia init my-plugin      # interactive prompts
npx lia init my-plugin --yes --no-install
cd my-plugin && npm install
npx lia dev --input '{"fastq":"/absolute/path/sample.fastq"}'
npx lia build              # -> my-plugin.lia
npm run update             # updates @liatir/lia and @liatir/sdk
```

The **schema is declared once, in code** — the input/output types are inferred
from it and the manifest is generated from it at build time. You never hand-write
types or a manifest:

```ts
import { defineModule, field, type ModuleContext } from "@liatir/sdk";

const liatirModule = defineModule({
  inputs: {
    fastq: field.file({ label: "FASTQ file", accept: ["fastq", "fq"], required: true }),
  },
  outputs: {
    reads: field.number({ label: "Reads" }),
  },
});

export default liatirModule.main(async ({ input, lia }: ModuleContext<typeof liatirModule>) => {
  // `input.fastq` is string (inferred from `inputs`).
  // `lia` is the local Liatir bridge.
  await lia.jobs.run("seqkit", ["stats", input.fastq]);
  return { reads: 0 };
});
```

`field.*` builders: `field.string`, `field.number`, `field.boolean`,
`field.file({ accept })`. Each takes `{ label?, description?, required?, default? }`.

`lia build` runs TypeScript checks, validates the exported
`defineModule({ inputs, outputs }).main(...)` shape, then packages the `.lia`.
`lia dev` watches `src/index.ts` or `src/index.js`, typechecks on rebuild when a
`tsconfig.json` exists, validates the same shape, applies schema defaults, and
runs the plugin against the open Liatir app. JavaScript plugins are supported
too: use `lia init my-plugin --js`.

Useful `lia init` flags:

```bash
lia init                         # asks for the project folder
lia init my-plugin --yes          # recommended defaults
lia init my-plugin --node --ts    # recommended Node TypeScript plugin
lia init my-plugin --node --js    # JavaScript plugin
lia init my-tool --wasm           # Rust/WASM tool
lia init my-plugin --template file-processor
lia init my-plugin --template bio-cli
lia init my-plugin --category "Quality Control" --tags "FASTQ,QC"
lia init my-plugin --no-install
lia init my-tool --no-wasm-target
lia update                        # update @liatir/lia and @liatir/sdk
lia update --version 1.5.1         # pin the target Liatir package version
lia update --no-install --version 1.5.1
```

When prompted, the recommended path is Node + TypeScript + the minimal template.
`--yes` selects those recommended defaults automatically.

`lia update` is for Node `.lia` plugin projects. It updates both `@liatir/lia`
and `@liatir/sdk` together and refreshes `package-lock.json` through npm. WASM
projects do not use `@liatir/sdk`; update the CLI with
`npm install -g @liatir/lia@latest`.

## Custom tool (WASM)

```bash
npx lia init my-tool --wasm   # scaffolds the Rust crate and offers the wasm target
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

`lia build` produces `<name>.lia`. In the app: **Plugins -> Import** -> pick the file.
It then shows up on the Plugins page (auto-generated form + Run) and in the
pipeline tool palette (drag in as a step). Re-run `lia build` and re-import the
same file to update it.
