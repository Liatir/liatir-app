import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  SOURCE_MIRROR_SPECS,
  multipartPartRanges,
  parseHttpByteRange,
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
      schemaVersion: 2,
      kind: 'liatir.runtime-box.release',
      boxId: 'geneformer-v1-10m',
      version: '1.0.0-beta.1',
      target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
    }, identity!)).toBe(true);
    expect(validateImmutableReleaseRoute({
      schemaVersion: 2,
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
