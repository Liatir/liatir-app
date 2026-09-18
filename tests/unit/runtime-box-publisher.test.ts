import { describe, expect, it, vi } from 'vitest';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { resolve } from 'node:path';

import {
  SOURCE_MIRROR_SPECS,
  mergeRevocations,
  multipartPartRanges,
  normalizeRevocationEntry,
  parseHttpByteRange,
  verifyRemoteObject,
} from '../../scripts/runtime-box/distribution-cli.mjs';
import { dispatchRuntimeBox } from '../../scripts/runtime-box/scrollcase-adapter.mjs';
import {
  parseImmutableReleaseIdentity,
  parseMultipartArchiveIdentity,
  parseSourceMirrorIdentity,
  validateImmutableReleaseRoute,
} from '../../workers/runtime-box-registry/src/index';
import runtimeBoxRegistry from '../../workers/runtime-box-registry/src/index';

describe('Runtime Box large-archive publisher', () => {
  it('splits the measured UCE archive into contiguous 64 MiB parts', () => {
    const archiveSize = 8_862_120_348;
    const ranges = multipartPartRanges(archiveSize);

    expect(ranges).toHaveLength(133);
    expect(ranges[0]).toEqual({
      partNumber: 1,
      start: 0,
      end: 67_108_863,
      sizeBytes: 67_108_864,
    });
    expect(ranges.at(-1)).toEqual({
      partNumber: 133,
      start: 8_858_370_048,
      end: 8_862_120_347,
      sizeBytes: 3_750_300,
    });
    expect(ranges.every((range, index) => index === 0 || range.start === ranges[index - 1].end + 1)).toBe(true);
  });

  it('allows only content-addressed Runtime Box archive identities', () => {
    const sha256 = 'a'.repeat(64);
    expect(parseMultipartArchiveIdentity(
      'uce-4layer',
      '1.0.0-beta.1',
      'macos-aarch64-metal',
      sha256,
    )).toEqual({
      boxId: 'uce-4layer',
      version: '1.0.0-beta.1',
      target: 'macos-aarch64-metal',
      sha256,
      key: `boxes/uce-4layer/1.0.0-beta.1/macos-aarch64-metal/${sha256}.zip`,
    });
    expect(parseMultipartArchiveIdentity('../uce', '1.0.0', 'macos-aarch64-metal', sha256)).toBeNull();
    expect(parseMultipartArchiveIdentity('uce-4layer', '1.0.0', 'macos/aarch64', sha256)).toBeNull();
    expect(parseMultipartArchiveIdentity('uce-4layer', '1.0.0', 'macos-aarch64-metal', 'not-a-hash')).toBeNull();
  });

  it('binds signed release documents to one immutable route', () => {
    const sha256 = 'b'.repeat(64);
    const identity = parseImmutableReleaseIdentity(
      'geneformer-v1-10m',
      '1.0.0-beta.1',
      'macos-aarch64-metal',
      sha256,
    );
    expect(identity).toEqual({
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.1',
      target: 'macos-aarch64-metal',
      sha256,
      key: `boxes/geneformer-v1-10m/1.0.0-beta.1/macos-aarch64-metal/${sha256}.release.json`,
    });
    expect(validateImmutableReleaseRoute({
      schemaVersion: 3,
      kind: 'liatir.runtime-box.release',
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
    }, identity!)).toBe(true);
    expect(validateImmutableReleaseRoute({
      schemaVersion: 3,
      kind: 'liatir.runtime-box.release',
      boxId: 'scgpt-whole-human',
      version: '1.0.0-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
    }, identity!)).toBe(false);
    expect(parseImmutableReleaseIdentity('../geneformer', '1.0.0', 'macos-aarch64-metal', sha256)).toBeNull();
  });

  it('allows exactly the reviewed MHCflurry source mirror', () => {
    const expected = {
      mirrorId: 'mhcflurry-class1-presentation',
      sha256: '44784a00d480298b66bfc232e2d1bb1a2df5e564f894a2fcc15d29fbd83f0d1e',
      sizeBytes: 135_602_727,
      key: 'source-mirrors/mhcflurry/models_class1_presentation.20200611.models-only.tar.gz',
      contentType: 'application/gzip',
    };
    expect(parseSourceMirrorIdentity('mhcflurry-class1-presentation')).toEqual(expected);
    expect(parseSourceMirrorIdentity('mhcflurry')).toBeNull();
    expect(parseSourceMirrorIdentity('../mhcflurry-class1-presentation')).toBeNull();
    expect(SOURCE_MIRROR_SPECS['mhcflurry-class1-presentation']).toEqual({
      sizeBytes: expected.sizeBytes,
      sha256: expected.sha256,
      key: expected.key,
      publicUrl: `https://assets.models.liatir.com/ai-runtime-boxes/${expected.key}`,
    });
    expect(Object.keys(SOURCE_MIRROR_SPECS)).toEqual(['mhcflurry-class1-presentation']);
  });

  it('rejects unknown and unauthenticated source-mirror upload routes before touching R2', async () => {
    const env = { ADMIN_TOKEN: 'not-used' } as never;
    const context = {} as never;
    const unknown = await runtimeBoxRegistry.fetch(
      new Request('https://models.liatir.com/v1/admin/source-mirrors/other/uploads', { method: 'POST' }),
      env,
      context,
    );
    expect(unknown.status).toBe(400);
    await expect(unknown.json()).resolves.toEqual({ error: 'invalid_route' });

    const unauthenticated = await runtimeBoxRegistry.fetch(
      new Request('https://models.liatir.com/v1/admin/source-mirrors/mhcflurry-class1-presentation/uploads', {
        method: 'POST',
      }),
      env,
      context,
    );
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({ error: 'unauthorized' });
  });

  it('keeps the production source-mirror workflow manual and MHCflurry-only', () => {
    const workflow = readFileSync(
      resolve('.github/workflows/runtime-box-mhcflurry-source-mirror.yml'),
      'utf8',
    );
    const triggers = workflow.slice(0, workflow.indexOf('\nconcurrency:'));
    expect(triggers).toContain('workflow_dispatch:');
    expect(triggers).not.toContain('\n  push:');
    expect(triggers).not.toContain('\n  pull_request:');
    expect(workflow).toContain('environment: runtime-box-production');
    expect(workflow).toContain('LIATIR_RUNTIME_BOX_ADMIN_TOKEN: ${{ secrets.LIATIR_RUNTIME_BOX_ADMIN_TOKEN }}');
    expect(workflow).toContain('test "$MIRROR_ID" = "mhcflurry-class1-presentation"');
    expect(workflow).toContain('test "$UPLOAD_CONFIRMATION" = "UPLOAD MHCFLURRY SOURCE MIRROR"');
    expect(workflow).toContain('publish-source-mirror "$MIRROR_ID"');
    expect(workflow).not.toMatch(/CLOUDFLARE_API_TOKEN|wrangler r2 object put|runtime-box -- publish /);
    expect(workflow.match(/- mhcflurry-class1-presentation/g)).toHaveLength(1);
  });

  it('routes the source-mirror command through the stable Runtime Box CLI', async () => {
    const distributionCommand = vi.fn(async () => undefined);
    const values = ['mhcflurry-class1-presentation', '--file', '/tmp/mirror.tar.gz'];

    await dispatchRuntimeBox('publish-source-mirror', values, { distributionCommand });

    expect(distributionCommand).toHaveBeenCalledOnce();
    expect(distributionCommand).toHaveBeenCalledWith('publish-source-mirror', values);
  });
});

describe('Runtime Box candidate registry byte ranges', () => {
  it('serves the resume ranges requested by Liatir downloads', () => {
    expect(parseHttpByteRange(undefined, 1_000)).toBeNull();
    expect(parseHttpByteRange('bytes=128-', 1_000)).toEqual({
      satisfiable: true,
      start: 128,
      end: 999,
      sizeBytes: 872,
    });
    expect(parseHttpByteRange('bytes=128-255', 1_000)).toEqual({
      satisfiable: true,
      start: 128,
      end: 255,
      sizeBytes: 128,
    });
    expect(parseHttpByteRange('bytes=-64', 1_000)).toEqual({
      satisfiable: true,
      start: 936,
      end: 999,
      sizeBytes: 64,
    });
  });

  it('rejects invalid or unsatisfiable ranges', () => {
    expect(parseHttpByteRange('bytes=1000-', 1_000)).toEqual({ satisfiable: false });
    expect(parseHttpByteRange('bytes=400-399', 1_000)).toEqual({ satisfiable: false });
    expect(parseHttpByteRange('bytes=0-1,4-5', 1_000)).toEqual({ satisfiable: false });
    expect(parseHttpByteRange('items=0-1', 1_000)).toEqual({ satisfiable: false });
  });
});

describe('public object verification', () => {
  /** Serves `body`, dropping the first full read halfway through and honouring later range reads. */
  async function flakyObjectServer(body: Buffer) {
    const ranges: string[] = [];
    const server = createServer((request, response) => {
      const range = request.headers.range;
      ranges.push(range ?? 'full');
      if (!range) {
        response.writeHead(200, { 'content-length': body.length });
        response.write(body.subarray(0, body.length / 2), () => response.destroy());
        return;
      }
      const start = Number(/^bytes=(\d+)-$/.exec(range)?.[1]);
      response.writeHead(206, {
        'content-length': body.length - start,
        'content-range': `bytes ${start}-${body.length - 1}/${body.length}`,
      });
      response.end(body.subarray(start));
    });
    await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
    const { port } = server.address() as AddressInfo;
    return { url: `http://127.0.0.1:${port}/object.zip`, ranges, close: () => server.close() };
  }

  it('resumes a dropped read where it stopped and still proves the whole object', async () => {
    const body = randomBytes(64 * 1024);
    const sha256 = createHash('sha256').update(body).digest('hex');
    const server = await flakyObjectServer(body);
    try {
      const verified = await verifyRemoteObject(server.url, body.length, sha256);
      expect(verified).toMatchObject({ httpStatus: 200, sizeBytes: body.length, sha256 });
      expect(server.ranges[0]).toBe('full');
      expect(server.ranges[1]).toMatch(/^bytes=\d+-$/);
    } finally {
      server.close();
    }
  });

  it('still refuses bytes that do not match the signed hash after resuming', async () => {
    const body = randomBytes(64 * 1024);
    const server = await flakyObjectServer(body);
    try {
      await expect(verifyRemoteObject(server.url, body.length, 'a'.repeat(64))).rejects.toThrow(/SHA-256 mismatch/);
    } finally {
      server.close();
    }
  });
});

/**
 * Withdrawing one target of a version is the only way to retire a platform without pulling the
 * versions that are still live on the others, and the app matches a revocation's target exactly.
 * These tests hold the signing side to that: what the document says must be what the app can act on.
 */
describe('Runtime Box revocation entries', () => {
  const revokedAt = '2026-09-18T12:00:00.000Z';
  const windowsCuda = { platform: 'windows', arch: 'x86_64', accelerator: 'cuda', cudaVersion: '12.8' };

  it('carries a target through, so one retired platform does not withdraw the live ones', () => {
    const entry = normalizeRevocationEntry(
      { boxId: 'geneformer-v1-10m', version: '1.0.0-beta.2', target: windowsCuda, reason: 'retired platform' },
      revokedAt,
      'plan.json',
    );

    expect(entry).toEqual({
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.2',
      target: windowsCuda,
      reason: 'retired platform',
      revokedAt,
    });
  });

  it('omits the target when none was asked for, which withdraws every target of the version', () => {
    const entry = normalizeRevocationEntry(
      { boxId: 'scgpt-whole-human', version: '0.2.5-beta.1', reason: 'superseded by beta.2' },
      revokedAt,
      'plan.json',
    );

    expect(entry).not.toHaveProperty('target');
  });

  // The app parses the signed list with unknown fields denied, and a list it cannot parse fails
  // every install — so a stray key has to stop at the signer rather than reach the document.
  it('refuses a target carrying anything that is not a target field', () => {
    expect(() => normalizeRevocationEntry(
      { boxId: 'b', version: '1.0.0', target: { ...windowsCuda, note: 'retired' }, reason: 'retired platform' },
      revokedAt,
      'plan.json',
    )).toThrow(/unknown field\(s\): note/);
  });

  it('refuses a target that could never match a published build', () => {
    expect(() => normalizeRevocationEntry(
      { boxId: 'b', version: '1.0.0', target: { platform: 'windows', arch: 'x86_64', accelerator: 'cuda' }, reason: 'retired platform' },
      revokedAt,
      'plan.json',
    )).toThrow(/invalid "target"/);
  });

  it('keeps a target-scoped entry distinct from the whole-version one it must not replace', () => {
    const wholeVersion = { boxId: 'b', version: '1.0.0', reason: 'superseded release', revokedAt };
    const oneTarget = { boxId: 'b', version: '1.0.0', target: windowsCuda, reason: 'retired platform', revokedAt };

    expect(mergeRevocations([wholeVersion], [oneTarget])).toEqual([wholeVersion, oneTarget]);
  });

  // Re-stating a revocation may correct its wording; it may never rewrite when the box was pulled.
  it('keeps the original withdrawal time when an entry is revoked again', () => {
    const original = { boxId: 'b', version: '1.0.0', target: windowsCuda, reason: 'retired platform', revokedAt };
    const restated = { ...original, reason: 'retired: Windows runs the Linux box through WSL2', revokedAt: '2026-10-01T00:00:00.000Z' };

    expect(mergeRevocations([original], [restated])).toEqual([{ ...restated, revokedAt }]);
  });
});
