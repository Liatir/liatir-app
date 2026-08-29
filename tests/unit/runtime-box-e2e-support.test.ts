import { afterEach, describe, expect, it } from 'vitest';

import {
  activateCleanSandbox,
  runtimeBoxInstallTimeoutMs,
  runtimeBoxTargetForNativeTest,
  startRuntimeBoxInstall,
  waitForRuntimeBoxInstall,
} from '../e2e/support/runtime-box.mjs';
import { waitForLiatirBridge } from '../e2e/support/liatir-app.mjs';
import { resolveRuntimeBoxReleaseCandidate } from '../../frontend/src/lib/runtime-box-release-candidate';
import {
  prepareTauriTestEnvironment,
  tauriTestEnvironment,
} from '../e2e/support/tauri-process.mjs';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('Runtime Box product E2E support', () => {
  it('exposes only an exact checked release candidate to the non-distributable test app', () => {
    expect(resolveRuntimeBoxReleaseCandidate(null)).toBeNull();
    expect(resolveRuntimeBoxReleaseCandidate('openvax-mhcflurry-class1-presentation'))
      .toMatchObject({ kind: 'ai-model', metadata: { install: { runtimeBox: { publishedTargets: [{
        target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' },
      }] } } } });
    expect(resolveRuntimeBoxReleaseCandidate('griffithlab-pvactools-pvacseq'))
      .toMatchObject({ kind: 'tool-runtime', metadata: { install: { runtimeBox: { publishedTargets: [{
        target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' },
      }] } } } });
    expect(() => resolveRuntimeBoxReleaseCandidate('unknown-component')).toThrow(/Unsupported/);
  });
  it('opens the isolated Sandbox through the product workspace flow', async () => {
    let sandboxClicked = false;
    const browser = {
      execute: async (fn: (...args: unknown[]) => unknown) => {
        const source = fn.toString();
        if (source.includes('lia_app_write_text')) {
          throw new Error('Script execution timed out');
        }
        if (source.includes('bridgeAvailable')) {
          return { bridgeAvailable: true, documentReady: true, href: 'http://tauri.localhost/workspaces' };
        }
        if (source.includes('sandboxButtonReady')) {
          return { shellOpen: sandboxClicked, sandboxButtonReady: !sandboxClicked };
        }
        if (source.includes("window.location.pathname !== '/workspaces'")) return sandboxClicked;
        throw new Error(`Unexpected browser script: ${source}`);
      },
      waitUntil: async (condition: () => Promise<boolean>) => {
        if (!await condition()) throw new Error('condition did not pass');
        return true;
      },
      $: async () => ({
        isExisting: async () => true,
        waitForDisplayed: async () => {},
        click: async () => { sandboxClicked = true; },
      }),
    };

    await activateCleanSandbox(browser);
    expect(sandboxClicked).toBe(true);
  });

  it('waits for the Sandbox chooser to render after the native bridge is ready', async () => {
    let readinessChecks = 0;
    let sandboxClicked = false;
    const browser = {
      execute: async (fn: (...args: unknown[]) => unknown) => {
        const source = fn.toString();
        if (source.includes('bridgeAvailable')) {
          return { bridgeAvailable: true, documentReady: true, href: 'http://tauri.localhost/workspaces' };
        }
        if (source.includes('sandboxButtonReady')) {
          readinessChecks += 1;
          return {
            shellOpen: sandboxClicked,
            sandboxButtonReady: readinessChecks >= 2 && !sandboxClicked,
          };
        }
        if (source.includes("window.location.pathname !== '/workspaces'")) return sandboxClicked;
        throw new Error(`Unexpected browser script: ${source}`);
      },
      waitUntil: async (condition: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (await condition()) return true;
        }
        throw new Error('condition did not pass');
      },
      $: async () => ({
        waitForDisplayed: async () => {},
        click: async () => { sandboxClicked = true; },
      }),
    };

    await activateCleanSandbox(browser);
    expect(readinessChecks).toBeGreaterThanOrEqual(2);
    expect(sandboxClicked).toBe(true);
  });

  it('isolates Windows app data inside the per-run test home', () => {
    expect(tauriTestEnvironment('C:\\fixture-home', 'win32')).toMatchObject({
      HOME: 'C:\\fixture-home',
      USERPROFILE: 'C:\\fixture-home',
      // These exact names are load-bearing: Windows derives the local folder from the roaming one
      // by segment, so shortening them makes app_data_dir() resolve to nothing and the app panic
      // before startup. MAX_PATH budget is bought by keeping the home short, not these.
      APPDATA: 'C:\\fixture-home\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\fixture-home\\AppData\\Local',
    });
  });

  it('creates every isolated Windows directory before native app startup', () => {
    const created: string[] = [];
    const environment = prepareTauriTestEnvironment(
      'C:\\fixture-home',
      'win32',
      (directory) => created.push(directory),
    );

    expect(environment.APPDATA).toBe('C:\\fixture-home\\AppData\\Roaming');
    expect(created).toEqual([
      'C:\\fixture-home',
      'C:\\fixture-home\\.local\\share',
      'C:\\fixture-home\\.cache',
      'C:\\fixture-home\\.config',
      'C:\\fixture-home\\AppData\\Roaming',
      'C:\\fixture-home\\AppData\\Local',
    ]);
  });

  it('scales the install bound from the observed archive size without target-specific branches', () => {
    const cpuArchiveTimeout = runtimeBoxInstallTimeoutMs(380_481_131);
    const cudaArchiveTimeout = runtimeBoxInstallTimeoutMs(3_079_059_631);

    expect(runtimeBoxInstallTimeoutMs(null)).toBe(180_000);
    expect(cpuArchiveTimeout).toBeGreaterThanOrEqual(180_000);
    expect(cudaArchiveTimeout).toBeGreaterThanOrEqual(9 * 60_000);
    expect(cudaArchiveTimeout).toBeGreaterThan(cpuArchiveTimeout);
  });

  it('reports the last install progress when a size-aware wait expires', async () => {
    const downloadId = 'runtime-box-timeout-test';
    const archiveSizeBytes = 3_079_059_631;
    let observedOptions: { timeout?: number; interval?: number } = {};
    (globalThis as any).window = {
      __liatirRuntimeBoxInstall: {
        [downloadId]: {
          status: 'running',
          error: null,
          progress: [{ bytesDownloaded: 2_000_000_000, bytesTotal: archiveSizeBytes, done: false }],
        },
      },
    };
    const browser = {
      execute: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
      waitUntil: async (_condition: () => Promise<boolean>, options: typeof observedOptions) => {
        observedOptions = options;
        throw new Error('fixture timeout');
      },
    };

    await expect(waitForRuntimeBoxInstall(browser, downloadId, {
      archiveSizeBytes,
      timeoutMsg: 'Fixture install did not complete',
    })).rejects.toThrow(/"maxBytesDownloaded":2000000000.*"bytesTotal":3079059631/);
    expect(observedOptions).toEqual({
      timeout: runtimeBoxInstallTimeoutMs(archiveSizeBytes),
      interval: 1_000,
      timeoutMsg: 'Fixture install did not complete',
    });
  });

  it('uses the exact native CUDA candidate and driver floor', () => {
    expect(runtimeBoxTargetForNativeTest(
      'bowang-scgpt-whole-human',
      'linux-x86_64-cuda12.9',
    )).toEqual([{
      target: {
        platform: 'linux',
        arch: 'x86_64',
        accelerator: 'cuda',
        cudaVersion: '12.9',
      },
      hostEnvironments: ['native'],
      minRamGb: 16,
      minNvidiaDriverVersion: '525.60.13',
    }]);
  });

  it('derives the Windows CPU candidate from the checked catalog and recipe', () => {
    expect(runtimeBoxTargetForNativeTest(
      'bowang-scgpt-whole-human',
      'windows-x86_64-cpu',
    )).toEqual([{
      target: { platform: 'windows', arch: 'x86_64', accelerator: 'cpu' },
      hostEnvironments: ['native'],
      minRamGb: 16,
    }]);
  });

  it('allows one bounded script-timeout retry while the initial WebKit navigation settles', async () => {
    let executeCalls = 0;
    let waitTimeout = 0;
    const browser = {
      execute: async () => {
        executeCalls += 1;
        if (executeCalls === 1) {
          const error = new Error('Script execution timed out') as Error & { code: string };
          error.code = 'script timeout';
          throw error;
        }
        return { bridgeAvailable: true, documentReady: true, href: 'http://tauri.localhost/' };
      },
      waitUntil: async (condition: () => Promise<boolean>, options: { timeout: number }) => {
        waitTimeout = options.timeout;
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            if (await condition()) return true;
          } catch {
            // Mirrors the runner: transient WebDriver errors are retried inside the outer bound.
          }
        }
        throw new Error('condition did not recover');
      },
    };

    await waitForLiatirBridge(browser);
    expect(waitTimeout).toBe(65_000);
    expect(executeCalls).toBe(2);
  });

  it('rejects the transient about:blank bridge before app navigation settles', async () => {
    let executeCalls = 0;
    const browser = {
      execute: async () => {
        executeCalls += 1;
        return executeCalls === 1
          ? { bridgeAvailable: true, documentReady: true, href: 'about:blank' }
          : { bridgeAvailable: true, documentReady: true, href: 'http://tauri.localhost/' };
      },
      waitUntil: async (condition: () => Promise<boolean>) => {
        for (let attempt = 0; attempt < 2; attempt += 1) {
          if (await condition()) return true;
        }
        throw new Error('condition did not recover');
      },
    };

    await waitForLiatirBridge(browser);
    expect(executeCalls).toBe(2);
  });

  it('cancels from the first positive progress event without polling', async () => {
    const invocations: Array<{ command: string; payload: unknown }> = [];
    let progressListener: ((progress: { bytesDownloaded: number; done: boolean }) => void) | null = null;

    (globalThis as { window?: unknown }).window = {
      Liatir: {
        desktop: {
          events: {
            on: async (_event: string, listener: typeof progressListener) => {
              progressListener = listener;
              return () => {};
            },
          },
        },
        invoke: async (command: string, payload: unknown) => {
          invocations.push({ command, payload });
          if (command === 'lia_managed_download_cancel') return true;
          if (command === 'lia_ai_runtime_box_install') return new Promise(() => {});
          throw new Error(`Unexpected command: ${command}`);
        },
      },
    };

    const browser = {
      execute: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
    };
    const request = {
      boxId: 'geneformer-v1-10m',
      modelId: 'ctheodoris-geneformer-v1-10m',
      channel: 'beta',
      registryBaseUrl: 'http://127.0.0.1:8790/v1',
      targetCandidates: [],
      downloadId: 'runtime-box-interrupted-test',
    };

    await startRuntimeBoxInstall(browser, request, { cancelAfterBytes: 1 });
    expect(progressListener).not.toBeNull();
    progressListener?.({ bytesDownloaded: 1, done: false });
    progressListener?.({ bytesDownloaded: 2, done: false });
    await Promise.resolve();
    await Promise.resolve();

    const state = (globalThis as any).window.__liatirRuntimeBoxInstall[request.downloadId];
    expect(state.cancelRequested).toBe(true);
    expect(state.cancelAccepted).toBe(true);
    expect(invocations.filter(({ command }) => command === 'lia_managed_download_cancel')).toEqual([
      { command: 'lia_managed_download_cancel', payload: { id: request.downloadId } },
    ]);
  });
});
