---
title: align.minimap2
description: Runs the typed minimap2 alignment wrapper from the Liatir API.
---

# align.minimap2

`Liatir.align.minimap2()` maps long or short reads to a reference with minimap2,
using a preset for the read type.

## Signature

```ts
minimap2(args: Minimap2Args): Promise<AlignResult>
```

## Arguments

```ts
type Minimap2Args = {
  reference: string;   // reference FASTA
  reads: string;       // reads (FASTQ / FASTQ.gz)
  outputSam: string;   // where to write the output SAM
  preset?: string;     // 'sr' (short read), 'lr', 'map-ont', … (default 'sr')
  threads?: number;    // omit or use 0 to let Liatir choose a safe local value
};
```

## Result

Returns the same [`AlignResult`](/plugins/api/align/bwa-mem#result) as
`bwaMem` — `ok`, `exitCode`, `stderr`, `outputSam`, and the `threads` used.

## Example

```ts
const result = await Liatir.align.minimap2({
  reference: "/path/to/genome.fa",
  reads: "/path/to/reads.fastq.gz",
  outputSam: "/path/to/aligned.sam",
  preset: "map-ont",
});
```

Requires the `minimap2` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
