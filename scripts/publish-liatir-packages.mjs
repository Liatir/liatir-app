import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
  npm run liatir:publish -- --otp 123456
  npm run liatir:publish -- --tag next
  npm run liatir:publish:dry

Options:
  --otp <code>     One-time password required by npm 2FA.
  --tag <tag>      npm dist-tag to publish with. Defaults to npm's "latest".
  --dry-run        Build and pack without publishing.
  --help           Show this help.
`);
}

function readPackageVersion(packageDir) {
  const pkg = JSON.parse(readFileSync(resolve(packageDir, "package.json"), "utf8"));
  return `${pkg.name}@${pkg.version}`;
}

function parseArgs(argv) {
  const options = {
    dryRun: false,
    otp: undefined,
    tag: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const [flag, inlineValue] = arg.includes("=") ? arg.split(/=(.*)/s, 2) : [arg, undefined];

    switch (flag) {
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

  return options;
}

function publishPackage(packageInfo, options) {
  const packageDir = resolve(packageInfo.dir);
  const packageVersion = readPackageVersion(packageDir);
  const args = ["publish", "--access", "public"];
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
    console.error(`\nFailed to publish ${packageInfo.label}. Stopping before the next package.`);
    process.exit(result.status ?? 1);
  }
}

const options = parseArgs(process.argv.slice(2));

if (options.dryRun) {
  console.log("Running npm publish in dry-run mode.");
}

for (const packageInfo of packages) {
  publishPackage(packageInfo, options);
}

console.log("\nDone.");
