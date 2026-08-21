#!/usr/bin/env node
/**
 * Build the Native Tools environment that ships inside Liatir.
 *
 * The environment is one relocatable conda prefix holding every process-backed
 * Native Tool, solved from the committed `native-tools-env/pixi.toml` and pinned
 * by `native-tools-env/pixi.lock`. It replaces asking the user to install
 * bioinformatics tools with a package manager.
 *
 * The output is one `native-tools-<subdir>.tar.gz` plus a manifest sidecar, on
 * every platform. Not a directory of files: a conda prefix is 1,100+ symlinks
 * with execute bits, the Tauri bundler resolves each one into a full copy, and
 * measuring that turned a 203 MB environment into 438 MB inside the `.app` —
 * 196 MB of the same libraries written out again, `libopenblas` seven times. An
 * archive keeps the symlinks, the modes and the size, and the application
 * unpacks it once with `tar`.
 *
 * A conda prefix can only be linked by its own platform, so `linux-64` must be
 * built on Linux — natively, on a Linux CI runner, or inside WSL2 on a Windows
 * developer machine. There is no cross-build path and pretending otherwise would
 * produce an environment that has never run.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENV_SOURCE = path.join(REPO_ROOT, 'native-tools-env');
const MANIFEST = path.join(ENV_SOURCE, 'pixi.toml');
const LOCK = path.join(ENV_SOURCE, 'pixi.lock');
const BUILT_PREFIX = path.join(ENV_SOURCE, '.pixi', 'envs', 'default');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'src-tauri', 'resources', 'native-tools');
const ARCHIVE_SUFFIX = '.tar.gz';

/** Kept in step with BUNDLED_ENVIRONMENT_TOOLS in packages/liatir-core. */
const TOOLS = ['samtools', 'bcftools', 'seqkit', 'fastp', 'bwa', 'minimap2'];

/**
 * Build artifacts with no runtime role. Documentation and headers are the bulk;
 * static archives, pkg-config and CMake files exist only to compile against this
 * prefix, which nothing ever does once it is inside an application bundle.
 */
const PRUNE_DIRECTORIES = [
  'man',
  'include',
  'share/man',
  'share/info',
  'share/doc',
  'share/locale',
  'share/examples',
  'share/aclocal',
  'share/et',
  'lib/pkgconfig',
  'lib/cmake',
];
const PRUNE_SUFFIXES = ['.a'];

function parseArguments(argv) {
  const options = { subdir: null, skipVerify: false, require: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--subdir') {
      options.subdir = argv[index += 1];
    } else if (argument === '--skip-verify') {
      options.skipVerify = true;
    } else if (argument === '--require') {
      options.require = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

/** The conda subdir this machine can actually link an environment for. */
function hostSubdir() {
  const platform = os.platform();
  const arch = os.arch();
  if (platform === 'darwin' && arch === 'arm64') return 'osx-arm64';
  if (platform === 'linux' && arch === 'x64') return 'linux-64';
  throw new Error(`No Native Tools environment is declared for ${platform}/${arch}.`);
}

/**
 * On Windows there is nothing to build: the environment is the `linux-64`
 * tarball, and only Linux can link it. So the Windows job verifies instead.
 *
 * Missing is fatal only under `--require`, which the packaging gates pass. An
 * installer without the archive would look perfectly fine and ship an
 * application whose tools are all missing, so packaging must refuse it — but a
 * developer running the end-to-end suites for something unrelated should not be
 * blocked on an artifact only Linux can produce.
 */
function verifyWindowsArtifact(required) {
  const archive = path.join(OUTPUT_ROOT, `native-tools-linux-64${ARCHIVE_SUFFIX}`);
  const sidecar = `${archive}.json`;
  if (!fs.existsSync(archive) || !fs.existsSync(sidecar)) {
    const message =
      'The linux-64 Native Tools archive is not in\n'
      + `  ${path.relative(REPO_ROOT, OUTPUT_ROOT)}\n`
      + 'Build it on Linux — inside WSL2 on this machine is enough:\n'
      + '  wsl node scripts/build-native-tools-env.mjs\n'
      + 'or take it from the Linux CI job.';
    if (required) throw new Error(message);
    console.warn(`Native Tools environment — not present.\n${message}`);
    return;
  }
  const manifest = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
  const actual = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  if (actual !== manifest.archiveSha256) {
    throw new Error(`${path.basename(archive)} does not match the digest its build recorded.`);
  }
  console.log('Native Tools environment — linux-64, executed through WSL2');
  console.log(`  archive   ${megabytes(fs.statSync(archive).size)}, digest verified`);
  for (const tool of manifest.tools) console.log(`  ${tool.id.padEnd(10)} ${tool.version}`);
}

function resolvePixi() {
  const candidates = [
    process.env.PIXI_BIN,
    'pixi',
    path.join(os.homedir(), '.pixi', 'bin', 'pixi'),
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'pipe' });
      return candidate;
    } catch { /* try the next candidate */ }
  }
  throw new Error('pixi was not found. Install it from https://pixi.sh, or set PIXI_BIN.');
}

/**
 * Read the pinned version of each tool for this subdir out of the lock. Parsing
 * the package filenames rather than the manifest ranges is the point: the lock
 * is what the build installs, so it is what the manifest we ship must report.
 */
function lockedVersions(subdir) {
  const lines = fs.readFileSync(LOCK, 'utf8').split('\n');
  const header = `      ${subdir}:`;
  const start = lines.indexOf(header);
  if (start < 0) throw new Error(`${LOCK} has no ${subdir} environment.`);
  const entries = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.startsWith('      - ')) break;
    entries.push(line);
  }
  const block = entries.join('\n');
  const versions = new Map();
  for (const tool of TOOLS) {
    const match = block.match(
      new RegExp(`/${subdir}/${tool}-([^-]+)-[^/]*\\.(?:conda|tar\\.bz2)`),
    );
    if (!match) throw new Error(`${LOCK} does not pin ${tool} for ${subdir}.`);
    versions.set(tool, match[1]);
  }
  return versions;
}

function pruneBuildArtifacts(root) {
  for (const relative of PRUNE_DIRECTORIES) {
    fs.rmSync(path.join(root, relative), { recursive: true, force: true });
  }
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else if (PRUNE_SUFFIXES.some((suffix) => entry.name.endsWith(suffix))) fs.rmSync(full);
    }
  };
  walk(root);
}

/**
 * Run every tool from its final location. A conda prefix records the path it was
 * built in, so the question that matters is not whether the binaries exist but
 * whether they still work somewhere else — which is exactly what the bundle asks
 * of them. Answering it by execution rather than by inspection is the only way
 * to know.
 */
function verifyRelocated(root, versions) {
  const probes = {
    samtools: ['--version'],
    bcftools: ['--version'],
    seqkit: ['version'],
    fastp: ['--version'],
    bwa: [],           // bwa has no --version; bare invocation prints usage to stderr
    minimap2: ['--version'],
  };
  for (const tool of TOOLS) {
    const binary = path.join(root, 'bin', tool);
    if (!fs.existsSync(binary)) throw new Error(`${tool} is missing from the built environment.`);
    // Both streams, and no exit-code check: these tools disagree about where a
    // version belongs and whether printing one is a success. What is being
    // verified is that the binary ran at all and said which build it is.
    const probe = spawnSync(binary, probes[tool], { encoding: 'utf8' });
    if (probe.error) throw new Error(`${tool} could not run from ${root}: ${probe.error.message}`);
    const output = `${probe.stdout ?? ''}\n${probe.stderr ?? ''}`;
    const version = versions.get(tool);
    if (!output.includes(version)) {
      throw new Error(
        `${tool} ran from ${root} but reported\n${output.trim().split('\n')[0]}\n`
        + `instead of the locked ${version}.`,
      );
    }
  }
}

function directorySize(root) {
  let total = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) walk(full);
      else total += fs.statSync(full).size;
    }
  };
  walk(root);
  return total;
}

function megabytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  if (os.platform() === 'win32') {
    verifyWindowsArtifact(options.require);
    return;
  }
  const subdir = hostSubdir();
  if (options.subdir && options.subdir !== subdir) {
    throw new Error(
      `This machine builds ${subdir}, not ${options.subdir}. A conda prefix can only be `
      + 'linked by its own platform.',
    );
  }

  const pixi = resolvePixi();
  console.log(`Native Tools environment — ${subdir}`);
  console.log(`  solving   ${path.relative(REPO_ROOT, MANIFEST)} (frozen)`);
  execFileSync(pixi, ['install', '--frozen', '--manifest-path', MANIFEST], { stdio: 'inherit' });

  const versions = lockedVersions(subdir);
  const destination = path.join(OUTPUT_ROOT, subdir);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  console.log(`  copying   -> ${path.relative(REPO_ROOT, destination)}`);
  fs.cpSync(BUILT_PREFIX, destination, {
    recursive: true,
    verbatimSymlinks: true,
    preserveTimestamps: true,
  });

  const beforePrune = directorySize(destination);
  pruneBuildArtifacts(destination);
  const afterPrune = directorySize(destination);
  console.log(`  pruning   ${megabytes(beforePrune)} -> ${megabytes(afterPrune)}`);

  if (!options.skipVerify) {
    verifyRelocated(destination, versions);
    console.log(`  verified  ${TOOLS.length} tools ran from the destination prefix`);
  }

  const lockDigest = createHash('sha256').update(fs.readFileSync(LOCK)).digest('hex');
  const manifest = {
    schemaVersion: 1,
    subdir,
    lockDigest,
    builtAt: new Date().toISOString(),
    tools: TOOLS.map((id) => ({ id, version: versions.get(id) })),
  };
  fs.writeFileSync(
    path.join(destination, 'liatir-native-tools.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // GNU/BSD tar, not a Node implementation: the symlinks and execute bits in a
  // conda prefix are the payload, and the same tar reads this archive back.
  const archive = path.join(OUTPUT_ROOT, `native-tools-${subdir}${ARCHIVE_SUFFIX}`);
  fs.rmSync(archive, { force: true });
  console.log(`  packing   -> ${path.relative(REPO_ROOT, archive)}`);
  execFileSync('tar', ['-czf', archive, '-C', OUTPUT_ROOT, subdir], { stdio: 'inherit' });
  const archiveSha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  fs.writeFileSync(`${archive}.json`, `${JSON.stringify({
    ...manifest,
    archiveSha256,
    archiveBytes: fs.statSync(archive).size,
  }, null, 2)}\n`);
  fs.rmSync(destination, { recursive: true, force: true });

  console.log(`  archive   ${megabytes(fs.statSync(archive).size)}`);
  for (const tool of manifest.tools) console.log(`  ${tool.id.padEnd(10)} ${tool.version}`);
  console.log(`  lock      sha256 ${lockDigest.slice(0, 16)}…`);
}

try {
  main();
} catch (error) {
  console.error(`\nNative Tools environment build failed: ${error.message}`);
  process.exit(1);
}
