import * as fs from "fs/promises";
import * as path from "path";
import * as child_process from "child_process";
import { context as esbuildContext } from "esbuild";
import { typecheckIfConfigured } from "./_typecheck.js";
import { resolveNodeEntryPoint, type NodeEntryPoint } from "./_entry.js";

interface Manifest {
  name: string;
  version: string;
  runtime?: "node" | "wasm" | "python";
  python?: {
    entry?: string;
  };
}

async function loadManifest(): Promise<Manifest> {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  const packagePath = path.join(cwd, "package.json");

  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Manifest;
  } catch {
    try {
      const pkg = JSON.parse(await fs.readFile(packagePath, "utf-8")) as Manifest;
      return { name: pkg.name, version: pkg.version };
    } catch {
      console.error("No package.json or .lia-manifest.json found. Run this command from your plugin root.");
      process.exit(1);
    }
  }
}

async function parseDevInputs(args: string[]): Promise<Record<string, unknown>> {
  const inlineIdx = args.findIndex((a) => a === "--input" || a === "--inputs");
  if (inlineIdx >= 0) {
    const raw = args[inlineIdx + 1];
    if (!raw) {
      console.error("Missing JSON value after --input.");
      process.exit(1);
    }
    return JSON.parse(raw) as Record<string, unknown>;
  }

  const inlineEq = args.find((a) => a.startsWith("--input=") || a.startsWith("--inputs="));
  if (inlineEq) {
    return JSON.parse(inlineEq.slice(inlineEq.indexOf("=") + 1)) as Record<string, unknown>;
  }

  const fileIdx = args.findIndex((a) => a === "--input-file" || a === "--inputs-file");
  if (fileIdx >= 0) {
    const file = args[fileIdx + 1];
    if (!file) {
      console.error("Missing file path after --input-file.");
      process.exit(1);
    }
    return JSON.parse(await fs.readFile(path.resolve(file), "utf-8")) as Record<string, unknown>;
  }

  const fileEq = args.find((a) => a.startsWith("--input-file=") || a.startsWith("--inputs-file="));
  if (fileEq) {
    const file = fileEq.slice(fileEq.indexOf("=") + 1);
    return JSON.parse(await fs.readFile(path.resolve(file), "utf-8")) as Record<string, unknown>;
  }

  return {};
}

function pythonRunnerScript(entryPath: string, inputs: Record<string, unknown>): string {
  return `
import asyncio
import importlib.util
import inspect
import json
import pathlib
import sys
import traceback

entry_path = pathlib.Path(${JSON.stringify(entryPath)})
inputs = ${JSON.stringify(inputs)}

sys.path.insert(0, str(entry_path.parent))
try:
    spec = importlib.util.spec_from_file_location("_liatir_dev_plugin", entry_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load Python plugin entry: {entry_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    handler = getattr(module, "main", None)
    if not callable(handler):
        raise TypeError("Python .lia plugin must define a callable main(input) function.")
    result = handler(inputs)
    if inspect.isawaitable(result):
        result = asyncio.run(result)
    print("[liatir dev] result:", json.dumps(result, indent=2))
except Exception:
    traceback.print_exc()
    sys.exit(1)
`;
}

function normalizeRelativePath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error("python.entry must be a relative path inside the plugin project.");
  }
  return normalized;
}

// Generates a thin runner that imports the bundle and calls the same strict
// runtime shape used by `liatir build`: default definePlugin(...).main(...).
function runnerScript(bundlePath: string, inputs: Record<string, unknown>, entryDisplayPath: string): string {
  return `
import * as _mod from ${JSON.stringify(bundlePath)};
const _providedInputs = ${JSON.stringify(inputs)};
const _entryDisplayPath = ${JSON.stringify(entryDisplayPath)};

const _m = _mod.default;
if (!_m || typeof _m !== "object") {
  console.error(\`[liatir dev] \${_entryDisplayPath} must default-export definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... })\`);
  process.exit(1);
}

if (_m.__liatirPluginContract === true && typeof _m.run !== "function") {
  console.error("[liatir dev] plugin contract is missing .main(...). Finish the default export with definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... })");
  process.exit(1);
}

if (_m.__liatirPlugin !== true || typeof _m.run !== "function") {
  console.error("[liatir dev] invalid .lia plugin entrypoint. Use: export default definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... });");
  process.exit(1);
}

if (!_m.inputs || typeof _m.inputs !== "object" || Array.isArray(_m.inputs)) {
  console.error("[liatir dev] invalid plugin contract: definePlugin({ inputs }) must be an object.");
  process.exit(1);
}

if (!_m.outputs || typeof _m.outputs !== "object" || Array.isArray(_m.outputs)) {
  console.error("[liatir dev] invalid plugin contract: definePlugin({ outputs }) must be an object.");
  process.exit(1);
}

const _defaults = {};
for (const [key, field] of Object.entries(_m.inputs ?? {})) {
  if (field && typeof field === "object" && "default" in field) {
    _defaults[key] = field.default;
  }
}

const _inputs = { ..._defaults, ..._providedInputs };
console.log("[liatir dev] running plugin with inputs:", JSON.stringify(_inputs, null, 2));
const result = await _m.run(_inputs).catch(e => {
  console.error("[liatir dev] script error:", e);
  process.exit(1);
});
console.log("[liatir dev] result:", JSON.stringify(result, null, 2));
`;
}

async function devPython(cwd: string, manifest: Manifest, inputs: Record<string, unknown>) {
  const entry = normalizeRelativePath(manifest.python?.entry ?? "src/main.py");
  const entryPath = path.resolve(cwd, entry);
  const distDir = path.join(cwd, ".lia-dev");
  const runnerPath = path.join(distDir, "_python_runner.py");
  await fs.mkdir(distDir, { recursive: true });

  let runningProcess: child_process.ChildProcess | null = null;

  async function runScript() {
    if (runningProcess && !runningProcess.killed) {
      runningProcess.kill();
    }
    await fs.writeFile(runnerPath, pythonRunnerScript(entryPath, inputs));
    console.log(`[liatir dev] running ${manifest.name} (${entry})...`);
    runningProcess = child_process.spawn("python3", [runnerPath], { stdio: "inherit", cwd });
    runningProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.log(`[liatir dev] exited with code ${code}`);
      }
    });
  }

  await runScript();
  console.log(`[liatir dev] watching ${manifest.name} (${entry})... (Ctrl+C to stop)`);
  console.log("[liatir dev] Python dependencies are resolved by Liatir when the packaged plugin runs.\n");

  let timer: NodeJS.Timeout | null = null;
  const fsWatcher = await import("fs");
  const nativeWatcher = fsWatcher.watch(path.dirname(entryPath), () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => void runScript(), 150);
  });

  process.on("SIGINT", async () => {
    console.log("\n[liatir dev] stopping...");
    nativeWatcher.close();
    runningProcess?.kill();
    await fs.rm(distDir, { recursive: true, force: true });
    process.exit(0);
  });

  await new Promise(() => {});
}

export async function dev(args: string[] = []) {
  const cwd = process.cwd();
  const manifest = await loadManifest();
  const inputs = await parseDevInputs(args);

  if (manifest.runtime === "python") {
    await devPython(cwd, manifest, inputs);
    return;
  }

  let entryPoint: NodeEntryPoint;
  try {
    entryPoint = await resolveNodeEntryPoint(cwd);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
  const distDir = path.join(cwd, ".lia-dev");
  const bundlePath = path.join(distDir, "index.mjs");
  const runnerPath = path.join(distDir, "_runner.mjs");

  await fs.mkdir(distDir, { recursive: true });

  console.log(`[liatir dev] watching ${manifest.name} (${entryPoint.displayPath})... (Ctrl+C to stop)`);
  console.log(`[liatir dev] make sure the Liatir app is running\n`);

  let runningProcess: child_process.ChildProcess | null = null;

  async function runScript() {
    // Kill previous run if still going
    if (runningProcess && !runningProcess.killed) {
      runningProcess.kill();
    }

    await fs.writeFile(runnerPath, runnerScript(bundlePath, inputs, entryPoint.displayPath));

    runningProcess = child_process.fork(runnerPath, [], {
      stdio: "inherit",
    });

    runningProcess.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        console.log(`[liatir dev] exited with code ${code}`);
      }
    });
  }

  // esbuild watch mode — rebuilds on every save
  const ctx = await esbuildContext({
    entryPoints: [entryPoint.path],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: bundlePath,
    external: ["@liatir/api"],
    plugins: [
      {
        name: "on-rebuild",
        setup(b) {
          b.onEnd(async (result) => {
            if (result.errors.length === 0) {
              try {
                await typecheckIfConfigured(cwd, "liatir dev");
              } catch (err) {
                console.error(err instanceof Error ? err.message : err);
                return;
              }
              console.log(`[liatir dev] rebuilt → running...`);
              await runScript();
            } else {
              console.error(`[liatir dev] build errors:`);
              result.errors.forEach((e) => console.error(" ", e.text));
            }
          });
        },
      },
    ],
  });

  await ctx.watch();

  // Initial build triggers the plugin's onEnd
  process.on("SIGINT", async () => {
    console.log("\n[liatir dev] stopping...");
    await ctx.dispose();
    runningProcess?.kill();
    // Clean up dev dir
    await fs.rm(distDir, { recursive: true, force: true });
    process.exit(0);
  });

  // Keep the process alive
  await new Promise(() => {});
}
