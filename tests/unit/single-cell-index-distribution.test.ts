import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

import { loadRecipe } from '../../scripts/single-cell-indexes.mjs';
import {
  isReferenceIndexCatalog,
  parseReferenceIndexArchiveIdentity,
} from '../../workers/runtime-box-registry/src/index';

const policy = JSON.parse(await readFile(
  new URL('../../services/runtime-box-signer/policy.json', import.meta.url),
  'utf8',
));

describe('single-cell reference-index distribution', () => {
  it('binds the tracked recipe to the exact production signing approval', async () => {
    const { recipe, recipeSha256 } = await loadRecipe('human-grch38-gencode-v47-si-r91');
    const approved = policy.referenceIndexes.find((entry: { id: string }) => entry.id === recipe.id);

    expect(approved).toMatchObject({
      version: recipe.version,
      recipeSha256,
      taxonId: recipe.species.taxonId,
      assembly: recipe.genome.assembly,
      annotationRelease: recipe.annotation.release,
      readLength: recipe.readLength,
      genomeUrl: recipe.genome.source.url,
      genomeChecksum: recipe.genome.source.checksum.value,
      annotationUrl: recipe.annotation.source.url,
      annotationChecksum: recipe.annotation.source.checksum.value,
    });
  });

  it('derives one traversal-safe, content-addressed R2 key', () => {
    const sha256 = 'a'.repeat(64);
    expect(parseReferenceIndexArchiveIdentity(
      'human-grch38-gencode-v47-si-r91', '1.0.0', sha256,
    )).toEqual({
      indexId: 'human-grch38-gencode-v47-si-r91',
      version: '1.0.0',
      sha256,
      key: `reference-indexes/human-grch38-gencode-v47-si-r91/1.0.0/${sha256}.zip`,
    });
    expect(parseReferenceIndexArchiveIdentity('../human', '1.0.0', sha256)).toBeNull();
    expect(parseReferenceIndexArchiveIdentity('human', '1/0/0', sha256)).toBeNull();
    expect(parseReferenceIndexArchiveIdentity('human', '1.0.0', 'not-a-hash')).toBeNull();
  });

  it('binds every signed catalog archive URL to its immutable R2 identity', () => {
    const sha256 = 'b'.repeat(64);
    const payload = {
      schemaVersion: 2,
      kind: 'liatir.single-cell-index.catalog',
      updatedAt: '2026-08-24T00:00:00.000Z',
      indexes: [{
        id: 'human-grch38-gencode-v47-si-r91',
        version: '1.0.0',
        archive: {
          format: 'zip',
          sha256,
          sizeBytes: 100,
          url: `https://assets.models.liatir.com/ai-runtime-boxes/reference-indexes/human-grch38-gencode-v47-si-r91/1.0.0/${sha256}.zip`,
        },
      }],
    };
    const env = {
      OBJECT_PREFIX: 'ai-runtime-boxes',
      ASSET_ORIGIN: 'https://assets.models.liatir.com',
    } as Env;
    expect(isReferenceIndexCatalog(env, payload)).toBe(true);
    expect(isReferenceIndexCatalog(env, {
      ...payload,
      indexes: [{
        ...payload.indexes[0],
        archive: { ...payload.indexes[0].archive, url: payload.indexes[0].archive.url.replace('/1.0.0/', '/2.0.0/') },
      }],
    })).toBe(false);
    expect(isReferenceIndexCatalog(env, {
      ...payload,
      indexes: [{
        ...payload.indexes[0],
        archive: {
          ...payload.indexes[0].archive,
          url: payload.indexes[0].archive.url.replace('assets.models.liatir.com', 'example.com'),
        },
      }],
    })).toBe(false);
  });

  it('keeps the expensive release manual, protected and verify-before-promote', async () => {
    const workflow = await readFile(
      new URL('../../.github/workflows/single-cell-index-release.yml', import.meta.url),
      'utf8',
    );
    expect(workflow).toContain('workflow_dispatch:');
    expect(workflow).toContain('environment: runtime-box-production');
    expect(workflow.indexOf('verify-signer-policy')).toBeLessThan(workflow.indexOf('Build the index'));
    expect(workflow.indexOf('Reclaim hosted-runner disk'))
      .toBeLessThan(workflow.indexOf('Build the index'));
    expect(workflow).toContain('test "${RUNNER_ENVIRONMENT}" = "github-hosted"');
    expect(workflow).toContain('test "${available_bytes}" -ge 40000000000');
    expect(workflow.indexOf('Mint a fresh signer identity after the long build'))
      .toBeLessThan(workflow.indexOf('Publish immutable bytes'));
    expect(workflow).not.toContain('wrangler r2 object put');
  });
});
