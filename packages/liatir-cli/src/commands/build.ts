import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { build as esbuild } from "esbuild";
import { execFile } from "child_process";
import { promisify } from "util";
import type { LiatirInputFieldSchema } from "@liatir/core";

const execFileAsync = promisify(execFile);

// A field as produced at runtime by the SDK's f.* builders (phantom __t erased).
type RuntimeField = LiatirInputFieldSchema & { __t?: unknown };

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Drop an npm scope for the output filename (@scope/name → name). */
function bareName(name: string): string {
  return name.includes("/") ? name.split("/").pop()! : name;
}

/** Reduce a code-declared schema to plain JSON field schemas for the manifest. */
function serializeSchema(schema: Record<string, RuntimeField> | undefined): Record<string, LiatirInputFieldSchema> {
  const out: Record<string, LiatirInputFieldSchema> = {};
  for (const [k, fld] of Object.entries(schema ?? {})) {
    const def: LiatirInputFieldSchema = { type: fld.type };
    if (fld.label !== undefined) def.label = fld.label;
    if (fld.description !== undefined) def.description = fld.description;
    if (fld.required !== undefined) def.required = fld.required;
    if (fld.default !== undefined) def.default = fld.default;
    if (fld.accept !== undefined) def.accept = fld.accept;
    out[k] = def;
  }
  return out;
}

export async function build() {
  const cwd = process.cwd();
  // Runtime is detected from the project: a Cargo.toml means a WASM custom tool.
  if (await exists(path.join(cwd, "Cargo.toml"))) {
    await buildWasm(cwd);
  } else {
    await buildNode(cwd);
  }
}

/**
 * Node module: the I/O schema lives IN THE CODE (defineModule). We bundle, import
 * the bundle to read its declared inputs/outputs, and GENERATE the manifest from
 * them — a single source of truth, nothing to keep in sync by hand.
 */
async function buildNode(cwd: string): Promise<void> {
  const pkgPath = path.join(cwd, "package.json");
  if (!(await exists(pkgPath))) {
    console.error("No package.json found. Run this from your module's root.");
    process.exit(1);
  }
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as {
    name: string; version: string; description?: string;
  };

  const entryPoint = path.join(cwd, "src", "index.ts");
  if (!(await exists(entryPoint))) {
    console.error("src/index.ts not found.");
    process.exit(1);
  }

  console.log(`Building ${pkg.name}@${pkg.version} (node)...`);

  const distDir = path.join(cwd, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const bundlePath = path.join(distDir, "index.js");

  await esbuild({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: bundlePath,
    external: [],
    minify: false,
  });

  // Read the schema straight from the compiled module — the code is the source.
  const mod = await import(pathToFileURL(bundlePath).href);
  const def = mod.default;
  if (!def || typeof def.run !== "function") {
    console.error("src/index.ts must `export default defineModule(...)`.");
    process.exit(1);
  }

  const manifest = {
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? "",
    runtime: "node",
    inputSchema: serializeSchema(def.inputs),
    outputSchema: serializeSchema(def.outputs),
  };

  const outputName = `${bareName(pkg.name)}.lia`;
  await createBundle(path.join(cwd, outputName), manifest, "index.js", bundlePath);
  console.log(`✓ Built → ${outputName}`);
}

/**
 * WASM custom tool: the schema lives in .lia-manifest.json (Rust can't export a
 * JS schema at build time). We compile the crate and package module.wasm.
 */
async function buildWasm(cwd: string): Promise<void> {
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  if (!(await exists(manifestPath))) {
    console.error("No .lia-manifest.json found. Run this from your tool's root.");
    process.exit(1);
  }
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8"));
  const manifest = {
    name: m.name,
    version: m.version,
    description: m.description ?? "",
    runtime: "wasm",
    inputSchema: m.inputSchema ?? {},
    outputSchema: m.outputSchema ?? {},
  };

  console.log(`Building ${manifest.name}@${manifest.version} (wasm)...`);
  console.log("Compiling Rust → wasm32-wasip1 (cargo build --release)...");
  try {
    await execFileAsync("cargo", ["build", "--release", "--target", "wasm32-wasip1"], { cwd });
  } catch (e) {
    console.error("cargo build failed. Ensure Rust + the wasm target are installed:\n  rustup target add wasm32-wasip1");
    throw e;
  }

  const releaseDir = path.join(cwd, "target", "wasm32-wasip1", "release");
  let wasmFile: string | undefined;
  try {
    wasmFile = (await fs.readdir(releaseDir)).find((x) => x.endsWith(".wasm"));
  } catch { /* handled below */ }
  if (!wasmFile) throw new Error(`No .wasm artifact found in ${releaseDir}`);

  const outputName = `${bareName(manifest.name)}.lia`;
  await createBundle(path.join(cwd, outputName), manifest, "module.wasm", path.join(releaseDir, wasmFile));
  console.log(`✓ Built → ${outputName}`);
}

/** Write the .lia zip: signature + manifest + the runtime payload. */
async function createBundle(
  outputPath: string,
  manifest: object,
  payloadName: "index.js" | "module.wasm",
  payloadPath: string,
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
