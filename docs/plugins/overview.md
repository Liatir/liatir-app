# Plugins (.lia)

`.lia` plugins are local extensions that add custom analysis steps to Liatir.
They appear in the Plugins area and can also be used as pipeline nodes through
the same input/output contract used by native tools.

A `.lia` file is built with `@liatir/lia` and imported into Liatir as a single
bundle. The bundle declares:

- metadata such as name, version, description, category, and tags;
- input fields shown in the UI;
- output fields that later pipeline steps can consume;
- the runtime, either `node` or `wasm`.

## Node plugins

Node plugins are the recommended starting point for most custom logic. A Node
plugin is written in TypeScript or JavaScript and uses `@liatir/sdk`.

The plugin contract is declared once in `definePlugin({ inputs, outputs })`.
`lia build` reads that contract from the compiled code and generates the
`.lia` manifest automatically.

```ts
import { definePlugin, field, type PluginContext } from "@liatir/sdk";

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

export default liatirPlugin.main(async ({ input, lia }: PluginContext<typeof liatirPlugin>) => {

  // Write the plugin logic here

  return {
    length: input.text.length,
  };
});
```

Do not write a separate Node plugin manifest by hand. Do not export a standalone
`run()` function. Do not write result markers to stdout. Return the output object
from `.main(...)`; Liatir handles packaging, execution, logs, and result parsing.

## What a Node plugin can use

The `lia` object passed to `.main(...)` is a Node bridge to the running Liatir
app. It includes:

- `lia.jobs` for running and tracking local command-line processes;
- `lia.deps` for checking whether binaries are available;
- `lia.desktop.fs` for scoped Liatir storage;
- `lia.desktop.files`, `lia.desktop.app`, diagnostics, notifications, clipboard,
  network, and global variables where meaningful in a headless process;
- typed bio namespaces such as `lia.qc`, `lia.align`, and `lia.variants`;
- lower-level `lia.plugins`, `lia.sidecar`, and `lia.invoke` escape hatches.

Node plugins can also use normal Node.js APIs and bundled npm dependencies.

## WASM plugins

WASM `.lia` plugins are Rust tools compiled to `wasm32-wasip1`. They are more
sandboxed than Node plugins:

- input JSON is read from stdin;
- output JSON is written to stdout;
- the schema lives in `.lia-manifest.json`;
- no arbitrary host filesystem or network access is available;
- directories containing declared file inputs are mounted read-only by Liatir.

Use WASM for small, portable, sandboxed computation. Use Node plugins when you
need the Liatir bridge, local process management, or ordinary Node libraries.

## .lia file structure

`lia build` creates a ZIP bundle with a Liatir signature, a generated or copied
manifest, and the runtime payload:

```txt
my-plugin.lia
  _sig
  manifest.json
  index.js       # Node runtime
```

```txt
my-tool.lia
  _sig
  manifest.json
  plugin.wasm    # WASM runtime
```

The `_sig` file must contain `LIATIR/1`. Liatir validates it before reading the
manifest.

## Building and importing

```bash
npm install -g @liatir/lia
lia init my-plugin --yes
cd my-plugin
npm install
lia build
```

Then open **Plugins** in Liatir and import the generated `.lia` file.

## Pipeline integration

The fields declared in `inputs` and `outputs` become the plugin's pipeline
contract. Liatir uses them to render forms, validate required inputs, expose
outputs to later steps, and store file outputs in Results.

For the exact bundle format, see [.lia Bundle Format](/plugins/format). For CLI
commands, see [@liatir/lia CLI](/plugins/liatir-cli). For the SDK API, see
[Liatir SDK](/plugins/sdk) and [Plugin authoring API](/plugins/api/plugin/define-plugin).
