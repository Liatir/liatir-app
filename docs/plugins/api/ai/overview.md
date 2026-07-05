---
title: ai
description: List, prepare, and run local AI models from a Liatir plugin.
---

# Liatir.ai

`Liatir.ai` lets a plugin discover the built-in AI model catalog, prepare a
model's managed Python runtime, and run code inside it. The model catalog is the
same one the Liatir app uses — a single source of truth shared through
`@liatir/core`.

::: info
`Liatir.ai` is available on Node `.lia` plugins (through the `Liatir` bridge).
Preparing and running a model uses a managed local Python runtime.
:::

## Methods

| Method | Description |
| --- | --- |
| `list()` | The visible built-in AI model catalog (`LiatirAIModelMetadata[]`). |
| `get(modelId)` | One model's metadata, or `undefined`. |
| `hardware()` | Local hardware info (cores, memory, GPU/Metal, Python). |
| `status(modelId)` | Whether a model's managed runtime is installed and ready. |
| `prepare(modelId)` | Create/install a model's managed runtime (idempotent). |
| `runScript(modelId, options)` | Run a Python script inside a model's prepared runtime. |

## list / get

```ts
const models = Liatir.ai.list();
const esm2 = Liatir.ai.get("facebook-esm2-8m-protein");
```

Each entry is a `LiatirAIModelMetadata` (id, name, description, category,
capabilities, hardware, license, and the managed-runtime install spec).

## hardware

```ts
const hw = await Liatir.ai.hardware();
// { os, arch, cpuCores, totalMemoryBytes, appleMetal, cudaAvailable, ... }
```

## status / prepare

`prepare` creates the model's managed Python runtime and installs its declared
packages; it is idempotent. `status` reports whether that runtime is ready.

```ts
const before = await Liatir.ai.status("facebook-esm2-8m-protein");
if (!before.installed) {
  await Liatir.ai.prepare("facebook-esm2-8m-protein");
}
```

`AiRuntimeStatus` includes `installed`, `missingPackages`, `runtimeDir`,
`pythonPath`, and `sizeBytes`.

## runScript

Runs a Python script inside the model's prepared runtime. The `input` object is
passed as JSON on stdin; `stdout`/`stderr` are captured in the result.

```ts
const result = await Liatir.ai.runScript("facebook-esm2-8m-protein", {
  script: `
import sys, json
payload = json.load(sys.stdin)
# ... load the model from its managed runtime and run inference ...
print(json.dumps({ "ok": True }))
`,
  input: { sequence: "MKTAYIAKQR" },
  timeoutSeconds: 600,
});
// { ok, exitCode, stdout, stderr, durationMs }
```

::: tip
Call `prepare(modelId)` before `runScript` (or check `status`) so the runtime
and its packages are installed first.
:::

## Related

- [Local AI guide](/ai/guide)
- [AI Models](/ai/models/overview)
- [Dependencies API](/plugins/api/deps/check)
