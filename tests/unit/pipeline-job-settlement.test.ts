import { describe, expect, it, vi } from 'vitest';

import { RunCancelledError } from '../../frontend/src/lib/pipeline/cancellation';
import {
  waitForJobSettlement,
  type JobSettlementBridge,
} from '../../frontend/src/lib/pipeline/job-settlement';

describe('pipeline Job settlement barrier', () => {
  it('does not settle at spawn or running status and drains output after terminal status', async () => {
    let statusReads = 0;
    let outputReads = 0;
    const stdout: string[] = [];
    const bridge: JobSettlementBridge = {
      async invoke(command) {
        if (command === 'lia_jobs_status') {
          statusReads += 1;
          return statusReads === 1
            ? { status: { type: 'running' } }
            : { status: { type: 'done', exitCode: 0 }, metadata: { settled: true } };
        }
        if (command === 'lia_jobs_get_output') {
          outputReads += 1;
          const lines = outputReads < 3 ? ['started'] : ['started', 'final-result'];
          return { stdout: lines, stderr: [], stdoutTotal: lines.length, stderrTotal: 0 };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    const settled = await waitForJobSettlement(bridge, 'job-1', {
      pollIntervalMs: 0,
      onStdout: (line) => stdout.push(line),
    });

    expect(statusReads).toBe(2);
    expect(outputReads).toBe(3);
    expect(stdout).toEqual(['started', 'final-result']);
    expect(settled.stdout).toEqual(['started', 'final-result']);
    expect(settled.entry.status).toEqual({ type: 'done', exitCode: 0 });
    expect(settled.timedOut).toBe(false);
  });

  it('kills only its own Job and reports cooperative cancellation', async () => {
    const controller = new AbortController();
    const commands: string[] = [];
    const bridge: JobSettlementBridge = {
      async invoke(command) {
        commands.push(command);
        if (command === 'lia_jobs_status') {
          controller.abort();
          return { status: { type: 'running' } };
        }
        if (command === 'lia_jobs_get_output') {
          return { stdout: [], stderr: [], stdoutTotal: 0, stderrTotal: 0 };
        }
        if (command === 'lia_jobs_kill') return true;
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    await expect(waitForJobSettlement(bridge, 'job-cancelled', {
      signal: controller.signal,
      pollIntervalMs: 0,
    })).rejects.toBeInstanceOf(RunCancelledError);
    expect(commands).toContain('lia_jobs_kill');
  });

  it('does not finalize cancellation before the backend process tree has stopped', async () => {
    const controller = new AbortController();
    let finishKill: (() => void) | null = null;
    let killStarted = false;
    const bridge: JobSettlementBridge = {
      async invoke(command) {
        if (command === 'lia_jobs_status') {
          controller.abort();
          return { status: { type: 'killed' } };
        }
        if (command === 'lia_jobs_get_output') {
          return { stdout: [], stderr: [], stdoutTotal: 0, stderrTotal: 0 };
        }
        if (command === 'lia_jobs_kill') {
          killStarted = true;
          await new Promise<void>((resolve) => { finishKill = resolve; });
          return true;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    let settled = false;
    const outcome = waitForJobSettlement(bridge, 'job-slow-cancel', {
      signal: controller.signal,
      pollIntervalMs: 0,
    }).then(
      () => 'settled',
      (error) => {
        expect(error).toBeInstanceOf(RunCancelledError);
        return 'cancelled';
      },
    ).finally(() => { settled = true; });

    await vi.waitFor(() => expect(killStarted).toBe(true));
    await Promise.resolve();
    expect(settled).toBe(false);
    finishKill?.();
    await expect(outcome).resolves.toBe('cancelled');
  });

  it('kills a timed-out Job and returns its final buffered diagnostics', async () => {
    let killed = false;
    const bridge: JobSettlementBridge = {
      async invoke(command) {
        if (command === 'lia_jobs_status') {
          return { status: { type: killed ? 'killed' : 'running' } };
        }
        if (command === 'lia_jobs_get_output') {
          const lines = killed ? ['before timeout', 'killed'] : ['before timeout'];
          return { stdout: [], stderr: lines, stdoutTotal: 0, stderrTotal: lines.length };
        }
        if (command === 'lia_jobs_kill') {
          killed = true;
          return true;
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    };

    const settled = await waitForJobSettlement(bridge, 'job-timeout', {
      timeoutMs: -1,
      pollIntervalMs: 0,
    });
    expect(killed).toBe(true);
    expect(settled.timedOut).toBe(true);
    expect(settled.entry.status).toEqual({ type: 'killed' });
    expect(settled.stderr).toEqual(['before timeout', 'killed']);
  });
});
