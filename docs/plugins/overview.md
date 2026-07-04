# Plugins (.lia)

Build anything on top of Liatir: `.lia` plugins can run with Node, Python, or WASM, so you can choose the runtime that fits the job.
They appear in the Plugins area and can run as pipeline nodes or by itself, just like Liatir native tools.

A `.lia` plugin file is a bundle built with `@liatir/cli` and imported into Liatir. It declares:

- metadata such as name, version, description, category, and tags;
- input fields shown in the UI;
- output fields that later pipeline steps can consume;
- the runtime: `node`, `python`, or `wasm`.

:::info
Plugins must follow the **Liatir I/O standard**, but don't worry — the **Liatir CLI** scaffolds that for you.
:::

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
- lower-level `Liatir.plugins`, `Liatir.sidecar`, and `Liatir.invoke` escape hatches.

Node plugins can also use normal Node.js APIs and bundled npm dependencies.

## WASM plugins

WASM `.lia` plugins are Web Assembly tools compiled to `wasm32-wasip1`. They are more
sandboxed than Node or Python plugins:

- input JSON is read from stdin;
- output JSON is written to stdout;
- the schema lives in `.lia-manifest.json`;
- no arbitrary host filesystem or network access is available;
- directories containing declared file inputs are mounted read-only by Liatir.

## Python plugins

Python `.lia` plugins are useful for scientific Python code and libraries such
as parsers, statistics packages, and analysis helpers. They use a
`.lia-manifest.json` file for the input/output schema and a Python entry point,
usually `src/main.py`.

```python
def main(input):
    text = str(input.get("text", ""))
    return {
        "length": len(text),
    }
```

Python plugins run in isolated managed Python environments. The plugin manifest
can declare packages and requirements; Liatir prepares that runtime box before
execution and shows its status and installed size in the Plugins UI.

Python plugins do not receive the Node `Liatir` bridge. Use Node plugins when a
plugin needs to spawn Liatir jobs, call bridge APIs, or interact with app
services directly.

---

<br>

:::info
- Use WASM for portable, sandboxed computation. 
- Use Node plugins when you need the Liatir bridge, local process management, or the flexibility of the Node environment and libraries.
- Use Python plugins when the implementation depends on Python libraries or scientific Python workflows.
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
