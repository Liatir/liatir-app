/**
 * Runs Receptor Preparation, Molecular Docking and Docked Complex through Liatir's install, preflight,
 * Job, Result and removal lifecycle on the official AutoDock Vina 1IEP example shipped inside the box.
 *
 * The tools share one signed box and form one workflow: the receptor the first prepares is the
 * receptor the second docks into, and the third takes the best pose with that receptor towards a
 * simulation. The docked imatinib pose is held to the crystal structure by the box's own RDKit, so
 * the product gate checks the science and not only that a Job finished.
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

const BOX_ID = 'molecular-docking';
const MODEL_ID = 'autodock-vina-molecular-docking';
const RUNTIME_ID = 'molecular-docking-vina-1-2-7';
const PREPARATION_TOOL_ID = 'docking-receptor-preparation';
const DOCKING_TOOL_ID = 'molecular-docking';
const COMPLEX_TOOL_ID = 'docking-selected-complex';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'linux-x86_64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '1.2.7-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const EXPECTED_HOST_ENVIRONMENT = process.platform === 'win32' && TARGET_ID.startsWith('linux-')
  ? 'windows-wsl2'
  : 'native';
// Named per target: a measured envelope belongs to the release and machine that produced it.
const EXPECTED_HARDWARE_PROFILE = {
  'linux-x86_64-cpu': 'autodock-vina-molecular-docking-1.2.7-beta.1-linux-x86_64-cpu-production-2026-11-05',
}[TARGET_ID];
const REDOCKING_RMSD_ANGSTROM = 2.0;
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

export const tests = [{
  name: 'prepares the 1IEP receptor, redocks imatinib within 2 Å of the crystal, builds the docked complex, and keeps every Result',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({ dataPath: await window.Liatir.desktop.fs.data.path() }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-docking-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: EXPECTED_HOST_ENVIRONMENT, timeoutMsg: 'Docking Runtime Box install did not complete',
    });
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`Docking install failed with status ${installStatus}: ${await runtimeBoxInstallError(browser, downloadId)}`);
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
      args: [], inputJson: {}, workspaceId: '__test__', label: 'Docking cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    // The official example ships inside the box. Copying it through the box's own Python keeps the
    // path translation honest under WSL2, where the box sees a Linux path and the app a Windows one.
    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'docking-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const receptorSource = joinRuntimePath(installed.runtimeDir, 'reference/vina-1iep/1iep_receptorH.pdb');
    const ligandSource = joinRuntimePath(installed.runtimeDir, 'reference/vina-1iep/1iep_ligand.sdf');
    const receptorPath = path.join(fixtureDir, '1iep_receptorH.pdb');
    const ligandPath = path.join(fixtureDir, '1iep_ligand.sdf');
    // The same crystal pose again under its own name: the picker helper matches an option by the
    // start of its text, and the Ligands field already shows 1iep_ligand.sdf once it is chosen.
    const referencePath = path.join(fixtureDir, 'crystal-imatinib.sdf');
    const copied = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: String.raw`
import json, sys
from pathlib import Path
payload = json.loads(sys.stdin.read() or "{}")
for source, target in payload["pairs"]:
    Path(target).write_bytes(Path(source).read_bytes())
print(json.dumps({"copied": len(payload["pairs"])}))
`, args: [], inputJson: { pairs: [[receptorSource, receptorPath], [ligandSource, ligandPath], [ligandSource, referencePath]] },
      timeoutSeconds: 120,
    });
    expect(copied.ok).toBe(true);

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await dataFiles(browser, [receptorPath, ligandPath, referencePath]);
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    // Receptor Preparation.
    await navigateInApp(browser, '/tools/molecular-docking/receptor-preparation');
    const check = await browser.$('[data-testid="docking-preflight"]');
    await browser.waitUntil(() => check.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Receptor Preparation did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'docking-input-structure', path.basename(receptorPath));
    await check.click();
    const run = await browser.$('[data-testid="docking-run"]');
    await browser.waitUntil(() => run.isEnabled(), {
      timeout: 120_000, timeoutMsg: 'Receptor Preparation Run did not become enabled inside the measured envelope',
    });
    expect(await browser.execute(
      () => document.querySelectorAll('[data-testid="docking-accept-beyond-evidence"]').length,
    )).toBe(0);
    await run.click();
    const preparation = await runToResult(browser, PREPARATION_TOOL_ID, 'Receptor Preparation');
    expect(preparation.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });
    const report = JSON.parse(fs.readFileSync(outputPath(preparation.result, 'preparationReport'), 'utf8'));
    expect(report.changes.map((change) => change.step))
      .toEqual(['remove-input-hydrogens', 'add-missing-atoms', 'add-hydrogens']);
    const receptorPdbqt = outputPath(preparation.result, 'receptorPdbqt');
    const preparedPdb = outputPath(preparation.result, 'preparedReceptor');

    // Molecular Docking against the receptor just prepared, around the crystal ligand.
    await dataFiles(browser, [receptorPath, ligandPath, referencePath, receptorPdbqt, preparedPdb]);
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);
    await navigateInApp(browser, '/tools/molecular-docking/docking');
    const dockCheck = await browser.$('[data-testid="docking-preflight"]');
    await browser.waitUntil(() => dockCheck.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Molecular Docking did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'docking-receptor-pdbqt', path.basename(receptorPdbqt));
    await selectFileFromPicker(browser, 'docking-ligands', path.basename(ligandPath));
    await selectFileFromPicker(browser, 'docking-reference-ligand', path.basename(referencePath));
    await selectFileFromPicker(browser, 'docking-receptor-structure', path.basename(preparedPdb));
    await dockCheck.click();
    const dockRun = await browser.$('[data-testid="docking-run"]');
    await browser.waitUntil(() => dockRun.isEnabled(), {
      timeout: 120_000, timeoutMsg: 'Molecular Docking Run did not become enabled inside the measured envelope',
    });
    await dockRun.click();
    const docking = await runToResult(browser, DOCKING_TOOL_ID, 'Molecular Docking');
    expect(docking.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
    });
    const summary = JSON.parse(fs.readFileSync(outputPath(docking.result, 'dockingSummary'), 'utf8'));
    expect(summary.dockedLigands).toBe(1);
    expect(summary.rejectedLigands).toEqual([]);
    expect(summary.database.storedLigands).toBe(1);
    const posesSdf = outputPath(docking.result, 'dockedPoses');
    outputPath(docking.result, 'bestPoseComplex');
    outputPath(docking.result, 'screeningDatabase');

    // The science, checked by the box's own RDKit: the top pose against the crystal ligand.
    const measured = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_component_python_run', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: String.raw`
import json, sys
from rdkit import Chem
from rdkit.Chem import rdMolAlign
payload = json.loads(sys.stdin.read() or "{}")
crystal = Chem.RemoveHs(Chem.MolFromMolFile(payload["crystal"], removeHs=False))
top = next(mol for mol in Chem.SDMolSupplier(payload["poses"], removeHs=False) if mol.GetProp("liatir_pose_rank") == "1")
print(json.dumps({"rmsd": rdMolAlign.CalcRMS(Chem.RemoveHs(top), crystal),
                  "score": float(top.GetProp("vina_score_kcal_per_mol"))}))
`, args: [], inputJson: { crystal: ligandSource, poses: posesSdf }, timeoutSeconds: 120,
    });
    expect(measured.ok).toBe(true);
    const pose = JSON.parse(measured.stdout.trim().split('\n').pop());
    expect(pose.rmsd).toBeLessThan(REDOCKING_RMSD_ANGSTROM);
    expect(pose.score).toBe(summary.ranking[0].scoreKcalPerMol);

    // Docked Complex: the top pose with the receptor it was docked into, ready for OpenMM.
    await dataFiles(browser, [receptorPath, ligandPath, referencePath, receptorPdbqt, preparedPdb, posesSdf]);
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);
    await navigateInApp(browser, '/tools/molecular-docking/complex');
    const complexCheck = await browser.$('[data-testid="docking-preflight"]');
    await browser.waitUntil(() => complexCheck.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Docked Complex did not render its runtime controls',
    });
    await selectFileFromPicker(browser, 'complex-poses', path.basename(posesSdf));
    await selectFileFromPicker(browser, 'complex-receptor-pdbqt', path.basename(receptorPdbqt));
    await selectFileFromPicker(browser, 'complex-receptor-structure', path.basename(preparedPdb));
    await complexCheck.click();
    const complexRun = await browser.$('[data-testid="docking-run"]');
    await browser.waitUntil(() => complexRun.isEnabled(), {
      timeout: 120_000, timeoutMsg: 'Docked Complex Run did not become enabled inside the measured envelope',
    });
    await complexRun.click();
    const complex = await runToResult(browser, COMPLEX_TOOL_ID, 'Docked Complex');
    expect(complex.provenance).toMatchObject({
      'Network access': 'Disabled',
      'Hardware evidence': EXPECTED_HARDWARE_PROFILE,
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
    });
    const complexSummary = JSON.parse(fs.readFileSync(outputPath(complex.result, 'summaryJson'), 'utf8'));
    // The page offers the best pose first; it is the one checked against the crystal above.
    expect(complexSummary.poseRank).toBe(1);
    expect(complexSummary.scoreKcalPerMol).toBe(pose.score);
    expect(complexSummary.complex.ligandAtoms).toBeGreaterThan(0);
    outputPath(complex.result, 'complexPdb');
    outputPath(complex.result, 'ligandSdf');

    await navigateInApp(browser, `/results?run=${docking.result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Ligand ranking')),
      { timeout: 20_000, timeoutMsg: 'Molecular Docking Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText)).toContain('not measured binding affinities');

    const artifacts = [...preparation.result.outputFiles, ...docking.result.outputFiles, ...complex.result.outputFiles];
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
        jobId: docking.job.id, analysisRunId: docking.result.id, resultArtifactCount: docking.result.outputFiles.length,
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: { hardwareProfileId: docking.provenance['Hardware evidence'], topPoseRmsdAngstrom: pose.rmsd,
          topScoreKcalPerMol: pose.score },
        preparation: { jobId: preparation.job.id, analysisRunId: preparation.result.id,
          resultArtifactCount: preparation.result.outputFiles.length },
        dockedComplex: { jobId: complex.job.id, analysisRunId: complex.result.id,
          resultArtifactCount: complex.result.outputFiles.length, ligandAtoms: complexSummary.complex.ligandAtoms,
          receptorAtoms: complexSummary.complex.receptorAtoms },
        assertions: {
          install: 'passed', cancellation: 'passed', officialFixture: 'passed', receptorPreparation: 'passed',
          docking: 'passed', redockingWithinTwoAngstrom: 'passed', dockedComplex: 'passed', jobs: 'passed', results: 'passed',
          provenance: 'passed', offline: 'passed', interpretationNotice: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
