---
title: align.flagstat
description: Runs the typed samtools flagstat wrapper from the Liatir API.
---

# align.flagstat

`Liatir.align.flagstat()` computes alignment summary statistics with
`samtools flagstat` over a SAM/BAM file and returns a rendered Liatir
`ToolOutput`.

## Signature

```ts
flagstat(args: { input: string; threads?: number }): Promise<ToolOutput>
```

## Arguments

| Field | Type | Description |
| --- | --- | --- |
| `input` | `string` | Path to the SAM/BAM file. |
| `threads` | `number` | Worker threads. Omit to let Liatir choose a safe local value. |

## Example

```ts
const output = await Liatir.align.flagstat({ input: "/path/to/aligned.bam" });
```

## Result

Returns a standard Liatir `ToolOutput`. Throws if `samtools` exits non-zero.

Requires the `samtools` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
