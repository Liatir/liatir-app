#!/usr/bin/env node

/**
 * runtime-box — the release CLI for AI Runtime Boxes.
 *
 * This is the producer side of the distribution chain whose consumer is
 * `src-tauri/src/bridge/runtime_boxes.rs`. It takes a *recipe* (a pinned description of a Python
 * environment plus model assets) and turns it into a signed, published, installable box:
 *
 *   lock -> build -> verify -> publish -> promote        (and `revoke` to withdraw one)
 *
 * Two properties drive most of the design:
 *
 * 1. **Reproducibility.** The archive is content-addressed by its SHA-256, and that hash is what
 *    the app enforces at install time. So the archive must be byte-identical when rebuilt from
 *    the same inputs — no embedded timestamps, no filesystem ordering, no stray caches. Hence
 *    the fixed mtimes, the sorted file list, the `zip -X`, and the hash-pinned dependency lock.
 *
 * 2. **The private key is never required to be here.** Local Ed25519 keys exist for development,
 *    but a production build delegates signing to the Cloud Run signer service, which keeps the
 *    key in KMS. Either way, this CLI verifies the signature it gets back before trusting it.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  chmod,
  copyFile,
  cp,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
/** Recipes are checked in; everything below is generated and git-ignored. */
const RECIPE_ROOT = join(ROOT, 'runtime-boxes', 'recipes');
/** Local dev signing keys — never used for production releases. */
const LOCAL_ROOT = join(ROOT, '.runtime-box-local');
/** Scratch space where the payload tree is assembled. */
const BUILD_ROOT = join(ROOT, '.runtime-box-build');
/** Finished artefacts: archives, signed documents, and the objects to upload. */
const DIST_ROOT = join(ROOT, '.runtime-box-dist');
const DEFAULT_PRIVATE_KEY = join(LOCAL_ROOT, 'signing-private.pem');
const DEFAULT_PUBLIC_KEY = join(LOCAL_ROOT, 'signing-public.json');
const DEFAULT_OBJECT_PREFIX = 'ai-runtime-boxes';
/**
 * Every file's mtime is forced to this constant before archiving. Zip stores per-entry
 * timestamps, so without this the same inputs would produce a different archive — and therefore
 * a different SHA-256 — on every build.
 */
const FIXED_ARCHIVE_TIME = new Date('2000-01-01T00:00:00.000Z');

/** Throws. Usable as an expression, e.g. `flags.get('x') || fail('...')`. */
function fail(message) {
  throw new Error(message);
}

/** Minimal flag parser supporting `--name=value`, `--name value` and bare `--name` (true). */
function parseArgs(values) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) {
      positional.push(value);
      continue;
    }
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[index + 1]);
      index += 1;
    } else flags.set(name, true);
  }
  return { positional, flags };
}

/**
 * Runs a subprocess and throws on any non-zero exit.
 *
 * The exit status is checked explicitly rather than inferred from output: a build step that
 * fails quietly must never be mistaken for one that succeeded. With `capture`, output is
 * returned; otherwise it is inherited so long steps (pip installs, downloads) stream live.
 */
function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : ['pipe', 'inherit', 'inherit'],
  });
  // `error` means the binary could not be launched at all (e.g. uv not installed), which is a
  // different failure from the command running and rejecting the input.
  if (result.error) fail(`${command} failed to start: ${result.error.message}`);
  if (result.status !== 0) {
    const detail = options.capture ? `\n${result.stderr || result.stdout}` : '';
    fail(`${command} exited with status ${result.status}${detail}`);
  }
  return (result.stdout ?? '').trim();
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function sha256File(path) {
  const hash = createHash('sha256');
  const source = createReadStream(path);
  for await (const chunk of source) hash.update(chunk);
  return hash.digest('hex');
}

async function fileExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Rejects any path that could escape the tree it will be joined onto.
 *
 * Applied to every path that comes from a recipe *and* to every entry name inside a downloaded
 * zip. The latter is the important one: it is what prevents a "zip slip", where an archive entry
 * named `../../etc/something` writes outside the extraction directory.
 */
function safeRelativePath(value) {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) fail(`Unsafe relative path: ${value}`);
  if (normalized.split('/').some((part) => part === '..' || part === '')) fail(`Unsafe relative path: ${value}`);
  return normalized;
}

/** Resolves a recipe name to its directory, refusing anything that escapes the recipe root. */
function recipeDirectory(name) {
  const path = resolve(RECIPE_ROOT, name);
  if (path !== RECIPE_ROOT && !path.startsWith(`${RECIPE_ROOT}${sep}`)) fail(`Invalid recipe: ${name}`);
  return path;
}

/**
 * Loads and sanity-checks a recipe. The `recipeId` must equal the directory name, so a recipe
 * cannot quietly claim a different identity from the one being built.
 */
async function readRecipe(name) {
  const dir = recipeDirectory(name);
  const recipe = JSON.parse(await readFile(join(dir, 'recipe.json'), 'utf8'));
  if (recipe.schemaVersion !== 1 || recipe.recipeId !== name) fail(`Invalid recipe contract: ${name}`);
  // Boxes are built natively, not cross-compiled, so the builder only accepts the target it can
  // actually produce today.
  if (recipe.target.platform !== 'macos' || recipe.target.arch !== 'aarch64') {
    fail('The foundation builder currently supports macOS arm64 recipes only.');
  }
  return { dir, recipe };
}

/** The target slug used in URLs and filenames. Must match the app's `target_id()` exactly. */
function targetId(target) {
  const cuda = target.cudaVersion ? `-cuda${target.cudaVersion}` : '';
  return `${target.platform}-${target.arch}-${target.accelerator}${cuda}`;
}

/** Shared filename stem, so the archive and its release document are found as a pair. */
function releaseStem(release) {
  return `${release.boxId}-${release.version}-${targetId(release.target)}`;
}

/** Where a release's immutable objects live in the bucket. */
function releaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${targetId(release.target)}`;
}

/** Validates the bucket prefix segment by segment — it is interpolated straight into object keys. */
function normalizeObjectPrefix(value) {
  const prefix = String(value ?? DEFAULT_OBJECT_PREFIX).replace(/^\/+|\/+$/g, '');
  if (!prefix || prefix.split('/').some((segment) => !/^[a-z0-9][a-z0-9._-]*$/.test(segment))) {
    fail(`Invalid R2 object prefix: ${value}`);
  }
  return prefix;
}

function prefixedObjectKey(prefix, key) {
  return `${normalizeObjectPrefix(prefix)}/${safeRelativePath(key)}`;
}

/**
 * Creates a local Ed25519 signing key pair (development only — production keys live in KMS).
 *
 * Overwriting an existing key is gated behind `--force` because doing so silently would
 * invalidate every document previously signed with it.
 */
async function keygen(flags) {
  const privatePath = resolve(String(flags.get('private-key') || DEFAULT_PRIVATE_KEY));
  const publicPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  if ((await fileExists(privatePath)) && !flags.get('force')) {
    fail(`Signing key already exists: ${privatePath}. Pass --force to rotate it explicitly.`);
  }
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const privatePem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  // An Ed25519 SPKI DER is a fixed 12-byte header followed by the 32-byte key, so the raw key is
  // simply the tail. That raw form is what the Rust client and the Worker expect in base64.
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  // Deriving the ID from the key itself makes it stable and collision-resistant without a registry.
  const keyId = String(flags.get('key-id') || `liatir-runtime-box-${sha256Buffer(rawPublicKey).slice(0, 16)}`);
  await mkdir(dirname(privatePath), { recursive: true });
  await mkdir(dirname(publicPath), { recursive: true });
  // Owner-only, and chmod again afterwards in case a permissive umask widened the mode on create.
  await writeFile(privatePath, privatePem, { mode: 0o600 });
  await chmod(privatePath, 0o600);
  await writeFile(publicPath, `${JSON.stringify({
    algorithm: 'ed25519',
    keyId,
    publicKeyBase64: rawPublicKey.toString('base64'),
    publicKeyPem: publicPem,
  }, null, 2)}\n`);
  console.log(`Created private key: ${relative(ROOT, privatePath)}`);
  console.log(`Created public key:  ${relative(ROOT, publicPath)}`);
}

/**
 * Loads the local private key and cross-checks it against the published public key file, so a
 * mismatched pair is caught here rather than producing documents nobody can verify.
 */
async function readSigningKey(flags) {
  const privatePath = resolve(String(flags.get('private-key') || DEFAULT_PRIVATE_KEY));
  if (!await fileExists(privatePath)) fail(`Signing key not found: ${privatePath}. Run the keygen command first.`);
  const privateKey = createPrivateKey(await readFile(privatePath, 'utf8'));
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: 'spki', format: 'der' });
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const publicMetadataPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const metadata = JSON.parse(await readFile(publicMetadataPath, 'utf8'));
  if (metadata.publicKeyBase64 !== rawPublicKey.toString('base64')) fail('Private and public Runtime Box signing keys do not match.');
  return { privateKey, metadata };
}

/** Accepts both trust-file shapes: a bundle of keys, or a single bare key. */
function readTrustedKeyEntries(value) {
  if (Array.isArray(value?.keys)) return value.keys;
  return [value];
}

/**
 * Production signing path: hands the payload to the Cloud Run signer, which asks KMS to sign it.
 *
 * The caller authenticates with a short-lived Google identity token from the local `gcloud`
 * session, so no long-lived credential is stored anywhere. Two checks are applied to the
 * response before it is trusted: the signer must echo back *exactly* the payload we sent (not a
 * substituted one), and the returned signature is verified locally against the public key. A
 * remote signer is therefore not taken on faith.
 */
async function signDocumentRemotely(payloadBytes, flags) {
  const signer = String(flags.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL || '').replace(/\/$/, '');
  const tokenArgs = flags.get('signer-audience')
    ? ['auth', 'print-identity-token', `--audiences=${String(flags.get('signer-audience'))}`]
    : ['auth', 'print-identity-token'];
  const identityToken = run('gcloud', tokenArgs, { capture: true });
  const request = {
    payloadBase64: payloadBytes.toString('base64'),
    payloadSha256: sha256Buffer(payloadBytes),
  };
  const response = await fetch(`${signer}/v1/sign`, {
    method: 'POST',
    headers: { authorization: `Bearer ${identityToken}`, 'content-type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) fail(`Remote Runtime Box signing failed (${response.status}): ${await response.text()}`);
  const document = await response.json();
  if (document.payloadBase64 !== request.payloadBase64 || document.payloadSha256 !== request.payloadSha256) {
    fail('Remote signer returned a different Runtime Box payload.');
  }
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  await verifySignedDocument(document, publicKeyPath);
  return document;
}

/**
 * Wraps a manifest in the signed envelope the Worker stores and the app verifies.
 *
 * Routes to the remote signer when one is configured, otherwise signs with the local dev key.
 * The payload bytes are serialised once and both hashed and signed as-is, so what gets signed is
 * byte-for-byte what gets published.
 */
async function signDocument(payload, flags) {
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  if (flags.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL) {
    return signDocumentRemotely(payloadBytes, flags);
  }
  const { privateKey, metadata } = await readSigningKey(flags);
  return {
    schemaVersion: 1,
    payloadEncoding: 'base64-json-utf8',
    payloadBase64: payloadBytes.toString('base64'),
    payloadSha256: sha256Buffer(payloadBytes),
    signatures: [{
      algorithm: 'ed25519',
      keyId: metadata.keyId,
      signatureBase64: sign(null, payloadBytes, privateKey).toString('base64'),
    }],
  };
}

/** Unwraps the envelope and checks its checksum. Does *not* check the signature — see below. */
function decodeSignedDocument(document) {
  if (document?.schemaVersion !== 1 || document?.payloadEncoding !== 'base64-json-utf8') fail('Unsupported signed Runtime Box document.');
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  if (sha256Buffer(bytes) !== document.payloadSha256) fail('Signed payload SHA-256 mismatch.');
  return { bytes, payload: JSON.parse(bytes.toString('utf8')) };
}

/**
 * Verifies a signed document against the trusted key file and returns its payload.
 *
 * Accepts the document if any one signature verifies against a trusted key, which is what allows
 * a document signed by both an outgoing and an incoming key to be valid during a rotation.
 */
async function verifySignedDocument(document, publicKeyPath) {
  const metadata = readTrustedKeyEntries(JSON.parse(await readFile(publicKeyPath, 'utf8')));
  const { bytes, payload } = decodeSignedDocument(document);
  const valid = document.signatures?.some((signature) => {
    const key = metadata.find((candidate) => candidate.keyId === signature.keyId);
    return key?.publicKeyPem
      && verify(null, bytes, createPublicKey(key.publicKeyPem), Buffer.from(signature.signatureBase64, 'base64'));
  });
  if (!valid) fail('Runtime Box document has no valid signature from a trusted Ed25519 key.');
  return payload;
}

/**
 * Locates `uv` and pins it to the exact version the recipe names.
 *
 * The version is an input to reproducibility, not a convenience check: a different resolver
 * version can pick different wheels and silently change the archive's hash.
 */
function findUv(flags, requiredVersion) {
  const candidate = String(flags.get('uv') || process.env.LIATIR_RUNTIME_BOX_UV || 'uv');
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) fail(`uv ${requiredVersion} is required. Install it from https://docs.astral.sh/uv/ or pass --uv <path>.`);
  // `uv --version` prints "uv 0.x.y"; the version is the second token.
  const actual = result.stdout.trim().split(/\s+/)[1];
  if (actual !== requiredVersion) fail(`Recipe requires uv ${requiredVersion}, found ${actual}.`);
  return candidate;
}

/**
 * `lock` — resolves the recipe's requirements into a fully pinned, hash-locked file.
 *
 * Run by a human when dependencies change; the result is committed. `build` then only *installs*
 * from this lock, never resolves, so what ships is exactly what was reviewed.
 *
 * The flags all serve determinism: `--generate-hashes` pins every wheel by digest,
 * `--only-binary :all:` forbids source builds (which would compile differently per machine),
 * the explicit python version/platform make resolution independent of the host, and
 * `--no-header`/`--no-annotate`/`--no-emit-index-url` keep machine-specific noise out of the
 * committed file.
 */
async function lockRecipe(name, flags) {
  const { dir, recipe } = await readRecipe(name);
  const uv = findUv(flags, recipe.uvVersion);
  run(uv, [
    'pip', 'compile', join(dir, recipe.requirementsInput),
    '--output-file', join(dir, recipe.requirementsLock),
    '--python-version', recipe.pythonVersion,
    '--python-platform', 'aarch64-apple-darwin',
    '--generate-hashes', '--only-binary', ':all:',
    '--no-emit-index-url', '--no-annotate', '--no-header',
  ]);
  console.log(`Updated ${relative(ROOT, join(dir, recipe.requirementsLock))}`);
}

/**
 * Downloads a model asset (weights, tokenizers, …) and enforces the recipe's declared hash.
 *
 * Model files are large, so the download is resumable: a partial file is kept as `.part` and
 * continued with a Range request. Two safeguards matter here — an already-complete file with the
 * right size and hash is skipped entirely (making `build` re-runnable without re-downloading
 * gigabytes), and the `.part` file is only renamed into place *after* the hash matches, so an
 * interrupted or corrupted transfer can never masquerade as a finished asset.
 */
async function downloadVerified(asset, destination) {
  const expectedPath = safeRelativePath(asset.relativePath).split('/').join(sep);
  if (!destination.endsWith(expectedPath)) fail(`Unexpected asset destination: ${destination}`);
  await mkdir(dirname(destination), { recursive: true });
  if (await fileExists(destination)) {
    const current = await stat(destination);
    if (current.size === asset.sizeBytes && await sha256File(destination) === asset.sha256) return;
  }
  const partPath = `${destination}.part`;
  const resumeAt = await fileExists(partPath) ? (await stat(partPath)).size : 0;
  const response = await fetch(asset.url, {
    headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined,
    redirect: 'follow',
  });
  if (!response.ok) fail(`Asset download failed (${response.status}): ${asset.url}`);
  // Only append when the server actually honoured the range (206). A server that ignores Range
  // replies 200 with the whole body, which must overwrite rather than be appended to a partial.
  const append = resumeAt > 0 && response.status === 206;
  await pipeline(response.body, createWriteStream(partPath, { flags: append ? 'a' : 'w' }));
  const downloaded = await stat(partPath);
  if (downloaded.size !== asset.sizeBytes) fail(`Asset size mismatch for ${asset.relativePath}.`);
  if (await sha256File(partPath) !== asset.sha256) fail(`Asset SHA-256 mismatch for ${asset.relativePath}.`);
  await rename(partPath, destination);
}

/** Copy a checked-in legal or runtime file into the payload after verifying its recipe hash. */
async function copyVerifiedLocalFile(file, payloadDir) {
  const source = join(ROOT, safeRelativePath(file.sourcePath));
  if (!await fileExists(source) || !(await stat(source)).isFile()) {
    fail(`Local Runtime Box file is missing: ${file.sourcePath}`);
  }
  if (await sha256File(source) !== file.sha256) {
    fail(`Local Runtime Box file SHA-256 mismatch: ${file.sourcePath}`);
  }
  const destination = join(payloadDir, safeRelativePath(file.relativePath));
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

/** Stage a large immutable object without duplicating its bytes on the same filesystem. */
async function linkOrCopyFile(source, destination) {
  await rm(destination, { force: true });
  try {
    await link(source, destination);
  } catch {
    await copyFile(source, destination);
  }
}

/**
 * Lists every file under `root` as a sorted array of forward-slash relative paths.
 *
 * Both properties are load-bearing for reproducibility: the sort removes the filesystem's
 * arbitrary directory ordering, and the exclusions drop artefacts that vary between machines and
 * between runs (`__pycache__` and `.pyc` are regenerated on every Python run; `.DS_Store` is
 * created by the Finder). Any of them would change the archive's hash.
 */
async function collectFiles(root, current = root) {
  const entries = await readdir(current, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name === '__pycache__' || entry.name === '.DS_Store' || entry.name.endsWith('.pyc')) continue;
    const fullPath = join(current, entry.name);
    if (entry.isDirectory()) files.push(...await collectFiles(root, fullPath));
    else files.push(relative(root, fullPath).split(sep).join('/'));
  }
  return files;
}

/** Sum the logical size of the exact files that will be written to the ZIP. */
async function payloadSize(root) {
  let total = 0;
  for (const file of await collectFiles(root)) {
    total += (await stat(join(root, file))).size;
    if (!Number.isSafeInteger(total)) fail('Runtime Box installed size exceeds the safe integer range.');
  }
  return total;
}

/** Reject links and special nodes before any extracted asset is copied into the payload. */
async function validateExtractedTree(root, current = root) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const fullPath = join(current, entry.name);
    if (entry.isSymbolicLink()) fail(`Archive links are not allowed: ${relative(root, fullPath)}`);
    if (entry.isDirectory()) await validateExtractedTree(root, fullPath);
    else if (!entry.isFile()) fail(`Archive special entries are not allowed: ${relative(root, fullPath)}`);
  }
}

/** Validate entry names independently from the archive tool used to list them. */
function validateArchiveEntryNames(entries) {
  for (const entry of entries) {
    const normalized = entry.replace(/\/$/, '');
    if (normalized) safeRelativePath(normalized);
  }
}

/** Accept only regular files and directories; links could redirect later extracted writes. */
function validateArchiveEntryTypes(entries, expectedCount, relativePath) {
  if (entries.length !== expectedCount || entries.some((entry) => !['-', 'd'].includes(entry[0]))) {
    fail(`Archive links and special entries are not allowed: ${relativePath}`);
  }
}

/** Create the byte-reproducible ZIP used by production builds, with automatic Zip64 support. */
async function createDeterministicZip(payloadDir, archivePath) {
  await rm(archivePath, { force: true });
  const archiveEntries = await collectFiles(payloadDir);
  if (archiveEntries.length === 0) fail('Runtime Box payload is empty.');
  run('zip', ['-X', '-q', archivePath, '-@'], {
    cwd: payloadDir,
    input: `${archiveEntries.join('\n')}\n`,
  });
}

/**
 * Unpacks a downloaded asset archive into the payload tree.
 *
 * Entries are listed and validated *before* extraction (archive-slip defence), then unpacked into a
 * temp dir and copied to their destination. `stripComponents` drops the redundant top-level
 * wrapper directory that many published archives carry; it insists on finding exactly one
 * directory to strip, so a surprising layout fails loudly instead of producing a wrong tree.
 */
async function extractRecipeArchive(payloadDir, archive) {
  const archivePath = join(payloadDir, safeRelativePath(archive.relativePath));
  if (!['zip', 'tar.gz'].includes(archive.format)) {
    fail(`Unsupported recipe archive format: ${archive.format}`);
  }
  const listCommand = archive.format === 'zip'
    ? ['unzip', ['-Z1', archivePath]]
    : ['tar', ['-tzf', archivePath]];
  const entries = run(listCommand[0], listCommand[1], { capture: true }).split('\n').filter(Boolean);
  validateArchiveEntryNames(entries);
  if (archive.format === 'tar.gz') {
    const verboseEntries = run('tar', ['-tvzf', archivePath], { capture: true }).split('\n').filter(Boolean);
    validateArchiveEntryTypes(verboseEntries, entries.length, archive.relativePath);
  } else {
    const verboseEntries = run('unzip', ['-Z', '-l', archivePath], { capture: true })
      .split('\n')
      .filter((entry) => /^[bcdlps-][rwxstST-]*\s+\d+\.\d+\s/.test(entry));
    validateArchiveEntryTypes(verboseEntries, entries.length, archive.relativePath);
  }
  const extracted = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-asset-'));
  try {
    if (archive.format === 'zip') run('unzip', ['-q', archivePath, '-d', extracted]);
    else run('tar', ['-xzf', archivePath, '-C', extracted]);
    // Defence in depth: even if an archive tool's listing format changes, links are caught
    // before `cp` can follow them or copy data from outside the extraction root.
    await validateExtractedTree(extracted);
    let source = extracted;
    const stripComponents = Number(archive.stripComponents ?? 0);
    for (let index = 0; index < stripComponents; index += 1) {
      // __MACOSX / .DS_Store are Finder artefacts that would otherwise look like a second
      // top-level entry and defeat the "exactly one directory" check.
      const children = (await readdir(source, { withFileTypes: true }))
        .filter((entry) => entry.name !== '__MACOSX' && entry.name !== '.DS_Store');
      if (children.length !== 1 || !children[0].isDirectory()) {
        fail(`Cannot strip component ${index + 1} from ${archive.relativePath}.`);
      }
      source = join(source, children[0].name);
    }
    const destination = join(payloadDir, safeRelativePath(archive.destination));
    await mkdir(dirname(destination), { recursive: true });
    await cp(source, destination, { recursive: true, dereference: false, preserveTimestamps: false });
  } finally {
    // Always clean the temp dir, including when extraction threw.
    await rm(extracted, { recursive: true, force: true });
  }
  // The compressed original is dead weight inside the payload once unpacked.
  if (archive.removeAfterExtract !== false) await rm(archivePath, { force: true });
}

/** Stamps every file with the same fixed mtime — see FIXED_ARCHIVE_TIME. */
async function normalizeTree(root) {
  for (const file of await collectFiles(root)) await utimes(join(root, file), FIXED_ARCHIVE_TIME, FIXED_ARCHIVE_TIME);
}

/**
 * Build timestamp taken from the HEAD commit rather than the clock, so rebuilding the same commit
 * produces the same provenance. Falls back to the epoch outside a git checkout — deliberately a
 * constant, since a wall-clock fallback would reintroduce the nondeterminism this avoids.
 */
async function gitBuildTime() {
  const result = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : new Date(0).toISOString();
}

/** The commit a box was built from, and whether the tree had uncommitted changes at the time. */
function gitBuildState() {
  const revision = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const status = run('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true });
  return { revision, dirty: status.length > 0 };
}

/**
 * `build` — the core command: assemble the environment, prove it works, archive it, sign it.
 *
 * Steps, in order:
 *   1. copy a standalone Python interpreter into the payload;
 *   2. install the locked, hash-pinned dependencies into it;
 *   3. download and unpack the model assets, then prune what is not needed at runtime;
 *   4. self-test with the payload's own interpreter — this is what catches a box that unpacks
 *      but cannot actually import its dependencies;
 *   5. normalise timestamps and zip deterministically;
 *   6. emit a signed release manifest and a signed channel manifest.
 *
 * The resulting archive is content-addressed by its own hash, so the release manifest can commit
 * to it and the app can verify it byte for byte.
 */
async function buildRecipe(name, flags) {
  // Boxes are built natively, never cross-compiled: the wheels and the interpreter must be the
  // ones that will actually run on the target.
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('This foundation recipe must be built natively on macOS arm64.');
  const { dir, recipe } = await readRecipe(name);
  const uv = findUv(flags, recipe.uvVersion);
  const lockPath = join(dir, recipe.requirementsLock);
  // Build installs from the lock and never resolves, so a missing lock is a hard error rather
  // than an invitation to resolve dependencies on the fly.
  if (!await fileExists(lockPath)) fail(`Missing dependency lock: ${lockPath}`);
  const lockSha = await sha256File(lockPath);
  const gitState = gitBuildState();
  // A box records the commit it came from. If the tree is dirty that record is a lie — the built
  // artefact would not be reproducible from that revision — so refuse unless explicitly allowed.
  if (gitState.dirty && !flags.get('allow-dirty')) {
    fail('Refusing to build a release from a dirty source tree. Commit first or pass --allow-dirty for local development.');
  }
  const buildDir = join(BUILD_ROOT, recipe.recipeId);
  const payloadDir = join(buildDir, 'payload');
  const stem = releaseStem(recipe);
  const archivePath = join(DIST_ROOT, `${stem}.zip`);
  const objectPrefix = releaseObjectPrefix(recipe);
  const objectDir = join(DIST_ROOT, 'objects', objectPrefix);
  // Always start from an empty tree: leftovers from a previous build would end up in the archive.
  await rm(buildDir, { recursive: true, force: true });
  // Rebuilding the same release must not keep its previous multi-gigabyte local staging objects.
  await rm(archivePath, { force: true });
  await rm(objectDir, { recursive: true, force: true });
  await mkdir(payloadDir, { recursive: true });

  // `only-managed` forces uv's own standalone interpreter rather than whatever Python happens to
  // be on this machine — the box must carry a self-contained interpreter, not depend on the host.
  // UV_NO_CONFIG keeps a developer's local uv settings from influencing the build.
  const managedPython = run(uv, [
    'python', 'find', recipe.pythonVersion, '--python-preference', 'only-managed',
  ], { capture: true, env: { UV_NO_CONFIG: '1' } });
  // `python find` returns .../bin/python3, so two levels up is the interpreter's root directory.
  const standaloneRoot = dirname(dirname(managedPython));
  await cp(standaloneRoot, join(payloadDir, 'venv'), {
    recursive: true,
    dereference: true,
    preserveTimestamps: false,
  });
  // Installs *into the copied interpreter* (hence --python pointing inside the payload).
  // --require-hashes enforces the digests in the lock, so a tampered or swapped wheel fails the
  // build; --strict catches an inconsistent resulting environment.
  run(uv, [
    'pip', 'sync', lockPath, '--python', join(payloadDir, recipe.pythonEntryPoint),
    '--system', '--break-system-packages', '--require-hashes', '--strict', '--no-config',
  ]);

  // Model weights and other large files, each verified against the hash declared in the recipe.
  for (const asset of recipe.assets) {
    console.log(`Downloading ${asset.relativePath}`);
    await downloadVerified(asset, join(payloadDir, safeRelativePath(asset.relativePath)));
  }
  for (const file of recipe.localFiles ?? []) {
    await copyVerifiedLocalFile(file, payloadDir);
  }
  for (const archive of recipe.assetArchives ?? []) {
    await extractRecipeArchive(payloadDir, archive);
  }
  // Drops what is only needed to build (tests, docs, bundled sample data). These boxes are
  // multi-gigabyte downloads for end users, so pruning is a user-facing concern, not tidiness.
  for (const prunePath of recipe.prunePaths ?? []) {
    await rm(join(payloadDir, safeRelativePath(prunePath)), { recursive: true, force: true });
  }
  // Guards against over-pruning: the files the box needs at runtime must still be there.
  for (const requiredFile of recipe.selfTest.files) {
    if (!await fileExists(join(payloadDir, safeRelativePath(requiredFile)))) fail(`Missing self-test file: ${requiredFile}`);
  }
  // Run with the payload's *own* interpreter: this is the same check the app repeats after
  // installing, so a box that would fail on the user's machine fails here first.
  const selfTestCode = recipe.selfTest.pythonCode
    ? `import ${recipe.selfTest.imports.join(', ')}\n${recipe.selfTest.pythonCode}`
    : `import ${recipe.selfTest.imports.join(', ')}`;
  run(join(payloadDir, recipe.pythonEntryPoint), ['-c', selfTestCode], { cwd: payloadDir });

  // Everything needed to answer "where did this box come from and could I rebuild it?".
  // Signed together with the release and stored inside the installed box.
  const provenance = {
    recipeId: recipe.recipeId,
    recipeVersion: recipe.recipeVersion,
    builderRevision: gitState.revision,
    sourceTreeDirty: gitState.dirty,
    sourceRevision: recipe.sourceRevision,
    pythonVersion: recipe.pythonVersion,
    uvVersion: recipe.uvVersion,
    dependencyLockSha256: lockSha,
    builtAt: await gitBuildTime(),
  };
  const boxMetadata = {
    schemaVersion: 1,
    boxId: recipe.boxId,
    modelId: recipe.modelId,
    runtimeId: recipe.runtimeId,
    version: recipe.version,
    target: recipe.target,
    pythonEntryPoint: recipe.pythonEntryPoint,
    modelCacheSubdir: recipe.modelCacheSubdir,
    selfTest: {
      pythonImports: recipe.selfTest.imports,
      timeoutSeconds: 180,
    },
    provenance,
  };
  // box.json travels *inside* the archive. The app compares it field by field against the signed
  // release, which is what binds the archive's contents to its signed metadata.
  await writeFile(join(payloadDir, 'box.json'), `${JSON.stringify(boxMetadata, null, 2)}\n`);
  await normalizeTree(payloadDir);
  const installedSizeBytes = await payloadSize(payloadDir);
  await mkdir(DIST_ROOT, { recursive: true });
  // Info-ZIP selects Zip64 automatically for large entries. The shared helper is exercised by
  // the large-archive foundation gate, so the production path and proof cannot drift apart.
  await createDeterministicZip(payloadDir, archivePath);

  const archiveSha = await sha256File(archivePath);
  const archiveSize = (await stat(archivePath)).size;
  // Content-addressed: the object is named after its own hash, so publishing is idempotent and an
  // object can never be replaced with different bytes under the same URL.
  const archiveObject = `${objectPrefix}/${archiveSha}.zip`;
  const assetBaseUrl = String(flags.get('asset-base-url') || recipe.assetBaseUrl).replace(/\/$/, '');
  const release = {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.release',
    boxId: recipe.boxId,
    modelId: recipe.modelId,
    runtimeId: recipe.runtimeId,
    version: recipe.version,
    target: recipe.target,
    compatibility: recipe.compatibility,
    archive: {
      format: 'zip',
      url: `${assetBaseUrl}/${archiveObject}`,
      sha256: archiveSha,
      sizeBytes: archiveSize,
    },
    installedSizeBytes,
    pythonEntryPoint: recipe.pythonEntryPoint,
    modelCacheSubdir: recipe.modelCacheSubdir,
    selfTest: {
      pythonImports: recipe.selfTest.imports,
      timeoutSeconds: 180,
    },
    provenance,
  };
  const signedRelease = await signDocument(release, flags);
  const releasePath = join(DIST_ROOT, `${stem}.release.json`);
  await writeFile(releasePath, `${JSON.stringify(signedRelease, null, 2)}\n`);
  // The channel points at the release document by *its* hash too, so the whole chain is
  // content-addressed: channel -> release document -> archive.
  const releaseDocumentSha = await sha256File(releasePath);
  const releaseUrl = `${assetBaseUrl}/${objectPrefix}/${releaseDocumentSha}.release.json`;
  const channel = {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.channel',
    // Defaults to `beta`: shipping straight to `stable` should be a deliberate act.
    channel: String(flags.get('channel') || 'beta'),
    boxId: recipe.boxId,
    target: recipe.target,
    updatedAt: provenance.builtAt,
    // Derived from box+version rather than random, so rebuilding the same release reproduces the
    // same cohort assignment instead of reshuffling which users get it.
    cohortSalt: sha256Buffer(Buffer.from(`${recipe.boxId}:${recipe.version}`)).slice(0, 32),
    // A freshly built channel goes out at 100%; a staged rollout is arranged by editing this
    // document (or promoting a hand-written one) rather than by the builder.
    releases: [{ version: recipe.version, releaseManifestUrl: releaseUrl, rolloutPercentage: 100 }],
  };
  const signedChannel = await signDocument(channel, flags);
  const channelPath = join(DIST_ROOT, `${recipe.boxId}-${channel.channel}-${targetId(recipe.target)}.channel.json`);
  await writeFile(channelPath, `${JSON.stringify(signedChannel, null, 2)}\n`);
  // A staging tree laid out exactly as the bucket, so `publish` (and the local `serve` registry)
  // upload/serve files under the same keys the manifests already point to.
  await mkdir(objectDir, { recursive: true });
  await linkOrCopyFile(archivePath, join(objectDir, `${archiveSha}.zip`));
  await copyFile(releasePath, join(objectDir, `${releaseDocumentSha}.release.json`));
  console.log(`Built archive: ${relative(ROOT, archivePath)}`);
  console.log(`Signed release: ${relative(ROOT, releasePath)}`);
  console.log(`Signed channel: ${relative(ROOT, channelPath)}`);
}

/**
 * `verify` — re-runs the app's install-time checks locally, before anything is published.
 *
 * Deliberately mirrors what `runtime_boxes.rs` does on a user's machine: signature, archive size
 * and hash, safe entry names, `box.json` agreeing with the signed release, and the declared
 * interpreter actually present. `--self-test` goes one step further and imports the modules from
 * a real extraction, which is the closest thing to a dry-run install.
 */
async function verifyRelease(path, flags) {
  const releasePath = resolve(path);
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = await verifySignedDocument(signed, publicKeyPath);
  if (release.kind !== 'liatir.runtime-box.release') fail('Document is not a Runtime Box release.');
  // By convention the archive sits next to its release document under the shared stem.
  const archivePath = resolve(String(flags.get('archive') || join(dirname(releasePath), `${releaseStem(release)}.zip`)));
  if (!await fileExists(archivePath)) fail(`Archive not found: ${archivePath}`);
  if ((await stat(archivePath)).size !== release.archive.sizeBytes) fail('Archive size mismatch.');
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Archive SHA-256 mismatch.');
  if (release.installedSizeBytes !== undefined
    && (!Number.isSafeInteger(release.installedSizeBytes) || release.installedSizeBytes <= 0)) {
    fail('Invalid installed size.');
  }
  const entries = run('unzip', ['-Z1', archivePath], { capture: true }).split('\n').filter(Boolean);
  for (const entry of entries) safeRelativePath(entry.replace(/\/$/, ''));
  if (!entries.includes('box.json')) fail('Archive is missing box.json.');
  // Read box.json straight out of the zip (`unzip -p`) — no extraction needed for this check.
  const box = JSON.parse(run('unzip', ['-p', archivePath, 'box.json'], { capture: true }));
  for (const field of ['boxId', 'modelId', 'runtimeId', 'version', 'pythonEntryPoint']) {
    if (box[field] !== release[field]) fail(`box.json mismatch: ${field}`);
  }
  if (!entries.includes(release.pythonEntryPoint)) fail(`Archive is missing ${release.pythonEntryPoint}.`);
  if (flags.get('self-test')) {
    const extracted = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-verify-'));
    try {
      run('unzip', ['-q', archivePath, '-d', extracted]);
      if (release.installedSizeBytes !== undefined
        && await payloadSize(extracted) !== release.installedSizeBytes) {
        fail('Extracted payload size does not match the signed release.');
      }
      const python = join(extracted, safeRelativePath(release.pythonEntryPoint));
      run(python, ['-c', `import ${release.selfTest.pythonImports.join(', ')}`], { cwd: extracted });
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }
  console.log(`Verified ${release.boxId} ${release.version} (${targetId(release.target)})`);
}

function contentType(path) {
  if (extname(path) === '.json') return 'application/json; charset=utf-8';
  if (extname(path) === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

/**
 * `serve` — a local stand-in for the production registry.
 *
 * Exposes the same routes the Cloudflare Worker does, backed by the files `build` produced. This
 * is what lets a full install be exercised end to end without publishing anything; the app's
 * debug builds accept loopback HTTP precisely so this can be pointed at.
 */
async function serve(flags) {
  const port = Number(flags.get('port') || 8790);
  // Loopback by default: this serves unpublished, dev-signed artefacts and has no auth.
  const host = String(flags.get('host') || '127.0.0.1');
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);
      let localPath;
      const channelMatch = url.pathname.match(/^\/v1\/channels\/([^/]+)\/([^/]+)\/([^/]+)$/);
      if (channelMatch) {
        const [, channel, boxId, target] = channelMatch;
        localPath = join(DIST_ROOT, `${safeRelativePath(boxId)}-${safeRelativePath(channel)}-${safeRelativePath(target)}.channel.json`);
      } else if (url.pathname.startsWith('/objects/')) {
        localPath = join(DIST_ROOT, 'objects', safeRelativePath(url.pathname.slice('/objects/'.length)));
      } else {
        response.writeHead(url.pathname === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(url.pathname === '/health' ? { ok: true } : { error: 'not_found' }));
        return;
      }
      // Containment check: even after safeRelativePath, confirm the resolved file really lies
      // inside the dist root before reading it. A miss is reported as 404, not as an error, so
      // the server does not disclose what exists outside the served tree.
      const resolvedPath = resolve(localPath);
      if (!resolvedPath.startsWith(`${DIST_ROOT}${sep}`) || !await fileExists(resolvedPath)) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      const info = await stat(resolvedPath);
      response.writeHead(200, {
        'Content-Type': contentType(resolvedPath),
        'Content-Length': info.size,
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': '*',
      });
      createReadStream(resolvedPath).pipe(response);
    } catch (error) {
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
    }
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolveReady);
  });
  console.log(`Runtime Box registry listening on http://${host}:${port}`);
}

/**
 * `publish` — uploads the immutable objects (archive + release document) to R2.
 *
 * Publishing does *not* make a box live; `promote` does. This only puts the content-addressed
 * objects in place, which is why they can be cached forever: their key is their hash, so the
 * bytes behind a URL can never change.
 *
 * Both guards here exist because publishing is effectively irreversible: an archive whose hash
 * no longer matches its signed manifest would be permanently unusable, and a box built from a
 * dirty tree cannot be reproduced from the revision it claims.
 */
async function publish(releaseDocumentPath, flags) {
  const bucket = String(flags.get('bucket') || '');
  if (!bucket) fail('publish requires --bucket <r2-bucket>.');
  const releasePath = resolve(releaseDocumentPath);
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const release = await verifySignedDocument(signed, publicKeyPath);
  if (release.provenance?.sourceTreeDirty && !flags.get('allow-dirty')) {
    fail('Refusing to publish a Runtime Box built from a dirty source tree.');
  }
  const archivePath = resolve(String(flags.get('archive') || join(dirname(releasePath), `${releaseStem(release)}.zip`)));
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Refusing to publish an archive with the wrong SHA-256.');
  const objectPrefix = normalizeObjectPrefix(flags.get('prefix'));
  const releasePrefix = releaseObjectPrefix(release);
  const archiveKey = prefixedObjectKey(objectPrefix, `${releasePrefix}/${release.archive.sha256}.zip`);
  const releaseSha = await sha256File(releasePath);
  const releaseKey = prefixedObjectKey(objectPrefix, `${releasePrefix}/${releaseSha}.release.json`);
  const wrangler = join(ROOT, 'node_modules', '.bin', 'wrangler');
  // `immutable` with a one-year TTL is safe precisely because these keys are content hashes.
  run(wrangler, ['r2', 'object', 'put', `${bucket}/${archiveKey}`, '--remote', `--file=${archivePath}`, '--content-type=application/zip', '--cache-control=public, max-age=31536000, immutable']);
  run(wrangler, ['r2', 'object', 'put', `${bucket}/${releaseKey}`, '--remote', `--file=${releasePath}`, '--content-type=application/json', '--cache-control=public, max-age=31536000, immutable']);
  console.log(`Published r2://${bucket}/${archiveKey}`);
  console.log(`Published r2://${bucket}/${releaseKey}`);
}

/**
 * `publish-key` — replaces the Worker's trust root, i.e. the set of keys it accepts signatures from.
 *
 * The most dangerous command here: publishing the wrong key file can either lock out every future
 * release or, worse, make the registry trust a key it should not. Hence the mandatory `--confirm`,
 * and the `no-store` cache header so a trust change takes effect immediately rather than after a
 * cached copy expires.
 */
async function publishTrustedKey(flags) {
  const bucket = String(flags.get('bucket') || '');
  if (!bucket) fail('publish-key requires --bucket <r2-bucket>.');
  if (!flags.get('confirm')) fail('publish-key changes the Worker trust root; pass --confirm after reviewing the public key.');
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const keys = readTrustedKeyEntries(JSON.parse(await readFile(publicKeyPath, 'utf8')));
  const documentPath = join(DIST_ROOT, 'trusted-keys.json');
  await mkdir(DIST_ROOT, { recursive: true });
  // Only the public fields are copied out — never the PEM, and obviously never a private key.
  await writeFile(documentPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: keys.map((key) => ({
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKeyBase64: key.publicKeyBase64,
    })),
  }, null, 2)}\n`);
  const wrangler = join(ROOT, 'node_modules', '.bin', 'wrangler');
  const objectKey = prefixedObjectKey(flags.get('prefix'), 'control/trusted-keys.json');
  const locationArgs = flags.get('local')
    ? ['--local', '--config', join(ROOT, 'workers', 'runtime-box-registry', 'wrangler.jsonc')]
    : ['--remote'];
  run(wrangler, [
    'r2', 'object', 'put', `${bucket}/${objectKey}`,
    ...locationArgs,
    `--file=${documentPath}`, '--content-type=application/json', '--cache-control=no-store',
  ]);
  console.log(`Published trust root r2://${bucket}/${objectKey}`);
}

/**
 * `promote` — the moment a box actually goes live (or gets revoked).
 *
 * PUTs an already-signed channel or revocations document to the Worker's admin API. The routing
 * target is derived from the document's own payload, not from a flag, so a channel manifest
 * cannot be filed under the wrong box or target by a typo — and the Worker re-checks that
 * agreement anyway before storing it.
 *
 * The body is sent as the raw bytes read from disk rather than re-serialised, because re-encoding
 * could alter the JSON and break the signature it carries.
 */
async function promote(channelDocumentPath, flags) {
  const registry = String(flags.get('registry') || 'https://models.liatir.com').replace(/\/$/, '');
  const tokenFile = flags.get('token-file');
  // A file is offered as an alternative to the env var so the admin token need not sit in shell
  // history or in the process environment.
  const token = tokenFile
    ? (await readFile(resolve(String(tokenFile)), 'utf8')).trim()
    : process.env.LIATIR_RUNTIME_BOX_ADMIN_TOKEN;
  if (!token) fail('LIATIR_RUNTIME_BOX_ADMIN_TOKEN or --token-file is required for channel promotion.');
  const signedBody = await readFile(resolve(channelDocumentPath));
  const { payload } = decodeSignedDocument(JSON.parse(signedBody.toString('utf8')));
  // `fail` throws, so the final branch never yields a value — it rejects anything that is neither
  // a channel nor a revocations manifest.
  const endpoint = payload.kind === 'liatir.runtime-box.channel'
    ? `/v1/admin/channels/${payload.channel}/${payload.boxId}/${targetId(payload.target)}`
    : payload.kind === 'liatir.runtime-box.revocations'
      ? '/v1/admin/revocations'
      : fail('Promotion document is not a channel or revocations manifest.');
  const response = await fetch(`${registry}${endpoint}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: signedBody,
  });
  if (!response.ok) fail(`Channel promotion failed (${response.status}): ${await response.text()}`);
  console.log(payload.kind === 'liatir.runtime-box.channel'
    ? `Promoted ${payload.boxId} ${payload.channel} ${targetId(payload.target)}`
    : `Promoted ${payload.revocations.length} Runtime Box revocation(s)`);
}

/**
 * `revoke` — signs a document that withdraws a released box.
 *
 * This only *creates* the signed manifest; it takes effect once `promote` publishes it, after
 * which installs of that box and version are refused by the app.
 */
async function createRevocation(flags) {
  // `fail` throws, so these read as "required flag or abort".
  const boxId = String(flags.get('box') || fail('revoke requires --box <id>.'));
  const version = String(flags.get('version') || fail('revoke requires --version <version>.'));
  // Surfaced verbatim to users, so it should explain why the box was pulled.
  const reason = String(flags.get('reason') || fail('revoke requires --reason <text>.'));
  const manifest = {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.revocations',
    updatedAt: new Date().toISOString(),
    revocations: [{ boxId, version, reason, revokedAt: new Date().toISOString() }],
  };
  const signed = await signDocument(manifest, flags);
  await mkdir(DIST_ROOT, { recursive: true });
  const path = join(DIST_ROOT, 'runtime-box-revocations.json');
  await writeFile(path, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(`Signed revocations: ${relative(ROOT, path)}`);
}

function usage() {
  console.log(`Usage: npm run runtime-box -- <command> [options]

Commands:
  keygen                         Create a local Ed25519 signing key
  lock <recipe>                  Regenerate the platform dependency lock
  build <recipe>                 Build, self-test, archive, and sign a box
  verify <release.json>          Verify signature, archive hash, and layout
  serve [--port 8790]            Serve local channel documents and artifacts
  publish <release.json>         Upload immutable release objects to R2
  publish-key --bucket <name>    Publish the Worker public-key trust root
  promote <channel.json>         Promote a signed channel through the Worker
  revoke --box --version         Create a signed revocation document

Production signing:
  Pass --signer <private-cloud-run-url> to build or revoke. The CLI obtains a
  short-lived Google identity token and verifies the returned signature locally.
`);
}

/** Command dispatch. Each command validates its own required arguments via `fail`. */
async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  if (command === 'keygen') return keygen(flags);
  if (command === 'lock') return lockRecipe(positional[0] || fail('lock requires a recipe name.'), flags);
  if (command === 'build') return buildRecipe(positional[0] || fail('build requires a recipe name.'), flags);
  if (command === 'verify') return verifyRelease(positional[0] || fail('verify requires a signed release document.'), flags);
  if (command === 'serve') return serve(flags);
  if (command === 'publish') return publish(positional[0] || fail('publish requires a signed release document.'), flags);
  if (command === 'publish-key') return publishTrustedKey(flags);
  if (command === 'promote') return promote(positional[0] || fail('promote requires a signed channel document.'), flags);
  if (command === 'revoke') return createRevocation(flags);
  fail(`Unknown command: ${command}`);
}

// Single failure path: every `fail()` anywhere above lands here as a one-line message and a
// non-zero exit code, so CI and shell callers can rely on the status.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`runtime-box: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export {
  createDeterministicZip,
  extractRecipeArchive,
  normalizeTree,
  payloadSize,
  safeRelativePath,
  sha256File,
  validateArchiveEntryNames,
  validateArchiveEntryTypes,
};
