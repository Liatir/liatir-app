---
title: qc.seqkit
description: Runs the typed seqkit stats wrapper from the Liatir API.
---

# qc.seqkit

`Liatir.qc.seqkit()` runs `seqkit stats` (with `-a` for all statistics by
default) and returns a rendered Liatir `ToolOutput`.

## Signature

```ts
seqkit(args: { input: string; all?: boolean; threads?: number }): Promise<ToolOutput>
```

## Arguments

| Field | Type | Description |
| --- | --- | --- |
| `input` | `string` | Path to the FASTA/FASTQ file to analyze. |
| `all` | `boolean` | Compute all statistics (`-a`). Default `true`. |
| `threads` | `number` | Worker threads. Omit to let Liatir choose a safe local value. |

## Example

```ts
const output = await Liatir.qc.seqkit({ input: "/path/to/reads.fastq.gz" });
```

## Result

Returns a standard Liatir `ToolOutput`, rendered by the same viewer components
as native tools. Throws if `seqkit` exits non-zero or its output cannot be
parsed.

Requires the `seqkit` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
