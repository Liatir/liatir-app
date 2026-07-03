import * as fs from "fs/promises";
import * as path from "path";
import { pathToFileURL } from "url";
import { build as esbuild } from "esbuild";
import { execFile } from "child_process";
import { promisify } from "util";
import type {
  LiatirFieldSchema,
  LiatirInputFieldSchema,
  LiatirOutputFieldSchema,
  LiatirPluginManifest,
  LiatirPluginRuntime,
  LiatirPythonPluginRuntimeSpec,
  LiatirPythonRequirement,
  LiatirPythonRuntimePackage,
} from "@liatir/core";
import { typecheckIfConfigured } from "./_typecheck.js";
import { resolveNodeEntryPoint, type NodeEntryPoint } from "./_entry.js";

const execFileAsync = promisify(execFile);

// A field as produced at runtime by the @liatir/api field/input/output builders.
type RuntimeField = LiatirFieldSchema & {
  ext?: string[];
  format?: LiatirOutputFieldSchema["format"];
  __t?: unknown;
};

type CompiledNodePlugin = {
  __liatirPlugin?: unknown;
  __liatirPluginContract?: unknown;
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

type RawManifest = Record<string, unknown>;
type BundlePayload = {
  name: string;
  path: string;
};

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

function failInvalidNodePlugin(message: string): never {
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

function cleanStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
  return values.length > 0 ? [...new Set(values)] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function cleanPythonPackages(value: unknown): LiatirPythonRuntimePackage[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const packages = value
    .filter(isRecord)
    .map((item) => {
      const packageName = cleanOptionalString(item.package);
      if (!packageName) return null;
      const pkg: LiatirPythonRuntimePackage = { package: packageName };
      const version = cleanOptionalString(item.version);
      const specifier = cleanOptionalString(item.specifier);
      const importName = cleanOptionalString(item.importName);
      const installOptions = isRecord(item.installOptions)
        ? { noBuildIsolation: item.installOptions.noBuildIsolation === true }
        : undefined;
      if (version) pkg.version = version;
      if (specifier) pkg.specifier = specifier;
      if (importName) pkg.importName = importName;
      if (installOptions) pkg.installOptions = installOptions;
      return pkg;
    })
    .filter((item): item is LiatirPythonRuntimePackage => item !== null);
  return packages.length > 0 ? packages : undefined;
}

function cleanPythonRequirement(value: unknown): LiatirPythonRequirement | undefined {
  if (!isRecord(value)) return undefined;
  const requirement: LiatirPythonRequirement = {};
  const minVersion = cleanOptionalString(value.minVersion);
  const maxVersionExclusive = cleanOptionalString(value.maxVersionExclusive);
  const label = cleanOptionalString(value.label);
  const reason = cleanOptionalString(value.reason);
  if (minVersion) requirement.minVersion = minVersion;
  if (maxVersionExclusive) requirement.maxVersionExclusive = maxVersionExclusive;
  if (label) requirement.label = label;
  if (reason) requirement.reason = reason;
  return Object.keys(requirement).length > 0 ? requirement : undefined;
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
    name: cleanOptionalString(raw.name) ?? "WASM plugin",
    version: cleanOptionalString(raw.version) ?? "1.0.0",
    description: cleanOptionalString(raw.description) ?? "",
    category: cleanOptionalString(raw.category),
    tags: cleanTags(raw.tags),
  };
}

function manifestRuntime(raw: RawManifest | null): LiatirPluginRuntime | undefined {
  const runtime = raw?.runtime;
  return runtime === "node" || runtime === "wasm" || runtime === "python" ? runtime : undefined;
}

function validateRelativePath(value: string, fieldName: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (!normalized || normalized.startsWith("/") || normalized.includes("../") || normalized === "..") {
    throw new Error(`${fieldName} must be a relative path inside the plugin project.`);
  }
  return normalized;
}

async function readRawManifest(cwd: string): Promise<RawManifest | null> {
  const manifestPath = path.join(cwd, ".lia-manifest.json");
  if (!(await exists(manifestPath))) return null;
  return JSON.parse(await fs.readFile(manifestPath, "utf-8")) as RawManifest;
}

async function readRequirementsFile(cwd: string): Promise<string[] | undefined> {
  const requirementsPath = path.join(cwd, "requirements.txt");
  if (!(await exists(requirementsPath))) return undefined;
  const lines = (await fs.readFile(requirementsPath, "utf-8"))
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*/, "").trim())
    .filter(Boolean);
  return lines.length > 0 ? lines : undefined;
}

async function filesUnder(root: string): Promise<string[]> {
  const ignored = new Set(["__pycache__", ".git", ".lia-dev", ".liatir", ".mypy_cache", ".pytest_cache", ".venv", "venv"]);
  const entries = await fs.readdir(root, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...await filesUnder(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

function validateNodePlugin(def: CompiledNodePlugin | undefined): asserts def is {
  __liatirPlugin?: true;
  inputs: Record<string, RuntimeField>;
  outputs: Record<string, RuntimeField>;
  run: (input: Record<string, unknown>) => Promise<unknown>;
} {
  if (!def || typeof def !== "object") {
    failInvalidNodePlugin("The plugin entrypoint must default-export definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... }).");
  }

  if (def.__liatirPluginContract === true && typeof def.run !== "function") {
    failInvalidNodePlugin("Plugin contract is missing .main(...). Finish the default export with definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... }).");
  }

  if (def.__liatirPlugin !== true || typeof def.run !== "function") {
    failInvalidNodePlugin("Invalid .lia plugin entrypoint. Use: export default definePlugin({ inputs, outputs }).main(async ({ input, Liatir }) => { ... });");
  }

  if (!isPlainRecord(def.inputs)) {
    failInvalidNodePlugin("Invalid .lia plugin contract: definePlugin({ inputs }) must be an object.");
  }

  if (!isPlainRecord(def.outputs)) {
    failInvalidNodePlugin("Invalid .lia plugin contract: definePlugin({ outputs }) must be an object.");
  }
}

export async function build() {
  const cwd = process.cwd();
  const rawManifest = await readRawManifest(cwd);
  const runtime = manifestRuntime(rawManifest);

  if (runtime === "python") {
    await buildPython(cwd, rawManifest!);
    return;
  }

  if (runtime === "wasm" || await exists(path.join(cwd, "Cargo.toml"))) {
    await buildWasm(cwd, rawManifest ?? undefined);
    return;
  }

  await buildNode(cwd);
}

/**
 * Node plugin: the I/O schema lives IN THE CODE (definePlugin). We bundle, import
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
  await typecheckIfConfigured(cwd, "liatir build");

  const liatirDir = path.join(cwd, ".liatir");
  const distDir = path.join(liatirDir, "build-artifacts");
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
  const def = mod.default as CompiledNodePlugin | undefined;
  validateNodePlugin(def);

  const manifest: LiatirPluginManifest = {
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
  await createBundle(path.join(liatirDir, outputName), manifest, [{ name: "index.js", path: bundlePath }]);
  console.log(`✓ Built → ${outputName}`);
}

/**
 * WASM custom tool: the schema lives in .lia-manifest.json (Rust can't export a
 * JS schema at build time). We compile the crate and package plugin.wasm.
 */
async function buildWasm(cwd: string, rawManifest?: RawManifest): Promise<void> {
  const m = rawManifest ?? await readRawManifest(cwd);
  if (!m) {
    console.error("No .lia-manifest.json found. Run this from your tool's root.");
    process.exit(1);
  }
  const metadata = wasmMetadata(m);
  const manifest: LiatirPluginManifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    runtime: "wasm",
    category: metadata.category,
    tags: metadata.tags,
    inputSchema: isRecord(m.inputSchema) ? m.inputSchema as Record<string, LiatirInputFieldSchema> : {} as Record<string, LiatirInputFieldSchema>,
    outputSchema: isRecord(m.outputSchema) ? m.outputSchema as Record<string, LiatirOutputFieldSchema> : {} as Record<string, LiatirOutputFieldSchema>,
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
  const liatirDir = path.join(cwd, ".liatir");
  await createBundle(path.join(liatirDir, outputName), manifest, [{ name: "plugin.wasm", path: path.join(releaseDir, wasmFile) }]);
  console.log(`✓ Built → ${outputName}`);
}

async function buildPython(cwd: string, rawManifest: RawManifest): Promise<void> {
  const metadata = wasmMetadata(rawManifest);
  const rawPython = isRecord(rawManifest.python) ? rawManifest.python : {};
  const sourceEntry = validateRelativePath(
    cleanOptionalString(rawPython.entry) ?? cleanOptionalString(rawManifest.entry) ?? "src/main.py",
    "python.entry",
  );
  const entryPath = path.resolve(cwd, sourceEntry);
  if (!(await exists(entryPath))) {
    throw new Error(`Python plugin entry not found: ${sourceEntry}`);
  }

  const sourceRoot = path.dirname(entryPath);
  const sourceFiles = await filesUnder(sourceRoot);
  if (sourceFiles.length === 0) {
    throw new Error(`No Python source files found in ${path.relative(cwd, sourceRoot) || "."}`);
  }

  const entryRelativeToRoot = path.relative(sourceRoot, entryPath).split(path.sep).join("/");
  const payloads = sourceFiles.map((file) => ({
    name: `python/${path.relative(sourceRoot, file).split(path.sep).join("/")}`,
    path: file,
  }));

  const requirements =
    cleanStringArray(rawPython.requirements)
    ?? cleanStringArray(rawManifest.requirements)
    ?? await readRequirementsFile(cwd);

  const python: LiatirPythonPluginRuntimeSpec = {
    entry: `python/${entryRelativeToRoot}`,
    packages: cleanPythonPackages(rawPython.packages ?? rawManifest.runtimePackages),
    requirements,
    pythonRequirement: cleanPythonRequirement(rawPython.pythonRequirement ?? rawPython.python ?? rawManifest.pythonRequirement),
  };

  const manifest: LiatirPluginManifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    runtime: "python",
    category: metadata.category,
    tags: metadata.tags,
    inputSchema: isRecord(rawManifest.inputSchema) ? rawManifest.inputSchema as Record<string, LiatirInputFieldSchema> : {} as Record<string, LiatirInputFieldSchema>,
    outputSchema: isRecord(rawManifest.outputSchema) ? rawManifest.outputSchema as Record<string, LiatirOutputFieldSchema> : {} as Record<string, LiatirOutputFieldSchema>,
    python,
  };

  console.log(`Building ${manifest.name}@${manifest.version} (python)...`);
  const outputName = `${bareName(manifest.name)}.lia`;
  const liatirDir = path.join(cwd, ".liatir");
  await createBundle(path.join(liatirDir, outputName), manifest, payloads);
  console.log(`✓ Built → ${outputName}`);
}

/** Write the .lia zip: signature + manifest + runtime payloads. */
async function createBundle(
  outputPath: string,
  manifest: object,
  payloads: BundlePayload[],
): Promise<void> {
  const { default: JSZip } = await import("jszip").catch(() => {
    throw new Error("jszip not found. Run: npm install jszip");
  });
  const zip = new JSZip();
  zip.file("_sig", "LIATIR/1");
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  for (const payload of payloads) {
    zip.file(validateRelativePath(payload.name, "payload path"), await fs.readFile(payload.path));
  }
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content);
}
