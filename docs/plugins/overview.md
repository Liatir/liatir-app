# Plugins (.lia)

Build anything on top of Liatir: `.lia` plugins can run with Node, Python, or WASM, so you can choose the runtime that fits the job.
They appear in the Plugins area and can run as pipeline nodes or by itself, just like Liatir native tools.

A `.lia` plugin file is a bundle built with `@liatir/cli` and imported into Liatir. It declares:

- metadata such as name, version, description, category, and tags;
- input fields shown in the UI;
- output fields that later pipeline steps can consume;
- the runtime: `node`, `python`, or `wasm`.

:::info

<div style="display: flex;">

<p style="margin-right: 10px; margin-top: 8px;"> <strong>→</strong> </p> <p> Every plugin must follow the <strong>Liatir I/O standard</strong>, but don't worry — the <strong>Liatir CLI</strong> scaffolds that for you. </p>

</div>

:::

---

![Liatir API surface map](/static/api-surface-map.svg)

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
- `Liatir.desktop.fs` for scoped Liatir storage;
- `Liatir.desktop.files`, `Liatir.desktop.app`, diagnostics, notifications, clipboard,
  network, and global variables where meaningful in a headless process;
- typed bio namespaces such as `Liatir.qc`, `Liatir.align`, and `Liatir.variants`;
- lower-level `Liatir.sidecar` and `Liatir.invoke` escape hatches.

Node plugins can also use normal Node.js APIs and bundled npm dependencies.

---

<center>

![Liatir API surface Node map](/static/api-surface-node-map.svg)

</center>

## Python plugins

Python `.lia` plugins are useful for scientific Python code and libraries such
as parsers, statistics packages, and analysis helpers. They declare the same
`define_plugin` contract as Node and WASM, with the CLI-managed `liatir` module
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
read and write app storage, and call any other bridge API:

```python
@plugin.main
def main(ctx):
    ctx.liatir.deps.check("bwa")
    job = ctx.liatir.jobs.run("bwa", ["index", ctx.input["ref"]])
    return {"jobId": job["id"]}
```

`ctx.liatir` mirrors the Node namespaces (`jobs`, `deps`, `desktop.*`,
`sidecar`, `pipeline`, `paths()`, plus `invoke` as a raw escape hatch), using
snake_case method names. It resolves its connection lazily, so plugins that
never touch the bridge run without requiring the app.

---

<center>

![Liatir API surface Python map](/static/api-surface-py-map.svg)

</center>

## WASM plugins


WASM `.lia` plugins are Web Assembly tools compiled to `wasm32-wasip1`. They
declare the same `define_plugin` contract as Node and Python through the
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
Node or Python plugins:

- no arbitrary host filesystem or network access is available;
- directories containing declared file inputs are mounted read-only by Liatir;
- stdout is reserved for the result JSON (use `eprintln!` for logs).

> WASM plugins remain fully sandboxed and have no bridge: they cannot call back into the app. Use Node or Python when you need bridge access.

---

<br>

:::info
- Use WASM for portable, sandboxed computation that must not call back into the app (no bridge).
- Use Node plugins when you want the Liatir bridge with the Node environment and its libraries.
- Use Python plugins when the implementation depends on Python libraries or scientific Python workflows — they get the same bridge as Node via `ctx.liatir`.
:::

<style>
  .info {
    padding-top: 5px !important;
    padding-bottom: 5px !important;
  }
  .custom-block-title-default {
    display: none !important;
  }
</style>
