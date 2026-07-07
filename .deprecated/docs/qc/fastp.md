---
title: qc.fastp
description: Runs the typed fastp trimming + QC wrapper from the Liatir API.
---

# qc.fastp

`Liatir.qc.fastp()` trims and quality-filters FASTQ reads with `fastp`, writes
the trimmed reads, and returns the parsed before/after QC report.

## Signature

```ts
fastp(args: {
  r1: string;
  r2?: string;
  outDir?: string;
  threads?: number;
}): Promise<FastpResult>
```

## Arguments

| Field | Type | Description |
| --- | --- | --- |
| `r1` | `string` | Path to the R1 FASTQ file. |
| `r2` | `string` | Path to the R2 FASTQ file (paired-end only). |
| `outDir` | `string` | Directory for the trimmed output. Defaults to a temp dir. |
| `threads` | `number` | Worker threads. Omit to let Liatir choose a safe local value. |

## Result

```ts
type FastpResult = {
  output: ToolOutput;   // rendered before/after QC stats
  trimmedR1: string;    // path to trimmed R1
  trimmedR2?: string;   // path to trimmed R2 (paired-end only)
};
```

## Example

```ts
const { output, trimmedR1, trimmedR2 } = await Liatir.qc.fastp({
  r1: "/path/to/R1.fastq.gz",
  r2: "/path/to/R2.fastq.gz",
});
```

Requires the `fastp` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
