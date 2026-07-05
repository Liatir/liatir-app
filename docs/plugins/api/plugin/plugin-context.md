---
title: Plugin context
description: How the plugin handler receives its validated input in Node, Python, and WASM.
---

# Plugin context

Every plugin handler receives a context carrying the **validated input**. What
else it carries depends on the runtime.

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

Node and Python plugins receive the `Liatir` bridge — see
[Liatir Node bridge](/plugins/api/plugin/node-bridge). WASM plugins are fully
sandboxed and have no bridge.

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

## WASM — `ctx`

The Rust handler receives a `&Context` with typed getters over the validated
input, so a wrong-typed or missing input surfaces as an error you can `?`:

| Getter | Returns |
| --- | --- |
| `ctx.str(name)` | `&str` |
| `ctx.string(name)` | `String` |
| `ctx.i64(name)` / `ctx.f64(name)` | integer / float |
| `ctx.bool(name)` | `bool` |
| `ctx.path(name)` | `PathBuf` of a file input |
| `ctx.get(name)` | raw `&serde_json::Value` |

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

`ctx.storage_dir()` (`/storage`) is persistent per-plugin storage and
`ctx.work_dir()` (`.`) is the temporary job directory mounted by the sandbox.

## Runtime validation

In **Python and WASM**, the SDK validates the input before the handler runs
(defaults applied, required and typed fields checked) and the output after it
returns (JSON, and no key outside the declared outputs). In **Node**, validation
happens at build time — `liatir build` and `liatir dev` inspect the exported
plugin shape after bundling — not on each run.
