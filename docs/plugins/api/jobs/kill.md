---
title: jobs.kill
description: Stops a running async process job.
---

# `.jobs.kill`

`Liatir.jobs.kill()` stops a running async process job.

## Signature

<Tabs>
<Tab title="Node">

```ts
kill(jobId: string): Promise<boolean>
```

</Tab>
<Tab title="Python">

```python
kill(job_id) -> bool
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
const killed = await Liatir.jobs.kill(jobId);

if (killed) {
  console.log('Job terminated successfully');
}
```

</Tab>
<Tab title="Python">

```python
killed = ctx.liatir.jobs.kill(job_id)

if killed:
    print('Job terminated successfully')
```

</Tab>
</Tabs>

## Return value

Returns `true` if the job was successfully killed, `false` otherwise.

## Notes

Use this method with caution.