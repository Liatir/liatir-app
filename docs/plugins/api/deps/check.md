---
title: deps.check
description: Checks whether one command-line dependency is available.
---

# deps.check

`Liatir.deps.check()` checks whether one command-line binary is available in
`PATH`.

## Signature

```ts
check(binary: string): Promise<DepCheckResult>
```

## Example

```ts
const samtools = await Liatir.deps.check('samtools');

if (!samtools.available) {
  console.warn('Samtools is not available.');
}
```

## Result

```ts
type DepCheckResult = {
  available: boolean;
  binary: string;
  path: string | null;
  version: string | null;
};
```

