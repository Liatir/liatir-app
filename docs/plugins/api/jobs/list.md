---
title: jobs.list
description: Lists async process jobs tracked by Liatir.
---

# .jobs.list

`Liatir.jobs.list()` lists async process jobs tracked by Liatir.

## Signature

<Tabs>
<Tab title="Node">

```ts
list(): Promise<JobEntry[]>
```

</Tab>
<Tab title="Python">

```python
list() -> list[dict]
```

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const jobs = await Liatir.jobs.list();

jobs.forEach(job => {
  console.log(`${job.jobId}: ${job.status.type}`);
});
```

</Tab>
<Tab title="Python">

```python
jobs = ctx.liatir.jobs.list()

for job in jobs:
    print(f"{job['jobId']}: {job['status']['type']}")
```

</Tab>
</Tabs>

## JobEntry

| Field        | Type            | Description                              |
|--------------|-----------------|------------------------------------------|
| `jobId`      | `string` / `str` | Unique identifier for the job.          |
| `cmd`        | `string` / `str` | Command that was executed.              |
| `args`       | `string[]` / `list[str]` | Arguments passed to the command. |
| `status`     | `object` / `dict` | Current job status (see below).        |
| `label`      | `string \| null` / `str \| None` | Human-readable label.    |
| `kind`       | `string \| null` / `str \| None` | Job kind tag.            |
| `metadata`   | `object` / `dict` | Arbitrary metadata attached to the job. |
| `createdAt`  | `number` / `int`  | Timestamp when the job was created.     |

::: warning NOTE
`JobEntry` fields are always camelCase in both Node and Python, because they
come from the JSON response of the Liatir bridge.
:::