import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
}));

vi.mock('$lib/api', () => ({
  liatir: () => ({ invoke: mocks.invoke }),
}));

vi.mock('$lib/stores/workspace.svelte', () => ({
  workspaceStore: { activeId: 'pipeline-settlement-workspace' },
}));

import { RunCancelledError } from '../../frontend/src/lib/pipeline/cancellation';
import { runAIPython } from '../../frontend/src/lib/ai/runtime';

const MODEL = {
  id: 'settlement-model',
  name: 'Settlement Model',
  install: {
    runtimeId: 'settlement-runtime',
    modelCacheSubdir: 'model-cache/settlement',
  },
} as never;

describe('AI Tool pipeline settlement', () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
  });

  it('waits for the terminal AI Job and its final output instead of resolving after spawn', async () => {
    let statusReads = 0;
    let outputReads = 0;
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'lia_ai_python_spawn') return { jobId: 'ai-job-1' };
      if (command === 'lia_jobs_status') {
        statusReads += 1;
        return statusReads === 1
          ? { status: { type: 'running' } }
          : { status: { type: 'done', exitCode: 0 }, metadata: {} };
      }
      if (command === 'lia_jobs_get_output') {
        outputReads += 1;
        const stdout = outputReads < 3 ? ['started'] : ['started', '{"settled":true}'];
        return { stdout, stderr: [], stdoutTotal: stdout.length, stderrTotal: 0 };
      }
      throw new Error(`Unexpected command: ${command}`);
    });

    const result = await runAIPython(MODEL, 'print("ok")', {}, {
      timeoutSeconds: 10,
    });

    expect(statusReads).toBe(2);
    expect(outputReads).toBe(3);
    expect(result.ok).toBe(true);
    expect(result.stdout).toBe('started\n{"settled":true}');
  });

  it('kills the spawned AI Job when its owning pipeline is cancelled', async () => {
    const controller = new AbortController();
    mocks.invoke.mockImplementation(async (command: string) => {
      if (command === 'lia_ai_python_spawn') return { jobId: 'ai-job-cancel' };
      if (command === 'lia_jobs_status') {
        controller.abort();
        return { status: { type: 'running' } };
      }
      if (command === 'lia_jobs_get_output') {
        return { stdout: [], stderr: [], stdoutTotal: 0, stderrTotal: 0 };
      }
      if (command === 'lia_jobs_kill') return true;
      throw new Error(`Unexpected command: ${command}`);
    });

    await expect(runAIPython(MODEL, 'print("never")', {}, {
      signal: controller.signal,
      timeoutSeconds: 10,
    })).rejects.toBeInstanceOf(RunCancelledError);
    expect(mocks.invoke).toHaveBeenCalledWith('lia_jobs_kill', { jobId: 'ai-job-cancel' });
  });
});
