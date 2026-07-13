/**
 * Support helpers for the Runtime Box end-to-end tests.
 */
import fs from 'node:fs';
import path from 'node:path';
import { waitForLiatirBridge } from './liatir-app.mjs';

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
 * Puts the app into a known-empty sandbox workspace before a test runs.
 *
 * End-to-end tests drive a *real* app against real storage, so they would otherwise inherit whatever the last
 * run left behind — and a test that passes only because of leftover state is worse than no test. Writing a
 * single `__test__` workspace gives every spec the same clean starting point, and keeps the tests away from any
 * real workspace on the machine.
 */
export async function activateCleanSandbox(browser) {
  await waitForLiatirBridge(browser);
  await browser.execute(async () => {
    const now = Date.now();
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'workspaces.json',
      content: JSON.stringify({
        workspaces: [{ id: '__test__', name: 'Sandbox', createdAt: now, lastOpenedAt: now }],
      }, null, 2),
      createDirs: true,
    });
    await window.Liatir.invoke('lia_app_write_text', {
      rel: 'active-workspace.json',
      content: JSON.stringify({ id: '__test__' }),
      createDirs: true,
    });
    return true;
  });
  await browser.execute(() => {
    window.location.href = '/';
    return true;
  });
  await (await browser.$('[data-testid="sidebar-nav-item"]')).waitForDisplayed({
    timeout: 20_000,
    timeoutMsg: 'Clean Sandbox workspace shell did not open',
  });
}

export async function startRuntimeBoxInstall(browser, input) {
  return browser.execute(async (installInput) => {
    window.__liatirRuntimeBoxInstall ??= {};
    const state = {
      status: 'running',
      progress: [],
      result: null,
      error: null,
      unlisten: null,
    };
    window.__liatirRuntimeBoxInstall[installInput.downloadId] = state;
    state.unlisten = await window.Liatir.desktop.events.on(
      `managed:progress:${installInput.downloadId}`,
      (progress) => state.progress.push(progress),
    );
    void window.Liatir.invoke('lia_ai_runtime_box_install', installInput)
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
  }, input);
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
    };
  }, downloadId);
}

export async function firstDownloadOffset(browser, downloadId) {
  return browser.execute((id) => {
    const progress = window.__liatirRuntimeBoxInstall?.[id]?.progress ?? [];
    return progress.find((item) => !item.done)?.bytesDownloaded ?? 0;
  }, downloadId);
}
