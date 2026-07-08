---
title: Log
description: Structured logging for plugins — stream log entries to the Jobs UI.
---

# `.log`

`Liatir.log` provides structured logging for plugins. Every log entry is tagged with the current job ID and streamed in real time to the Liatir Jobs UI, where users can inspect, filter, and export logs.

Logs are also appended to the job's stderr buffer, so they appear in `jobs.getOutput()` alongside process output.

## Methods

| Method | Node | Python | Description |
|--------|------|--------|-------------|
| `.info()` | `log.info(message, meta?)` | `log.info(message, meta=None)` | Informational message |
| `.warn()` | `log.warn(message, meta?)` | `log.warn(message, meta=None)` | Warning message |
| `.error()` | `log.error(message, meta?)` | `log.error(message, meta=None)` | Error message |
| `.debug()` | `log.debug(message, meta?)` | `log.debug(message, meta=None)` | Debug message |

### Parameters

| Parameter | Node (camelCase) | Python (snake_case) | Type | Description |
|-----------|------------------|---------------------|------|-------------|
| message | `message` | `message` | `string` | Human-readable log message |
| meta | `meta` | `meta` | `Record<string, unknown>` / `dict` | Optional structured metadata attached to the entry |


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
JSON response fields are always camelCase in both Node and Python.
:::

- Log entries are emitted as Tauri events (`jobs:log:{jobId}`) and displayed in real time in the Jobs UI.
- Each entry includes a timestamp (Unix epoch milliseconds) added by the backend.
- The `meta` field accepts any JSON-serializable object — use it to attach structured context (file paths, counts, error codes) that the UI or downstream tools can parse.
- Logs are persisted in the job's stderr buffer and can be retrieved via `jobs.getOutput()`.