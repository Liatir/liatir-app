---
title: Invoke
description: Low-level command invocation for advanced API usage.
---

# `.invoke`

`Liatir.invoke()` calls a low-level bridge command directly.

Use it only when:

- the API has no typed wrapper for what you need;
- you know the command name and payload contract;
- you can handle app-version changes.

Prefer typed namespaces for public plugin code.

## Signature

<Tabs>
<Tab title="Node">

```ts
invoke<T = unknown>(cmd: string, payload?: Record<string, unknown>): Promise<T>
```

</Tab>
<Tab title="Python">

```python
invoke(cmd, payload=None) -> any
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const result = await Liatir.invoke('some_command', {
  some_input: 42
});

console.log('Result:', result);
```

</Tab>
<Tab title="Python">

```python
result = ctx.liatir.invoke('some_command', {
    'some_input': 42
})

print('Result:', result)
```

</Tab>
</Tabs>

## Notes

Typed namespaces are more stable and easier to understand and should be preferred. Treat `invoke()` as
an **escape hatch for advanced integrations**.
