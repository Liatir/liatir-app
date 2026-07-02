---
title: plugins.add
description: Adds a low-level WASM plugin through a file picker.
---

# plugins.add

`Liatir.plugins.add()` adds a low-level WASM plugin through a native file picker.

## Signature

```ts
add(name: string, maxBytes?: number): Promise<PluginAddResult>
```

## Example

```ts
const added = await Liatir.plugins.add('my-wasm-plugin');
```

## Result

```ts
type PluginAddResult = {
  bytes: number;
  name: string;
  path: string;
  saved: boolean;
};
```
