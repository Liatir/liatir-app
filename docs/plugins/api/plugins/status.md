---
title: plugins.status
description: Checks the low-level WASM plugin runtime status.
---

# plugins.status

`Liatir.plugins.status()` checks whether the low-level WASM runtime is ready.

## Signature

```ts
status(): Promise<{ ready: true; runtime: string }>
```

## Example

```ts
const status = await Liatir.plugins.status();
console.log(status.runtime);
```

