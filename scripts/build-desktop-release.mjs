#!/usr/bin/env node

/**
 * Build, but never publish, one signed desktop release from an exact revision.
 *
 * Publishing and remote release creation deliberately live outside this script:
 * producing local artifacts and making them public are separate authorization
 * boundaries. Generated configuration is restored even after a failed build.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const GENERATED_CONFIG = [
  'src-tauri/Cargo.toml',
  'src-tauri/tauri.conf.json',
  'src-tauri/capabilities/local.json',
  'src-tauri/window.env',
  'src-ts/bridge.constants.json',
];

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function hasAll(environment, names) {
  return names.every((name) => Boolean(environment[name]?.trim()));
}

/** Platforms whose native signing and artifact contract is implemented and verified. */
const RELEASE_PLATFORMS = new Set(['darwin', 'win32']);

export function validateReleaseEnvironment(environment, platform = process.platform) {
  const errors = [];
  if (!RELEASE_PLATFORMS.has(platform)) {
    errors.push('This Gate 7 release contract is implemented for macOS and Windows; add and verify the native platform contract first');
  }
  if (!isSemver(environment.APP_VERSION ?? '')) {
    errors.push('APP_VERSION must be an explicit semantic version');
  }
  if (!/^[0-9a-f]{40}$/.test(environment.RELEASE_REVISION ?? '')) {
    errors.push('RELEASE_REVISION must be the exact 40-character Git commit SHA');
  }
  if (!/^https:\/\//.test(environment.UPDATE_ENDPOINT ?? '')) {
    errors.push('UPDATE_ENDPOINT must be an explicit HTTPS URL');
  }
  if (!environment.ED25519_PUBKEY?.trim() && !environment.TAURI_SIGNING_PUBLIC_KEY?.trim()) {
    errors.push('ED25519_PUBKEY or TAURI_SIGNING_PUBLIC_KEY is required');
  }
  if (!environment.TAURI_SIGNING_PRIVATE_KEY?.trim()) {
    errors.push('TAURI_SIGNING_PRIVATE_KEY is required to produce signed updater artifacts');
  }

  if (platform === 'darwin') {
    const hasCertificate = Boolean(environment.APPLE_CERTIFICATE?.trim());
    const hasInstalledIdentity = Boolean(environment.APPLE_SIGNING_IDENTITY?.trim());
    if (!hasCertificate && !hasInstalledIdentity) {
      errors.push('APPLE_CERTIFICATE or APPLE_SIGNING_IDENTITY is required for macOS code signing');
    }
    if (hasCertificate && !environment.APPLE_CERTIFICATE_PASSWORD?.trim()) {
      errors.push('APPLE_CERTIFICATE_PASSWORD is required with APPLE_CERTIFICATE');
    }

    const hasApiNotary = hasAll(environment, ['APPLE_API_ISSUER', 'APPLE_API_KEY', 'APPLE_API_KEY_PATH']);
    const hasAppleIdNotary = hasAll(environment, ['APPLE_ID', 'APPLE_PASSWORD', 'APPLE_TEAM_ID']);
    if (!hasApiNotary && !hasAppleIdNotary) {
      errors.push('Apple notarization credentials are required (API key or Apple ID set)');
    }
  }

  if (platform === 'win32') {
    // Tauri signs through signtool, which takes either a certificate already in the store (by
    // thumbprint) or an exported PFX it imports first.
    const thumbprint = (environment.WINDOWS_CERTIFICATE_THUMBPRINT ?? '').replace(/\s/g, '');
    const hasCertificate = Boolean(environment.WINDOWS_CERTIFICATE?.trim());
    if (!/^[0-9a-fA-F]{40}$/.test(thumbprint) && !hasCertificate) {
      errors.push('WINDOWS_CERTIFICATE_THUMBPRINT (40 hex characters) or WINDOWS_CERTIFICATE is required for Windows code signing');
    }
    if (hasCertificate && !environment.WINDOWS_CERTIFICATE_PASSWORD?.trim()) {
      errors.push('WINDOWS_CERTIFICATE_PASSWORD is required with WINDOWS_CERTIFICATE');
    }
    // Windows has no notarization step; an RFC 3161 countersignature is what keeps the installer
    // trusted after the signing certificate expires, so it is required rather than optional.
    if (!/^https:\/\//.test(environment.WINDOWS_TIMESTAMP_URL ?? '')) {
      errors.push('WINDOWS_TIMESTAMP_URL must be an explicit HTTPS RFC 3161 timestamp server');
    }
  }

  return errors;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: process.env,
    stdio: 'inherit',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`);
  }
}

function captureGeneratedConfig() {
  return new Map(GENERATED_CONFIG.map((relative) => {
    const path = join(ROOT, relative);
    return [path, readFileSync(path)];
  }));
}

function restoreGeneratedConfig(originals) {
  for (const [path, contents] of originals) writeFileSync(path, contents);
}

function walkFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) files.push(...walkFiles(path));
    else files.push(path);
  }
  return files;
}

/** Quotes a path for a PowerShell literal string; PowerShell does not escape with backslashes. */
function powershellLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

/**
 * Requires a validly signed and countersigned Windows artifact.
 *
 * `Get-AuthenticodeSignature` is the same verification Windows itself performs, so an untrusted
 * chain, a tampered file or a self-signed test certificate all fail here rather than at a user's
 * SmartScreen prompt.
 */
function requireSignedWindowsArtifact(path) {
  const report = execFileSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `$s = Get-AuthenticodeSignature -LiteralPath ${powershellLiteral(path)};`
    + ' "$($s.Status)|$([bool]$s.TimeStamperCertificate)"',
  ], { cwd: ROOT, encoding: 'utf8' }).trim();
  const [status, timestamped] = report.split('|');
  if (status !== 'Valid') {
    throw new Error(`${basename(path)} is not validly signed (Authenticode status: ${status})`);
  }
  if (timestamped !== 'True') {
    throw new Error(`${basename(path)} carries no RFC 3161 countersignature, so its signature expires with the certificate`);
  }
}

function requireArtifacts(platform, version, buildStartedAt) {
  const bundleRoot = join(ROOT, 'src-tauri', 'target', 'release', 'bundle');
  const files = walkFiles(bundleRoot).filter((path) => statSync(path).mtimeMs >= buildStartedAt - 2_000);
  const updater = files.find((path) => path.endsWith('.sig'));
  if (!updater) throw new Error(`No newly built signed updater artifact found under ${bundleRoot}`);
  if (!existsSync(updater.slice(0, -4))) {
    throw new Error(`Updater signature has no matching artifact: ${updater}`);
  }

  if (platform === 'darwin') {
    const dmg = files.find((path) => path.endsWith('.dmg') && basename(path).includes(version));
    const app = files.find((path) => path.endsWith('.app.tar.gz'));
    if (!dmg || !app) throw new Error('macOS release must contain a current-version DMG and a new .app.tar.gz updater artifact');
    const appBundle = join(bundleRoot, 'macos', 'Liatir.app');
    if (statSync(appBundle).mtimeMs < buildStartedAt - 2_000) {
      throw new Error('The macOS app bundle was not produced by this release build');
    }
    run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', appBundle]);
    run('spctl', ['--assess', '--type', 'execute', '--verbose=2', appBundle]);
    run('spctl', ['--assess', '--type', 'open', '--context', 'context:primary-signature', '--verbose=2', dmg]);
    run('xcrun', ['stapler', 'validate', dmg]);
    run('hdiutil', ['verify', dmg]);
  }

  if (platform === 'win32') {
    const setup = files.find((path) => path.endsWith('-setup.exe') && basename(path).includes(version));
    const updaterArchive = files.find((path) => path.endsWith('.nsis.zip'));
    if (!setup || !updaterArchive) {
      throw new Error('Windows release must contain a current-version NSIS installer and a new .nsis.zip updater artifact');
    }
    const executable = join(ROOT, 'src-tauri', 'target', 'release', 'liatir.exe');
    if (statSync(executable).mtimeMs < buildStartedAt - 2_000) {
      throw new Error('The Windows application executable was not produced by this release build');
    }
    // The installer and the executable it packages are separately signed; a user can run into
    // either one first, so both must verify.
    requireSignedWindowsArtifact(executable);
    requireSignedWindowsArtifact(setup);
  }

  console.log(`Verified ${files.length} release files; updater signature: ${basename(updater)}`);
}

function assertReleaseCheckout(environment) {
  const status = execFileSync('git', ['status', '--porcelain'], { cwd: ROOT, encoding: 'utf8' });
  if (status.trim()) throw new Error('Desktop releases must start from a clean worktree');
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
  if (revision !== environment.RELEASE_REVISION) {
    throw new Error(`RELEASE_REVISION does not match HEAD (${revision})`);
  }
}

export function validateDesktopReleaseInputs(environment = process.env, platform = process.platform) {
  const errors = validateReleaseEnvironment(environment, platform);
  if (errors.length > 0) throw new Error(`Desktop release inputs are incomplete:\n- ${errors.join('\n- ')}`);
}

async function main() {
  const validateOnly = process.argv.includes('--validate-only');
  validateDesktopReleaseInputs();
  if (validateOnly) {
    console.log('Desktop release inputs are complete. No build or remote action was performed.');
    return;
  }

  assertReleaseCheckout(process.env);
  const originals = captureGeneratedConfig();
  try {
    run('npm', ['run', 'test:verify']);
    const buildStartedAt = Date.now();
    run('npm', ['run', 'build']);
    requireArtifacts(process.platform, process.env.APP_VERSION, buildStartedAt);
  } finally {
    restoreGeneratedConfig(originals);
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
