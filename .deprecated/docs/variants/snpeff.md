---
title: variants.snpeff
description: Runs the typed SnpEff functional annotation wrapper from the Liatir API.
---

# variants.snpeff

`Liatir.variants.snpeff()` annotates a VCF with SnpEff and returns the annotated
VCF path plus a rendered annotation summary. It requires a configured SnpEff JAR
and data directory.

## Signature

```ts
snpeff(args: SnpEffArgs): Promise<SnpEffResult>
```

## Arguments

```ts
type SnpEffArgs = {
  input: string;      // input VCF
  genome: string;     // genome database id (e.g. "hg38")
  jarPath: string;    // path to snpEff.jar
  dataDir: string;    // SnpEff data dir (downloaded databases)
  outputVcf: string;  // where to write the annotated VCF
  heap?: string;      // JVM heap (e.g. "4g"), default "4g"
  javaPath?: string;  // explicit java binary (optional)
};
```

## Result

```ts
type SnpEffResult = {
  output: ToolOutput;  // rendered annotation summary
  outputVcf: string;   // path to the annotated VCF
};
```

## Example

```ts
const { output, outputVcf } = await Liatir.variants.snpeff({
  input: "/path/to/variants.vcf",
  genome: "hg38",
  jarPath: "/path/to/snpEff.jar",
  dataDir: "/path/to/snpeff/data",
  outputVcf: "/path/to/annotated.vcf",
});
```

Requires a Java runtime and a configured SnpEff JAR + data directory.
