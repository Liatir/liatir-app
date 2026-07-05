---
title: variants.bcftoolsFilter
description: Runs the typed bcftools filter wrapper from the Liatir API.
---

# variants.bcftoolsFilter

`Liatir.variants.bcftoolsFilter()` filters variants by expression with
`bcftools filter -i` and writes a bgzipped VCF (`-O z`).

## Signature

```ts
bcftoolsFilter(args: BcftoolsFilterArgs): Promise<BcftoolsFilterResult>
```

## Arguments

```ts
type BcftoolsFilterArgs = {
  input: string;        // input VCF/BCF
  outputVcf: string;    // where to write the filtered VCF (bgzipped)
  expression?: string;  // filter expression for `-i` (default "QUAL>20")
  threads?: number;     // worker threads
};
```

## Result

```ts
type BcftoolsFilterResult = {
  outputVcf: string;    // path to the filtered VCF
  expression: string;   // the expression that was applied
};
```

## Example

```ts
const { outputVcf } = await Liatir.variants.bcftoolsFilter({
  input: "/path/to/variants.vcf.gz",
  outputVcf: "/path/to/filtered.vcf.gz",
  expression: "QUAL>30 && DP>10",
});
```

Throws if `bcftools` exits non-zero. Requires the `bcftools` binary — check
availability with [`Liatir.deps.check`](/plugins/api/deps/check).
