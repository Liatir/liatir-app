---
title: Root API
description: Root-level fields and methods exposed by the Liatir SDK.
---

# Root API

The root API contains runtime availability, bridge readiness, and a few
cross-cutting helpers.

Most plugin code should prefer specific namespaces such as `desktop`, `jobs`,
`deps`, or `qc`. Use root-level helpers for availability checks and advanced
integration points.

## Members

| Member | Type | Description |
| --- | --- | --- |
| `isAvailable` | `boolean` | Whether the Liatir bridge is available. |
| `apiVersion` | `string` | Bridge API version. |
| `ready` | `Promise<true>` | Resolves when the bridge is ready. |
| `isDesktop` | `boolean` | Whether the current runtime is desktop Liatir. |
| `onReady(callback)` | `(callback: Function) => void` | Runs a callback when the bridge is ready. |
| `openBrowser(url)` | `(url: string) => Promise<void>` | Opens a URL in the external browser. |
| `invoke(cmd, payload)` | generic promise | Low-level command invocation. |

## Example

```ts
import { Liatir, isLiatirAvailable } from 'liatir';

if (!isLiatirAvailable()) {
  throw new Error('This feature must run inside Liatir.');
}

await Liatir.ready;
```

## Notes

Use [openBrowser](/plugins/api/root/open-browser) for external links and
[invoke](/plugins/api/root/invoke) only when a typed namespace does not expose
the feature you need.

