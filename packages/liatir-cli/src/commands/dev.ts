import * as fs from "fs/promises";
import * as path from "path";
import * as child_process from "child_process";
import { build as esbuild, context as esbuildContext } from "esbuild";

interface Manifest {
  name: string;
  version: string;
}

async function loadManifest(): Promise<Manifest> {
  const cwd = process.cwd();
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  try {
    return JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Manifest;
  } catch {
    console.error("No .lia-manifest.json found. Run this command from your project root.");
    process.exit(1);
  }
}

// Generates a thin runner that imports the bundle and calls run({})
function runnerScript(bundlePath: string): string {
  return `
import { createLiatir } from "@liatir/adapter";
import { run } from ${JSON.stringify(bundlePath)};

const Liatir = await createLiatir().catch(e => {
  console.error(e.message);
  process.exit(1);
});

// Inject Liatir as a global so scripts that do \`import { createLiatir }\` still work,
// but also support the pattern where scripts access it via \`createLiatir()\`.
globalThis.Liatir = Liatir;

console.log("[liatir dev] running script...");
const result = await run({}).catch(e => {
  console.error("[liatir dev] script error:", e);
  process.exit(1);
});
console.log("[liatir dev] result:", JSON.stringify(result, null, 2));
`;
}

export async function dev() {
  const cwd = process.cwd();
  const manifest = await loadManifest();
  const entryPoint = path.join(cwd, "src", "index.ts");
  const distDir = path.join(cwd, ".lia-dev");
  const bundlePath = path.join(distDir, "index.mjs");
  const runnerPath = path.join(distDir, "_runner.mjs");

  await fs.mkdir(distDir, { recursive: true });

  console.log(`[liatir dev] watching ${manifest.name}... (Ctrl+C to stop)`);
  console.log(`[liatir dev] make sure the Liatir app is running\n`);

  let runningProcess: child_process.ChildProcess | null = null;

  async function runScript() {
    // Kill previous run if still going
    if (runningProcess && !runningProcess.killed) {
      runningProcess.kill();
    }

    await fs.writeFile(runnerPath, runnerScript(bundlePath));

    runningProcess = child_process.fork(runnerPath, [], {
      execArgv: ["--input-type=module"],
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
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: bundlePath,
    external: ["@liatir/adapter"],
    plugins: [
      {
        name: "on-rebuild",
        setup(b) {
          b.onEnd(async (result) => {
            if (result.errors.length === 0) {
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
