/** Native Gate 5 proof for Result viewer handoff, Data reuse, and the no-code preset. */
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
  reloadLiatirApp,
} from '../support/liatir-app.mjs';

const RUN_ID = 'e2e-single-cell-lighthouse-result';
const PRESET_ID = 'single-cell-embedding-viewer-v1';

/**
 * Seed a file inside a run's directory.
 *
 * Run directories are data-scope, not app storage: they hold the files a run produced, which native
 * tools write by absolute path. Only the history index that points at them lives in app storage.
 */
async function writeRunJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_fs_write_text', {
      rel: file,
      contents: JSON.stringify(content, null, 2),
      permanent: true,
      createDirs: true,
    });
  }, rel, value);
}

async function writeWorkspaceJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_app_write_text', {
      rel: file,
      content: JSON.stringify(content, null, 2),
      createDirs: true,
    });
  }, rel, value);
}

function scientificMetadata(identity, inputIdentity, previewPath) {
  return {
    schemaVersion: 1,
    physical: {
      artifactId: `sha256:${identity.sha256}`,
      sizeBytes: identity.sizeBytes,
      digest: { algorithm: 'sha256', value: identity.sha256 },
      mediaType: 'application/x-hdf5',
      format: { id: 'anndata-h5ad', container: 'hdf5' },
    },
    profile: { id: 'org.liatir.scientific.anndata', version: '1.0.0' },
    scientificType: 'annotated-matrix',
    qualifiers: {
      organism: { taxonId: '9606', name: 'Homo sapiens' },
      modality: 'single-cell-rna',
      featureNamespace: 'gene-symbol',
      preprocessing: ['raw-counts'],
      matrix: { location: 'X', observations: 3, variables: 4 },
      representations: ['expression', 'embedding'],
      embeddingKeys: ['X_lighthouse'],
    },
    validation: {
      profile: { id: 'org.liatir.scientific.anndata', version: '1.0.0' },
      status: 'valid',
      validator: { id: 'org.liatir.validator.anndata', version: '1.0.0' },
      validatedAt: '2026-08-13T12:00:00.000Z',
      diagnostics: [],
    },
    lineage: {
      sources: [{
        artifactId: `sha256:${inputIdentity.sha256}`,
        digest: { algorithm: 'sha256', value: inputIdentity.sha256 },
        role: 'input',
        fieldKey: 'inputFile',
      }],
      transformation: {
        id: 'ai-single-cell-embedding',
        label: 'Single-cell Embedding',
        version: '1',
        sourceRevision: 'gate-5-fixture',
        parameters: { modelId: 'gate-5-fixture', embeddingKey: 'X_lighthouse' },
      },
    },
    viewerHints: {
      preferredViewer: 'single-cell',
      embeddingKey: 'X_lighthouse',
      embeddingPreviewPath: previewPath,
      embeddingDimensions: 2,
      projection: 'bounded-preview-pca',
    },
    mutationPolicy: 'immutable-source',
  };
}

export const tests = [{
  name: 'opens embedded AnnData, reuses it from Data, and creates the lighthouse preset',
  async run({ browser, expect, artifactsDir }) {
    await openSandboxWorkspace(browser);
    const fixtureDir = path.join(artifactsDir, 'reports', 'single-cell-lighthouse-e2e');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const signature = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    const inputPath = path.join(fixtureDir, 'input.h5ad');
    const embeddedPath = path.join(fixtureDir, 'embedded.h5ad');
    const previewPath = path.join(fixtureDir, 'embedding-preview.csv');
    fs.writeFileSync(inputPath, Buffer.concat([signature, Buffer.from('gate-5-input')]));
    fs.writeFileSync(embeddedPath, Buffer.concat([signature, Buffer.from('gate-5-embedded')]));
    fs.writeFileSync(previewPath, [
      'cell_id,preview_pc_1,preview_pc_2,dim_0,dim_1',
      'cell-a,-0.4,0.2,0.01,0.02',
      'cell-b,0.1,0.7,0.03,0.04',
      'cell-c,0.8,-0.5,0.05,0.06',
    ].join('\n'));

    const [inputIdentity, embeddedIdentity, previewSize] = await browser.execute(
      async (input, embedded, preview) => Promise.all([
        window.Liatir.invoke('lia_file_identity', { path: input }),
        window.Liatir.invoke('lia_file_identity', { path: embedded }),
        window.Liatir.invoke('lia_file_size', { path: preview }),
      ]),
      inputPath,
      embeddedPath,
      previewPath,
    );
    const scientific = scientificMetadata(embeddedIdentity, inputIdentity, previewPath);
    const outputFiles = [
      {
        label: 'Embedded AnnData',
        path: embeddedPath,
        ext: 'h5ad',
        size: embeddedIdentity.sizeBytes,
        role: 'final',
        fieldKey: 'embeddedAnnData',
        scientific,
      },
      {
        label: 'Embedding preview CSV',
        path: previewPath,
        ext: 'csv',
        size: previewSize,
        role: 'final',
        fieldKey: 'embeddingPreviewCsv',
      },
    ];
    await writeWorkspaceJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: 'gate-5-input',
        name: 'input.h5ad',
        path: inputPath,
        ext: 'h5ad',
        size: inputIdentity.sizeBytes,
        addedAt: Date.now(),
        folder: '',
      }],
      folders: [],
    });
    await writeWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json', [{
      id: RUN_ID,
      tool: 'ai-single-cell-embedding',
      label: 'Single-cell lighthouse',
      inputs: [inputPath],
      outputFiles,
      params: { modelId: 'gate-5-fixture' },
      status: 'done',
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      durationMs: 100,
      error: null,
    }]);
    await writeRunJson(browser, `workspaces/__test__/runs/${RUN_ID}/result.json`, {
      sections: [{
        type: 'single-cell-viewer',
        label: 'Lighthouse embeddings',
        description: 'Bounded single-cell embedding preview.',
        config: {
          title: 'Lighthouse embeddings',
          source: embeddedPath,
          previewCsv: previewPath,
          embeddingKey: 'X_lighthouse',
          cellCount: 3,
          embeddingDim: 2,
          artifactId: scientific.physical.artifactId,
          validationStatus: 'valid',
          projection: 'bounded-preview-pca',
          embeddingPoints: [
            { cellId: 'cell-a', x: -0.4, y: 0.2 },
            { cellId: 'cell-b', x: 0.1, y: 0.7 },
            { cellId: 'cell-c', x: 0.8, y: -0.5 },
          ],
        },
        height: 360,
      }],
    });

    await reloadLiatirApp(browser);
    await openSandboxWorkspace(browser);
    await navigateInApp(browser, `/results?run=${RUN_ID}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('[data-testid="single-cell-point"]').length === 3),
      { timeout: 20_000, timeoutMsg: 'The Result did not render the embedding preview' },
    );
    expect(await (await browser.$('body')).getText()).toContain('X_lighthouse');

    await (await browser.$('[data-testid="add-output-to-data-embeddedAnnData"]')).click();
    await (await browser.$('[data-testid="add-output-to-data-embeddingPreviewCsv"]')).click();
    await browser.waitUntil(
      async () => browser.execute(async (embedded) => {
        const raw = await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/data-files.json' });
        const files = JSON.parse(raw).files ?? [];
        const file = files.find((candidate) => candidate.path === embedded);
        return file?.scientific?.validation?.status === 'valid';
      }, embeddedPath),
      { timeout: 20_000, timeoutMsg: 'The embedded AnnData artifact was not reusable from Data' },
    );

    await (await browser.$('[data-testid="viewer-fullscreen"]')).click();
    await browser.waitUntil(
      async () => browser.execute(() => (
        document.querySelector('[data-testid="visualization-shell"]')?.getAttribute('data-expanded') === 'true'
        && document.querySelectorAll('[data-testid="single-cell-point"]').length === 3
      )),
      { timeout: 20_000, timeoutMsg: 'The Result preview did not expand with its three cells' },
    );
    await (await browser.$('[data-testid="viewer-fullscreen"]')).click();
    await browser.waitUntil(
      async () => browser.execute(() => (
        document.querySelector('[data-testid="visualization-shell"]')?.getAttribute('data-expanded') === 'false'
        && document.body.style.overflow !== 'hidden'
      )),
      { timeout: 20_000, timeoutMsg: 'Closing the Result preview did not restore page scrolling' },
    );
    // The Result offers fullscreen; test the existing standalone route using the
    // two artifacts just registered in Data, rather than a retired header button.
    await navigateInApp(browser, `/tools/visualization/single-cell?file=${encodeURIComponent(embeddedPath)}&preview=${encodeURIComponent(previewPath)}&embeddingKey=X_lighthouse`);
    await browser.waitUntil(
      async () => browser.execute(() => window.location.pathname === '/tools/visualization/single-cell'),
      { timeout: 20_000, timeoutMsg: 'The standalone Single-cell Viewer did not open' },
    );
    await browser.waitUntil(
      async () => browser.execute(() => document.querySelectorAll('[data-testid="single-cell-point"]').length === 3),
      { timeout: 20_000, timeoutMsg: 'The standalone viewer did not reuse the embedding preview' },
    );

    await navigateInApp(browser, '/pipelines');
    const presetSelector = `[data-testid="pipeline-preset-card"][data-preset-id="${PRESET_ID}"]`;
    await (await browser.$(presetSelector)).waitForDisplayed({ timeout: 20_000 });
    await (await browser.$(`${presetSelector} button`)).click();
    await browser.waitUntil(
      async () => browser.execute(() => window.location.pathname === '/pipeline'),
      { timeout: 20_000, timeoutMsg: 'The no-code preset did not open in the pipeline editor' },
    );
    await browser.waitUntil(
      async () => browser.execute(() => (
        document.querySelectorAll('[data-testid="pipeline-tool-node"]').length === 2
      )),
      { timeout: 20_000, timeoutMsg: 'The no-code preset did not create both scientific steps' },
    );
    expect(await browser.execute(() => Array.from(
      document.querySelectorAll('[data-testid="pipeline-tool-node"]'),
      (node) => node.getAttribute('data-step-id'),
    ).sort())).toEqual(['ai-single-cell-embedding', 'viewer-single-cell']);
    const persistedPreset = await browser.execute(async () => {
      const raw = await window.Liatir.invoke('lia_app_read_text', { rel: 'workspaces/__test__/pipeline-workspace.json' });
      const workspace = JSON.parse(raw);
      const pipeline = workspace.saved.find((candidate) => candidate.name.startsWith('Single-cell embedding and preview'));
      const viewer = pipeline.nodes.find((node) => node.data?.stepId === 'viewer-single-cell');
      return { edges: pipeline.edges.length, inputs: viewer.data.inputs };
    });
    expect(persistedPreset).toMatchObject({
      edges: 1,
      inputs: {
        inputFile: expect.stringMatching(/^@pipe:.*:embeddedAnnData$/),
        previewFile: expect.stringMatching(/^@pipe:.*:embeddingPreviewCsv$/),
      },
    });
    await expectNoVisibleRuntimeError(browser);
  },
}];
