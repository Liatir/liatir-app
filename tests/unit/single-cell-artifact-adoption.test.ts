import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiatirAIModelRecord } from '@liatir/core';
import { installSvelteRuneStubs } from './support/svelte-runes';

installSvelteRuneStubs();

const harness = vi.hoisted(() => ({
  stored: new Map<string, string>(),
  identities: new Map<string, { sizeBytes: number; sha256: string; prefixHex: string }>(),
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({
    invoke: vi.fn(async (command: string, payload?: { path?: string }) => {
      if (command === 'lia_file_identity') return harness.identities.get(payload?.path ?? '');
      if (command === 'lia_file_size') return harness.identities.get(payload?.path ?? '')?.sizeBytes ?? 0;
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
  finalizeSingleCellEmbeddingResult,
  singleCellAnnDataRequirement,
  singleCellEmbeddingDefinition,
} = await import('../../frontend/src/lib/tools/ai/single-cell-embedding');
const {
  GENEFORMER_V1_10M_MODEL_ID,
  SCGPT_WHOLE_HUMAN_MODEL_ID,
} = await import('../../frontend/src/lib/ai/model-registry');

const hdf5 = '894844460d0a1a0a';

describe.sequential('AnnData adoption by Single-cell Embedding', () => {
  beforeEach(() => {
    harness.stored.clear();
    harness.identities.clear();
    dataFiles.reset();
  });

  it('declares versioned AnnData input and output semantics', () => {
    expect(singleCellEmbeddingDefinition.inputSchema.inputFile.artifact).toMatchObject({
      formats: ['anndata-h5ad'],
      scientificTypes: ['annotated-matrix'],
      validation: 'valid-or-partial',
    });
    expect(singleCellEmbeddingDefinition.outputSchema.embeddedAnnData.artifact).toMatchObject({
      format: 'anndata-h5ad',
      scientificType: 'annotated-matrix',
      qualifiers: { representations: ['expression', 'embedding'] },
    });
    expect(singleCellAnnDataRequirement(GENEFORMER_V1_10M_MODEL_ID, 'human').qualifiers).toMatchObject({
      taxonIds: ['9606'],
      featureNamespaces: ['ensembl-gene-id'],
    });
    expect(singleCellAnnDataRequirement(SCGPT_WHOLE_HUMAN_MODEL_ID, 'human').qualifiers).toMatchObject({
      taxonIds: ['9606'],
      featureNamespaces: ['gene-symbol'],
    });
  });

  it('emits a valid immutable output with digest, lineage and viewer hint', async () => {
    harness.identities.set('/data/input.h5ad', {
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      prefixHex: hdf5,
    });
    harness.identities.set('/results/input_geneformer_adata.h5ad', {
      sizeBytes: 200,
      sha256: 'b'.repeat(64),
      prefixHex: hdf5,
    });
    harness.identities.set('/results/preview.csv', { sizeBytes: 20, sha256: 'c'.repeat(64), prefixHex: '63656c6c' });
    harness.identities.set('/results/summary.json', { sizeBytes: 30, sha256: 'd'.repeat(64), prefixHex: '7b226365' });
    await dataFiles.add('/data/input.h5ad');

    const model = {
      id: GENEFORMER_V1_10M_MODEL_ID,
      name: 'Geneformer V1 10M',
      version: '1.0.0',
      runtime: { kind: 'python-venv', name: 'Python', version: '3.11' },
      localOnly: true,
      install: { revision: 'abc123' },
    } as unknown as LiatirAIModelRecord;
    const stdout = JSON.stringify({
      embeddedAnnDataPath: '/results/input_geneformer_adata.h5ad',
      embeddingPreviewPath: '/results/preview.csv',
      summaryPath: '/results/summary.json',
      intermediatePaths: [],
      summary: {
        cellCount: 2,
        geneCount: 3,
        outputGeneCount: 4,
        inputCellCount: 2,
        inputGeneCount: 4,
        embeddingDim: 8,
        embeddingKey: 'X_geneformer',
        model: 'Geneformer V1 10M',
        species: 'human',
        batchSize: 2,
        previewRows: 2,
        intermediateCount: 0,
        warnings: [],
      },
      preview: [[0.1, 0.2]],
    });

    const result = await finalizeSingleCellEmbeddingResult(
      model,
      { inputFile: '/data/input.h5ad', modelId: model.id, species: 'human' },
      { ok: true, exitCode: 0, stdout, stderr: '', durationMs: 1 },
      () => {},
    );
    const embedded = result.outputFiles.find(file => file.fieldKey === 'embeddedAnnData');
		const viewer = result.output.sections.find(section => section.type === 'single-cell-viewer');

    expect(dataFiles.files[0]?.scientific?.validation.status).toBe('valid');
    expect(embedded?.scientific).toMatchObject({
      schemaVersion: 1,
      physical: { artifactId: `sha256:${'b'.repeat(64)}` },
      validation: { status: 'valid' },
      qualifiers: {
        organism: { taxonId: '9606' },
        modality: 'single-cell-rna',
        featureNamespace: 'ensembl-gene-id',
        representations: ['expression', 'embedding'],
        embeddingKeys: ['X_geneformer'],
        matrix: { observations: 2, variables: 4 },
      },
      mutationPolicy: 'immutable-source',
      viewerHints: {
        preferredViewer: 'single-cell',
        embeddingKey: 'X_geneformer',
        embeddingPreviewPath: '/results/preview.csv',
        embeddingDimensions: 8,
      },
      lineage: {
        sources: [{ artifactId: `sha256:${'a'.repeat(64)}`, role: 'input', fieldKey: 'inputFile' }],
        transformation: { id: 'ai-single-cell-embedding', sourceRevision: 'abc123' },
      },
    });
		expect(viewer).toMatchObject({
			type: 'single-cell-viewer',
			config: {
				source: '/results/input_geneformer_adata.h5ad',
				previewCsv: '/results/preview.csv',
				embeddingKey: 'X_geneformer',
				embeddingPoints: [{ cellId: 'cell_1', x: 0.1, y: 0.2 }],
			},
		});
  });

  it('refuses an implementation that overwrites the original AnnData path', async () => {
    harness.identities.set('/data/input.h5ad', {
      sizeBytes: 100,
      sha256: 'a'.repeat(64),
      prefixHex: hdf5,
    });
    await dataFiles.add('/data/input.h5ad');
    const model = {
      id: GENEFORMER_V1_10M_MODEL_ID,
      name: 'Geneformer',
      runtime: { kind: 'python-venv', name: 'Python' },
      localOnly: true,
    } as unknown as LiatirAIModelRecord;

    await expect(finalizeSingleCellEmbeddingResult(
      model,
      { inputFile: '/data/input.h5ad', modelId: model.id, species: 'human' },
      {
        ok: true,
        exitCode: 0,
        stderr: '',
        durationMs: 1,
        stdout: JSON.stringify({
          embeddedAnnDataPath: '/data/input.h5ad',
          embeddingPreviewPath: '/results/preview.csv',
          summaryPath: '/results/summary.json',
          intermediatePaths: [],
          summary: {
            cellCount: 1,
            geneCount: 1,
            inputCellCount: 1,
            inputGeneCount: 1,
            embeddingDim: 1,
            embeddingKey: 'X_geneformer',
            model: 'Geneformer',
            species: 'human',
            batchSize: 1,
            previewRows: 1,
            intermediateCount: 0,
            warnings: [],
          },
          preview: [[0]],
        }),
      },
      () => {},
    )).rejects.toThrow(/cannot be overwritten/i);
  });
});
