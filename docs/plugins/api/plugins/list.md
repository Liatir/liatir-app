---
title: plugins.list
description: Lists registered low-level WASM plugins.
---

# plugins.list

`Liatir.plugins.list()` lists low-level WASM plugins registered in the runtime.

## Signature

```ts
list(): Promise<string[]>
```

## Example

```ts
const plugins = await Liatir.plugins.list();
```
