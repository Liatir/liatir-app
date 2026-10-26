---
title: jobs.spawn
description: Starts an async native process from the Liatir API.
---

# `.jobs.spawn`

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
<Tab title="R">

```r
spawn(cmd, args = list(), cwd = NULL, env = NULL, label = NULL, kind = NULL, metadata = NULL)
```

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
spawn(cmd: &str, args: &[&str], options: Value) -> Result<Value>
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto started = liatir::invoke("lia_jobs_spawn",
    {{"cmd", "samtools"}, {"args", {"--version"}}, {"label", "Check Samtools version"}});
```

</Tab>
</Tabs>
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
<Tab title="R">

Pass `cwd`, `env`, `label`, `kind` and `metadata` as named arguments.
Use a named list for environment variables and metadata.

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

Pass the same option names in a JSON object, or `json!({})` for defaults.

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

Pass `cwd`, `env`, `label`, `kind` and `metadata` in the JSON payload:

```cpp
json options = {{"cmd", "samtools"}, {"args", {"--version"}},
    {"label", "Check Samtools version"}, {"kind", "diagnostic"}};
auto started = liatir::invoke("lia_jobs_spawn", options);
```

</Tab>
</Tabs>
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
<Tab title="R">

```r
started <- ctx$liatir$jobs$spawn("samtools", c("--version"),
  label = "Check Samtools version", kind = "diagnostic")
job_id <- started$jobId
```

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
let started = ctx.liatir.jobs().spawn("samtools", &["--version"],
    json!({ "label": "Check Samtools version", "kind": "diagnostic" }))?;
let job_id = started["jobId"].as_str().ok_or("Missing jobId")?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto started = liatir::invoke("lia_jobs_spawn",
    {{"cmd", "samtools"}, {"args", {"--version"}},
     {"label", "Check Samtools version"}, {"kind", "diagnostic"}});
auto id = started.at("jobId").get<std::string>();
std::cout << "Started Job: " << id << "\n";
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Return value

| Field   | Type            | Description                    |
|---------|-----------------|--------------------------------|
| `jobId` | `string` / `str` | Unique identifier for the job. |

::: warning IMPORTANT
Return value fields are always camelCase in Node, Python, R and Native, because they
come from the JSON response of the Liatir bridge.
:::

## Wait for completion and read output

`run` starts a Job and waits for a terminal state while delivering stdout/stderr
lines to callbacks. A terminal state can be failure or cancellation: inspect
`status.type` and `status.exitCode` before returning a successful Plugin result.

<Tabs>
<Tab title="R">

```r
job <- ctx$liatir$jobs$run("samtools", c("--version"),
  on_stdout = function(line) cat(line, "\n"),
  on_stderr = function(line) message(line))
if (!identical(job$status$type, "done")) stop("Samtools did not finish successfully")
output <- ctx$liatir$jobs$get_output(job$id)
```

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

```rust
let job = ctx.liatir.jobs().run("samtools", &["--version"], json!({}),
    |line| println!("{line}"), |line| eprintln!("{line}"))?;
if job["status"]["type"] != "done" {
    return Err("Samtools did not finish successfully".into());
}
let id = job["id"].as_str().ok_or("Missing job id")?;
let output = ctx.liatir.jobs().get_output(id, None)?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto job = liatir::run("samtools", {"--version"}, json::object(),
    [](const std::string& line) { std::cout << line << "\n"; },
    [](const std::string& line) { std::cerr << line << "\n"; });
if (job.at("status").at("type") != "done")
    throw std::runtime_error("Samtools did not finish successfully");
auto output = liatir::invoke("lia_jobs_get_output", {{"jobId", job.at("id")}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

R `run(cmd, args = list(), cwd = NULL, on_stdout = NULL, on_stderr = NULL)`
returns a terminal Job as a named list. Native Rust
`run(cmd, args, options, on_stdout, on_stderr)` returns a JSON Job value.
The callbacks receive individual lines. Use `spawn` when you need to return
immediately or pass R environment/label/metadata options.

`get_output(job_id, since = NULL)` in R and
`get_output(job_id, since: Option<usize>)` in Rust return buffered `stdout` and
`stderr` arrays plus `stdoutTotal` and `stderrTotal`. The existing Node and Python
names are `getOutput` and `get_output`, respectively.

For Native Rust's `Result<Value>` convention and imports, see
[the bridge reference](/plugins/api-bridge#language-conventions).
Development child Jobs are associated with their session and workspace.
