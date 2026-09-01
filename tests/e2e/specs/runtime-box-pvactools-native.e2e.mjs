/** Exercises pVACseq through its Tool Runtime root, shipped UI runner, Jobs, Results, and removal. */
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

const BOX_ID = 'pvactools-pvacseq';
const MODEL_ID = 'griffithlab-pvactools-pvacseq';
const RUNTIME_ID = 'oncology-pvactools-pvacseq-7-1-2';
const TOOL_ID = 'neoantigen-prioritization';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '7.1.2-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';

const REDUCE_FIXTURE_SCRIPT = String.raw`
import json
from pathlib import Path
import pysam
import sys

payload = json.load(sys.stdin)
source = pysam.VariantFile(payload["source"])
plain = Path(payload["plain"])
with pysam.VariantFile(str(plain), "w", header=source.header) as output:
    count = 0
    for record in source:
        output.write(record)
        count += 1
        if count == 25:
            break
if count != 25:
    raise SystemExit("Official pVACseq fixture has fewer than 25 variants.")
pysam.tabix_compress(str(plain), payload["compressed"], force=True)
pysam.tabix_index(payload["compressed"], preset="vcf", force=True)
plain.unlink()
print(json.dumps({"variantCount": count, "path": payload["compressed"]}))
`;

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
  name: 'runs the reduced official pVACseq fixture offline and preserves its Result',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({
      dataPath: await window.Liatir.desktop.fs.data.path(),
    }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-pvactools-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT,
      timeoutMsg: 'pVACtools Runtime Box install did not complete',
    });
    const installError = await runtimeBoxInstallError(browser, downloadId);
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`pVACtools install failed with status ${installStatus}: ${installError ?? 'unknown error'}`);
    }
    expect(installError).toBe(null);
    const installed = await runtimeBoxInstallResult(browser, downloadId);
    expect(installed.version).toBe(VERSION);
    expect(installed.activation.hostEnvironment).toBe(EXPECTED_HOST_ENVIRONMENT);

    const replacementId = `runtime-box-pvactools-replacement-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates,
      downloadId: replacementId,
    });
    await waitForRuntimeBoxInstall(browser, replacementId, {
      archiveSizeBytes: installed.activation.release.archive.sizeBytes,
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT,
      timeoutMsg: 'pVACtools Runtime Box replacement did not complete',
    });
    const replacementError = await runtimeBoxInstallError(browser, replacementId);
    const replacementStatus = await runtimeBoxInstallStatus(browser, replacementId);
    if (replacementStatus !== 'done') {
      throw new Error(`pVACtools replacement failed with status ${replacementStatus}: ${replacementError ?? 'unknown error'}`);
    }
    expect(replacementError).toBe(null);
    const replacement = await runtimeBoxInstallResult(browser, replacementId);
    expect(replacement.rollbackAvailable).toBe(true);
    const rollback = await browser.execute(
      async (input) => window.Liatir.invoke('lia_runtime_box_rollback', input),
      { componentKind: 'tool-runtime', runtimeId: RUNTIME_ID },
    );
    expect(rollback.restored).toBe(true);

    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'pvactools-native');
    const fixturePath = path.join(fixtureDir, 'official-reduced.vcf.gz');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const officialVcf = joinRuntimePath(
      installed.runtimeDir,
      'source/pvactools-wheel/pvactools/tools/pvacseq/example_data/annotated.expression.vcf.gz',
    );
    const reduced = await browser.execute(async (input) => window.Liatir.invoke(
      'lia_runtime_component_python_run', input,
    ), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: REDUCE_FIXTURE_SCRIPT,
      args: [], inputJson: {
        source: officialVcf,
        plain: path.join(fixtureDir, 'official-reduced.vcf'),
        compressed: fixturePath,
      },
      timeoutSeconds: 120,
    });
    expect(reduced.ok).toBe(true);
    expect(JSON.parse(reduced.stdout.trim())).toMatchObject({ variantCount: 25, path: fixturePath });

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: crypto.randomUUID(), name: path.basename(fixturePath), path: fixturePath,
        ext: 'vcf.gz', size: fs.statSync(fixturePath).size, addedAt: Date.now(), folder: '',
      }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    const cancelled = await browser.execute(async (input) => {
      const { jobId } = await window.Liatir.invoke('lia_runtime_component_python_spawn', input);
      await window.Liatir.invoke('lia_jobs_kill', { jobId });
      return window.Liatir.invoke('lia_jobs_status', { jobId });
    }, {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID,
      script: 'import time; time.sleep(120)', args: [], inputJson: {},
      workspaceId: '__test__', label: 'pVACtools cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    await navigateInApp(browser, '/tools/oncology/neoantigen-prioritization');
    await selectFileFromPicker(browser, 'pvac-input-vcf', path.basename(fixturePath));
    await (await browser.$('#pvac-tumor')).setValue('HCC1395_TUMOR_DNA');
    await (await browser.$('#pvac-normal')).setValue('HCC1395_NORMAL_DNA');
    await (await browser.$('#pvac-alleles')).setValue('HLA-A*29:02,HLA-B*45:01,HLA-B*82:02');
    await (await browser.$('#pvac-lengths')).setValue('9');
    await (await browser.$('#pvac-top')).setValue('50');
    const runButton = await browser.$('[data-testid="pvac-run"]');
    await browser.waitUntil(() => runButton.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'pVACseq Run did not become enabled',
    });
    await runButton.click();
    await navigateInApp(browser, '/jobs');

    let productJob = null;
    await browser.waitUntil(async () => {
      productJob = (await jobs(browser)).find((job) => job.metadata?.toolId === TOOL_ID) ?? null;
      return productJob && productJob.status.type !== 'running';
    }, { timeout: 1_800_000, interval: 1_000, timeoutMsg: 'pVACseq product Job did not finish' });
    if (productJob.status.type !== 'done') {
      const output = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }),
        productJob.id,
      );
      throw new Error(`pVACseq product Job failed: ${JSON.stringify(output).slice(-6000)}`);
    }
    expect(productJob.kind).toBe('tool-runtime-python');

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
    }, { timeout: 60_000, interval: 1_000, timeoutMsg: 'pVACseq Job was not finalized into Results' });
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
      'pVACtools': '7.1.2',
      MHCflurry: '2.0.6',
      Predictors: 'MHCflurry, MHCflurryEL',
      'Requested candidate peptides': 50,
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
      'Network access': 'Disabled',
    });
    const summaryFile = result.outputFiles.find((file) => file.fieldKey === 'summaryJson');
    const summary = JSON.parse(fs.readFileSync(summaryFile.path, 'utf8'));
    expect(summary).toMatchObject({
      pvactoolsVersion: '7.1.2', mhcflurryVersion: '2.0.6',
      predictors: ['MHCflurry', 'MHCflurryEL'], networkAccess: false,
      passOnly: false, requestedTopCount: 50, proximalInputInspection: null,
    });
    expect(summary.inputInspection.variantCount).toBe(25);
    expect(summary.allEpitopeCount).toBeGreaterThan(0);
    expect(summary.finiteScores).toBe(true);

    await navigateInApp(browser, `/results?run=${result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Prioritized candidates')),
      { timeout: 20_000, timeoutMsg: 'pVACseq Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not a validated vaccine');

    const removed = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_box_remove', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, boxId: BOX_ID,
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
        accelerator: 'CPU', resultArtifactCount: result.outputFiles.length,
        assertions: {
          install: 'passed', replacement: 'passed', rollback: 'passed', officialFixture: 'passed', cancellation: 'passed', realInference: 'passed',
          jobs: 'passed', navigationResume: 'passed', results: 'passed', provenance: 'passed',
          offline: 'passed', experimentalDisclaimer: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
