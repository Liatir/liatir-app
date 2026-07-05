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
import { assetPath, assetsDir, syncManagedSdkFile } from "./_assets.js";
import { formatProcessError } from "./_process.js";
import {
  buildSignatureEntries,
  defaultKeyPath,
  loadSigningKey,
  type BundleEntry,
} from "../signing.js";

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
interface BuildOptions {
  outputDir?: string;
  outputName?: string;
  quiet?: boolean;
  /**
   * Whether to Ed25519-sign the bundle. "auto" (default for `liatir build`)
   * signs when a signing key exists, otherwise builds unsigned. `false` (dev
   * builds) never signs — dev bundles are ephemeral and rebuilt constantly.
   */
  sign?: "auto" | false;
}

interface NearbyPluginProject {
  name: string;
  runtime: string;
}

export interface BuildResult {
  path: string;
  manifest: LiatirPluginManifest;
  runtime: LiatirPluginRuntime;
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

function failInvalidNodePlugin(message: string): never {
  console.error(message);
  process.exit(1);
}

// ── Code-declared contracts (Python/WASM SDK) ────────────────────────────────
// Python and WASM plugins declare the SAME define_plugin contract as Node, via
// the CLI-managed SDK files (liatir.py / liatir.rs). The build reads it back:
// - Python: the extractor imports the entry module and prints the contract.
// - WASM: the compiled binary prints it when run with LIATIR_EMIT_CONTRACT=1.
// Plugins without the SDK keep working with a manifest-owned schema (legacy).
//
// Whether a failure to read the contract is fatal depends on the project: a
// present SDK file (src/liatir.py / src/liatir.rs) marks an SDK project, and
// those FAIL CLOSED (never silently ship a stale/empty schema); projects
// without it are legacy and fall back to the manifest with a warning.

// These markers must stay in sync with assets/liatir.rs (CONTRACT_MARKER),
// assets/extract-lia-contract.py (all three), and are exercised end-to-end by
// tests/unit/python-plugin-runtime.test.ts, which fails on any mismatch.
const CONTRACT_MARKER = "__LIATIR_CONTRACT__";
const LEGACY_MARKER = "__LIATIR_LEGACY__";
const STUBBED_MARKER = "__LIATIR_STUBBED__";
const SUPPORTED_CONTRACT_VERSION = 1;

interface CodeContract {
  inputs: Record<string, RuntimeField>;
  outputs: Record<string, RuntimeField>;
  /** Top-level import names stubbed during Python extraction (informative). */
  stubbedImports?: string[];
}

type ContractExtraction =
  | { kind: "contract"; contract: CodeContract }
  | { kind: "legacy" }                       // code has no SDK contract
  | { kind: "unavailable"; reason: string }  // could not check (no interpreter/WASI)
  | { kind: "error"; details: string };      // extraction ran and failed

/** Scan extractor stdout for the contract or legacy marker line. */
function parseContractOutput(stdout: string): CodeContract | "legacy" | null {
  let contract: CodeContract | null = null;
  let legacy = false;
  const stubbedImports: string[] = [];

  for (const line of stdout.split(/\r?\n/)) {
    if (line.startsWith(LEGACY_MARKER)) {
      legacy = true;
      continue;
    }
    if (line.startsWith(STUBBED_MARKER)) {
      stubbedImports.push(...line.slice(STUBBED_MARKER.length).split(",").map((n) => n.trim()).filter(Boolean));
      continue;
    }
    if (!line.startsWith(CONTRACT_MARKER)) continue;

    let parsed: unknown;
    try {
      parsed = JSON.parse(line.slice(CONTRACT_MARKER.length));
    } catch {
      throw new Error("The plugin SDK emitted an unreadable contract (invalid JSON).");
    }
    if (!isRecord(parsed) || !isPlainRecord(parsed.inputs) || !isPlainRecord(parsed.outputs)) {
      throw new Error("The plugin SDK emitted an invalid contract: inputs/outputs must be objects.");
    }
    if (typeof parsed.liatirContract === "number" && parsed.liatirContract > SUPPORTED_CONTRACT_VERSION) {
      throw new Error(
        `The plugin declares contract version ${parsed.liatirContract}, but this CLI supports up to ${SUPPORTED_CONTRACT_VERSION}. Update @liatir/cli.`,
      );
    }
    contract = { inputs: parsed.inputs, outputs: parsed.outputs };
  }

  if (contract) {
    if (stubbedImports.length > 0) contract.stubbedImports = stubbedImports;
    return contract;
  }
  return legacy ? "legacy" : null;
}

// The interpreter on PATH does not change while the CLI runs; cache the probe
// so `liatir dev` does not respawn `python --version` on every rebuild.
let cachedPythonBinary: Promise<string | null> | undefined;

function findPythonBinary(): Promise<string | null> {
  cachedPythonBinary ??= (async () => {
    const fromEnv = process.env["LIATIR_PYTHON"];
    const candidates = fromEnv ? [fromEnv, "python3", "python"] : ["python3", "python"];
    for (const candidate of candidates) {
      try {
        await execFileAsync(candidate, ["--version"]);
        return candidate;
      } catch {
        // Try the next candidate.
      }
    }
    return null;
  })();
  return cachedPythonBinary;
}

async function extractPythonContract(entryPath: string): Promise<ContractExtraction> {
  const python = await findPythonBinary();
  if (!python) {
    return {
      kind: "unavailable",
      reason: "Python 3 was not found on PATH (set LIATIR_PYTHON to your interpreter).",
    };
  }

  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      python,
      [assetPath("extract-lia-contract.py"), entryPath, assetsDir()],
      { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 },
    ));
  } catch (error) {
    return {
      kind: "error",
      details: `Reading the plugin contract from ${path.basename(entryPath)} failed:\n${formatProcessError(error)}`,
    };
  }

  const parsed = parseContractOutput(stdout);
  if (parsed === "legacy") return { kind: "legacy" };
  if (parsed) return { kind: "contract", contract: parsed };
  return { kind: "error", details: `The contract extractor produced no result for ${path.basename(entryPath)}.` };
}

/**
 * Run the compiled wasm once with LIATIR_EMIT_CONTRACT=1 and scan stdout for
 * the contract marker. A clean run without the marker is a legacy binary; any
 * failure (node:wasi unavailable, trap/panic, timeout) is reported as an
 * error with the child's output so SDK projects can fail closed with a cause.
 */
async function extractWasmContract(wasmPath: string): Promise<ContractExtraction> {
  let stdout: string;
  try {
    const child = execFileAsync(
      process.execPath,
      [assetPath("extract-wasm-contract.mjs"), wasmPath],
      {
        timeout: 15_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, NODE_NO_WARNINGS: "1" },
      },
    );
    // No input: legacy binaries that read stdin see EOF instead of hanging.
    child.child.stdin?.end();
    ({ stdout } = await child);
  } catch (error) {
    // A contract emitted before a late failure still counts.
    const failedStdout = (error as { stdout?: unknown }).stdout;
    if (typeof failedStdout === "string") {
      const parsed = parseContractOutput(failedStdout);
      if (parsed && parsed !== "legacy") return { kind: "contract", contract: parsed };
    }
    return {
      kind: "error",
      details: `Reading the plugin contract from ${path.basename(wasmPath)} failed:\n${formatProcessError(error)}`,
    };
  }

  const parsed = parseContractOutput(stdout);
  if (parsed && parsed !== "legacy") return { kind: "contract", contract: parsed };
  return { kind: "legacy" };
}

interface ResolvedSchemas {
  inputSchema: Record<string, LiatirInputFieldSchema>;
  outputSchema: Record<string, LiatirOutputFieldSchema>;
  fromContract: boolean;
}

interface SchemaResolutionContext {
  extraction: ContractExtraction;
  rawManifest: RawManifest;
  /** src/liatir.py / src/liatir.rs present → SDK project → fail closed. */
  sdkFilePresent: boolean;
  /** Runtime-specific hint on how to declare the contract. */
  sdkHint: string;
  quiet: boolean;
}

/**
 * Pick the I/O schema for a Python/WASM manifest.
 *
 * - Code contract found → it wins (manifest schemas, if any, are ignored).
 * - SDK project (managed SDK file present) but the contract could not be
 *   read → hard error with the real cause; never ship a stale/empty schema.
 * - Legacy project → manifest schemas; if it has none, build with an empty
 *   schema exactly as older CLIs did, and say how to declare the contract.
 */
function resolveDeclaredSchemas(context: SchemaResolutionContext): ResolvedSchemas {
  const { extraction, rawManifest, sdkFilePresent, sdkHint, quiet } = context;
  const manifestInput = isRecord(rawManifest.inputSchema) && Object.keys(rawManifest.inputSchema).length > 0
    ? rawManifest.inputSchema as Record<string, LiatirInputFieldSchema>
    : undefined;
  const manifestOutput = isRecord(rawManifest.outputSchema) && Object.keys(rawManifest.outputSchema).length > 0
    ? rawManifest.outputSchema as Record<string, LiatirOutputFieldSchema>
    : undefined;

  if (extraction.kind === "contract") {
    if (!quiet) {
      if (manifestInput || manifestOutput) {
        console.log("Schema comes from the define_plugin contract in the code; inputSchema/outputSchema in .lia-manifest.json are ignored and can be removed.");
      }
      const stubbed = extraction.contract.stubbedImports;
      if (stubbed && stubbed.length > 0) {
        console.log(`Imports assumed available at run time (not installed while reading the contract): ${stubbed.join(", ")}. Check the names and declare them in the plugin requirements.`);
      }
    }
    return {
      inputSchema: serializeInputSchema(extraction.contract.inputs),
      outputSchema: serializeOutputSchema(extraction.contract.outputs),
      fromContract: true,
    };
  }

  // SDK project without a readable contract: failing open here would ship a
  // stale or empty schema that no longer matches the code.
  if (sdkFilePresent) {
    const cause = extraction.kind === "legacy"
      ? "The entry point does not expose a define_plugin contract."
      : extraction.kind === "unavailable" ? extraction.reason : extraction.details;
    throw new Error(`Could not read the plugin contract from the code.\n${cause}\n${sdkHint}`);
  }

  // Legacy project: manifest owns the schema, and extraction problems only warn.
  if (!quiet && (extraction.kind === "unavailable" || extraction.kind === "error")) {
    const reason = extraction.kind === "unavailable" ? extraction.reason : extraction.details;
    console.warn(`Skipping the code contract check: ${reason}`);
  }
  if (!manifestInput && !manifestOutput) {
    if (!quiet) {
      console.warn(`No I/O schema declared: building with an empty contract.\n${sdkHint}`);
    }
    return { inputSchema: {}, outputSchema: {}, fromContract: false };
  }
  return {
    inputSchema: manifestInput ?? {},
    outputSchema: manifestOutput ?? {},
    fromContract: false,
  };
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

async function nearbyPluginProjects(cwd: string): Promise<NearbyPluginProject[]> {
  let entries: import("fs").Dirent[] = [];
  try {
    entries = await fs.readdir(cwd, { withFileTypes: true });
  } catch {
    return [];
  }

  const projects: NearbyPluginProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const dir = path.join(cwd, entry.name);
    const rawManifest = await readRawManifest(dir).catch(() => null);
    const runtime = manifestRuntime(rawManifest);
    if (runtime) {
      projects.push({ name: entry.name, runtime });
      continue;
    }
    if (await exists(path.join(dir, "package.json"))) {
      projects.push({ name: entry.name, runtime: "node" });
      continue;
    }
    if (await exists(path.join(dir, "Cargo.toml"))) {
      projects.push({ name: entry.name, runtime: "wasm" });
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name));
}

async function noPluginProjectError(cwd: string): Promise<Error> {
  const nearby = await nearbyPluginProjects(cwd);
  const nearbyText = (() => {
    if (nearby.length === 0) return "";
    const projects = nearby.slice(0, 8).map((project) => `- ${project.name} (${project.runtime})`).join("\n");
    if (nearby.length === 1) {
      return `\n\nNearby plugin project:\n${projects}\n\nRun:\n  cd ${nearby[0].name}\n  liatir dev`;
    }
    return `\n\nNearby plugin projects:\n${projects}\n\nRun from the plugin folder you want to test:\n  cd <plugin-folder>\n  liatir dev`;
  })();
  return new Error(
    `No Liatir plugin project found in ${path.basename(cwd) || cwd}.\n\n` +
    `Run this command from a plugin root. Expected one of:\n` +
    `- .lia-manifest.json with runtime "python" or "wasm"\n` +
    `- package.json with src/index.ts or src/index.js for a Node plugin\n` +
    `- Cargo.toml plus .lia-manifest.json for a WASM plugin` +
    nearbyText
  );
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

async function buildPluginBundle(options: BuildOptions = {}): Promise<BuildResult> {
  const cwd = process.cwd();
  const rawManifest = await readRawManifest(cwd);
  const runtime = manifestRuntime(rawManifest);
  const hasPackageJson = await exists(path.join(cwd, "package.json"));
  const hasCargoToml = await exists(path.join(cwd, "Cargo.toml"));

  if (runtime === "python") {
    return buildPython(cwd, rawManifest!, options);
  }

  if (runtime === "wasm" || (rawManifest && hasCargoToml)) {
    return buildWasm(cwd, rawManifest ?? undefined, options);
  }

  if (runtime === "node" || hasPackageJson) {
    return buildNode(cwd, options);
  }

  if (rawManifest) {
    throw new Error(
      `Unsupported .lia-manifest.json runtime in ${path.basename(cwd) || cwd}.\n` +
      `Expected runtime "python", "wasm", or "node".`
    );
  }

  if (hasCargoToml) {
    throw new Error("No .lia-manifest.json found. WASM plugins need a manifest next to Cargo.toml.");
  }

  throw await noPluginProjectError(cwd);
}

export async function build(): Promise<void> {
  await buildPluginBundle();
}

export async function buildDevBundle(): Promise<BuildResult> {
  return buildPluginBundle({
    outputDir: path.join(process.cwd(), ".lia-dev"),
    outputName: "current.lia",
    quiet: false,
    sign: false,
  });
}

/**
 * Node plugin: the I/O schema lives IN THE CODE (definePlugin). We bundle, import
 * the bundle to read its declared inputs/outputs, and GENERATE the manifest from
 * them — a single source of truth, nothing to keep in sync by hand.
 */
async function buildNode(cwd: string, options: BuildOptions = {}): Promise<BuildResult> {
  const pkgPath = path.join(cwd, "package.json");
  if (!(await exists(pkgPath))) {
    throw await noPluginProjectError(cwd);
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

  if (!options.quiet) console.log(`Building ${pkg.name}@${pkg.version} (node, ${entryPoint.language})...`);
  await typecheckIfConfigured(cwd, "liatir build");

  const outputDir = options.outputDir ?? path.join(cwd, ".liatir");
  const distDir = path.join(outputDir, "build-artifacts");
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
  // The bundle path is stable across rebuilds, and Node's ESM loader caches
  // modules by URL for the whole process. `liatir dev` rebuilds in a single
  // long-lived process, so a bare import would return the FIRST build's module
  // and miss later schema edits. A unique query per build forces a fresh load.
  const mod = await import(`${pathToFileURL(bundlePath).href}?v=${Date.now()}`);
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

  const outputName = options.outputName ?? `${bareName(pkg.name)}.lia`;
  const outputPath = path.join(outputDir, outputName);
  await createBundle(outputPath, manifest, [{ name: "index.js", path: bundlePath }], options);
  if (!options.quiet) console.log(`✓ Built → ${outputName}`);
  return { path: outputPath, manifest, runtime: "node" };
}

/**
 * WASM custom tool: the I/O contract is declared in the code with the
 * CLI-managed src/liatir.rs SDK module (same define_plugin API as Node and
 * Python). We compile the crate, run the binary once with
 * LIATIR_EMIT_CONTRACT=1 to read the contract back, and generate the manifest
 * schema from it. Tools without the SDK keep their manifest-owned schema.
 */
async function buildWasm(cwd: string, rawManifest?: RawManifest, options: BuildOptions = {}): Promise<BuildResult> {
  const m = rawManifest ?? await readRawManifest(cwd);
  if (!m) {
    console.error("No .lia-manifest.json found. Run this from your tool's root.");
    process.exit(1);
  }
  const metadata = wasmMetadata(m);

  if (!options.quiet) {
    console.log(`Building ${metadata.name}@${metadata.version} (wasm)...`);
  }

  // SDK projects carry src/liatir.rs: keep it in sync with this CLI version
  // before compiling. Legacy tools without the file are left untouched.
  const sdkModulePath = path.join(cwd, "src", "liatir.rs");
  if (await exists(sdkModulePath)) {
    if (await syncManagedSdkFile(sdkModulePath, "liatir.rs") && !options.quiet) {
      console.log("Synced src/liatir.rs (Liatir plugin SDK) with this CLI version.");
    }
  }

  if (!options.quiet) {
    console.log("Compiling Rust → wasm32-wasip1 (cargo build --release)...");
  }
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
  const wasmPath = path.join(releaseDir, wasmFile);

  const extraction = await extractWasmContract(wasmPath);
  const schemas = resolveDeclaredSchemas({
    extraction,
    rawManifest: m,
    sdkFilePresent: await exists(sdkModulePath),
    sdkHint:
      "Declare the contract once in src/main.rs with the Liatir SDK " +
      "(`mod liatir;` + define_plugin, scaffolded by `liatir init --wasm`).",
    quiet: options.quiet ?? false,
  });

  const manifest: LiatirPluginManifest = {
    name: metadata.name,
    version: metadata.version,
    description: metadata.description,
    runtime: "wasm",
    category: metadata.category,
    tags: metadata.tags,
    inputSchema: schemas.inputSchema,
    outputSchema: schemas.outputSchema,
  };

  const outputName = options.outputName ?? `${bareName(manifest.name)}.lia`;
  const outputDir = options.outputDir ?? path.join(cwd, ".liatir");
  const outputPath = path.join(outputDir, outputName);
  await createBundle(outputPath, manifest, [{ name: "plugin.wasm", path: wasmPath }], options);
  if (!options.quiet) console.log(`✓ Built → ${outputName}`);
  return { path: outputPath, manifest, runtime: "wasm" };
}

async function buildPython(cwd: string, rawManifest: RawManifest, options: BuildOptions = {}): Promise<BuildResult> {
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

  // I/O contract: read define_plugin(...) back from the entry module. Plugins
  // without the SDK stay on the manifest-owned schema (legacy).
  const extraction = await extractPythonContract(entryPath);
  const schemas = resolveDeclaredSchemas({
    extraction,
    rawManifest,
    sdkFilePresent: await exists(path.join(sourceRoot, "liatir.py")),
    sdkHint:
      "Declare the contract once in the entry module with the Liatir SDK " +
      "(`from liatir import define_plugin, field` + @plugin.main, scaffolded by `liatir init --python`).",
    quiet: options.quiet ?? false,
  });

  // SDK plugins ship the CLI-managed liatir.py next to the entry, so
  // `import liatir` resolves at run time and in editors. Synced BEFORE the
  // payload scan below so the bundle always carries the current version.
  if (schemas.fromContract) {
    if (await syncManagedSdkFile(path.join(sourceRoot, "liatir.py"), "liatir.py") && !options.quiet) {
      console.log("Synced liatir.py (Liatir plugin SDK) with this CLI version.");
    }
  }

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
    inputSchema: schemas.inputSchema,
    outputSchema: schemas.outputSchema,
    python,
  };

  if (!options.quiet) console.log(`Building ${manifest.name}@${manifest.version} (python)...`);
  const outputName = options.outputName ?? `${bareName(path.basename(cwd))}.lia`;
  const outputDir = options.outputDir ?? path.join(cwd, ".liatir");
  const outputPath = path.join(outputDir, outputName);
  await createBundle(outputPath, manifest, payloads, options);
  if (!options.quiet) console.log(`✓ Built → ${outputName}`);
  return { path: outputPath, manifest, runtime: "python" };
}

/**
 * Write the .lia zip: magic + manifest + runtime payloads, then optionally an
 * Ed25519 signature over all of them. The desktop app rejects a *signed* bundle
 * whose content was altered after signing; unsigned bundles stay valid (dev).
 */
async function createBundle(
  outputPath: string,
  manifest: object,
  payloads: BundlePayload[],
  options: BuildOptions = {},
): Promise<void> {
  const { default: JSZip } = await import("jszip").catch(() => {
    throw new Error("jszip not found. Run: npm install jszip");
  });
  const zip = new JSZip();

  // Collect entries first so the signature digest covers exactly what ships.
  const entries: BundleEntry[] = [
    { name: "_sig", content: Buffer.from("LIATIR/1", "utf8") },
    { name: "manifest.json", content: Buffer.from(JSON.stringify(manifest, null, 2), "utf8") },
  ];
  for (const payload of payloads) {
    entries.push({
      name: validateRelativePath(payload.name, "payload path"),
      content: await fs.readFile(payload.path),
    });
  }

  if (options.sign !== false) {
    const signingKey = await loadSigningKey(defaultKeyPath());
    if (signingKey) {
      const { entries: signatureEntries, fingerprint } = buildSignatureEntries(entries, signingKey);
      entries.push(...signatureEntries);
      if (!options.quiet) console.log(`Signed with key ${fingerprint}`);
    } else if (!options.quiet) {
      console.log("Building unsigned (run `liatir keygen` to sign your plugins).");
    }
  }

  for (const entry of entries) {
    zip.file(entry.name, entry.content);
  }
  const content = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, content);
}
