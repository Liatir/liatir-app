/**
 * Support helpers for the Runtime Box end-to-end tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveRuntimeBoxAuthoringInput } from '../../../scripts/runtime-box/authoring-input.mjs';
import { openSandboxWorkspace } from './liatir-app.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const CATALOG = JSON.parse(fs.readFileSync(path.join(ROOT, 'runtime-boxes/catalog.json'), 'utf8'));

const MIN_INSTALL_TIMEOUT_MS = 180_000;
// Eight MiB/s is intentionally below the observed protected-release transfer rate. The fixed
// allowance covers signature verification, multi-gigabyte ZIP extraction, self-test, and activation.
const INSTALL_FIXED_OVERHEAD_MS = 180_000;
const CONSERVATIVE_DOWNLOAD_BYTES_PER_SECOND = 8 * 1024 * 1024;

/** Sizes a native install bound from observed archive bytes, verification, extraction, and activation. */
export function runtimeBoxInstallTimeoutMs(archiveSizeBytes) {
  const bytes = Number(archiveSizeBytes);
  if (!Number.isFinite(bytes) || bytes <= 0) return MIN_INSTALL_TIMEOUT_MS;
  const downloadMs = Math.ceil((bytes / CONSERVATIVE_DOWNLOAD_BYTES_PER_SECOND) * 1_000);
  return Math.max(MIN_INSTALL_TIMEOUT_MS, INSTALL_FIXED_OVERHEAD_MS + downloadMs);
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
    void window.Liatir.invoke('lia_ai_runtime_box_install', request)
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
  const timeout = runtimeBoxInstallTimeoutMs(options.archiveSizeBytes);
  const timeoutMsg = options.timeoutMsg ?? 'Runtime Box install did not complete';
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
