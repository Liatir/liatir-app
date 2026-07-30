#!/usr/bin/env node

/**
 * Temporary Liatir-owned Runtime Box implementation.
 *
 * During Scrollcase adoption this module owns only the legacy uv builder and Liatir distribution
 * commands. The stable CLI routes pixi lock/build and all verification through published
 * Scrollcase. P5.5 removes the remaining generic builder code after the uv recipes migrate.
 *
 * Two properties drive most of the design:
 *
 * 1. **Reproducibility.** The archive is content-addressed by its SHA-256, and that hash is what
 *    the app enforces at install time. So the archive must be byte-identical when rebuilt from
 *    the same inputs — no embedded timestamps, no filesystem ordering, no stray caches. Hence
 *    fixed mtimes, a sorted file list, a pinned streaming archive backend, and a hash-pinned lock.
 *
 * 2. **The private key is never required to be here.** Local Ed25519 keys exist for development,
 *    but a production build delegates signing to the Cloud Run signer service, which keeps the
 *    key in KMS. Either way, this CLI verifies the signature it gets back before trusting it.
 */

import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  copyFile,
  link,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import {
  decodeSignedDocument as decodeScrollcaseDocument,
  signDocument as signScrollcaseDocument,
  verifySignedDocument as verifyScrollcaseDocument,
} from 'scrollcase/sign';
import {
  createDeterministicZip,
  extractRecipeArchive as extractArchive,
  extractZipArchive,
  listZipEntries,
  readZipEntry,
} from './archive.mjs';
import {
  fileExists,
  normalizeTree,
  payloadSize,
  safeRelativePath,
  sha256File,
} from './filesystem.mjs';
import {
  createCondaDependencyLicenseAudit,
  createPythonDependencyLicenseAudit,
  validateCondaDependencyLicenseAudit,
  validatePythonDependencyLicenseAudit,
} from './licenses.mjs';
import {
  runtimeBoxBuilderVersionFields,
  runtimeBoxReleaseObjectPrefix,
  runtimeBoxReleaseStem,
} from './identity.mjs';
import { fail, run as runProcess, runResult as runProcessResult } from './process.mjs';
import { configureWorkspace, getWorkspace, workspaceOverridesFromFlags } from './workspace.mjs';
import {
  stageStandalonePython,
  syncLockedPythonDependencies,
  validateRelocatablePython,
} from './python.mjs';
import {
  findCondaPack,
  findPixi,
  installAndPackPixiEnvironment,
  runtimeBoxPixiLockArguments,
} from './pixi.mjs';
import {
  assertRuntimeBoxNativeHost,
  assertRuntimeBoxPythonEntryPoint,
  runtimeBoxLockArguments,
  runtimeBoxTorchBackendArguments,
  runtimeBoxTargetAdapter,
  runtimeBoxTargetId,
} from './targets.mjs';
import { liatirSignerCommand } from './signer-command.mjs';

/**
 * Workspace directories, read through getters so `main()` can configure them from flags before the
 * first path is used. `root` is the project root; `recipes` is checked in, and `build`, `dist` and
 * `keys` are generated and git-ignored. See `runtime-box/workspace.mjs` for the resolution rules.
 */
const paths = {
  get root() { return getWorkspace().root; },
  get recipes() { return getWorkspace().recipesDir; },
  get build() { return getWorkspace().buildDir; },
  get dist() { return getWorkspace().distDir; },
  /** Local dev signing keys — never used for production releases. */
  get keys() { return getWorkspace().keysDir; },
};
const defaultPrivateKeyPath = () => join(paths.keys, 'signing-private.pem');
const defaultPublicKeyPath = () => join(paths.keys, 'signing-public.json');
const DEFAULT_OBJECT_PREFIX = 'ai-runtime-boxes';
const MULTIPART_PART_BYTES = 64 * 1024 * 1024;
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

/** Writes an optional small machine-readable receipt without exposing credentials. */
async function writeReceipt(flags, value) {
  if (!flags.get('receipt')) return;
  const path = resolve(String(flags.get('receipt')));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Runs a subprocess and throws on any non-zero exit.
 *
 * The exit status is checked explicitly rather than inferred from output: a build step that
 * fails quietly must never be mistaken for one that succeeded. With `capture`, output is
 * returned; otherwise it is inherited so long steps (pip installs, downloads) stream live.
 */
function run(command, args, options = {}) {
  return runProcess(command, args, { ...options, cwd: options.cwd ?? paths.root });
}

/** Runs a subprocess while preserving the repository root as the CLI's default working tree. */
function runResult(command, args, options = {}) {
  return runProcessResult(command, args, { ...options, cwd: options.cwd ?? paths.root });
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex');
}

/** Resolves a recipe name to its directory, refusing anything that escapes the recipe root. */
function recipeDirectory(name) {
  const path = resolve(paths.recipes, name);
  if (path !== paths.recipes && !path.startsWith(`${paths.recipes}${sep}`)) fail(`Invalid recipe: ${name}`);
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
  // Reject target drift before downloads, archive creation, or any signing request.
  const adapter = runtimeBoxTargetAdapter(recipe.target);
  assertRuntimeBoxPythonEntryPoint(adapter, recipe.pythonEntryPoint);
  return { adapter, dir, recipe };
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

/** Accepts both trust-file shapes: a bundle of keys, or a single bare key. */
function readTrustedKeyEntries(value) {
  if (Array.isArray(value?.keys)) return value.keys;
  return [value];
}

/**
 * Uses Scrollcase's shared envelope and verification for both local and protected Liatir documents.
 */
async function signDocument(payload, flags) {
  const signerUrl = flags.get('signer') || process.env.LIATIR_RUNTIME_BOX_SIGNER_URL;
  return signScrollcaseDocument(payload, {
    signerCommand: signerUrl
      ? liatirSignerCommand({
          signerUrl: String(signerUrl),
          audience: String(flags.get('signer-audience')
            || process.env.LIATIR_RUNTIME_BOX_SIGNER_AUDIENCE
            || ''),
        })
      : null,
    privatePath: resolve(String(flags.get('private-key') || defaultPrivateKeyPath())),
    publicPath: resolve(String(flags.get('public-key') || defaultPublicKeyPath())),
  });
}

/** Shared envelope decoding; signature verification remains explicit at each trust boundary. */
function decodeSignedDocument(document) {
  return decodeScrollcaseDocument(document);
}

/** Shared signature verification against a bare key or rotation trust bundle. */
async function verifySignedDocument(document, publicKeyPath) {
  return verifyScrollcaseDocument(document, publicKeyPath);
}

/**
 * Locates `uv` and pins it to the exact version the recipe names.
 *
 * The version is an input to reproducibility, not a convenience check: a different resolver
 * version can pick different wheels and silently change the archive's hash.
 */
function findUv(flags, requiredVersion) {
  const candidate = String(flags.get('uv') || process.env.LIATIR_RUNTIME_BOX_UV || 'uv');
  const result = runResult(candidate, ['--version'], { capture: true });
  if (result.error || result.status !== 0) {
    fail(`uv ${requiredVersion} is required. Install it from https://docs.astral.sh/uv/ or pass --uv <path>.`);
  }
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
  const { adapter, dir, recipe } = await readRecipe(name);
  if (recipe.pixiVersion) {
    fail('Pixi recipes must be locked through the published Scrollcase CLI.');
  }
  const uv = findUv(flags, recipe.uvVersion);
  run(uv, runtimeBoxLockArguments(
    adapter,
    recipe,
    join(dir, recipe.requirementsInput),
    join(dir, recipe.requirementsLock),
  ), { env: { UV_NO_CONFIG: '1' } });
  console.log(`Updated ${relative(paths.root, join(dir, recipe.requirementsLock))}`);
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
  // Large assets (e.g. the 205 MB scGPT checkpoint) come from hosts like Google Drive that
  // occasionally drop a connection mid-stream — undici surfaces that as `Error: terminated`. Retry
  // with backoff, resuming from the partial via Range so a reset near the end is not paid in full.
  const maxAttempts = 5;
  for (let attempt = 1; ; attempt += 1) {
    const resumeAt = await fileExists(partPath) ? (await stat(partPath)).size : 0;
    try {
      const response = await fetch(asset.url, {
        headers: resumeAt > 0 ? { Range: `bytes=${resumeAt}-` } : undefined,
        redirect: 'follow',
      });
      if (!response.ok) fail(`Asset download failed (${response.status}): ${asset.url}`);
      // Only append when the server actually honoured the range (206). A server that ignores Range
      // replies 200 with the whole body, which must overwrite rather than be appended to a partial.
      const append = resumeAt > 0 && response.status === 206;
      await pipeline(response.body, createWriteStream(partPath, { flags: append ? 'a' : 'w' }));
      break;
    } catch (error) {
      // `fail` (asset URL / status) is a hard error, not a transient network drop — do not retry it.
      const message = error instanceof Error ? error.message : String(error);
      if (message.startsWith('Asset download failed') || attempt >= maxAttempts) throw error;
      console.error(`runtime-box: asset ${asset.relativePath} download attempt ${attempt} failed (${message}); retrying.`);
      await new Promise((wait) => setTimeout(wait, 2000 * attempt));
    }
  }
  const downloaded = await stat(partPath);
  if (downloaded.size !== asset.sizeBytes) fail(`Asset size mismatch for ${asset.relativePath}.`);
  if (await sha256File(partPath) !== asset.sha256) fail(`Asset SHA-256 mismatch for ${asset.relativePath}.`);
  await rename(partPath, destination);
}

/** Copy a checked-in legal or runtime file into the payload after verifying its recipe hash. */
async function copyVerifiedLocalFile(file, payloadDir) {
  const source = join(paths.root, safeRelativePath(file.sourcePath));
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
 * Unpacks a downloaded asset archive into the payload tree.
 *
 * Entries are listed and validated *before* extraction (archive-slip defence), then unpacked into a
 * temp dir and copied to their destination. `stripComponents` drops the redundant top-level
 * wrapper directory that many published archives carry; it insists on finding exactly one
 * directory to strip, so a surprising layout fails loudly instead of producing a wrong tree.
 */
async function extractRecipeArchive(payloadDir, archive) {
  const archivePath = join(payloadDir, safeRelativePath(archive.relativePath));
  const destination = join(payloadDir, safeRelativePath(archive.destination));
  await extractArchive(
    archivePath,
    archive.format,
    destination,
    Number(archive.stripComponents ?? 0),
  );
  // The compressed original is dead weight inside the payload once unpacked.
  if (archive.removeAfterExtract !== false) await rm(archivePath, { force: true });
}

/**
 * Build timestamp taken from the HEAD commit rather than the clock, so rebuilding the same commit
 * produces the same provenance. Falls back to the epoch outside a git checkout — deliberately a
 * constant, since a wall-clock fallback would reintroduce the nondeterminism this avoids.
 */
async function gitBuildTime() {
  const result = runResult('git', ['show', '-s', '--format=%cI', 'HEAD'], { capture: true });
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
  const { adapter, dir, recipe } = await readRecipe(name);
  if (recipe.pixiVersion) {
    fail('Pixi recipes must be built through the published Scrollcase CLI.');
  }
  // Wheels, native libraries, and Python are proven on the exact OS/architecture they will ship.
  assertRuntimeBoxNativeHost(adapter);
  // A recipe is on the pixi substrate once it declares a pixiVersion (it then carries pixi.toml +
  // pixi.lock); otherwise it still builds through the uv + standalone-Python path. The two coexist
  // during the migration, so tool discovery branches before anything is installed.
  const pixiRecipe = Boolean(recipe.pixiVersion);
  const pixi = pixiRecipe ? findPixi(flags, recipe.pixiVersion) : null;
  const condaPack = pixiRecipe ? findCondaPack(flags) : null;
  const uv = pixiRecipe ? null : findUv(flags, recipe.uvVersion);
  const lockPath = join(dir, pixiRecipe ? 'pixi.lock' : recipe.requirementsLock);
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
  const buildDir = join(paths.build, recipe.recipeId);
  const payloadDir = join(buildDir, 'payload');
  const stem = runtimeBoxReleaseStem(recipe);
  const archivePath = join(paths.dist, `${stem}.zip`);
  const objectPrefix = runtimeBoxReleaseObjectPrefix(recipe);
  const objectDir = join(paths.dist, 'objects', objectPrefix);
  // Always start from an empty tree: leftovers from a previous build would end up in the archive.
  await rm(buildDir, { recursive: true, force: true });
  // Rebuilding the same release must not keep its previous multi-gigabyte local staging objects.
  await rm(archivePath, { force: true });
  await rm(objectDir, { recursive: true, force: true });
  await mkdir(payloadDir, { recursive: true });

  let interpreter;
  // Only the uv path can name a site-packages dir for the .dist-info license audit; the conda
  // audit reads package metadata differently and lands in a later migration increment.
  let sitePackagesPath = null;
  if (pixiRecipe) {
    // pixi install from the locked pixi.lock, conda-pack, extract to venv/, run the embedded
    // conda-unpack against the final prefix, then dereference symlinks so the payload is link-free.
    // No activation env is required (Phase 0 spike, macOS + Windows).
    ({ interpreter } = await installAndPackPixiEnvironment({
      pixi,
      condaPack,
      manifestPath: join(dir, 'pixi.toml'),
      lockPath,
      buildDir,
      payloadDir,
      adapter,
      run,
    }));
  } else {
    const standalonePython = await stageStandalonePython({
      adapter,
      payloadDir,
      pythonVersion: recipe.pythonVersion,
      run,
      uv,
    });
    // Installs *into the copied interpreter* (hence --python pointing inside the payload).
    // --require-hashes enforces the digests in the lock, so a tampered or swapped wheel fails the
    // build; --strict catches an inconsistent resulting environment.
    await syncLockedPythonDependencies({
      adapter,
      ...standalonePython,
      extraArgs: runtimeBoxTorchBackendArguments(recipe),
      lockPath,
      run,
      uv,
    });
    await validateRelocatablePython({
      adapter,
      ...standalonePython,
      payloadDir,
      run,
    });
    interpreter = standalonePython.interpreter;
    sitePackagesPath = run(standalonePython.interpreter, [
      '-c', "import sysconfig; print(sysconfig.get_paths()['purelib'])",
    ], { capture: true });
  }

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
  // The .dist-info license audit is uv-only; a pixi/conda box audits conda metadata instead, which
  // arrives in a later migration increment. Gate on sitePackagesPath so the pixi path skips it.
  if (recipe.dependencyLicenseAudit && sitePackagesPath) {
    const actualAudit = createPythonDependencyLicenseAudit({
      lockBytes: await readFile(lockPath),
      sitePackagesPath,
      targetId: runtimeBoxTargetId(recipe.target),
      torchBackend: recipe.torchBackend ?? null,
    });
    const reviewedAuditPath = resolve(paths.root, safeRelativePath(recipe.dependencyLicenseAudit));
    const reviewedAudit = JSON.parse(await readFile(reviewedAuditPath, 'utf8'));
    validatePythonDependencyLicenseAudit(reviewedAudit, actualAudit);
    const auditPath = join(payloadDir, 'THIRD_PARTY_NOTICES', 'python-distributions.json');
    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(auditPath, `${JSON.stringify(actualAudit, null, 2)}\n`);
  }
  // The pixi/conda license audit is derived from the committed pixi.lock (which carries the SPDX
  // license of every package); `pixi install --frozen` guarantees the installed set equals it.
  if (pixiRecipe && recipe.condaDependencyLicenseAudit) {
    const actualAudit = createCondaDependencyLicenseAudit({
      lockBytes: await readFile(lockPath),
      targetId: runtimeBoxTargetId(recipe.target),
    });
    const reviewedAuditPath = resolve(paths.root, safeRelativePath(recipe.condaDependencyLicenseAudit));
    const reviewedAudit = JSON.parse(await readFile(reviewedAuditPath, 'utf8'));
    validateCondaDependencyLicenseAudit(reviewedAudit, actualAudit);
    const auditPath = join(payloadDir, 'THIRD_PARTY_NOTICES', 'conda-distributions.json');
    await mkdir(dirname(auditPath), { recursive: true });
    await writeFile(auditPath, `${JSON.stringify(actualAudit, null, 2)}\n`);
  }
  // Guards against over-pruning: the files the box needs at runtime must still be there.
  for (const requiredFile of recipe.selfTest.files) {
    if (!await fileExists(join(payloadDir, safeRelativePath(requiredFile)))) fail(`Missing self-test file: ${requiredFile}`);
  }
  // Run with the payload's *own* interpreter: this is the same check the app repeats after
  // installing, so a box that would fail on the user's machine fails here first.
  const selfTestCode = recipe.selfTest.pythonCode
    ? `${adapter.selfTestPython}\nimport ${recipe.selfTest.imports.join(', ')}\n${recipe.selfTest.pythonCode}`
    : `${adapter.selfTestPython}\nimport ${recipe.selfTest.imports.join(', ')}`;
  run(interpreter, ['-c', selfTestCode], {
    cwd: payloadDir,
    env: adapter.validationEnvironments[recipe.target.accelerator],
  });

  // Everything needed to answer "where did this box come from and could I rebuild it?".
  // Signed together with the release and stored inside the installed box.
  const provenance = {
    recipeId: recipe.recipeId,
    recipeVersion: recipe.recipeVersion,
    builderRevision: gitState.revision,
    sourceTreeDirty: gitState.dirty,
    sourceRevision: recipe.sourceRevision,
    pythonVersion: recipe.pythonVersion,
    // Records the builder that produced the box: pixiVersion for the conda substrate, uvVersion for
    // the legacy standalone-Python path.
    ...runtimeBoxBuilderVersionFields(recipe),
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
  await mkdir(paths.dist, { recursive: true });
  await createDeterministicZip(payloadDir, archivePath, adapter);

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
  const releasePath = join(paths.dist, `${stem}.release.json`);
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
  const channelPath = join(paths.dist, `${recipe.boxId}-${channel.channel}-${runtimeBoxTargetId(recipe.target)}.channel.json`);
  await writeFile(channelPath, `${JSON.stringify(signedChannel, null, 2)}\n`);
  // A staging tree laid out exactly as the bucket, so `publish` (and the local `serve` registry)
  // upload/serve files under the same keys the manifests already point to.
  await mkdir(objectDir, { recursive: true });
  await linkOrCopyFile(archivePath, join(objectDir, `${archiveSha}.zip`));
  await copyFile(releasePath, join(objectDir, `${releaseDocumentSha}.release.json`));
  console.log(`Built archive: ${relative(paths.root, archivePath)}`);
  console.log(`Signed release: ${relative(paths.root, releasePath)}`);
  console.log(`Signed channel: ${relative(paths.root, channelPath)}`);
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
  const publicKeyPath = resolve(String(flags.get('public-key') || defaultPublicKeyPath()));
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = await verifySignedDocument(signed, publicKeyPath);
  if (release.kind !== 'liatir.runtime-box.release') fail('Document is not a Runtime Box release.');
  const adapter = runtimeBoxTargetAdapter(release.target);
  assertRuntimeBoxPythonEntryPoint(adapter, release.pythonEntryPoint);
  // By convention the archive sits next to its release document under the shared stem.
  const archivePath = resolve(String(flags.get('archive')
    || join(dirname(releasePath), `${release.archive.sha256}.zip`)));
  if (!await fileExists(archivePath)) fail(`Archive not found: ${archivePath}`);
  if ((await stat(archivePath)).size !== release.archive.sizeBytes) fail('Archive size mismatch.');
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Archive SHA-256 mismatch.');
  if (release.installedSizeBytes !== undefined
    && (!Number.isSafeInteger(release.installedSizeBytes) || release.installedSizeBytes <= 0)) {
    fail('Invalid installed size.');
  }
  const entries = await listZipEntries(archivePath);
  const files = new Set(entries.filter((entry) => entry.kind === 'file').map((entry) => entry.path));
  if (!files.has('box.json')) fail('Archive is missing box.json.');
  const box = JSON.parse(await readZipEntry(archivePath, 'box.json'));
  for (const field of ['boxId', 'modelId', 'runtimeId', 'version', 'pythonEntryPoint']) {
    if (box[field] !== release[field]) fail(`box.json mismatch: ${field}`);
  }
  if (!files.has(release.pythonEntryPoint)) fail(`Archive is missing ${release.pythonEntryPoint}.`);
  if (flags.get('self-test')) {
    assertRuntimeBoxNativeHost(adapter);
    const extracted = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-verify-'));
    try {
      await extractZipArchive(archivePath, extracted);
      if (release.installedSizeBytes !== undefined
        && await payloadSize(extracted) !== release.installedSizeBytes) {
        fail('Extracted payload size does not match the signed release.');
      }
      const python = join(extracted, safeRelativePath(release.pythonEntryPoint));
      run(python, ['-c', `${adapter.selfTestPython}\nimport ${release.selfTest.pythonImports.join(', ')}`], {
        cwd: extracted,
        env: adapter.validationEnvironments[release.target.accelerator],
      });
    } finally {
      await rm(extracted, { recursive: true, force: true });
    }
  }
  await writeReceipt(flags, {
    schemaVersion: 1,
    status: 'passed',
    localSignatureVerified: true,
    signingKeyIds: signed.signatures.map((signature) => signature.keyId),
    releasePayloadSha256: signed.payloadSha256,
    archiveSha256: release.archive.sha256,
    archiveSizeBytes: release.archive.sizeBytes,
    selfTest: flags.get('self-test') ? 'passed' : 'not-requested',
  });
  console.log(`Verified ${release.boxId} ${release.version} (${runtimeBoxTargetId(release.target)})`);
}

function contentType(path) {
  if (extname(path) === '.json') return 'application/json; charset=utf-8';
  if (extname(path) === '.zip') return 'application/zip';
  return 'application/octet-stream';
}

/** Splits a large archive into the contiguous, bounded parts accepted by R2 multipart upload. */
function multipartPartRanges(sizeBytes, partSizeBytes = MULTIPART_PART_BYTES) {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) fail('Invalid multipart archive size.');
  if (!Number.isSafeInteger(partSizeBytes) || partSizeBytes < 5 * 1024 * 1024) {
    fail('Invalid multipart part size.');
  }
  const partCount = Math.ceil(sizeBytes / partSizeBytes);
  if (partCount > 10_000) fail('Multipart archive requires more than 10,000 parts.');
  return Array.from({ length: partCount }, (_, index) => {
    const start = index * partSizeBytes;
    const end = Math.min(sizeBytes, start + partSizeBytes) - 1;
    return { partNumber: index + 1, start, end, sizeBytes: end - start + 1 };
  });
}

/** Reads the registry secret without placing it in shell history or command output. */
async function registryAdminToken(flags) {
  const tokenFile = flags.get('token-file');
  const token = tokenFile
    ? (await readFile(resolve(String(tokenFile)), 'utf8')).trim()
    : process.env.LIATIR_RUNTIME_BOX_ADMIN_TOKEN;
  if (!token) fail('LIATIR_RUNTIME_BOX_ADMIN_TOKEN or --token-file is required.');
  return token;
}

/** Sends one authenticated registry request and returns its JSON response. */
async function registryAdminRequest(url, token, options) {
  const headers = new Headers(options.headers);
  headers.set('authorization', `Bearer ${token}`);
  const response = await fetch(url, { ...options, headers });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { error: text || 'invalid_registry_response' };
  }
  if (!response.ok) fail(`Registry request failed (${response.status}): ${JSON.stringify(body)}`);
  return body;
}

/** Streams and hashes the public object, proving the bytes R2 serves match the signed manifest. */
async function verifyRemoteObject(url, expectedSizeBytes, expectedSha256) {
  const verificationUrl = new URL(url);
  verificationUrl.searchParams.set('liatir-verify', expectedSha256);
  const response = await fetch(verificationUrl, {
    headers: { 'accept-encoding': 'identity', 'cache-control': 'no-cache' },
  });
  if (!response.ok || !response.body) fail(`Remote object verification failed (${response.status}): ${url}`);
  const declaredSizeHeader = response.headers.get('content-length');
  const declaredSize = declaredSizeHeader === null ? null : Number(declaredSizeHeader);
  if (!response.headers.has('content-encoding')
    && declaredSize !== null
    && Number.isSafeInteger(declaredSize)
    && declaredSize !== expectedSizeBytes) {
    fail(`Remote object Content-Length mismatch: ${url}`);
  }
  const hash = createHash('sha256');
  let received = 0;
  let nextProgress = 1024 * 1024 * 1024;
  for await (const chunk of response.body) {
    hash.update(chunk);
    received += chunk.byteLength;
    if (expectedSizeBytes > 1024 * 1024 * 1024 && received >= nextProgress) {
      console.log(`Verified ${Math.min(received, expectedSizeBytes)} / ${expectedSizeBytes} remote bytes`);
      nextProgress += 1024 * 1024 * 1024;
    }
  }
  if (received !== expectedSizeBytes) fail(`Remote object size mismatch: ${url}`);
  const actualSha256 = hash.digest('hex');
  if (actualSha256 !== expectedSha256) fail(`Remote object SHA-256 mismatch: ${url}`);
  console.log(`Verified remote SHA-256 ${expectedSha256}: ${url}`);
  return {
    url,
    httpStatus: response.status,
    sizeBytes: received,
    sha256: actualSha256,
  };
}

/** Returns whether the public immutable object already exists, rejecting ambiguous HTTP errors. */
async function remoteObjectExists(url) {
  const response = await fetch(url, { method: 'HEAD', headers: { 'cache-control': 'no-cache' } });
  if (response.status === 404) return false;
  if (!response.ok) fail(`Cannot inspect remote object (${response.status}): ${url}`);
  return true;
}

/** Uploads an archive through the authenticated Worker/R2 multipart path with bounded retries. */
async function uploadArchiveMultipart(archivePath, release, flags) {
  const registry = String(flags.get('registry') || 'https://models.liatir.com').replace(/\/$/, '');
  const token = await registryAdminToken(flags);
  const target = runtimeBoxTargetId(release.target);
  const identityPath = [release.boxId, release.version, target, release.archive.sha256]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  const baseUrl = `${registry}/v1/admin/uploads/${identityPath}`;
  const created = await registryAdminRequest(`${registry}/v1/admin/uploads`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      boxId: release.boxId,
      version: release.version,
      target,
      sha256: release.archive.sha256,
      sizeBytes: release.archive.sizeBytes,
    }),
  });
  if (typeof created.uploadId !== 'string' || !created.uploadId) fail('Registry did not return a multipart upload ID.');
  const uploadUrl = `${baseUrl}?uploadId=${encodeURIComponent(created.uploadId)}`;
  const ranges = multipartPartRanges(release.archive.sizeBytes);
  const completedParts = [];
  try {
    for (const range of ranges) {
      let completed;
      let lastError;
      for (let attempt = 1; attempt <= 3 && !completed; attempt += 1) {
        try {
          completed = await registryAdminRequest(
            `${baseUrl}/parts/${range.partNumber}?uploadId=${encodeURIComponent(created.uploadId)}`,
            token,
            {
              method: 'PUT',
              headers: {
                'content-type': 'application/octet-stream',
                'content-length': String(range.sizeBytes),
              },
              body: createReadStream(archivePath, { start: range.start, end: range.end }),
              duplex: 'half',
            },
          );
        } catch (error) {
          lastError = error;
          if (attempt < 3) await new Promise((resolveRetry) => setTimeout(resolveRetry, attempt * 1000));
        }
      }
      if (!completed) throw lastError;
      if (completed.partNumber !== range.partNumber || typeof completed.etag !== 'string') {
        fail(`Registry returned invalid metadata for multipart part ${range.partNumber}.`);
      }
      completedParts.push({ partNumber: completed.partNumber, etag: completed.etag });
      if (range.partNumber === 1 || range.partNumber % 10 === 0 || range.partNumber === ranges.length) {
        console.log(`Uploaded archive part ${range.partNumber} / ${ranges.length}`);
      }
    }
    const completed = await registryAdminRequest(`${baseUrl}/complete?uploadId=${encodeURIComponent(created.uploadId)}`, token, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parts: completedParts }),
    });
    if (completed.sizeBytes !== release.archive.sizeBytes) fail('Registry completed an archive with the wrong size.');
  } catch (error) {
    try {
      await registryAdminRequest(uploadUrl, token, { method: 'DELETE' });
    } catch {
      // The primary upload error is more useful; R2 also expires incomplete uploads automatically.
    }
    throw error;
  }
}

/** Publishes one small signed release document through the same least-privilege Registry token. */
async function uploadReleaseDocument(releasePath, release, releaseSha256, flags) {
  const registry = String(flags.get('registry') || 'https://models.liatir.com').replace(/\/$/, '');
  const token = await registryAdminToken(flags);
  const target = runtimeBoxTargetId(release.target);
  const identityPath = [release.boxId, release.version, target, releaseSha256]
    .map((segment) => encodeURIComponent(segment))
    .join('/');
  await registryAdminRequest(`${registry}/v1/admin/releases/${identityPath}`, token, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: await readFile(releasePath),
  });
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
        localPath = join(
          paths.dist,
          'channels',
          safeRelativePath(boxId),
          safeRelativePath(channel),
          `${safeRelativePath(target)}.json`,
        );
      } else if (url.pathname === '/v1/revocations') {
        localPath = join(paths.dist, 'runtime-box-revocations.json');
      } else if (url.pathname.startsWith('/objects/')) {
        localPath = join(paths.dist, safeRelativePath(url.pathname.slice('/objects/'.length)));
      } else {
        response.writeHead(url.pathname === '/health' ? 200 : 404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(url.pathname === '/health' ? { ok: true } : { error: 'not_found' }));
        return;
      }
      // Containment check: even after safeRelativePath, confirm the resolved file really lies
      // inside the dist root before reading it. A miss is reported as 404, not as an error, so
      // the server does not disclose what exists outside the served tree.
      const resolvedPath = resolve(localPath);
      if (!resolvedPath.startsWith(`${paths.dist}${sep}`) || !await fileExists(resolvedPath)) {
        response.writeHead(404, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'not_found' }));
        return;
      }
      if (resolvedPath.endsWith('.json')) {
        const document = JSON.parse(await readFile(resolvedPath, 'utf8'));
        const { payload } = decodeSignedDocument(document);
        if (document.schemaVersion !== 2 || payload.schemaVersion !== 2) {
          response.writeHead(409, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify({ error: 'unsupported_runtime_box_format' }));
          return;
        }
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
 * Archives and signed release documents use the Registry Worker's authenticated surface, so CI
 * never receives a broad Cloudflare account token. Every archive is streamed back from the
 * public domain and hashed before its signed release document is uploaded.
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
  const publicKeyPath = resolve(String(flags.get('public-key') || defaultPublicKeyPath()));
  const release = await verifySignedDocument(signed, publicKeyPath);
  if (release.provenance?.sourceTreeDirty && !flags.get('allow-dirty')) {
    fail('Refusing to publish a Runtime Box built from a dirty source tree.');
  }
  const archivePath = resolve(String(flags.get('archive')
    || join(dirname(releasePath), `${runtimeBoxReleaseStem(release)}.zip`)));
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Refusing to publish an archive with the wrong SHA-256.');
  const objectPrefix = normalizeObjectPrefix(flags.get('prefix'));
  const releasePrefix = runtimeBoxReleaseObjectPrefix(release);
  const archiveKey = prefixedObjectKey(objectPrefix, `${releasePrefix}/${release.archive.sha256}.zip`);
  const releaseSha = await sha256File(releasePath);
  const releaseKey = prefixedObjectKey(objectPrefix, `${releasePrefix}/${releaseSha}.release.json`);
  const archiveExists = await remoteObjectExists(release.archive.url);
  if (!archiveExists) {
    await uploadArchiveMultipart(archivePath, release, flags);
  }
  // Do not publish the release document until the public archive is byte-for-byte correct.
  const archiveVerification = await verifyRemoteObject(
    release.archive.url,
    release.archive.sizeBytes,
    release.archive.sha256,
  );
  const releaseUrl = `${new URL(release.archive.url).origin}/${releaseKey}`;
  if (!await remoteObjectExists(releaseUrl)) {
    await uploadReleaseDocument(releasePath, release, releaseSha, flags);
  }
  const releaseVerification = await verifyRemoteObject(
    releaseUrl,
    (await stat(releasePath)).size,
    releaseSha,
  );
  await writeReceipt(flags, {
    schemaVersion: 1,
    status: 'passed',
    bucket,
    prefix: objectPrefix,
    archive: archiveVerification,
    release: releaseVerification,
  });
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
  const publicKeyPath = resolve(String(flags.get('public-key') || defaultPublicKeyPath()));
  const keys = readTrustedKeyEntries(JSON.parse(await readFile(publicKeyPath, 'utf8')));
  const documentPath = join(paths.dist, 'trusted-keys.json');
  await mkdir(paths.dist, { recursive: true });
  // Only the public fields are copied out — never the PEM, and obviously never a private key.
  await writeFile(documentPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: keys.map((key) => ({
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKeyBase64: key.publicKeyBase64,
    })),
  }, null, 2)}\n`);
  const wrangler = join(paths.root, 'node_modules', '.bin', 'wrangler');
  const objectKey = prefixedObjectKey(flags.get('prefix'), 'control/trusted-keys.json');
  const locationArgs = flags.get('local')
    ? ['--local', '--config', join(paths.root, 'workers', 'runtime-box-registry', 'wrangler.jsonc')]
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
  const token = await registryAdminToken(flags);
  const signedBody = await readFile(resolve(channelDocumentPath));
  const { payload } = decodeSignedDocument(JSON.parse(signedBody.toString('utf8')));
  // `fail` throws, so the final branch never yields a value — it rejects anything that is neither
  // a channel nor a revocations manifest.
  const endpoint = payload.kind === 'liatir.runtime-box.channel'
    ? `/v1/admin/channels/${payload.channel}/${payload.boxId}/${runtimeBoxTargetId(payload.target)}`
    : payload.kind === 'liatir.runtime-box.revocations'
      ? '/v1/admin/revocations'
      : fail('Promotion document is not a channel or revocations manifest.');
  const response = await fetch(`${registry}${endpoint}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: signedBody,
  });
  const responseText = await response.text();
  if (!response.ok) fail(`Channel promotion failed (${response.status}): ${responseText}`);
  let responseBody = {};
  try {
    responseBody = responseText ? JSON.parse(responseText) : {};
  } catch {
    responseBody = { message: responseText };
  }
  await writeReceipt(flags, {
    schemaVersion: 1,
    status: 'passed',
    httpStatus: response.status,
    response: responseBody,
    channelUrl: payload.kind === 'liatir.runtime-box.channel'
      ? `${registry}/v1/channels/${payload.channel}/${payload.boxId}/${runtimeBoxTargetId(payload.target)}`
      : `${registry}/v1/revocations`,
  });
  console.log(payload.kind === 'liatir.runtime-box.channel'
    ? `Promoted ${payload.boxId} ${payload.channel} ${runtimeBoxTargetId(payload.target)}`
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
    schemaVersion: 2,
    kind: 'liatir.runtime-box.revocations',
    updatedAt: new Date().toISOString(),
    revocations: [{ boxId, version, reason, revokedAt: new Date().toISOString() }],
  };
  const signed = await signDocument(manifest, flags);
  await mkdir(paths.dist, { recursive: true });
  const path = join(paths.dist, 'runtime-box-revocations.json');
  await writeFile(path, `${JSON.stringify(signed, null, 2)}\n`);
  console.log(`Signed revocations: ${relative(paths.root, path)}`);
}

function usage() {
  console.log(`Internal compatibility module. Use: npm run runtime-box -- <command> [options]

Commands:
  lock <uv-recipe>               Regenerate a legacy uv dependency lock
  build <uv-recipe>              Build a legacy uv Runtime Box
  serve [--port 8790]            Serve local channel documents and artifacts
  publish <release.json>         Upload immutable release objects to R2
  publish-key --bucket <name>    Publish the Worker public-key trust root
  promote <channel.json>         Promote a signed channel through the Worker
  revoke --box --version         Create a signed revocation document

Workspace:
  Paths come from scrollcase.config.json at the project root (discovered by
  walking up from the working directory) and can be overridden per invocation:
  --config <file>                Use this workspace config explicitly
  --project-root <dir>           Treat this directory as the project root
  --recipes-dir <dir>            Where recipes live (default runtime-boxes/recipes)
  --build-dir <dir>              Payload scratch space (default .runtime-box-build)
  --out-dir <dir>                Built artefacts (default .runtime-box-dist)
  --keys-dir <dir>               Local dev signing keys (default .runtime-box-local)

Production signing:
  Pass --signer <private-cloud-run-url> to build or revoke. The CLI obtains a
  short-lived Google identity token and verifies the returned signature locally.
`);
}

/** Temporary uv builder plus Liatir-owned distribution command dispatch. */
export async function runLegacyRuntimeBoxCommand(command, rest) {
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  // Resolve the workspace before any command touches a path, so flags win over the project config.
  configureWorkspace({ overrides: workspaceOverridesFromFlags(flags) });
  if (command === 'lock') return lockRecipe(positional[0] || fail('lock requires a recipe name.'), flags);
  if (command === 'build') return buildRecipe(positional[0] || fail('build requires a recipe name.'), flags);
  if (command === 'serve') return serve(flags);
  if (command === 'publish') return publish(positional[0] || fail('publish requires a signed release document.'), flags);
  if (command === 'publish-key') return publishTrustedKey(flags);
  if (command === 'promote') return promote(positional[0] || fail('promote requires a signed channel document.'), flags);
  if (command === 'revoke') return createRevocation(flags);
  fail(`Unknown command: ${command}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  await runLegacyRuntimeBoxCommand(command, rest);
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
  downloadVerified,
  extractRecipeArchive,
  multipartPartRanges,
  normalizeTree,
  payloadSize,
  safeRelativePath,
  sha256File,
};
