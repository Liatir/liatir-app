---
title: plugins.remove
description: Removes a registered low-level WASM module.
---

# plugins.remove

`Liatir.plugins.remove()` removes a registered low-level WASM module.

## Signature

```ts
remove(name: string): Promise<boolean>
```

## Example

```ts
await Liatir.plugins.remove('my-wasm-module');
```

