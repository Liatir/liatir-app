import { beforeEach, describe, expect, it, vi } from 'vitest';
import { validateLiatirAnnDataArtifact } from '@liatir/core';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const harness = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  texts: new Map<string, string>(),
  identities: new Map<string, { sizeBytes: number; sha256: string; prefixHex: string }>(),
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({
    invoke: vi.fn(async (command: string, payload?: { path?: string }) => {
      const path = payload?.path ?? '';
      if (command === 'lia_file_identity') return harness.identities.get(path);
      if (command === 'lia_file_size') return harness.identities.get(path)?.sizeBytes ?? 0;
      if (command === 'lia_read_file_text') {
        if (!harness.texts.has(path)) throw new Error(`Missing fixture: ${path}`);
        return harness.texts.get(path);
      }
      return null;
    }),
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
const {
  embeddingPointsFromCsv,
  runSingleCellViewerStep,
  singleCellViewerDefinition,
} = await import('../../frontend/src/lib/tools/viewers/scientific-viewers');
const {
  SINGLE_CELL_LIGHTHOUSE_PRESET_ID,
  singleCellLighthousePreset,
} = await import('../../frontend/src/lib/pipeline/presets');

function embeddedMetadata(modality = 'single-cell-rna') {
  return validateLiatirAnnDataArtifact({
    sizeBytes: 200,
    sha256: 'b'.repeat(64),
    validatedAt: '2026-08-13T12:00:00.000Z',
    inspection: {
      hdf5Signature: true,
      observations: 3,
      variables: 4,
      matrixLocation: 'X',
      matrixPresent: true,
      finiteValues: true,
      nonNegativeValues: true,
      integerLikeValues: true,
      scientificType: 'annotated-matrix',
      organism: { taxonId: '9606', name: 'Homo sapiens' },
      modality,
      featureNamespace: 'gene-symbol',
      preprocessing: ['raw-counts'],
      representations: ['expression', 'embedding'],
      embeddingKeys: ['X_scGPT'],
    },
    viewerHints: {
      preferredViewer: 'single-cell',
      embeddingKey: 'X_scGPT',
      embeddingPreviewPath: '/results/preview.csv',
    },
  });
}

describe.sequential('Gate 5 single-cell lighthouse', () => {
  beforeEach(() => {
    harness.stored.clear();
    harness.texts.clear();
    harness.identities.clear();
    dataFiles.reset();
  });

  it('parses bounded embedding coordinates without treating cell ids as labels', () => {
    const points = embeddingPointsFromCsv([
      'cell_id,dim_0,dim_1,dim_2',
      'cell-a,0.1,0.2,9',
      'cell-b,-1.5,2.5,8',
      'bad,not-a-number,3,7',
    ].join('\n'));
    expect(points).toEqual([
      { cellId: 'cell-a', x: 0.1, y: 0.2 },
      { cellId: 'cell-b', x: -1.5, y: 2.5 },
    ]);
  });

  it('prefers the bounded PCA preview columns while preserving raw dimensions in the CSV', () => {
    expect(embeddingPointsFromCsv([
      'cell_id,preview_pc_1,preview_pc_2,dim_0,dim_1',
      'cell-a,4.2,-1.5,0.01,0.02',
      'cell-b,-2.4,3.1,0.03,0.04',
    ].join('\n'))).toEqual([
      { cellId: 'cell-a', x: 4.2, y: -1.5 },
      { cellId: 'cell-b', x: -2.4, y: 3.1 },
    ]);
  });

  it('does not turn blank bounded-PCA cells into artificial zero-valued points', () => {
    expect(embeddingPointsFromCsv([
      'cell_id,preview_pc_1,preview_pc_2,dim_0,dim_1',
      'cell-a,4.2,-1.5,0.01,0.02',
      'cell-outside-bound,,,0.03,0.04',
    ].join('\n'))).toEqual([
      { cellId: 'cell-a', x: 4.2, y: -1.5 },
    ]);
  });

  it('opens a validated embedded AnnData artifact with its reusable preview and identity', async () => {
    harness.identities.set('/results/embedded.h5ad', {
      sizeBytes: 200,
      sha256: 'b'.repeat(64),
      prefixHex: '894844460d0a1a0a',
    });
    harness.identities.set('/results/preview.csv', {
      sizeBytes: 60,
      sha256: 'c'.repeat(64),
      prefixHex: '63656c6c5f69642c',
    });
    harness.texts.set('/results/preview.csv', [
      'cell_id,dim_0,dim_1',
      'cell-a,0.1,0.2',
      'cell-b,0.3,0.4',
      'cell-c,0.5,0.6',
    ].join('\n'));
    await dataFiles.add('/results/embedded.h5ad', 'Results', embeddedMetadata());

    const result = await runSingleCellViewerStep(
      { inputFile: '/results/embedded.h5ad', previewFile: '/results/preview.csv' },
      '',
      () => {},
    );
    const section = result.output.sections[0];
    expect(section.type).toBe('single-cell-viewer');
    if (section.type !== 'single-cell-viewer') throw new Error('Unexpected viewer section');
    expect(section.config).toMatchObject({
      source: '/results/embedded.h5ad',
      previewCsv: '/results/preview.csv',
      embeddingKey: 'X_scGPT',
      cellCount: 3,
      artifactId: `sha256:${'b'.repeat(64)}`,
      validationStatus: 'valid',
      embeddingPoints: [
        { cellId: 'cell-a', x: 0.1, y: 0.2 },
        { cellId: 'cell-b', x: 0.3, y: 0.4 },
        { cellId: 'cell-c', x: 0.5, y: 0.6 },
      ],
    });
    expect(result.values.report).toMatchObject({
      previewPointCount: 3,
      embeddingKey: 'X_scGPT',
      validationStatus: 'valid',
    });
  });

  it('rejects a known modality mismatch before rendering', async () => {
    harness.identities.set('/results/bulk.h5ad', {
      sizeBytes: 200,
      sha256: 'b'.repeat(64),
      prefixHex: '894844460d0a1a0a',
    });
    await dataFiles.add('/results/bulk.h5ad', 'Results', embeddedMetadata('bulk-rna'));
    await expect(runSingleCellViewerStep(
      { inputFile: '/results/bulk.h5ad' },
      '',
      () => {},
    )).rejects.toThrow(/modality/i);
  });

  it('instantiates the no-code preset with a typed AnnData and preview handoff', () => {
    const ids = ['embedding-node', 'viewer-node', 'note-node', 'edge'];
    const graph = singleCellLighthousePreset.instantiate(() => ids.shift()!);
    const embedding = graph.nodes.find(node => node.id === 'embedding-node');
    const viewer = graph.nodes.find(node => node.id === 'viewer-node');

    expect(singleCellLighthousePreset.id).toBe(SINGLE_CELL_LIGHTHOUSE_PRESET_ID);
    expect(embedding?.data).toMatchObject({
      stepId: 'ai-single-cell-embedding',
      inputs: { modelId: '', inputFile: '', species: 'human', batchSize: '25', maxCsvRows: '500' },
    });
    expect(viewer?.data).toMatchObject({
      stepId: 'viewer-single-cell',
      inputs: {
        inputFile: '@pipe:embedding-node:embeddedAnnData',
        previewFile: '@pipe:embedding-node:embeddingPreviewCsv',
      },
    });
    expect(graph.edges).toEqual([expect.objectContaining({
      id: 'edge',
      source: 'embedding-node',
      target: 'viewer-node',
    })]);
    expect(singleCellViewerDefinition.inputSchema.inputFile.artifact).toMatchObject({
      formats: ['anndata-h5ad'],
      qualifiers: { modalities: ['single-cell-rna'] },
    });
  });
});
