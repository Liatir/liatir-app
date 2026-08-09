/**
 * Runs the published UCE Runtime Box through Liatir's native install, Job, Result, and removal lifecycle.
 *
 * The general interruption/replacement/rollback contract is covered by the shared Runtime Box lifecycle spec.
 * This focused gate exists because UCE is unusually large and because its real product runner must finalize a
 * finite 1,280-dimensional embedding into the same Jobs and Results surfaces used by every other AI Tool.
 */
import {
  activateCleanSandbox,
  runtimeBoxTargetForNativeTest,
  readEmbeddedPythonScript,
  runtimeBoxInstallError,
  runtimeBoxInstallProgress,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  startRuntimeBoxInstall,
} from '../support/runtime-box.mjs';

const BOX_ID = 'uce-4layer';
const MODEL_ID = 'snap-stanford-uce-4layer';
const MODEL_NAME = 'UCE 4-layer';
const RUNTIME_ID = 'single-cell-foundation-uce';
const TOOL_ID = 'ai-single-cell-embedding';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-metal';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.0.0-beta.2';
const ARCHIVE_SIZE_BYTES = 9_899_283_940;
const INSTALL_TIMEOUT_MS = 45 * 60 * 1000;
const INFERENCE_TIMEOUT_MS = 30 * 60 * 1000;
const RESULT_TIMEOUT_MS = 60 * 1000;
const PROGRESS_REPORT_BYTES = 1024 ** 3;

const CREATE_FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import sys

import anndata
import numpy as np
import pandas as pd
import scipy.sparse as sp
import torch

payload = json.loads(sys.stdin.read() or "{}")
runtime_dir = Path(payload["runtimeDir"])
model_files = runtime_dir / "model-cache/uce/model_files"
protein_file = model_files / "protein_embeddings/Homo_sapiens.GRCh38.gene_symbol_to_embedding_ESM2.pt"
chromosome_file = model_files / "species_chrom.csv"

protein_genes = {str(gene).upper() for gene in torch.load(protein_file, map_location="cpu")}
chromosomes = pd.read_csv(chromosome_file)
human_chromosome_genes = {
    str(gene).upper()
    for gene in chromosomes.loc[chromosomes["species"] == "human", "gene_symbol"]
}
genes = sorted(protein_genes & human_chromosome_genes)[:32]
if len(genes) != 32:
    raise SystemExit(f"UCE fixture requires 32 verified human genes, found {len(genes)}.")

counts = np.asarray([
    [((cell_index + 3) * (gene_index + 5) % 29) + 1 for gene_index in range(len(genes))]
    for cell_index in range(10)
], dtype=np.int32)
obs = pd.DataFrame(index=[f"cell-{index + 1}" for index in range(10)])
var = pd.DataFrame(index=genes)
fixture_path = Path(payload["fixturePath"])
fixture_path.parent.mkdir(parents=True, exist_ok=True)
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture_path)
print(json.dumps({
    "inputPath": str(fixture_path),
    "cellCount": int(counts.shape[0]),
    "geneCount": int(counts.shape[1]),
}))
`;

function formatBytes(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
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
  await browser.execute((path) => {
    window.location.href = path;
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
    name: 'installs live UCE, finalizes a direct Job into a Result, and removes the box',
    heavy: true,
    async run({ browser, expect, rootDir }) {
      await activateCleanSandbox(browser);
      const storage = await browser.execute(async () => ({
        appPath: await window.Liatir.invoke('lia_app_path'),
        dataPath: await window.Liatir.desktop.fs.data.path(),
      }));
      expect(storage.appPath).toContain('tests/.artifacts/home');
      expect(storage.dataPath).toContain('tests/.artifacts/home');

      const downloadId = `runtime-box-uce-${Date.now()}`;
      let installed = null;
      let removedByAssertion = false;

      try {
        await startRuntimeBoxInstall(browser, {
          boxId: BOX_ID,
          modelId: MODEL_ID,
          channel: 'beta',
          registryBaseUrl: REGISTRY_BASE_URL,
          targetCandidates: runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID),
          downloadId,
        });

        let nextProgressReport = PROGRESS_REPORT_BYTES;
        await browser.waitUntil(
          async () => {
            const status = await runtimeBoxInstallStatus(browser, downloadId);
            const progress = await runtimeBoxInstallProgress(browser, downloadId);
            if (progress.maxBytesDownloaded >= nextProgressReport || status !== 'running') {
              const total = progress.bytesTotal ? ` / ${formatBytes(progress.bytesTotal)}` : '';
              console.log(`\n    UCE download ${formatBytes(progress.maxBytesDownloaded)}${total}`);
              nextProgressReport =
                (Math.floor(progress.maxBytesDownloaded / PROGRESS_REPORT_BYTES) + 1)
                * PROGRESS_REPORT_BYTES;
            }
            return status !== 'running';
          },
          {
            timeout: INSTALL_TIMEOUT_MS,
            interval: 1_000,
            timeoutMsg: 'Live UCE Runtime Box install did not complete within 45 minutes',
          },
        );

        expect(await runtimeBoxInstallStatus(browser, downloadId)).toBe('done');
        expect(await runtimeBoxInstallError(browser, downloadId)).toBe(null);
        const progress = await runtimeBoxInstallProgress(browser, downloadId);
        expect(progress.eventCount).toBeGreaterThan(0);
        expect(progress.bytesTotal).toBe(ARCHIVE_SIZE_BYTES);
        expect(progress.maxBytesDownloaded).toBeGreaterThan(8_000_000_000);

        installed = await runtimeBoxInstallResult(browser, downloadId);
        expect(installed.version).toBe(VERSION);
        expect(installed.rollbackAvailable).toBe(false);
        expect(installed.sizeBytes).toBeGreaterThan(10_000_000_000);

        const validationDir = `${storage.dataPath}/workspaces/__test__/uce-native-validation`;
        const fixture = await runPython(browser, CREATE_FIXTURE_SCRIPT, {
          runtimeDir: installed.runtimeDir,
          fixturePath: `${validationDir}/uce-native-input.h5ad`,
        });
        expect(fixture.ok).toBe(true);
        const fixtureInfo = JSON.parse(fixture.stdout.trim());
        expect(fixtureInfo).toMatchObject({ cellCount: 10, geneCount: 32 });

        const productScript = readEmbeddedPythonScript(
          rootDir,
          'frontend/src/lib/tools/ai/python-scripts/uce-embedding.ts',
          'UCE_EMBEDDING_SCRIPT',
        );
        const analysisRunId = crypto.randomUUID();
        const outputDir = `${validationDir}/results/${analysisRunId}`;
        const startedAt = Date.now();
        const params = {
          modelId: MODEL_ID,
          inputFile: fixtureInfo.inputPath,
          species: 'human',
          batchSize: '1',
          maxCsvRows: '10',
        };
        const { jobId } = await browser.execute(
          async (input) => window.Liatir.invoke('lia_ai_python_spawn', input),
          {
            runtimeId: RUNTIME_ID,
            script: productScript,
            args: [],
            inputJson: {
              runtimePath: installed.runtimeDir,
              modelCacheDir: `${installed.runtimeDir}/model-cache/uce`,
              inputFile: fixtureInfo.inputPath,
              outputDir,
              species: 'human',
              batchSize: 1,
              maxCsvRows: 10,
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
              label: 'uce-native-input.h5ad',
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
          {
            timeout: INFERENCE_TIMEOUT_MS,
            interval: 2_000,
            timeoutMsg: 'Real native UCE inference did not finish within 30 minutes',
          },
        );
        const job = await browser.execute(
          async (id) => window.Liatir.invoke('lia_jobs_status', { jobId: id }),
          jobId,
        );
        const jobOutput = await browser.execute(
          async (id) => window.Liatir.invoke('lia_jobs_get_output', { jobId: id, since: 0 }),
          jobId,
        );
        if (job.status.type !== 'done') {
          throw new Error(`Native UCE Job failed:\n${jobOutput.stderr.join('\n')}`);
        }
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

        // A detached direct run is finalized by the app shell, not by this test. Opening Jobs mirrors a user
        // returning to the tracked process and makes the shell reconcile the finished Job into one Result.
        await navigate(browser, '/jobs');
        const jobEntry = await browser.$(`[data-testid="job-entry"][data-job-id="${jobId}"]`);
        await jobEntry.waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'The completed UCE Job is missing from Jobs',
        });
        expect(await jobEntry.getText()).toContain('Single-cell Embedding');

        const resultPrefix = 'workspaces/__test__/analysis-runs';
        await browser.waitUntil(
          async () => browser.execute(
            async (rel) => window.Liatir.invoke('lia_app_exists', { rel }),
            `${resultPrefix}/${analysisRunId}.json`,
          ),
          {
            timeout: RESULT_TIMEOUT_MS,
            interval: 1_000,
            timeoutMsg: 'The completed UCE Job was not finalized into a Result',
          },
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
          label: 'uce-native-input.h5ad',
          status: 'done',
          params,
        });
        expect(result.outputFiles).toHaveLength(9);
        expect(result.outputFiles.slice(0, 3).every((file) => file.role === 'final')).toBe(true);
        expect(result.outputFiles.slice(3).every((file) => file.role === 'intermediate')).toBe(true);
        expect(result.outputFiles.every((file) => (
          file.producer?.kind === 'ai-tool'
          && file.producer?.id === TOOL_ID
          && file.parentRun?.runKind === 'ai-model-direct'
          && file.parentRun?.runId === analysisRunId
          && file.parentRun?.analysisRunId === analysisRunId
        ))).toBe(true);

        const stats = section(persisted.output, 'stats');
        const statsByLabel = Object.fromEntries(stats.items.map((item) => [item.label, item.value]));
        expect(statsByLabel).toMatchObject({ Cells: 10, Genes: 32, Dimensions: 1280, Species: 'human' });
        const preview = section(persisted.output, 'table', 'Embedding preview');
        expect(preview.rows).toHaveLength(3);
        expect(preview.rows.flatMap((row) => row.slice(1)).every(Number.isFinite)).toBe(true);
        const provenance = section(persisted.output, 'table', 'Provenance');
        const provenanceByField = Object.fromEntries(provenance.rows);
        expect(provenanceByField).toMatchObject({
          'AI Model': MODEL_NAME,
          Species: 'human',
          'Batch size': 1,
          'Embedding key': 'X_uce',
          'Random seed': 23,
        });
        expect(String(provenanceByField.Accelerator)).toMatch(/^mps/);

        for (const file of result.outputFiles) {
          const size = await browser.execute(
            async (path) => window.Liatir.invoke('lia_file_size', { path }),
            file.path,
          );
          expect(size).toBeGreaterThan(0);
        }

        await navigate(browser, `/results?run=${analysisRunId}`);
        const resultEntry = await browser.$(
          `[data-testid="result-run"][data-run-id="${analysisRunId}"]`,
        );
        await resultEntry.waitForDisplayed({
          timeout: 20_000,
          timeoutMsg: 'The finalized UCE run is missing from Results',
        });
        expect(await resultEntry.getText()).toContain('uce-native-input.h5ad');
        await browser.waitUntil(
          async () => browser.execute(() => document.body.innerText.includes('UCE 4-layer embeddings')),
          { timeout: 20_000, timeoutMsg: 'The UCE Result detail did not load' },
        );
        const resultText = await browser.execute(() => document.body.innerText);
        expect(resultText).toContain('UCE 4-layer embeddings');
        expect(resultText).toContain('Provenance');

        const removed = await browser.execute(
          async (input) => window.Liatir.invoke('lia_ai_runtime_box_remove', input),
          { runtimeId: RUNTIME_ID, boxId: BOX_ID },
        );
        expect(removed).toBe(true);
        removedByAssertion = true;
        const runtimeStatus = await browser.execute(
          async (runtimeId) => window.Liatir.invoke('lia_ai_runtime_status', {
            runtimeId,
            packages: [],
            sources: [],
          }),
          RUNTIME_ID,
        );
        expect(runtimeStatus.installed).toBe(false);

        // Result artifacts live outside the Runtime Box and must survive model removal.
        for (const file of result.outputFiles.slice(0, 3)) {
          const size = await browser.execute(
            async (path) => window.Liatir.invoke('lia_file_size', { path }),
            file.path,
          );
          expect(size).toBeGreaterThan(0);
        }
      } finally {
        if (installed && !removedByAssertion) {
          await browser.execute(
            async (input) => window.Liatir.invoke('lia_ai_runtime_box_remove', input).catch(() => false),
            { runtimeId: RUNTIME_ID, boxId: BOX_ID },
          );
        }
      }
    },
  },
];
