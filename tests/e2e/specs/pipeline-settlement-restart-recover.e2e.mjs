import { openSandboxWorkspace, waitForLiatirBridge } from '../support/liatir-app.mjs';
import {
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
        && state.runs[0].status === 'error';
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

    await browser.execute(() => window.location.reload());
    await waitForLiatirBridge(browser);
    await openSandboxWorkspace(browser);
    await waitForRecovery(browser);
    state = await readRestartState(browser);
    expect(state.runs.filter((run) => run.id === runId)).toHaveLength(1);
  },
}];
