#!/usr/bin/env node

/**
 * Build and inspect the local Linux release-shaped packages without release secrets.
 *
 * Linux packages carry no code signature of their own, so what separates these from a public
 * release is that no signed updater artifact exists: the build asserts that none was produced, and
 * that each package really contains the application executable rather than merely being well
 * formed.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { localNodeCliInvocation, npmInvocation } from './node-cli.mjs';
import { confShellInvocation } from './run-conf.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_FILES = [
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/local.json',
  'src-tauri/window.env',
  'src-ts/bridge.constants.json',
];
const APP_VERSION = '0.2.1';
const BUNDLES = ['deb', 'rpm', 'appimage'];

function run(command, args, environment = process.env) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: environment,
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}: ${result.stderr}`);
  return result.stdout;
}

function runNpm(args) {
  const invocation = npmInvocation(args);
  run(invocation.command, invocation.args);
}

function findFile(directory, suffix) {
  const name = readdirSync(directory).find((entry) => entry.endsWith(suffix));
  if (!name) throw new Error(`No ${suffix} package was produced under ${directory}`);
  return join(directory, name);
}

/** Rejects anything that is not a 64-bit little-endian x86-64 ELF image. */
function requireElfX8664(path) {
  const header = readFileSync(path).subarray(0, 20);
  if (header.subarray(0, 4).toString('hex') !== '7f454c46') throw new Error(`${path} is not an ELF image`);
  if (header[4] !== 2) throw new Error(`${path} is not a 64-bit ELF image`);
  if (header.readUInt16LE(18) !== 0x3e) throw new Error(`${path} is not an x86-64 ELF image`);
}

if (process.platform !== 'linux' || process.arch !== 'x64') {
  throw new Error('The local Linux package gate requires Linux x86_64');
}

const originals = new Map(CONFIG_FILES.map((relative) => {
  const path = join(ROOT, relative);
  return [path, readFileSync(path)];
}));

try {
  runNpm(['run', 'gen:sdk-types']);
  runNpm(['run', 'build:frontend']);
  runNpm(['run', 'ts:compile']);
  // The bundle is not a Liatir package without its Native Tools.
  runNpm(['run', 'native-tools:require']);

  const prodConf = confShellInvocation('prod-conf.sh');
  run(prodConf.command, prodConf.args, {
    ...process.env,
    APP_VERSION,
    CARGO_PACKAGE_VERSION: APP_VERSION,
    UPDATE_ENDPOINT: 'https://updates.invalid/{{target}}/{{arch}}/{{current_version}}',
    ED25519_PUBKEY: 'local-package-gate-placeholder',
    MAIN_WINDOW_URL: '',
  });

  const configPath = join(ROOT, 'src-tauri', 'tauri.conf.json');
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  config.bundle.targets = [...BUNDLES];
  config.bundle.createUpdaterArtifacts = false;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const tauri = localNodeCliInvocation('@tauri-apps/cli/tauri.js', [
    'build', '--bundles', BUNDLES.join(','), '--ci',
  ]);
  run(tauri.command, tauri.args, {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  });

  const releaseDir = join(ROOT, 'src-tauri', 'target', 'release');
  const bundleRoot = join(releaseDir, 'bundle');
  requireElfX8664(join(releaseDir, 'liatir'));

  const deb = findFile(join(bundleRoot, 'deb'), '.deb');
  const contents = capture('dpkg-deb', ['--contents', deb]);
  // dpkg-deb prints member paths with or without a leading `./` depending on how the archive was
  // built, so accept both rather than pinning one writer's formatting.
  if (!/\s\.?\/?usr\/bin\/liatir$/m.test(contents)) {
    throw new Error(`${deb} does not contain usr/bin/liatir`);
  }
  const metadata = capture('dpkg-deb', ['--field', deb]);
  if (!new RegExp(`^Version: ${APP_VERSION}$`, 'm').test(metadata)) {
    throw new Error(`${deb} does not declare version ${APP_VERSION}`);
  }

  const rpm = findFile(join(bundleRoot, 'rpm'), '.rpm');
  if (readFileSync(rpm).subarray(0, 4).toString('hex') !== 'edabeedb') {
    throw new Error(`${rpm} does not carry the RPM lead magic`);
  }

  const appImage = findFile(join(bundleRoot, 'appimage'), '.AppImage');
  requireElfX8664(appImage);
  // AppImage type 2 marks itself in the three bytes the ELF header leaves for the ABI padding.
  if (readFileSync(appImage).subarray(8, 11).toString('hex') !== '414902') {
    throw new Error(`${appImage} does not carry the AppImage type 2 magic`);
  }

  const signatures = BUNDLES
    .map((bundle) => join(bundleRoot, bundle))
    .flatMap((directory) => readdirSync(directory).filter((name) => name.endsWith('.sig')));
  if (signatures.length > 0) {
    throw new Error(`This gate must not produce updater signatures, but found: ${signatures.join(', ')}`);
  }

  console.log(`Gate 7 local Linux package passed: ${deb}, ${rpm}, ${appImage}`);
  console.log('These artifacts are unsigned local packages, not a release; they must not be published.');
} finally {
  for (const [path, contents] of originals) writeFileSync(path, contents);
}
