#!/usr/bin/env node

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

const ROOT = resolve(import.meta.dirname, '..');
const RECIPE_ROOT = join(ROOT, 'runtime-boxes', 'recipes');
const LOCAL_ROOT = join(ROOT, '.runtime-box-local');
const BUILD_ROOT = join(ROOT, '.runtime-box-build');
const DIST_ROOT = join(ROOT, '.runtime-box-dist');
const DEFAULT_PRIVATE_KEY = join(LOCAL_ROOT, 'signing-private.pem');
const DEFAULT_PUBLIC_KEY = join(LOCAL_ROOT, 'signing-public.json');
const DEFAULT_OBJECT_PREFIX = 'ai-runtime-boxes';
const FIXED_ARCHIVE_TIME = new Date('2000-01-01T00:00:00.000Z');

function fail(message) {
  throw new Error(message);
}

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

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 64 * 1024 * 1024,
    stdio: options.capture ? 'pipe' : ['pipe', 'inherit', 'inherit'],
  });
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

function safeRelativePath(value) {
  const normalized = value.replaceAll('\\', '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) fail(`Unsafe relative path: ${value}`);
  if (normalized.split('/').some((part) => part === '..' || part === '')) fail(`Unsafe relative path: ${value}`);
  return normalized;
}

function recipeDirectory(name) {
  const path = resolve(RECIPE_ROOT, name);
  if (path !== RECIPE_ROOT && !path.startsWith(`${RECIPE_ROOT}${sep}`)) fail(`Invalid recipe: ${name}`);
  return path;
}

async function readRecipe(name) {
  const dir = recipeDirectory(name);
  const recipe = JSON.parse(await readFile(join(dir, 'recipe.json'), 'utf8'));
  if (recipe.schemaVersion !== 1 || recipe.recipeId !== name) fail(`Invalid recipe contract: ${name}`);
  if (recipe.target.platform !== 'macos' || recipe.target.arch !== 'aarch64') {
    fail('The foundation builder currently supports macOS arm64 recipes only.');
  }
  return { dir, recipe };
}

function targetId(target) {
  const cuda = target.cudaVersion ? `-cuda${target.cudaVersion}` : '';
  return `${target.platform}-${target.arch}-${target.accelerator}${cuda}`;
}

function releaseStem(release) {
  return `${release.boxId}-${release.version}-${targetId(release.target)}`;
}

function releaseObjectPrefix(release) {
  return `boxes/${release.boxId}/${release.version}/${targetId(release.target)}`;
}

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
  const rawPublicKey = publicDer.subarray(publicDer.length - 32);
  const keyId = String(flags.get('key-id') || `liatir-runtime-box-${sha256Buffer(rawPublicKey).slice(0, 16)}`);
  await mkdir(dirname(privatePath), { recursive: true });
  await mkdir(dirname(publicPath), { recursive: true });
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

async function signDocument(payload, flags) {
  const { privateKey, metadata } = await readSigningKey(flags);
  const payloadBytes = Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, 'utf8');
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

function decodeSignedDocument(document) {
  if (document?.schemaVersion !== 1 || document?.payloadEncoding !== 'base64-json-utf8') fail('Unsupported signed Runtime Box document.');
  const bytes = Buffer.from(document.payloadBase64, 'base64');
  if (sha256Buffer(bytes) !== document.payloadSha256) fail('Signed payload SHA-256 mismatch.');
  return { bytes, payload: JSON.parse(bytes.toString('utf8')) };
}

async function verifySignedDocument(document, publicKeyPath) {
  const metadata = JSON.parse(await readFile(publicKeyPath, 'utf8'));
  const { bytes, payload } = decodeSignedDocument(document);
  const matching = document.signatures?.find((item) => item.keyId === metadata.keyId);
  if (!matching) fail(`No signature for trusted key ${metadata.keyId}.`);
  const valid = verify(null, bytes, createPublicKey(metadata.publicKeyPem), Buffer.from(matching.signatureBase64, 'base64'));
  if (!valid) fail('Runtime Box Ed25519 signature verification failed.');
  return payload;
}

function findUv(flags, requiredVersion) {
  const candidate = String(flags.get('uv') || process.env.LIATIR_RUNTIME_BOX_UV || 'uv');
  const result = spawnSync(candidate, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0) fail(`uv ${requiredVersion} is required. Install it from https://docs.astral.sh/uv/ or pass --uv <path>.`);
  const actual = result.stdout.trim().split(/\s+/)[1];
  if (actual !== requiredVersion) fail(`Recipe requires uv ${requiredVersion}, found ${actual}.`);
  return candidate;
}

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
  const append = resumeAt > 0 && response.status === 206;
  await pipeline(response.body, createWriteStream(partPath, { flags: append ? 'a' : 'w' }));
  const downloaded = await stat(partPath);
  if (downloaded.size !== asset.sizeBytes) fail(`Asset size mismatch for ${asset.relativePath}.`);
  if (await sha256File(partPath) !== asset.sha256) fail(`Asset SHA-256 mismatch for ${asset.relativePath}.`);
  await rename(partPath, destination);
}

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

async function normalizeTree(root) {
  for (const file of await collectFiles(root)) await utimes(join(root, file), FIXED_ARCHIVE_TIME, FIXED_ARCHIVE_TIME);
}

async function gitBuildTime() {
  const result = spawnSync('git', ['show', '-s', '--format=%cI', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return result.status === 0 ? result.stdout.trim() : new Date(0).toISOString();
}

function gitBuildState() {
  const revision = run('git', ['rev-parse', 'HEAD'], { capture: true });
  const status = run('git', ['status', '--porcelain', '--untracked-files=no'], { capture: true });
  return { revision, dirty: status.length > 0 };
}

async function buildRecipe(name, flags) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') fail('This foundation recipe must be built natively on macOS arm64.');
  const { dir, recipe } = await readRecipe(name);
  const uv = findUv(flags, recipe.uvVersion);
  const lockPath = join(dir, recipe.requirementsLock);
  if (!await fileExists(lockPath)) fail(`Missing dependency lock: ${lockPath}`);
  const lockSha = await sha256File(lockPath);
  const gitState = gitBuildState();
  if (gitState.dirty && !flags.get('allow-dirty')) {
    fail('Refusing to build a release from a dirty source tree. Commit first or pass --allow-dirty for local development.');
  }
  const buildDir = join(BUILD_ROOT, recipe.recipeId);
  const payloadDir = join(buildDir, 'payload');
  await rm(buildDir, { recursive: true, force: true });
  await mkdir(payloadDir, { recursive: true });

  const managedPython = run(uv, [
    'python', 'find', recipe.pythonVersion, '--python-preference', 'only-managed',
  ], { capture: true, env: { UV_NO_CONFIG: '1' } });
  const standaloneRoot = dirname(dirname(managedPython));
  await cp(standaloneRoot, join(payloadDir, 'venv'), {
    recursive: true,
    dereference: true,
    preserveTimestamps: false,
  });
  run(uv, [
    'pip', 'sync', lockPath, '--python', join(payloadDir, recipe.pythonEntryPoint),
    '--system', '--break-system-packages', '--require-hashes', '--strict', '--no-config',
  ]);

  for (const asset of recipe.assets) {
    console.log(`Downloading ${asset.relativePath}`);
    await downloadVerified(asset, join(payloadDir, safeRelativePath(asset.relativePath)));
  }
  for (const requiredFile of recipe.selfTest.files) {
    if (!await fileExists(join(payloadDir, safeRelativePath(requiredFile)))) fail(`Missing self-test file: ${requiredFile}`);
  }
  run(join(payloadDir, recipe.pythonEntryPoint), ['-c', `import ${recipe.selfTest.imports.join(', ')}`], { cwd: payloadDir });

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
  await writeFile(join(payloadDir, 'box.json'), `${JSON.stringify(boxMetadata, null, 2)}\n`);
  await normalizeTree(payloadDir);
  await mkdir(DIST_ROOT, { recursive: true });
  const stem = releaseStem(recipe);
  const archivePath = join(DIST_ROOT, `${stem}.zip`);
  await rm(archivePath, { force: true });
  const archiveEntries = await collectFiles(payloadDir);
  run('zip', ['-X', '-q', archivePath, '-@'], { cwd: payloadDir, input: `${archiveEntries.join('\n')}\n` });

  const archiveSha = await sha256File(archivePath);
  const archiveSize = (await stat(archivePath)).size;
  const objectPrefix = releaseObjectPrefix(recipe);
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
  const releaseDocumentSha = await sha256File(releasePath);
  const releaseUrl = `${assetBaseUrl}/${objectPrefix}/${releaseDocumentSha}.release.json`;
  const channel = {
    schemaVersion: 1,
    kind: 'liatir.runtime-box.channel',
    channel: String(flags.get('channel') || 'beta'),
    boxId: recipe.boxId,
    target: recipe.target,
    updatedAt: provenance.builtAt,
    cohortSalt: sha256Buffer(Buffer.from(`${recipe.boxId}:${recipe.version}`)).slice(0, 32),
    releases: [{ version: recipe.version, releaseManifestUrl: releaseUrl, rolloutPercentage: 100 }],
  };
  const signedChannel = await signDocument(channel, flags);
  const channelPath = join(DIST_ROOT, `${recipe.boxId}-${channel.channel}-${targetId(recipe.target)}.channel.json`);
  await writeFile(channelPath, `${JSON.stringify(signedChannel, null, 2)}\n`);
  const objectDir = join(DIST_ROOT, 'objects', objectPrefix);
  await mkdir(objectDir, { recursive: true });
  await copyFile(archivePath, join(objectDir, `${archiveSha}.zip`));
  await copyFile(releasePath, join(objectDir, `${releaseDocumentSha}.release.json`));
  console.log(`Built archive: ${relative(ROOT, archivePath)}`);
  console.log(`Signed release: ${relative(ROOT, releasePath)}`);
  console.log(`Signed channel: ${relative(ROOT, channelPath)}`);
}

async function verifyRelease(path, flags) {
  const releasePath = resolve(path);
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const signed = JSON.parse(await readFile(releasePath, 'utf8'));
  const release = await verifySignedDocument(signed, publicKeyPath);
  if (release.kind !== 'liatir.runtime-box.release') fail('Document is not a Runtime Box release.');
  const archivePath = resolve(String(flags.get('archive') || join(dirname(releasePath), `${releaseStem(release)}.zip`)));
  if (!await fileExists(archivePath)) fail(`Archive not found: ${archivePath}`);
  if ((await stat(archivePath)).size !== release.archive.sizeBytes) fail('Archive size mismatch.');
  if (await sha256File(archivePath) !== release.archive.sha256) fail('Archive SHA-256 mismatch.');
  const entries = run('unzip', ['-Z1', archivePath], { capture: true }).split('\n').filter(Boolean);
  for (const entry of entries) safeRelativePath(entry.replace(/\/$/, ''));
  if (!entries.includes('box.json')) fail('Archive is missing box.json.');
  const box = JSON.parse(run('unzip', ['-p', archivePath, 'box.json'], { capture: true }));
  for (const field of ['boxId', 'modelId', 'runtimeId', 'version', 'pythonEntryPoint']) {
    if (box[field] !== release[field]) fail(`box.json mismatch: ${field}`);
  }
  if (!entries.includes(release.pythonEntryPoint)) fail(`Archive is missing ${release.pythonEntryPoint}.`);
  if (flags.get('self-test')) {
    const extracted = await mkdtemp(join(tmpdir(), 'liatir-runtime-box-verify-'));
    try {
      run('unzip', ['-q', archivePath, '-d', extracted]);
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

async function serve(flags) {
  const port = Number(flags.get('port') || 8790);
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
  run(wrangler, ['r2', 'object', 'put', `${bucket}/${archiveKey}`, '--remote', `--file=${archivePath}`, '--content-type=application/zip', '--cache-control=public, max-age=31536000, immutable']);
  run(wrangler, ['r2', 'object', 'put', `${bucket}/${releaseKey}`, '--remote', `--file=${releasePath}`, '--content-type=application/json', '--cache-control=public, max-age=31536000, immutable']);
  console.log(`Published r2://${bucket}/${archiveKey}`);
  console.log(`Published r2://${bucket}/${releaseKey}`);
}

async function publishTrustedKey(flags) {
  const bucket = String(flags.get('bucket') || '');
  if (!bucket) fail('publish-key requires --bucket <r2-bucket>.');
  if (!flags.get('confirm')) fail('publish-key changes the Worker trust root; pass --confirm after reviewing the public key.');
  const publicKeyPath = resolve(String(flags.get('public-key') || DEFAULT_PUBLIC_KEY));
  const key = JSON.parse(await readFile(publicKeyPath, 'utf8'));
  const documentPath = join(DIST_ROOT, 'trusted-keys.json');
  await mkdir(DIST_ROOT, { recursive: true });
  await writeFile(documentPath, `${JSON.stringify({
    schemaVersion: 1,
    keys: [{
      algorithm: key.algorithm,
      keyId: key.keyId,
      publicKeyBase64: key.publicKeyBase64,
    }],
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

async function promote(channelDocumentPath, flags) {
  const registry = String(flags.get('registry') || 'https://models.liatir.com').replace(/\/$/, '');
  const tokenFile = flags.get('token-file');
  const token = tokenFile
    ? (await readFile(resolve(String(tokenFile)), 'utf8')).trim()
    : process.env.LIATIR_RUNTIME_BOX_ADMIN_TOKEN;
  if (!token) fail('LIATIR_RUNTIME_BOX_ADMIN_TOKEN or --token-file is required for channel promotion.');
  const signedBody = await readFile(resolve(channelDocumentPath));
  const { payload } = decodeSignedDocument(JSON.parse(signedBody.toString('utf8')));
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

async function createRevocation(flags) {
  const boxId = String(flags.get('box') || fail('revoke requires --box <id>.'));
  const version = String(flags.get('version') || fail('revoke requires --version <version>.'));
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
`);
}

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

main().catch((error) => {
  console.error(`runtime-box: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
