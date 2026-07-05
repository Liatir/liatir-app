---
title: definePlugin
description: Declares the input/output contract and entry point of a .lia plugin, in Node, Python, or WASM.
---

# definePlugin

Every `.lia` plugin declares its inputs and outputs **once**, in code, and
attaches the implementation to that contract. `liatir build` reads the contract
back and generates `manifest.json` from it — there is no schema to write or keep
in sync by hand.

This is the **same API in all three runtimes**:

- **Node** — `definePlugin({ inputs, outputs }).main(handler)` from `@liatir/api`.
- **Python** — `define_plugin(inputs=..., outputs=...)` + `@plugin.main` from the
  CLI-managed `liatir` module.
- **WASM (Rust)** — `define_plugin().input(...).output(...).main(handler)` from the
  CLI-managed `liatir` module.

For Python and WASM the `liatir` module is **not a package you install**: `liatir
init` scaffolds it into your project (`src/liatir.py` / `src/liatir.rs`) and
`liatir build` keeps it in sync with your CLI version. Its API version is the CLI
version.

## Node (TypeScript)

```ts
import { definePlugin, field, type PluginContext } from "@liatir/api";

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
  // Inputs and outputs are defined once above.
  return {
    length: input.text.length,
  };
});
```

The default export must be the result of `.main(...)`.

## Python

```python
from liatir import define_plugin, field

plugin = define_plugin(
    inputs={
        "text": field.string(
            label="Text",
            description="Text to analyze.",
            required=True,
            default="hello from Liatir",
        ),
    },
    outputs={
        "length": field.number(
            label="Length",
            description="Number of characters in the input text.",
            format="integer",
        ),
    },
)


@plugin.main
def main(ctx):
    return {"length": len(ctx.input["text"])}
```

The handler is decorated with `@plugin.main` and named `main`. It may be a plain
or `async def` function. The runtime passes the validated input on `ctx.input`.

## WASM (Rust)

```rust
mod liatir;

use liatir::{define_plugin, field};
use serde_json::json;

fn main() {
    define_plugin()
        .input("text", field::string()
            .label("Text")
            .description("Text to analyze.")
            .required(true)
            .default_value("hello from Liatir"))
        .output("length", field::number()
            .label("Length")
            .description("Number of characters in the input text.")
            .integer())
        .main(|ctx| {
            let text = ctx.str("text")?;
            Ok(json!({ "length": text.chars().count() }))
        });
}
```

`stdout` is reserved for the result — use `eprintln!` for logs.

## Contract enforcement

`liatir build` rejects a plugin whose contract is malformed: a missing entry
point, an input/output that is not an object, or a field with an unsupported
type (see [field builders](/plugins/api/plugin/field) for the allowed types).

In **Python and WASM**, the SDK also validates on **every run**: it applies
declared defaults, rejects a missing required input or a wrong-typed value
before your handler runs, and rejects a returned object that is not JSON or
carries a key not declared in `outputs`. In **Node**, the contract is enforced
at build time and through TypeScript; the handler is not re-validated at run
time.

## Important rules

- Do not hand-write `inputSchema` / `outputSchema` — it is generated from the code.
- Do not write internal result markers to stdout yourself.
- Return an object whose keys match the declared output keys.
- Node only: do not export `run(inputs)` directly, and do not maintain a Node `.lia-manifest.json`.

## Legacy plugins

Older Python plugins with a plain `def main(input)` and a manifest-owned
`inputSchema` / `outputSchema`, and older WASM tools that read stdin / write
stdout without the SDK, still build: when no code contract is present, the
manifest schema is used. When a code contract **is** present, it wins and any
manifest schema is ignored.

## Related pages

- [field builders](/plugins/api/plugin/field)
- [PluginContext](/plugins/api/plugin/plugin-context)
- [Liatir Node bridge](/plugins/api/plugin/node-bridge)
- [.lia Bundle Format](/plugins/format)
