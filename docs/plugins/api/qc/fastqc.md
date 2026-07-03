---
title: qc.fastqc
description: Runs the typed FastQC wrapper from the Liatir API.
---

# qc.fastqc

`Liatir.qc.fastqc.run()` runs the typed FastQC wrapper and returns a Liatir tool
output object.

## Signature

```ts
run(args: FastqcArgs): Promise<ToolOutput>
```

## Arguments

```ts
type FastqcArgs = {
  input: string;
  maxReads?: number;
  timeoutMs?: number;
};
```

## Example

```ts
const output = await Liatir.qc.fastqc.run({
  input: '/path/to/sample.fastq.gz',
  maxReads: 100000
});
```

## Result

The method returns a standard Liatir `ToolOutput`, so the result can render
stats, sections, plots, and text with the same viewer components used by native
tools.

