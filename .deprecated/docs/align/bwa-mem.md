---
title: align.bwaMem
description: Runs the typed BWA-MEM short-read alignment wrapper from the Liatir API.
---

# align.bwaMem

`Liatir.align.bwaMem()` maps short reads to a reference with BWA-MEM. The
reference is indexed automatically on first use, and the SAM output is written to
the path you provide.

## Signature

```ts
bwaMem(args: BwaMemArgs): Promise<AlignResult>
```

## Arguments

```ts
type BwaMemArgs = {
  reference: string;   // reference FASTA (indexed automatically on first use)
  readsR1: string;     // reads R1 (FASTQ / FASTQ.gz)
  readsR2?: string;    // reads R2 for paired-end data (optional)
  outputSam: string;   // where to write the output SAM
  threads?: number;    // omit or use 0 to let Liatir choose a safe local value
};
```

## Result

```ts
type AlignResult = {
  ok: boolean;
  exitCode: number | null;
  threads?: number;    // worker threads actually used, when reported
  stderr: string[];    // captured stderr — also where BWA prints run stats
  outputSam: string;   // absolute path of the produced SAM (echoed back)
};
```

## Example

```ts
const result = await Liatir.align.bwaMem({
  reference: "/path/to/genome.fa",
  readsR1: "/path/to/R1.fastq.gz",
  readsR2: "/path/to/R2.fastq.gz",
  outputSam: "/path/to/aligned.sam",
});
```

Requires the `bwa` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
