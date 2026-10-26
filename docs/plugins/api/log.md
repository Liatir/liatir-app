---
title: Log
description: Structured logging for plugins — stream log entries to the Jobs UI.
---

# `.log`

`Liatir.log` provides structured logging for plugins. Every log entry is tagged with the current job ID and streamed in real time to the Liatir Jobs UI, where users can inspect, filter, and export logs.

Logs are also appended to the job's stderr buffer, so they appear in `jobs.getOutput()` alongside process output.

## Methods

| Level | Node | Python | R | Native Rust |
| --- | --- | --- | --- | --- |
| Information | `log.info(message, meta?)` | `log.info(message, meta=None)` | `log$info(message, meta=NULL)` | `log().info(message, meta)?` |
| Warning | `log.warn(message, meta?)` | `log.warn(message, meta=None)` | `log$warn(message, meta=NULL)` | `log().warn(message, meta)?` |
| Error | `log.error(message, meta?)` | `log.error(message, meta=None)` | `log$error(message, meta=NULL)` | `log().error(message, meta)?` |
| Debug | `log.debug(message, meta?)` | `log.debug(message, meta=None)` | `log$debug(message, meta=NULL)` | `log().debug(message, meta)?` |

R uses `ctx$liatir$log$info(message, meta = NULL)` (and the same signature
for `warn`, `error`, `debug`). Native Rust uses
`ctx.liatir.log().info(message: &str, meta: Value) -> Result<Value>`;
metadata is mandatory there, so pass `json!({})` or `json!(null)` when unused.
Logging an error records a message; propagate an error or stop execution separately
when the Plugin must fail.

### Parameters

| Parameter | Description |
| --- | --- |
| `message` | Human-readable text; a string in every SDK. |
| `meta` | Structured JSON metadata: a Node object, Python dict, R named list or Native `serde_json::Value`. |

## Examples

### Basic logging

<Tabs>
<Tab title="Node">

```ts
await Liatir.log.info('Starting alignment pipeline');
await Liatir.log.debug('Reference genome loaded', { path: '/data/ref.fa', size: 3_200_000 });
await Liatir.log.warn('Low coverage detected in chr7', { coverage: 2.1 });
await Liatir.log.error('Alignment failed', { exitCode: 1, tool: 'bwa' });
```

</Tab>
<Tab title="Python">

```python
ctx.liatir.log.info('Starting alignment pipeline')
ctx.liatir.log.debug('Reference genome loaded', {
    'path': '/data/ref.fa',
    'size': 3_200_000
})
ctx.liatir.log.warn('Low coverage detected in chr7', {'coverage': 2.1})
ctx.liatir.log.error('Alignment failed', {'exit_code': 1, 'tool': 'bwa'})
```

</Tab>
<Tab title="R">

```r
ctx$liatir$log$info("Starting analysis")
ctx$liatir$log$debug("Reference loaded", list(path = "ref.fa", size = 3200000))
ctx$liatir$log$warn("Low coverage", list(coverage = 2.1))
ctx$liatir$log$error("Alignment failed", list(exitCode = 1, tool = "bwa"))
```

</Tab>
<Tab title="Native (Rust)">

```rust
ctx.liatir.log().info("Starting analysis", json!({}))?;
ctx.liatir.log().debug("Reference loaded", json!({ "path": "ref.fa" }))?;
ctx.liatir.log().warn("Low coverage", json!({ "coverage": 2.1 }))?;
ctx.liatir.log().error("Alignment failed", json!({ "exitCode": 1 }))?;
```

</Tab>
</Tabs>

### Logging inside a long-running job

<Tabs>
<Tab title="Node">

```ts
const files = await Liatir.desktop.fs.data.listContent('input');

for (const file of files) {
  await Liatir.log.info(`Processing ${file.name}`);
  // ... process file ...
}

await Liatir.log.info('All files processed', { count: files.length });
```

</Tab>
<Tab title="Python">

```python
files = ctx.liatir.desktop.fs.data.list_content('input')

for f in files:
    ctx.liatir.log.info(f'Processing {f["name"]}')
    # ... process file ...

ctx.liatir.log.info('All files processed', {'count': len(files)})
```

</Tab>
<Tab title="R">

```r
files <- ctx$liatir$desktop$fs$data$list_content("input")
for (file in files) {
  ctx$liatir$log$info(paste("Processing", file$name))
  # Process the file here.
}
ctx$liatir$log$info("All files processed", list(count = length(files)))
```

</Tab>
<Tab title="Native (Rust)">

```rust
let files = ctx.liatir.desktop().fs().data().list_content("input")?;
let files = files.as_array().ok_or("Invalid file list")?;
for file in files {
    let name = file["name"].as_str().ok_or("Missing file name")?;
    ctx.liatir.log().info(&format!("Processing {name}"), json!({}))?;
    // Process the file here.
}
ctx.liatir.log().info("All files processed", json!({ "count": files.len() }))?;
```

</Tab>
</Tabs>

## Log levels

| Level | Color in UI | Use case |
|-------|-------------|----------|
| `info` | Blue | Normal operational messages |
| `warn` | Yellow | Non-fatal issues the user should be aware of |
| `error` | Red | Failures that prevented an operation from completing |
| `debug` | Gray | Verbose diagnostic output for development |

## Notes
---
::: warning IMPORTANT
JSON response fields are always camelCase in Node, Python, R and Native.
:::

- Log entries are emitted as Tauri events (`jobs:log:{jobId}`) and displayed in real time in the Jobs UI.
- Each entry includes a timestamp (Unix epoch milliseconds) added by the backend.
- The `meta` field accepts any JSON-serializable object — use it to attach structured context (file paths, counts, error codes) that the UI or downstream tools can parse.
- Logs are persisted in the job's stderr buffer and can be retrieved via `jobs.getOutput()`.
