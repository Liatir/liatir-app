#!/usr/bin/env node

/**
 * Liatir-owned Runtime Box distribution.
 *
 * Building a box belongs to Scrollcase; what a box *becomes* afterwards belongs here. This module
 * owns the four steps the package deliberately has no opinion about — uploading immutable objects
 * to R2 through the Registry Worker, replacing the Worker's trust root, promoting a signed channel,
 * and signing a revocation — plus the loopback registry that lets a full install be exercised
 * without publishing anything.
 *
 * Two properties drive the design:
 *
 * 1. **Publication is irreversible.** An object's key is its own hash, so the bytes behind a URL
 *    can never change; that is what makes them cacheable forever, and also why every upload is
 *    streamed back from the public domain and re-hashed before the release document that commits
 *    to it is published at all.
 *
 * 2. **The private key is never required to be here.** Local Ed25519 keys exist for development,
 *    but a production signature comes from the Cloud Run signer, which keeps the key in KMS.
 *    Either way, this CLI verifies the signature it gets back before trusting it.
 */

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  decodeSignedDocument as decodeScrollcaseDocument,
  signDocument as signScrollcaseDocument,
  verifySignedDocument as verifyScrollcaseDocument,
} from 'scrollcase/sign';
import { fileExists, safeRelativePath, sha256File } from './filesystem.mjs';
import { runtimeBoxArchivePath, runtimeBoxReleaseObjectPrefix } from './identity.mjs';
import { fail, run as runProcess } from './process.mjs';
import { configureWorkspace, getWorkspace, workspaceOverridesFromFlags } from './workspace.mjs';
import { runtimeBoxTargetId } from './targets.mjs';
import { liatirSignerCommand } from './signer-command.mjs';

/**
 * Workspace directories, read through getters so `main()` can configure them from flags before the
 * first path is used. `root` is the project root; `dist` and `keys` are generated and git-ignored.
 * See `runtime-box/workspace.mjs` for the resolution rules.
 */
const paths = {
  get root() { return getWorkspace().root; },
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
    || runtimeBoxArchivePath(releasePath, release)));
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
  console.log(`Internal distribution module. Use: npm run runtime-box -- <command> [options]

Commands:
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
  --out-dir <dir>                Built artefacts (default .runtime-box-dist)
  --keys-dir <dir>               Local dev signing keys (default .runtime-box-local)

Production signing:
  Pass --signer <private-cloud-run-url> to revoke. The CLI obtains a short-lived
  Google identity token and verifies the returned signature locally.
`);
}

/** Liatir-owned distribution command dispatch; building belongs to the published Scrollcase CLI. */
export async function runRuntimeBoxDistributionCommand(command, rest) {
  const { positional, flags } = parseArgs(rest);
  if (!command || command === 'help' || command === '--help') return usage();
  // Resolve the workspace before any command touches a path, so flags win over the project config.
  configureWorkspace({ overrides: workspaceOverridesFromFlags(flags) });
  if (command === 'serve') return serve(flags);
  if (command === 'publish') return publish(positional[0] || fail('publish requires a signed release document.'), flags);
  if (command === 'publish-key') return publishTrustedKey(flags);
  if (command === 'promote') return promote(positional[0] || fail('promote requires a signed channel document.'), flags);
  if (command === 'revoke') return createRevocation(flags);
  fail(`Unknown command: ${command}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  await runRuntimeBoxDistributionCommand(command, rest);
}

// Single failure path: every `fail()` anywhere above lands here as a one-line message and a
// non-zero exit code, so CI and shell callers can rely on the status.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`runtime-box: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}

export { multipartPartRanges };
