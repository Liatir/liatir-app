import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { build as esbuild } from "esbuild";
import { execFile } from "child_process";
import { promisify } from "util";
import type { LiatirFieldSchema, LiatirInputFieldSchema, LiatirOutputFieldSchema } from "@liatir/core";
import { typecheckIfConfigured } from "./_typecheck.js";
import { resolveNodeEntryPoint, type NodeEntryPoint } from "./_entry.js";

const execFileAsync = promisify(execFile);

// A field as produced at runtime by the SDK's field/input/output builders.
type RuntimeField = LiatirFieldSchema & {
  ext?: string[];
  format?: LiatirOutputFieldSchema["format"];
  __t?: unknown;
};

type CompiledNodeModule = {
  __liatirModule?: unknown;
  __liatirModuleContract?: unknown;
  inputs?: unknown;
  outputs?: unknown;
  run?: unknown;
};

interface PackageMetadata {
  name: string;
  version: string;
  description?: string;
  liatir?: {
    displayName?: unknown;
    category?: unknown;
    tags?: unknown;
  };
}

interface ManifestMetadata {
  name: string;
  version: string;
  description: string;
  category?: string;
  tags?: string[];
}

async function exists(p: string): Promise<boolean> {
  try { await fs.access(p); return true; } catch { return false; }
}

/** Drop an npm scope for the output filename (@scope/name → name). */
function bareName(name: string): string {
  return name.includes("/") ? name.split("/").pop()! : name;
}

/** Reduce a code-declared input schema to plain JSON field schemas for the manifest. */
function serializeInputSchema(schema: Record<string, RuntimeField> | undefined): Record<string, LiatirInputFieldSchema> {
  const out: Record<string, LiatirInputFieldSchema> = {};
  for (const [k, fld] of Object.entries(schema ?? {})) {
    if (fld.type !== "string" && fld.type !== "number" && fld.type !== "boolean" && fld.type !== "file") {
      throw new Error(`Invalid input field type for "${k}": ${fld.type}`);
    }
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

/** Reduce a code-declared output schema to plain JSON field schemas for the manifest. */
function serializeOutputSchema(schema: Record<string, RuntimeField> | undefined): Record<string, LiatirOutputFieldSchema> {
  const out: Record<string, LiatirOutputFieldSchema> = {};
  for (const [k, fld] of Object.entries(schema ?? {})) {
    if (
      fld.type !== "string" &&
      fld.type !== "number" &&
      fld.type !== "boolean" &&
      fld.type !== "file" &&
      fld.type !== "stats" &&
      fld.type !== "json"
    ) {
      throw new Error(`Invalid output field type for "${k}": ${fld.type}`);
    }
    const def: LiatirOutputFieldSchema = { type: fld.type };
    if (fld.label !== undefined) def.label = fld.label;
    if (fld.description !== undefined) def.description = fld.description;
    if (fld.required !== undefined) def.required = fld.required;
    if (fld.default !== undefined) def.default = fld.default;
    if (fld.accept !== undefined) def.accept = fld.accept;
    if (fld.ext !== undefined) def.ext = fld.ext;
    if (fld.format !== undefined) def.format = fld.format;
    out[k] = def;
  }
  return out;
}

function failInvalidNodeModule(message: string): never {
  console.error(message);
  process.exit(1);
}

function isPlainRecord(value: unknown): value is Record<string, RuntimeField> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanOptionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function cleanTags(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tags = value
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter(Boolean);
  return tags.length > 0 ? [...new Set(tags)] : undefined;
}

function packageMetadata(pkg: PackageMetadata): ManifestMetadata {
  return {
    name: cleanOptionalString(pkg.liatir?.displayName) ?? pkg.name,
    version: pkg.version,
    description: pkg.description ?? "",
    category: cleanOptionalString(pkg.liatir?.category),
    tags: cleanTags(pkg.liatir?.tags),
  };
}

function wasmMetadata(raw: Record<string, unknown>): ManifestMetadata {
  return {
    name: cleanOptionalString(raw.name) ?? "WASM Tool",
    version: cleanOptionalString(raw.version) ?? "1.0.0",
    description: cleanOptionalString(raw.description) ?? "",
    category: cleanOptionalString(raw.category),
    tags: cleanTags(raw.tags),
  };
}

function validateNodeModule(def: CompiledNodeModule | undefined): asserts def is {
  __liatirModule: true;
  inputs: Record<string, RuntimeField>;
  outputs: Record<string, RuntimeField>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
} {
  if (!def || typeof def !== "object") {
    failInvalidNodeModule("The plugin entrypoint must default-export defineModule({ inputs, outputs }).main(async ({ input, lia }) => { ... }).");
  }

  if (def.__liatirModuleContract === true && typeof def.run !== "function") {
    failInvalidNodeModule("Plugin contract is missing .main(...). Finish the default export with defineModule({ inputs, outputs }).main(async ({ input, lia }) => { ... }).");
  }

  if (def.__liatirModule !== true || typeof def.run !== "function") {
    failInvalidNodeModule("Invalid .lia plugin entrypoint. Use: export default defineModule({ inputs, outputs }).main(async ({ input, lia }) => { ... });");
  }

  if (!isPlainRecord(def.inputs)) {
    failInvalidNodeModule("Invalid .lia plugin contract: defineModule({ inputs }) must be an object.");
  }

  if (!isPlainRecord(def.outputs)) {
    failInvalidNodeModule("Invalid .lia plugin contract: defineModule({ outputs }) must be an object.");
  }
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
 * Node plugin: the I/O schema lives IN THE CODE (defineModule). We bundle, import
 * the bundle to read its declared inputs/outputs, and GENERATE the manifest from
 * them — a single source of truth, nothing to keep in sync by hand.
 */
async function buildNode(cwd: string): Promise<void> {
  const pkgPath = path.join(cwd, "package.json");
  if (!(await exists(pkgPath))) {
    console.error("No package.json found. Run this from your plugin's root.");
    process.exit(1);
  }
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf-8")) as PackageMetadata;

  let entryPoint: NodeEntryPoint;
  try {
    entryPoint = await resolveNodeEntryPoint(cwd);
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }

  const metadata = packageMetadata(pkg);

  console.log(`Building ${pkg.name}@${pkg.version} (node, ${entryPoint.language})...`);
  await typecheckIfConfigured(cwd, "lia build");

  const distDir = path.join(cwd, "dist");
  await fs.mkdir(distDir, { recursive: true });
  const bundlePath = path.join(distDir, "index.js");

  await esbuild({
    entryPoints: [entryPoint.path],
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node18",
    outfile: bundlePath,
    external: [],
    minify: false,
  });

  // Read the schema straight from the compiled plugin — the code is the source.
  const mod = await import(pathToFileURL(bundlePath).href);
  const def = mod.default as CompiledNodeModule | undefined;
  validateNodeModule(def);

  const manifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    runtime: "node",
    category: metadata.category,
    tags: metadata.tags,
    inputSchema: serializeInputSchema(def.inputs),
    outputSchema: serializeOutputSchema(def.outputs),
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
  const m = JSON.parse(await fs.readFile(manifestPath, "utf-8")) as Record<string, unknown>;
  const metadata = wasmMetadata(m);
  const manifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    runtime: "wasm",
    category: metadata.category,
    tags: metadata.tags,
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
