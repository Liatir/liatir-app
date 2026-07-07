---
title: variants.bcftoolsStats
description: Runs the typed bcftools stats wrapper from the Liatir API.
---

# variants.bcftoolsStats

`Liatir.variants.bcftoolsStats()` computes variant statistics with
`bcftools stats` and returns a rendered Liatir `ToolOutput`.

## Signature

```ts
bcftoolsStats(args: { input: string; threads?: number }): Promise<ToolOutput>
```

## Arguments

| Field | Type | Description |
| --- | --- | --- |
| `input` | `string` | Path to the VCF/BCF file. |
| `threads` | `number` | Worker threads. Omit to let Liatir choose a safe local value. |

## Example

```ts
const output = await Liatir.variants.bcftoolsStats({
  input: "/path/to/variants.vcf.gz",
});
```

## Result

Returns a standard Liatir `ToolOutput`. Throws if `bcftools` exits non-zero.

Requires the `bcftools` binary — check availability with
[`Liatir.deps.check`](/plugins/api/deps/check).
