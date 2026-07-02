# @liatir/lia CLI

`@liatir/lia` is the command-line package for scaffolding, developing, and
building `.lia` plugins and WASM tools.

The installed binary is `lia`. The package also exposes a `liatir` binary for
compatibility.

## Installation

```bash
npm install -g @liatir/lia
```

You can also use it without a global install:

```bash
npx lia init my-plugin --yes
```

## `lia init`

`lia init` creates a new plugin or WASM tool project.

```bash
lia init my-plugin --yes
cd my-plugin
npm install
```

Recommended defaults create a Node TypeScript plugin with:

```txt
my-plugin/
  src/
    index.ts
  package.json
  tsconfig.json
```

The generated `src/index.ts` follows the current plugin contract:

```ts
import { definePlugin, field, type PluginContext } from "@liatir/sdk";

// Docs: https://liatir.com/docs/plugins
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
  // Write your plugin logic here. Inputs and outputs are defined once above.

  return {
    length: input.text.length,
  };
});
```

Useful init flags:

```bash
lia init                         # asks for the project folder
lia init my-plugin --yes          # recommended defaults
lia init my-plugin --node --ts    # Node TypeScript plugin
lia init my-plugin --node --js    # Node JavaScript plugin
lia init my-tool --wasm           # Rust/WASM tool
lia init my-plugin --template file-processor
lia init my-plugin --template bio-cli
lia init my-plugin --category "Quality Control" --tags "FASTQ,QC"
lia init my-plugin --no-install
lia init my-tool --no-wasm-target
```

## `lia dev`

`lia dev` watches the plugin source, rebuilds on save, validates the same runtime
shape used by `lia build`, applies schema defaults, and runs the plugin against
the open Liatir app.

```bash
lia dev --input '{"text":"hello"}'
lia dev --input-file inputs.json
```

::: warning Liatir must be running
Node plugins use the local Liatir IPC bridge. Start the desktop app before using
`lia dev`.
:::

## `lia build`

`lia build` packages the project as `<name>.lia`.

For Node plugins it:

1. resolves the Node entry point;
2. runs TypeScript checks when a `tsconfig.json` exists;
3. bundles the entry point with esbuild;
4. imports the bundle and validates `definePlugin({ inputs, outputs }).main(...)`;
5. generates `manifest.json` from the declared schema;
6. writes `_sig`, `manifest.json`, and `index.js` into the `.lia` ZIP.

For WASM tools it:

1. reads `.lia-manifest.json`;
2. compiles Rust with `cargo build --release --target wasm32-wasip1`;
3. writes `_sig`, `manifest.json`, and `plugin.wasm` into the `.lia` ZIP.

```bash
lia build
```

## `lia update`

`lia update` updates both `@liatir/lia` and `@liatir/sdk` in a Node `.lia`
plugin project.

```bash
lia update
lia update --version 1.5.2
lia update --no-install --version 1.5.2
```

WASM projects do not use `@liatir/sdk`; update the CLI itself with:

```bash
npm install -g @liatir/lia@latest
```
