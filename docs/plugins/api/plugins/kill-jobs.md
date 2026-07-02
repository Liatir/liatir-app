---
title: plugins.killJobs
description: Stops running low-level plugin jobs.
---

# plugins.killJobs

`Liatir.plugins.killJobs()` stops running jobs owned by the low-level plugin
runtime.

## Signature

```ts
killJobs(): Promise<boolean>
```

## Example

```ts
await Liatir.plugins.killJobs();
```

## Notes

Use this method only when the user has asked to stop running plugin work.

