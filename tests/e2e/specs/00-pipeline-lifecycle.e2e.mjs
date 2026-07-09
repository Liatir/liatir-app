import { createServer } from 'node:http';

import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const PIPELINE_A_ID = 'e2e-delayed-pipeline';
const PIPELINE_B_ID = 'e2e-independent-pipeline';
const PIPELINE_FAILURE_ID = 'e2e-failing-pipeline';
const PIPELINE_INTERRUPTED_ID = 'e2e-interrupted-pipeline';
const PIPELINE_NATIVE_JOB_ID = 'e2e-native-job-pipeline';
const REQUEST_ID = 'e2e-delayed-request';
const FAILURE_REQUEST_ID = 'e2e-failing-request';
const INTERRUPTED_RUN_ID = 'e2e-interrupted-run';
const COLLECTION_ID = 'e2e-local-api';
const INTERRUPTED_ERROR = 'Pipeline run was interrupted before Liatir could finalize it.';

async function startDelayedApi() {
  const server = createServer((_request, response) => {
    setTimeout(() => {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ ok: true, source: 'pipeline-lifecycle-e2e' }));
    }, 800);
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    server.close();
    throw new Error('Delayed API did not expose a TCP port.');
  }

  return {
    url: `http://127.0.0.1:${address.port}/result`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function pipelineWorkspace() {
  const now = Date.now();
  const pipelineA = {
    id: PIPELINE_A_ID,
    name: 'Delayed API Pipeline',
    nodes: [
      {
        id: 'api-step',
        type: 'api-request',
        position: { x: 180, y: 120 },
        data: {
          requestId: REQUEST_ID,
          requestName: 'Delayed response',
          paramOverrides: {},
        },
      },
    ],
    edges: [],
    updatedAt: now,
  };
  const pipelineB = {
    id: PIPELINE_B_ID,
    name: 'Independent Pipeline',
    nodes: [
      {
        id: 'value-step',
        type: 'variable',
        position: { x: 240, y: 160 },
        data: { varType: 'string', value: 'independent' },
      },
    ],
    edges: [],
    updatedAt: now - 1,
  };
  const failingPipeline = {
    id: PIPELINE_FAILURE_ID,
    name: 'Failing API Pipeline',
    nodes: [
      {
        id: 'failing-api-step',
        type: 'api-request',
        position: { x: 200, y: 140 },
        data: {
          requestId: FAILURE_REQUEST_ID,
          requestName: 'Unreachable endpoint',
          paramOverrides: {},
        },
      },
    ],
    edges: [],
    updatedAt: now - 2,
  };
  const interruptedPipeline = {
    id: PIPELINE_INTERRUPTED_ID,
    name: 'Interrupted Pipeline',
    nodes: [
      {
        id: 'interrupted-step',
        type: 'variable',
        position: { x: 220, y: 150 },
        data: { varType: 'string', value: 'interrupted' },
      },
    ],
    edges: [],
    updatedAt: now - 3,
  };
  const nativeJobPipeline = {
    id: PIPELINE_NATIVE_JOB_ID,
    name: 'Native Job Pipeline',
    nodes: [
      {
        id: 'seqkit-step',
        type: 'tool',
        position: { x: 210, y: 145 },
        data: {
          stepId: 'seqkit-stats',
          label: 'Sequence statistics',
          inputs: {
            inputFile: '/tmp/e2e-sequences.fastq',
            threads: '1',
          },
        },
      },
    ],
    edges: [],
    updatedAt: now - 4,
  };

  return {
    current: {
      id: PIPELINE_A_ID,
      name: pipelineA.name,
      nodes: pipelineA.nodes,
      edges: pipelineA.edges,
    },
    saved: [pipelineA, pipelineB, failingPipeline, interruptedPipeline, nativeJobPipeline],
    runtime: [],
  };
}

function apiWorkspace(url) {
  const now = Date.now();
  return {
    collections: [
      {
        id: COLLECTION_ID,
        name: 'E2E local API',
        auth: { type: 'none' },
        sharedHeaders: [],
        sharedParams: [],
        createdAt: now,
      },
    ],
    requests: [
      {
        id: REQUEST_ID,
        collectionId: COLLECTION_ID,
        name: 'Delayed response',
        useAs: 'data',
        method: 'GET',
        url,
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        createdAt: now,
        updatedAt: now,
        outputSchema: {
          source: { path: 'source', label: 'Source', type: 'string' },
        },
      },
      {
        id: FAILURE_REQUEST_ID,
        collectionId: COLLECTION_ID,
        name: 'Unreachable endpoint',
        useAs: 'data',
        method: 'GET',
        url: 'http://127.0.0.1:1/unreachable',
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        createdAt: now,
        updatedAt: now,
      },
    ],
    environments: [],
    activeEnvironmentId: null,
  };
}

async function seedSandbox(browser, apiUrl) {
  await waitForLiatirBridge(browser);
  await browser.execute(async (pipelineState, apiState) => {
    const write = (rel, value) => window.Liatir.invoke('lia_app_write_text', {
      rel,
      content: JSON.stringify(value, null, 2),
      createDirs: true,
    });
    const writeData = (rel, value) => window.Liatir.invoke('lia_fs_write_text', {
      rel,
      permanent: true,
      contents: JSON.stringify(value, null, 2),
      createDirs: true,
      append: false,
      windowLabel: null,
      pluginStoragePlugin: null,
    });

    await Promise.all([
      write('workspaces/__test__/pipeline-workspace.json', pipelineState),
      write('workspaces/__test__/api-workspace.json', apiState),
      writeData('managed-bins/index.json', {
        bins: {
          seqkit: {
            binary: 'seqkit',
            version: 'e2e',
            path: '/bin/echo',
            platform: 'macos',
            arch: 'test',
            installedAt: Date.now(),
          },
        },
      }),
    ]);
  }, pipelineWorkspace(), apiWorkspace(apiUrl));
}

async function openPipeline(browser, pipelineId) {
  const selector = `[data-testid="pipeline-card"][data-pipeline-id="${pipelineId}"] [data-testid="pipeline-card-open"]`;
  const card = await browser.$(selector);
  await card.waitForDisplayed({ timeout: 20_000 });
  await browser.execute((cardSelector) => {
    document.querySelector(cardSelector)?.click();
  }, selector);
  await browser.waitUntil(
    async () => browser.execute((expectedId) => {
      const editor = document.querySelector('[data-testid="pipeline-editor"]');
      return window.location.pathname === '/pipeline' && editor?.getAttribute('data-pipeline-id') === expectedId;
    }, pipelineId),
    { timeout: 20_000, timeoutMsg: `Pipeline editor did not open ${pipelineId}` },
  );
}

async function readWorkspaceJson(browser, rel) {
  return browser.execute(async (path) => {
    const raw = await window.Liatir.invoke('lia_app_read_text', { rel: path });
    return JSON.parse(raw);
  }, rel);
}

async function writeInterruptedRuntime(browser) {
  await browser.execute(async (pipelineId, runId) => {
    const rel = 'workspaces/__test__/pipeline-workspace.json';
    const raw = await window.Liatir.invoke('lia_app_read_text', { rel });
    const workspace = JSON.parse(raw);
    const pipeline = workspace.saved.find((candidate) => candidate.id === pipelineId);
    const startedAt = Date.now() - 1_000;

    workspace.current = {
      id: pipeline.id,
      name: pipeline.name,
      nodes: pipeline.nodes,
      edges: pipeline.edges,
    };
    workspace.runtime = [
      ...(workspace.runtime ?? []).filter((runtime) => runtime.key !== pipelineId),
      {
        key: pipelineId,
        pipelineId,
        pipelineName: pipeline.name,
        nodeStates: [[
          'interrupted-step',
          {
            status: 'running',
            logs: ['Interrupted step started'],
            outputFiles: [],
            error: null,
          },
        ]],
        running: true,
        runId,
        startedAt,
      },
    ];

    await window.Liatir.invoke('lia_app_write_text', {
      rel,
      content: JSON.stringify(workspace, null, 2),
      createDirs: true,
    });
  }, PIPELINE_INTERRUPTED_ID, INTERRUPTED_RUN_ID);
}

export const tests = [
  {
    name: 'keeps pipeline runs isolated across navigation and finalizes the originating Result',
    async run({ browser, expect }) {
      const delayedApi = await startDelayedApi();

      try {
        await seedSandbox(browser, delayedApi.url);
        await openSandboxWorkspace(browser);
        await navigateSidebar(browser, '/pipelines');
        await openPipeline(browser, PIPELINE_A_ID);

        const runButton = await browser.$('[data-testid="pipeline-run-button"]');
        await runButton.waitForDisplayed({ timeout: 20_000 });
        await runButton.click();

        await navigateSidebar(browser, '/pipelines');
        await browser.waitUntil(
          async () => browser.execute((pipelineId) => {
            const card = document.querySelector(`[data-testid="pipeline-card"][data-pipeline-id="${pipelineId}"]`);
            return card?.textContent?.includes('Running') ?? false;
          }, PIPELINE_A_ID),
          { timeout: 20_000, timeoutMsg: 'Originating pipeline was not shown as running' },
        );

        await openPipeline(browser, PIPELINE_B_ID);
        const independentState = await browser.execute(() => ({
          path: window.location.pathname,
          pipelineId: document.querySelector('[data-testid="pipeline-editor"]')?.getAttribute('data-pipeline-id'),
          runDisabled: document.querySelector('[data-testid="pipeline-run-button"]')?.disabled,
        }));
        expect(independentState).toEqual({
          path: '/pipeline',
          pipelineId: PIPELINE_B_ID,
          runDisabled: false,
        });

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            try {
              const raw = await window.Liatir.invoke('lia_app_read_text', {
                rel: 'workspaces/__test__/analysis-runs/index.json',
              });
              const runs = JSON.parse(raw);
              return runs.find((run) => run.tool === 'pipeline' && run.params?.pipelineId === pipelineId) ?? false;
            } catch {
              return false;
            }
          }, PIPELINE_A_ID),
          { timeout: 30_000, timeoutMsg: 'Originating pipeline Result was not persisted off-page' },
        );

        const completedRun = await browser.execute(async (pipelineId) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/analysis-runs/index.json',
          });
          return JSON.parse(raw).find(
            (run) => run.tool === 'pipeline' && run.params?.pipelineId === pipelineId,
          );
        }, PIPELINE_A_ID);

        expect(completedRun.status).toBe('done');
        expect(completedRun.label).toBe('Delayed API Pipeline');
        expect(completedRun.params.pipelineId).toBe(PIPELINE_A_ID);
        expect(completedRun.params.pipelineRunId).toBe(completedRun.id);

        const allRuns = await browser.execute(async () => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/analysis-runs/index.json',
          });
          return JSON.parse(raw);
        });
        expect(allRuns.filter((run) => run.id === completedRun.id)).toHaveLength(1);

        await navigateSidebar(browser, '/results');
        const resultSelector = `[data-testid="result-run"][data-run-id="${completedRun.id}"]`;
        await (await browser.$(resultSelector)).waitForDisplayed({ timeout: 20_000 });
        await expectNoVisibleRuntimeError(browser);
      } finally {
        await delayedApi.close();
      }
    },
  },
  {
    name: 'persists a failed pipeline exactly once with readable Result state',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_FAILURE_ID);

      const runButton = await browser.$('[data-testid="pipeline-run-button"]');
      await runButton.waitForDisplayed({ timeout: 20_000 });
      await runButton.click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          try {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.tool === 'pipeline'
                && run.params?.pipelineId === pipelineId
                && run.status === 'error',
            );
          } catch {
            return false;
          }
        }, PIPELINE_FAILURE_ID),
        { timeout: 30_000, timeoutMsg: 'Failed pipeline Result was not persisted' },
      );

      const runs = await readWorkspaceJson(
        browser,
        'workspaces/__test__/analysis-runs/index.json',
      );
      const failedRuns = runs.filter(
        (run) => run.tool === 'pipeline' && run.params?.pipelineId === PIPELINE_FAILURE_ID,
      );
      expect(failedRuns).toHaveLength(1);
      expect(failedRuns[0].status).toBe('error');
      expect(failedRuns[0].params.pipelineRunId).toBe(failedRuns[0].id);
      expect(typeof failedRuns[0].error).toBe('string');
      expect(failedRuns[0].error.length).toBeGreaterThan(0);

      await navigateSidebar(browser, '/results');
      const resultSelector = `[data-testid="result-run"][data-run-id="${failedRuns[0].id}"]`;
      const result = await browser.$(resultSelector);
      await result.waitForDisplayed({ timeout: 20_000 });
      await browser.execute((selector) => {
        document.querySelector(`${selector} [data-testid="result-run-open"]`)?.click();
      }, resultSelector);
      await browser.waitUntil(
        async () => browser.execute((message) => document.body.textContent?.includes(message) ?? false, failedRuns[0].error),
        { timeout: 20_000, timeoutMsg: 'Failed Result did not expose its error' },
      );
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'reconciles an interrupted pipeline after reload and finalizes one Result',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_INTERRUPTED_ID);
      await writeInterruptedRuntime(browser);

      await browser.execute(() => window.location.reload());
      await waitForLiatirBridge(browser);
      await browser.waitUntil(
        async () => browser.execute((pipelineId) => {
          const editor = document.querySelector('[data-testid="pipeline-editor"]');
          return window.location.pathname === '/pipeline'
            && editor?.getAttribute('data-pipeline-id') === pipelineId;
        }, PIPELINE_INTERRUPTED_ID),
        { timeout: 30_000, timeoutMsg: 'Interrupted pipeline was not restored after reload' },
      );

      await browser.waitUntil(
        async () => browser.execute(async (runId) => {
          try {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.id === runId && run.status === 'error',
            );
          } catch {
            return false;
          }
        }, INTERRUPTED_RUN_ID),
        { timeout: 30_000, timeoutMsg: 'Interrupted pipeline Result was not finalized' },
      );

      const editorState = await browser.execute(() => ({
        runDisabled: document.querySelector('[data-testid="pipeline-run-button"]')?.disabled,
      }));
      expect(editorState.runDisabled).toBe(false);

      const workspace = await readWorkspaceJson(
        browser,
        'workspaces/__test__/pipeline-workspace.json',
      );
      const runtime = workspace.runtime.find(
        (candidate) => candidate.key === PIPELINE_INTERRUPTED_ID,
      );
      expect(runtime.running).toBe(false);
      expect(runtime.runId).toBe(INTERRUPTED_RUN_ID);
      expect(runtime.nodeStates[0][1].status).toBe('error');
      expect(runtime.nodeStates[0][1].error).toBe(INTERRUPTED_ERROR);

      const runs = await readWorkspaceJson(
        browser,
        'workspaces/__test__/analysis-runs/index.json',
      );
      const interruptedRuns = runs.filter((run) => run.id === INTERRUPTED_RUN_ID);
      expect(interruptedRuns).toHaveLength(1);
      expect(interruptedRuns[0].params.pipelineId).toBe(PIPELINE_INTERRUPTED_ID);
      expect(interruptedRuns[0].params.pipelineRunId).toBe(INTERRUPTED_RUN_ID);
      expect(interruptedRuns[0].error).toBe(INTERRUPTED_ERROR);

      await navigateSidebar(browser, '/pipelines');
      const cardText = await (
        await browser.$(`[data-testid="pipeline-card"][data-pipeline-id="${PIPELINE_INTERRUPTED_ID}"]`)
      ).getText();
      expect(cardText).not.toContain('Running');

      await navigateSidebar(browser, '/results');
      const resultSelector = `[data-testid="result-run"][data-run-id="${INTERRUPTED_RUN_ID}"]`;
      await (await browser.$(resultSelector)).waitForDisplayed({ timeout: 20_000 });
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'attributes a native child Job to its originating pipeline run',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_NATIVE_JOB_ID);

      const runButton = await browser.$('[data-testid="pipeline-run-button"]');
      await runButton.waitForDisplayed({ timeout: 20_000 });
      await runButton.click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', {
            workspaceId: '__test__',
          });
          return jobs.some(
            (job) => job.metadata?.pipelineId === pipelineId
              && job.metadata?.runKind === 'pipeline-step',
          );
        }, PIPELINE_NATIVE_JOB_ID),
        { timeout: 30_000, timeoutMsg: 'Pipeline child Job was not attributed' },
      );

      const jobs = await browser.execute(async (pipelineId) => {
        const allJobs = await window.Liatir.invoke('lia_jobs_list', {
          workspaceId: '__test__',
        });
        return allJobs.filter((job) => job.metadata?.pipelineId === pipelineId);
      }, PIPELINE_NATIVE_JOB_ID);
      expect(jobs).toHaveLength(1);

      const [job] = jobs;
      expect(job.kind).toBe('pipeline-step');
      expect(job.label).toBe('Sequence statistics');
      expect(job.metadata.pipelineName).toBe('Native Job Pipeline');
      expect(job.metadata.nodeId).toBe('seqkit-step');
      expect(job.metadata.toolId).toBe('seqkit-stats');
      expect(typeof job.metadata.pipelineRunId).toBe('string');
      expect(job.metadata.pipelineRunId.length).toBeGreaterThan(0);

      await browser.waitUntil(
        async () => browser.execute(async (runId) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/analysis-runs/index.json',
          });
          return JSON.parse(raw).some(
            (run) => run.id === runId && run.status === 'done',
          );
        }, job.metadata.pipelineRunId),
        { timeout: 30_000, timeoutMsg: 'Native Job parent Result was not finalized' },
      );

      await navigateSidebar(browser, '/jobs');
      const jobSelector = `[data-testid="job-entry"][data-job-id="${job.id}"]`;
      const jobEntry = await browser.$(jobSelector);
      await jobEntry.waitForDisplayed({ timeout: 20_000 });
      const jobText = await jobEntry.getText();
      expect(jobText).toContain('Pipeline · Native Job Pipeline');
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
