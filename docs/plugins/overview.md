# Plugins (.lia)

Build anything on top of Liatir: `.lia` plugins can run with Node, Python, R, Native, or WASM, so you can choose the runtime that fits the job.
They appear in the Plugins area and can run as pipeline nodes or on their own, just like Liatir native tools.

A `.lia` plugin file is a bundle built with `@liatir/cli` and imported into Liatir. It declares:

- metadata such as name, version, description, category, and tags;
- input fields shown in the UI;
- output fields that later pipeline steps can consume;
- the runtime: `node`, `python`, `r`, `native`, or `wasm`.

:::info

<div style="display: flex;">

<p style="margin-right: 10px; margin-top: 8px;"> <strong>→</strong> </p> <p> Every plugin must follow the <strong>Liatir I/O standard</strong>, but don't worry — the <strong>Liatir CLI</strong> scaffolds that for you. </p>

</div>

:::

## Choose a runtime

| Runtime | Best fit | App bridge | What users need |
| --- | --- | --- | --- |
| Node | TypeScript/JavaScript and npm libraries. | Yes | Liatir's Node runtime. |
| Python | Scientific Python libraries. | Yes | A prepared managed Python environment. |
| R | R statistics, CRAN and Bioconductor. | Yes | R >= 4.1 and the Plugin's prepared packages. |
| Native | Compiled executables, with Rust and C++ libraries. | Yes | An exact OS/processor executable and explicit permission. |
| WASM | Portable, isolated computation. | No | Liatir's built-in WASM runner. |

Start with Node unless your analysis needs a particular language. R and Native
require an app and CLI build that includes their support; older installations
may not recognize them. They keep the existing `.lia` format and pipeline I/O
contract. See [getting started](./getting-started) for prerequisites and commands.

## Node plugins

Node plugins are the recommended starting point for most custom logic. A Node
plugin is written in TypeScript or JavaScript and uses `@liatir/api`.

The plugin contract is declared once in `definePlugin({ inputs, outputs })`.
`liatir build` reads that contract from the compiled code and generates the
`.lia` manifest automatically.

```ts
import { definePlugin, field, type PluginContext } from "@liatir/api";

// This is just an example. Edit inputs and outputs definitions and the plugin logic to implement your solutions.

const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      description: "Text to analyze.",
      required: true,
      default: "hello from Liatir",
    }),
  },
  outputs: {
    length: field.number({
      label: "Length",
      description: "Number of characters in the input text.",
      format: "integer",
    }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {

  // Write the plugin logic here

  return {
    length: input.text.length,
  };
});
```

Do not write a separate Node plugin manifest by hand. Do not export a standalone
`run()` function. Do not write result markers to stdout. Return the output object
from `.main(...)`; Liatir handles packaging, execution, logs, and result parsing.

---

### What a Node plugin can use

The `Liatir` object passed to `.main(...)` is a Node bridge to the running Liatir
app. It includes:

- `Liatir.jobs` for running and tracking local command-line processes;
- `Liatir.deps` for checking whether binaries are available;
- `Liatir.desktop.fs` for scoped Liatir storage (`data`, `cache`, `pluginFs`);
- `Liatir.desktop.app` for read-only app info;
- `Liatir.log` and `Liatir.progress` for structured logs and progress streamed to the Jobs UI;
- `Liatir.paths()` and the lower-level `Liatir.invoke` escape hatch.

Node plugins can also use normal Node.js APIs and bundled npm dependencies.

## Python plugins

Python `.lia` plugins are useful for scientific Python code and libraries such
as parsers, statistics packages, and analysis helpers. They declare the same
`define_plugin` contract as the other runtimes, with the CLI-managed `liatir` module
scaffolded next to the entry point (usually `src/main.py`) and shipped inside
the bundle:

```python
from liatir import define_plugin, field

plugin = define_plugin(
    inputs={"text": field.string(label="Text", required=True)},
    outputs={"length": field.number(label="Length", format="integer")},
)


@plugin.main
def main(ctx):
    return {"length": len(ctx.input["text"])}
```

`liatir build` generates the manifest schema from this contract, and the SDK
validates inputs and outputs on every run. `.lia-manifest.json` keeps the plugin
metadata plus the Python runtime spec (entry point, packages, requirements).

Python plugins run in isolated managed Python environments. The plugin manifest
can declare packages and requirements; Liatir prepares that runtime box before
execution and shows its status and installed size in the Plugins UI.

Python plugins receive the same `Liatir` bridge as Node, exposed on the handler
context as `ctx.liatir`. It reaches the app over the same local IPC server the
Node SDK uses, so a Python plugin can spawn Liatir jobs, check dependencies,
read and write app storage, and call commands exposed by the Plugin bridge:

```python
@plugin.main
def main(ctx):
    ctx.liatir.log.info("Counting characters")
    return {"length": len(ctx.input["text"])}
```

`ctx.liatir` mirrors the Node namespaces (`jobs`, `deps`, `desktop.fs`,
`desktop.app`, `log`, `progress`, `paths()`, plus `invoke` as a raw escape
hatch), using snake_case method names. It resolves its connection lazily, so
plugins that never touch the bridge run without requiring the app.

## R plugins

R Plugins use the same forms, pipeline connections, Jobs and Results. Create one
with `liatir init expression-check --r --yes`. Its entry point looks like this:

```r
source("liatir.R")

plugin <- define_plugin(
  inputs = list(text = field$string(label = "Text", required = TRUE)),
  outputs = list(length = field$number(label = "Length", format = "integer"))
)

plugin$main(function(ctx) {
  ctx$liatir$log$info("Counting characters")
  list(length = nchar(ctx$input$text, type = "chars"))
})
```

The CLI manages `liatir.R` and generates the manifest from these declarations.
Declare packages in the R runtime specification; the first build records their
versions in `renv.lock`. Liatir restores this lock into a library for the Plugin
using **Prepare R packages**. Preparation may require internet access and build
tools; later runs use the prepared packages offline. A compatible R installation
is required and is not downloaded by Liatir.

`ctx$liatir` gives R full Plugin bridge access: Jobs, dependency checks, scoped
storage, app information, logs, progress, paths and raw command invocation.
See [R package preparation](./format#package-preparation).

## Native plugins

Native Plugins are executable programs bundled for specific operating systems
and processors. Create the Rust starter with
`liatir init text-summary --native --yes`. It uses the same contract builder as
the WASM Rust example below, plus `ctx.liatir` for full Plugin bridge access:

```rust
// Inside the handler, with serde_json::json imported:
ctx.liatir.log().info("Counting characters", json!({}))?;
let length = ctx.str("text")?.chars().count();
Ok(json!({ "length": length }))
```

The CLI compiles the host executable and reads its contract; authors can add
other exact targets to the bundle. C++ projects created with
`liatir init text-summary --native --cpp --yes` use the managed Liatir library
and CMake build path, with the same contract validation. The user's machine does not need Rust to run an
already compiled Rust Plugin, but may need any system libraries the executable
requires.

Import does not execute the program. The user grants **Allow executable access**
for that exact bundle before running it; a changed bundle requires permission
again. Native programs have ordinary operating-system access. A bundle signature
checks integrity; it does not grant this permission. See
[Native packaging](./format#native-contract-and-manifest).

## WASM plugins


WASM `.lia` plugins are WebAssembly tools compiled for WASI Preview 1. Liatir
supplies Rust and C++ libraries, selected with `--wasm` or `--wasm --cpp`. They
declare the same `define_plugin` contract as the other runtimes through the
CLI-managed `src/liatir.rs` module that `liatir init --wasm` scaffolds and
`liatir build` keeps in sync:

:::warning Keep in mind:
WASM plugins runtime is intentionally **fully sandboxed and isolated** for safety and compliance reasons; therefore, **they cannot communicate with external resources**.
:::

```rust
mod liatir;

use liatir::{define_plugin, field};
use serde_json::json;

fn main() {
    define_plugin()
        .input("text", field::string().label("Text").required(true))
        .output("length", field::number().label("Length").integer())
        .main(|ctx| {
            let text = ctx.str("text")?;
            Ok(json!({ "length": text.chars().count() }))
        });
}
```

`liatir build` generates the manifest schema from this contract, and the SDK
validates inputs and outputs on every run. WASM plugins are more sandboxed than
Node, Python, R or Native plugins:

- no arbitrary host filesystem or network access is available;
- directories containing declared file inputs are mounted read-only by Liatir;
- stdout is reserved for the result JSON (use `eprintln!` for logs).

> WASM plugins remain fully sandboxed and have no bridge: they cannot call back into the app. Use Node, Python, R or Native when you need bridge access.

## Shared lifecycle

All five runtimes use `liatir build` and the app-backed `liatir dev`. Inputs and
outputs connect across runtimes in the same pipeline. Jobs display each run's
logs and progress; file outputs are saved in Results with their run association.

For R and Native, the working directory is removed when the Job ends. Return
file content inline or use a path in bridge-managed storage; see
[file output values](./field#file-output-values).

- [Getting started](./getting-started)
- [Complete entry points](./define-plugin)
- [Runtime packaging and preparation](./format)
- [Plugin bridge reference](./api-bridge)
