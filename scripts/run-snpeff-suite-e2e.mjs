#!/usr/bin/env node

/** Runs the managed SnpEff/SnpSift lifecycle against tiny local ZIP fixtures. */

import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createDataArchive } from './data-archive.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const RUNNER = join(ROOT, 'tests', 'e2e', 'run-tauri-e2e.mjs');
const SPEC = join(ROOT, 'tests', 'e2e', 'specs', 'snpeff-suite.e2e.mjs');
const VERSION = '5.4c-e2e';
const DATABASE_ID = 'tiny.1';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

async function zipFixture(root, name, files) {
  const payload = join(root, `${name}-payload`);
  for (const [relative, bytes] of files) {
    const destination = join(payload, ...relative.split('/'));
    await mkdir(join(destination, '..'), { recursive: true });
    await writeFile(destination, bytes);
  }
  const archivePath = join(root, `${name}.zip`);
  await createDataArchive(payload, archivePath);
  const bytes = await readFile(archivePath);
  return { bytes, sha256: sha256(bytes), sizeBytes: (await stat(archivePath)).size };
}

async function makeFixtures(root) {
  const suite = await zipFixture(root, 'suite', [
    ['snpEff/snpEff.jar', Buffer.from('tiny snpEff jar fixture\n')],
    ['snpEff/SnpSift.jar', Buffer.from('tiny SnpSift jar fixture\n')],
    ['snpEff/snpEff.config', Buffer.from('database.repository = https://example.invalid/databases\n')],
    ['snpEff/LICENSE.md', Buffer.from('MIT License fixture\n')],
  ]);
  const database = await zipFixture(root, 'database', [
    [`data/${DATABASE_ID}/snpEffectPredictor.bin`, Buffer.from('tiny predictor fixture\n')],
    [`data/${DATABASE_ID}/sequence.bin`, Buffer.from('tiny sequence fixture\n')],
  ]);
  return { suite, database };
}

function send(response, status, body, contentType) {
  response.writeHead(status, {
    'access-control-allow-origin': '*',
    'content-length': String(body.length),
    'content-type': contentType,
  });
  response.end(body);
}

async function startFixture(root) {
  const fixtures = await makeFixtures(root);
  const requests = { suite: 0, database: 0 };
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`);
    if (url.pathname === '/suite.zip') {
      requests.suite += 1;
      return send(response, 200, fixtures.suite.bytes, 'application/zip');
    }
    if (url.pathname === '/database.zip') {
      requests.database += 1;
      return send(response, 200, fixtures.database.bytes, 'application/zip');
    }
    if (url.pathname === '/requests') {
      return send(response, 200, Buffer.from(`${JSON.stringify(requests)}\n`), 'application/json');
    }
    return send(response, 404, Buffer.from('{"error":"not_found"}\n'), 'application/json');
  });
  await new Promise((resolveReady, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveReady);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SnpEff fixture server did not bind.');
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const catalogPath = join(root, 'catalog.json');
  await writeFile(catalogPath, `${JSON.stringify({
    schemaVersion: 1,
    kind: 'liatir.snpeff-suite.catalog',
    recommendedVersion: VERSION,
    releases: [{
      version: VERSION,
      releasedAt: '2026-02-23',
      javaMinMajor: 21,
      databaseSeries: 'e2e',
      license: { spdxId: 'MIT', url: 'https://github.com/pcingola/SnpEff/blob/master/LICENSE.md' },
      archive: {
        format: 'zip', url: `${baseUrl}/suite.zip`, sha256: fixtures.suite.sha256, sizeBytes: fixtures.suite.sizeBytes,
      },
    }],
    databases: [{
      id: DATABASE_ID,
      label: 'Tiny test genome',
      species: { commonName: 'Test organism', scientificName: 'Testus organismus', taxonId: 1 },
      assembly: 'tiny',
      annotation: { provider: 'Liatir E2E', release: '1' },
      suiteVersion: VERSION,
      databaseSeries: 'e2e',
      archive: {
        format: 'zip', url: `${baseUrl}/database.zip`, sha256: fixtures.database.sha256, sizeBytes: fixtures.database.sizeBytes,
      },
    }],
  }, null, 2)}\n`);
  return {
    baseUrl,
    catalogPath,
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
  if (code !== 0) throw new Error(`SnpEff suite E2E exited with status ${code}.`);
}

const temporary = await mkdtemp(join(tmpdir(), 'liatir-snpeff-suite-e2e-'));
let fixture;
try {
  fixture = await startFixture(temporary);
  await runSpec({
    LIATIR_SNPEFF_SUITE_CATALOG_PATH: fixture.catalogPath,
    LIATIR_SNPEFF_SUITE_FIXTURE_BASE_URL: fixture.baseUrl,
  });
} finally {
  await fixture?.close();
  await rm(temporary, { recursive: true, force: true });
}
