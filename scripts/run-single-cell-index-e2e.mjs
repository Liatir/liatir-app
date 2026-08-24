#!/usr/bin/env node

/** Runs the reference-index lifecycle against a tiny, locally signed registry fixture. */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDeterministicZip } from 'scrollcase/build';
import { boxTargetAdapter } from 'scrollcase/contract';
import { generateSigningKey, signDocument } from 'scrollcase/sign';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'single-cell-index-distribution.e2e.mjs');
const INDEX_ID = 'human-grch38-gencode-v47-si-r91';
const VERSION = '1.0.0';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-length': String(body.length),
    'content-type': contentType,
  });
  response.end(body);
}

async function makeFixture(root) {
  const payload = join(root, 'payload');
  await mkdir(join(payload, 'index'), { recursive: true });
  const contents = new Map([
    ['index/piscem.ctab', Buffer.from('tiny deterministic piscem table\n')],
    ['index/t2g_3col.tsv', Buffer.from('ENST00000000001\tENSG00000000001\tS\n')],
    ['index/gene_id_to_name.tsv', Buffer.from('ENSG00000000001\tALPHA\n')],
  ]);
  for (const [path, bytes] of contents) await writeFile(join(payload, ...path.split('/')), bytes);
  const files = [...contents].map(([path, bytes]) => ({
    path,
    sha256: sha256(bytes),
    sizeBytes: bytes.length,
  }));
  await writeFile(join(payload, 'bundle.json'), `${JSON.stringify({
    schemaVersion: 1,
    kind: 'liatir.single-cell-index.bundle',
    indexId: INDEX_ID,
    version: VERSION,
    indexDir: 'index',
    t2gMap: 'index/t2g_3col.tsv',
    geneIdToName: 'index/gene_id_to_name.tsv',
    files,
  }, null, 2)}\n`);
  const archivePath = join(root, 'index.zip');
  await createDeterministicZip(payload, archivePath, boxTargetAdapter({
    platform: 'linux', arch: 'x86_64', accelerator: 'cpu',
  }));
  const archive = await readFile(archivePath);
  return { archive, archiveSha256: sha256(archive), sizeBytes: (await stat(archivePath)).size };
}

async function startFixture(root, privatePath, publicPath) {
  const fixture = await makeFixture(root);
  let archiveRequests = 0;
  let catalogBody = null;
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === '/catalog') return send(response, 200, catalogBody, 'application/json');
    if (url.pathname === '/archive.zip') {
      archiveRequests += 1;
      return send(response, 200, fixture.archive, 'application/zip');
    }
    if (url.pathname === '/requests') {
      const body = Buffer.from(`${JSON.stringify({ archiveRequests })}\n`);
      return send(response, 200, body, 'application/json');
    }
    return send(response, 404, Buffer.from('{"error":"not_found"}\n'), 'application/json');
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture server did not bind a TCP port.');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const payload = {
    schemaVersion: 2,
    kind: 'liatir.single-cell-index.catalog',
    updatedAt: '2026-08-24T12:00:00.000Z',
    indexes: [{
      id: INDEX_ID,
      version: VERSION,
      label: 'Human (GRCh38, GENCODE v47, R2 91 bp)',
      species: { commonName: 'Human', scientificName: 'Homo sapiens', taxonId: 9606 },
      genome: {
        assembly: 'GRCh38',
        source: { url: `${baseUrl}/genome.fa.gz`, checksum: { algorithm: 'md5', value: 'a'.repeat(32) } },
      },
      annotation: {
        provider: 'GENCODE', release: 'v47', format: 'gtf',
        source: { url: `${baseUrl}/genes.gtf.gz`, checksum: { algorithm: 'md5', value: 'b'.repeat(32) } },
      },
      referenceType: 'spliced+intronic',
      readLength: 91,
      archive: {
        format: 'zip', url: `${baseUrl}/archive.zip`, sha256: fixture.archiveSha256, sizeBytes: fixture.sizeBytes,
      },
      toolchain: {
        simpleafVersion: '0.28.0', piscemVersion: '0.22.1', nativeToolsLockSha256: 'c'.repeat(64),
      },
      provenance: {
        recipeSha256: 'd'.repeat(64), sourceRevision: 'e'.repeat(40), builtAt: '2026-08-24T11:00:00.000Z',
      },
    }],
  };
  catalogBody = Buffer.from(`${JSON.stringify(await signDocument(payload, { privatePath, publicPath }))}\n`);
  return {
    baseUrl,
    close: () => new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose())),
  };
}

async function runSpec(environment) {
  const child = spawn(process.execPath, [RUNNER, SPEC], {
    cwd: ROOT,
    env: { ...process.env, ...environment },
    stdio: 'inherit',
  });
  const code = await new Promise((resolveExit, reject) => {
    child.once('error', reject);
    child.once('exit', resolveExit);
  });
  if (code !== 0) throw new Error(`Single-cell index E2E exited with status ${code}.`);
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-single-cell-index-e2e-'));
const privatePath = join(temporary, 'signing-private.pem');
const publicPath = join(temporary, 'signing-public.json');
let registry;
try {
  await generateSigningKey({ privatePath, publicPath, keyId: 'liatir-single-cell-index-e2e' });
  registry = await startFixture(temporary, privatePath, publicPath);
  await runSpec({
    LIATIR_SINGLE_CELL_INDEX_CATALOG_URL: `${registry.baseUrl}/catalog`,
    LIATIR_SINGLE_CELL_INDEX_FIXTURE_BASE_URL: registry.baseUrl,
    LIATIR_RUNTIME_BOX_TRUSTED_KEY_FILE: publicPath,
  });
} finally {
  await registry?.close();
  await rm(temporary, { recursive: true, force: true });
}
