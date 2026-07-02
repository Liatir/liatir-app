---
title: jobs.clearDone
description: Clears completed jobs from the SDK job registry.
---

# jobs.clearDone

`Liatir.jobs.clearDone()` removes completed, failed, or killed jobs from the job
registry.

Running jobs are not removed.

## Signature

```ts
clearDone(): Promise<number>
```

## Example

```ts
const removed = await Liatir.jobs.clearDone();
```

