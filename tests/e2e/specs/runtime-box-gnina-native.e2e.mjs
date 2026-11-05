/**
 * Runs Neural Pose Rescoring through Liatir's install, preflight, Job, Result and removal lifecycle.
 * Installing fetches GNINA's own release asset beside the box; the run rescores Liatir Molecular
 * Docking's 1IEP redocking, whose poses' distances from crystal imatinib are known in advance.
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

const BOX_ID = 'gnina';
const MODEL_ID = 'gnina-pose-rescoring';
const RUNTIME_ID = 'gnina-1-3-3';
const TOOL_ID = 'neural-pose-rescoring';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cuda12.8';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.3.3-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cuda12.8': 'gnina-pose-rescoring-1.3.3-beta.1-linux-x86_64-cuda12.8-development-2026-11-05',
}[TARGET_ID];
// The redocking success criterion the scientific validator holds GNINA's top pose to.
const REDOCKING_RMSD_ANGSTROM = 2.0;
const RUN_TIMEOUT_MS = 20 * 60 * 1000;
const indexPath = 'workspaces/__test__/analysis-runs/index.json';

// From inside the installed box: reports the GNINA program the installer placed, and copies the
// official 1IEP receptor into the user's Data.
const INSPECT_BOX = String.raw`
import json, os, pathlib, shutil, sys
p = json.load(sys.stdin)
root = pathlib.Path(sys.executable).resolve().parents[2]
gnina = root / "gnina/bin/gnina"
shutil.copyfile(root / "reference/vina-1iep/1iep_receptor.pdbqt", pathlib.Path(p["workDir"]) / "1iep_receptor.pdbqt")
print(json.dumps({"gninaBytes": gnina.stat().st_size, "gninaExecutable": os.access(gnina, os.X_OK)}))
`;

async function writeAppJson(browser, rel, value) {
  await browser.execute(async ({ file, content }) => window.Liatir.invoke('lia_app_write_text', {
    rel: file, content: JSON.stringify(content, null, 2), createDirs: true,
  }), { file: rel, content: value });
}

async function jobs(browser) {
  return browser.execute(async () => window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }));
}

async function runToResult(browser, label) {
  await navigateInApp(browser, '/jobs');
  let job = null;
  await browser.waitUntil(async () => {
    const mine = (await jobs(browser)).filter((entry) => entry.metadata?.toolId === TOOL_ID);
    job = mine[0] ?? null;
    return job && mine.every((entry) => entry.status.type !== 'running');
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
      result = index.find((run) => run.tool === TOOL_ID && run.status === 'done') ?? null;
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
  return rows.map((row) => Object.fromEntries(row.split(',').map((value, index) =>
    [names[index], names[index] === 'ligand' ? value : Number(value)])));
}

export const tests = [{
  name: 'installs GNINA from its own release, rescores the 1IEP redocking with its top pose on the crystal, and keeps the Results',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-gnina-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'GNINA Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`GNINA install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
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
      args: [], inputJson: {}, workspaceId: '__test__', label: 'GNINA cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // Liatir Molecular Docking's own 1IEP redocking, and the receptor it was docked into.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'gnina-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const fixtures = path.join(rootDir, 'runtime-boxes/fixtures/gnina');
    const posesPath = path.join(fixtureDir, '1iep-redocking-poses.sdf');
    fs.copyFileSync(path.join(fixtures, '1iep-redocking-poses.sdf'), posesPath);
    const inspected = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: INSPECT_BOX, args: [],
      inputJson: { workDir: fixtureDir }, timeoutSeconds: 60,
    });
    expect(inspected.ok).toBe(true);
    // GNINA's own release asset, which the installer downloaded, verified and marked executable.
    expect(JSON.parse(inspected.stdout.trim().split('\n').at(-1))).toEqual({ gninaBytes: 2_056_131_000, gninaExecutable: true });
    const receptorPath = path.join(fixtureDir, '1iep_receptor.pdbqt');
    const rmsd = new Map(JSON.parse(fs.readFileSync(path.join(fixtures, 'provenance.json'), 'utf8'))
      .fixtures['1iep-redocking-poses.sdf'].poseRows.map((row) => [row.poseRank, row.rmsdToCrystalAngstrom]));

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [posesPath, receptorPath].map((file) => ({ id: crypto.randomUUID(), name: path.basename(file), path: file,
        ext: path.extname(file).slice(1), size: fs.statSync(file).size, addedAt: Date.now(), folder: '' })),
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    await navigateInApp(browser, '/tools/neural-pose-rescoring');
    await browser.waitUntil(async () => (await browser.$('[data-testid="gnina-preflight"]')).isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Neural Pose Rescoring did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'gnina-poses', path.basename(posesPath));
    await selectFileFromPicker(browser, 'gnina-receptor', path.basename(receptorPath));
    await (await browser.$('[data-testid="gnina-preflight"]')).click();
    const run = await browser.$('[data-testid="gnina-run"]');
    await browser.waitUntil(() => run.isEnabled(), {
      timeout: 120_000, timeoutMsg: 'Run did not become enabled inside the measured envelope',
    });
    if (await browser.execute(() => document.querySelectorAll('[data-testid="gnina-accept-beyond-evidence"]').length)) {
      throw new Error('The 1IEP redocking fell outside the measured envelope');
    }
    await run.click();
    const rescoring = await runToResult(browser, '1IEP rescoring');
    expect(rescoring.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
      'GNINA program SHA-256': '3340c1f49cd3c7c84d8699182a1c6af13c7fa2a22448d1204640446106f72172',
    });
    const rows = csvRows(fs.readFileSync(outputPath(rescoring.result, 'scoresCsv'), 'utf8'));
    expect(rows.map((row) => row.poseRank)).toEqual([1, 2, 3, 4, 5, 6]);
    const top = rows.find((row) => row.cnnRank === 1);
    expect(rmsd.get(top.poseRank)).toBeLessThanOrEqual(REDOCKING_RMSD_ANGSTROM);
    const rescored = fs.readFileSync(outputPath(rescoring.result, 'rescoredPosesSdf'), 'utf8');
    expect(rescored.match(/<gnina_cnn_pose_score>/gu)?.length).toBe(6);

    await navigateInApp(browser, `/results?run=${rescoring.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Best pose per ligand')),
      { timeout: 20_000, timeoutMsg: 'GNINA Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('a rescored pose is still a hypothesis to test');

    const artifacts = rescoring.result.outputFiles;
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
        hostEnvironment: EXPECTED_HOST_ENVIRONMENT, version: VERSION, accelerator: rescoring.provenance.GPU,
        jobId: rescoring.job.id, analysisRunId: rescoring.result.id, resultArtifactCount: rescoring.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: rescoring.provenance['Hardware evidence'], gninaTopPoseRank: top.poseRank,
          gninaTopPoseRmsdAngstrom: rmsd.get(top.poseRank) },
        assertions: {
          install: 'passed', onDemandAsset: 'passed', cancellation: 'passed', rescoring: 'passed', jobs: 'passed',
          results: 'passed', provenance: 'passed', offline: 'passed', interpretationNotice: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
