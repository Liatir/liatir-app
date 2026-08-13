import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLiatirAnnDataArtifact } from '@liatir/core';

const harness = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  identities: new Map<string, { sizeBytes: number; sha256: string; prefixHex: string }>(),
  pickedPath: '' as string,
}));

vi.stubGlobal('$state', <T>(value: T) => value);

vi.mock('$lib/api', () => ({
  liatir: () => ({
    invoke: vi.fn(async (command: string, payload?: { path?: string }) => {
      if (command === 'lia_file_identity') return harness.identities.get(payload?.path ?? '');
      if (command === 'lia_file_size') return harness.identities.get(payload?.path ?? '')?.sizeBytes ?? 0;
      return null;
    }),
    desktop: {
      files: {
        open: vi.fn(async () => ({ paths: harness.pickedPath ? [harness.pickedPath] : [] })),
      },
    },
  }),
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  SANDBOX_WORKSPACE_ID: 'sandbox',
  getDataPrefix: () => 'workspaces/workspace-a/',
}));

vi.mock('$lib/stores/app-storage', () => ({
  appStorage: {
    writeText: vi.fn(async (path: string, content: string) => harness.stored.set(path, content)),
    readText: vi.fn(async (path: string) => harness.stored.get(path) ?? ''),
    exists: vi.fn(async (path: string) => harness.stored.has(path)),
  },
}));

const { dataFiles } = await import('../../frontend/src/lib/stores/dataFiles.svelte');

const hdf5 = '894844460d0a1a0a';

describe.sequential('scientific artifact persistence in Data', () => {
  beforeEach(() => {
    harness.stored.clear();
    harness.identities.clear();
    harness.pickedPath = '';
    dataFiles.reset();
  });

  it('profiles imported AnnData without breaking legacy Data records', async () => {
    harness.identities.set('/data/cells.h5ad', {
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
      prefixHex: hdf5,
    });

    await dataFiles.add('/data/cells.h5ad');
    expect(dataFiles.files[0]).toMatchObject({
      path: '/data/cells.h5ad',
      ext: 'h5ad',
      scientific: {
        schemaVersion: 1,
        physical: { artifactId: `sha256:${'a'.repeat(64)}` },
        validation: { status: 'partial' },
      },
    });

    dataFiles.reset();
    await dataFiles.init();
    expect(dataFiles.files[0]?.scientific?.physical.digest.value).toBe('a'.repeat(64));
  });

  it('invalidates stale semantic metadata when the file content identity changes', async () => {
    harness.identities.set('/data/cells.h5ad', {
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
      prefixHex: hdf5,
    });
    await dataFiles.add('/data/cells.h5ad');
    const valid = validateLiatirAnnDataArtifact({
      sizeBytes: 42,
      sha256: 'a'.repeat(64),
      validatedAt: '2026-08-13T10:00:00.000Z',
      inspection: {
        hdf5Signature: true,
        observations: 2,
        variables: 3,
        matrixLocation: 'X',
        matrixPresent: true,
        finiteValues: true,
        nonNegativeValues: true,
        scientificType: 'annotated-matrix',
        modality: 'single-cell-rna',
        featureNamespace: 'gene-symbol',
        preprocessing: ['raw-counts'],
      },
    });
    await dataFiles.setScientific('/data/cells.h5ad', valid);

    harness.identities.set('/data/cells.h5ad', {
      sizeBytes: 43,
      sha256: 'b'.repeat(64),
      prefixHex: hdf5,
    });
    const refreshed = await dataFiles.ensureAnnDataProfile('/data/cells.h5ad', true);

    expect(refreshed?.physical.artifactId).toBe(`sha256:${'b'.repeat(64)}`);
    expect(refreshed?.validation.status).toBe('partial');
    expect(refreshed?.qualifiers.featureNamespace).toBeUndefined();
  });

  it('preserves deep metadata when relocating to identical content', async () => {
    const identity = { sizeBytes: 42, sha256: 'a'.repeat(64), prefixHex: hdf5 };
    harness.identities.set('/old/cells.h5ad', identity);
    harness.identities.set('/new/cells.h5ad', identity);
    await dataFiles.add('/old/cells.h5ad');
    const original = dataFiles.files[0]?.scientific;
    harness.pickedPath = '/new/cells.h5ad';

    await dataFiles.relocate(dataFiles.files[0].id);

    expect(dataFiles.files[0]?.path).toBe('/new/cells.h5ad');
    expect(dataFiles.files[0]?.scientific).toEqual(original);
  });
});
