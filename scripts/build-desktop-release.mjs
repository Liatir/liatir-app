#!/usr/bin/env node

/**
 * Build, but never publish, one signed desktop release from an exact revision.
 *
 * Publishing and remote release creation deliberately live outside this script:
 * producing local artifacts and making them public are separate authorization
 * boundaries. Generated configuration is restored even after a failed build.
 *
 * `--msix` builds the Microsoft Store package instead: no in-app updater, no
 * code signature (the Store signs what it certifies), and the Store identity
 * reserved in Partner Center.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleMsix } from './desktop-msix.mjs';
import { localNodeCliInvocation, npmInvocation } from './node-cli.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
// Cargo.lock is listed because it records the crate version the generated Cargo.toml carries, so a
// release build rewrites it; restoring it keeps the checkout clean for the next build.
const GENERATED_CONFIG = [
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
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
const RELEASE_PLATFORMS = new Set(['darwin', 'win32', 'linux']);

function validateMsixEnvironment(environment, platform) {
  const errors = [];
  if (platform !== 'win32') errors.push('The Microsoft Store package can only be built on Windows');
  if (!/^\d+\.\d+\.\d+$/.test(environment.APP_VERSION ?? '')) {
    errors.push('APP_VERSION must be a numeric X.Y.Z version for the Microsoft Store');
  }
  if (!/^[0-9a-f]{40}$/.test(environment.RELEASE_REVISION ?? '')) {
    errors.push('RELEASE_REVISION must be the exact 40-character Git commit SHA');
  }
  // All three come from the app's Product identity page in Partner Center; a package that does not
  // match the reservation is rejected at submission.
  if (!environment.MSIX_IDENTITY_NAME?.trim()) errors.push('MSIX_IDENTITY_NAME is required (Partner Center Package/Identity/Name)');
  if (!/^CN=/.test(environment.MSIX_IDENTITY_PUBLISHER ?? '')) {
    errors.push('MSIX_IDENTITY_PUBLISHER must be the Partner Center publisher, starting with CN=');
  }
  if (!environment.MSIX_PUBLISHER_DISPLAY_NAME?.trim()) {
    errors.push('MSIX_PUBLISHER_DISPLAY_NAME is required (Partner Center publisher display name)');
  }
  return errors;
}

export function validateReleaseEnvironment(environment, platform = process.platform, distribution = 'direct') {
  if (distribution === 'msix') return validateMsixEnvironment(environment, platform);
  const errors = [];
  if (!RELEASE_PLATFORMS.has(platform)) {
    errors.push('This Gate 7 release contract is implemented for macOS, Windows and Linux; add and verify the native platform contract first');
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

  // Linux packages carry no code signature of their own: the signed updater artifact is what a
  // running Liatir trusts, and it is already required above.
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

function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  run(invocation.command, invocation.args, options);
}

function runTauri(args) {
  const invocation = localNodeCliInvocation('@tauri-apps/cli/tauri.js', args);
  run(invocation.command, invocation.args);
}

/** Every default Cargo feature except the updater, which a Store build must not contain. */
function storeFeatures() {
  const metadata = JSON.parse(execFileSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: join(ROOT, 'src-tauri'),
    encoding: 'utf8',
  }));
  const crate = metadata.packages.find((entry) => entry.name === 'liatir');
  if (!crate) throw new Error('The liatir crate is missing from cargo metadata');
  return crate.features.default.filter((feature) => feature !== 'tauri-plugin-updater');
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

  if (platform === 'linux') {
    const current = (suffix) => files.find((path) => path.endsWith(suffix) && basename(path).includes(version));
    const appImage = current('.AppImage');
    if (!appImage || !current('.deb') || !current('.rpm')) {
      throw new Error('Linux release must contain a current-version AppImage, .deb and .rpm');
    }
    // The AppImage is the only Linux format that replaces itself; .deb and .rpm update through
    // their package manager.
    if (!existsSync(`${appImage}.sig`)) throw new Error(`${basename(appImage)} has no updater signature`);
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

export function validateDesktopReleaseInputs(
  environment = process.env,
  platform = process.platform,
  distribution = 'direct',
) {
  const errors = validateReleaseEnvironment(environment, platform, distribution);
  if (errors.length > 0) throw new Error(`Desktop release inputs are incomplete:\n- ${errors.join('\n- ')}`);
}

/**
 * Tauri notarizes and staples the app bundle but not the disk image it is shipped in, and
 * Gatekeeper assesses a downloaded disk image on its own before anything inside it opens.
 */
function notarizeDiskImage(environment) {
  const directory = join(ROOT, 'src-tauri', 'target', 'release', 'bundle', 'dmg');
  const dmg = readdirSync(directory).find((name) => name.endsWith('.dmg') && name.includes(environment.APP_VERSION));
  if (!dmg) throw new Error(`No ${environment.APP_VERSION} disk image under ${directory}`);
  const credentials = environment.APPLE_API_KEY_PATH?.trim()
    ? ['--key', environment.APPLE_API_KEY_PATH, '--key-id', environment.APPLE_API_KEY, '--issuer', environment.APPLE_API_ISSUER]
    : ['--apple-id', environment.APPLE_ID, '--password', environment.APPLE_PASSWORD, '--team-id', environment.APPLE_TEAM_ID];
  run('xcrun', ['notarytool', 'submit', join(directory, dmg), ...credentials, '--wait']);
  // Stapling fails unless Apple accepted the submission, which is what stops a rejected image here.
  run('xcrun', ['stapler', 'staple', join(directory, dmg)]);
}

function buildDirectRelease() {
  const buildStartedAt = Date.now();
  runNpm(['run', 'build:prepare', '--prefix', 'src-tauri']);
  runTauri(['build', '--ci']);
  if (process.platform === 'darwin') notarizeDiskImage(process.env);
  requireArtifacts(process.platform, process.env.APP_VERSION, buildStartedAt);
}

function buildStorePackage() {
  const buildStartedAt = Date.now();
  runNpm(['run', 'build:prepare', '--prefix', 'src-tauri'], { env: { ...process.env, DISTRIBUTION: 'msix' } });
  runTauri(['build', '--ci', '--no-bundle', '--features', storeFeatures().join(','), '--', '--no-default-features']);

  const executable = join(ROOT, 'src-tauri', 'target', 'release', 'liatir.exe');
  if (statSync(executable).mtimeMs < buildStartedAt - 2_000) {
    throw new Error('The Windows application executable was not produced by this Store build');
  }
  // Absent, not merely unconfigured: a compiled-in updater leaves its crate path in the binary.
  if (readFileSync(executable).includes('tauri-plugin-updater')) {
    throw new Error('The Store executable still contains the in-app updater');
  }
  const msix = assembleMsix({
    root: ROOT,
    appVersion: process.env.APP_VERSION,
    executable,
    identity: {
      name: process.env.MSIX_IDENTITY_NAME,
      publisher: process.env.MSIX_IDENTITY_PUBLISHER,
      publisherDisplayName: process.env.MSIX_PUBLISHER_DISPLAY_NAME,
    },
  });
  console.log(`Built the unsigned Microsoft Store package ${msix}; the Store signs it on certification.`);
}

async function main() {
  const validateOnly = process.argv.includes('--validate-only');
  const distribution = process.argv.includes('--msix') ? 'msix' : 'direct';
  validateDesktopReleaseInputs(process.env, process.platform, distribution);
  if (validateOnly) {
    console.log('Desktop release inputs are complete. No build or remote action was performed.');
    return;
  }

  assertReleaseCheckout(process.env);
  const originals = captureGeneratedConfig();
  try {
    // Dependencies come from the lockfiles, installed with `npm ci` before this runs: an install here
    // would rewrite package-lock.json on a machine with another npm.
    runNpm(['run', 'test:verify']);
    if (distribution === 'msix') buildStorePackage();
    else buildDirectRelease();
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
