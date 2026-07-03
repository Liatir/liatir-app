---
title: jobs.spawn
description: Starts an async native process from the Liatir API.
---

# jobs.spawn

`Liatir.jobs.spawn()` starts an async native process and returns immediately
with a job ID.

## Signature

```ts
spawn(cmd: string, args: string[], opts?: SpawnOptions): Promise<{ jobId: string }>
```

## Options

```ts
type SpawnOptions = {
  cwd?: string;
  env?: Record<string, string>;
  label?: string;
  kind?: string;
  metadata?: Record<string, unknown>;
};
```

## Example

```ts
const { jobId } = await Liatir.jobs.spawn('samtools', ['--version'], {
  label: 'Check Samtools version',
  kind: 'diagnostic'
});
```

## Events

Subscribe to process output through `Liatir.desktop.events`:

- `jobs:stdout:<jobId>`
- `jobs:stderr:<jobId>`
- `jobs:exit:<jobId>`

