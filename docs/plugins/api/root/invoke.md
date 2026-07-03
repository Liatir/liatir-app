---
title: invoke
description: Low-level command invocation for advanced API usage.
---

# invoke

`Liatir.invoke()` calls a low-level bridge command directly.

Use it only when:

- the API has no typed wrapper for what you need;
- you know the command name and payload contract;
- you can handle app-version changes.

Prefer typed namespaces for public plugin code.

## Signature

```ts
invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>
```

## Example

```ts
const result = await Liatir.invoke('some_command', {
  value: 42
});
```

## Notes

Typed namespaces are more stable and easier to understand. Treat `invoke()` as
an escape hatch for advanced integrations.

