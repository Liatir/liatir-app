---
title: jobs.status
description: Reads one async process job status.
---

# jobs.status

`Liatir.jobs.status()` reads the current state of one async process job.

## Signature

```ts
status(jobId: string): Promise<JobEntry>
```

## Example

```ts
const job = await Liatir.jobs.status(jobId);
```

## Job states

A job can be `running`, `done`, `failed`, or `killed`.

