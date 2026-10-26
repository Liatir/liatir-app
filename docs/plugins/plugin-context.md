---
title: Plugin context
description: How the plugin handler receives its validated input in Node, Python, R, Native, and WASM.
---

# Plugin context

Every SDK handler receives a context carrying its inputs. Python, R and the Rust
SDKs validate them before calling the handler. Node uses build-time contract
checks and TypeScript typing. Bridge access depends on the runtime:

| Runtime | Input | App bridge |
| --- | --- | --- |
| Node | `input` | `Liatir` |
| Python | `ctx.input` | `ctx.liatir` |
| R | `ctx$input` | `ctx$liatir` |
| Native Rust | Typed getters on `ctx` | `ctx.liatir` |
| WASM Rust | Typed getters on `ctx` | Unavailable |

## Node — `PluginContext`

`PluginContext<typeof liatirPlugin>` is the recommended TypeScript helper for
typing the `.main(...)` handler. It gives you:

- `input`, inferred from `definePlugin({ inputs })`;
- `Liatir`, the Node plugin bridge to the running Liatir app.

```ts
import { definePlugin, field, type PluginContext } from "@liatir/api";

const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({ label: "Text", required: true }),
  },
  outputs: {
    length: field.number({ label: "Length", format: "integer" }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {
  await Liatir.deps.check("node");
  return { length: input.text.length };
});
```

`@liatir/api` also exports `PluginInput<S>` and `PluginOutput<S>`, but most
plugins only need `PluginContext<typeof liatirPlugin>`. The type is erased at
runtime; the contract is enforced at build time and through TypeScript.

## Python — `ctx`

The `@plugin.main` handler receives a context with the validated input on
`ctx.input` (a dict; declared defaults are already applied). `ctx.raw_input`
holds the original payload before validation.

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

Python plugins also receive the `Liatir` bridge, exposed on the context as
`ctx.liatir`. It mirrors the Node bridge namespaces with snake_case method names
(`ctx.liatir.jobs`, `ctx.liatir.deps`, `ctx.liatir.desktop.*`, `ctx.liatir.invoke`),
and reaches the app over the same local IPC server:

```python
@plugin.main
def main(ctx):
    ctx.liatir.deps.check("node")
    return {"length": len(ctx.input["text"])}
```

The connection is resolved lazily, so plugins that never touch the bridge run
without requiring the app to be reachable.

## R — `ctx`

The handler passed to `plugin$main` receives:

- `ctx$input`: validated inputs as a named list, with declared defaults applied;
- `ctx$raw_input`: the original input object;
- `ctx$liatir`: the synchronous app bridge.

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

Bridge namespaces are `jobs`, `deps`, `desktop$fs`, `desktop$app`, `log`,
`progress`, `paths()` and `invoke()`. Methods use snake_case, for example
`ctx$liatir$deps$check_many(c("samtools", "bcftools"))`.
Bridge failures raise R errors; do not catch them and return a successful result.

## Native and WASM Rust — `ctx`

The Rust handler receives a `&Context` with typed getters over the validated
input, so a wrong-typed or missing input surfaces as an error you can `?`:

| Getter | Returns |
| --- | --- |
| `ctx.str(name)` | `Result<&str, LiatirError>` |
| `ctx.string(name)` | `Result<String, LiatirError>` |
| `ctx.i64(name)` / `ctx.f64(name)` | `Result<i64, LiatirError>` / `Result<f64, LiatirError>` |
| `ctx.bool(name)` | `Result<bool, LiatirError>` |
| `ctx.path(name)` | `Result<PathBuf, LiatirError>` for a file input |
| `ctx.get(name)` | `Option<&serde_json::Value>` |
| `ctx.raw_input()` | Original `&serde_json::Value` |

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

For **Native**, `ctx.liatir` is the app bridge. Its namespaces are methods:

```rust
ctx.liatir.log().info("Counting characters", json!({}))?;
let info = ctx.liatir.desktop().app().info()?;
let storage = ctx.liatir.desktop().fs().plugin_fs("text-summary")?;
storage.write_text("last-run.txt", "Completed", true, false)?;
```

Bridge calls return `Result<serde_json::Value, Box<dyn std::error::Error>>`;
use `?` to propagate errors from the handler. The JSON value preserves the
backend response shape. See the [bridge reference](/plugins/api-bridge).

For **WASM**, there is no `ctx.liatir`. `ctx.storage_dir()` (`/storage`) is
persistent per-plugin storage, and declared file inputs are mounted read-only.
This storage getter exists only in WASM builds.

`ctx.work_dir()` is `.` in both Rust runtimes. For Native it is the temporary
Job directory, removed at termination. Return inline file content or use
bridge-managed storage for paths that must survive the run.

## Runtime validation

In **Python, R, Native Rust and WASM**, the SDK validates the input before the handler runs
(defaults applied, required and typed fields checked) and the output after it
returns (JSON, and no key outside the declared outputs). In **Node**, validation
happens at build time — `liatir build` and `liatir dev` inspect the exported
plugin shape after bundling — not on each run.


Custom Native executables are responsible for the same input/output validation.
All runtimes use the existing `.lia` contract; see
[runtime preparation](./getting-started#runtime-preparation) for preparation and executable permissions.
