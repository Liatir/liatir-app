/** Second half of the native Windows-to-WSL restart proof. */
import fs from 'node:fs';

import { openSandboxWorkspace } from '../support/liatir-app.mjs';
import {
  STEP_ID,
  readWorkspaceJson,
  reloadLiatirApp,
  waitForResult,
  wslTokenProcessIds,
} from './external-workflow-nextflow.e2e.mjs';

const REQUIRED_ENV = [
  'LIATIR_E2E_NEXTFLOW',
  'LIATIR_E2E_NEXTFLOW_WINDOWS_WSL_RESTART',
  'LIATIR_NEXTFLOW_RESTART_STATE',
];

export const tests = [{
  name: 'stops the orphaned WSL2 process tree and reconciles its Result exactly once',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    if (process.platform !== 'win32') throw new Error('This proof must recover in the native Windows app.');
    const state = JSON.parse(fs.readFileSync(process.env.LIATIR_NEXTFLOW_RESTART_STATE, 'utf8'));
    await openSandboxWorkspace(browser);

    const recovered = await waitForResult(browser, { id: state.runId, status: 'error' }, 120_000);
    expect(recovered).toMatchObject({
      id: state.runId,
      tool: STEP_ID,
      status: 'error',
      jobIds: [state.jobId],
      execution: {
        runId: state.runId,
        runKind: 'external-workflow',
        externalWorkflowRunId: state.runId,
      },
    });
    expect(recovered.error).toMatch(/interrupted/i);

    await browser.waitUntil(
      async () => !fs.existsSync(state.controlFile)
        && wslTokenProcessIds(state.distribution, state.token).length === 0,
      { timeout: 30_000, timeoutMsg: 'Startup cleanup did not stop the orphaned WSL2 process tree' },
    );
    const records = await readWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json');
    expect(records.find((record) => record.identity.runId === state.runId)).toMatchObject({
      status: 'interrupted',
      resultId: state.runId,
      finalizedAt: expect.any(Number),
    });

    await reloadLiatirApp(browser);
    await openSandboxWorkspace(browser);
    const runs = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
    expect(runs.filter((run) => run.id === state.runId)).toHaveLength(1);
    expect(wslTokenProcessIds(state.distribution, state.token)).toHaveLength(0);
  },
}];
