# Pipeline

The Liatir pipeline system connects analysis steps so that outputs from one step flow automatically into the inputs of the next. Every native tool, `.lia` module, and WASM plugin exposes the same typed schema — which means any step can be combined with any other compatible step.

::: warning Status: type system complete, visual builder in progress
The shared schema infrastructure and `PipelineStepDefinition` types are implemented and used by all tools and modules today. The DAG canvas editor and automated run execution are planned features.
:::

## The schema system

### PipelineStepDefinition

Every step — whether it is a native binary wrapper, a JavaScript module, or a WASM plugin — exposes a `PipelineStepDefinition`:

```typescript
interface PipelineStepDefinition {
  id: string                              // unique step identifier
  type: 'native-tool' | 'lia-module' | 'wasm-plugin'
  label: string                           // display name
  description: string
  category: string                        // e.g. 'qc', 'alignment', 'variants'
  inputSchema:  Record<string, InputFieldSchema>
  outputSchema: Record<string, OutputFieldSchema>
}
```

This is the single source of truth for what a step needs and what it produces.

### InputFieldSchema

Describes a single input parameter:

```typescript
interface InputFieldSchema {
  type: 'string' | 'number' | 'boolean' | 'file'
  label?: string
  required?: boolean
  default?: string | number | boolean
  accept?: string[]    // file extensions, e.g. ['fastq', 'fastq.gz']
}
```

### OutputFieldSchema

Describes a single output:

```typescript
interface OutputFieldSchema {
  type: 'file' | 'stats' | 'string' | 'number'
  label?: string
  ext?: string[]          // expected extensions for file outputs
  description?: string
}
```

### RunOutputFile

Files produced by a run are represented as `RunOutputFile` values. These are stored alongside the run record and can be registered in the Data library:

```typescript
interface RunOutputFile {
  label: string
  path: string     // absolute path on disk
  ext: string      // file extension without dot
  size?: number    // bytes
}
```

## How data flows between steps

When a file-type output from step A is connected to a file-type input on step B, the pipeline engine:

1. Reads `RunOutputFile.path` from the step A result.
2. Checks that the file extension matches `inputSchema[field].accept` on step B.
3. Pre-fills the input field on step B with that path.
4. Registers the file in the Data library if it is not already there.

This means the user never manually copies a path between tool runs — the pipeline does it automatically.

## Step registry

All registered steps and their IDs:

| Step | Type | Pipeline ID |
|------|------|------------|
| FastQC | WASM plugin | `fastqc` |
| Samtools flagstat | Native tool | `samtools-flagstat` |
| BCFtools stats | Native tool | `bcftools-stats` |
| fastp | Native tool | `fastp` |

`.lia` module IDs are taken from the `name` field in their `manifest.json`.

## Typical pipeline: FASTQ → Alignment → Variant Calling

Even before the visual builder exists, you can use Liatir tools in sequence manually:

```
1. fastp          FASTQ (R1 + R2)     → trimmed R1, trimmed R2
2. [aligner .lia] trimmed FASTQ       → BAM  (e.g., BWA-MEM2 .lia module)
3. samtools       BAM                 → flagstat stats
4. [variant .lia] BAM + reference     → VCF  (e.g., GATK HaplotypeCaller .lia)
5. bcftools       VCF                 → variant stats, Ts/Tv ratio
```

Each step's output files are registered in the Data library via **Add to Data**, and the next step picks them from the file picker. The visual pipeline builder will automate this wiring.

## Planned: visual pipeline builder

The DAG canvas editor will provide:

- **Step library panel** — drag any registered step onto the canvas.
- **Edge drawing** — connect a file output port to a compatible file input port. Type compatibility is checked at connect time.
- **Run pipeline** — execute all steps in topological order, passing outputs automatically.
- **Pipeline persistence** — save and reload pipeline definitions as JSON.
- **Nested pipelines** — embed a `.lia` module that itself runs Nextflow or Snakemake, treating the entire external pipeline as a single opaque step.
