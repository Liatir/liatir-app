/**
 * `liatir update` — bring a plugin project's Liatir packages up to date.
 *
 * The two packages are always moved in lockstep: `@liatir/api` is the plugin's runtime contract
 * and `@liatir/cli` is what builds against it, so a project with mismatched versions of the two
 * can fail in confusing ways. Updating them together is the whole point of having this command
 * rather than telling authors to run `npm install` themselves.
 *
 * Two modes:
 *   - default: let npm resolve and install, then report what it saved;
 *   - `--no-install`: rewrite package.json only, for offline or CI use.
 */
import * as fs from "fs/promises";
import * as path from "path";
import { execFile, spawn } from "child_process";
import { promisify } from "util";

import { formatProcessError } from "./_process.js";

const execFileAsync = promisify(execFile);

const LIATIR_PACKAGES = ["@liatir/cli", "@liatir/api"] as const;

type LiatirPackageName = typeof LIATIR_PACKAGES[number];
type DependencyBlockName = "dependencies" | "devDependencies" | "peerDependencies" | "optionalDependencies";

interface ParsedUpdateArgs {
  version?: string;
  install: boolean;
  dryRun: boolean;
  exact: boolean;
  help: boolean;
}

interface PackageJson {
  name?: string;
  scripts?: Record<string, unknown>;
  liatir?: unknown;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * All four blocks are searched, not just devDependencies, because an author may have added the
 * packages anywhere. Update normalises them into devDependencies regardless of where it finds them.
 */
const DEPENDENCY_BLOCKS: DependencyBlockName[] = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function usage(): string {
  return `liatir update — update a Node .lia project's Liatir packages

Usage:
  liatir update
  liatir update --version x.x.x
  liatir update --no-install --version x.x.x
  liatir update --dry-run

Options:
  --version <version>  Install a specific @liatir/cli and @liatir/api version
  --exact              Save exact versions instead of npm's default range
  --no-install         Edit package.json only, then print the npm install step
  --dry-run            Show what would change without writing files
  --help               Show this help message
`;
}

function requireFlagValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value after ${flag}.`);
  }
  return value;
}

/** Parses the flags, accepting both `--version 1.2.3` and `--version=1.2.3`. */
function parseUpdateArgs(args: string[]): ParsedUpdateArgs {
  const parsed: ParsedUpdateArgs = {
    install: true,
    dryRun: false,
    exact: false,
    help: false,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    // Split on the first `=` only, so a value containing `=` survives intact.
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];

    // A bare argument is taken as the version, so `liatir update 1.2.3` works as a shorthand.
    if (!arg.startsWith("-")) {
      if (parsed.version) throw new Error(`Unexpected extra argument "${arg}".`);
      parsed.version = arg;
      continue;
    }

    switch (flag) {
      case "--help":
      case "-h":
        parsed.help = true;
        break;
      case "--version":
        parsed.version = inlineValue ?? requireFlagValue(args, index, flag);
        if (inlineValue === undefined) index += 1;
        break;
      case "--exact":
        parsed.exact = true;
        break;
      case "--install":
        parsed.install = true;
        break;
      case "--no-install":
        parsed.install = false;
        break;
      case "--dry-run":
        parsed.dryRun = true;
        break;
      default:
        throw new Error(`Unknown option "${arg}".`);
    }
  }

  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function dependencyBlock(pkg: PackageJson, blockName: DependencyBlockName): Record<string, string> | undefined {
  const block = pkg[blockName];
  return isStringRecord(block) ? block : undefined;
}

function hasLiatirPackageDependency(pkg: PackageJson): boolean {
  return LIATIR_PACKAGES.some((packageName) =>
    DEPENDENCY_BLOCKS.some((blockName) => dependencyBlock(pkg, blockName)?.[packageName]),
  );
}

function hasLiatirScript(pkg: PackageJson): boolean {
  return Object.values(pkg.scripts ?? {}).some((script) =>
    typeof script === "string" && /\bliatir\s+(build|dev|update)\b/.test(script),
  );
}

/**
 * Three independent signals, any one of which is enough.
 *
 * Being generous here matters: refusing to update a project that *is* a plugin, merely because it
 * declares itself unusually, is worse than the alternative — and this command only ever touches
 * the two Liatir packages, so a false positive cannot damage an unrelated project.
 */
function isNodeLiatirProject(pkg: PackageJson): boolean {
  return hasLiatirPackageDependency(pkg) || isRecord(pkg.liatir) || hasLiatirScript(pkg);
}

/**
 * Walks up from `startDir` looking for a file, so the command works from any subdirectory of the
 * project rather than only from its root. Stops at the filesystem root, where `dirname` becomes a
 * fixed point.
 */
async function findNearestFile(startDir: string, fileName: string): Promise<string | undefined> {
  let currentDir = path.resolve(startDir);

  while (true) {
    if (await exists(path.join(currentDir, fileName))) return currentDir;

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return undefined;
    currentDir = parentDir;
  }
}

async function readPackageJson(projectRoot: string): Promise<PackageJson> {
  const packagePath = path.join(projectRoot, "package.json");
  return JSON.parse(await fs.readFile(packagePath, "utf-8")) as PackageJson;
}

function packageSpec(packageName: LiatirPackageName, version: string | undefined): string {
  return `${packageName}@${version ?? "latest"}`;
}

/**
 * Turns a resolved version into what gets written to package.json.
 *
 * Only a plain semver gets a caret. Anything else — a dist-tag like `next`, a git URL, a range the
 * author typed — is passed through untouched, because prefixing those with `^` would produce a
 * specifier npm cannot resolve.
 */
function dependencyRange(version: string, exact: boolean): string {
  if (exact) return version;
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? `^${version}` : version;
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

/**
 * Asks the registry for the latest version of each package.
 *
 * Only needed on the `--no-install` path: when npm does the install it resolves `@latest` itself.
 * Run from the project root so the author's registry and auth configuration applies.
 */
async function fetchLatestVersions(projectRoot: string): Promise<Record<LiatirPackageName, string>> {
  const versions = {} as Record<LiatirPackageName, string>;

  for (const packageName of LIATIR_PACKAGES) {
    try {
      const { stdout } = await execFileAsync("npm", ["view", packageName, "version", "--silent"], { cwd: projectRoot });
      const version = stdout.trim();
      if (!version) throw new Error(`npm did not return a version for ${packageName}.`);
      versions[packageName] = version;
    } catch (err) {
      throw new Error(`Could not resolve latest ${packageName} version:\n${formatProcessError(err)}`);
    }
  }

  return versions;
}

function ensureDevDependencies(pkg: PackageJson): Record<string, string> {
  if (!isStringRecord(pkg.devDependencies)) {
    pkg.devDependencies = {};
  }
  return pkg.devDependencies;
}

/**
 * Rewrites the Liatir entries in package.json (the `--no-install` path).
 *
 * Each package is first deleted from *every* dependency block and only then re-added under
 * devDependencies. That order is what makes the operation idempotent and self-correcting: a
 * project that had `@liatir/api` under `dependencies` ends up with a single entry in the right
 * place, rather than two conflicting ones in two blocks.
 *
 * devDependencies is the correct home because these packages are build-time tooling — the
 * finished `.lia` bundle does not depend on them at runtime.
 */
function applyPackageJsonUpdates(
  pkg: PackageJson,
  targetVersions: Record<LiatirPackageName, string>,
  exact: boolean,
): Record<LiatirPackageName, string> {
  const savedRanges = {} as Record<LiatirPackageName, string>;
  const devDependencies = ensureDevDependencies(pkg);

  for (const packageName of LIATIR_PACKAGES) {
    for (const blockName of DEPENDENCY_BLOCKS) {
      const block = dependencyBlock(pkg, blockName);
      if (block) delete block[packageName];
    }

    const savedRange = dependencyRange(targetVersions[packageName], exact);
    devDependencies[packageName] = savedRange;
    savedRanges[packageName] = savedRange;
  }

  return savedRanges;
}

async function writePackageJson(projectRoot: string, pkg: PackageJson): Promise<void> {
  const packagePath = path.join(projectRoot, "package.json");
  await fs.writeFile(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
}

/**
 * Runs npm with its output inherited, so the author watches the install progress live instead of
 * staring at a silent terminal. Resolves only on exit code 0.
 */
function runNpm(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("npm", args, { cwd, stdio: "inherit" });
    // `error` is npm failing to launch; a non-zero `exit` is npm running and failing. Both must
    // reject, or a failed install would look like a successful update.
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`npm exited with code ${code ?? "unknown"}.`));
      }
    });
  });
}

/**
 * A WASM (Rust) plugin has no package.json and no `@liatir/api` dependency — the contract is
 * compiled in — so there is nothing for this command to rewrite. Rather than failing with
 * "not a Node project", point the author at the one thing that *can* be updated: the global CLI.
 */
function printWasmUpdateHint(projectRoot: string): void {
  console.log(
    `Found a WASM .lia tool at ${projectRoot}.\n` +
    "WASM projects do not use @liatir/api. Update the CLI with:\n\n" +
    "  npm install -g @liatir/cli@latest\n",
  );
}

function printSavedRanges(savedRanges: Record<LiatirPackageName, string>): void {
  for (const packageName of LIATIR_PACKAGES) {
    console.log(`  ${packageName}: ${savedRanges[packageName]}`);
  }
}

/**
 * Reads back what npm actually wrote, so the summary reflects reality rather than what we asked
 * for. Searches every block because npm honours an existing placement instead of always using
 * devDependencies. A package that is missing afterwards means the install did not do what it
 * claimed, which is worth failing on.
 */
function readSavedLiatirRanges(pkg: PackageJson): Record<LiatirPackageName, string> {
  const savedRanges = {} as Record<LiatirPackageName, string>;

  for (const packageName of LIATIR_PACKAGES) {
    const savedRange = DEPENDENCY_BLOCKS
      .map((blockName) => dependencyBlock(pkg, blockName)?.[packageName])
      .find((value): value is string => Boolean(value));

    if (!savedRange) {
      throw new Error(`npm did not save ${packageName} in package.json.`);
    }

    savedRanges[packageName] = savedRange;
  }

  return savedRanges;
}

/**
 * Entry point: locate the project, confirm it is a Node plugin, then either install or rewrite.
 *
 * The WASM fallback is checked in both failure cases — no package.json at all, and a package.json
 * that is not a Liatir project — because in both a WASM author would otherwise get a misleading
 * error about a Node project they never had.
 */
export async function update(args: string[] = []): Promise<void> {
  const parsed = parseUpdateArgs(args);
  if (parsed.help) {
    console.log(usage());
    return;
  }

  const cwd = process.cwd();
  const projectRoot = await findNearestFile(cwd, "package.json");

  if (!projectRoot) {
    const wasmRoot = await findNearestFile(cwd, ".lia-manifest.json");
    if (wasmRoot) {
      printWasmUpdateHint(wasmRoot);
      return;
    }

    throw new Error("No package.json found. Run `liatir update` from a Node .lia plugin project.");
  }

  const pkg = await readPackageJson(projectRoot);
  if (!isNodeLiatirProject(pkg)) {
    const wasmRoot = await findNearestFile(cwd, ".lia-manifest.json");
    if (wasmRoot) {
      printWasmUpdateHint(wasmRoot);
      return;
    }

    throw new Error("This package does not look like a Node .lia plugin project.");
  }

  // Both packages in one npm invocation, so they are resolved together and the lockfile is
  // rewritten once.
  const installArgs = [
    "install",
    "--save-dev",
    ...(parsed.exact ? ["--save-exact"] : []),
    ...LIATIR_PACKAGES.map((packageName) => packageSpec(packageName, parsed.version)),
  ];

  // --dry-run reports and returns before anything is written or installed.
  if (parsed.dryRun) {
    console.log(`Would update Liatir packages in ${projectRoot}.`);
    if (parsed.install) {
      console.log(`Would run: ${formatCommand("npm", installArgs)}`);
    } else if (parsed.version) {
      const targetVersions = Object.fromEntries(
        LIATIR_PACKAGES.map((packageName) => [packageName, parsed.version]),
      ) as Record<LiatirPackageName, string>;
      console.log("Would write these package.json devDependencies:");
      printSavedRanges(
        Object.fromEntries(
          LIATIR_PACKAGES.map((packageName) => [packageName, dependencyRange(targetVersions[packageName], parsed.exact)]),
        ) as Record<LiatirPackageName, string>,
      );
    } else {
      console.log("Would resolve latest versions from npm and write package.json devDependencies.");
    }
    return;
  }

  // Default path: npm resolves, installs and updates the lockfile. package.json is re-read
  // afterwards so the summary shows what was actually saved, not what was requested.
  if (parsed.install) {
    console.log(`Updating Liatir packages in ${projectRoot}...`);
    await runNpm(installArgs, projectRoot);

    const updatedPkg = await readPackageJson(projectRoot);
    console.log("Updated Liatir package ranges:");
    printSavedRanges(readSavedLiatirRanges(updatedPkg));
    return;
  }

  // --no-install path: an explicit version is taken as given, otherwise the registry is queried
  // for the latest — because package.json cannot be written without knowing a concrete version.
  const targetVersions = parsed.version
    ? Object.fromEntries(LIATIR_PACKAGES.map((packageName) => [packageName, parsed.version])) as Record<LiatirPackageName, string>
    : await fetchLatestVersions(projectRoot);

  const savedRanges = applyPackageJsonUpdates(pkg, targetVersions, parsed.exact);
  await writePackageJson(projectRoot, pkg);

  console.log("Updated package.json Liatir package ranges:");
  printSavedRanges(savedRanges);
  // package.json and package-lock.json are now out of sync; say so rather than leaving the author
  // to discover it at the next install.
  console.log("\nRun `npm install` to refresh package-lock.json and node_modules.");
}
