#!/usr/bin/env node
/** Build or verify the signed Scrollcase box embedded with Liatir's Native Tools. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { publishedNodeCliInvocation } from './node-cli.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_ROOT = path.join(REPO_ROOT, 'src-tauri', 'resources', 'native-tools');
const DIST_ROOT = path.join(REPO_ROOT, '.runtime-box-dist', 'boxes', 'native-tools', '1.0.0');
const BOX_ID = 'native-tools';
const BOX_VERSION = '1.0.0';
const NAMESPACE = 'liatir.native-tools';
const WSL_CONSUMER = 'native-tools-box-consumer';
const PIXI_VERSION = '0.77.0';
const AUTHORING_SOURCES = [
  'runtime-boxes/native-tools/native-tools.json',
  'runtime-boxes/native-tools/native-tools-self-test.py',
];

function parseArguments(argv) {
  const options = { require: false };
  for (const argument of argv) {
    if (argument === '--require') options.require = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return options;
}

function hostPlacement() {
  if (process.platform === 'darwin' && process.arch === 'arm64') {
    return { targetId: 'macos-aarch64-cpu', execution: 'native', buildable: true };
  }
  if (process.platform === 'linux' && process.arch === 'x64') {
    return { targetId: 'linux-x86_64-cpu', execution: 'native', buildable: true };
  }
  if (process.platform === 'win32' && process.arch === 'x64') {
    return { targetId: 'linux-x86_64-cpu', execution: 'wsl2', buildable: false };
  }
  return null;
}

function resourcePaths(targetId) {
  const stem = path.join(OUTPUT_ROOT, `native-tools-${targetId}`);
  return {
    archive: `${stem}.zip`,
    release: `${stem}.release.json`,
    key: `${stem}.trusted-key.json`,
    wslConsumer: path.join(OUTPUT_ROOT, WSL_CONSUMER),
  };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    stdio: options.capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stdout ?? ''}${result.stderr ?? ''}` : '';
    throw new Error(`${command} exited with status ${result.status}.${detail}`);
  }
  return result;
}

function scrollcase(args, options = {}) {
  const invocation = publishedNodeCliInvocation('scrollcase', 'contract', 'scrollcase', args);
  return run(invocation.command, invocation.args, options);
}

function sourceTreeIsDirty() {
  return run('git', ['status', '--porcelain', '--untracked-files=all'], { capture: true })
    .stdout.trim().length > 0;
}

function resolveTool(candidates, probe, expected = null) {
  for (const candidate of candidates.filter(Boolean)) {
    const result = spawnSync(candidate, probe, { encoding: 'utf8' });
    if (result.error || result.status !== 0) continue;
    if (expected && !String(result.stdout).trim().endsWith(expected)) continue;
    return candidate;
  }
  throw new Error(`Required build tool was not found${expected ? ` at version ${expected}` : ''}.`);
}

function buildToolchain() {
  return {
    pixi: resolveTool([
      process.env.SCROLLCASE_PIXI,
      process.env.PIXI_BIN,
      path.join(os.homedir(), '.pixi', 'bin', 'pixi'),
      path.join(REPO_ROOT, '.scrollcase', 'toolchain', 'bin', 'pixi'),
      'pixi',
    ], ['--version'], PIXI_VERSION),
    condaPack: resolveTool([
      process.env.SCROLLCASE_CONDA_PACK,
      path.join(REPO_ROOT, '.scrollcase', 'toolchain', 'bin', 'conda-pack'),
      path.join(os.homedir(), '.pixi', 'bin', 'conda-pack'),
      'conda-pack',
    ], ['--help']),
  };
}

function oneBuiltRelease(targetId) {
  const directory = path.join(DIST_ROOT, targetId);
  const candidates = fs.readdirSync(directory)
    .filter((name) => name.endsWith('.release.json'));
  if (candidates.length !== 1) {
    throw new Error(`Expected one Scrollcase release in ${directory}; found ${candidates.length}.`);
  }
  return path.join(directory, candidates[0]);
}

function releasePayload(releasePath) {
  const envelope = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
  return JSON.parse(Buffer.from(envelope.payloadBase64, 'base64').toString('utf8'));
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function authoringRevision() {
  const hash = createHash('sha256');
  for (const relative of AUTHORING_SOURCES) {
    hash.update(fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8').replace(/\r\n/gu, '\n'));
    hash.update(Buffer.from([0]));
  }
  return hash.digest('hex');
}

function assertExpectedRelease(releasePath, targetId) {
  const release = releasePayload(releasePath);
  if (release.kind !== `${NAMESPACE}.release`
      || release.boxId !== BOX_ID
      || release.version !== BOX_VERSION
      || release.runtimeId !== 'native-tools') {
    throw new Error(`Unexpected Native Tools Scrollcase release identity in ${releasePath}.`);
  }
  const target = `${release.target.platform}-${release.target.arch}-${release.target.accelerator}`;
  if (target !== targetId) {
    throw new Error(`Native Tools release target ${target} does not match ${targetId}.`);
  }
  if (release.provenance?.sourceRevision !== authoringRevision()) {
    throw new Error('Native Tools release does not contain the current metadata and self-test.');
  }
  const lock = path.join(
    REPO_ROOT,
    'runtime-boxes', 'scrolls', 'native-tools', targetId, 'pixi.lock',
  );
  if (release.provenance?.dependencyLockSha256 !== sha256File(lock)) {
    throw new Error(`Native Tools release does not contain the current ${targetId} dependency lock.`);
  }
  return release;
}

function verifyResources(placement, required) {
  const resources = resourcePaths(placement.targetId);
  const expected = [resources.archive, resources.release, resources.key];
  if (placement.execution === 'wsl2') expected.push(resources.wslConsumer);
  const missing = expected.filter((file) => !fs.existsSync(file));
  if (missing.length > 0) {
    const message = [
      `The ${placement.targetId} Native Tools Scrollcase box is missing:`,
      ...missing.map((file) => `  ${path.relative(REPO_ROOT, file)}`),
      placement.execution === 'wsl2'
        ? 'Download the complete Linux CI artifact into src-tauri/resources/native-tools/.'
        : 'Run npm run native-tools:build on this host.',
    ].join('\n');
    if (required) throw new Error(message);
    console.warn(`Native Tools Scrollcase box — not present.\n${message}`);
    return false;
  }

  assertExpectedRelease(resources.release, placement.targetId);
  scrollcase([
    'verify', resources.release,
    '--archive', resources.archive,
    '--public-key', resources.key,
  ]);
  const metadata = JSON.parse(fs.readFileSync(
    path.join(REPO_ROOT, 'runtime-boxes', 'native-tools', 'native-tools.json'),
    'utf8',
  ));
  console.log(`Native Tools Scrollcase box — ${placement.targetId}, ${placement.execution}`);
  for (const tool of metadata.tools) console.log(`  ${tool.id.padEnd(10)} ${tool.version}`);
  return true;
}

function build(placement) {
  const toolchain = buildToolchain();
  const keys = fs.mkdtempSync(path.join(os.tmpdir(), 'liatir-native-tools-keys-'));
  const privateKey = path.join(keys, 'signing-private.pem');
  const publicKey = path.join(keys, 'signing-public.json');
  try {
    scrollcase([
      'keygen',
      '--private-key', privateKey,
      '--public-key', publicKey,
    ]);
    const arguments_ = [
      'build', `${BOX_ID}/${placement.targetId}`,
      '--weights', 'embed',
      '--channel', 'beta',
      '--namespace', NAMESPACE,
      '--private-key', privateKey,
      '--public-key', publicKey,
      '--pixi', toolchain.pixi,
      '--conda-pack', toolchain.condaPack,
    ];
    if (sourceTreeIsDirty()) arguments_.push('--allow-dirty');
    scrollcase(arguments_);

    const builtRelease = oneBuiltRelease(placement.targetId);
    const release = assertExpectedRelease(builtRelease, placement.targetId);
    const builtArchive = path.join(path.dirname(builtRelease), `${release.archive.sha256}.zip`);
    const resources = resourcePaths(placement.targetId);
    fs.mkdirSync(OUTPUT_ROOT, { recursive: true });
    fs.copyFileSync(builtArchive, resources.archive);
    fs.copyFileSync(builtRelease, resources.release);
    fs.copyFileSync(publicKey, resources.key);
    verifyResources(placement, true);
  } finally {
    fs.rmSync(keys, { recursive: true, force: true });
  }
}

const options = parseArguments(process.argv.slice(2));
const placement = hostPlacement();
if (!placement) {
  const message = `No Native Tools Scrollcase target is declared for ${process.platform}/${process.arch}.`;
  if (options.require) throw new Error(message);
  console.warn(message);
} else if (options.require || !placement.buildable) {
  verifyResources(placement, options.require);
} else {
  build(placement);
}
