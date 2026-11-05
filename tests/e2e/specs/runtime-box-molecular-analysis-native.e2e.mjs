/**
 * Runs Trajectory Analysis and Interaction Fingerprint through Liatir's install, preflight, Job, Result
 * and removal lifecycle on the protein-ligand trajectory ProLIF ships, copied into the user's Data.
 *
 * The fingerprint is held to the interactions ProLIF's own test suite pins on that trajectory, and the
 * user's data directory is checked afterwards: reading a trajectory must never write beside it.
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

const BOX_ID = 'molecular-analysis';
const MODEL_ID = 'mdanalysis-molecular-analysis';
const RUNTIME_ID = 'molecular-analysis-mdanalysis-2-11-0';
const TRAJECTORY_TOOL_ID = 'trajectory-analysis';
const FINGERPRINT_TOOL_ID = 'interaction-fingerprint';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '2.11.0-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cpu': 'mdanalysis-molecular-analysis-2.11.0-beta.1-linux-x86_64-cpu-development-2026-11-04',
}[TARGET_ID];
// ProLIF 2.2.3 tests/test_fingerprint.py (test_run_residues) pins these on frame 0 of its trajectory.
const PROLIF_FRAME_ZERO = [['VAL201.A', 'Hydrophobic'], ['PHE351.B', 'Hydrophobic']];
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

async function dataFiles(browser, paths) {
  await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
    files: paths.map((filePath) => ({
      id: crypto.randomUUID(), name: path.basename(filePath), path: filePath,
      ext: path.extname(filePath).slice(1), size: fs.statSync(filePath).size, addedAt: Date.now(), folder: '',
    })),
    folders: [],
  });
}

async function runToResult(browser, toolId, label) {
  await navigateInApp(browser, '/jobs');
  let job = null;
  await browser.waitUntil(async () => {
    job = (await jobs(browser)).find((entry) => entry.metadata?.toolId === toolId) ?? null;
    return job && job.status.type !== 'running';
  }, { timeout: RUN_TIMEOUT_MS, interval: 1_000, timeoutMsg: `${label} Job did not finish` });
  if (job.status.type !== 'done') {
    const output = await browser.execute(
      async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }), job.id,
    );
    throw new Error(`${label} Job failed: ${JSON.stringify(output).slice(-6000)}`);
  }
  if (job.kind !== 'tool-runtime-python') throw new Error(`${label} ran as ${job.kind}`);
  let result = null;
  await browser.waitUntil(async () => {
    try {
      const index = JSON.parse(await browser.execute(
        async (rel) => window.Liatir.invoke('lia_app_read_text', { rel }), indexPath,
      ));
      result = index.find((run) => run.tool === toolId) ?? null;
      return result?.status === 'done';
    } catch { return false; }
  }, { timeout: 60_000, interval: 1_000, timeoutMsg: `${label} was not finalized into Results` });
  if (!result.outputFiles.every((file) => file.producer?.id === toolId)) {
    throw new Error(`${label} Result files are not attributed to ${toolId}`);
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
  const check = await browser.$('[data-testid="analysis-preflight"]');
  await check.click();
  const run = await browser.$('[data-testid="analysis-run"]');
  await browser.waitUntil(() => run.isEnabled(), {
    timeout: 120_000, timeoutMsg: `${label} Run did not become enabled inside the measured envelope`,
  });
  if (await browser.execute(() => document.querySelectorAll('[data-testid="analysis-accept-beyond-evidence"]').length)) {
    throw new Error(`${label} fell outside the measured envelope`);
  }
  await run.click();
}

export const tests = [{
  name: 'analyses a protein-ligand trajectory and its interactions, writes nothing beside the data, and keeps both Results',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-analysis-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'Analysis Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`Analysis install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
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
      args: [], inputJson: {}, workspaceId: '__test__', label: 'Analysis cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // ProLIF's packaged trajectory, copied into the user's Data through the box's own Python so the
    // path translation stays honest under WSL2, where the box sees a Linux path and the app a Windows one.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'analysis-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const data = joinRuntimePath(installed.runtimeDir, 'venv/lib/python3.11/site-packages/prolif/data');
    const topologyPath = path.join(fixtureDir, 'prolif-top.pdb');
    const trajectoryPath = path.join(fixtureDir, 'prolif-traj.xtc');
    const copied = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: String.raw`
import json, sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
for source, target in payload["pairs"]:
    Path(target).write_bytes(Path(source).read_bytes())
print(json.dumps({"copied": len(payload["pairs"])}))
`, args: [], inputJson: { pairs: [[joinRuntimePath(data, 'top.pdb'), topologyPath], [joinRuntimePath(data, 'traj.xtc'), trajectoryPath]] },
      timeoutSeconds: 120,
    });
    expect(copied.ok).toBe(true);
    const dataBefore = fs.readdirSync(fixtureDir).sort();

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await dataFiles(browser, [topologyPath, trajectoryPath]);
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // Trajectory Analysis with the ligand the preflight finds in the topology.
    await navigateInApp(browser, '/tools/molecular-analysis/trajectory');
    const check = await browser.$('[data-testid="analysis-preflight"]');
    await browser.waitUntil(() => check.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Trajectory Analysis did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'analysis-topology', path.basename(topologyPath));
    await selectFileFromPicker(browser, 'analysis-trajectory', path.basename(trajectoryPath));
    await setAppInputValue(browser, '[data-testid="analysis-ligand"]', 'resname LIG');
    await checkAndRun(browser, 'Trajectory Analysis');
    const trajectory = await runToResult(browser, TRAJECTORY_TOOL_ID, 'Trajectory Analysis');
    expect(trajectory.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });
    const summary = JSON.parse(fs.readFileSync(outputPath(trajectory.result, 'summaryJson'), 'utf8'));
    expect(summary.framesAnalysed).toBe(250);
    expect(summary.periodic).toBe(true);
    expect(summary.rmsd.map((item) => item.label)).toEqual(['Protein C-alpha', 'Ligand']);
    outputPath(trajectory.result, 'rmsdCsv');
    outputPath(trajectory.result, 'rmsfCsv');

    // Interaction Fingerprint on every 25th frame of the same trajectory.
    await navigateInApp(browser, '/tools/molecular-analysis/fingerprint');
    const fingerprintCheck = await browser.$('[data-testid="analysis-preflight"]');
    await browser.waitUntil(() => fingerprintCheck.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Interaction Fingerprint did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'analysis-topology', path.basename(topologyPath));
    await selectFileFromPicker(browser, 'analysis-trajectory', path.basename(trajectoryPath));
    await setAppInputValue(browser, '[data-testid="analysis-ligand"]', 'resname LIG');
    await setAppInputValue(browser, '#analysis-stride', '25');
    await checkAndRun(browser, 'Interaction Fingerprint');
    const fingerprint = await runToResult(browser, FINGERPRINT_TOOL_ID, 'Interaction Fingerprint');
    expect(fingerprint.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
    });
    const rows = fs.readFileSync(outputPath(fingerprint.result, 'interactionsCsv'), 'utf8').trim().split(/\r?\n/u)
      .slice(1).map((line) => line.split(','));
    expect(new Set(rows.map((row) => row[0])).size).toBe(10);
    for (const [residue, interaction] of PROLIF_FRAME_ZERO) {
      expect(rows.some((row) => row[0] === '0' && row[3] === residue && row[4] === interaction)).toBe(true);
    }

    // Reading the trajectory twice left the user's data exactly as it was.
    expect(fs.readdirSync(fixtureDir).sort()).toEqual(dataBefore);

    await navigateInApp(browser, `/results?run=${fingerprint.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Most frequent interactions')),
      { timeout: 20_000, timeoutMsg: 'Interaction Fingerprint Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not a measured binding contribution');

    const artifacts = [...trajectory.result.outputFiles, ...fingerprint.result.outputFiles];
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
        jobId: fingerprint.job.id, analysisRunId: fingerprint.result.id, resultArtifactCount: fingerprint.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: fingerprint.provenance['Hardware evidence'], rmsd: summary.rmsd,
          fingerprintFrames: 10, prolifFrameZero: PROLIF_FRAME_ZERO },
        trajectory: { jobId: trajectory.job.id, analysisRunId: trajectory.result.id,
          resultArtifactCount: trajectory.result.outputFiles.length },
        assertions: {
          install: 'passed', cancellation: 'passed', trajectoryAnalysis: 'passed', interactionFingerprint: 'passed',
          prolifReferenceInteractions: 'passed', inputDataUnchanged: 'passed', jobs: 'passed', results: 'passed',
          provenance: 'passed', offline: 'passed', interpretationNotice: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
