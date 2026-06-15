# Offlab

Tauri 2 desktop runtime base for bioinformatics applications.

Provides a sandboxed WASM plugin system, a native sidecar abstraction, and a
sequential pipeline orchestrator — ready to wire up real bio tools.

---

## Architecture

```
src-tauri/src/bridge/
  plugins.rs      ← WASM runtime (wasmtime + WASI p1). Full implementation.
  sidecar.rs      ← Native binary runner (tauri_plugin_shell). Scaffold.
  fs.rs           ← Sandboxed file system commands.
  ...             ← Other Tauri bridge modules (window, notifications, etc.)

src-ts/
  modules/rs/
    plugins/      ← TS bridge to the WASM runtime.
    sidecar/      ← TS bridge to the sidecar runner.
  modules/bio/
    pipeline/     ← Pipeline orchestrator (pure TS). Chains WASM + sidecar steps.
```

---

## WASM plugins (`Offlab.plugins`)

The WASM runtime is fully operational. Modules are `.wasm` files that receive a
JSON payload on stdin and write a JSON result to stdout.

```ts
// Add a module (file picker dialog).
await Offlab.plugins.add("qc.wasm");

// Call it.
const result = await Offlab.plugins.call("qc.wasm", {
  fn: "run",
  args: { input: "sample.fastq" },
}, /* timeoutMs */ 30_000);
```

Each call runs in an isolated job directory that is deleted after execution.
Modules have access to a persistent `/storage` directory across calls.

---

## Sidecar binaries (`Offlab.sidecar`)

For native tools that cannot be compiled to WASM (e.g. samtools, minimap2).

**To add a real sidecar:**

1. Place the platform binary under `src-tauri/binaries/` following Tauri's
   naming convention (`<name>-<target-triple>`).
2. Declare it in `tauri.conf.json`:
   ```json
   "bundle": {
     "externalBin": ["binaries/samtools"]
   }
   ```
3. Add the `shell:allow-execute` permission for the binary in the capability
   file (`src-tauri/permissions/offlab-bridge.toml`).

Then call it from TS:

```ts
const result = await Offlab.sidecar.run("samtools", ["view", "-c", "sample.bam"]);
```

---

## Pipeline orchestrator (`Offlab.pipeline`)

Chains WASM and sidecar steps in sequence. Stops at the first failure unless
`continueOnError` is set.

```ts
const result = await Offlab.pipeline.run([
  {
    kind: "wasm",
    label: "QC",
    module: "qc.wasm",
    payload: { fn: "run", args: { input: "sample.fastq" } },
    timeoutMs: 60_000,
  },
  {
    kind: "sidecar",
    label: "Align",
    binary: "minimap2",
    args: ["-ax", "sr", "ref.fa", "sample.fastq"],
  },
]);

console.log(result.ok, result.steps.map(s => s.status));
```

**Extension points** (see `src-ts/modules/bio/pipeline/_types.ts` TODOs):
- Add bio pipeline presets as named functions (e.g. `shortReadQC`, `alignShortReads`)
- Add new step kinds (e.g. `"http-fetch"` for downloading reference genomes)
- Wire step output as input to the next step (currently each step is independent)

---

## File layout for bio data

The sandboxed FS root is `~/.offlab/.main/` (data) and cache equivalent.
WASM module storage lives at `~/.offlab/.main/_external_modules_storage/<module>/`.

---

## Development

```sh
# Configure for local dev (writes window.env + tauri.conf.json)
bash scripts/local-dev-conf.sh

# Start Tauri dev
cargo tauri dev
```
