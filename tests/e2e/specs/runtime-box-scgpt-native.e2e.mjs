/**
 * The scGPT Runtime Box, exercised in the real app — the counterpart of `validate-scgpt-runtime.mjs`, but running
 * through Liatir rather than standalone, so the install and inference path the user actually takes is the one
 * under test.
 *
 * This covers the same ground as the Geneformer lifecycle, and has to: a protected release refuses to certify a
 * Linux publication without a receipt naming a Job, an analysis run, Result artifacts and ten passing assertions,
 * so a spec that only installs and embeds cannot produce evidence for the box it just promoted. Until it did,
 * scGPT Linux CPU sat published on the beta channel with no record the product could actually use it.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  activateCleanSandbox,
  firstDownloadOffset,
  runtimeBoxInstallError,
  runtimeBoxInstallProgress,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  runtimeBoxTargetForNativeTest,
  runSingleCellEmbeddingFromModelPage,
  startRuntimeBoxInstall,
  waitForRuntimeBoxInstall,
} from '../support/runtime-box.mjs';
import { navigateInApp, outputSection } from '../support/liatir-app.mjs';
import { comparablePath, isolatedTestHome } from '../support/tauri-process.mjs';

const BOX_ID = 'scgpt-whole-human';
const MODEL_ID = 'bowang-scgpt-whole-human';
const MODEL_NAME = 'scGPT Whole-human';
const RUNTIME_ID = 'single-cell-foundation-scgpt-whole-human';
const TOOL_ID = 'ai-single-cell-embedding';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-metal';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '0.2.5-beta.2';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const TARGET_CANDIDATES = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
const TARGET_ACCELERATOR = TARGET_CANDIDATES[0].target.accelerator;
const CUDA_TARGET = TARGET_ACCELERATOR === 'cuda';
const EXPECTED_ACCELERATOR = TARGET_ACCELERATOR === 'cuda'
  ? /^CUDA$/
  : TARGET_ACCELERATOR === 'metal'
    ? /^Apple Metal$/
    : /^CPU$/;
const CELL_COUNT = 4;
const GENE_COUNT = 128;

const CREATE_FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import sys

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp

payload = json.loads(sys.stdin.read() or "{}")
runtime_dir = Path(payload["runtimeDir"])
with (runtime_dir / "model-cache/scgpt-whole-human/vocab.json").open("r", encoding="utf-8") as source:
    vocab = json.load(source)
genes = sorted(gene for gene in vocab if not gene.startswith("<"))[:128]
if len(genes) < 128:
    raise SystemExit("The production box does not contain enough scGPT vocabulary genes.")

counts = np.asarray([
    [((gene_index * 19 + cell_index * 31) % 101) + 1 for gene_index in range(len(genes))]
    for cell_index in range(4)
], dtype=np.int32)
validation_dir = Path(payload["validationDir"])
validation_dir.mkdir(parents=True, exist_ok=True)
fixture = validation_dir / "scgpt-native-input.h5ad"
obs = pd.DataFrame(index=[f"cell-{index + 1}" for index in range(counts.shape[0])])
var = pd.DataFrame({"gene_name": genes}, index=genes)
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture)
print(json.dumps({
    "inputPath": str(fixture),
    "cellCount": int(counts.shape[0]),
    "geneCount": len(genes),
}))
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
    targetCandidates: TARGET_CANDIDATES,
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
      expect(comparablePath(storage.appPath)).toContain(isolatedTestHome());
      expect(comparablePath(storage.dataPath)).toContain(isolatedTestHome());

      // Interrupt the first download, then resume it: the resumed install is the one that has to
      // reach `done`, and it is the only place the partial-file path is exercised at all.
      const interruptedId = `runtime-box-scgpt-interrupted-${Date.now()}`;
      await startInstall(browser, interruptedId, { cancelAfterBytes: 1 });
      await browser.waitUntil(
        async () => (await runtimeBoxInstallStatus(browser, interruptedId)) !== 'running',
        { timeout: 60_000, timeoutMsg: 'Interrupted scGPT install did not stop' },
      );
      const interruptedProgress = await runtimeBoxInstallProgress(browser, interruptedId);
      const interruptedError = await runtimeBoxInstallError(browser, interruptedId);
      if (!interruptedProgress.cancelRequested) {
        throw new Error(
          `scGPT install failed before the first downloadable chunk: ${interruptedError ?? 'unknown error'}`,
        );
      }
      expect(interruptedProgress.maxBytesDownloaded).toBeGreaterThan(0);
      const archiveSizeBytes = Number(interruptedProgress.bytesTotal);
      expect(archiveSizeBytes).toBeGreaterThan(0);

      const resumedId = `runtime-box-scgpt-resumed-${Date.now()}`;
      await startInstall(browser, resumedId);
      await waitForRuntimeBoxInstall(browser, resumedId, {
        archiveSizeBytes,
        timeoutMsg: 'Resumed scGPT install did not complete',
      });
      // Error first, status second: a bare `expected "done", received "error"` throws away the only
      // description of what went wrong, and the box is gone with the ephemeral runner.
      const resumedStatus = await runtimeBoxInstallStatus(browser, resumedId);
      const resumedError = await runtimeBoxInstallError(browser, resumedId);
      if (resumedStatus !== 'done') {
        throw new Error(
          `Resumed scGPT install failed with status ${resumedStatus}: ${resumedError ?? 'unknown error'}`,
        );
      }
      expect(resumedError).toBe(null);
      const installed = await runtimeBoxInstallResult(browser, resumedId);
      expect(installed.version).toBe(VERSION);
      expect(installed.rollbackAvailable).toBe(false);
      expect(await firstDownloadOffset(browser, resumedId)).toBeGreaterThan(0);

      const runtimeDir = installed.runtimeDir;
      const validationDir = `${storage.dataPath}/workspaces/__test__/scgpt-native-validation`;
      const fixture = await runPython(browser, CREATE_FIXTURE_SCRIPT, {
        runtimeDir,
        validationDir,
      });
      expect(fixture.ok).toBe(true);
      const fixtureInfo = JSON.parse(fixture.stdout.trim());
      expect(fixtureInfo).toMatchObject({ cellCount: CELL_COUNT, geneCount: GENE_COUNT });

      const params = {
        modelId: MODEL_ID,
        inputFile: fixtureInfo.inputPath,
        species: 'human',
        batchSize: '2',
        maxCsvRows: '4',
      };
      const { job, output, analysisRunId, result, persistedOutput } = await runSingleCellEmbeddingFromModelPage(
        browser,
        {
          modelId: MODEL_ID,
          toolId: TOOL_ID,
          installed,
          inputPath: fixtureInfo.inputPath,
          batchSize: 2,
          maxCsvRows: 4,
        },
      );
      const jobId = job.id;
      expect(job.kind).toBe('ai-python');
      expect(job.workspaceId).toBe('__test__');
      expect(job.metadata).toMatchObject({
        modelId: MODEL_ID,
        runtimeId: RUNTIME_ID,
        toolId: TOOL_ID,
        runKind: 'ai-model-direct',
      });

      const inference = JSON.parse(output.stdout.filter(Boolean).at(-1));
      expect(inference.summary).toMatchObject({
        cellCount: CELL_COUNT,
        embeddingDim: 512,
        embeddingKey: 'X_scGPT',
        model: MODEL_NAME,
      });
      expect(inference.preview.flat().every(Number.isFinite)).toBe(true);
      expect(inference.summary.accelerator).toMatch(EXPECTED_ACCELERATOR);
      if (CUDA_TARGET) {
        // From the target under test, never a literal: a hardcoded CUDA version outlived its target
        // once already and failed a release after a complete install and a real inference.
        expect(inference.summary).toMatchObject({
          reportedCudaCompatibility: TARGET_CANDIDATES[0].target.cudaVersion,
        });
        expect(inference.summary.gpuModel).toEqual(expect.any(String));
        expect(inference.summary.gpuModel.length).toBeGreaterThan(0);
        expect(inference.summary.computeCapability).toMatch(/^d+.d+$/);
        expect(inference.summary.peakVramBytes).toBeGreaterThan(0);
      }

      const jobEntry = await browser.$(`[data-testid="job-entry"][data-job-id="${jobId}"]`);
      await jobEntry.waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: 'The completed scGPT Job is missing from Jobs',
      });
      expect(await jobEntry.getText()).toContain('Single-cell Embedding');

      expect(result).toMatchObject({
        id: analysisRunId,
        tool: TOOL_ID,
        label: 'scgpt-native-input.h5ad',
        status: 'done',
        params,
      });
      expect(result.outputFiles.length).toBeGreaterThan(0);
      expect(result.outputFiles.every((file) => file.producer?.id === TOOL_ID)).toBe(true);

      const stats = outputSection(persistedOutput, 'stats');
      const statsByLabel = Object.fromEntries(stats.items.map((item) => [item.label, item.value]));
      expect(statsByLabel).toMatchObject({
        Cells: CELL_COUNT,
        Genes: GENE_COUNT,
        Dimensions: 512,
        Species: 'human',
      });
      const preview = outputSection(persistedOutput, 'table', 'Embedding preview');
      expect(preview.rows.length).toBeGreaterThan(0);
      expect(preview.rows.flatMap((row) => row.slice(1)).every(Number.isFinite)).toBe(true);
      const provenance = outputSection(persistedOutput, 'table', 'Provenance');
      const provenanceByField = Object.fromEntries(provenance.rows);
      expect(provenanceByField).toMatchObject({
        'AI Model': MODEL_NAME,
        Species: 'human',
        'Batch size': 2,
        'Embedding key': 'X_scGPT',
      });
      expect(String(provenanceByField.Accelerator)).toMatch(EXPECTED_ACCELERATOR);
      for (const file of result.outputFiles) {
        const size = await browser.execute(
          async (filePath) => window.Liatir.invoke('lia_file_size', { path: filePath }),
          file.path,
        );
        expect(size).toBeGreaterThan(0);
      }

      await navigateInApp(browser, `/results?run=${analysisRunId}`);
      const resultEntry = await browser.$(`[data-testid="result-run"][data-run-id="${analysisRunId}"]`);
      await resultEntry.waitForDisplayed({
        timeout: 20_000,
        timeoutMsg: 'The finalized scGPT run is missing from Results',
      });
      expect(await resultEntry.getText()).toContain('scgpt-native-input.h5ad');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('scGPT Whole-human embeddings')),
        { timeout: 20_000, timeoutMsg: 'The scGPT Result detail did not load' },
      );
      expect(await browser.execute(() => document.body.innerText)).toContain('Provenance');

      // A marker inside the installed box proves replacement really swapped the payload, and that
      // rollback restored the original one rather than merely reporting that it had.
      const markerPath = `${runtimeDir}/validation/rollback-marker.txt`;
      const marker = await runPython(browser, MARKER_SCRIPT, {
        path: markerPath,
        write: true,
        contents: 'first-activation',
      });
      expect(JSON.parse(marker.stdout.trim())).toEqual({ exists: true, contents: 'first-activation' });

      const replacementId = `runtime-box-scgpt-replacement-${Date.now()}`;
      await startInstall(browser, replacementId);
      await waitForRuntimeBoxInstall(browser, replacementId, {
        archiveSizeBytes,
        timeoutMsg: 'scGPT replacement did not complete',
      });
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

      // A pre-v2 activation may still be present on a machine upgraded in place. It must remain
      // removable, but neither execution surface may dispatch its interpreter. Overwriting the
      // metadata of this otherwise valid runtime makes the regression meaningful: without the
      // schema gate both calls below would execute successfully.
      fs.writeFileSync(
        path.join(runtimeDir, 'runtime-box-activation.json'),
        `${JSON.stringify({ schemaVersion: 1 }, null, 2)}\n`,
      );
      const legacyInlineError = await browser.execute(async (runtimeId) => {
        try {
          await window.Liatir.invoke('lia_ai_python_run', {
            runtimeId,
            script: 'print("legacy-inline-executed")',
            args: [],
            inputJson: {},
            timeoutSeconds: 30,
          });
          return null;
        } catch (error) {
          return String(error);
        }
      }, RUNTIME_ID);
      expect(legacyInlineError).toBe(
        'AI Runtime Box format is unsupported; remove and reinstall this Runtime Box',
      );
      const legacyJobError = await browser.execute(async (runtimeId) => {
        try {
          await window.Liatir.invoke('lia_ai_python_spawn', {
            runtimeId,
            script: 'print("legacy-job-executed")',
            args: [],
            inputJson: {},
            workspaceId: '__test__',
            label: 'Unsupported Runtime Box fixture',
            metadata: {},
          });
          return null;
        } catch (error) {
          return String(error);
        }
      }, RUNTIME_ID);
      expect(legacyJobError).toBe(
        'AI Runtime Box format is unsupported; remove and reinstall this Runtime Box',
      );

      const removed = await browser.execute(
        async (input) => window.Liatir.invoke('lia_ai_runtime_box_remove', input),
        { runtimeId: RUNTIME_ID, boxId: BOX_ID },
      );
      expect(removed).toBe(true);
      expect(fs.existsSync(runtimeDir)).toBe(false);
      const runtimeStatus = await browser.execute(
        async (runtimeId) => window.Liatir.invoke('lia_ai_runtime_status', {
          runtimeId,
          packages: [],
          sources: [],
        }),
        RUNTIME_ID,
      );
      expect(runtimeStatus.installed).toBe(false);
      // Removing the box must not take the science with it: Results outlive the runtime that made
      // them, and a user who frees disk space keeps every artifact they already produced.
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
          gpuModel: inference.summary.gpuModel,
          computeCapability: inference.summary.computeCapability,
          reportedCudaCompatibility: inference.summary.reportedCudaCompatibility,
          peakVramBytes: inference.summary.peakVramBytes,
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
            legacyV1InlineExecutionRejected: 'passed',
            legacyV1JobExecutionRejected: 'passed',
            legacyV1Cleanup: 'passed',
            removal: 'passed',
            resultArtifactsSurvivedRemoval: 'passed',
          },
        }, null, 2)}\n`);
      }
    },
  },
];
