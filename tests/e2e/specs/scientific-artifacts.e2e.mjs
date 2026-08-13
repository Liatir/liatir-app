/** Native Gate 4 evidence for physical identity and versioned AnnData metadata in Data and Results. */
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const RUN_ID = 'e2e-scientific-artifact-result';

function scientificMetadata(identity, inspection, extras = {}) {
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
    qualifiers: inspection,
    validation: {
      profile: { id: 'org.liatir.scientific.anndata', version: '1.0.0' },
      status: 'valid',
      validator: { id: 'org.liatir.validator.anndata', version: '1.0.0' },
      validatedAt: '2026-08-13T10:00:00.000Z',
      diagnostics: [],
    },
    mutationPolicy: 'immutable-source',
    ...extras,
  };
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

export const tests = [{
  name: 'keeps AnnData digest, profile, validation and lineage visible across Data and Results',
  async run({ browser, expect, artifactsDir }) {
    await openSandboxWorkspace(browser);
    const fixtureDir = path.join(artifactsDir, 'reports', 'scientific-artifact-e2e');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const inputPath = path.join(fixtureDir, 'cells.h5ad');
    const outputPath = path.join(fixtureDir, 'cells-embedded.h5ad');
    const hdf5Signature = Buffer.from([0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a]);
    fs.writeFileSync(inputPath, Buffer.concat([hdf5Signature, Buffer.from('gate-4-input')]));
    fs.writeFileSync(outputPath, Buffer.concat([hdf5Signature, Buffer.from('gate-4-output')]));

    const [inputIdentity, outputIdentity] = await browser.execute(async (input, output) => Promise.all([
      window.Liatir.invoke('lia_file_identity', { path: input }),
      window.Liatir.invoke('lia_file_identity', { path: output }),
    ]), inputPath, outputPath);

    expect(inputIdentity).toEqual({
      sizeBytes: fs.statSync(inputPath).size,
      sha256: createHash('sha256').update(fs.readFileSync(inputPath)).digest('hex'),
      prefixHex: '894844460d0a1a0a',
    });
    expect(outputIdentity.sha256).not.toBe(inputIdentity.sha256);

    const commonQualifiers = {
      organism: { taxonId: '9606', name: 'Homo sapiens' },
      modality: 'single-cell-rna',
      featureNamespace: 'gene-symbol',
      preprocessing: ['raw-counts'],
      matrix: { location: 'X', observations: 2, variables: 3 },
      representations: ['expression'],
    };
    const inputScientific = scientificMetadata(inputIdentity, commonQualifiers);
    const outputScientific = scientificMetadata(
      outputIdentity,
      {
        ...commonQualifiers,
        representations: ['expression', 'embedding'],
        embeddingKeys: ['X_gate4'],
      },
      {
        lineage: {
          sources: [{
            artifactId: inputScientific.physical.artifactId,
            digest: inputScientific.physical.digest,
            role: 'input',
            fieldKey: 'inputFile',
          }],
          transformation: {
            id: 'ai-single-cell-embedding',
            label: 'Single-cell Embedding',
            version: '1',
            parameters: { modelId: 'gate-4-fixture' },
          },
        },
        viewerHints: { preferredViewer: 'single-cell', embeddingKey: 'X_gate4' },
      },
    );

    await writeWorkspaceJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: 'gate-4-input',
        name: 'cells.h5ad',
        path: inputPath,
        ext: 'h5ad',
        size: inputIdentity.sizeBytes,
        addedAt: Date.now(),
        folder: '',
        scientific: inputScientific,
      }],
      folders: [],
    });
    const run = {
      id: RUN_ID,
      tool: 'ai-single-cell-embedding',
      label: 'Gate 4 AnnData',
      inputs: [inputPath],
      outputFiles: [{
        label: 'Embedded AnnData',
        path: outputPath,
        ext: 'h5ad',
        size: outputIdentity.sizeBytes,
        role: 'final',
        fieldKey: 'embeddedAnnData',
        scientific: outputScientific,
      }],
      params: { modelId: 'gate-4-fixture' },
      status: 'done',
      startedAt: Date.now() - 100,
      endedAt: Date.now(),
      durationMs: 100,
      error: null,
    };
    await writeWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json', [run]);
    await writeWorkspaceJson(browser, `workspaces/__test__/analysis-runs/${RUN_ID}.json`, { sections: [] });

    await browser.execute(() => window.location.reload());
    await waitForLiatirBridge(browser);
    await openSandboxWorkspace(browser);

    await navigateSidebar(browser, '/data');
    await browser.waitUntil(
      async () => (await (await browser.$('body')).getText()).includes('anndata 1.0.0 · validated'),
      { timeout: 20_000, timeoutMsg: 'AnnData profile was not visible in Data' },
    );

    await navigateSidebar(browser, '/results');
    const resultSelector = `[data-testid="result-run"][data-run-id="${RUN_ID}"]`;
    const result = await browser.$(resultSelector);
    await result.waitForDisplayed({ timeout: 20_000 });
    await (await browser.$(`${resultSelector} [data-testid="result-run-open"]`)).click();
    await browser.waitUntil(
      async () => (await (await browser.$('body')).getText()).includes(`sha256:${outputIdentity.sha256.slice(0, 12)}`),
      { timeout: 20_000, timeoutMsg: 'Artifact digest was not visible in Results' },
    );
    const bodyText = await (await browser.$('body')).getText();
    expect(bodyText).toContain('from 1 source via Single-cell Embedding');
    expect(bodyText).toContain('annotated-matrix');
    await expectNoVisibleRuntimeError(browser);
  },
}];
