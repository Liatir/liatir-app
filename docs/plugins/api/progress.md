---
title: Progress
description: Progress tracking for plugins — display real-time progress in the Jobs UI.
---

# `.progress`

`Liatir.progress` provides progress tracking for long-running plugin jobs. Progress updates are streamed in real time to the Liatir Jobs UI, where users see a progress bar with the current step label and percentage.

## Methods

<Tabs>
<Tab title="Node">

| Method |  Description |
|------|-------------|
| `.start(total, label?)` | Initialize progress with a total count |
| `.advance(n?, label?)` | Increment progress by `n` units |
| `.update(current, label?)` | Set progress to an absolute value |
| `.done()` | Mark progress as complete |

</Tab>
<Tab title="Python">

| Method | Description |
|--------|-------------|
| `.start(total, label=None)` | Initialize progress with a total count |
| `.advance(n=1, label=None)` | Increment progress by `n` units |
| `.update(current, label=None)` | Set progress to an absolute value |
| `.done()` | Mark progress as complete |

</Tab>
<Tab title="R">

| Method | Description |
| --- | --- |
| `$start(total, label = NULL)` | Initialize progress. |
| `$advance(n = 1, label = NULL)` | Increment progress. |
| `$update(current, label = NULL)` | Set an absolute value. |
| `$done()` | Mark progress complete. |

Call these on `ctx$liatir$progress`.

</Tab>
<Tab title="Native/WASM">

::: info
Liatir provides managed Rust and C++ libraries for Native/WASM Plugins.
This app bridge is Native-only; WASM stays isolated.
:::

<Tabs>
<Tab title="Rust">

| Method | Description |
| --- | --- |
| `.start(total: u64, label: Option<&str>)` | Initialize progress. |
| `.advance(delta: u64, label: Option<&str>)` | Increment progress; pass the increment explicitly. |
| `.update(current: u64, label: Option<&str>)` | Set an absolute value. |
| `.done()` | Mark progress complete. |

Call these on `ctx.liatir.progress()`. Each returns `Result<Value>`;
use `None` for no label and `?` to propagate failure.

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
    {"current", 0}, {"total", 100}, {"label", "Processing files"}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"delta", 1}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"current", 50}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"done", true}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

### Parameters


| Parameter | Type | Description |
|-----------|------|-------------|
| total  | `number` | Total number of units (e.g., files, reads, steps) |
| current  | `number` | Absolute progress value |
| n | `number` | Increment to add (default: 1) |
| label | `string` | Human-readable label for the current step |

<br>


## Examples

### Basic progress tracking

<Tabs>
<Tab title="Node">

**File listing progress tracking**

```ts
const files = await Liatir.desktop.fs.data.listContent('input');

await Liatir.progress.start(files.length, 'Processing files');

for (const file of files) {
  await Liatir.progress.advance(1, `Processing ${file.name}`);
  // ... process file ...
}

await Liatir.progress.done();
```

</Tab>
<Tab title="Python">

```python
files = ctx.liatir.desktop.fs.data.list_content('input')

ctx.liatir.progress.start(len(files), 'Processing files')

for f in files:
    ctx.liatir.progress.advance(1, f'Processing {f["name"]}')
    # ... process file ...

ctx.liatir.progress.done()
```

</Tab>
<Tab title="R">

```r
files <- ctx$liatir$desktop$fs$data$list_content("input")
ctx$liatir$progress$start(length(files), "Processing files")
for (file in files) {
  ctx$liatir$progress$advance(1, paste("Processing", file$name))
  # Process the file here.
}
ctx$liatir$progress$done()
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
let files = ctx.liatir.desktop().fs().data().list_content("input")?;
let files = files.as_array().ok_or("Invalid file list")?;
ctx.liatir.progress().start(files.len() as u64, Some("Processing files"))?;
for file in files {
    let name = file["name"].as_str().ok_or("Missing file name")?;
    ctx.liatir.progress().advance(1, Some(&format!("Processing {name}")))?;
    // Process the file here.
}
ctx.liatir.progress().done()?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
auto files = liatir::invoke("lia_fs_list_dir", {{"rel", "input"}, {"permanent", true}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
    {"current", 0}, {"total", files.size()}, {"label", "Processing files"}});
for (const auto& file : files) {
    // Process the file here.
    liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"delta", 1},
        {"label", "Processing " + file.at("name").get<std::string>()}});
}
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"done", true}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

### Multi-phase pipeline

<Tabs>
<Tab title="Node">

```ts
// Phase 1: Quality control
await Liatir.progress.start(100, 'Running quality control');
for (let i = 0; i < 100; i++) {
  await Liatir.progress.advance(1, `QC read ${i + 1}/100`);
  // ... QC logic ...
}

// Phase 2: Alignment
await Liatir.progress.start(50, 'Aligning reads');
for (let i = 0; i < 50; i++) {
  await Liatir.progress.advance(1, `Aligning chunk ${i + 1}/50`);
  // ... alignment logic ...
}

await Liatir.progress.done();
```

</Tab>
<Tab title="Python">

```python
# Phase 1: Quality control
ctx.liatir.progress.start(100, 'Running quality control')
for i in range(100):
    ctx.liatir.progress.advance(1, f'QC read {i + 1}/100')
    # ... QC logic ...

# Phase 2: Alignment
ctx.liatir.progress.start(50, 'Aligning reads')
for i in range(50):
    ctx.liatir.progress.advance(1, f'Aligning chunk {i + 1}/50')
    # ... alignment logic ...

ctx.liatir.progress.done()
```

</Tab>
<Tab title="R">

```r
ctx$liatir$progress$start(100, "Quality control")
for (i in seq_len(100)) {
  # Run this quality-control step.
  ctx$liatir$progress$advance(1)
}
ctx$liatir$progress$start(50, "Aligning reads")
for (i in seq_len(50)) {
  # Align this chunk.
  ctx$liatir$progress$advance(1)
}
ctx$liatir$progress$done()
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
for (total, label) in [(100_u64, "Quality control"), (50, "Aligning reads")] {
    ctx.liatir.progress().start(total, Some(label))?;
    for _ in 0..total {
        // Run this analysis step.
        ctx.liatir.progress().advance(1, None)?;
    }
}
ctx.liatir.progress().done()?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
for (const auto& phase : {std::pair<int, std::string>{100, "Quality control"}, {50, "Aligning reads"}}) {
    liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
        {"current", 0}, {"total", phase.first}, {"label", phase.second}});
    for (int i = 0; i < phase.first; ++i) {
        // Run this analysis step.
        liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"delta", 1}});
    }
}
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"done", true}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

### Using absolute updates

<Tabs>
<Tab title="Node">

```ts
await Liatir.progress.start(1000, 'Processing reads');

// Jump to specific progress points
await Liatir.progress.update(250, '25% complete');
await Liatir.progress.update(500, '50% complete');
await Liatir.progress.update(750, '75% complete');
await Liatir.progress.update(1000, '100% complete');

await Liatir.progress.done();
```

</Tab>
<Tab title="Python">

```python
ctx.liatir.progress.start(1000, 'Processing reads')

# Jump to specific progress points
ctx.liatir.progress.update(250, '25% complete')
ctx.liatir.progress.update(500, '50% complete')
ctx.liatir.progress.update(750, '75% complete')
ctx.liatir.progress.update(1000, '100% complete')

ctx.liatir.progress.done()
```

</Tab>
<Tab title="R">

```r
ctx$liatir$progress$start(1000, "Processing reads")
ctx$liatir$progress$update(250, "25% complete")
ctx$liatir$progress$update(1000, "100% complete")
ctx$liatir$progress$done()
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
ctx.liatir.progress().start(1000, Some("Processing reads"))?;
ctx.liatir.progress().update(250, Some("25% complete"))?;
ctx.liatir.progress().update(1000, Some("100% complete"))?;
ctx.liatir.progress().done()?;
```

</Tab>
<Tab title="C++">

[C++ example setup](/plugins/api-bridge#cpp-examples).

```cpp
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
    {"current", 0}, {"total", 1000}, {"label", "Processing reads"}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
    {"current", 250}, {"label", "25% complete"}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()},
    {"current", 1000}, {"label", "100% complete"}});
liatir::invoke("lia_plugin_progress", {{"jobId", liatir::job_id()}, {"done", true}});
```

</Tab>
</Tabs>
</Tab>
</Tabs>

## Progress states

| State | UI Display | Description |
|-------|------------|-------------|
| Indeterminate | Spinning bar | Before `.start()` is called or when total is unknown |
| Determinate | Percentage bar | After `.start(total)` — shows `current / total` |
| Complete | Checkmark | After `.done()` is called |

## Notes
---
::: warning IMPORTANT
JSON response fields are always camelCase in Node, Python, R and Native.
:::
- Progress updates are emitted as Tauri events (`jobs:progress:{jobId}`) and displayed in real time in the Jobs UI.
- Call `.start()` to initialize progress with a known total. If you don't know the total upfront, the progress bar shows an indeterminate spinner.
- Use `.advance(n)` for incremental updates (most common) or `.update(current)` for absolute jumps.
- Always call `.done()` when the job completes — this signals the UI to show a completion state.
- You can call `.start()` multiple times to reset progress for different phases of a multi-step pipeline.
- Progress state is stored in the job registry and can be queried via `jobs.status()`.
