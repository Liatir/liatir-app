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
</Tabs>

## Return value

| Type          | Description                              |
|---------------|------------------------------------------|
| `number` / `int` | Number of jobs removed from the registry. |