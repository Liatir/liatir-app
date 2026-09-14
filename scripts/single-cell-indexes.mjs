#!/usr/bin/env node

/** Build and publish immutable, signed single-cell reference indexes. */

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  appendFile, copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile,
} from 'node:fs/promises';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { createDataArchive } from './data-archive.mjs';
import {
  multipartPartRanges,
  registryAdminRequest,
  registryAdminToken,
  registryBaseUrl,
  remoteObjectExists,
  signDocument,
  verifyRemoteObject,
  verifySignedDocument,
} from './runtime-box/distribution-cli.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RECIPES_PATH = join(ROOT, 'single-cell-indexes', 'recipes.json');
const DEFAULT_DIST = join(ROOT, '.single-cell-index-dist');
const DEFAULT_WORK = join(ROOT, '.single-cell-index-work');
const DEFAULT_ASSET_ORIGIN = 'https://assets.models.liatir.com';
const DEFAULT_OBJECT_PREFIX = 'ai-runtime-boxes';
const PART_BYTES = 64 * 1024 * 1024;

function fail(message) { throw new Error(message); }

function parseArgs(values) {
  const positional = [];
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith('--')) { positional.push(value); continue; }
    const [name, inline] = value.slice(2).split('=', 2);
    if (inline !== undefined) flags.set(name, inline);
    else if (values[index + 1] && !values[index + 1].startsWith('--')) {
      flags.set(name, values[++index]);
    } else flags.set(name, true);
  }
  return { positional, flags };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function digestBytes(bytes, algorithm = 'sha256') {
  return createHash(algorithm).update(bytes).digest('hex');
}

async function digestFile(path, algorithm = 'sha256') {
  const hash = createHash(algorithm);
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function safeSegment(value, label) {
  if (!/^[a-z0-9][a-z0-9._-]{0,127}$/.test(String(value))) fail(`Invalid ${label}: ${value}`);
  return String(value);
}

async function loadRecipe(id) {
  const catalog = JSON.parse(await readFile(RECIPES_PATH, 'utf8'));
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.indexes)) fail('Invalid reference-index recipe catalog.');
  const recipe = catalog.indexes.find((candidate) => candidate.id === id);
  if (!recipe) fail(`Unknown reference-index recipe: ${id}`);
  safeSegment(recipe.id, 'index ID');
  safeSegment(recipe.version, 'index version');
  if (recipe.referenceType !== 'spliced+intronic' || !Number.isInteger(recipe.readLength) || recipe.readLength <= 0) {
    fail(`Invalid scientific construction for ${recipe.id}.`);
  }
  for (const source of [recipe.genome?.source, recipe.annotation?.source]) {
    const url = new URL(source?.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      fail(`Invalid source URL for ${recipe.id}.`);
    }
    if (!['md5', 'sha256'].includes(source.checksum?.algorithm)
      || !new RegExp(`^[a-f0-9]{${source.checksum.algorithm === 'md5' ? 32 : 64}}$`).test(source.checksum.value)) {
      fail(`Invalid source checksum for ${recipe.id}.`);
    }
  }
  const recipeSha256 = digestBytes(Buffer.from(JSON.stringify(canonicalize(recipe))));
  return { recipe, recipeSha256 };
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    encoding: 'utf8',
    stdio: options.input === undefined ? 'inherit' : ['pipe', 'inherit', 'inherit'],
    input: options.input,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`${command} exited with status ${result.status}.`);
}

async function downloadSource(source, destination) {
  await mkdir(dirname(destination), { recursive: true });
  if (await stat(destination).then(() => true, () => false)) {
    const current = await digestFile(destination, source.checksum.algorithm);
    if (current === source.checksum.value) return;
    await rm(destination);
  }
  const response = await fetch(source.url, { headers: { 'accept-encoding': 'identity' } });
  if (!response.ok || !response.body) fail(`Source download failed (${response.status}): ${source.url}`);
  const partial = `${destination}.part`;
  await pipeline(Readable.fromWeb(response.body), createWriteStream(partial));
  const actual = await digestFile(partial, source.checksum.algorithm);
  if (actual !== source.checksum.value) {
    await rm(partial, { force: true });
    fail(`Source checksum mismatch: ${source.url}`);
  }
  await rm(destination, { force: true });
  await rename(partial, destination);
}

async function filesUnder(root) {
  const output = [];
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) output.push(path);
      else fail(`Index output contains an unsupported filesystem entry: ${path}`);
    }
  }
  await visit(root);
  return output;
}

async function build(id, flags) {
  if (process.platform !== 'linux' || process.arch !== 'x64') {
    fail('Published single-cell indexes are built on Linux x86_64 CI.');
  }
  const { recipe, recipeSha256 } = await loadRecipe(id);
  const distRoot = resolve(String(flags.get('dist') || DEFAULT_DIST));
  const workRoot = resolve(String(flags.get('work') || DEFAULT_WORK));
  const outputRoot = join(distRoot, recipe.id, recipe.version);
  const work = join(workRoot, recipe.id, recipe.version);
  const sources = join(work, 'sources');
  const simpleafOutput = join(work, 'simpleaf');
  const bundleRoot = simpleafOutput;
  await rm(work, { recursive: true, force: true });
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(sources, { recursive: true });

  const genomePath = join(sources, basename(new URL(recipe.genome.source.url).pathname));
  const annotationPath = join(sources, basename(new URL(recipe.annotation.source.url).pathname));
  await downloadSource(recipe.genome.source, genomePath);
  await downloadSource(recipe.annotation.source, annotationPath);
  const sourceChecksums = {
    genome: await digestFile(genomePath, recipe.genome.source.checksum.algorithm),
    annotation: await digestFile(annotationPath, recipe.annotation.source.checksum.algorithm),
  };

  const pixi = String(flags.get('pixi') || process.env.PIXI_BIN || 'pixi');
  const sourceManifest = resolve(ROOT, recipe.toolchain.pixiManifest);
  const sourceLock = resolve(ROOT, recipe.toolchain.pixiLock);
  const pixiWorkspace = join(work, 'pixi-workspace');
  const manifest = join(pixiWorkspace, 'pixi.toml');
  await mkdir(pixiWorkspace, { recursive: true });
  await copyFile(sourceManifest, manifest);
  await copyFile(sourceLock, join(pixiWorkspace, 'pixi.lock'));
  const simpleafHome = join(work, 'simpleaf-home');
  const environment = { ALEVIN_FRY_HOME: simpleafHome };
  const pixiPrefix = ['run', '--locked', '--manifest-path', manifest];
  await mkdir(simpleafHome, { recursive: true });
  run(pixi, [...pixiPrefix, 'simpleaf', 'set-paths'], { cwd: work, env: environment });
  run(pixi, [
    ...pixiPrefix,
    'simpleaf', 'index',
    '--output', simpleafOutput,
    '--fasta', genomePath,
    '--gtf', annotationPath,
    '--rlen', String(recipe.readLength),
    '--threads', String(flags.get('threads') || 8),
    '--work-dir', join(work, 'simpleaf-scratch'),
    ...(recipe.annotation.format === 'gff3' ? ['--gff3-format'] : []),
  ], { cwd: work, env: environment });

  const builtIndex = join(simpleafOutput, 'index');
  if (!await stat(join(builtIndex, 't2g_3col.tsv')).then((value) => value.isFile(), () => false)) {
    fail('simpleaf completed without the transcript-to-gene map.');
  }
  // Source archives and simpleaf scratch are no longer needed once piscem has completed. Reclaim
  // them before creating the ZIP so a standard GitHub runner does not need space for both copies.
  await rm(sources, { recursive: true, force: true });
  await rm(join(work, 'simpleaf-scratch'), { recursive: true, force: true });
  const payloadFiles = await filesUnder(bundleRoot);
  const files = [];
  for (const path of payloadFiles) {
    const info = await stat(path);
    files.push({
      path: relative(bundleRoot, path).split(sep).join('/'),
      sha256: await digestFile(path),
      sizeBytes: info.size,
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));
  const geneMap = files.some((file) => file.path === 'index/gene_id_to_name.tsv')
    ? 'index/gene_id_to_name.tsv'
    : undefined;
  await writeJson(join(bundleRoot, 'bundle.json'), {
    schemaVersion: 1,
    kind: 'liatir.single-cell-index.bundle',
    indexId: recipe.id,
    version: recipe.version,
    indexDir: 'index',
    t2gMap: 'index/t2g_3col.tsv',
    ...(geneMap ? { geneIdToName: geneMap } : {}),
    files,
  });
  await mkdir(outputRoot, { recursive: true });
  const temporaryArchive = join(outputRoot, 'index.zip');
  await createDataArchive(bundleRoot, temporaryArchive);
  const archiveSha256 = await digestFile(temporaryArchive);
  const archivePath = join(outputRoot, `${archiveSha256}.zip`);
  await rename(temporaryArchive, archivePath);
  const archiveSize = (await stat(archivePath)).size;
  const lockPath = resolve(ROOT, recipe.toolchain.pixiLock);
  const assetOrigin = String(flags.get('asset-origin') || DEFAULT_ASSET_ORIGIN).replace(/\/$/, '');
  const objectPrefix = String(flags.get('prefix') || DEFAULT_OBJECT_PREFIX).replace(/^\/+|\/+$/g, '');
  const builtAt = new Date().toISOString();
  const sourceRevision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim();
  const entry = {
    id: recipe.id,
    version: recipe.version,
    label: recipe.label,
    species: recipe.species,
    genome: recipe.genome,
    annotation: recipe.annotation,
    referenceType: recipe.referenceType,
    readLength: recipe.readLength,
    archive: {
      format: 'zip',
      url: `${assetOrigin}/${objectPrefix}/reference-indexes/${recipe.id}/${recipe.version}/${archiveSha256}.zip`,
      sha256: archiveSha256,
      sizeBytes: archiveSize,
    },
    toolchain: {
      simpleafVersion: recipe.toolchain.simpleafVersion,
      piscemVersion: recipe.toolchain.piscemVersion,
      nativeToolsLockSha256: await digestFile(lockPath),
    },
    provenance: { recipeSha256, sourceRevision, builtAt },
  };
  await writeJson(join(outputRoot, 'entry.json'), entry);
  await writeJson(join(outputRoot, 'build-evidence.json'), {
    schemaVersion: 1,
    kind: 'liatir.single-cell-index.build-evidence',
    status: 'passed',
    entry,
    sourceChecksums,
  });
  console.log(`Built ${relative(ROOT, archivePath)}`);
  console.log(`Entry ${relative(ROOT, join(outputRoot, 'entry.json'))}`);
}

async function uploadArchive(archivePath, entry, flags) {
  const registry = registryBaseUrl(flags);
  const token = await registryAdminToken(flags);
  const identityPath = [entry.id, entry.version, entry.archive.sha256]
    .map(encodeURIComponent).join('/');
  const baseUrl = `${registry}/v1/admin/reference-indexes/uploads/${identityPath}`;
  const created = await registryAdminRequest(`${registry}/v1/admin/reference-indexes/uploads`, token, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      indexId: entry.id,
      version: entry.version,
      sha256: entry.archive.sha256,
      sizeBytes: entry.archive.sizeBytes,
    }),
  });
  if (typeof created.uploadId !== 'string' || !created.uploadId) fail('Registry did not return an upload ID.');
  const parts = [];
  try {
    for (const range of multipartPartRanges(entry.archive.sizeBytes, PART_BYTES)) {
      const uploaded = await registryAdminRequest(
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
      parts.push({ partNumber: uploaded.partNumber, etag: uploaded.etag });
      console.log(`Uploaded index part ${range.partNumber} / ${Math.ceil(entry.archive.sizeBytes / PART_BYTES)}`);
    }
    await registryAdminRequest(
      `${baseUrl}/complete?uploadId=${encodeURIComponent(created.uploadId)}`,
      token,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ parts }) },
    );
  } catch (error) {
    try {
      await registryAdminRequest(`${baseUrl}?uploadId=${encodeURIComponent(created.uploadId)}`, token, { method: 'DELETE' });
    } catch { /* R2 expires incomplete multipart uploads. */ }
    throw error;
  }
}

async function currentCatalog(registry, publicKeyPath) {
  const response = await fetch(`${registry}/v1/reference-indexes/catalog`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (response.status === 404) return [];
  if (!response.ok) fail(`Cannot read current reference-index catalog (${response.status}).`);
  const document = JSON.parse(await response.text());
  const payload = await verifySignedDocument(document, publicKeyPath);
  if (payload.kind !== 'liatir.single-cell-index.catalog' || !Array.isArray(payload.indexes)) {
    fail('Registry returned the wrong signed document for the reference-index catalog.');
  }
  return payload.indexes;
}

async function publish(entryPath, flags) {
  const entry = JSON.parse(await readFile(resolve(entryPath), 'utf8'));
  const archivePath = resolve(dirname(resolve(entryPath)), `${entry.archive.sha256}.zip`);
  if (await digestFile(archivePath) !== entry.archive.sha256
    || (await stat(archivePath)).size !== entry.archive.sizeBytes) {
    fail('Local index archive does not match entry.json.');
  }
  if (!await remoteObjectExists(entry.archive.url)) await uploadArchive(archivePath, entry, flags);
  const archiveVerification = await verifyRemoteObject(
    entry.archive.url, entry.archive.sizeBytes, entry.archive.sha256,
  );

  const registry = registryBaseUrl(flags);
  const publicKeyPath = resolve(String(flags.get('public-key') || join(ROOT, 'runtime-boxes/trust/production-public.json')));
  const carried = await currentCatalog(registry, publicKeyPath);
  const existing = carried.find((candidate) => candidate.id === entry.id && candidate.version === entry.version);
  if (existing && existing.archive.sha256 !== entry.archive.sha256) {
    fail(`${entry.id} ${entry.version} is already published with different bytes; bump its version.`);
  }
  const indexes = [
    ...carried.filter((candidate) => candidate.id !== entry.id || candidate.version !== entry.version),
    entry,
  ].sort((left, right) => left.label.localeCompare(right.label) || left.version.localeCompare(right.version));
  const payload = {
    schemaVersion: 2,
    kind: 'liatir.single-cell-index.catalog',
    updatedAt: new Date().toISOString(),
    indexes,
  };
  const signed = await signDocument(payload, flags);
  await verifySignedDocument(signed, publicKeyPath);
  const signedPath = join(dirname(resolve(entryPath)), 'catalog.signed.json');
  await writeJson(signedPath, signed);
  const token = await registryAdminToken(flags);
  await registryAdminRequest(`${registry}/v1/admin/reference-indexes/catalog`, token, {
    method: 'PUT',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: await readFile(signedPath),
  });
  const published = await fetch(`${registry}/v1/reference-indexes/catalog`, {
    headers: { 'cache-control': 'no-cache' },
  });
  if (!published.ok) fail(`Published catalog read-back failed (${published.status}).`);
  const publishedDocument = JSON.parse(await published.text());
  await verifySignedDocument(publishedDocument, publicKeyPath);
  if (publishedDocument.payloadSha256 !== signed.payloadSha256) fail('Published catalog differs from the signed catalog.');
  await writeJson(join(dirname(resolve(entryPath)), 'publish-receipt.json'), {
    schemaVersion: 1,
    kind: 'liatir.single-cell-index.publish-receipt',
    status: 'passed',
    archive: archiveVerification,
    catalogPayloadSha256: signed.payloadSha256,
  });
  console.log(`Published and promoted ${entry.id} ${entry.version}`);
}

async function validate(id, flags) {
  const { recipe, recipeSha256 } = await loadRecipe(id);
  const lock = resolve(ROOT, recipe.toolchain.pixiLock);
  const manifest = resolve(ROOT, recipe.toolchain.pixiManifest);
  for (const path of [lock, manifest]) await stat(path);
  if (flags.get('github-output')) {
    await appendFile(resolve(String(flags.get('github-output'))), [
      `index_id=${recipe.id}`,
      `version=${recipe.version}`,
      `recipe_sha256=${recipeSha256}`,
      `entry_path=.single-cell-index-dist/${recipe.id}/${recipe.version}/entry.json`,
      '',
    ].join('\n'));
  }
  console.log(`${recipe.id} recipe SHA-256 ${recipeSha256}`);
}

function usage() {
  console.log(`Usage: node scripts/single-cell-indexes.mjs <command> --id <recipe>

Commands:
  validate  Validate a tracked recipe and print its signing-policy fingerprint
  build     Download pinned sources, build with the Native Tools pixi lock, and package deterministically
  publish   Upload the immutable archive, verify public bytes, sign and promote the merged catalog

Publishing requires --entry <entry.json>, LIATIR_RUNTIME_BOX_ADMIN_TOKEN, and the same
--signer / --signer-audience / --public-key inputs used by Runtime Box production signing.`);
}

async function main() {
  const [command, ...values] = process.argv.slice(2);
  const { flags } = parseArgs(values);
  if (!command || command === 'help' || command === '--help') return usage();
  if (command === 'validate') return validate(String(flags.get('id') || fail('validate requires --id.')), flags);
  if (command === 'build') return build(String(flags.get('id') || fail('build requires --id.')), flags);
  if (command === 'publish') return publish(String(flags.get('entry') || fail('publish requires --entry.')), flags);
  fail(`Unknown command: ${command}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`single-cell-indexes: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { canonicalize, loadRecipe };
