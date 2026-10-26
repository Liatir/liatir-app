---
title: jobs.clearDone
description: Clears completed jobs from the job registry.
---

# `.jobs.clearDone`

`Liatir.jobs.clearDone()` removes completed, failed, or killed jobs from the job
registry.

Running jobs are not removed.

## Signature

<Tabs>
<Tab title="Node">

```ts
clearDone(): Promise<number>
```

</Tab>
<Tab title="Python">

```python
clear_done() -> int
```

</Tab>
<Tab title="R">

```r
clear_done()
```

</Tab>
<Tab title="Native (Rust)">

```rust
clear_done() -> Result<Value>
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const removed = await Liatir.jobs.clearDone();

console.log(`Removed ${removed} completed jobs`);
```

</Tab>
<Tab title="Python">

```python
removed = ctx.liatir.jobs.clear_done()

print(f'Removed {removed} completed jobs')
```

</Tab>
<Tab title="R">

```r
removed <- ctx$liatir$jobs$clear_done()
cat("Removed", removed, "completed Jobs\n")
```

</Tab>
<Tab title="Native (Rust)">

```rust
let removed = ctx.liatir.jobs().clear_done()?;
println!("Removed {removed} completed Jobs");
```

</Tab>
</Tabs>

## Return value

| Type          | Description                              |
|---------------|------------------------------------------|
| `number` / `int` | Number of jobs removed from the registry. |

During `liatir dev`, this helper returns zero and leaves the global registry
unchanged. Session cleanup belongs to the Dev Runner lifecycle.
