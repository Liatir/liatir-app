---
title: API Utilities
description: Root-level utility fields and methods exposed by the Liatir API.
---

# API Utilities

The root API contains various utilities such as runtime availability check, bridge readiness, and a few
cross-cutting helpers.

## Methods

| Methods | Type | Description |
| --- | --- | --- |
| `isAvailable` | `boolean` | Whether the Liatir bridge is available. |
| `apiVersion` | `string` | Bridge API version. |
| `ready` | `Promise<true>` | Resolves when the bridge is ready. |
| `isDesktop` | `boolean` | Whether the current runtime is a desktop app (not a browser). |
| `onReady(callback)` | `(callback: Function) => void` | Runs a callback when the bridge is ready. |
| `openBrowser(url)` | `(url: string) => Promise<void>` | Opens a URL in the external browser. |

## Example

```ts
import { Liatir, isLiatirAvailable } from 'liatir';

if (!isLiatirAvailable()) {
  throw new Error('Liatir instance unavailable.');
}

await Liatir.ready;

// Other logic...
```

