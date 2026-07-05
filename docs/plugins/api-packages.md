# Liatir API packages

The Liatir API ships in two related packages:

- `@liatir/api` for Node `.lia` plugin authoring;
- `liatir` for browser/webview code that needs the `window.Liatir` bridge.

Most plugin authors use `@liatir/api` through projects created by
`liatir init`.

Python and WASM plugins use the same `define_plugin` contract API, but not as a
package: the CLI scaffolds a single managed module (`src/liatir.py` /
`src/liatir.rs`) into the project and `liatir build` keeps it in sync — there
is nothing to install or update separately.

![Liatir API surface map](/static/api-surface-map.svg)

## Node plugin authoring

Node `.lia` plugins import `definePlugin`, `field`, and optional helper types
from `@liatir/api`.

```ts
import { definePlugin, field, type PluginContext } from "@liatir/api";

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

export default liatirPlugin.main(async ({ input, Liatir }: PluginContext<typeof liatirPlugin>) => {
  return {
    length: input.text.length,
  };
});
```

The schema is declared once. TypeScript input and output types are inferred from
that schema, and `liatir build` generates the `.lia` manifest from it.

## Node plugin bridge

Inside `.main(...)`, the `Liatir` object is a Node bridge to the running Liatir app.
It is not the same type as `window.Liatir`, because a headless Node process does
not support GUI-only APIs.

Available areas include:

- `Liatir.jobs`
- `Liatir.deps`
- `Liatir.desktop.fs`
- `Liatir.desktop.files`
- `Liatir.desktop.events`
- `Liatir.desktop.app`
- `Liatir.desktop.network`
- `Liatir.desktop.clipboard`
- `Liatir.desktop.notifications`
- `Liatir.desktop.diagnostics`
- `Liatir.desktop.globalVariables`
- `Liatir.align`
- `Liatir.qc`
- `Liatir.variants`
- `Liatir.ai`
- `Liatir.sidecar`
- `Liatir.paths()`
- `Liatir.invoke`

## Browser/webview bridge

Code running inside Liatir's desktop webview can use the browser bridge:

```ts
import { Liatir, isLiatirAvailable } from "liatir";

if (isLiatirAvailable()) {
  await Liatir.desktop.files.open({ multi: false });
}
```

This package proxies the `window.Liatir` surface. It includes desktop/webview
APIs such as window controls, menus, shortcuts, and other UI-related areas
that are not available to headless Node plugin code.

## API reference

- [Plugin authoring API](/plugins/api/plugin/define-plugin)
- [field builders](/plugins/api/plugin/field)
- [PluginContext](/plugins/api/plugin/plugin-context)
- [Liatir Node bridge](/plugins/api/plugin/node-bridge)
- [Root browser API](/plugins/api/root/overview)
- [Desktop API](/plugins/api/desktop/app)
- [Pipeline API](/plugins/api/pipeline/run)
- [Jobs API](/plugins/api/jobs/spawn)
- [Dependencies API](/plugins/api/deps/check)
- [Bio: QC API](/plugins/api/qc/fastqc)
- [Bio: Alignment API](/plugins/api/align/bwa-mem)
- [Bio: Variants API](/plugins/api/variants/bcftools-stats)
