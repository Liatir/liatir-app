import { afterEach, describe, expect, it } from 'vitest';

import { runtimeBoxTargetForNativeTest, startRuntimeBoxInstall } from '../e2e/support/runtime-box.mjs';
import { waitForLiatirBridge } from '../e2e/support/liatir-app.mjs';

const originalWindow = (globalThis as { window?: unknown }).window;

afterEach(() => {
  if (originalWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window?: unknown }).window = originalWindow;
  }
});

describe('Runtime Box product E2E support', () => {
  it('uses the exact native CUDA 12.4 candidate and driver floor', () => {
    expect(runtimeBoxTargetForNativeTest('linux-x86_64-cuda12.4', 8)).toEqual([{
      target: {
        platform: 'linux',
        arch: 'x86_64',
        accelerator: 'cuda',
        cudaVersion: '12.4',
      },
      hostEnvironments: ['native'],
      minRamGb: 8,
      minNvidiaDriverVersion: '550.54.14',
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
        return true;
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
