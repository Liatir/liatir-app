---
title: deps.checkMany
description: Checks several command-line dependencies at once.
---

# .deps.checkMany

`Liatir.deps.checkMany()` checks several command-line binaries at once.

## Signature

```ts
checkMany(binaries: string[]): Promise<DepCheckResult[]>
```

## Example

```ts
const deps = await Liatir.deps.checkMany(['samtools', 'bcftools', 'fastqc']);
```

## Notes

Use this method when a workflow needs several external tools and you want to
show one dependency report to the user.

