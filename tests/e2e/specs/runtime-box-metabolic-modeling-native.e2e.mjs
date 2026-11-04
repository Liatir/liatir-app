/**
 * Runs Metabolic Modeling through Liatir's install, preflight, Job, Result and removal lifecycle on the
 * E. coli core model COBRApy ships, copied into the user's Data.
 *
 * Flux balance analysis is held to COBRApy's documented optimum and gene deletions to the essential
 * genes COBRApy's own tests name, both confirmed in the run by a second solver.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
  activateCleanSandbox,
  runtimeBoxInstallError,
  runtimeBoxInstallResult,
  runtimeBoxInstallStatus,
  runtimeBoxResultArtifactSnapshot,
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

const BOX_ID = 'metabolic-modeling';
const MODEL_ID = 'cobrapy-metabolic-modeling';
const RUNTIME_ID = 'metabolic-modeling-cobrapy-0-32-1';
const TOOL_ID = 'metabolic-modeling';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '0.32.1-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cpu': 'cobrapy-metabolic-modeling-0.32.1-beta.1-linux-x86_64-cpu-development-2026-11-04',
}[TARGET_ID];
// COBRApy's documentation ("Simulating with FBA") and tests/test_flux_analysis (test_essential_genes).
const DOCUMENTED_TEXTBOOK_GROWTH = 0.8739215069684307;
const ESSENTIAL_GENES = ['b0720', 'b1136', 'b1779', 'b2415', 'b2416', 'b2779', 'b2926'];
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const indexPath = 'workspaces/__test__/analysis-runs/index.json';

async function writeAppJson(browser, rel, value) {
  await browser.execute(async ({ file, content }) => window.Liatir.invoke('lia_app_write_text', {
    rel: file, content: JSON.stringify(content, null, 2), createDirs: true,
  }), { file: rel, content: value });
}

async function jobs(browser) {
  return browser.execute(async () => window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }));
}

async function runToResult(browser, count, label) {
  await navigateInApp(browser, '/jobs');
  let job = null;
  await browser.waitUntil(async () => {
    const mine = (await jobs(browser)).filter((entry) => entry.metadata?.toolId === TOOL_ID);
    job = mine.length >= count ? mine.find((entry) => entry.status.type === 'running') ?? mine[0] : null;
    return job && mine.length >= count && mine.every((entry) => entry.status.type !== 'running');
  }, { timeout: RUN_TIMEOUT_MS, interval: 1_000, timeoutMsg: `${label} Job did not finish` });
  const failed = (await jobs(browser)).find((entry) => entry.metadata?.toolId === TOOL_ID && entry.status.type !== 'done');
  if (failed) {
    const output = await browser.execute(
      async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }), failed.id,
    );
    throw new Error(`${label} Job failed: ${JSON.stringify(output).slice(-6000)}`);
  }
  let result = null;
  await browser.waitUntil(async () => {
    try {
      const index = JSON.parse(await browser.execute(
        async (rel) => window.Liatir.invoke('lia_app_read_text', { rel }), indexPath,
      ));
      const done = index.filter((run) => run.tool === TOOL_ID && run.status === 'done');
      result = done.length >= count ? done.sort((left, right) => right.startedAt - left.startedAt)[0] : null;
      return Boolean(result);
    } catch { return false; }
  }, { timeout: 60_000, interval: 1_000, timeoutMsg: `${label} was not finalized into Results` });
  if (!result.outputFiles.every((file) => file.producer?.id === TOOL_ID)) {
    throw new Error(`${label} Result files are not attributed to ${TOOL_ID}`);
  }
  const output = await readDataJson(browser, `workspaces/__test__/runs/${result.id}/result.json`);
  const provenance = Object.fromEntries(output.sections.find(
    (section) => section.type === 'table' && section.label === 'Provenance',
  ).rows);
  return { job, result, output, provenance };
}

function outputPath(result, fieldKey) {
  const file = result.outputFiles.find((entry) => entry.fieldKey === fieldKey);
  if (!file) throw new Error(`Missing output ${fieldKey}`);
  if (fs.statSync(file.path).size <= 0) throw new Error(`Empty output ${fieldKey}`);
  return file.path;
}

async function checkAndRun(browser, label) {
  await (await browser.$('[data-testid="metabolic-preflight"]')).click();
  const run = await browser.$('[data-testid="metabolic-run"]');
  await browser.waitUntil(() => run.isEnabled(), {
    timeout: 120_000, timeoutMsg: `${label} Run did not become enabled inside the measured envelope`,
  });
  if (await browser.execute(() => document.querySelectorAll('[data-testid="metabolic-accept-beyond-evidence"]').length)) {
    throw new Error(`${label} fell outside the measured envelope`);
  }
  await run.click();
}

export const tests = [{
  name: 'reproduces the E. coli core optimum and essential genes with two solvers, and keeps both Results',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-metabolic-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'Metabolic Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`Metabolic install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
    }
    const installed = await runtimeBoxInstallResult(browser, downloadId);
    expect(installed.version).toBe(VERSION);
    expect(installed.activation.hostEnvironment).toBe(EXPECTED_HOST_ENVIRONMENT);

    const cancelled = await browser.execute(async (input) => {
      const { jobId } = await window.Liatir.invoke('lia_runtime_component_python_spawn', input);
      await window.Liatir.invoke('lia_jobs_kill', { jobId });
      return window.Liatir.invoke('lia_jobs_status', { jobId });
    }, {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: 'import time; time.sleep(120)',
      args: [], inputJson: {}, workspaceId: '__test__', label: 'Metabolic cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // COBRApy's packaged E. coli core model, copied into the user's Data through the box's own Python.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'metabolic-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const source = joinRuntimePath(installed.runtimeDir, 'venv/lib/python3.11/site-packages/cobra/data/textbook.xml.gz');
    const modelPath = path.join(fixtureDir, 'e-coli-core.xml.gz');
    const copied = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: String.raw`
import json, sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
Path(payload["target"]).write_bytes(Path(payload["source"]).read_bytes())
print(json.dumps({"copied": 1}))
`, args: [], inputJson: { source, target: modelPath }, timeoutSeconds: 120,
    });
    expect(copied.ok).toBe(true);

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{ id: crypto.randomUUID(), name: path.basename(modelPath), path: modelPath, ext: 'gz',
        size: fs.statSync(modelPath).size, addedAt: Date.now(), folder: '' }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // Flux balance analysis, confirmed by GLPK.
    await navigateInApp(browser, '/tools/metabolic-modeling');
    const check = await browser.$('[data-testid="metabolic-preflight"]');
    await browser.waitUntil(() => check.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Metabolic Modeling did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'metabolic-model', path.basename(modelPath));
    await checkAndRun(browser, 'Flux balance analysis');
    const fba = await runToResult(browser, 1, 'Flux balance analysis');
    expect(fba.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });
    expect(fba.provenance['Second solver']).toMatch(/^GLPK agreed on 1 values/u);
    const fbaSummary = JSON.parse(fs.readFileSync(outputPath(fba.result, 'summaryJson'), 'utf8'));
    expect(Math.abs(fbaSummary.objective.value - DOCUMENTED_TEXTBOOK_GROWTH)).toBeLessThan(1e-9);

    // Single gene deletions on the same model.
    await navigateInApp(browser, '/tools/metabolic-modeling');
    await browser.waitUntil(async () => (await browser.$('[data-testid="metabolic-preflight"]')).isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Metabolic Modeling did not render again',
    });
    await selectFileFromPicker(browser, 'metabolic-model', path.basename(modelPath));
    await (await browser.$('[data-testid="metabolic-analysis"]')).selectByAttribute('value', 'gene-deletion');
    await checkAndRun(browser, 'Gene deletions');
    const deletions = await runToResult(browser, 2, 'Gene deletions');
    const deletionSummary = JSON.parse(fs.readFileSync(outputPath(deletions.result, 'summaryJson'), 'utf8'));
    expect([...deletionSummary.deletions.essential].sort()).toEqual(ESSENTIAL_GENES);
    outputPath(deletions.result, 'deletionsCsv');

    await navigateInApp(browser, `/results?run=${deletions.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Essential genes (7)')),
      { timeout: 20_000, timeoutMsg: 'Metabolic Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('is a hypothesis about the organism');

    const artifacts = [...fba.result.outputFiles, ...deletions.result.outputFiles];
    const before = runtimeBoxResultArtifactSnapshot(artifacts);
    const removed = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_box_remove', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, boxId: BOX_ID,
    });
    expect(removed).toBe(true);
    expect(runtimeBoxResultArtifactSnapshot(artifacts)).toEqual(before);

    if (PRODUCT_EVIDENCE_PATH) {
      const evidencePath = path.resolve(rootDir, PRODUCT_EVIDENCE_PATH);
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(evidencePath, `${JSON.stringify({
        schemaVersion: 1, kind: 'liatir.runtime-box.product-lifecycle-evidence', status: 'passed',
        boxId: BOX_ID, modelId: MODEL_ID, runtimeId: RUNTIME_ID, targetId: TARGET_ID,
        hostEnvironment: EXPECTED_HOST_ENVIRONMENT, version: VERSION, accelerator: 'CPU',
        jobId: deletions.job.id, analysisRunId: deletions.result.id, resultArtifactCount: deletions.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: fba.provenance['Hardware evidence'], textbookGrowth: fbaSummary.objective.value,
          essentialGenes: deletionSummary.deletions.essential },
        fba: { jobId: fba.job.id, analysisRunId: fba.result.id, resultArtifactCount: fba.result.outputFiles.length },
        assertions: {
          install: 'passed', cancellation: 'passed', fluxBalance: 'passed', geneDeletion: 'passed',
          secondSolverAgreement: 'passed', jobs: 'passed', results: 'passed', provenance: 'passed', offline: 'passed',
          interpretationNotice: 'passed', removal: 'passed', resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
