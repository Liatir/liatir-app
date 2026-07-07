---
title: jobs.list
description: Lists async process jobs tracked by Liatir.
---

# jobs.list

`Liatir.jobs.list()` lists async process jobs tracked by Liatir.

## Signature

```ts
list(): Promise<JobEntry[]>
```

## Example

```ts
const jobs = await Liatir.jobs.list();
```

