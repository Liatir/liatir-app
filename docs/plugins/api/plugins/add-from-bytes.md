---
title: plugins.addFromBytes
description: Adds a low-level WASM module from bytes.
---

# plugins.addFromBytes

`Liatir.plugins.addFromBytes()` registers a low-level WASM module from a byte
array.

## Signature

```ts
addFromBytes(name: string, contents: number[]): Promise<unknown>
```

## Example

```ts
await Liatir.plugins.addFromBytes('my-wasm-module', wasmBytes);
```

## Notes

Use [plugins.add](/plugins/api/plugins/add) when the module should be selected
by the user through a file picker.

