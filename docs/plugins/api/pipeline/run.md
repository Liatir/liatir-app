---
title: pipeline.run
description: Runs a sequential pipeline made of native sidecar steps.
---

# pipeline.run

`Liatir.pipeline.run()` runs a simple sequential pipeline made of native sidecar
steps.

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
type PipelineStep = {
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
    kind: 'sidecar',
    label: 'Index reference',
    binary: 'samtools',
    args: ['faidx', '/path/to/genome.fa'],
  },
]);
```

## Result

The result reports the status, duration, output, and error for each step.
