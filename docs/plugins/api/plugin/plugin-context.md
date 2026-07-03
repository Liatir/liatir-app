---
title: PluginContext
description: Type helper for inferring Node .lia plugin input and Liatir bridge types.
---

# PluginContext

`PluginContext<typeof liatirPlugin>` is the recommended TypeScript helper for
typing the `.main(...)` handler.

It gives you:

- `input`, inferred from `definePlugin({ inputs })`;
- `Liatir`, the Node plugin bridge to the running Liatir app.

## Example

```ts
import { definePlugin, field, type PluginContext } from "@liatir/api";

const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({ label: "Text", required: true }),
  },
  outputs: {
    length: field.number({ label: "Length", format: "integer" }),
  },
});

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {
  await Liatir.deps.check("node");

  return {
    length: input.text.length,
  };
});
```

## Related types

`@liatir/api` also exports:

```ts
type PluginInput<S>
type PluginOutput<S>
type PluginContext<TContract>
```

Most plugins only need `PluginContext<typeof liatirPlugin>`.

## Notes

The type is erased at runtime. Runtime validation happens in `liatir build` and
`liatir dev`, which inspect the exported plugin shape after bundling.
