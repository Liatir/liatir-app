# Liatir SDK

The Liatir SDK is the JavaScript/TypeScript API exposed to code running inside
the Liatir desktop environment.

Use it when you are building a `.lia` plugin or another local surface that needs
typed access to Liatir features.

![Liatir SDK surface map](../static/sdk-surface-map.svg)

## Install

```bash
npm install liatir
```

## Basic usage

```ts
import { Liatir, isLiatirAvailable } from 'liatir';

if (!isLiatirAvailable()) {
  throw new Error('Liatir is not available in this environment.');
}

const files = await Liatir.desktop.files.open({
  multi: true,
  allowed: ['fastq', 'fq', 'fastq.gz']
});
```

## Important distinction

The SDK is not the same thing as a `.lia` plugin.

| Concept | Meaning |
| --- | --- |
| `.lia` plugin | A packaged extension file imported into Liatir. |
| Liatir SDK | The typed API used by code to talk to Liatir. |
| `Liatir.desktop` | Native desktop features such as files, fs, window, events. |
| `Liatir.plugins` | Low-level WASM module runtime. |
| AI Models / AI Tools | Built-in local AI model system, not SDK plugins. |

## Availability

Use `isLiatirAvailable()` before calling native features. It returns `false`
outside Liatir and does not throw during normal browser rendering.

```ts
import { Liatir, isLiatirAvailable } from 'liatir';

export async function openInput() {
  if (!isLiatirAvailable()) return null;
  return await Liatir.desktop.files.open({ multi: false });
}
```

## Main namespaces

| Namespace | Use it for |
| --- | --- |
| `Liatir.desktop` | File dialogs, sandboxed storage, app/window APIs, events, clipboard, notifications. |
| `Liatir.plugins` | Calling low-level WASM modules. |
| `Liatir.pipeline` | Running sequential SDK pipelines made of WASM and sidecar steps. |
| `Liatir.jobs` | Spawning and tracking async native processes. |
| `Liatir.deps` | Checking whether command-line binaries are available. |
| `Liatir.qc` | Typed quality-control wrappers such as FastQC. |
| `Liatir.invoke` | Low-level command invocation for advanced use. |

Prefer typed namespaces. Use `invoke` only when no typed wrapper exists.

## API reference

The API reference is organized by namespace:

- [Root API](/plugins/api/root/overview)
- [Desktop API](/plugins/api/desktop/app)
- [Plugins API](/plugins/api/plugins/call)
- [Pipeline API](/plugins/api/pipeline/run)
- [Jobs API](/plugins/api/jobs/spawn)
- [Dependencies API](/plugins/api/deps/check)
- [QC API](/plugins/api/qc/fastqc)

