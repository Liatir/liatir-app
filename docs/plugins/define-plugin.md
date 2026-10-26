---
title: Define plugin
description: Declares the input/output contract and entry point of a .lia plugin, in Node, Python, R, Native, or WASM.
---

# Define plugin entry point

Every `.lia` plugin declares its inputs and outputs **once**, in code, and
attaches the implementation to that contract. `liatir build` reads the contract
back and generates `manifest.json` from it — there is no schema to write or keep
in sync by hand.

All five runtimes share the same contract, with language-specific syntax:

- **Node** — `definePlugin({ inputs, outputs }).main(handler)` from `@liatir/api`.
- **Python** — `define_plugin(inputs=..., outputs=...)` + `@plugin.main` from the
  CLI-managed `liatir` module.
- **WASM (Rust)** — `define_plugin().input(...).output(...).main(handler)` from the
  CLI-managed `liatir` module.
- **R** — `define_plugin(inputs=..., outputs=...)` + `plugin$main(handler)`.
- **Native (Rust)** — the same contract builder as WASM, with full bridge access.
  Other compiled languages implement the [executable protocol](/plugins/format#executable-protocol-version-1).

For Python, R, Native Rust and WASM, the SDK is **not a separate package you
install**: `liatir init` supplies managed source files and `liatir build` refreshes
them from your installed CLI. See [API packages](/plugins/api-packages) for the
file names. Put your logic in separate files so SDK updates do not overwrite it.

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

## R

```r
source("liatir.R")

plugin <- define_plugin(
  inputs = list(text = field$string(
    label = "Text", required = TRUE, default = "hello from Liatir"
  )),
  outputs = list(length = field$number(label = "Length", format = "integer"))
)

plugin$main(function(ctx) {
  list(length = nchar(ctx$input$text, type = "chars"))
})
```

Save this in `src/main.R`. The SDK passes named lists to and from the handler.
Load scientific packages and perform analysis **inside the handler**: contract
extraction sources the entry point without calling the handler, but still
executes top-level R statements. Declare dependencies in the
[R runtime specification](/plugins/format#r-contract-and-manifest).

## Native (Rust)

```rust
mod liatir;

use liatir::{define_plugin, field};
use serde_json::json;

fn main() {
    define_plugin()
        .input("text", field::string().label("Text").required(true)
            .default_value("hello from Liatir"))
        .output("length", field::number().label("Length").integer())
        .main(|ctx| {
            let text = ctx.str("text")?;
            Ok(json!({ "length": text.chars().count() }))
        });
}
```

Save this in `src/main.rs` in a project created with `liatir init --native`.
The generated `liatir` module includes the Native bridge; no separate
`mod liatir_bridge` declaration is needed in your entry point. Use
`ctx.liatir` when your handler needs app storage, Jobs, logs or progress.
Other compiled languages implement the same
[executable protocol](/plugins/format#executable-protocol-version-1).

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
type (see [field builders](/plugins/field) for the allowed types).

In **Python, R, Native Rust and WASM**, the SDK also validates on **every run**: it applies
declared defaults, rejects a missing required input or a wrong-typed value
before your handler runs, and rejects a returned object that is not JSON or
carries a key not declared in `outputs`. In **Node**, the contract is enforced
at build time and through TypeScript; the handler is not re-validated at run
time.

A custom Native executable must implement its own matching validation. During
build, R and Native must emit a code-declared contract; they do not support a
separate, manually maintained manifest schema as a fallback.

## Important rules

- Do not hand-write `inputSchema` / `outputSchema` — it is generated from the code.
- When using a supplied SDK, let it write the internal result markers.
- Return an object whose keys match the declared output keys.
- Node only: do not export `run(inputs)` directly, and do not maintain a Node `.lia-manifest.json`.

## Related pages

- [Declare fields](/plugins/field)
- [Plugin context](/plugins/plugin-context)
- [.lia Bundle Format](/plugins/format)
