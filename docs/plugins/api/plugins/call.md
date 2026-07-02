---
title: plugins.call
description: Calls a registered low-level WASM plugin module.
---

# plugins.call

`Liatir.plugins.call()` calls a registered low-level WASM module.

For normal `.lia` plugin authoring, prefer the `.lia` manifest and plugin
contract documented in [Plugins](/plugins/overview). This namespace is for the
lower-level WASM runtime surface.

## Signature

```ts
call(
  module: string,
  payload: PluginCallPayload,
  timeoutMs?: number,
  hostReadPaths?: string[]
): Promise<PluginCallResult>
```

## Payload

```ts
type PluginCallPayload = {
  fn: string;
  args: number[] | Record<string, unknown>;
  [key: string]: unknown;
};
```

## Example

```ts
const result = await Liatir.plugins.call('my-wasm-module', {
  fn: 'run',
  args: { value: 42 }
});
```

## Result

The result includes duration, stdout, stderr, success state, and the returned
module value.

Use `hostReadPaths` for large local files that cannot reasonably be passed
through memory.

