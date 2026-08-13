/** First half of the native Windows-to-WSL restart proof. */
import fs from 'node:fs';
import path from 'node:path';

import { navigateInApp } from '../support/liatir-app.mjs';
import {
  DEFINITION_ID,
  chooseWorkflowInput,
  ensureSeeded,
  readWorkspaceJson,
  waitForDefinitionReady,
  workflowJobs,
  wslTokenProcessIds,
} from './external-workflow-nextflow.e2e.mjs';

const REQUIRED_ENV = [
  'LIATIR_E2E_NEXTFLOW',
  'LIATIR_E2E_NEXTFLOW_WINDOWS_WSL_RESTART',
  'LIATIR_NEXTFLOW_RESTART_STATE',
];

export const tests = [{
  name: 'leaves one real WSL2 Nextflow process owned by a persisted External Workflow Run',
  requiredEnv: REQUIRED_ENV,
  async run(context) {
    const { browser, expect } = context;
    if (process.platform !== 'win32') throw new Error('This proof must start from the native Windows app.');
    const fixture = await ensureSeeded(context);
    await navigateInApp(browser, `/tools/external-workflows/${DEFINITION_ID}`);
    await waitForDefinitionReady(browser);
    await chooseWorkflowInput(browser, path.basename(fixture.inputPath));
    await browser.execute(() => {
      const set = (testId, value) => {
        const input = document.querySelector(`[data-testid="${testId}"]`);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
        setter?.call(input, String(value));
        input?.dispatchEvent(new Event('input', { bubbles: true }));
        input?.dispatchEvent(new Event('change', { bubbles: true }));
      };
      set('external-workflow-parameter-label', 'restart-owned');
      set('external-workflow-parameter-delay_seconds', 120);
    });

    const startedAt = Date.now();
    await (await browser.$('[data-testid="run-external-workflow"]')).click();
    await browser.waitUntil(
      async () => (await workflowJobs(browser, DEFINITION_ID)).some((job) => (
        job.startedAtMs >= startedAt && job.status?.type === 'running'
      )),
      { timeout: 30_000, timeoutMsg: 'The restart fixture did not start its WSL2 Nextflow Job' },
    );
    const job = (await workflowJobs(browser, DEFINITION_ID))
      .find((candidate) => candidate.startedAtMs >= startedAt && candidate.status?.type === 'running');
    expect(job).toBeTruthy();
    expect(job.metadata).toMatchObject({
      executionBackend: 'wsl2',
      executionPlatform: 'linux',
      executionArchitecture: 'x86_64',
      wslDistribution: expect.any(String),
      wslControlFile: expect.any(String),
      execution: { runKind: 'external-workflow', runId: expect.any(String) },
    });
    const control = JSON.parse(fs.readFileSync(job.metadata.wslControlFile, 'utf8'));
    await browser.waitUntil(
      async () => wslTokenProcessIds(control.distribution, control.token).length > 0,
      { timeout: 20_000, timeoutMsg: 'The token-owned WSL2 process tree was not observable' },
    );

    await browser.waitUntil(async () => {
      const records = await readWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json');
      return records.some((record) => (
        record.identity.runId === job.metadata.execution.runId
        && record.status === 'running'
        && record.jobIds.includes(job.id)
      ));
    }, { timeout: 20_000, timeoutMsg: 'The active External Workflow ownership was not persisted' });

    fs.writeFileSync(process.env.LIATIR_NEXTFLOW_RESTART_STATE, `${JSON.stringify({
      runId: job.metadata.execution.runId,
      jobId: job.id,
      controlFile: job.metadata.wslControlFile,
      distribution: control.distribution,
      token: control.token,
    }, null, 2)}\n`);
  },
}];
