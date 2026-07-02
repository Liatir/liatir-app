---
title: plugins.addFromBytes
description: Adds a low-level WASM plugin from bytes.
---

# plugins.addFromBytes

`Liatir.plugins.addFromBytes()` registers a low-level WASM plugin from a byte
array.

## Signature

```ts
addFromBytes(name: string, contents: number[]): Promise<unknown>
```

## Example

```ts
await Liatir.plugins.addFromBytes('my-wasm-plugin', wasmBytes);
```

## Notes

Use [plugins.add](/plugins/api/plugins/add) when the plugin should be selected
by the user through a file picker.
