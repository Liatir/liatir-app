---
title: deps.check
description: Checks whether one command-line dependency is available.
---

# `.deps.check`

`Liatir.deps.check()` checks whether one command-line binary is available in
`PATH`.

## Signature

<Tabs>
<Tab title="Node">

```ts
check(binary: string): Promise<DepCheckResult>
```

</Tab>
<Tab title="Python">

```python
check(binary) -> dict
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const samtools = await Liatir.deps.check('samtools');

if (!samtools.available) {
  console.warn('Samtools is not available.');
}
```

</Tab>
<Tab title="Python">

```python
samtools = ctx.liatir.deps.check('samtools')

if not samtools['available']:
    print('Samtools is not available.')
```

</Tab>
</Tabs>

## DepCheckResult

| Field       | Type                        | Description                              |
|-------------|-----------------------------|------------------------------------------|
| `available` | `boolean` / `bool`          | `true` if the binary is found in `PATH`. |
| `binary`    | `string` / `str`            | The name of the binary that was checked. |
| `path`      | `string \| null` / `str \| None` | Full path to the binary, or `null`. |
| `version`   | `string \| null` / `str \| None` | Detected version string, or `null`. |

::: warning IMPORTANT
`DepCheckResult` fields are always camelCase in both Node and Python, because they
come from the JSON response of the Liatir bridge.
:::