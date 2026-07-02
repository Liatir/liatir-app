---
title: plugins.list
description: Lists registered low-level WASM modules.
---

# plugins.list

`Liatir.plugins.list()` lists low-level WASM modules registered in the runtime.

## Signature

```ts
list(): Promise<string[]>
```

## Example

```ts
const modules = await Liatir.plugins.list();
```

