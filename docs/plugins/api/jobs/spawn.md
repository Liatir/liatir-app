---
title: jobs.spawn
description: Starts an async native process from the Liatir API.
---

# .jobs.spawn

`Liatir.jobs.spawn()` starts an async native process and returns immediately
with a job ID.

## Signature

<Tabs>
<Tab title="Node">

```ts
spawn(cmd: string, args: string[], opts?: SpawnOptions): Promise<{ jobId: string }>
```

</Tab>
<Tab title="Python">

```python
spawn(cmd, args=None, cwd=None, env=None, label=None, kind=None, metadata=None) -> dict
```

</Tab>
</Tabs>

## SpawnOptions

<Tabs>
<Tab title="Node">

| Option     | Type                          | Description                              |
|------------|-------------------------------|------------------------------------------|
| `cwd`      | `string`                      | Working directory for the process.       |
| `env`      | `Record<string, string>`      | Extra environment variables.             |
| `label`    | `string`                      | Human-readable label for the job.        |
| `kind`     | `string`                      | Job kind tag (e.g. `'diagnostic'`).      |
| `metadata` | `Record<string, unknown>`     | Arbitrary metadata attached to the job.  |

</Tab>
<Tab title="Python">

| Option     | Type      | Description                              |
|------------|-----------|------------------------------------------|
| `cwd`      | `str`     | Working directory for the process.       |
| `env`      | `dict`    | Extra environment variables.             |
| `label`    | `str`     | Human-readable label for the job.        |
| `kind`     | `str`     | Job kind tag (e.g. `'diagnostic'`).      |
| `metadata` | `dict`    | Arbitrary metadata attached to the job.  |

</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const { jobId } = await Liatir.jobs.spawn('samtools', ['--version'], {
  label: 'Check Samtools version',
  kind: 'diagnostic'
});

console.log('Started job:', jobId);
```

</Tab>
<Tab title="Python">

```python
result = ctx.liatir.jobs.spawn('samtools', ['--version'],
    label='Check Samtools version',
    kind='diagnostic'
)
job_id = result['jobId']

print('Started job:', job_id)
```

</Tab>
</Tabs>

## Return value

| Field   | Type            | Description                    |
|---------|-----------------|--------------------------------|
| `jobId` | `string` / `str` | Unique identifier for the job. |

::: warning NOTE
Return value fields are always camelCase in both Node and Python, because they
come from the JSON response of the Liatir bridge.
:::