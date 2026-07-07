---
title: align.faidx
description: Runs the typed samtools faidx wrapper from the Liatir API.
---

# align.faidx

`Liatir.align.faidx()` indexes a FASTA reference with `samtools faidx`. The
index is written next to the input as `<input>.fai`.

## Signature

```ts
faidx(args: { input: string; threads?: number }): Promise<FaidxResult>
```

## Arguments

| Field | Type | Description |
| --- | --- | --- |
| `input` | `string` | Path to the FASTA reference. |
| `threads` | `number` | Worker threads. Omit to let Liatir choose a safe local value. |

## Result

```ts
type FaidxResult = {
  faiPath: string;   // path of the produced index (`<input>.fai`)
};
```

## Example

```ts
const { faiPath } = await Liatir.align.faidx({ input: "/path/to/genome.fa" });
```

Throws if `samtools` exits non-zero. Requires the `samtools` binary — check
availability with [`Liatir.deps.check`](/plugins/api/deps/check).
