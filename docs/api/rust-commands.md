# Rust Commands

All backend functionality is exposed through `lia_*` Tauri commands. Call them with `api.invoke(cmd, args)` from the frontend. Every command listed here must be declared in `src-tauri/permissions/liatir-bridge.toml` — the invoke handler registration alone is not sufficient.

## Filesystem

### lia_fs_paths

```typescript
api.invoke('lia_fs_paths') → { data: string; cache: string }
```

Returns the absolute paths to the app data directory and cache directory. Use `data` as the base for writing run records, module files, and tool output.

```typescript
const { data, cache } = await api.invoke('lia_fs_paths') as { data: string; cache: string }
// data  = "/Users/alice/Library/Application Support/com.liatir.app"
// cache = "/Users/alice/Library/Caches/com.liatir.app"
```

---

### lia_file_size

```typescript
api.invoke('lia_file_size', { path: string }) → number
```

Returns file size in bytes. Use to display human-readable file sizes and to populate `RunOutputFile.size`.

```typescript
const bytes = await api.invoke('lia_file_size', { path }) as number
const mb = (bytes / 1_048_576).toFixed(1)
```

---

### lia_read_file_text

```typescript
api.invoke('lia_read_file_text', { path: string }) → string
```

Reads a text file at an absolute path and returns its full content. Not suitable for binary or very large files — use `lia_preview_file` for large text files.

```typescript
const json = await api.invoke('lia_read_file_text', { path: jsonPath }) as string
const data = JSON.parse(json)
```

---

### lia_write_file_path

```typescript
api.invoke('lia_write_file_path', { path: string; content: string }) → void
```

Writes text content to an absolute path. Creates all parent directories if they do not exist.

---

### lia_preview_file

```typescript
api.invoke('lia_preview_file', { path: string; lines: number }) → string
```

Reads the first `lines` lines of a file using a `BufReader` — efficient for any file size. Returns early once `lines` newlines have been read rather than reading the entire file into memory.

```typescript
const preview = await api.invoke('lia_preview_file', { path, lines: 100 }) as string
```

Default lines per format used in the Data page:
- FASTQ: 40 (10 complete 4-line records)
- FASTA: 50
- VCF: 100
- SAM: 60
- BED / GTF: 50

---

### lia_fs_copy

```typescript
api.invoke('lia_fs_copy', { src: string; dest: string }) → void
```

Copies a file from `src` to `dest`. Used by the **Save as…** action in `ToolResultView`.

---

### lia_file_save

```typescript
api.invoke('lia_file_save', { defaultName?: string }) → string
```

Opens the native OS save dialog. Returns the path the user chose. Throws if the user cancels.

```typescript
const dest = await api.invoke('lia_file_save', { defaultName: 'trimmed_R1.fastq.gz' }) as string
await api.invoke('lia_fs_copy', { src: outputPath, dest })
```

---

## Job runner

Liatir spawns external processes as **jobs**. Each job gets an ID that you use to track and retrieve its output.

### lia_jobs_spawn

```typescript
api.invoke('lia_jobs_spawn', { cmd: string; args: string[]; cwd?: string }) → { jobId: string }
```

Spawns a process. Returns immediately with a job ID. The process runs in the background; stdout and stderr are buffered.

```typescript
const { jobId } = await api.invoke('lia_jobs_spawn', {
  cmd: 'fastp',
  args: ['--in1', r1, '--out1', out1, '--json', statsPath],
}) as { jobId: string }
```

---

### lia_jobs_status

```typescript
api.invoke('lia_jobs_status', { jobId: string }) → JobEntry
```

```typescript
interface JobEntry {
  jobId: string
  cmd: string
  status: 'running' | 'finished' | 'failed'
  exitCode?: number
  startedAt: number    // Unix ms
  finishedAt?: number
}
```

Poll this in a loop until `status !== 'running'`.

---

### lia_jobs_get_output

```typescript
api.invoke('lia_jobs_get_output', { jobId: string; since?: number }) → string
```

Returns the buffered stdout + stderr for the job. `since` is an optional byte offset for incremental reads during streaming.

---

### lia_jobs_kill

```typescript
api.invoke('lia_jobs_kill', { jobId: string }) → boolean
```

Sends SIGKILL to a running job. Returns `true` if the signal was delivered.

---

## Dependency checks

### lia_deps_check

```typescript
api.invoke('lia_deps_check', { name: string }) → { available: boolean; version?: string }
```

Checks whether `name` is in the system PATH and attempts to parse its version string (via `--version` or `-v`).

```typescript
const { available, version } = await api.invoke('lia_deps_check', { name: 'bcftools' }) as {
  available: boolean
  version?: string
}
// { available: true, version: '1.20' }
```

---

## .lia module runtime

### lia_liatir_read_manifest

```typescript
api.invoke('lia_liatir_read_manifest', { path: string }) → object
```

Opens the `.lia` ZIP archive at `path`, validates that `_sig` contains exactly `LIATIR/1`, and returns the parsed `manifest.json` object. Throws if the signature is invalid or the manifest cannot be parsed.

Call this before `lia_liatir_run` to surface validation errors early (e.g., on import).

```typescript
const manifest = await api.invoke('lia_liatir_read_manifest', { path: liaPath })
```

---

### lia_liatir_run

```typescript
api.invoke('lia_liatir_run', {
  path: string
  inputs: Record<string, unknown>
}) → unknown
```

Validates the bundle signature, extracts it to a temp directory, and runs `node index.js` with inputs serialised as environment variables. Waits for the `__LIATIR_RESULT__` marker on stdout and returns the parsed JSON.

```typescript
const result = await api.invoke('lia_liatir_run', {
  path: liaPath,
  inputs: {
    reads: '/data/sample.fastq.gz',
    threshold: 20,
  },
})
```

::: warning Node.js required
`lia_liatir_run` will fail if `node` is not in PATH. Check availability with `lia_deps_check` before calling.
:::
