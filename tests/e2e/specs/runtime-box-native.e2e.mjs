import fs from 'node:fs';
import path from 'node:path';
import { waitForLiatirBridge } from '../support/liatir-app.mjs';

const BOX_ID = 'geneformer-v1-10m';
const MODEL_ID = 'ctheodoris-geneformer-v1-10m';
const RUNTIME_ID = 'single-cell-foundation-geneformer-v1-10m';
const REGISTRY_BASE_URL = 'https://models.liatir.com/v1';

function readEmbeddedPythonScript(rootDir, relativePath, exportName) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const prefix = `export const ${exportName} = String.raw\``;
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('\`;');
  if (start < 0 || end <= start) throw new Error(`Cannot extract ${exportName} from ${relativePath}`);
  return source.slice(start + prefix.length, end);
}

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
validation_dir = runtime_dir / "validation"
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

async function startInstall(browser, downloadId) {
  return browser.execute(async (input) => {
    window.__liatirRuntimeBoxInstall ??= {};
    const state = {
      status: 'running',
      progress: [],
      result: null,
      error: null,
      unlisten: null,
    };
    window.__liatirRuntimeBoxInstall[input.downloadId] = state;
    state.unlisten = await window.Liatir.desktop.events.on(
      `managed:progress:${input.downloadId}`,
      (progress) => state.progress.push(progress),
    );
    void window.Liatir.invoke('lia_ai_runtime_box_install', input)
      .then((result) => {
        state.status = 'done';
        state.result = result;
      })
      .catch((error) => {
        state.status = 'error';
        state.error = String(error?.message ?? error);
      })
      .finally(() => state.unlisten?.());
    return true;
  }, {
    boxId: BOX_ID,
    modelId: MODEL_ID,
    channel: 'beta',
    registryBaseUrl: REGISTRY_BASE_URL,
    downloadId,
  });
}

async function installStatus(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.status ?? null,
    downloadId,
  );
}

async function installError(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.error ?? null,
    downloadId,
  );
}

async function installResult(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.result ?? null,
    downloadId,
  );
}

async function firstDownloadOffset(browser, downloadId) {
  return browser.execute((id) => {
    const progress = window.__liatirRuntimeBoxInstall?.[id]?.progress ?? [];
    return progress.find((item) => !item.done)?.bytesDownloaded ?? 0;
  }, downloadId);
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

// Activates the isolated test workspace through the same persisted app state
// used at startup. This keeps the Runtime Box validation independent from
// WebDriver click timing during the very first Svelte hydration.
async function activateCleanSandbox(browser) {
  await waitForLiatirBridge(browser);
  await browser.execute(async () => {
    const now = Date.now();
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces.json',
      content: JSON.stringify({
        workspaces: [{ id: '__test__', name: 'Sandbox', createdAt: now, lastOpenedAt: now }],
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'active-workspace.json',
      content: JSON.stringify({ id: '__test__' }),
      createDirs: true,
    });
    return true;
  });
  await browser.execute(() => {
    window.location.href = '/';
    return true;
  });
  await (await browser.$('[data-testid="sidebar-nav-item"]')).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: 'Clean Sandbox workspace shell did not open',
  });
}

export const tests = [
  {
    name: 'validates clean install, interruption resume, inference, replacement, and rollback',
    async run({ browser, expect, rootDir }) {
      await activateCleanSandbox(browser);

      const interruptedId = `runtime-box-interrupted-${Date.now()}`;
      await startInstall(browser, interruptedId);
      await browser.waitUntil(
        async () => {
          return browser.execute((id) => {
            const progress = window.__liatirRuntimeBoxInstall?.[id]?.progress ?? [];
            return progress.some((item) => item.bytesDownloaded > 64 * 1024 && !item.done);
          }, interruptedId);
        },
        { timeout: 60_000, timeoutMsg: 'Runtime Box download did not begin before interruption' },
      );
      const cancelled = await browser.execute(
        async (id) => window.Liatir.invoke('lia_managed_download_cancel', { id }),
        interruptedId,
      );
      expect(cancelled).toBe(true);
      await browser.waitUntil(
        async () => (await installStatus(browser, interruptedId)) === 'error',
        { timeout: 30_000, timeoutMsg: 'Interrupted Runtime Box install did not stop' },
      );
      expect(await installError(browser, interruptedId)).toContain('Download cancelled');

      const resumedId = `runtime-box-resumed-${Date.now()}`;
      await startInstall(browser, resumedId);
      await browser.waitUntil(
        async () => (await installStatus(browser, resumedId)) !== 'running',
        { timeout: 180_000, timeoutMsg: 'Resumed Runtime Box install did not complete' },
      );
      expect(await installStatus(browser, resumedId)).toBe('done');
      const resumed = await installResult(browser, resumedId);
      expect(resumed.version).toBe('1.0.0-beta.1');
      expect(resumed.rollbackAvailable).toBe(false);
      const resumeOffset = await firstDownloadOffset(browser, resumedId);
      expect(resumeOffset).toBeGreaterThan(0);

      const runtimeDir = resumed.runtimeDir;
      const modelCacheDir = `${runtimeDir}/model-cache/geneformer-v1-10m`;
      const fixture = await runPython(browser, CREATE_FIXTURE_SCRIPT, { runtimeDir, modelCacheDir });
      expect(fixture.ok).toBe(true);
      const fixtureInfo = JSON.parse(fixture.stdout.trim());
      expect(fixtureInfo).toMatchObject({ cellCount: 4, geneCount: 128 });

      const productScript = readEmbeddedPythonScript(
        rootDir,
        'frontend/src/lib/tools/ai/python-scripts/geneformer-embedding.ts',
        'GENEFORMER_EMBEDDING_SCRIPT',
      );
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
            outputDir: `${runtimeDir}/validation/output`,
            batchSize: 2,
            maxCsvRows: 4,
            species: 'human',
          },
          workspaceId: '__test__',
          label: 'Geneformer native validation',
          metadata: { modelId: MODEL_ID, validation: 'native-runtime-box' },
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
      expect(job.metadata).toMatchObject({ modelId: MODEL_ID, validation: 'native-runtime-box' });
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
        async () => (await installStatus(browser, replacementId)) !== 'running',
        { timeout: 180_000, timeoutMsg: 'Runtime Box replacement did not complete' },
      );
      expect(await installStatus(browser, replacementId)).toBe('done');
      const replacement = await installResult(browser, replacementId);
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
    },
  },
];
