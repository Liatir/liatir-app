import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcTauriDir = path.join(rootDir, 'src-tauri');
const testPermissions = ['wdio:default', 'wdio-webdriver:default'];
const capabilityFiles = [
  path.join(srcTauriDir, 'capabilities', 'local.json'),
  path.join(srcTauriDir, 'capabilities', 'local-dev.json'),
];

const env = {
  ...process.env,
  CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
  CARGO_INCREMENTAL: process.env.CARGO_INCREMENTAL ?? '0',
  CARGO_PROFILE_DEV_DEBUG: process.env.CARGO_PROFILE_DEV_DEBUG ?? '0'
};

const originals = new Map();

function patchCapability(filePath) {
  const original = fs.readFileSync(filePath, 'utf8');
  originals.set(filePath, original);

  const capability = JSON.parse(original);
  const permissions = Array.isArray(capability.permissions) ? capability.permissions : [];
  const nextPermissions = [...permissions];
  const insertAfter = nextPermissions.indexOf('liatir-bridge');
  const insertAt = insertAfter >= 0 ? insertAfter + 1 : nextPermissions.length;

  for (const permission of [...testPermissions].reverse()) {
    if (!nextPermissions.includes(permission)) {
      nextPermissions.splice(insertAt, 0, permission);
    }
  }

  capability.permissions = nextPermissions;
  fs.writeFileSync(filePath, `${JSON.stringify(capability, null, 2)}\n`);
}

function restoreCapabilities() {
  for (const [filePath, original] of originals) {
    fs.writeFileSync(filePath, original);
  }
}

let exitCode = 1;

try {
  for (const filePath of capabilityFiles) {
    patchCapability(filePath);
  }

  const result = spawnSync(
    'cargo',
    ['tauri', 'build', '--debug', '--features', 'wdio', '--bundles', 'app', '--ci'],
    {
      cwd: srcTauriDir,
      env,
      stdio: 'inherit'
    }
  );

  exitCode = result.status ?? 1;
} finally {
  restoreCapabilities();
}

process.exit(exitCode);
