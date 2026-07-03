# window.Liatir Browser API

`window.Liatir` is the browser/webview SDK entry point injected by Tauri before the SvelteKit app mounts. Its public TypeScript type is `LiatirBrowserAPI`. `LiatirAPI` remains only as a deprecated compatibility alias.

## Getting the handle

```typescript
import { liatir } from '$lib/api'
import type { LiatirBrowserAPI } from '@liatir/api'

const api = liatir() as LiatirBrowserAPI | null  // returns window.Liatir ?? null
if (!api) throw new Error('Liatir API not available')
```

If a helper returns `any`, use `as` casts to narrow return types. Generic type parameters on `api.invoke<T>()` silently no-op when the receiver is `any`:

```typescript
// ✓ correct — explicit as cast
const size = await api.invoke('lia_file_size', { path }) as number

// ✗ wrong — T is ignored when Liatir is typed any
const size = await api.invoke<number>('lia_file_size', { path })
```

## api.invoke

```typescript
api.invoke(cmd: string, args?: Record<string, unknown>): Promise<unknown>
```

Raw Tauri invoke. Calls any registered `lia_*` command by name and returns its result. Throws on error.

```typescript
// Filesystem paths
const { data, cache } = await api.invoke('lia_fs_paths') as { data: string; cache: string }

// Read text
const content = await api.invoke('lia_read_file_text', { path: '/data/ref.fa' }) as string

// Preview first 40 lines
const preview = await api.invoke('lia_preview_file', { path, lines: 40 }) as string

// File size
const bytes = await api.invoke('lia_file_size', { path }) as number

// Open save dialog
const savePath = await api.invoke('lia_file_save', { defaultName: 'output.vcf' }) as string

// Copy file
await api.invoke('lia_fs_copy', { src: '/tmp/out.fastq.gz', dest: savePath })
```

See [Rust Commands](/api/rust-commands) for the full command reference.

## api.jobs

Methods for spawning and managing external processes.

### jobs.spawn

```typescript
api.jobs.spawn(cmd: string, args: string[], cwd?: string): Promise<{ jobId: string }>
```

Spawns an external process and returns a job ID immediately (non-blocking). The process runs asynchronously; use `lia_jobs_status` and `lia_jobs_get_output` to track it.

```typescript
const { jobId } = await api.jobs.spawn('samtools', ['flagstat', filePath])
```

### Polling a job to completion

```typescript
interface JobEntry {
  jobId: string
  cmd: string
  status: 'running' | 'finished' | 'failed'
  exitCode?: number
  startedAt: number   // Unix ms
  finishedAt?: number
}

const { jobId } = await api.jobs.spawn('bcftools', ['stats', vcfPath])

let status: JobEntry
do {
  await new Promise(r => setTimeout(r, 200))
  status = await api.invoke('lia_jobs_status', { jobId }) as JobEntry
} while (status.status === 'running')

if (status.exitCode !== 0) throw new Error('bcftools stats failed')
const stdout = await api.invoke('lia_jobs_get_output', { jobId }) as string
```

The `runNativeTool` utility in `$lib/utils/native-tool.ts` wraps this polling loop.

### jobs.kill

```typescript
// Via invoke
await api.invoke('lia_jobs_kill', { jobId })
```

Sends SIGKILL to a running job.

## api.deps

Methods for checking binary availability.

### deps.check

```typescript
api.deps.check(name: string): Promise<{ available: boolean; version?: string }>
```

Checks whether a binary is available in the system PATH and returns its version string.

```typescript
const { available, version } = await api.deps.check('samtools')
// { available: true, version: '1.21' }

const { available } = await api.deps.check('nextflow')
// { available: false }
```

### deps.checkMany

```typescript
api.deps.checkMany(names: string[]): Promise<Record<string, { available: boolean; version?: string }>>
```

Check multiple binaries in a single call.

```typescript
const results = await api.deps.checkMany(['samtools', 'bcftools', 'fastp'])
// { samtools: { available: true, version: '1.21' }, ... }
```

## api.desktop.fs.data

Methods for reading and writing files in the app data directory. Paths are relative to `{app_data_dir}/`.

```typescript
// Get the absolute app data directory path
const dataDir = await api.desktop.fs.data.path()

// Read a JSON run record
const json = await api.desktop.fs.data.readText('analysis-runs/samtools/run-001.json')

// Write a new run record
await api.desktop.fs.data.writeText(
  'analysis-runs/samtools/run-002.json',
  JSON.stringify(runMeta),
  { createDirs: true }
)

// Check if a plugin has been imported
const exists = await api.desktop.fs.data.exists('plugins/my-plugin.lia')
```

## api.desktop.events

Tauri event bus — for subscribing to real-time events from the backend.

### events.on

```typescript
api.desktop.events.on(event: string, handler: (payload: unknown) => void): () => void
```

Subscribe to an event. Returns an unsubscribe function.

```typescript
const unlisten = api.desktop.events.on('jobs:stdout:' + jobId, (line) => {
  console.log('stdout chunk:', line)
})

// Clean up when done
unlisten()
```

### events.emit

```typescript
api.desktop.events.emit(event: string, payload?: unknown): Promise<void>
```

Emit an event (primarily used for inter-component communication within the frontend).
