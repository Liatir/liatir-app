import { createServer } from 'node:http';

import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const PIPELINE_A_ID = 'e2e-delayed-pipeline';
const PIPELINE_B_ID = 'e2e-independent-pipeline';
const REQUEST_ID = 'e2e-delayed-request';
const COLLECTION_ID = 'e2e-local-api';

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

  return {
    current: {
      id: PIPELINE_A_ID,
      name: pipelineA.name,
      nodes: pipelineA.nodes,
      edges: pipelineA.edges,
    },
    saved: [pipelineA, pipelineB],
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

    await Promise.all([
      write('workspaces/__test__/pipeline-workspace.json', pipelineState),
      write('workspaces/__test__/api-workspace.json', apiState),
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
];
