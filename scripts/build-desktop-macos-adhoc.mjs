#!/usr/bin/env node

/**
 * Build and inspect a local macOS release-shaped DMG without release secrets.
 *
 * The bundle is ad-hoc signed and updater artifact generation is disabled, so
 * it can never be mistaken for the signed/notarized public Beta artifact.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_VERSION } from './app-version.mjs';
import { confShellInvocation } from './run-conf.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const CONFIG_FILES = [
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/local.json',
  'src-tauri/window.env',
  'src-ts/bridge.constants.json',
];

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

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  throw new Error('The local macOS package gate requires macOS arm64');
}

const originals = new Map(CONFIG_FILES.map((relative) => {
  const path = join(ROOT, relative);
  return [path, readFileSync(path)];
}));
const temporary = mkdtempSync(join(tmpdir(), 'liatir-gate7-package-'));
const mountPoint = join(temporary, 'mounted');
let mounted = false;

try {
  run('npm', ['run', 'gen:sdk-types']);
  run('npm', ['run', 'build:frontend']);
  run('npm', ['run', 'ts:compile']);
  // The bundle is not a Liatir package without its Native Tools.
  run('npm', ['run', 'native-tools:require']);
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
  config.bundle.targets = ['app', 'dmg'];
  config.bundle.createUpdaterArtifacts = false;
  config.bundle.macOS = { ...(config.bundle.macOS ?? {}), signingIdentity: '-' };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

  run('cargo', ['tauri', 'build', '--bundles', 'app,dmg', '--ci'], {
    ...process.env,
    CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
    CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  });

  const app = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'macos', 'Liatir.app');
  const dmgDir = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  const dmgName = readdirSync(dmgDir).find((name) => name.endsWith('.dmg'));
  if (!dmgName) throw new Error(`No DMG was produced under ${dmgDir}`);
  const dmg = join(dmgDir, dmgName);

  run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
  run('hdiutil', ['verify', dmg]);
  run('mkdir', ['-p', mountPoint]);
  run('hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', mountPoint, dmg]);
  mounted = true;
  statSync(join(mountPoint, 'Liatir.app', 'Contents', 'MacOS', 'liatir'));
  run('hdiutil', ['detach', mountPoint]);
  mounted = false;

  console.log(`Gate 7 local macOS package passed: ${dmg}`);
  console.log('This artifact is ad-hoc signed and not notarized; it must not be published.');
} finally {
  if (mounted) {
    spawnSync('hdiutil', ['detach', mountPoint, '-force'], { stdio: 'ignore' });
  }
  for (const [path, contents] of originals) writeFileSync(path, contents);
  rmSync(temporary, { recursive: true, force: true });
}
