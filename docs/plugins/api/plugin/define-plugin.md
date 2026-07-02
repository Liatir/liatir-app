---
title: definePlugin
description: Defines the input/output contract and entry point for a Node .lia plugin.
---

# definePlugin

`definePlugin()` is the required entry point helper for Node `.lia` plugins.

It declares the plugin's inputs and outputs once, then `.main(...)` attaches the
implementation. `lia build` validates this shape and generates `manifest.json`
from the declared schema.

## Signature

```ts
definePlugin({
  inputs: Record<string, Field>,
  outputs: Record<string, Field>,
}).main(handler)
```

The default export must be the result of `.main(...)`.

## Minimal TypeScript plugin

```ts
import { definePlugin, field, type PluginContext } from "@liatir/sdk";

// Docs: https://liatir.com/docs/plugins
const liatirPlugin = definePlugin({
  inputs: {
    text: field.string({
      label: "Text",
      description: "Text to analyze.",
      required: true,
      default: "hello from Liatir",
    }),
  },
  outputs: {
    length: field.number({
      label: "Length",
      description: "Number of characters in the input text.",
      format: "integer",
    }),
  },
});

export default liatirPlugin.main(async ({ input, lia }: PluginContext<typeof liatirPlugin>) => {
  // Write your plugin logic here. Inputs and outputs are defined once above.

  return {
    length: input.text.length,
  };
});
```

## What `lia build` checks

`lia build` rejects Node plugins when:

- the default export is missing;
- the default export is only `definePlugin(...)` without `.main(...)`;
- `inputs` is not an object;
- `outputs` is not an object;
- an input field uses an unsupported input type;
- an output field uses an unsupported output type.

## Important rules

- Do not export `run(inputs)` directly.
- Do not maintain a separate Node `.lia-manifest.json`.
- Do not write internal result markers to stdout yourself.
- Return an object whose keys match the declared output keys.

## Related pages

- [field builders](/plugins/api/plugin/field)
- [PluginContext](/plugins/api/plugin/plugin-context)
- [lia Node bridge](/plugins/api/plugin/lia-context)
- [.lia Bundle Format](/plugins/format)
