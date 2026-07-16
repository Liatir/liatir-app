/** Audits the exact Python distributions and license notices installed in a Runtime Box. */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { basename, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const LICENSE_FILE = /^(?:licen[cs]e|copying|notice|authors)(?:[._-].*)?$/i;

function fail(message) {
  throw new Error(`Runtime Box license audit: ${message}`);
}

function normalizePackageName(value) {
  return value.toLowerCase().replace(/[-_.]+/g, '-');
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function metadataHeaders(source) {
  const headers = new Map();
  for (const line of source.split(/\r?\n/)) {
    if (line === '') break;
    if (/^\s/.test(line)) continue;
    const separator = line.indexOf(':');
    if (separator < 1) continue;
    const key = line.slice(0, separator);
    const value = line.slice(separator + 1).trim();
    const values = headers.get(key) ?? [];
    values.push(value);
    headers.set(key, values);
  }
  return headers;
}

function walkFiles(root, current = root) {
  return readdirSync(current, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(current, entry.name);
    if (entry.isDirectory()) return walkFiles(root, path);
    return entry.isFile() ? [relative(root, path).split(sep).join('/')] : [];
  });
}

/** Returns exact normalized name/version pairs from a fully pinned requirements lock. */
export function lockedPythonDistributions(lockBytes) {
  return [...lockBytes.toString('utf8').matchAll(/^([A-Za-z0-9_.-]+)==([^\s\\]+)\s*\\/gm)]
    .map((match) => ({ name: normalizePackageName(match[1]), version: match[2] }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Audits installed metadata without importing or executing any package code. */
export function auditInstalledPythonDistributions(sitePackagesPath) {
  const sitePackages = resolve(sitePackagesPath);
  if (!existsSync(sitePackages) || !statSync(sitePackages).isDirectory()) {
    fail(`site-packages directory does not exist: ${sitePackages}`);
  }
  return readdirSync(sitePackages, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.dist-info'))
    .map((entry) => {
      const distribution = resolve(sitePackages, entry.name);
      const metadataPath = resolve(distribution, 'METADATA');
      if (!existsSync(metadataPath)) fail(`${entry.name} has no METADATA`);
      const headers = metadataHeaders(readFileSync(metadataPath, 'utf8'));
      const name = normalizePackageName(headers.get('Name')?.[0] ?? '');
      const version = headers.get('Version')?.[0] ?? '';
      const expression = headers.get('License-Expression')?.[0];
      const classifiers = (headers.get('Classifier') ?? [])
        .filter((value) => value.startsWith('License ::'));
      const legacy = headers.get('License')?.[0];
      const declaredLicense = expression || classifiers.join(' OR ') || legacy;
      if (!name || !version) fail(`${entry.name} lacks a name or version`);
      if (!declaredLicense || declaredLicense.toUpperCase() === 'UNKNOWN') {
        fail(`${name}==${version} lacks a declared license`);
      }
      const licenseFiles = walkFiles(distribution)
        .filter((path) => LICENSE_FILE.test(basename(path)))
        .sort();
      return { name, version, declaredLicense, licenseFiles };
    })
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** Builds the deterministic audit bound to one lock and target. */
export function createPythonDependencyLicenseAudit({
  lockBytes,
  sitePackagesPath,
  targetId,
  torchBackend,
}) {
  const expected = lockedPythonDistributions(lockBytes);
  const packages = auditInstalledPythonDistributions(sitePackagesPath);
  const actual = packages.map(({ name, version }) => ({ name, version }));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail('installed distributions do not exactly match the dependency lock');
  }
  return {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.python-dependency-license-audit',
    targetId,
    torchBackend,
    dependencyLockSha256: sha256(lockBytes),
    packages,
  };
}

/** Ensures a reviewed audit still matches the current lock and exact installed wheel metadata. */
export function validatePythonDependencyLicenseAudit(reviewed, actual) {
  if (reviewed?.schemaVersion !== 1 || reviewed.kind !== actual.kind) fail('reviewed audit contract is invalid');
  if (JSON.stringify(reviewed) !== JSON.stringify(actual)) {
    fail('installed dependency licenses differ from the reviewed audit');
  }
  return actual;
}

async function main() {
  const options = new Map();
  const values = process.argv.slice(2);
  for (let index = 0; index < values.length; index += 2) {
    if (!values[index]?.startsWith('--') || values[index + 1] === undefined) fail('expected --key value options');
    options.set(values[index].slice(2), values[index + 1]);
  }
  const lockPath = resolve(String(options.get('lock')));
  const output = resolve(String(options.get('output')));
  const audit = createPythonDependencyLicenseAudit({
    lockBytes: readFileSync(lockPath),
    sitePackagesPath: String(options.get('site-packages')),
    targetId: String(options.get('target')),
    torchBackend: String(options.get('torch-backend')),
  });
  await mkdir(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(audit, null, 2)}\n`);
  console.log(JSON.stringify(audit));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
