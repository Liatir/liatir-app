/**
 * Runs Multicellular Simulation through Liatir's install, preflight, Job, Result and removal lifecycle:
 * PhysiCell's template model, and a settings file in the user's Data whose cells divide exactly every
 * 600 minutes, so the population it reports is known in advance.
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

const BOX_ID = 'physicell';
const MODEL_ID = 'physicell-multicellular-simulation';
const RUNTIME_ID = 'physicell-1-14-2';
const TOOL_ID = 'multicellular-simulation';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.14.2-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cpu': 'physicell-multicellular-simulation-1.14.2-beta.1-linux-x86_64-cpu-development-2026-11-04',
}[TARGET_ID];
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
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) => [names[index], Number(value)])));
}

async function openTool(browser, label) {
  await navigateInApp(browser, '/tools/multicellular-simulation');
  await browser.waitUntil(async () => (await browser.$('[data-testid="physicell-preflight"]')).isDisplayed(), {
    timeout: 20_000, timeoutMsg: `Multicellular Simulation did not render its runtime controls (${label})`,
  });
}

async function setField(browser, selector, value) {
  await browser.waitUntil(async () => (await browser.$(selector)).isExisting(), {
    timeout: 5_000, timeoutMsg: `${selector} did not appear`,
  });
  await setAppInputValue(browser, selector, String(value));
}

async function checkAndRun(browser, label) {
  await (await browser.$('[data-testid="physicell-preflight"]')).click();
  const run = await browser.$('[data-testid="physicell-run"]');
  await browser.waitUntil(() => run.isEnabled(), {
    timeout: 120_000, timeoutMsg: `${label} Run did not become enabled inside the measured envelope`,
  });
  if (await browser.execute(() => document.querySelectorAll('[data-testid="physicell-accept-beyond-evidence"]').length)) {
    throw new Error(`${label} fell outside the measured envelope`);
  }
  await run.click();
}

export const tests = [{
  name: 'simulates the template and a fixed-cycle model whose population doubles on schedule, and keeps the Results',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-physicell-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'PhysiCell Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`PhysiCell install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
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
      args: [], inputJson: {}, workspaceId: '__test__', label: 'PhysiCell cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // The validator's fixed-cycle settings, written from the installed template by the box's own Python.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'physicell-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const written = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID,
      script: fs.readFileSync(path.join(rootDir, 'runtime-boxes/fixtures/physicell/fixtures.py'), 'utf8'),
      args: [], inputJson: { template: joinRuntimePath(installed.runtimeDir, 'physicell/config/PhysiCell_settings.xml'),
        workDir: fixtureDir, marker: path.join(fixtureDir, 'unused-marker') }, timeoutSeconds: 120,
    });
    expect(written.ok).toBe(true);
    const doublingPath = path.join(fixtureDir, 'doubling.xml');
    expect(fs.existsSync(doublingPath)).toBe(true);

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{ id: crypto.randomUUID(), name: path.basename(doublingPath), path: doublingPath, ext: 'xml',
        size: fs.statSync(doublingPath).size, addedAt: Date.now(), folder: '' }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // PhysiCell's template model for one simulated day.
    await openTool(browser, 'template');
    await setField(browser, '[data-testid="physicell-max-time"]', 1440);
    await setField(browser, '[data-testid="physicell-seed"]', 1);
    await checkAndRun(browser, 'Template simulation');
    const template = await runToResult(browser, 1, 'Template simulation');
    expect(template.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });
    const templateRows = csvRows(fs.readFileSync(outputPath(template.result, 'populationCsv'), 'utf8'));
    expect(templateRows.at(-1)['Time (min)']).toBe(1440);
    expect(templateRows[0]['default live']).toBe(5);
    outputPath(template.result, 'finalCellsCsv');

    // A settings file from the user's Data: every cell divides exactly 600 minutes after its birth.
    await openTool(browser, 'settings');
    await setField(browser, '[data-testid="physicell-source"]', 'settings');
    await selectFileFromPicker(browser, 'physicell-settings', path.basename(doublingPath));
    await setField(browser, '[data-testid="physicell-seed"]', 3);
    await checkAndRun(browser, 'Fixed-cycle simulation');
    const doubling = await runToResult(browser, 2, 'Fixed-cycle simulation');
    let checked = 0;
    for (const row of csvRows(fs.readFileSync(outputPath(doubling.result, 'populationCsv'), 'utf8'))) {
      const intoPeriod = row['Time (min)'] % 600;
      if (intoPeriod < 12 || intoPeriod > 588) continue;
      expect(row['default live']).toBe(50 * 2 ** Math.floor(row['Time (min)'] / 600));
      checked += 1;
    }
    expect(checked).toBeGreaterThan(30);

    await navigateInApp(browser, `/results?run=${doubling.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Live cells over time')),
      { timeout: 20_000, timeoutMsg: 'PhysiCell Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not the tissue they stand for');

    const artifacts = [...template.result.outputFiles, ...doubling.result.outputFiles];
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
        jobId: doubling.job.id, analysisRunId: doubling.result.id, resultArtifactCount: doubling.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: template.provenance['Hardware evidence'], fixedCycleTimesChecked: checked },
        template: { jobId: template.job.id, analysisRunId: template.result.id, resultArtifactCount: template.result.outputFiles.length },
        assertions: {
          install: 'passed', cancellation: 'passed', template: 'passed', fixedCycleDoubling: 'passed', jobs: 'passed',
          results: 'passed', provenance: 'passed', offline: 'passed', interpretationNotice: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
