---
title: jobs.list
description: Lists async process jobs tracked by Liatir.
---

# `.jobs.list`

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
<Tab title="R">

```r
list()
```

</Tab>
<Tab title="Native/WASM">

::: info
Native/WASM Plugins can use any compatible language; Rust and C++ are examples.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
list() -> Result<Value>
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto jobs = liatir::invoke("lia_jobs_list");
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Example

<Tabs>
<Tab title="Node">

```ts
const jobs = await Liatir.jobs.list();

jobs.forEach(job => {
  console.log(`${job.id}: ${job.status.type}`);
});
```

</Tab>
<Tab title="Python">

```python
jobs = ctx.liatir.jobs.list()

for job in jobs:
    print(f"{job['id']}: {job['status']['type']}")
```

</Tab>
<Tab title="R">

```r
jobs <- ctx$liatir$jobs$list()
for (job in jobs) cat(job$id, job$status$type, "\n")
```

</Tab>
<Tab title="Native/WASM">

::: info
Native/WASM Plugins can use any compatible language; Rust and C++ are examples.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
let jobs = ctx.liatir.jobs().list()?;
for job in jobs.as_array().ok_or("Invalid Job list")? {
    println!("{}: {}", job["id"], job["status"]["type"]);
}
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto jobs = liatir::invoke("lia_jobs_list");
for (const auto& job : jobs)
    std::cout << job.at("id") << ": " << job.at("status").at("type") << "\n";
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## JobEntry

| Field        | Type            | Description                              |
|--------------|-----------------|------------------------------------------|
| `id`         | `string` / `str` | Unique identifier for the job.          |
| `cmd`        | `string` / `str` | Command that was executed.              |
| `args`       | `string[]` / `list[str]` | Arguments passed to the command. |
| `status`     | `object` / `dict` | Current job status (see below).        |
| `label`      | `string \| null` / `str \| None` | Human-readable label.    |
| `kind`       | `string \| null` / `str \| None` | Job kind tag.            |
| `metadata`   | `object` / `dict` | Metadata attached to the job, or null. |
| `startedAtMs` | number | Start time in Unix milliseconds. |
| `endedAtMs` | number or null | End time in Unix milliseconds. |
| `workspaceId` | string or null | Owning workspace. |
| `progress` | object or null | Current progress reported by the Plugin. |

::: warning IMPORTANT
`JobEntry` fields are always camelCase in Node, Python, R and Native, because they
come from the JSON response of the Liatir bridge.
:::

Spawn returns `{ jobId }`; list, status and run return Job entries with `id`.
During `liatir dev`, listing is restricted to the current session and workspace.
R returns a list of named lists; Native Rust returns a JSON array.
