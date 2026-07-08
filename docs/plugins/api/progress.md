---
title: Progress
description: Progress tracking for plugins — display real-time progress in the Jobs UI.
---

# .progress

`Liatir.progress` provides progress tracking for long-running plugin jobs. Progress updates are streamed in real time to the Liatir Jobs UI, where users see a progress bar with the current step label and percentage.

## Methods

| Method | Node | Python | Description |
|--------|------|--------|-------------|
| `.start()` | `progress.start(total, label?)` | `progress.start(total, label=None)` | Initialize progress with a total count |
| `.advance()` | `progress.advance(n?, label?)` | `progress.advance(n=1, label=None)` | Increment progress by `n` units |
| `.update()` | `progress.update(current, label?)` | `progress.update(current, label=None)` | Set progress to an absolute value |
| `.done()` | `progress.done()` | `progress.done()` | Mark progress as complete |

### Parameters

| Parameter | Node (camelCase) | Python (snake_case) | Type | Description |
|-----------|------------------|---------------------|------|-------------|
| total | `total` | `total` | `number` | Total number of units (e.g., files, reads, steps) |
| current | `current` | `current` | `number` | Absolute progress value |
| n | `n` | `n` | `number` | Increment to add (default: 1) |
| label | `label` | `label` | `string` | Human-readable label for the current step |

::: tip
JSON response fields are always camelCase in both Node and Python.
:::

## Examples

### Basic progress tracking

<Tabs>
<Tab title="Node">

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
</Tabs>

## Progress states

| State | UI Display | Description |
|-------|------------|-------------|
| Indeterminate | Spinning bar | Before `.start()` is called or when total is unknown |
| Determinate | Percentage bar | After `.start(total)` — shows `current / total` |
| Complete | Checkmark | After `.done()` is called |

## Notes

- Progress updates are emitted as Tauri events (`jobs:progress:{jobId}`) and displayed in real time in the Jobs UI.
- Call `.start()` to initialize progress with a known total. If you don't know the total upfront, the progress bar shows an indeterminate spinner.
- Use `.advance(n)` for incremental updates (most common) or `.update(current)` for absolute jumps.
- Always call `.done()` when the job completes — this signals the UI to show a completion state.
- You can call `.start()` multiple times to reset progress for different phases of a multi-step pipeline.
- Progress state is stored in the job registry and can be queried via `jobs.status()`.