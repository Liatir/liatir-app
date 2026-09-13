/**
 * The product lifecycle shared by every structure AI Model: install, cancellation, a real prediction
 * of ubiquitin through the shipped page, the Job, the finalized Result, navigation back, and removal.
 *
 * Boltz-2 and Protenix run through one page and one runner module, so their lifecycles differ only in
 * identity and in the evidence they are held to. Each spec passes its own literals, which is what the
 * catalog test reads to prove a release drives the right box.
 *
 * Ubiquitin is the input because both models were scientifically validated on it, so a passing run
 * here sits inside retained measurements and needs no acknowledgement — the same rule the scientific
 * validator and the hardware estimate share.
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
} from './runtime-box.mjs';
import { navigateInApp, readDataJson, reloadLiatirApp, setAppInputValue } from './liatir-app.mjs';

const UBIQUITIN = 'MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG';
const TOOL_ID = 'biomolecular-structure-prediction';
const RUN_TIMEOUT_MS = 30 * 60 * 1000;
const INDEX_PATH = 'workspaces/__test__/analysis-runs/index.json';

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

/**
 * @param {{
 *   boxId: string, modelId: string, runtimeId: string, modelLabel: string,
 *   defaultTargetId: string, defaultVersion: string,
 *   hardwareProfiles: Record<string, string>, minimumPlddt: number, seedRow: string,
 * }} component
 */
export function structurePredictionLifecycleTest(component) {
  const targetId = process.env.LIATIR_RUNTIME_BOX_TARGET_ID ?? component.defaultTargetId;
  const version = process.env.LIATIR_RUNTIME_BOX_EXPECTED_VERSION ?? component.defaultVersion;
  const registryBaseUrl = process.env.LIATIR_RUNTIME_BOX_REGISTRY_BASE_URL ?? 'https://models.liatir.com/v1';
  const evidencePath = process.env.LIATIR_RUNTIME_BOX_PRODUCT_EVIDENCE ?? null;
  // One signed Linux payload serves native Linux and Windows through WSL2, and those are two proofs.
  const hostEnvironment = process.platform === 'win32' && targetId.startsWith('linux-') ? 'windows-wsl2' : 'native';
  // A measured envelope belongs to the target that produced it; an unmeasured target fails here
  // rather than borrowing another's numbers.
  const hardwareProfile = component.hardwareProfiles[targetId];

  return {
    name: `predicts ubiquitin with ${component.modelLabel} through the product page and keeps its Result after removal`,
    heavy: true,
    async run({ browser, expect, rootDir }) {
      if (!hardwareProfile) throw new Error(`No retained hardware profile for ${component.modelId}/${targetId}`);
      await activateCleanSandbox(browser);
      const targetCandidates = runtimeBoxTargetForNativeTest(component.modelId, targetId);
      const downloadId = `runtime-box-${component.boxId}-${Date.now()}`;
      await startRuntimeBoxInstall(browser, {
        componentKind: 'ai-model', componentId: component.modelId, boxId: component.boxId,
        channel: 'beta', registryBaseUrl, targetCandidates, downloadId,
      });
      await waitForRuntimeBoxInstall(browser, downloadId, {
        hostEnvironment, timeoutMsg: `${component.modelLabel} Runtime Box install did not complete`,
      });
      const installStatus = await runtimeBoxInstallStatus(browser, downloadId);
      const installError = await runtimeBoxInstallError(browser, downloadId);
      if (installStatus !== 'done') {
        throw new Error(`${component.modelLabel} install failed with status ${installStatus}: ${installError ?? 'unknown error'}`);
      }
      expect(installError).toBe(null);
      const installed = await runtimeBoxInstallResult(browser, downloadId);
      expect(installed.version).toBe(version);
      expect(installed.activation.hostEnvironment).toBe(hostEnvironment);

      await writeAppJson(browser, `ai-model-installs/${component.modelId}.json`, {
        status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
        runtimeBoxActivation: installed.activation, enabled: true, updatedAt: Date.now(),
      });
      await reloadLiatirApp(browser);
      await activateCleanSandbox(browser);

      // A cancelled runtime process must reach a killed Job rather than a silently abandoned run.
      const cancelled = await browser.execute(async (input) => {
        const { jobId } = await window.Liatir.invoke('lia_runtime_component_python_spawn', input);
        await window.Liatir.invoke('lia_jobs_kill', { jobId });
        return window.Liatir.invoke('lia_jobs_status', { jobId });
      }, {
        componentKind: 'ai-model', runtimeId: component.runtimeId,
        script: 'import time; time.sleep(120)', args: [], inputJson: {},
        workspaceId: '__test__', label: `${component.modelLabel} cancellation check`, metadata: {},
      });
      expect(cancelled.status.type).toBe('killed');

      await navigateInApp(browser, '/tools/structure/prediction');
      const label = await browser.$('[data-testid="structure-draft-label"]');
      await label.waitForDisplayed({ timeout: 20_000 });
      await label.setValue('Ubiquitin');
      await setAppInputValue(browser, '[data-testid="structure-model"]', component.modelId);
      await (await browser.$('[data-testid="complex-sequence"]')).setValue(UBIQUITIN);
      // No alignment exists offline, so the product asks for this explicitly rather than assuming it.
      await (await browser.$('[data-testid="complex-single-sequence"]')).click();
      await (await browser.$('[data-testid="complex-accuracy-acceptance"]')).click();
      await (await browser.$('[data-testid="structure-input-valid"]')).waitForDisplayed({ timeout: 10_000 });

      await (await browser.$('[data-testid="structure-preflight"]')).click();
      const runButton = await browser.$('[data-testid="structure-run"]');
      await browser.waitUntil(() => runButton.isEnabled(), {
        timeout: 180_000, timeoutMsg: `${component.modelLabel} Run did not become enabled for the measured input`,
      });
      expect(await browser.execute(() => document.body.innerText.includes('Run estimate from retained measurements')))
        .toBe(true);
      expect(await browser.execute(
        () => document.querySelectorAll('[data-testid="structure-accept-beyond-evidence"]').length,
      )).toBe(0);
      await runButton.click();
      await navigateInApp(browser, '/jobs');

      let productJob = null;
      await browser.waitUntil(async () => {
        productJob = (await jobs(browser)).find((job) => job.metadata?.toolId === TOOL_ID) ?? null;
        return productJob && productJob.status.type !== 'running';
      }, { timeout: RUN_TIMEOUT_MS, interval: 2_000, timeoutMsg: `${component.modelLabel} Job did not finish` });
      if (productJob.status.type !== 'done') {
        const output = await browser.execute(
          async (jobId) => window.Liatir.invoke('lia_jobs_get_output', { jobId, since: 0 }), productJob.id,
        );
        throw new Error(`${component.modelLabel} Job failed: ${JSON.stringify(output).slice(-6000)}`);
      }
      expect(productJob.kind).toBe('ai-python');

      let result = null;
      await browser.waitUntil(async () => {
        try {
          const index = JSON.parse(await browser.execute(
            async (rel) => window.Liatir.invoke('lia_app_read_text', { rel }), INDEX_PATH,
          ));
          result = index.find((run) => run.tool === TOOL_ID) ?? null;
          return result?.status === 'done' || result?.status === 'error';
        } catch { return false; }
      }, { timeout: 120_000, interval: 1_000, timeoutMsg: `${component.modelLabel} Job was not finalized into Results` });
      if (result.status !== 'done') throw new Error(`${component.modelLabel} Result failed: ${result.error}`);
      expect(result.outputFiles.every((file) => file.producer?.id === TOOL_ID)).toBe(true);
      const structure = result.outputFiles.find((file) => file.fieldKey === 'predictedStructure');
      if (!structure) throw new Error(`${component.modelLabel} produced no predicted structure`);
      expect(fs.statSync(structure.path).size).toBeGreaterThan(0);

      const persisted = await readDataJson(browser, `workspaces/__test__/runs/${result.id}/result.json`);
      const provenance = Object.fromEntries(persisted.sections.find(
        (section) => section.type === 'table' && section.label === 'Provenance',
      ).rows);
      expect(provenance).toMatchObject({
        'AI Model': component.modelLabel,
        Seed: component.seedRow,
        Alignment: 'None — predicted from sequence alone',
        'Network access': 'Disabled',
        'Hardware evidence': hardwareProfile,
        'Within measured evidence': 'Yes',
        'Runtime Box': `${version} · ${targetId}`,
        'Runtime Box archive SHA-256': installed.activation.release.archive.sha256,
      });
      const plddt = Number(persisted.sections.find((section) => section.type === 'stats')
        .items.find((item) => item.label === 'Confidence (pLDDT)').value);
      // The bound the scientific validator holds this model to: a lifecycle that passed on a
      // misfolded structure would prove the plumbing and nothing about what it delivers.
      expect(plddt).toBeGreaterThan(component.minimumPlddt);

      // The Result belongs to the draft that produced it, so returning to the tool shows it again.
      await navigateInApp(browser, '/jobs');
      await navigateInApp(browser, '/tools/structure/prediction');
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('Confidence (pLDDT)')),
        { timeout: 30_000, timeoutMsg: `${component.modelLabel} Result did not render after navigation` },
      );
      await navigateInApp(browser, `/results?run=${result.id}`);
      await browser.waitUntil(
        async () => browser.execute(() => document.body.innerText.includes('computational models, not experimental structures')),
        { timeout: 30_000, timeoutMsg: `${component.modelLabel} Result did not render in Results` },
      );

      const artifactsBeforeRemoval = runtimeBoxResultArtifactSnapshot(result.outputFiles);
      const removed = await browser.execute(async (input) => window.Liatir.invoke('lia_runtime_box_remove', input), {
        componentKind: 'ai-model', runtimeId: component.runtimeId, boxId: component.boxId,
      });
      expect(removed).toBe(true);
      expect(runtimeBoxResultArtifactSnapshot(result.outputFiles)).toEqual(artifactsBeforeRemoval);

      if (evidencePath) {
        const absolute = path.resolve(rootDir, evidencePath);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, `${JSON.stringify({
          schemaVersion: 1,
          kind: 'liatir.runtime-box.product-lifecycle-evidence',
          status: 'passed', boxId: component.boxId, modelId: component.modelId, runtimeId: component.runtimeId,
          targetId, hostEnvironment, version, jobId: productJob.id, analysisRunId: result.id,
          accelerator: 'CUDA', resultArtifactCount: result.outputFiles.length,
          // The exact bytes this lifecycle exercised, so the record ties back to one build.
          release: {
            archiveSha256: installed.activation.release.archive.sha256,
            archiveSizeBytes: installed.activation.release.archive.sizeBytes,
            installedSizeBytes: installed.sizeBytes,
            signingKeyIds: installed.activation.signedRelease.signatures.map((entry) => entry.keyId),
          },
          measured: { hardwareProfileId: hardwareProfile, plddt, seed: provenance.Seed },
          assertions: {
            install: 'passed', cancellation: 'passed', measuredEstimate: 'passed', realPrediction: 'passed',
            confidence: 'passed', jobs: 'passed', results: 'passed', provenance: 'passed', offline: 'passed',
            navigationResume: 'passed', removal: 'passed', resultArtifactsSurvivedRemoval: 'passed',
          },
        }, null, 2)}\n`);
      }
    },
  };
}
