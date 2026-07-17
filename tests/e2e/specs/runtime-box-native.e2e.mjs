/**
 * Exercises an installed Runtime Box against real data, in the real app.
 *
 * The assertions are scientific, not mechanical: the box must contain enough supported genes to be usable, and the
 * output must be well-formed. A box that installs cleanly but cannot actually embed a dataset is broken in the way
 * that matters, and only a check like this catches it.
 */
import {
  activateCleanSandbox,
  firstDownloadOffset,
  readEmbeddedPythonScript,
  runtimeBoxInstallError,
  runtimeBoxInstallProgress,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  runtimeBoxTargetForNativeTest,
  startRuntimeBoxInstall,
} from '../support/runtime-box.mjs';
import fs from 'node:fs';
import path from 'node:path';

const BOX_ID = 'geneformer-v1-10m';
const MODEL_ID = 'ctheodoris-geneformer-v1-10m';
const MODEL_NAME = 'Geneformer V1 10M';
const RUNTIME_ID = 'single-cell-foundation-geneformer-v1-10m';
const TOOL_ID = 'ai-single-cell-embedding';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-metal';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.0.0-beta.1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_ACCELERATOR = TARGET_ID === 'linux-x86_64-cpu' ? /^CPU/ : /^Apple Metal/;

const CREATE_FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import pickle
import sys

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp

payload = json.loads(sys.stdin.read() or "{}")
runtime_dir = Path(payload["runtimeDir"])
cache_dir = Path(payload["modelCacheDir"])
dictionary_dir = cache_dir / "dictionaries"
with (dictionary_dir / "token_dictionary_gc30M.pkl").open("rb") as fh:
    tokens = pickle.load(fh)
with (dictionary_dir / "gene_median_dictionary_gc30M.pkl").open("rb") as fh:
    medians = pickle.load(fh)

genes = sorted(
    gene for gene in tokens
    if gene.startswith("ENSG") and gene in medians and float(medians[gene]) > 0
)[:128]
if len(genes) < 128:
    raise SystemExit("The production box does not contain enough supported Geneformer genes.")

counts = np.asarray([
    [((gene_index * 17 + cell_index * 29) % 97) + 1 for gene_index in range(len(genes))]
    for cell_index in range(4)
], dtype=np.int32)
obs = pd.DataFrame(
    {
        "n_counts": counts.sum(axis=1),
        "filter_pass": np.ones(counts.shape[0], dtype=np.int8),
    },
    index=[f"cell-{index + 1}" for index in range(counts.shape[0])],
)
var = pd.DataFrame({"ensembl_id": genes}, index=genes)
adata = anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var)
validation_dir = Path(payload["validationDir"])
validation_dir.mkdir(parents=True, exist_ok=True)
input_path = validation_dir / "geneformer-parity-input.h5ad"
adata.write_h5ad(input_path)
print(json.dumps({"inputPath": str(input_path), "cellCount": 4, "geneCount": len(genes)}))
`;

const MARKER_SCRIPT = String.raw`
import json
from pathlib import Path
import sys

payload = json.loads(sys.stdin.read() or "{}")
marker = Path(payload["path"])
if payload.get("write"):
    marker.parent.mkdir(parents=True, exist_ok=True)
    marker.write_text(payload.get("contents", "rollback-marker"), encoding="utf-8")
print(json.dumps({"exists": marker.is_file(), "contents": marker.read_text(encoding="utf-8") if marker.is_file() else None}))
`;

async function startInstall(browser, downloadId, options = {}) {
  return startRuntimeBoxInstall(browser, {
    boxId: BOX_ID,
    modelId: MODEL_ID,
    channel: 'beta',
    registryBaseUrl: REGISTRY_BASE_URL,
    targetCandidates: runtimeBoxTargetForNativeTest(TARGET_ID, 8),
    downloadId,
  }, options);
}

async function runPython(browser, script, inputJson) {
  return browser.execute(
    async (input) => window.Liatir.invoke('lia_ai_python_run', input),
    {
      runtimeId: RUNTIME_ID,
      script,
      args: [],
      inputJson,
      timeoutSeconds: 600,
    },
  );
}

async function navigate(browser, pathname) {
  await browser.execute((destination) => {
    window.location.href = destination;
    return true;
  }, pathname);
  await (await browser.$('[data-testid="sidebar-nav-item"]')).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: `Liatir did not finish navigating to ${pathname}`,
  });
}

function section(output, type, label = null) {
  return output.sections.find((item) => item.type === type && (label === null || item.label === label));
}

export const tests = [
  {
    name: 'validates install, resume, real Job and Result provenance, replacement, rollback, and cleanup',
    heavy: true,
    async run({ browser, expect, rootDir }) {
      await activateCleanSandbox(browser);
      const storage = await browser.execute(async () => ({
        appPath: await window.Liatir.invoke('lia_app_path'),
        dataPath: await window.Liatir.desktop.fs.data.path(),
      }));
      expect(storage.appPath).toContain('tests/.artifacts/home');
      expect(storage.dataPath).toContain('tests/.artifacts/home');

      const interruptedId = `runtime-box-interrupted-${Date.now()}`;
      await startInstall(browser, interruptedId, { cancelAfterBytes: 1 });
      await browser.waitUntil(
        async () => (await runtimeBoxInstallStatus(browser, interruptedId)) !== 'running',
        { timeout: 60_000, timeoutMsg: 'Interrupted Runtime Box install did not stop' },
      );
      let interruptedProgress = await runtimeBoxInstallProgress(browser, interruptedId);
      const interruptedError = await runtimeBoxInstallError(browser, interruptedId);
      if (!interruptedProgress.cancelRequested) {
        throw new Error(
          `Runtime Box install failed before the first downloadable chunk: ${interruptedError ?? 'unknown error'}`,
        );
      }
      await browser.waitUntil(
        async () => (await runtimeBoxInstallProgress(browser, interruptedId)).cancelAccepted !== null,
        { timeout: 5_000, timeoutMsg: 'Runtime Box cancellation did not return a result' },
      );
      interruptedProgress = await runtimeBoxInstallProgress(browser, interruptedId);
      expect(interruptedProgress.cancelRequested).toBe(true);
      expect(interruptedProgress.cancelAccepted).toBe(true);
      expect(interruptedProgress.maxBytesDownloaded).toBeGreaterThan(0);
      expect(interruptedError).toContain('Download cancelled');

      const resumedId = `runtime-box-resumed-${Date.now()}`;
      await startInstall(browser, resumedId);
      await browser.waitUntil(
        async () => (await runtimeBoxInstallStatus(browser, resumedId)) !== 'running',
        { timeout: 180_000, timeoutMsg: 'Resumed Runtime Box install did not complete' },
      );
      expect(await runtimeBoxInstallStatus(browser, resumedId)).toBe('done');
      const resumed = await runtimeBoxInstallResult(browser, resumedId);
      expect(resumed.version).toBe(VERSION);
      expect(resumed.rollbackAvailable).toBe(false);
      const resumeOffset = await firstDownloadOffset(browser, resumedId);
      expect(resumeOffset).toBeGreaterThan(0);

      const runtimeDir = resumed.runtimeDir;
      const modelCacheDir = `${runtimeDir}/model-cache/geneformer-v1-10m`;
      const validationDir = `${storage.dataPath}/workspaces/__test__/geneformer-native-validation`;
      const fixture = await runPython(browser, CREATE_FIXTURE_SCRIPT, {
        runtimeDir,
        modelCacheDir,
        validationDir,
      });
      expect(fixture.ok).toBe(true);
      const fixtureInfo = JSON.parse(fixture.stdout.trim());
      expect(fixtureInfo).toMatchObject({ cellCount: 4, geneCount: 128 });

      const productScript = readEmbeddedPythonScript(
        rootDir,
        'frontend/src/lib/tools/ai/python-scripts/geneformer-embedding.ts',
        'GENEFORMER_EMBEDDING_SCRIPT',
      );
      const analysisRunId = crypto.randomUUID();
      const outputDir = `${validationDir}/results/${analysisRunId}`;
      const startedAt = Date.now();
      const params = {
        modelId: MODEL_ID,
        inputFile: fixtureInfo.inputPath,
        species: 'human',
        batchSize: '2',
        maxCsvRows: '4',
      };
      const { jobId } = await browser.execute(
        async (input) => window.Liatir.invoke('lia_ai_python_spawn', input),
        {
          runtimeId: RUNTIME_ID,
          script: productScript,
          args: [],
          inputJson: {
            runtimePath: runtimeDir,
            modelCacheDir,
            inputFile: fixtureInfo.inputPath,
            outputDir,
            batchSize: 2,
            maxCsvRows: 4,
            species: 'human',
          },
          workspaceId: '__test__',
          label: 'Single-cell Embedding',
          metadata: {
            modelId: MODEL_ID,
            modelName: MODEL_NAME,
            toolId: TOOL_ID,
            runKind: 'ai-model-direct',
            analysisRunId,
            mode: 'single-cell-embedding',
            label: 'geneformer-parity-input.h5ad',
            inputPaths: [fixtureInfo.inputPath],
            params,
            startedAt,
            outputDir,
          },
        },
      );
      await browser.waitUntil(
        async () => {
          const job = await browser.execute(
            async (id) => window.Liatir.invoke('lia_jobs_status', { jobId: id }),
            jobId,
          );
          return job.status.type !== 'running';
        },
        { timeout: 300_000, timeoutMsg: 'Real Geneformer inference did not finish' },
      );
      const job = await browser.execute(
        async (id) => window.Liatir.invoke('lia_jobs_status', { jobId: id }),
        jobId,
      );
      expect(job.status.type).toBe('done');
      expect(job.kind).toBe('ai-python');
      expect(job.workspaceId).toBe('__test__');
      expect(job.metadata).toMatchObject({
        modelId: MODEL_ID,
        runtimeId: RUNTIME_ID,
        toolId: TOOL_ID,
        runKind: 'ai-model-direct',
        analysisRunId,
        mode: 'single-cell-embedding',
      });
      const output = await browser.execute(
        async (id) => window.Liatir.invoke('lia_jobs_get_output', { jobId: id, since: 0 }),
        jobId,
      );
      const inference = JSON.parse(output.stdout.filter(Boolean).at(-1));
      expect(inference.summary).toMatchObject({
        cellCount: 4,
        inputCellCount: 4,
        embeddingDim: 256,
        embeddingKey: 'X_geneformer',
        model: 'Geneformer V1 10M',
      });
      expect(inference.preview).toHaveLength(3);
      expect(inference.preview.flat().every(Number.isFinite)).toBe(true);
      expect(inference.summary.accelerator).toMatch(EXPECTED_ACCELERATOR);

      await navigate(browser, '/jobs');
      const jobEntry = await browser.$(`[data-testid="job-entry"][data-job-id="${jobId}"]`);
      await jobEntry.waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: 'The completed Geneformer Job is missing from Jobs',
      });
      expect(await jobEntry.getText()).toContain('Single-cell Embedding');

      const resultPrefix = 'workspaces/__test__/analysis-runs';
      await browser.waitUntil(
        async () => browser.execute(
          async (rel) => window.Liatir.invoke('lia_app_exists', { rel }),
          `${resultPrefix}/${analysisRunId}.json`,
        ),
        { timeout: 60_000, interval: 1_000, timeoutMsg: 'Geneformer Job was not finalized into a Result' },
      );
      const persisted = await browser.execute(
        async ({ indexPath, outputPath }) => ({
          index: JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: indexPath })),
          output: JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: outputPath })),
        }),
        {
          indexPath: `${resultPrefix}/index.json`,
          outputPath: `${resultPrefix}/${analysisRunId}.json`,
        },
      );
      const result = persisted.index.find((entry) => entry.id === analysisRunId);
      expect(result).toMatchObject({
        id: analysisRunId,
        tool: TOOL_ID,
        label: 'geneformer-parity-input.h5ad',
        status: 'done',
        params,
      });
      expect(result.outputFiles).toHaveLength(3);
      expect(result.outputFiles.every((file) => (
        file.role === 'final'
        && file.producer?.kind === 'ai-tool'
        && file.producer?.id === TOOL_ID
        && file.parentRun?.runKind === 'ai-model-direct'
        && file.parentRun?.runId === analysisRunId
        && file.parentRun?.analysisRunId === analysisRunId
      ))).toBe(true);

      const stats = section(persisted.output, 'stats');
      const statsByLabel = Object.fromEntries(stats.items.map((item) => [item.label, item.value]));
      expect(statsByLabel).toMatchObject({ Cells: 4, Genes: 128, Dimensions: 256, Species: 'human' });
      const preview = section(persisted.output, 'table', 'Embedding preview');
      expect(preview.rows).toHaveLength(3);
      expect(preview.rows.flatMap((row) => row.slice(1)).every(Number.isFinite)).toBe(true);
      const provenance = section(persisted.output, 'table', 'Provenance');
      const provenanceByField = Object.fromEntries(provenance.rows);
      expect(provenanceByField).toMatchObject({
        'AI Model': MODEL_NAME,
        Species: 'human',
        'Batch size': 2,
        'Embedding key': 'X_geneformer',
      });
      expect(String(provenanceByField.Accelerator)).toMatch(EXPECTED_ACCELERATOR);
      for (const file of result.outputFiles) {
        const size = await browser.execute(
          async (filePath) => window.Liatir.invoke('lia_file_size', { path: filePath }),
          file.path,
        );
        expect(size).toBeGreaterThan(0);
      }

      await navigate(browser, `/results?run=${analysisRunId}`);
      const resultEntry = await browser.$(`[data-testid="result-run"][data-run-id="${analysisRunId}"]`);
      await resultEntry.waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: 'The finalized Geneformer run is missing from Results',
      });
      expect(await resultEntry.getText()).toContain('geneformer-parity-input.h5ad');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Geneformer V1 10M embeddings')),
        { timeout: 20_000, timeoutMsg: 'The Geneformer Result detail did not load' },
      );
      expect(await browser.execute(() => document.body.innerText)).toContain('Provenance');

      const markerPath = `${runtimeDir}/validation/rollback-marker.txt`;
      const marker = await runPython(browser, MARKER_SCRIPT, {
        path: markerPath,
        write: true,
        contents: 'first-activation',
      });
      expect(JSON.parse(marker.stdout.trim())).toEqual({ exists: true, contents: 'first-activation' });

      const replacementId = `runtime-box-replacement-${Date.now()}`;
      await startInstall(browser, replacementId);
      await browser.waitUntil(
        async () => (await runtimeBoxInstallStatus(browser, replacementId)) !== 'running',
        { timeout: 180_000, timeoutMsg: 'Runtime Box replacement did not complete' },
      );
      expect(await runtimeBoxInstallStatus(browser, replacementId)).toBe('done');
      const replacement = await runtimeBoxInstallResult(browser, replacementId);
      expect(replacement.rollbackAvailable).toBe(true);
      const markerAfterReplacement = await runPython(browser, MARKER_SCRIPT, { path: markerPath });
      expect(JSON.parse(markerAfterReplacement.stdout.trim()).exists).toBe(false);

      const rollback = await browser.execute(
        async (runtimeId) => window.Liatir.invoke('lia_ai_runtime_box_rollback', { runtimeId }),
        RUNTIME_ID,
      );
      expect(rollback.restored).toBe(true);
      const markerAfterRollback = await runPython(browser, MARKER_SCRIPT, { path: markerPath });
      expect(JSON.parse(markerAfterRollback.stdout.trim())).toEqual({
        exists: true,
        contents: 'first-activation',
      });

      const removed = await browser.execute(
        async (input) => window.Liatir.invoke('lia_ai_runtime_box_remove', input),
        { runtimeId: RUNTIME_ID, boxId: BOX_ID },
      );
      expect(removed).toBe(true);
      const runtimeStatus = await browser.execute(
        async (runtimeId) => window.Liatir.invoke('lia_ai_runtime_status', {
          runtimeId,
          packages: [],
          sources: [],
        }),
        RUNTIME_ID,
      );
      expect(runtimeStatus.installed).toBe(false);
      for (const file of result.outputFiles) {
        const size = await browser.execute(
          async (filePath) => window.Liatir.invoke('lia_file_size', { path: filePath }),
          file.path,
        );
        expect(size).toBeGreaterThan(0);
      }

      if (PRODUCT_EVIDENCE_PATH) {
        const evidencePath = path.resolve(rootDir, PRODUCT_EVIDENCE_PATH);
        fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
        fs.writeFileSync(evidencePath, `${JSON.stringify({
          schemaVersion: 1,
          kind: 'liatir.runtime-box.product-lifecycle-evidence',
          status: 'passed',
          boxId: BOX_ID,
          modelId: MODEL_ID,
          runtimeId: RUNTIME_ID,
          targetId: TARGET_ID,
          version: VERSION,
          jobId,
          analysisRunId,
          accelerator: inference.summary.accelerator,
          resultArtifactCount: result.outputFiles.length,
          assertions: {
            interruptedResume: 'passed',
            install: 'passed',
            realInference: 'passed',
            jobs: 'passed',
            results: 'passed',
            provenance: 'passed',
            replacement: 'passed',
            rollback: 'passed',
            removal: 'passed',
            resultArtifactsSurvivedRemoval: 'passed',
          },
        }, null, 2)}\n`);
      }
    },
  },
];
