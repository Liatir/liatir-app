import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  activateCleanSandbox,
  runtimeBoxInstallTimeoutMs,
  runtimeBoxResultArtifactSnapshot,
  runtimeBoxTargetForNativeTest,
  startRuntimeBoxInstall,
  waitForRuntimeBoxInstall,
} from '../e2e/support/runtime-box.mjs';
import {
  readDataJson,
  selectFileFromPicker,
  waitForLiatirBridge,
} from '../e2e/support/liatir-app.mjs';
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
  it('implements every element-state command used by the oncology product lifecycles', () => {
    const runner = readFileSync(resolve('tests/e2e/run-tauri-e2e.mjs'), 'utf8');
    const mhc = readFileSync(resolve('tests/e2e/specs/runtime-box-mhcflurry-native.e2e.mjs'), 'utf8');
    const pvac = readFileSync(resolve('tests/e2e/specs/runtime-box-pvactools-native.e2e.mjs'), 'utf8');

    expect(mhc).toContain('runButton.isEnabled()');
    expect(pvac).toContain('runButton.isEnabled()');
    expect(runner).toContain('async isEnabled()');
    expect(runner).toContain("`/element/${await this.resolveId()}/enabled`");
  });

  /**
   * The general form of the guard above. Liatir's WebDriver client is deliberately small, so a spec
   * can call a perfectly standard element method that simply is not there — and the failure lands
   * mid-lifecycle, after a real build and a multi-gigabyte install, as `is not a function`.
   * `isEnabled` cost a remote run that way once, and `isSelected` cost a local one on 2026-09-10.
   */
  it('implements every element-state command any routed spec calls', () => {
    const runner = readFileSync(resolve('tests/e2e/run-tauri-e2e.mjs'), 'utf8');
    // Static helpers that read as element state but are not: Array.isArray, Number.isFinite, and
    // the Node stat predicates. Everything else is expected on the element wrapper.
    const notElementState = new Set([
      'isArray', 'isFinite', 'isInteger', 'isSafeInteger', 'isNaN', 'isDirectory', 'isFile',
    ]);
    const called = new Set<string>();
    for (const entry of readdirSync(resolve('tests/e2e/specs'))) {
      if (!entry.endsWith('.e2e.mjs')) continue;
      const spec = readFileSync(resolve('tests/e2e/specs', entry), 'utf8');
      for (const match of spec.matchAll(/\.(is[A-Z]\w*)\s*\(/gu)) {
        if (!notElementState.has(match[1])) called.add(match[1]);
      }
    }

    expect(called.size).toBeGreaterThan(0);
    const missing = [...called].filter((name) => !runner.includes(`async ${name}(`));
    expect(missing, `Element methods used by a spec but absent from the client: ${missing.join(', ')}`)
      .toEqual([]);
  });

  it('exposes only an exact checked release candidate to the non-distributable test app', () => {
    expect(resolveRuntimeBoxReleaseCandidate(null)).toBeNull();
    expect(resolveRuntimeBoxReleaseCandidate('openvax-mhcflurry-class1-presentation'))
      .toMatchObject({ kind: 'ai-model', metadata: { install: { runtimeBox: { publishedTargets: [
        { target: { platform: 'macos', arch: 'aarch64', accelerator: 'metal' } },
        { target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' } },
      ] } } } });
    // Published models are republished against their product metadata.
    for (const id of ['bowang-scgpt-whole-human', 'ctheodoris-geneformer-v1-10m', 'snap-stanford-uce-4layer']) {
      expect(resolveRuntimeBoxReleaseCandidate(id)).toMatchObject({ kind: 'ai-model', metadata: { id } });
    }
    expect(resolveRuntimeBoxReleaseCandidate('griffithlab-pvactools-pvacseq'))
      .toMatchObject({ kind: 'tool-runtime', metadata: { install: { runtimeBox: { publishedTargets: [
        { target: { platform: 'macos', arch: 'aarch64', accelerator: 'cpu' } },
        { target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' } },
      ] } } } });
    expect(() => resolveRuntimeBoxReleaseCandidate('unknown-component')).toThrow(/Unsupported/);
  });

  it('selects a picker file through standard CSS instead of unsupported text-selector syntax', async () => {
    let pickerClicked = false;
    let optionClicked = false;
    const option = {
      getText: async () => 'mhc-native-input.fasta\nworkspace/mhc-native-input.fasta',
      isDisplayed: async () => true,
      click: async () => { optionClicked = true; },
    };
    const browser = {
      $: async (selector: string) => {
        expect(selector).toBe('[data-testid="mhc-input-file"]');
        return {
          waitForDisplayed: async () => {},
          click: async () => { pickerClicked = true; },
        };
      },
      $$: async (selector: string) => {
        expect(selector).toBe('button');
        expect(pickerClicked).toBe(true);
        return [{
          getText: async () => 'Close',
          isDisplayed: async () => true,
        }, option];
      },
      waitUntil: async (condition: () => Promise<boolean>) => {
        if (!await condition()) throw new Error('condition did not pass');
        return true;
      },
    };

    await selectFileFromPicker(browser, 'mhc-input-file', 'mhc-native-input.fasta');
    expect(optionClicked).toBe(true);
  });

  it('reads durable Result documents from the user data scope', async () => {
    const browser = {
      execute: async (fn: (...args: unknown[]) => unknown, rel: string) => {
        const source = fn.toString();
        expect(source).toContain("lia_fs_read_text");
        expect(source).toContain('permanent: true');
        expect(source).not.toContain('lia_app_read_text');
        expect(rel).toBe('workspaces/__test__/runs/run-1/result.json');
        return { sections: [{ type: 'text', content: 'done' }] };
      },
    };

    await expect(readDataJson(
      browser,
      'workspaces/__test__/runs/run-1/result.json',
    )).resolves.toEqual({ sections: [{ type: 'text', content: 'done' }] });
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

  it('scales the install bound from size and keeps the measured WSL2 crossing allowance explicit', () => {
    const cpuArchiveTimeout = runtimeBoxInstallTimeoutMs(380_481_131);
    const cudaArchiveTimeout = runtimeBoxInstallTimeoutMs(3_079_059_631);
    const pvacWsl2Timeout = runtimeBoxInstallTimeoutMs(1_167_379_910, 'windows-wsl2');

    expect(runtimeBoxInstallTimeoutMs(null)).toBe(180_000);
    expect(cpuArchiveTimeout).toBeGreaterThanOrEqual(180_000);
    expect(cudaArchiveTimeout).toBeGreaterThanOrEqual(9 * 60_000);
    expect(cudaArchiveTimeout).toBeGreaterThan(cpuArchiveTimeout);
    expect(pvacWsl2Timeout).toBe(499_163);
    expect(pvacWsl2Timeout - runtimeBoxInstallTimeoutMs(1_167_379_910)).toBe(180_000);
  });

  it('proves Result artifacts are unchanged across removal without rejecting valid empty output', () => {
    const directory = mkdtempSync(join(tmpdir(), 'liatir-runtime-box-results-'));
    const emptyPath = join(directory, 'empty.tsv');
    const resultPath = join(directory, 'result.json');
    try {
      writeFileSync(emptyPath, '');
      writeFileSync(resultPath, '{"status":"done"}\n');
      const outputFiles = [{ path: emptyPath }, { path: resultPath }];
      const beforeRemoval = runtimeBoxResultArtifactSnapshot(outputFiles);

      expect(beforeRemoval[0].sizeBytes).toBe(0);
      expect(runtimeBoxResultArtifactSnapshot(outputFiles)).toEqual(beforeRemoval);

      writeFileSync(resultPath, '{"status":"changed"}\n');
      expect(runtimeBoxResultArtifactSnapshot(outputFiles)).not.toEqual(beforeRemoval);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('discovers the first install size from progress before choosing its timeout', async () => {
    const downloadId = 'runtime-box-first-install-timeout-test';
    const archiveSizeBytes = 1_167_379_913;
    let waitCall = 0;
    const observedOptions: Array<{ timeout?: number; interval?: number; timeoutMsg?: string }> = [];
    (globalThis as any).window = {
      __liatirRuntimeBoxInstall: {
        [downloadId]: {
          status: 'running',
          error: null,
          progress: [{ bytesDownloaded: 16_354_657, bytesTotal: archiveSizeBytes, done: false }],
        },
      },
    };
    const browser = {
      execute: async (fn: (input: unknown) => unknown, input: unknown) => fn(input),
      waitUntil: async (condition: () => Promise<boolean>, options: typeof observedOptions[number]) => {
        observedOptions.push(options);
        waitCall += 1;
        if (waitCall === 1) {
          expect(await condition()).toBe(true);
          return;
        }
        throw new Error('fixture timeout');
      },
    };

    await expect(waitForRuntimeBoxInstall(browser, downloadId, {
      hostEnvironment: 'windows-wsl2',
      timeoutMsg: 'First install did not complete',
    })).rejects.toThrow(`\"bytesTotal\":${archiveSizeBytes}`);
    expect(observedOptions[0]).toEqual({
      timeout: 30_000,
      interval: 500,
      timeoutMsg: 'First install did not complete: archive size was not reported',
    });
    expect(observedOptions[1]).toEqual({
      timeout: runtimeBoxInstallTimeoutMs(archiveSizeBytes, 'windows-wsl2'),
      interval: 1_000,
      timeoutMsg: 'First install did not complete',
    });
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
      hostEnvironments: ['native', 'windows-wsl2'],
      minRamGb: 16,
      minNvidiaDriverVersion: '525.60.13',
    }]);
  });

  it('derives the Linux CPU candidate, which is how Windows reaches scGPT', () => {
    expect(runtimeBoxTargetForNativeTest(
      'bowang-scgpt-whole-human',
      'linux-x86_64-cpu',
    )).toEqual([{
      target: { platform: 'linux', arch: 'x86_64', accelerator: 'cpu' },
      hostEnvironments: ['native', 'windows-wsl2'],
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
