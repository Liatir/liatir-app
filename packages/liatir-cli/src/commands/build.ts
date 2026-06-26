import * as fs from "fs/promises";
import * as path from "path";
import { build as esbuild } from "esbuild";
import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

interface FieldDef {
  type: "string" | "number" | "boolean" | "file";
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  accept?: string[];
}

interface Manifest {
  name: string;
  version: string;
  description?: string;
  /** Execution runtime: Node subprocess (default) or sandboxed WASM. */
  runtime?: "node" | "wasm";
  inputSchema?: Record<string, FieldDef>;
  outputSchema?: Record<string, FieldDef>;
}

export async function build() {
  const cwd = process.cwd();

  // Load manifest
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  let manifest: Manifest;
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Manifest;
  } catch {
    console.error("No .lia-manifest.json found. Run this command from your project root.");
    process.exit(1);
  }

  const runtime: "node" | "wasm" = manifest.runtime === "wasm" ? "wasm" : "node";

  // The manifest that ships inside the bundle — carries the runtime so the app
  // knows how to execute it (Node subprocess vs WASM sandbox).
  const fullManifest = {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    runtime,
    inputSchema: manifest.inputSchema ?? {},
    outputSchema: manifest.outputSchema ?? {},
  };

  console.log(`Building ${manifest.name}@${manifest.version} (${runtime})...`);

  const outputName = `${manifest.name}.lia`;
  const outputPath = path.join(cwd, outputName);

  if (runtime === "wasm") {
    await buildWasm(cwd, outputPath, fullManifest);
  } else {
    await buildNode(cwd, outputPath, fullManifest);
  }

  console.log(`✓ Built → ${outputName}`);
}

/** Node module: bundle src/index.ts with esbuild → index.js, then zip. */
async function buildNode(cwd: string, outputPath: string, manifest: object): Promise<void> {
  const entryPoint = path.join(cwd, "src", "index.ts");
  try {
    await fs.access(entryPoint);
  } catch {
    console.error("src/index.ts not found.");
    process.exit(1);
  }

  const distDir = path.join(cwd, "dist");
  await fs.mkdir(distDir, { recursive: true });

  // Bundle with esbuild — all deps inlined, ESM output.
  await esbuild({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: path.join(distDir, "index.js"),
    external: [],
    minify: false,
  });

  await createBundle(outputPath, manifest, "index.js", path.join(distDir, "index.js"));
}

/** WASM custom tool: compile the Rust crate to wasm32-wasip1, then zip module.wasm. */
async function buildWasm(cwd: string, outputPath: string, manifest: object): Promise<void> {
  console.log("Compiling Rust → wasm32-wasip1 (cargo build --release)...");
  try {
    await execFileAsync("cargo", ["build", "--release", "--target", "wasm32-wasip1"], { cwd });
  } catch (e) {
    console.error(
      "cargo build failed. Ensure Rust and the wasm target are installed:\n" +
      "  rustup target add wasm32-wasip1"
    );
    throw e;
  }

  // Locate the produced .wasm (target/wasm32-wasip1/release/<crate>.wasm).
  const releaseDir = path.join(cwd, "target", "wasm32-wasip1", "release");
  let wasmFile: string | undefined;
  try {
    const files = await fs.readdir(releaseDir);
    wasmFile = files.find((f) => f.endsWith(".wasm"));
  } catch {
    /* handled below */
  }
  if (!wasmFile) {
    throw new Error(`No .wasm artifact found in ${releaseDir}`);
  }

  await createBundle(outputPath, manifest, "module.wasm", path.join(releaseDir, wasmFile));
}

/** Write the .lia zip: signature + manifest + the runtime payload (index.js | module.wasm). */
async function createBundle(
  outputPath: string,
  manifest: object,
  payloadName: "index.js" | "module.wasm",
  payloadPath: string
): Promise<void> {
  const { default: JSZip } = await import("jszip").catch(() => {
    throw new Error("jszip not found. Run: npm install jszip");
  });

  const zip = new JSZip();
  zip.file("_sig", "LIATIR/1");
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file(payloadName, await fs.readFile(payloadPath));

  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.writeFile(outputPath, content);
}
