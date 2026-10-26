---
title: jobs.status
description: Reads one async process job status.
---

# `.jobs.status`

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
<Tab title="R">

```r
status(job_id)
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
status(job_id: &str) -> Result<Value>
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto job = liatir::invoke("lia_jobs_status", {{"jobId", job_id}});
```

</Tab>
</Tabs>
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
<Tab title="R">

```r
job <- ctx$liatir$jobs$status(job_id)
cat("Status:", job$status$type, "\n")
print(job$status$exitCode)
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
let job = ctx.liatir.jobs().status(job_id)?;
println!("Status: {}", job["status"]["type"]);
println!("Exit code: {}", job["status"]["exitCode"]);
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto job = liatir::invoke("lia_jobs_status", {{"jobId", job_id}});
std::cout << "Status: " << job.at("status").at("type") << "\n";
std::cout << "Exit code: " << job.at("status").value("exitCode", json(nullptr)) << "\n";
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Return value

Returns a `JobEntry` object. See [`.jobs.list`](./list.md#jobentry) for the full structure.

## Job states

A job can be `running`, `done`, `failed`, or `killed`.
