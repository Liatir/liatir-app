import {
  navigateSidebar,
  openSandboxWorkspace,
  waitForLiatirBridge,
} from './liatir-app.mjs';

export const RESTART_PIPELINE_ID = 'e2e-settlement-restart-pipeline';
export const RESTART_NODE_ID = 'restart-api-step';
export const RESTART_DOWNSTREAM_ID = 'restart-downstream';
export const INTERRUPTED_ERROR = 'Pipeline run was interrupted before Liatir could finalize it.';
export const DIRECT_RESTART_RUNS = [
  {
    runId: 'e2e-direct-ai-interrupted',
    runKind: 'ai-model',
    entityId: 'e2e-ai-model',
    label: 'Interrupted AI Model',
  },
  {
    runId: 'e2e-direct-plugin-interrupted',
    runKind: 'lia-plugin',
    entityId: 'e2e-plugin',
    label: 'Interrupted Plugin',
  },
  {
    runId: 'e2e-direct-native-tool-interrupted',
    runKind: 'native-tool',
    entityId: 'e2e-native-tool',
    label: 'Interrupted Native Tool',
  },
  {
    runId: 'e2e-direct-api-interrupted',
    runKind: 'api-request',
    entityId: 'e2e-api-request',
    label: 'Interrupted API Connector',
  },
];
const REQUEST_ID = 'e2e-settlement-restart-request';
const COLLECTION_ID = 'e2e-settlement-restart-api';

function pipelineWorkspace() {
  const pipeline = {
    id: RESTART_PIPELINE_ID,
    name: 'Pipeline Restart Settlement',
    nodes: [
      {
        id: RESTART_NODE_ID,
        type: 'api-request',
        position: { x: 120, y: 120 },
        data: { requestId: REQUEST_ID, requestName: 'Never-settled request', paramOverrides: {} },
      },
      {
        id: RESTART_DOWNSTREAM_ID,
        type: 'variable',
        position: { x: 480, y: 120 },
        data: { varType: 'string', value: 'must-not-run' },
      },
    ],
    edges: [{
      id: 'restart-api-to-downstream',
      source: RESTART_NODE_ID,
      target: RESTART_DOWNSTREAM_ID,
    }],
    updatedAt: Date.now(),
  };
  return {
    current: {
      id: pipeline.id,
      name: pipeline.name,
      nodes: pipeline.nodes,
      edges: pipeline.edges,
    },
    saved: [pipeline],
    runtime: [],
  };
}

function apiWorkspace(url) {
  const now = Date.now();
  return {
    collections: [{
      id: COLLECTION_ID,
      name: 'Pipeline restart E2E',
      auth: { type: 'none' },
      sharedHeaders: [],
      sharedParams: [],
      createdAt: now,
    }],
    requests: [{
      id: REQUEST_ID,
      collectionId: COLLECTION_ID,
      name: 'Never-settled request',
      method: 'GET',
      url,
      params: [],
      headers: [],
      body: { type: 'none', content: '' },
      auth: { type: 'inherit' },
      createdAt: now,
      updatedAt: now,
    }],
  };
}

export async function seedRestartPipeline(browser, apiUrl) {
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
  await openSandboxWorkspace(browser);
}

export async function openRestartPipeline(browser) {
  await navigateSidebar(browser, '/pipelines');
  const selector = `[data-testid="pipeline-card"][data-pipeline-id="${RESTART_PIPELINE_ID}"] [data-testid="pipeline-card-open"]`;
  const card = await browser.$(selector);
  await card.waitForDisplayed({ timeout: 20_000 });
  await browser.execute((cardSelector) => document.querySelector(cardSelector)?.click(), selector);
  await browser.waitUntil(
    async () => browser.execute((pipelineId) => (
      window.location.pathname === '/pipeline'
      && document.querySelector('[data-testid="pipeline-editor"]')?.getAttribute('data-pipeline-id') === pipelineId
    ), RESTART_PIPELINE_ID),
    { timeout: 20_000, timeoutMsg: 'Restart fixture pipeline did not open' },
  );
}

/** Add direct runs only after the pending pipeline has flushed its own identities. */
export async function seedInterruptedDirectRuns(browser) {
  await browser.waitUntil(
    async () => browser.execute(async () => {
      try {
        const raw = await window.Liatir.invoke('lia_app_read_text', {
          rel: 'workspaces/__test__/execution-runs/index.json',
        });
        const records = JSON.parse(raw);
        return records.some((record) => record.identity?.runKind === 'pipeline' && record.status === 'running')
          && records.some((record) => record.identity?.runKind === 'api-request' && record.status === 'running');
      } catch {
        return false;
      }
    }),
    { timeout: 20_000, timeoutMsg: 'Pending pipeline execution identities were not durable' },
  );

  await browser.execute(async (definitions) => {
    const rel = 'workspaces/__test__/execution-runs/index.json';
    const records = JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel }));
    const now = Date.now();
    for (const definition of definitions) {
      records.unshift({
        identity: {
          schemaVersion: 1,
          runId: definition.runId,
          runKind: definition.runKind,
          workspaceId: '__test__',
          rootRunId: definition.runId,
          entityId: definition.entityId,
        },
        label: definition.label,
        status: 'running',
        resultPolicy: 'own',
        resultId: definition.runId,
        jobIds: [],
        inputs: [],
        params: { restartFixture: true },
        logs: [],
        startedAt: now,
        updatedAt: now,
      });
    }
    await window.Liatir.invoke('lia_app_write_text', {
      rel,
      content: JSON.stringify(records, null, 2),
      createDirs: true,
    });
  }, DIRECT_RESTART_RUNS);
}

export async function readRestartState(browser) {
  return browser.execute(async (pipelineId) => {
    const read = async (rel) => {
      try {
        const raw = await window.Liatir.invoke('lia_app_read_text', { rel });
        return JSON.parse(raw);
      } catch {
        return null;
      }
    };
    const [workspace, runs, executions] = await Promise.all([
      read('workspaces/__test__/pipeline-workspace.json'),
      read('workspaces/__test__/analysis-runs/index.json'),
      read('workspaces/__test__/execution-runs/index.json'),
    ]);
    const allRuns = runs ?? [];
    return {
      runtime: workspace?.runtime?.find((entry) => entry.key === pipelineId) ?? null,
      runs: allRuns.filter((run) => run.params?.pipelineId === pipelineId),
      directRuns: allRuns.filter((run) => run.params?.restartFixture === true),
      executions: executions ?? [],
    };
  }, RESTART_PIPELINE_ID);
}
