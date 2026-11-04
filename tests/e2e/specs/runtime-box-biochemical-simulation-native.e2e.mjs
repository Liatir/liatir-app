/**
 * Runs Biochemical Simulation through Liatir's install, preflight, Job, Result and removal lifecycle:
 * a built-in PySB model deterministically and stochastically, and a BNGL model BioNetGen ships, copied
 * into the user's Data.
 *
 * The deterministic run is held to the model's exact solution and the stochastic one to its stationary
 * Poisson distribution; the BNGL run must report the file's actions as read and not run.
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
  setAppInputValue,
} from '../support/liatir-app.mjs';

const BOX_ID = 'biochemical-simulation';
const MODEL_ID = 'pysb-biochemical-simulation';
const RUNTIME_ID = 'biochemical-simulation-pysb-1-17-0';
const TOOL_ID = 'biochemical-simulation';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.17.0-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cpu': 'pysb-biochemical-simulation-1.17.0-beta.1-linux-x86_64-cpu-development-2026-11-04',
}[TARGET_ID];
// synth_deg with kA_syn = 2: A(t) = 20 - 19 e^(-0.1 t); stationary copy number Poisson with mean 10.
const SYNTHESIS = { kA_syn: 2, kA_deg: 0.1, A0: 1 };
const SSA_RUNS = 400;
const SSA_MEAN_BOUND = 4 * Math.sqrt(10 / SSA_RUNS);
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

function csvRows(text) {
  const [header, ...rows] = text.trim().split(/\r?\n/u);
  const names = header.split(',');
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], value])));
}

async function openTool(browser, label) {
  await navigateInApp(browser, '/tools/biochemical-simulation');
  await browser.waitUntil(async () => (await browser.$('[data-testid="biochemical-preflight"]')).isDisplayed(), {
    timeout: 20_000, timeoutMsg: `Biochemical Simulation did not render its runtime controls (${label})`,
  });
}

/** Sets a field once the page has rendered it: some appear only after another choice. */
async function setField(browser, selector, value) {
  await browser.waitUntil(async () => (await browser.$(selector)).isExisting(), {
    timeout: 5_000, timeoutMsg: `${selector} did not appear`,
  });
  await setAppInputValue(browser, selector, String(value));
}

async function checkAndRun(browser, label) {
  await (await browser.$('[data-testid="biochemical-preflight"]')).click();
  const run = await browser.$('[data-testid="biochemical-run"]');
  await browser.waitUntil(() => run.isEnabled(), {
    timeout: 300_000, timeoutMsg: `${label} Run did not become enabled inside the measured envelope`,
  });
  if (await browser.execute(() => document.querySelectorAll('[data-testid="biochemical-accept-beyond-evidence"]').length)) {
    throw new Error(`${label} fell outside the measured envelope`);
  }
  await run.click();
}

export const tests = [{
  name: 'simulates a model deterministically and stochastically and a BNGL file without its actions, and keeps the Results',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-biochemical-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'Biochemical Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`Biochemical install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
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
      args: [], inputJson: {}, workspaceId: '__test__', label: 'Biochemical cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // BioNetGen's Repressilator model, copied into the user's Data through the box's own Python.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'biochemical-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const source = joinRuntimePath(installed.runtimeDir, 'bionetgen-release/BioNetGen-2.9.3/Models2/Repressilator.bngl');
    const modelPath = path.join(fixtureDir, 'Repressilator.bngl');
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
      files: [{ id: crypto.randomUUID(), name: path.basename(modelPath), path: modelPath, ext: 'bngl',
        size: fs.statSync(modelPath).size, addedAt: Date.now(), folder: '' }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // Deterministic: synthesis and degradation with a parameter changed, against its exact solution.
    await openTool(browser, 'deterministic');
    await setField(browser, '[data-testid="biochemical-builtin"]', 'synth_deg');
    await setField(browser, '[data-testid="biochemical-tend"]', 50);
    await setField(browser, '#biochemical-parameters', `kA_syn ${SYNTHESIS.kA_syn}`);
    await checkAndRun(browser, 'Deterministic simulation');
    const ode = await runToResult(browser, 1, 'Deterministic simulation');
    expect(ode.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Parameter changes': `kA_syn = ${SYNTHESIS.kA_syn}`,
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });
    let exactWorst = 0;
    for (const row of csvRows(fs.readFileSync(outputPath(ode.result, 'observablesCsv'), 'utf8'))) {
      const steady = SYNTHESIS.kA_syn / SYNTHESIS.kA_deg;
      const exact = steady + (SYNTHESIS.A0 - steady) * Math.exp(-SYNTHESIS.kA_deg * Number(row.Time));
      exactWorst = Math.max(exactWorst, Math.abs(Number(row.A_total) - exact));
    }
    expect(exactWorst).toBeLessThan(1e-6);

    // Stochastic: the same model's stationary distribution, Poisson with mean 10.
    await openTool(browser, 'stochastic');
    await setField(browser, '[data-testid="biochemical-builtin"]', 'synth_deg');
    await setField(browser, '[data-testid="biochemical-method"]', 'ssa');
    await setField(browser, '[data-testid="biochemical-tend"]', 200);
    await setField(browser, '[data-testid="biochemical-runs"]', SSA_RUNS);
    await setField(browser, '#biochemical-parameters', `kA_syn ${SYNTHESIS.kA_syn}`);
    await checkAndRun(browser, 'Stochastic simulation');
    const ssa = await runToResult(browser, 2, 'Stochastic simulation');
    const finals = csvRows(fs.readFileSync(outputPath(ssa.result, 'runsCsv'), 'utf8'))
      .filter((row) => Number(row.Time) === 200).map((row) => Number(row.A_total));
    expect(finals.length).toBe(SSA_RUNS);
    const mean = finals.reduce((sum, value) => sum + value, 0) / finals.length;
    expect(Math.abs(mean - 10)).toBeLessThan(SSA_MEAN_BOUND);
    expect(ssa.provenance.Method).toMatch(/^Gillespie direct method \(BioNetGen run_network\), 400 runs with seeds 1 to 400$/u);

    // A BNGL file from the user's Data: generated and simulated here, its own actions read and not run.
    await openTool(browser, 'BNGL');
    await setField(browser, '[data-testid="biochemical-source"]', 'bngl');
    await selectFileFromPicker(browser, 'biochemical-bngl', path.basename(modelPath));
    await checkAndRun(browser, 'BNGL simulation');
    const bngl = await runToResult(browser, 3, 'BNGL simulation');
    const bnglSummary = JSON.parse(fs.readFileSync(outputPath(bngl.result, 'summaryJson'), 'utf8'));
    expect(bnglSummary.network).toMatchObject({ species: 15, reactions: 30 });
    outputPath(bngl.result, 'networkNet');

    await navigateInApp(browser, `/results?run=${bngl.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Not run from the BNGL file')),
      { timeout: 20_000, timeoutMsg: 'Biochemical Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not the cell they stand for');

    const artifacts = [...ode.result.outputFiles, ...ssa.result.outputFiles, ...bngl.result.outputFiles];
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
        jobId: bngl.job.id, analysisRunId: bngl.result.id, resultArtifactCount: bngl.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: ode.provenance['Hardware evidence'], exactSolutionMaxAbsoluteError: exactWorst,
          ssaRuns: SSA_RUNS, ssaMean: mean, bnglNetwork: bnglSummary.network },
        deterministic: { jobId: ode.job.id, analysisRunId: ode.result.id, resultArtifactCount: ode.result.outputFiles.length },
        stochastic: { jobId: ssa.job.id, analysisRunId: ssa.result.id, resultArtifactCount: ssa.result.outputFiles.length },
        assertions: {
          install: 'passed', cancellation: 'passed', deterministic: 'passed', stochastic: 'passed', bngl: 'passed',
          bnglActionsNotRun: 'passed', jobs: 'passed', results: 'passed', provenance: 'passed', offline: 'passed',
          interpretationNotice: 'passed', removal: 'passed', resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
