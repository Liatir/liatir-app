# Modules (.lia)

`.lia` modules are the primary extension mechanism for Liatir. A module is a self-contained bundle that adds a custom analysis step — from simple data transformations to full pipeline orchestration via Nextflow, Snakemake, or any other external tool.

## What a .lia module can do

The JavaScript inside a `.lia` bundle runs in a full Node.js subprocess. It can:

- **Shell out to any CLI tool** — wrap a Nextflow workflow, a Snakemake pipeline, a custom Python script, or any bioinformatics tool that isn't natively supported by Liatir.
- **Read and write files** via the Liatir IPC server (no Node.js `fs` workarounds needed).
- **Produce structured results** — stats tables, text sections, and Plotly charts rendered by `ToolResultView`.
- **Register output files** in the Data library for use in subsequent pipeline steps.

From Liatir's perspective, a `.lia` module that wraps a 50-step Nextflow workflow looks identical to a native BCFtools stats run: same input form, same run history, same output tracking.

## .lia file structure

A `.lia` file is a ZIP archive with exactly three required entries:

```
my-module.lia  (ZIP)
  ├── _sig           "LIATIR/1"  (validated by Rust before anything else)
  ├── manifest.json  module metadata + input/output schema
  └── index.js       ESM bundle (all dependencies inlined by esbuild)
```

The `_sig` file is checked first by the Rust runtime. If its content is not exactly `LIATIR/1`, the import is rejected and no other files are read or executed.

## Why a single-file bundle?

Distributing a module as a single `.lia` file solves real pain points:

- **No npm install** — all dependencies are inlined by esbuild at build time.
- **No version conflicts** — the bundle is isolated; it cannot conflict with other modules.
- **Easy to share** — send a `.lia` file by email, copy it to a USB drive, or host it on a file server. The recipient drags it into Liatir and it works.
- **System file association** — `.lia` files are registered with the OS. Double-clicking one opens Liatir's import dialog directly.

## Importing a module

1. Navigate to **Modules** in the sidebar.
2. Click **Import module** and select a `.lia` file — or double-click a `.lia` file in Finder/Explorer.
3. Liatir validates the `_sig` file. If invalid, the import is rejected immediately.
4. The module's `manifest.json` is parsed and the module appears in the list.

## Running a module

1. Select the module from the list.
2. The UI renders a form based on the module's `inputSchema`.
3. Fill in the required fields (file pickers, text inputs, numbers, toggles).
4. Click **Run**.

Liatir extracts the bundle to a temp directory, passes inputs as environment variables, and runs `node index.js`. The module streams its result back with:

```javascript
process.stdout.write(`__LIATIR_RESULT__${JSON.stringify(result)}\n`)
```

Everything printed before that marker is treated as log output. After the marker, Liatir parses the JSON and renders it using `ToolResultView`.

::: warning Node.js required
Modules require Node.js in your system PATH. Liatir checks for `node` on the Modules page and shows installation instructions if missing.
:::

## Wrapping external pipelines

A `.lia` module that orchestrates Nextflow or Snakemake looks like this:

```typescript
// src/index.ts
import { execSync } from 'child_process'
import path from 'path'

export async function run(inputs: Record<string, unknown>) {
  const fastq = inputs.reads as string
  const outDir = inputs.outputDir as string

  // Run a Nextflow pipeline — anything in PATH works
  execSync(`nextflow run nf-core/rnaseq --reads ${fastq} --outdir ${outDir}`, {
    stdio: 'inherit',
  })

  const result = {
    sections: [{
      type: 'text',
      title: 'Pipeline complete',
      content: `Results written to ${outDir}`,
    }]
  }

  process.stdout.write(`__LIATIR_RESULT__${JSON.stringify(result)}\n`)
}
```

The `manifest.json` for this module declares `reads` (file input) and `outputDir` (string input). When the pipeline completes and writes output files, those paths can be registered back in the Data library.

## Pipeline integration

Every `.lia` module exposes a `PipelineStepDefinition` derived from its `manifest.json`. This means module outputs can flow automatically to the inputs of subsequent native tools or other modules in a pipeline.

See [.lia Format](/modules/format) for the full manifest schema, and [liatir-cli](/modules/liatir-cli) to learn how to scaffold and build a module.
