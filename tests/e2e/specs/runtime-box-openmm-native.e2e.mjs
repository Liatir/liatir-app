/**
 * Runs the signed OpenMM Tool Runtime through Liatir's install, preflight, Job, Result, and removal lifecycle.
 *
 * The generic install/replace/rollback contract is covered by the shared Runtime Box lifecycle spec. This
 * focused gate exists because Molecular Relaxation is the first Phase 3 tool with a three-state hardware
 * decision — inside retained measurements, past them but confirmable, or impossible on this machine — and
 * because its Result carries scientific provenance (force field, seed, energy reduction) that no other
 * tool produces. Both reachable states are exercised here on the same input.
 *
 * The input is the official `test-ala-3.pdb` shipped inside the installed box, so the run reproduces a fixture
 * the retained macOS CPU measurement was taken from rather than an invented structure.
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

const BOX_ID = 'openmm';
const MODEL_ID = 'openmm-openmm';
const RUNTIME_ID = 'molecular-simulation-openmm-8-5-1';
const TOOL_ID = 'molecular-relaxation';
const TARGET_ID = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? 'macos-aarch64-cpu';
const VERSION = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? '8.5.1-beta.1';
const REGISTRY_BASE_URL = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL
  ?? 'https://models.liatir.com/v1';
const PRODUCT_EVIDENCE_PATH = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
const OFFICIAL_FIXTURE = 'source/openmmforcefields/openmmforcefields/data/test-ala-3.pdb';
const RUN_TIMEOUT_MS = 15 * 60 * 1000;

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
  name: 'confirms an unmeasured run, relaxes the official fixture, and preserves its Result',
  heavy: true,
  async run({ browser, expect, rootDir }) {
    await activateCleanSandbox(browser);
    const storage = await browser.execute(async () => ({
      dataPath: await window.Liatir.desktop.fs.data.path(),
    }));
    const targetCandidates = runtimeBoxTargetForNativeTest(MODEL_ID, TARGET_ID);
    const downloadId = `runtime-box-openmm-${Date.now()}`;
    await startRuntimeBoxInstall(browser, {
      componentKind: 'tool-runtime', componentId: MODEL_ID, boxId: BOX_ID,
      channel: 'beta', registryBaseUrl: REGISTRY_BASE_URL, targetCandidates, downloadId,
    });
    await waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: 'native',
      timeoutMsg: 'OpenMM Runtime Box install did not complete',
    });
    const installError = await runtimeBoxInstallError(browser, downloadId);
    const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
    if (installStatus !== 'done') {
      throw new Error(`OpenMM install failed with status ${installStatus}: ${installError ?? 'unknown error'}`);
    }
    expect(installError).toBe(null);
    const installed = await runtimeBoxInstallResult(browser, downloadId);
    expect(installed.version).toBe(VERSION);
    expect(installed.activation.hostEnvironment).toBe('native');

    // A cancelled runtime process must reach a killed Job rather than a silently abandoned run.
    const cancelled = await browser.execute(async (input) => {
      const { jobId } = await window.Liatir.invoke('lia_runtime_component_python_spawn', input);
      await window.Liatir.invoke('lia_jobs_kill', { jobId });
      return window.Liatir.invoke('lia_jobs_status', { jobId });
    }, {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID,
      script: 'import time; time.sleep(120)', args: [], inputJson: {},
      workspaceId: '__test__', label: 'OpenMM cancellation check', metadata: {},
    });
    expect(cancelled.status.type).toBe('killed');

    const fixtureDir = path.join(storage.dataPath, 'workspaces', '__test__', 'openmm-native');
    fs.mkdirSync(fixtureDir, { recursive: true });
    const joinRuntimePath = installed.runtimeDir.startsWith('/') ? path.posix.join : path.join;
    const officialSource = joinRuntimePath(installed.runtimeDir, OFFICIAL_FIXTURE);
    const officialPath = path.join(fixtureDir, 'test-ala-3.pdb');
    const copied = await browser.execute(async (input) => window.Liatir.invoke(
      'lia_runtime_component_python_run', input,
    ), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, script: String.raw`
import json
import sys
from pathlib import Path

payload = json.loads(sys.stdin.read() or "{}")
source = Path(payload["source"]).read_text(encoding="utf-8")
Path(payload["official"]).write_text(source, encoding="utf-8")
print(json.dumps({
    "atomCount": sum(1 for line in source.splitlines() if line.startswith(("ATOM", "HETATM"))),
}))
`, args: [], inputJson: { source: officialSource, official: officialPath },
      timeoutSeconds: 120,
    });
    expect(copied.ok).toBe(true);
    expect(JSON.parse(copied.stdout.trim())).toMatchObject({ atomCount: 33 });

    await writeAppJson(browser, `tool-runtime-installs/${MODEL_ID}.json`, {
      status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
      runtimeBoxActivation: installed.activation, updatedAt: Date.now(),
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: crypto.randomUUID(), name: path.basename(officialPath), path: officialPath,
        ext: 'pdb', size: fs.statSync(officialPath).size, addedAt: Date.now(), folder: '',
      }],
      folders: [],
    });
    await reloadLiatirApp(browser);
    await activateCleanSandbox(browser);

    await navigateInApp(browser, '/tools/molecular-simulation/relaxation');
    const checkButton = await browser.$('[data-testid="openmm-preflight"]');
    await browser.waitUntil(() => checkButton.isDisplayed(), {
      timeout: 20_000, timeoutMsg: 'Molecular Relaxation page did not render its runtime controls',
    });

    await selectFileFromPicker(browser, 'openmm-input-structure', path.basename(officialPath));

    // More minimization steps than any retained sample measured. That must not block the run: the
    // screen has to say so and ask once. Steps are the cheapest dimension to push past the
    // envelope, and this configuration is never actually run.
    await setAppInputValue(browser, '#openmm-iterations', '6000');
    await checkButton.click();
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('larger than anything measured')),
      { timeout: 120_000, timeoutMsg: 'OpenMM preflight did not report an unmeasured run size' },
    );
    const runButton = await browser.$('[data-testid="openmm-run"]');
    expect(await runButton.isEnabled()).toBe(false);

    const acknowledgement = await browser.$('[data-testid="openmm-accept-beyond-evidence"]');
    await acknowledgement.click();
    await browser.waitUntil(() => runButton.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'Acknowledging an unmeasured run did not enable Run',
    });
    // Withdrawing the acknowledgement closes it again, so the gate is real rather than decorative.
    await acknowledgement.click();
    await browser.waitUntil(async () => !await runButton.isEnabled(), {
      timeout: 20_000, timeoutMsg: 'Withdrawing the acknowledgement did not disable Run',
    });

    // Back inside the measured envelope: no acknowledgement is asked for at all.
    await setAppInputValue(browser, '#openmm-iterations', '5000');
    await checkButton.click();
    await browser.waitUntil(() => runButton.isEnabled(), {
      timeout: 120_000, timeoutMsg: 'OpenMM Run did not become enabled for the measured fixture',
    });
    expect(await browser.execute(
      () => document.querySelectorAll('[data-testid="openmm-accept-beyond-evidence"]').length,
    )).toBe(0);
    await runButton.click();
    await navigateInApp(browser, '/jobs');

    let productJob = null;
    await browser.waitUntil(async () => {
      productJob = (await jobs(browser)).find((job) => job.metadata?.toolId === TOOL_ID) ?? null;
      return productJob && productJob.status.type !== 'running';
    }, { timeout: RUN_TIMEOUT_MS, interval: 1_000, timeoutMsg: 'Molecular Relaxation Job did not finish' });
    if (productJob.status.type !== 'done') {
      const output = await browser.execute(
        async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }),
        productJob.id,
      );
      throw new Error(`Molecular Relaxation Job failed: ${JSON.stringify(output).slice(-6000)}`);
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
    }, { timeout: 60_000, interval: 1_000, timeoutMsg: 'Molecular Relaxation Job was not finalized into Results' });
    expect(result.outputFiles.length).toBeGreaterThan(0);
    expect(result.outputFiles.every((file) => file.producer?.id === TOOL_ID)).toBe(true);

    const persistedOutput = await readDataJson(
      browser,
      `workspaces/__test__/runs/${result.id}/result.json`,
    );
    const provenance = persistedOutput.sections.find(
      (section) => section.type === 'table' && section.label === 'Provenance',
    );
    expect(Object.fromEntries(provenance.rows)).toMatchObject({
      'Tool Runtime': 'OpenMM 8.5.1',
      'Protein force field': 'amber19-all',
      'Water model': 'No explicit solvent',
      'Ligand force field': 'No ligand SDF',
      Seed: 17,
      'Network access': 'Disabled',
      'Hardware evidence': 'openmm-8.5.1-beta.1-macos-aarch64-cpu-development-2026-09-09',
      'Within measured evidence': 'Yes',
      'Runtime Box': `${VERSION} · ${TARGET_ID}`,
      'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
    });

    const metricsFile = result.outputFiles.find((file) => file.fieldKey === 'metricsJson');
    const metrics = JSON.parse(fs.readFileSync(metricsFile.path, 'utf8'));
    expect(metrics).toMatchObject({
      mode: 'relaxation', atomCount: 33, preparedAtomCount: 33, networkAccess: false,
    });
    expect(Number.isFinite(metrics.initialPotentialEnergyKilojoulePerMole)).toBe(true);
    expect(metrics.finalPotentialEnergyKilojoulePerMole)
      .toBeLessThan(metrics.initialPotentialEnergyKilojoulePerMole);

    await navigateInApp(browser, `/results?run=${result.id}`);
    await browser.waitUntil(
      async () => browser.execute(() => document.body.innerText.includes('Energy reduction')),
      { timeout: 20_000, timeoutMsg: 'Molecular Relaxation Result did not render after navigation' },
    );
    expect(await browser.execute(() => document.body.innerText))
      .toContain('does not prove binding affinity, molecular stability, clinical benefit');

    const resultArtifactsBeforeRemoval = runtimeBoxResultArtifactSnapshot(result.outputFiles);
    const removed = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_box_remove', input), {
      componentKind: 'tool-runtime', runtimeId: RUNTIME_ID, boxId: BOX_ID,
    });
    expect(removed).toBe(true);
    expect(runtimeBoxResultArtifactSnapshot(result.outputFiles)).toEqual(resultArtifactsBeforeRemoval);

    if (PRODUCT_EVIDENCE_PATH) {
      const evidencePath = path.resolve(rootDir, PRODUCT_EVIDENCE_PATH);
      fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
      fs.writeFileSync(evidencePath, `${JSON.stringify({
        schemaVersion: 1,
        kind: 'liatir.runtime-box.product-lifecycle-evidence',
        status: 'passed', boxId: BOX_ID, modelId: MODEL_ID, runtimeId: RUNTIME_ID,
        targetId: TARGET_ID, hostEnvironment: 'native',
        version: VERSION, jobId: productJob.id, analysisRunId: result.id,
        accelerator: 'CPU', resultArtifactCount: result.outputFiles.length,
        // The exact bytes this lifecycle exercised. Without them the record cannot be tied back to
        // one build, and a later run of a different archive would look indistinguishable.
        release: {
          archiveSha256: installed.activation.release.archive.sha256,
          archiveSizeBytes: installed.activation.release.archive.sizeBytes,
          installedSizeBytes: installed.sizeBytes,
          signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
        },
        measured: {
          hardwareProfileId: Object.fromEntries(provenance.rows)['Hardware evidence'],
          preparedAtomCount: metrics.preparedAtomCount,
          initialPotentialEnergyKilojoulePerMole: metrics.initialPotentialEnergyKilojoulePerMole,
          finalPotentialEnergyKilojoulePerMole: metrics.finalPotentialEnergyKilojoulePerMole,
          energyReductionKilojoulePerMole: metrics.energyReductionKilojoulePerMole,
        },
        assertions: {
          install: 'passed', cancellation: 'passed', unmeasuredRunConfirmable: 'passed',
          officialFixture: 'passed', realRelaxation: 'passed', energyReduced: 'passed',
          jobs: 'passed', navigationResume: 'passed', results: 'passed', provenance: 'passed',
          offline: 'passed', interpretationNotice: 'passed', removal: 'passed',
          resultArtifactsSurvivedRemoval: 'passed',
        },
      }, null, 2)}\n`);
    }
  },
}];
