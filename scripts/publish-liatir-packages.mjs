/**
 * Publishes the public `.lia` npm packages.
 *
 * `@liatir/api` and `@liatir/cli` are released together at a single shared version. Keeping them
 * in lockstep is deliberate: the CLI builds plugins against the API's contract, so a plugin author
 * with mismatched versions of the two gets errors that are hard to attribute. One version number
 * across both makes "which versions go together?" unambiguous.
 *
 * Everything that carries the version number is rewritten before publishing — including the
 * dependency ranges in the `init` scaffold template, so a newly created plugin depends on the
 * versions that were just released rather than on whatever was current when the template was
 * last edited.
 *
 * `--dry-run` restores every file it touched afterwards, so it leaves no trace in the working tree.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** The scaffold template, whose pinned dependency ranges must follow the released version. */
const initCommandFile = "packages/liatir-cli/src/commands/init.ts";
/**
 * Publish order is dependency order: `@liatir/api` first, because a freshly published `@liatir/cli`
 * would otherwise briefly reference an API version that does not exist on the registry yet.
 */
const packages = [
  {
    label: "@liatir/api",
    dir: "packages/liatir-api",
  },
  {
    label: "@liatir/cli",
    dir: "packages/liatir-cli",
  },
];

function usage() {
  console.log(`Publish the .lia npm packages in dependency order.

Usage:
  npm run liatir:publish
  npm run liatir:publish -- --minor
  npm run liatir:publish -- --major
  npm run liatir:publish -- --version 1.10.0
  npm run liatir:publish -- --otp 123456
  npm run liatir:publish -- --tag next
  npm run liatir:publish:dry

Options:
  --patch          Bump patch version before publishing. This is the default.
  --minor          Bump minor version before publishing.
  --major          Bump major version before publishing.
  --bump <level>   Bump patch, minor, or major before publishing.
  --version <ver>  Set an explicit shared version. Must be greater than the current package versions.
  --otp <code>     One-time password required by npm 2FA.
  --tag <tag>      npm dist-tag to publish with. Defaults to npm's "latest".
  --dry-run        Build and pack without publishing. Version files are restored afterwards.
  --help           Show this help.
`);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(resolve(filePath), "utf8"));
}

function writeJson(filePath, value, snapshots) {
  writeTrackedFile(filePath, `${JSON.stringify(value, null, 2)}\n`, snapshots);
}

function readPackageJson(packageDir) {
  return readJson(resolve(packageDir, "package.json"));
}

function readPackageVersion(packageDir) {
  const pkg = readPackageJson(packageDir);
  return `${pkg.name}@${pkg.version}`;
}

function parseArgs(argv) {
  const options = {
    bump: "patch",
    bumpSet: false,
    dryRun: false,
    otp: undefined,
    tag: undefined,
    version: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];

    switch (flag) {
      case "--patch":
        setBump(options, "patch");
        break;
      case "--minor":
        setBump(options, "minor");
        break;
      case "--major":
        setBump(options, "major");
        break;
      case "--bump": {
        const value = inlineValue ?? argv[++i];
        if (!value) throw new Error("Missing value after --bump.");
        setBump(options, value);
        break;
      }
      case "--version":
        options.version = inlineValue ?? argv[++i];
        if (!options.version) throw new Error("Missing value after --version.");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "--otp":
        options.otp = inlineValue ?? argv[++i];
        if (!options.otp) throw new Error("Missing value after --otp.");
        break;
      case "--tag":
        options.tag = inlineValue ?? argv[++i];
        if (!options.tag) throw new Error("Missing value after --tag.");
        break;
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (options.version && options.bumpSet) {
    throw new Error("Use either --version or a bump flag, not both.");
  }
  if (options.version) {
    options.version = normalizeVersion(options.version);
  }
  delete options.bumpSet;
  return options;
}

function setBump(options, bump) {
  if (!["patch", "minor", "major"].includes(bump)) {
    throw new Error(`Invalid bump level "${bump}". Use patch, minor, or major.`);
  }
  if (options.bumpSet && options.bump !== bump) {
    throw new Error("Only one version bump level can be selected.");
  }
  options.bump = bump;
  options.bumpSet = true;
}

/**
 * Parses a strict `x.y.z` (a leading `v` is tolerated).
 *
 * Pre-release and build suffixes are rejected on purpose: these are public packages, and a
 * `1.0.0-rc1` published to the default tag would be installed by every plugin author.
 */
function parseVersion(version) {
  const match = String(version).trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) {
    throw new Error(`Invalid version "${version}". Use a stable semver like 1.10.0.`);
  }
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
  };
}

function formatVersion(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

function normalizeVersion(version) {
  return formatVersion(parseVersion(version));
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const key of ["major", "minor", "patch"]) {
    if (left[key] > right[key]) return 1;
    if (left[key] < right[key]) return -1;
  }
  return 0;
}

function maxVersion(versions) {
  return versions.reduce((max, version) => compareVersions(version, max) > 0 ? version : max);
}

function bumpVersion(version, level) {
  const parsed = parseVersion(version);
  if (level === "major") return `${parsed.major + 1}.0.0`;
  if (level === "minor") return `${parsed.major}.${parsed.minor + 1}.0`;
  return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
}

/**
 * Writes a file, remembering its previous contents the first time it is touched.
 *
 * This is what makes `--dry-run` non-destructive: the version bump has to actually land on disk
 * for `npm publish --dry-run` to pack the right thing, so the files are written for real and then
 * rolled back. Snapshotting only on first write keeps the *original* content even if a file is
 * written twice.
 */
function writeTrackedFile(filePath, content, snapshots) {
  const abs = resolve(filePath);
  if (!snapshots.has(abs)) {
    snapshots.set(abs, existsSync(abs) ? readFileSync(abs, "utf8") : null);
  }
  writeFileSync(abs, content);
}

/** Rolls back every tracked write. A `null` snapshot means the file did not exist before. */
function restoreSnapshots(snapshots) {
  for (const [filePath, content] of snapshots.entries()) {
    if (content === null) continue;
    writeFileSync(filePath, content);
  }
}

/**
 * Sets the version in a package's package.json *and* its lockfile.
 *
 * The lockfile records the package's own version in two places — the top level and the `""` (root)
 * entry — and npm treats a lockfile that disagrees with package.json as out of date, so both must
 * be updated to keep the pair in sync.
 */
function updatePackageVersionFiles(packageInfo, version, snapshots) {
  const packageJsonPath = resolve(packageInfo.dir, "package.json");
  const packageLockPath = resolve(packageInfo.dir, "package-lock.json");

  const packageJson = readJson(packageJsonPath);
  packageJson.version = version;
  writeJson(packageJsonPath, packageJson, snapshots);

  const packageLock = readJson(packageLockPath);
  packageLock.version = version;
  if (packageLock.packages?.[""]) {
    packageLock.packages[""].version = version;
  }
  writeJson(packageLockPath, packageLock, snapshots);
}

/**
 * Repoints the dependency ranges baked into the `liatir init` scaffold at the version being
 * released, so a plugin created right after a release does not start life pinned to an older one.
 *
 * A targeted regex rather than a JSON edit, because the ranges live inside a TypeScript source
 * file as part of a template literal.
 */
function updateInitTemplateVersion(version, snapshots) {
  const filePath = resolve(initCommandFile);
  let content = readFileSync(filePath, "utf8");
  content = content
    .replace(/("@liatir\/cli": "\^)\d+\.\d+\.\d+(")/, `$1${version}$2`)
    .replace(/("@liatir\/api": "\^)\d+\.\d+\.\d+(")/, `$1${version}$2`);
  writeTrackedFile(filePath, content, snapshots);
}

/**
 * Decides the version to release and writes it everywhere.
 *
 * The baseline is the *highest* version across the packages, not the lowest and not one package's
 * in particular. That guarantees the new version is greater than every already-published one —
 * npm rejects republishing a version, so picking too low a baseline would fail mid-release with
 * one package already public.
 */
function prepareVersions(options, snapshots) {
  const packageVersions = packages.map((packageInfo) => ({
    ...packageInfo,
    version: readPackageJson(resolve(packageInfo.dir)).version,
  }));
  const currentVersions = packageVersions.map((packageInfo) => normalizeVersion(packageInfo.version));
  const baseline = maxVersion(currentVersions);
  const targetVersion = options.version ?? bumpVersion(baseline, options.bump);

  if (compareVersions(targetVersion, baseline) <= 0) {
    throw new Error(
      `Target version ${targetVersion} must be greater than current package baseline ${baseline}.`
    );
  }

  // Drifted versions are recoverable — this release resynchronises them — but worth saying out
  // loud, since it means a previous release did not complete cleanly.
  const uniqueVersions = [...new Set(currentVersions)];
  if (uniqueVersions.length > 1) {
    console.warn(
      `Package versions were not in sync (${uniqueVersions.join(", ")}). ` +
      `Using ${baseline} as the baseline.`
    );
  }

  for (const packageInfo of packages) {
    updatePackageVersionFiles(packageInfo, targetVersion, snapshots);
  }
  updateInitTemplateVersion(targetVersion, snapshots);

  console.log(`Prepared @liatir packages at version ${targetVersion}.`);
  return targetVersion;
}

/** Publishes one package. Throws on failure so the caller can stop before the next one. */
function publishPackage(packageInfo, options) {
  const packageDir = resolve(packageInfo.dir);
  const packageVersion = readPackageVersion(packageDir);
  const args = ["publish", "--access", "public"];
  // A dedicated cache directory keeps a publish from being disturbed by (or disturbing) whatever
  // state the developer's default npm cache is in.
  const npmCache = process.env.LIATIR_NPM_CACHE ?? join(tmpdir(), "liatir-npm-cache");

  if (options.dryRun) args.push("--dry-run");
  if (options.tag) args.push("--tag", options.tag);
  if (options.otp) args.push("--otp", options.otp);

  console.log(`\nPublishing ${packageVersion} from ${packageInfo.dir}`);
  const result = spawnSync("npm", args, {
    cwd: packageDir,
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_cache: npmCache,
      NPM_CONFIG_CACHE: npmCache,
    },
  });

  if (result.status !== 0) {
    const error = new Error(`Failed to publish ${packageInfo.label}. Stopping before the next package.`);
    // Carried through to process.exitCode so CI sees npm's real status.
    error.exitCode = result.status ?? 1;
    throw error;
  }
}

const snapshots = new Map();
const options = parseArgs(process.argv.slice(2));

if (options.dryRun) {
  console.log("Running npm publish in dry-run mode.");
}

try {
  prepareVersions(options, snapshots);

  // Sequential, and aborting on the first failure. Publishing is irreversible, so if `@liatir/api`
  // fails there is no point pushing a CLI that would depend on a version nobody can install.
  for (const packageInfo of packages) {
    publishPackage(packageInfo, options);
  }
} catch (error) {
  console.error(`\n${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = error?.exitCode ?? 1;
} finally {
  // Only a dry run rolls back. After a real publish the bumped versions must stay on disk — they
  // are what was released, and they need to be committed.
  if (options.dryRun) {
    restoreSnapshots(snapshots);
    console.log("\nDry run complete. Restored version files.");
  }
}

console.log("\nDone.");
