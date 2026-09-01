/** Exercises the MHCflurry Runtime Box through install, the shipped UI runner, Jobs, Results, and removal. */
import fs from 'node:fs';
import path from 'node:path';
import {
  activateCleanSandbox,
  runtimeBoxInstallError,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  runtimeBoxTargetForNativeTest,
  startRuntimeBoxInstall,
  waitForRuntimeBoxInstall,
} from '../support/runtime-box.mjs';
import {
  navigateInApp,
  readDataJson,
  reloadLiatirApp,
  selectFileFromPicker,
} from '../support/liatir-app.mjs';

const BOX_ID = 'mhcflurry-class1-presentation';
const MODEL_ID = 'openvax-mhcflurry-class1-presentation';
const RUNTIME_ID = 'oncology-mhcflurry-class1-presentation-2-2-1';
const TOOL_ID = 'ai-mhc-class-i-epitope-prediction';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-metal';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '2.2.1-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';

async function writeAppJson(browser, rel, value) {
  await browser.execute(async ({ file, content }) => window.Liatir.invoke('lia_app_write_text', {
    rel: file,
    content: JSON.stringify(content, null, 2),
    createDirs: true,
  }), { file: rel, content: value });
}

async function jobs(browser) {
  return browser.execute(async () => window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }));
}

export const tests = [{
  name: 'runs MHCflurry offline across navigation and keeps its Result after removal',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({
      dataPath: await window.Liatir.desktop.fs.data.path(),
    }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-mhcflurry-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'ai-model', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT,
      timeoutMsg: 'MHCflurry Runtime Box install did not complete',
    });
    const installError = await runtimeBoxInstallError(browser, downloadId);
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`MHCflurry install failed with status ${installStatus}: ${installError ?? 'unknown error'}`);
    }
    expect(installError).toBe(null);
    const installed = await runtimeBoxInstallResult(browser, downloadId);
    expect(installed.version).toBe(VERSION);
    expect(installed.activation.hostEnvironment).toBe(EXPECTED_HOST_ENVIRONMENT);

    const replacementId = `runtime-box-mhcflurry-replacement-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'ai-model', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates,
      downloadId: replacementId,
    });
    await waitForRuntimeBoxInstall(browser, replacementId, {
      archiveSizeBytes: installed.activation.release.archive.sizeBytes,
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT,
      timeoutMsg: 'MHCflurry Runtime Box replacement did not complete',
    });
    const replacementError = await runtimeBoxInstallError(browser, replacementId);
    const replacementStatus = await runtimeBoxInstallStatus(browser, replacementId);
    if (replacementStatus !== 'done') {
      throw new Error(`MHCflurry replacement failed with status ${replacementStatus}: ${replacementError ?? 'unknown error'}`);
    }
    expect(replacementError).toBe(null);
    const replacement = await runtimeBoxInstallResult(browser, replacementId);
    expect(replacement.rollbackAvailable).toBe(true);
    const rollback = await browser.execute(
      async (input) => window.Liatir.invoke('lia_runtime_box_rollback', input),
      { componentKind: 'ai-model', runtimeId: RUNTIME_ID },
    );
    expect(rollback.restored).toBe(true);

    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'mhcflurry-native');
    const fixturePath = path.join(fixtureDir, 'mhc-native-input.fasta');
    fs.mkdirSync(fixtureDir, { recursive: true });
    fs.writeFileSync(fixturePath, '>known-binders\nNLVPMVATVGILGFVFTLSIINFEKL\n>weak-control\nAAAAAAAAAAAA\n');
    await writeAppJson(browser, `ai-model-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, enabled: true, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: crypto.randomUUID(), name: path.basename(fixturePath), path: fixturePath,
        ext: 'fasta', size: fs.statSync(fixturePath).size, addedAt: Date.now(), folder: '',
      }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // A tracked cancellation uses the same component process path as the product run.
    const cancelled = await browser.execute(async (input) => {
      const { jobId } = await window.Liatir.invoke('lia_runtime_component_python_spawn', input);
      await window.Liatir.invoke('lia_jobs_kill', { jobId });
      return window.Liatir.invoke('lia_jobs_status', { jobId });
    }, {
      componentKind: 'ai-model', runtimeId: RUNTIME_ID,
      script: 'import time; time.sleep(120)', args: [], inputJson: {},
      workspaceId: '__test__', label: 'MHCflurry cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    await navigateInApp(browser, `/ai/${MODEL_ID}`);
    await selectFileFromPicker(browser, 'mhc-input-file', path.basename(fixturePath));
    await (await browser.$('#mhc-lengths')).setValue('8,9');
    await (await browser.$('#mhc-top')).setValue('10');
    const runButton = await browser.$('[data-testid="mhc-run"]');
    await browser.waitUntil(() => runButton.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'MHCflurry Run did not become enabled',
    });
    await runButton.click();
    await navigateInApp(browser, '/jobs');

    let productJob = null;
    await browser.waitUntil(async () => {
      productJob = (await jobs(browser)).find((job) => job.metadata?.toolId === TOOL_ID) ?? null;
      return productJob && productJob.status.type !== 'running';
    }, { timeout: 900_000, interval: 1_000, timeoutMsg: 'MHCflurry product Job did not finish' });
    if (productJob.status.type !== 'done') {
      const output = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }),
        productJob.id,
      );
      throw new Error(`MHCflurry product Job failed: ${JSON.stringify(output).slice(-6000)}`);
    }
    expect(productJob.kind).toBe('ai-python');

    const indexPath = 'workspaces/__test__/analysis-runs/index.json';
    let result = null;
    await browser.waitUntil(async () => {
      try {
        const index = JSON.parse(await browser.execute(
          async (rel) => window.Liatir.invoke('lia_app_read_text', { rel }), indexPath,
        ));
        result = index.find((run) => run.tool === TOOL_ID) ?? null;
        return result?.status === 'done';
      } catch { return false; }
    }, { timeout: 60_000, interval: 1_000, timeoutMsg: 'MHCflurry Job was not finalized into Results' });
    expect(result.outputFiles.length).toBeGreaterThan(0);
    expect(result.outputFiles.every((file) => file.producer?.id === TOOL_ID)).toBe(true);
    const persistedOutput = await readDataJson(
      browser,
      `workspaces/__test__/runs/${result.id}/result.json`,
    );
    const provenance = persistedOutput.sections.find(
      (section) => section.type === 'table' && section.label === 'Provenance',
    );
    const provenanceByField = Object.fromEntries(provenance.rows);
    expect(provenanceByField).toMatchObject({
      Mode: 'Presentation',
      'Requested top peptides': 10,
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
      'Network access': 'Disabled',
    });
    const summaryFile = result.outputFiles.find((file) => file.fieldKey === 'summaryJson');
    const summary = JSON.parse(fs.readFileSync(summaryFile.path, 'utf8'));
    expect(summary.networkAccess).toBe(false);
    expect(summary.requestedTopCount).toBe(10);
    expect(summary.predictionCount).toBeGreaterThan(0);
    expect(summary.accelerator).toEqual(expect.any(String));

    await navigateInApp(browser, `/results?run=${result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Top predictions')),
      { timeout: 20_000, timeoutMsg: 'MHCflurry Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not a validated vaccine');

    const removed = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_box_remove', input), {
      componentKind: 'ai-model', runtimeId: RUNTIME_ID, boxId: BOX_ID,
    });
    expect(removed).toBe(true);
    for (const file of result.outputFiles) expect(fs.statSync(file.path).size).toBeGreaterThan(0);

    if (PRODUCT_EVIDENCE_PATH) {
      const evidencePath = path.resolve(rootDir, PRODUCT_EVIDENCE_PATH);
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(evidencePath, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'liatir.runtime-box.product-lifecycle-evidence',
        status: 'passed', boxId: BOX_ID, modelId: MODEL_ID, runtimeId: RUNTIME_ID,
        targetId: TARGET_ID, hostEnvironment: EXPECTED_HOST_ENVIRONMENT,
        version: VERSION, jobId: productJob.id, analysisRunId: result.id,
        accelerator: summary.accelerator, resultArtifactCount: result.outputFiles.length,
        assertions: {
          install: 'passed', replacement: 'passed', rollback: 'passed', cancellation: 'passed', realInference: 'passed', jobs: 'passed',
          navigationResume: 'passed', results: 'passed', provenance: 'passed', offline: 'passed',
          experimentalDisclaimer: 'passed', removal: 'passed', resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
