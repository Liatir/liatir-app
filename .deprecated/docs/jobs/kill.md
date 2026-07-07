---
title: jobs.kill
description: Stops a running async process job.
---

# jobs.kill

`Liatir.jobs.kill()` stops a running async process job.

## Signature

```ts
kill(jobId: string): Promise<boolean>
```

## Example

```ts
await Liatir.jobs.kill(jobId);
```

## Notes

Only stop jobs in response to an explicit user action.

