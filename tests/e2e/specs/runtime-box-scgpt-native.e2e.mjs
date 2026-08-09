/**
 * The scGPT Runtime Box, exercised in the real app — the counterpart of `validate-scgpt-runtime.mjs`, but running
 * through Liatir rather than standalone, so the install and inference path the user actually takes is the one
 * under test.
 */
import {
  activateCleanSandbox,
  runtimeBoxTargetForNativeTest,
  readEmbeddedPythonScript,
  runtimeBoxInstallError,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  startRuntimeBoxInstall,
} from '../support/runtime-box.mjs';

const BOX_ID = 'scgpt-whole-human';
const MODEL_ID = 'bowang-scgpt-whole-human';
const RUNTIME_ID = 'single-cell-foundation-scgpt-whole-human';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-metal';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';

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
counts = np.asarray([[((index * 19) % 101) + 1 for index in range(len(genes))]], dtype=np.int32)
fixture = runtime_dir / "validation/scgpt-native-input.h5ad"
fixture.parent.mkdir(parents=True, exist_ok=True)
obs = pd.DataFrame(index=["cell-1"])
var = pd.DataFrame({"gene_name": genes}, index=genes)
anndata.AnnData(X=sp.csr_matrix(counts), obs=obs, var=var).write_h5ad(fixture)
print(json.dumps({"inputPath": str(fixture), "cellCount": 1, "geneCount": len(genes)}))
`;

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
    name: 'installs the live scGPT box and runs a real native embedding',
    heavy: true,
    async run({ browser, expect, rootDir }) {
      await activateCleanSandbox(browser);
      const downloadId = `runtime-box-scgpt-${Date.now()}`;
      await startRuntimeBoxInstall(browser, {
        boxId: BOX_ID,
        modelId: MODEL_ID,
        channel: 'beta',
        registryBaseUrl: REGISTRY_BASE_URL,
        targetCandidates: runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID),
        downloadId,
      });
      await browser.waitUntil(
        async () => (await runtimeBoxInstallStatus(browser, downloadId)) !== 'running',
        { timeout: 300_000, timeoutMsg: 'Live scGPT Runtime Box install did not complete' },
      );
      expect(await runtimeBoxInstallStatus(browser, downloadId)).toBe('done');
      expect(await runtimeBoxInstallError(browser, downloadId)).toBe(null);
      const installed = await runtimeBoxInstallResult(browser, downloadId);
      expect(installed.version).toBe(process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '0.2.5-beta.2');
      expect(installed.rollbackAvailable).toBe(false);

      const fixture = await runPython(browser, CREATE_FIXTURE_SCRIPT, {
        runtimeDir: installed.runtimeDir,
      });
      expect(fixture.ok).toBe(true);
      const fixtureInfo = JSON.parse(fixture.stdout.trim());
      expect(fixtureInfo).toMatchObject({ cellCount: 1, geneCount: 128 });

      const productScript = readEmbeddedPythonScript(
        rootDir,
        'frontend/src/lib/tools/ai/python-scripts/scgpt-embedding.ts',
        'SCGPT_EMBEDDING_SCRIPT',
      );
      const { jobId } = await browser.execute(
        async (input) => window.Liatir.invoke('lia_ai_python_spawn', input),
        {
          runtimeId: RUNTIME_ID,
          script: productScript,
          args: [],
          inputJson: {
            runtimePath: installed.runtimeDir,
            modelCacheDir: `${installed.runtimeDir}/model-cache/scgpt-whole-human`,
            inputFile: fixtureInfo.inputPath,
            outputDir: `${installed.runtimeDir}/validation/output`,
            batchSize: 1,
            maxCsvRows: 1,
            species: 'human',
          },
          workspaceId: '__test__',
          label: 'scGPT native validation',
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
        { timeout: 600_000, timeoutMsg: 'Real native scGPT inference did not finish' },
      );
      const job = await browser.execute(
        async (id) => window.Liatir.invoke('lia_jobs_status', { jobId: id }),
        jobId,
      );
      const output = await browser.execute(
        async (id) => window.Liatir.invoke('lia_jobs_get_output', { jobId: id, since: 0 }),
        jobId,
      );
      if (job.status.type !== 'done') {
        throw new Error(`Native scGPT Job failed:\n${output.stderr.join('\n')}`);
      }
      expect(job.metadata).toMatchObject({ modelId: MODEL_ID, validation: 'native-runtime-box' });
      const inference = JSON.parse(output.stdout.filter(Boolean).at(-1));
      expect(inference.summary).toMatchObject({
        cellCount: 1,
        embeddingDim: 512,
        embeddingKey: 'X_scGPT',
        model: 'scGPT Whole-human',
      });
      expect(inference.preview.flat().every(Number.isFinite)).toBe(true);

      const removed = await browser.execute(
        async (input) => window.Liatir.invoke('lia_ai_runtime_box_remove', input),
        { runtimeId: RUNTIME_ID, boxId: BOX_ID },
      );
      expect(removed).toBe(true);
    },
  },
];
