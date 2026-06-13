// All comments in English.
// Node-style globals polyfills for browser Worker
import { Buffer as _Buffer } from "buffer";
(globalThis as any).Buffer = (globalThis as any).Buffer || _Buffer;
(globalThis as any).process = (globalThis as any).process || { env: {} };
(globalThis as any).global = (globalThis as any).global || globalThis;
// Minimal WASI worker using ONLY the public @wasmer/wasi API.

import { init, WASI } from "@wasmer/wasi";

type WorkMsg = {
  id: string;
  wasmBytes: Uint8Array | number[];
  payload: unknown;
  wasi: boolean;           // we keep the flag for future non-WASI paths
  timeoutMs?: number;
};

type WorkResult = {
  ok: boolean;
  stdout?: string;
  stderr?: string;
  value?: unknown;
  error?: string;
};

self.onmessage = async (ev: MessageEvent<WorkMsg>) => {
  const { id, wasmBytes, payload, wasi, timeoutMs } = ev.data;
  const port: MessagePort | undefined = (ev as any).ports?.[0];

  // Soft timeout (cannot preempt sync Wasm; aborts before run if expired)
  const ctrl = new AbortController();
  let timer: any;
  if (timeoutMs && timeoutMs > 0) {
    timer = setTimeout(() => ctrl.abort(), timeoutMs);
  }
  const reply = (r: WorkResult) => (port ? port.postMessage(r) : (postMessage as any)(r));

  try {
    if (!wasi) return reply({ ok: false, error: "This runner supports only WASI (wasm32-wasip1). Set wasi: true." });
    if (ctrl.signal.aborted) throw new Error("timeout");

    await init(); // required by @wasmer/wasi

    // Encode stdin JSON + newline (like `echo ... | wasmtime`)
    const stdinText = JSON.stringify(payload) + "\n";

    const wasiInst = new WASI({
      args: ["module.wasm"],
      env: {}, // add passthrough if you need
    });
    wasiInst.setStdinString(stdinText);

    const bytes = new Uint8Array(wasmBytes as any);
    const module = await WebAssembly.compile(bytes);

    const instance = await wasiInst.instantiate(module, {});
    const exitCode = wasiInst.start(instance);

    const stdoutRaw = wasiInst.getStdoutString();
    const stdout = typeof stdoutRaw === "string" ? stdoutRaw.trim() : stdoutRaw;
    const stderr = wasiInst.getStderrString();
    const value = typeof stdout === "string" ? tryParseJson(stdout) : undefined;

    reply({ ok: true, stdout, stderr, value });
  } catch (e: any) {
    reply({ ok: false, error: String(e?.message || e) });
  } finally {
    if (timer) clearTimeout(timer);
  }
};

function tryParseJson(s: string) { try { return JSON.parse(s); } catch { return undefined; } }