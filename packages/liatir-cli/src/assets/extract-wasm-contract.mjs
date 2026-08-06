// Contract extraction for WASM .lia plugins — internal to @liatir/cli.
//
// Usage: node extract-wasm-contract.mjs <plugin.wasm>
//
// Runs the compiled wasm binary once with LIATIR_EMIT_CONTRACT=1 (WASI
// preview1, no filesystem, no network). An SDK-based plugin prints
// __LIATIR_CONTRACT__{json} and exits without reading stdin; the parent
// process scans stdout for the marker. Legacy binaries just produce no
// marker, which makes `liatir build` fall back to the manifest schema.

import { readFile } from "node:fs/promises";

const wasmPath = process.argv[2];
if (!wasmPath) {
  console.error("[liatir] usage: extract-wasm-contract.mjs <plugin.wasm>");
  process.exit(2);
}

const { WASI } = await import("node:wasi");

function createWasi() {
  const options = {
    args: ["plugin.wasm"],
    env: { LIATIR_EMIT_CONTRACT: "1" },
    returnOnExit: true,
  };
  try {
    // `version` is required on current Node; older Node only knew preview1.
    return new WASI({ version: "preview1", ...options });
  } catch {
    return new WASI(options);
  }
}

const wasi = createWasi();
const module = await WebAssembly.compile(await readFile(wasmPath));
const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
const exitCode = wasi.start(instance);
process.exit(typeof exitCode === "number" ? exitCode : 0);
