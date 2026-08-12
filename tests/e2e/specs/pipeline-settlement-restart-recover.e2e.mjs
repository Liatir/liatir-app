import { openSandboxWorkspace, waitForLiatirBridge } from '../support/liatir-app.mjs';
import {
  DIRECT_RESTART_RUNS,
  INTERRUPTED_ERROR,
  readRestartState,
  RESTART_DOWNSTREAM_ID,
  RESTART_NODE_ID,
} from '../support/pipeline-settlement-restart.mjs';

const REQUIRED_ENV = ['LIATIR_PIPELINE_RESTART_API_URL'];

async function waitForRecovery(browser) {
  await browser.waitUntil(
    async () => {
      const state = await readRestartState(browser);
      const nodes = Object.fromEntries(state.runtime?.nodeStates ?? []);
      return state.runtime?.running === false
        && nodes[RESTART_NODE_ID]?.status === 'error'
        && nodes[RESTART_DOWNSTREAM_ID]?.status === 'pending'
        && state.runs.length === 1
        && state.runs[0].status === 'error'
        && state.directRuns.length === DIRECT_RESTART_RUNS.length
        && state.directRuns.every((run) => run.status === 'error');
    },
    { timeout: 20_000, timeoutMsg: 'The restarted app did not reconcile the interrupted pipeline' },
  );
}

export const tests = [{
  name: 'recovers an interrupted pipeline exactly once in a new native app process',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await openSandboxWorkspace(browser);
    await waitForRecovery(browser);

    let state = await readRestartState(browser);
    const runId = state.runtime.runId;
    const nodes = Object.fromEntries(state.runtime.nodeStates);
    expect(nodes[RESTART_NODE_ID].error).toBe(INTERRUPTED_ERROR);
    expect(state.runs[0]).toMatchObject({
      id: runId,
      status: 'error',
      error: INTERRUPTED_ERROR,
    });
    for (const expected of DIRECT_RESTART_RUNS) {
      const direct = state.directRuns.filter((run) => run.id === expected.runId);
      expect(direct).toHaveLength(1);
      expect(direct[0]).toMatchObject({
        status: 'error',
        execution: { runId: expected.runId, runKind: expected.runKind },
      });
      expect(direct[0].error).toMatch(/interrupted/i);
      expect(state.executions.find((run) => run.identity.runId === expected.runId)?.finalizedAt)
        .toEqual(expect.any(Number));
    }

    await browser.execute(() => window.location.reload());
    await waitForLiatirBridge(browser);
    await openSandboxWorkspace(browser);
    await waitForRecovery(browser);
    state = await readRestartState(browser);
    expect(state.runs.filter((run) => run.id === runId)).toHaveLength(1);
    for (const expected of DIRECT_RESTART_RUNS) {
      expect(state.directRuns.filter((run) => run.id === expected.runId)).toHaveLength(1);
    }
  },
}];
