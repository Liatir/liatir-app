---
title: .jobs.status
description: Reads one async process job status.
---

# .jobs.status

`Liatir.jobs.status()` reads the current state of one async process job.

## Signature

<Tabs>
<Tab title="Node">

```ts
status(jobId: string): Promise<JobEntry>
```

</Tab>
<Tab title="Python">

```python
status(job_id) -> dict
```

</Tab>
</Tabs>

## Parameters

<Tabs>
<Tab title="Node">

| Parameter | Type     | Description                    |
|-----------|----------|--------------------------------|
| `jobId`   | `string` | Unique identifier for the job. |

</Tab>
<Tab title="Python">

| Parameter | Type  | Description                    |
|-----------|-------|--------------------------------|
| `job_id`  | `str` | Unique identifier for the job. |

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const job = await Liatir.jobs.status(jobId);

console.log('Status:', job.status.type);
console.log('Exit code:', job.status.exitCode);
```

</Tab>
<Tab title="Python">

```python
job = ctx.liatir.jobs.status(job_id)

print('Status:', job['status']['type'])
print('Exit code:', job['status'].get('exitCode'))
```

</Tab>
</Tabs>

## Return value

Returns a `JobEntry` object. See [`.jobs.list`](./list.md#jobentry) for the full structure.

## Job states

A job can be `running`, `done`, `failed`, or `killed`.