---
title: pipeline.run
description: Runs a sequential pipeline made of low-level WASM and sidecar steps.
---

# pipeline.run

`Liatir.pipeline.run()` runs a simple sequential pipeline made of low-level
WASM plugin calls and native sidecar steps.

This is not the same as Liatir's visual pipeline builder. The visual pipeline
builder uses the app-level shared I/O contract, Jobs, Results, and provenance.

## Signature

```ts
run(
  steps: PipelineStep[],
  opts?: { continueOnError?: boolean }
): Promise<PipelineResult>
```

## Step types

```ts
type PipelineStep =
  | {
      kind: 'wasm';
      label: string;
      plugin: string;
      payload: PluginCallPayload;
      timeoutMs?: number;
    }
  | {
      kind: 'sidecar';
      label: string;
      binary: string;
      args: string[];
    };
```

## Example

```ts
const result = await Liatir.pipeline.run([
  {
    kind: 'wasm',
    label: 'QC step',
    plugin: 'fastqc.wasm',
    payload: { fn: 'run', args: { input: '/path/to/sample.fastq' } }
  }
]);
```

## Result

The result reports the status, duration, output, and error for each step.

