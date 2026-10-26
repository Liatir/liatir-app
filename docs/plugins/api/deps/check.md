---
title: deps.check
description: Checks whether one command-line dependency is available.
---

# `.deps.check`

`Liatir.deps.check()` checks whether one command-line binary is available, preferring a verified bundled tool and then checking the host search
path (`PATH`).

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
<Tab title="R">

```r
check(binary)
```

</Tab>
<Tab title="Native (Rust)">

```rust
check(binary: &str) -> Result<Value>
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
<Tab title="R">

```r
samtools <- ctx$liatir$deps$check("samtools")
if (!isTRUE(samtools$available)) stop("Samtools is not available")
```

</Tab>
<Tab title="Native (Rust)">

```rust
let samtools = ctx.liatir.deps().check("samtools")?;
if samtools["available"].as_bool() != Some(true) {
    return Err("Samtools is not available".into());
}
```

</Tab>
</Tabs>

## DepCheckResult

| Field       | Type                        | Description                              |
|-------------|-----------------------------|------------------------------------------|
| `available` | `boolean` / `bool`          | `true` if the binary is available. |
| `binary`    | `string` / `str`            | The name of the binary that was checked. |
| `path`      | `string \| null` / `str \| None` | Full path to the binary, or `null`. |
| `source` | string | `bundled` or `path`: where the tool was resolved. |
| `version`   | `string \| null` / `str \| None` | Detected version string, or `null`. |

::: warning IMPORTANT
`DepCheckResult` fields are always camelCase in Node, Python, R and Native, because they
come from the JSON response of the Liatir bridge.
:::
