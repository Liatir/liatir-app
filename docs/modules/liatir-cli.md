# liatir-cli

`liatir-cli` is the command-line tool for scaffolding, developing, and building `.lia` modules.

## Installation

```bash
npm install -g liatir-cli
```

## Commands

### `liatir init <name>`

Scaffolds a new module project in a directory named `<name>`.

```bash
liatir init my-qc-module
cd my-qc-module
```

The generated project contains:

```
my-qc-module/
  .lia-manifest.json   ← source of truth for manifest.json
  src/
    index.ts           ← module entry point
  package.json
  tsconfig.json
```

### `liatir dev`

Starts esbuild in watch mode and connects to the running Liatir app via the IPC server (reads `{app_data_dir}/.ipc`).

```bash
liatir dev
```

Changes to `src/` are rebuilt automatically. The updated module is hot-reloaded in the app without a manual import step.

::: warning Liatir must be running
`liatir dev` looks for an active IPC socket. Start the Liatir app before running this command.
:::

### `liatir build`

Bundles the module into a `.lia` file ready for distribution.

```bash
liatir build
# outputs: my-qc-module.lia
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

This file is the source of truth for the module manifest. It has the same schema as [`manifest.json`](/modules/format#manifest-json) inside the bundle, but lives in the project root so it can be committed to version control.

```json
{
  "name": "my-qc-module",
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
