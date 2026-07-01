# liatir-cli

`liatir-cli` is the command-line tool for scaffolding, developing, and building `.lia` plugins.

## Installation

```bash
npm install -g liatir-cli
```

## Commands

### `liatir init <name>`

Scaffolds a new plugin project in a directory named `<name>`.

```bash
liatir init my-qc-plugin
cd my-qc-plugin
```

The generated project contains:

```
my-qc-plugin/
  .lia-manifest.json   ← source of truth for manifest.json
  src/
    index.ts           ← plugin entry point
  package.json
  tsconfig.json
```

### `liatir dev`

Starts esbuild in watch mode and connects to the running Liatir app for local plugin development.

```bash
liatir dev
```

Changes to `src/` are rebuilt automatically. The updated plugin is hot-reloaded in the app without a manual import step.

::: warning Liatir must be running
`liatir dev` needs a running Liatir app so the plugin can be loaded and tested during development.
:::

### `liatir build`

Bundles the plugin into a `.lia` file ready for distribution.

```bash
liatir build
# outputs: my-qc-plugin.lia
```

The build process:

1. Reads `.lia-manifest.json` and validates the schema
2. Runs esbuild to bundle `src/index.ts` into a single `index.js` (ESM, all deps inlined)
3. Creates the `_sig` file with content `LIATIR/1`
4. Packages `_sig`, `manifest.json`, and `index.js` into a ZIP archive named `<name>.lia`

## Entry point contract

`src/index.ts` must export a `run` function:

```typescript
export async function run(inputs: Record<string, unknown>): Promise<void> {
  // ... perform analysis ...

  const result = {
    report: { totalReads: 1000000, q30Rate: 0.87 },
  }

  process.stdout.write(`__LIATIR_RESULT__${JSON.stringify(result)}\n`)
}
```

The `__LIATIR_RESULT__` marker must appear on its own line. Everything before it on stdout is treated as log output and shown in the dev console.

## .lia-manifest.json

This file is the source of truth for the plugin manifest. It has the same schema as [`manifest.json`](/plugins/format#manifest-json) inside the bundle, but lives in the project root so it can be committed to version control.

```json
{
  "name": "my-qc-plugin",
  "version": "1.0.0",
  "description": "Custom QC analysis",
  "inputSchema": {
    "reads": {
      "type": "file",
      "label": "Input reads",
      "required": true,
      "accept": ".fastq,.fastq.gz"
    }
  },
  "outputSchema": {
    "report": {
      "type": "stats",
      "label": "QC report"
    }
  }
}
```

`liatir build` copies this file verbatim into the bundle as `manifest.json`.
