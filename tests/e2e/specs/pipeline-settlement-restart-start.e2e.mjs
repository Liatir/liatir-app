import {
  openRestartPipeline,
  readRestartState,
  RESTART_DOWNSTREAM_ID,
  RESTART_NODE_ID,
  seedRestartPipeline,
} from '../support/pipeline-settlement-restart.mjs';

const REQUIRED_ENV = ['LIATIR_PIPELINE_RESTART_API_URL'];

export const tests = [{
  name: 'persists an active pipeline before the native app process exits',
  requiredEnv: REQUIRED_ENV,
  async run({ browser, expect }) {
    await seedRestartPipeline(browser, process.env.LIATIR_PIPELINE_RESTART_API_URL);
    await openRestartPipeline(browser);
    await (await browser.$('[data-testid="pipeline-run-button"]')).click();

    await browser.waitUntil(
      async () => {
        const state = await readRestartState(browser);
        const nodes = Object.fromEntries(state.runtime?.nodeStates ?? []);
        return state.runtime?.running === true
          && Boolean(state.runtime.runId)
          && nodes[RESTART_NODE_ID]?.status === 'running'
          && nodes[RESTART_DOWNSTREAM_ID]?.status === 'pending';
      },
      { timeout: 20_000, timeoutMsg: 'Active pipeline state was not persisted before app exit' },
    );

    const state = await readRestartState(browser);
    expect(state.runs).toHaveLength(0);
  },
}];
