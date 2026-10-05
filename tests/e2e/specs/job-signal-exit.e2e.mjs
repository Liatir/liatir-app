import { openSandboxWorkspace } from '../support/liatir-app.mjs';

export const tests = [{
  name: 'records a process terminated by a signal as failed while preserving successful exits',
  async run({ browser, expect }) {
    await openSandboxWorkspace(browser);
    for (const [script, expected] of [
      ['process.exit(0)', 'done'],
      ['process.kill(process.pid, "SIGTERM")', 'failed'],
    ]) {
      const { jobId } = await browser.execute(async ({ cmd, script }) => window.Liatir.invoke('lia_jobs_spawn', {
        cmd, args: ['-e', script], workspaceId: '__test__', label: 'Process termination regression', kind: 'test',
      }), { cmd: process.execPath, script });
      await browser.waitUntil(async () => browser.execute(async (jobId) => {
        const job = await window.Liatir.invoke('lia_jobs_status', { jobId });
        return job.status.type !== 'running';
      }, jobId), { timeout: 15_000, timeoutMsg: 'The termination fixture did not finalize' });
      const job = await browser.execute((jobId) => window.Liatir.invoke('lia_jobs_status', { jobId }), jobId);
      expect(job.status.type).toBe(expected);
      expect(job.endedAtMs).toBeGreaterThanOrEqual(job.startedAtMs);
    }
  },
}];
