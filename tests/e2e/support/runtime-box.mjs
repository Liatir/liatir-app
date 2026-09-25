/**
 * Support helpers for the Runtime Box end-to-end tests.
 */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeBoxAuthoringInput } from '../../../scripts/runtime-box/authoring-input.mjs';
import {
  navigateInApp,
  openSandboxWorkspace,
  readDataJson,
  reloadLiatirApp,
  selectFileFromPicker,
} from './liatir-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime-boxes/catalog.json'), 'utf8'));

const MIN_INSTALL_TIMEOUT_MS = 180_000;
const INSTALL_SIZE_DISCOVERY_TIMEOUT_MS = 30_000;
// The native allowance covers signature verification, multi-gigabyte ZIP extraction, self-test,
// and activation.
const NATIVE_INSTALL_FIXED_OVERHEAD_MS = 180_000;
// WSL2 additionally crosses the Windows/Linux boundary before extracting and activating the box.
// Run 33522895351 reached 1,161,379,840 of 1,167,379,910 bytes with no install error at the old
// 320-second bound, so this measured path needs a separate bounded allowance.
const WSL2_INSTALL_FIXED_OVERHEAD_MS = 360_000;
// The self-hosted release runners download over a home connection, so the rate has to sit below
// its dips, not its typical speed. Eight MiB/s was the typical speed: run 36021697255 reached
// 403,279,872 of 459,529,412 bytes with no install error when that bound expired (about 1.7 MB/s),
// on a link that measured 8.1 MB/s minutes later. This bound catches a hang, not a slow download.
const CONSERVATIVE_DOWNLOAD_BYTES_PER_SECOND = 2 * 1024 * 1024;

/** Sizes an install bound from observed archive bytes and the selected host boundary. */
export function runtimeBoxInstallTimeoutMs(archiveSizeBytes, hostEnvironment = 'native') {
  const bytes = Number(archiveSizeBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return MIN_INSTALL_TIMEOUT_MS;
  const downloadMs = Math.ceil((bytes / CONSERVATIVE_DOWNLOAD_BYTES_PER_SECOND) * 1_000);
  const fixedOverheadMs = hostEnvironment === 'windows-wsl2'
    ? WSL2_INSTALL_FIXED_OVERHEAD_MS
    : NATIVE_INSTALL_FIXED_OVERHEAD_MS;
  return Math.max(MIN_INSTALL_TIMEOUT_MS, fixedOverheadMs + downloadMs);
}

/** Captures the bytes that must remain unchanged when an installed Runtime Box is removed. */
export function runtimeBoxResultArtifactSnapshot(outputFiles) {
  return outputFiles.map((file) => {
    const contents = fs.readFileSync(file.path);
    return {
      path: file.path,
      sizeBytes: contents.byteLength,
      sha256: createHash('sha256').update(contents).digest('hex'),
    };
  });
}

/** Returns candidate metadata from the same checked catalog and recipe used by the release. */
export function runtimeBoxTargetForNativeTest(modelId, targetId) {
  const model = CATALOG.components.find((candidate) => candidate.modelId === modelId);
  const target = model?.targets.find((candidate) => candidate.targetId === targetId);
  if (!target) throw new Error(`Unsupported native Runtime Box test target: ${modelId}/${targetId}`);
  const recipe = resolveRuntimeBoxAuthoringInput({
    recipeId: target.recipeId,
    recipesDir: path.join(ROOT, 'runtime-boxes', 'recipes'),
    scrollsDir: path.join(ROOT, 'runtime-boxes', 'scrolls'),
    expectedBoxId: model.boxId,
    expectedTargetId: target.targetId,
  }).document;
  const candidate = {
    target: { ...target.target },
    hostEnvironments: [...target.hostEnvironments],
    minRamGb: recipe.compatibility.minRamGb,
  };
  if (recipe.compatibility.minNvidiaDriverVersion) {
    candidate.minNvidiaDriverVersion = recipe.compatibility.minNvidiaDriverVersion;
  }
  return [candidate];
}

/**
 * Pulls a Python script out of the TypeScript file that ships it.
 *
 * The point is that the test then exercises the *actual shipped* script rather than a copy kept in sync by
 * hand — the same technique the validation scripts use. A copy would eventually drift, and the test would keep
 * passing against code nobody runs.
 */
export function readEmbeddedPythonScript(rootDir, relativePath, exportName) {
  const source = fs.readFileSync(path.join(rootDir, relativePath), 'utf8');
  const prefix = `export const ${exportName} = String.raw\``;
  const start = source.indexOf(prefix);
  const end = source.lastIndexOf('\`;');
  if (start < 0 || end <= start) throw new Error(`Cannot extract ${exportName} from ${relativePath}`);
  return source.slice(start + prefix.length, end);
}

/**
 * Opens the app's Sandbox workspace inside the runner's isolated, empty app-data root.
 *
 * The E2E runner gives every process a unique native app-data root, while the product workspace store owns
 * Sandbox creation and activation. Driving that real product flow keeps the in-memory store and persisted state
 * synchronized; writing its private files behind the store can deadlock a Windows WebDriver script.
 */
export async function activateCleanSandbox(browser) {
  await openSandboxWorkspace(browser);
}

export async function startRuntimeBoxInstall(browser, input, options = {}) {
  return browser.execute(async (installInput) => {
    const { request, cancelAfterBytes } = installInput;
    window.__liatirRuntimeBoxInstall ??= {};
    const state = {
      status: 'running',
      progress: [],
      result: null,
      error: null,
      unlisten: null,
      cancelRequested: false,
      cancelAccepted: null,
    };
    window.__liatirRuntimeBoxInstall[request.downloadId] = state;
    state.unlisten = await window.Liatir.desktop.events.on(
      `managed:progress:${request.downloadId}`,
      (progress) => {
        state.progress.push(progress);
        if (
          cancelAfterBytes !== null
          && !state.cancelRequested
          && !progress.done
          && progress.bytesDownloaded >= cancelAfterBytes
        ) {
          state.cancelRequested = true;
          void window.Liatir.invoke('lia_managed_download_cancel', { id: request.downloadId })
            .then((accepted) => { state.cancelAccepted = accepted; })
            .catch((error) => {
              state.cancelAccepted = false;
              state.error = String(error?.message ?? error);
            });
        }
      },
    );
    const generic = typeof request.componentKind === 'string';
    const command = generic ? 'lia_runtime_box_install' : 'lia_ai_runtime_box_install';
    const payload = generic ? {
      componentKind: request.componentKind,
      componentId: request.componentId ?? request.modelId,
      boxId: request.boxId,
      channel: request.channel,
      registryBaseUrl: request.registryBaseUrl,
      targetCandidates: request.targetCandidates,
      downloadId: request.downloadId,
    } : request;
    void window.Liatir.invoke(command, payload)
      .then((result) => {
        state.status = 'done';
        state.result = result;
      })
      .catch((error) => {
        state.status = 'error';
        state.error = String(error?.message ?? error);
      })
      .finally(() => state.unlisten?.());
    return true;
  }, {
    request: input,
    cancelAfterBytes: options.cancelAfterBytes ?? null,
  });
}

export async function runtimeBoxInstallStatus(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.status ?? null,
    downloadId,
  );
}

export async function runtimeBoxInstallError(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.error ?? null,
    downloadId,
  );
}

export async function runtimeBoxInstallResult(browser, downloadId) {
  return browser.execute(
    (id) => window.__liatirRuntimeBoxInstall?.[id]?.result ?? null,
    downloadId,
  );
}

/** Waits for one install with a size-aware bound and preserves actionable timeout diagnostics. */
export async function waitForRuntimeBoxInstall(browser, downloadId, options = {}) {
  const timeoutMsg = options.timeoutMsg ?? 'Runtime Box install did not complete';
  let archiveSizeBytes = options.archiveSizeBytes;
  if (!Number.isFinite(Number(archiveSizeBytes)) || Number(archiveSizeBytes) <= 0) {
    try {
      await browser.waitUntil(async () => {
        const status = await runtimeBoxInstallStatus(browser, downloadId);
        if (status !== null && status !== 'running') return true;
        const progress = await runtimeBoxInstallProgress(browser, downloadId);
        if (Number.isFinite(Number(progress.bytesTotal)) && Number(progress.bytesTotal) > 0) {
          archiveSizeBytes = progress.bytesTotal;
          return true;
        }
        return false;
      }, {
        timeout: INSTALL_SIZE_DISCOVERY_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `${timeoutMsg}: archive size was not reported`,
      });
    } catch {
      // Older fixtures may not report a total. They retain the established minimum bound below.
    }
    const status = await runtimeBoxInstallStatus(browser, downloadId);
    if (status !== null && status !== 'running') return;
  }
  const timeout = runtimeBoxInstallTimeoutMs(archiveSizeBytes, options.hostEnvironment);
  try {
    await browser.waitUntil(
      async () => (await runtimeBoxInstallStatus(browser, downloadId)) !== 'running',
      { timeout, interval: 1_000, timeoutMsg },
    );
  } catch (error) {
    const status = await runtimeBoxInstallStatus(browser, downloadId);
    const progress = await runtimeBoxInstallProgress(browser, downloadId);
    const installError = await runtimeBoxInstallError(browser, downloadId);
    throw new Error(`${timeoutMsg} after ${Math.ceil(timeout / 1_000)} seconds: ${JSON.stringify({
      status,
      waitError: String(error?.message ?? error),
      installError,
      eventCount: progress.eventCount,
      maxBytesDownloaded: progress.maxBytesDownloaded,
      bytesTotal: progress.bytesTotal,
      latest: progress.latest,
    })}`);
  }
}

/** Returns a compact snapshot of the progress events captured for one Runtime Box install. */
export async function runtimeBoxInstallProgress(browser, downloadId) {
  return browser.execute((id) => {
    const events = window.__liatirRuntimeBoxInstall?.[id]?.progress ?? [];
    const latest = events.at(-1) ?? null;
    return {
      eventCount: events.length,
      latest,
      maxBytesDownloaded: events.reduce(
        (maximum, event) => Math.max(maximum, Number(event.bytesDownloaded) || 0),
        0,
      ),
      bytesTotal: [...events].reverse().find((event) => event.bytesTotal != null)?.bytesTotal ?? null,
      cancelRequested: Boolean(window.__liatirRuntimeBoxInstall?.[id]?.cancelRequested),
      cancelAccepted: window.__liatirRuntimeBoxInstall?.[id]?.cancelAccepted ?? null,
    };
  }, downloadId);
}

export async function firstDownloadOffset(browser, downloadId) {
  return browser.execute((id) => {
    const progress = window.__liatirRuntimeBoxInstall?.[id]?.progress ?? [];
    return progress.find((item) => !item.done)?.bytesDownloaded ?? 0;
  }, downloadId);
}

async function writeAppJson(browser, rel, value) {
  await browser.execute(async ({ file, content }) => window.Liatir.invoke('lia_app_write_text', {
    rel: file,
    content: JSON.stringify(content, null, 2),
    createDirs: true,
  }), { file: rel, content: value });
}

/**
 * Runs a single-cell embedding AI Model the way a user does: the input is registered in Data, the
 * model page starts the run, and the app finalizes it into a Result.
 *
 * A job spawned straight through the bridge is never finalized: the Result is owned by the
 * execution record the model page begins before it spawns, and the bridge has no such record.
 * Returns the finished Job, its buffered output, and the Result with its persisted output.
 */
export async function runSingleCellEmbeddingFromModelPage(browser, {
  modelId, toolId, installed, inputPath, batchSize, maxCsvRows,
}) {
  await writeAppJson(browser, `ai-model-installs/${modelId}.json`, {
    status: 'installed', runtimePath: installed.runtimeDir, installedSizeBytes: installed.sizeBytes,
    runtimeBoxActivation: installed.activation, enabled: true, updatedAt: Date.now(),
  });
  await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
    files: [{
      id: crypto.randomUUID(), name: path.basename(inputPath), path: inputPath,
      ext: 'h5ad', size: fs.statSync(inputPath).size, addedAt: Date.now(), folder: '',
    }],
    folders: [],
  });
  await reloadLiatirApp(browser);
  await activateCleanSandbox(browser);

  await navigateInApp(browser, `/ai/${modelId}`);
  await selectFileFromPicker(browser, 'ai-model-input-file', path.basename(inputPath));
  await (await browser.$('#batch-size')).setValue(String(batchSize));
  await (await browser.$('#csv-rows')).setValue(String(maxCsvRows));
  const runButton = await browser.$('[data-testid="ai-model-run"]');
  await browser.waitUntil(() => runButton.isEnabled(), {
    timeout: 20_000, timeoutMsg: `${modelId} Run did not become enabled`,
  });
  await runButton.click();
  // Leaving the model page while it runs is part of the contract: the Job keeps going and is
  // still finalized into a Result.
  await navigateInApp(browser, '/jobs');

  let job = null;
  await browser.waitUntil(async () => {
    const jobs = await browser.execute(
      async () => window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
    );
    job = jobs.find((entry) => entry.metadata?.toolId === toolId) ?? null;
    return job !== null && job.status.type !== 'running';
  }, { timeout: 900_000, interval: 1_000, timeoutMsg: `${modelId} Job did not finish` });
  const output = await browser.execute(
    async (id) => window.Liatir.invoke('lia_jobs_get_output', { jobId: id, since: 0 }),
    job.id,
  );
  if (job.status.type !== 'done') {
    const tail = (lines) => (lines ?? []).filter(Boolean).join('\n').slice(-4000);
    throw new Error(
      `${modelId} inference finished as ${job.status.type} (exit code ${job.status.exitCode ?? 'none'})`
        + `\nstderr:\n${tail(output.stderr) || '<empty>'}`
        + `\nstdout:\n${tail(output.stdout) || '<empty>'}`,
    );
  }

  const analysisRunId = job.metadata.analysisRunId;
  let result = null;
  await browser.waitUntil(async () => {
    try {
      const index = JSON.parse(await browser.execute(
        async (rel) => window.Liatir.invoke('lia_app_read_text', { rel }),
        'workspaces/__test__/analysis-runs/index.json',
      ));
      result = index.find((run) => run.id === analysisRunId) ?? null;
      return result?.status === 'done';
    } catch { return false; }
  }, { timeout: 60_000, interval: 1_000, timeoutMsg: `${modelId} Job was not finalized into a Result` });
  const persistedOutput = await readDataJson(
    browser,
    `workspaces/__test__/runs/${analysisRunId}/result.json`,
  );
  return { job, output, analysisRunId, result, persistedOutput };
}
