---
title: plugins.remove
description: Removes a registered low-level WASM plugin.
---

# plugins.remove

`Liatir.plugins.remove()` removes a registered low-level WASM plugin.

## Signature

```ts
remove(name: string): Promise<boolean>
```

## Example

```ts
await Liatir.plugins.remove('my-wasm-plugin');
```
