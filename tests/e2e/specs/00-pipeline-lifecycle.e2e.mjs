/**
 * The pipeline lifecycle, driven end to end through the real app.
 *
 * Named `00-` so it runs first: it is the broadest spec, and a break here means everything after it is noise.
 *
 * The pipeline IDs below say what is being defended, and it is mostly **isolation**. Liatir's rule is that state
 * belongs to a run, not to the app: a slow pipeline must not block an independent one, a failure in one must not
 * poison another, a cancelled run must finalise as cancelled and not as an error, and a run must survive the user
 * navigating away and coming back. None of that can be proven from a unit test — it only shows up when a real app
 * runs two real pipelines at once, which is exactly what this does.
 */
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { npmInvocation } from '../../../scripts/node-cli.mjs';

import {
  expectNoVisibleRuntimeError,
  navigateSidebar,
  openSandboxWorkspace,
  reloadLiatirApp,
  waitForLiatirBridge,
} from '../support/liatir-app.mjs';

const PIPELINE_A_ID = 'e2e-delayed-pipeline';
const PIPELINE_B_ID = 'e2e-independent-pipeline';
const PIPELINE_FAILURE_ID = 'e2e-failing-pipeline';
const PIPELINE_INTERRUPTED_ID = 'e2e-interrupted-pipeline';
const PIPELINE_NATIVE_JOB_ID = 'e2e-native-job-pipeline';
const PIPELINE_CANCELLATION_ID = 'e2e-cancellable-pipeline';
const PIPELINE_SCIENTIFIC_ID = 'e2e-scientific-pipeline';
const PIPELINE_PLUGIN_ID = 'e2e-plugin-settlement-pipeline';
const PIPELINE_PLUGIN_CANCELLATION_ID = 'e2e-plugin-cancellation-pipeline';
const PIPELINE_API_CANCELLATION_ID = 'e2e-api-cancellation-pipeline';
const PIPELINE_SUB_ID = 'e2e-sub-pipeline-parent';
const PIPELINE_SUB_FAILURE_ID = 'e2e-sub-pipeline-failure-parent';
const SUB_PIPELINE_CHILD_ID = 'e2e-sub-pipeline-child';
const SUB_PIPELINE_FAILURE_CHILD_ID = 'e2e-sub-pipeline-failure-child';
const REQUEST_ID = 'e2e-delayed-request';
const SUB_REQUEST_ID = 'e2e-sub-pipeline-request';
const API_CANCELLATION_REQUEST_ID = 'e2e-api-cancellation-request';
const FAILURE_REQUEST_ID = 'e2e-failing-request';
const PLUGIN_ID = 'e2e-settlement-plugin';
const INTERRUPTED_RUN_ID = 'e2e-interrupted-run';
const COLLECTION_ID = 'e2e-local-api';
const INTERRUPTED_ERROR = 'Pipeline run was interrupted before Liatir could finalize it.';

async function startDelayedApi(delayMs = 800) {
  const server = createServer((_request, response) => {
    const timer = setTimeout(() => {
      response.writeHead(200, {
        'access-control-allow-origin': '*',
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ ok: true, source: 'pipeline-lifecycle-e2e' }));
    }, delayMs);
    response.once('close', () => clearTimeout(timer));
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

let settlementPluginPath = null;

function buildSettlementPlugin(rootDir, artifactsDir) {
  if (settlementPluginPath && fs.existsSync(settlementPluginPath)) return settlementPluginPath;
  const source = path.join(rootDir, 'tests', 'fixtures', 'pipeline-settlement-plugin');
  const workDir = path.join(artifactsDir, 'reports', 'pipeline-settlement-e2e', 'plugin');
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(workDir), { recursive: true });
  fs.cpSync(source, workDir, { recursive: true });

  const npm = npmInvocation(['run', 'build', '--prefix', 'packages/liatir-cli']);
  execFileSync(npm.command, npm.args, { cwd: rootDir, stdio: 'pipe' });
  execFileSync('node', [path.join(rootDir, 'packages', 'liatir-cli', 'dist', 'cli.js'), 'build'], {
    cwd: workDir,
    stdio: 'pipe',
  });
  const name = fs.readdirSync(path.join(workDir, '.liatir')).find((entry) => entry.endsWith('.lia'));
  if (!name) throw new Error('Pipeline settlement Plugin fixture did not produce a .lia bundle.');
  settlementPluginPath = path.join(workDir, '.liatir', name);
  return settlementPluginPath;
}

function pipelineWorkspace(fixtures) {
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
      {
        id: 'api-downstream',
        type: 'variable',
        position: { x: 500, y: 120 },
        data: { varType: 'string', value: 'after-api' },
      },
    ],
    edges: [{
      id: 'api-to-downstream',
      source: 'api-step',
      sourceHandle: 'responseBody',
      target: 'api-downstream',
      targetHandle: 'value',
    }],
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
            inputFile: fixtures.sequences,
            threads: '1',
          },
        },
      },
    ],
    edges: [],
    updatedAt: now - 4,
  };
  const cancellationPipeline = {
    id: PIPELINE_CANCELLATION_ID,
    name: 'Cancellable Pipeline',
    nodes: [
      {
        id: 'slow-fastp-step',
        type: 'tool',
        position: { x: 210, y: 145 },
        data: {
          stepId: 'fastp',
          label: 'Slow native step',
          inputs: {
            r1: fixtures.slowReads,
            r2: '',
            threads: '1',
          },
        },
      },
    ],
    edges: [],
    updatedAt: now - 5,
  };
  const scientificPipeline = {
    id: PIPELINE_SCIENTIFIC_ID,
    name: 'Alignment QC Pipeline',
    nodes: [
      {
        id: 'align-step',
        type: 'tool',
        position: { x: 120, y: 140 },
        data: {
          stepId: 'minimap2',
          label: 'Align reads',
          inputs: {
            reference: fixtures.reference,
            reads: fixtures.reads,
            threads: '1',
          },
        },
      },
      {
        id: 'flagstat-step',
        type: 'tool',
        position: { x: 480, y: 140 },
        data: {
          stepId: 'samtools-flagstat',
          label: 'Alignment QC',
          inputs: {
            inputFile: '@pipe:align-step:outputSam',
            threads: '1',
          },
        },
      },
    ],
    edges: [
      {
        id: 'align-to-qc',
        source: 'align-step',
        sourceHandle: 'outputSam',
        target: 'flagstat-step',
        targetHandle: 'inputFile',
      },
    ],
    updatedAt: now - 6,
  };

  const pluginPipeline = {
    id: PIPELINE_PLUGIN_ID,
    name: 'Plugin Settlement Pipeline',
    nodes: [
      {
        id: 'plugin-step',
        type: 'tool',
        position: { x: 120, y: 140 },
        data: {
          stepId: `plugin:${PLUGIN_ID}`,
          label: 'Delayed Plugin',
          inputs: { value: 'plugin-settled', delayMs: '1200' },
        },
      },
      {
        id: 'plugin-downstream',
        type: 'variable',
        position: { x: 480, y: 140 },
        data: { varType: 'string', value: 'after-plugin' },
      },
    ],
    edges: [{
      id: 'plugin-to-downstream',
      source: 'plugin-step',
      sourceHandle: 'value',
      target: 'plugin-downstream',
      targetHandle: 'value',
    }],
    updatedAt: now - 7,
  };
  const pluginCancellationPipeline = {
    ...pluginPipeline,
    id: PIPELINE_PLUGIN_CANCELLATION_ID,
    name: 'Plugin Cancellation Pipeline',
    nodes: pluginPipeline.nodes.map((node) => node.id === 'plugin-step'
      ? { ...node, data: { ...node.data, delayMs: '30000' } }
      : { ...node }),
    updatedAt: now - 8,
  };
  const subPipelineChild = {
    id: SUB_PIPELINE_CHILD_ID,
    name: 'Delayed API Child',
    nodes: [
      {
        id: 'child-api-step',
        type: 'api-request',
        position: { x: 100, y: 100 },
        data: { requestId: SUB_REQUEST_ID, requestName: 'Child delayed response', paramOverrides: {} },
      },
      {
        id: 'child-downstream',
        type: 'variable',
        position: { x: 420, y: 100 },
        data: { varType: 'string', value: 'child-settled' },
      },
    ],
    edges: [{
      id: 'child-api-to-downstream',
      source: 'child-api-step',
      sourceHandle: 'responseBody',
      target: 'child-downstream',
      targetHandle: 'value',
    }],
    updatedAt: now - 9,
  };
  const subPipelineParent = {
    id: PIPELINE_SUB_ID,
    name: 'Sub-pipeline Settlement Parent',
    nodes: [
      {
        id: 'sub-pipeline-step',
        type: 'sub-pipeline',
        position: { x: 120, y: 120 },
        data: { pipelineId: SUB_PIPELINE_CHILD_ID, pipelineName: subPipelineChild.name },
      },
      {
        id: 'sub-downstream',
        type: 'variable',
        position: { x: 480, y: 120 },
        data: { varType: 'string', value: 'after-sub-pipeline' },
      },
    ],
    edges: [{
      id: 'sub-to-downstream',
      source: 'sub-pipeline-step',
      target: 'sub-downstream',
    }],
    updatedAt: now - 10,
  };
  const subPipelineFailureChild = {
    id: SUB_PIPELINE_FAILURE_CHILD_ID,
    name: 'Failing API Child',
    nodes: [{
      id: 'child-failing-api-step',
      type: 'api-request',
      position: { x: 120, y: 120 },
      data: { requestId: FAILURE_REQUEST_ID, requestName: 'Unreachable endpoint', paramOverrides: {} },
    }],
    edges: [],
    updatedAt: now - 11,
  };
  const subPipelineFailureParent = {
    id: PIPELINE_SUB_FAILURE_ID,
    name: 'Failing Sub-pipeline Parent',
    nodes: [{
      id: 'failing-sub-pipeline-step',
      type: 'sub-pipeline',
      position: { x: 120, y: 120 },
      data: { pipelineId: SUB_PIPELINE_FAILURE_CHILD_ID, pipelineName: subPipelineFailureChild.name },
    }],
    edges: [],
    updatedAt: now - 12,
  };
  const apiCancellationPipeline = {
    id: PIPELINE_API_CANCELLATION_ID,
    name: 'API Cancellation Pipeline',
    nodes: [
      {
        id: 'cancellable-api-step',
        type: 'api-request',
        position: { x: 120, y: 120 },
        data: { requestId: API_CANCELLATION_REQUEST_ID, requestName: 'Cancellable API', paramOverrides: {} },
      },
      {
        id: 'api-cancel-downstream',
        type: 'variable',
        position: { x: 480, y: 120 },
        data: { varType: 'string', value: 'must-not-run' },
      },
    ],
    edges: [{
      id: 'api-cancel-to-downstream',
      source: 'cancellable-api-step',
      target: 'api-cancel-downstream',
    }],
    updatedAt: now - 13,
  };

  return {
    current: {
      id: PIPELINE_A_ID,
      name: pipelineA.name,
      nodes: pipelineA.nodes,
      edges: pipelineA.edges,
    },
    saved: [
      pipelineA,
      pipelineB,
      failingPipeline,
      interruptedPipeline,
      nativeJobPipeline,
      cancellationPipeline,
      scientificPipeline,
      pluginPipeline,
      pluginCancellationPipeline,
      subPipelineChild,
      subPipelineParent,
      subPipelineFailureChild,
      subPipelineFailureParent,
      apiCancellationPipeline,
    ],
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
        id: SUB_REQUEST_ID,
        collectionId: COLLECTION_ID,
        name: 'Child delayed response',
        useAs: 'data',
        method: 'GET',
        url,
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        createdAt: now,
        updatedAt: now,
      },
      {
        id: API_CANCELLATION_REQUEST_ID,
        collectionId: COLLECTION_ID,
        name: 'Cancellable API',
        useAs: 'data',
        method: 'GET',
        url,
        params: [],
        headers: [{ key: 'Accept', value: 'application/json', enabled: true }],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        createdAt: now,
        updatedAt: now,
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

/**
 * Writes the real inputs the Native Tool pipelines run on.
 *
 * These pipelines run the real tools on inputs the suite owns. The cancellation test
 * is the reason the sizes matter: it needs a Job that is genuinely still running when it asks, so
 * `slow-reads.fastq` is large enough for fastp to take several seconds on one thread, while every
 * other fixture is deliberately tiny.
 */
function writeNativeToolFixtures(fixtureDir) {
  fs.mkdirSync(fixtureDir, { recursive: true });
  const fixtures = {
    sequences: path.join(fixtureDir, 'sequences.fastq'),
    reads: path.join(fixtureDir, 'reads.fastq'),
    slowReads: path.join(fixtureDir, 'slow-reads.fastq'),
    reference: path.join(fixtureDir, 'reference.fa'),
  };
  // A fixed generator, so a rerun compares against the same bytes.
  let seed = 20260821;
  const next = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const bases = 'ACGT';
  const contig = (length) => Array.from({ length }, () => bases[Math.floor(next() * 4)]).join('');

  const chr1 = contig(1_000);
  const chr2 = contig(1_000);
  const wrap = (sequence) => (sequence.match(/.{1,60}/g) ?? []).join('\n');
  fs.writeFileSync(fixtures.reference, `>chr1\n${wrap(chr1)}\n>chr2\n${wrap(chr2)}\n`);

  // Reads cut out of the reference, so minimap2 has something real to align.
  const record = (name, sequence) => `@${name}\n${sequence}\n+\n${'I'.repeat(sequence.length)}\n`;
  const sampled = (count) => {
    let text = '';
    for (let index = 0; index < count; index += 1) {
      const source = index % 2 === 0 ? chr1 : chr2;
      const start = Math.floor(next() * (source.length - 75));
      text += record(`read${index}`, source.slice(start, start + 75));
    }
    return text;
  };
  fs.writeFileSync(fixtures.sequences, sampled(60));
  fs.writeFileSync(fixtures.reads, sampled(200));

  // ~16 MB and roughly five seconds of single-threaded fastp: long enough to observe and cancel,
  // small enough to write in a moment. Written as one repeated block rather than 100k distinct
  // reads because generating them costs more than fastp spends reading them.
  const block = sampled(10_000);
  const slow = fs.createWriteStream(fixtures.slowReads);
  for (let repeat = 0; repeat < 10; repeat += 1) slow.write(block);
  slow.end();
  return fixtures;
}

async function seedSandbox(browser, apiUrl, pluginPath) {
  const fixtures = writeNativeToolFixtures(path.resolve('tests/.artifacts/fixtures/pipeline-lifecycle'));

  await waitForLiatirBridge(browser);
  await browser.execute(async (pipelineState, apiState, pluginBundlePath, pluginId) => {
    const write = (rel, value) => window.Liatir.invoke('lia_app_write_text', {
      rel,
      content: JSON.stringify(value, null, 2),
      createDirs: true,
    });
    const manifest = await window.Liatir.invoke('lia_liatir_read_manifest', {
      path: pluginBundlePath,
    });

    await Promise.all([
      write('workspaces/__test__/pipeline-workspace.json', pipelineState),
      write('workspaces/__test__/api-workspace.json', apiState),
      write('workspaces/__test__/liatir-plugins.json', [{
        id: pluginId,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description ?? '',
        category: manifest.category ?? 'Testing',
        tags: manifest.tags ?? [],
        runtime: manifest.runtime,
        path: pluginBundlePath,
        inputSchema: manifest.inputSchema ?? {},
        outputSchema: manifest.outputSchema ?? {},
        addedAt: Date.now(),
      }]),
    ]);
  }, pipelineWorkspace(fixtures), apiWorkspace(apiUrl), pluginPath, PLUGIN_ID);
}

async function reseedSandbox(browser, apiUrl, pluginPath) {
  await seedSandbox(browser, apiUrl, pluginPath);
  await reloadLiatirApp(browser);
  await openSandboxWorkspace(browser);
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
    async run({ artifactsDir, browser, expect, rootDir }) {
      const delayedApi = await startDelayedApi(8_000);
      const pluginPath = buildSettlementPlugin(rootDir, artifactsDir);

      try {
        await seedSandbox(browser, delayedApi.url, pluginPath);
        await openSandboxWorkspace(browser);
        await navigateSidebar(browser, '/pipelines');
        await openPipeline(browser, PIPELINE_A_ID);

        const runButton = await browser.$('[data-testid="pipeline-run-button"]');
        await runButton.waitForDisplayed({ timeout: 20_000 });
        await runButton.click();

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            try {
              const raw = await window.Liatir.invoke('lia_app_read_text', {
                rel: 'workspaces/__test__/pipeline-workspace.json',
              });
              const runtime = JSON.parse(raw).runtime?.find((entry) => entry.key === pipelineId);
              const states = Object.fromEntries(runtime?.nodeStates ?? []);
              return runtime?.running === true
                && states['api-step']?.status === 'running'
                && states['api-downstream']?.status === 'pending';
            } catch {
              return false;
            }
          }, PIPELINE_A_ID),
          { timeout: 20_000, timeoutMsg: 'API downstream did not remain pending while fetch was active' },
        );

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

        await (await browser.$('[data-testid="pipeline-run-button"]')).click();
        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'done',
            );
          }, PIPELINE_B_ID),
          { timeout: 20_000, timeoutMsg: 'Independent pipeline did not complete concurrently' },
        );
        expect(await browser.execute(async (pipelineId) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/pipeline-workspace.json',
          });
          return JSON.parse(raw).runtime?.find((entry) => entry.key === pipelineId)?.running;
        }, PIPELINE_A_ID)).toBe(true);

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

        const dataIndex = await readWorkspaceJson(
          browser,
          'workspaces/__test__/data-files.json',
        );
        for (const outputFile of completedRun.outputFiles) {
          expect(dataIndex.files.some((file) => file.path === outputFile.path)).toBe(true);
        }

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
    name: 'settles a Plugin Job and durable file before releasing its downstream node',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_PLUGIN_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const [jobs, workspaceRaw] = await Promise.all([
            window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
            window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/pipeline-workspace.json',
            }),
          ]);
          const job = jobs.find((entry) => entry.metadata?.pipelineId === pipelineId);
          const runtime = JSON.parse(workspaceRaw).runtime?.find((entry) => entry.key === pipelineId);
          const states = Object.fromEntries(runtime?.nodeStates ?? []);
          return job?.status?.type === 'running'
            && job.kind === 'pipeline-step'
            && job.metadata?.nodeId === 'plugin-step'
            && states['plugin-step']?.status === 'running'
            && states['plugin-downstream']?.status === 'pending';
        }, PIPELINE_PLUGIN_ID),
        { timeout: 20_000, timeoutMsg: 'Plugin spawn incorrectly released its downstream node' },
      );

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          try {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).find(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'done',
            ) ?? false;
          } catch {
            return false;
          }
        }, PIPELINE_PLUGIN_ID),
        { timeout: 30_000, timeoutMsg: 'Plugin pipeline did not settle' },
      );

      const evidence = await browser.execute(async (pipelineId) => {
        const [jobs, runsRaw, dataRaw, workspaceRaw] = await Promise.all([
          window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
          window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/analysis-runs/index.json',
          }),
          window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/data-files.json',
          }),
          window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/pipeline-workspace.json',
          }),
        ]);
        const run = JSON.parse(runsRaw).find((entry) => entry.params?.pipelineId === pipelineId);
        const runtime = JSON.parse(workspaceRaw).runtime.find((entry) => entry.key === pipelineId);
        return {
          job: jobs.find((entry) => entry.metadata?.pipelineId === pipelineId),
          run,
          data: JSON.parse(dataRaw),
          states: Object.fromEntries(runtime.nodeStates),
        };
      }, PIPELINE_PLUGIN_ID);
      expect(evidence.job.status.type).toBe('done');
      expect(evidence.states['plugin-step'].status).toBe('done');
      expect(evidence.states['plugin-downstream'].status).toBe('done');
      expect(evidence.run.outputFiles).toHaveLength(1);
      expect(evidence.data.files.some((file) => file.path === evidence.run.outputFiles[0].path)).toBe(true);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'cancels the owning Plugin Job without releasing its downstream node',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_PLUGIN_CANCELLATION_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
          return jobs.some(
            (job) => job.metadata?.pipelineId === pipelineId && job.status?.type === 'running',
          );
        }, PIPELINE_PLUGIN_CANCELLATION_ID),
        { timeout: 20_000, timeoutMsg: 'Cancellable Plugin Job did not start' },
      );
      await (await browser.$('[data-testid="pipeline-cancel-button"]')).click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
          const job = jobs.find((entry) => entry.metadata?.pipelineId === pipelineId);
          if (job?.status?.type !== 'killed') return false;
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/analysis-runs/index.json',
          });
          return JSON.parse(raw).some(
            (run) => run.id === job.metadata.pipelineRunId && run.status === 'cancelled',
          );
        }, PIPELINE_PLUGIN_CANCELLATION_ID),
        { timeout: 30_000, timeoutMsg: 'Plugin cancellation did not settle' },
      );

      const runtime = await browser.execute(async (pipelineId) => {
        const raw = await window.Liatir.invoke('lia_app_read_text', {
          rel: 'workspaces/__test__/pipeline-workspace.json',
        });
        return JSON.parse(raw).runtime.find((entry) => entry.key === pipelineId);
      }, PIPELINE_PLUGIN_CANCELLATION_ID);
      const states = Object.fromEntries(runtime.nodeStates);
      expect(states['plugin-step'].status).toBe('cancelled');
      expect(states['plugin-downstream'].status).toBe('pending');
    },
  },
  {
    name: 'settles nested API work before completing a sub-pipeline and propagates child failure',
    async run({ artifactsDir, browser, expect, rootDir }) {
      const delayedApi = await startDelayedApi(2_000);
      try {
        const pluginPath = buildSettlementPlugin(rootDir, artifactsDir);
        await reseedSandbox(browser, delayedApi.url, pluginPath);
        await navigateSidebar(browser, '/pipelines');
        await openPipeline(browser, PIPELINE_SUB_ID);
        await (await browser.$('[data-testid="pipeline-run-button"]')).click();

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/pipeline-workspace.json',
            });
            const runtime = JSON.parse(raw).runtime?.find((entry) => entry.key === pipelineId);
            const states = Object.fromEntries(runtime?.nodeStates ?? []);
            return states['sub-pipeline-step']?.status === 'running'
              && states['sub-downstream']?.status === 'pending';
          }, PIPELINE_SUB_ID),
          { timeout: 20_000, timeoutMsg: 'Sub-pipeline released its downstream node before child API settlement' },
        );

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'done',
            );
          }, PIPELINE_SUB_ID),
          { timeout: 30_000, timeoutMsg: 'Sub-pipeline did not settle after its child API' },
        );

        const settled = await browser.execute(async (pipelineId) => {
          const [runsRaw, dataRaw, workspaceRaw] = await Promise.all([
            window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            }),
            window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/data-files.json',
            }),
            window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/pipeline-workspace.json',
            }),
          ]);
          const run = JSON.parse(runsRaw).find((entry) => entry.params?.pipelineId === pipelineId);
          const runtime = JSON.parse(workspaceRaw).runtime.find((entry) => entry.key === pipelineId);
          return { run, data: JSON.parse(dataRaw), states: Object.fromEntries(runtime.nodeStates) };
        }, PIPELINE_SUB_ID);
        expect(settled.states['sub-pipeline-step'].status).toBe('done');
        expect(settled.states['sub-downstream'].status).toBe('done');
        expect(settled.run.outputFiles.length).toBeGreaterThan(0);
        for (const file of settled.run.outputFiles) {
          expect(settled.data.files.some((entry) => entry.path === file.path)).toBe(true);
        }

        await navigateSidebar(browser, '/pipelines');
        await openPipeline(browser, PIPELINE_SUB_FAILURE_ID);
        await (await browser.$('[data-testid="pipeline-run-button"]')).click();
        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'error',
            );
          }, PIPELINE_SUB_FAILURE_ID),
          { timeout: 30_000, timeoutMsg: 'Child failure was not propagated to the parent Result' },
        );
      } finally {
        await delayedApi.close();
      }
    },
  },
  {
    name: 'cancels an API Connector step before downstream and Result finalization',
    async run({ artifactsDir, browser, expect, rootDir }) {
      const delayedApi = await startDelayedApi(30_000);
      try {
        const pluginPath = buildSettlementPlugin(rootDir, artifactsDir);
        await reseedSandbox(browser, delayedApi.url, pluginPath);
        await navigateSidebar(browser, '/pipelines');
        await openPipeline(browser, PIPELINE_API_CANCELLATION_ID);
        await (await browser.$('[data-testid="pipeline-run-button"]')).click();

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/pipeline-workspace.json',
            });
            const runtime = JSON.parse(raw).runtime?.find((entry) => entry.key === pipelineId);
            const states = Object.fromEntries(runtime?.nodeStates ?? []);
            return states['cancellable-api-step']?.status === 'running'
              && states['api-cancel-downstream']?.status === 'pending';
          }, PIPELINE_API_CANCELLATION_ID),
          { timeout: 20_000, timeoutMsg: 'Cancellable API request did not enter running state' },
        );
        await (await browser.$('[data-testid="pipeline-cancel-button"]')).click();

        await browser.waitUntil(
          async () => browser.execute(async (pipelineId) => {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'cancelled',
            );
          }, PIPELINE_API_CANCELLATION_ID),
          { timeout: 30_000, timeoutMsg: 'API cancellation Result did not finalize' },
        );

        const runtime = await browser.execute(async (pipelineId) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/pipeline-workspace.json',
          });
          return JSON.parse(raw).runtime.find((entry) => entry.key === pipelineId);
        }, PIPELINE_API_CANCELLATION_ID);
        const states = Object.fromEntries(runtime.nodeStates);
        expect(states['cancellable-api-step'].status).toBe('cancelled');
        expect(states['api-cancel-downstream'].status).toBe('pending');
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

      await reloadLiatirApp(browser);
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
  {
    name: 'cancels only the originating pipeline and finalizes killed Job and Result state',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_CANCELLATION_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();

      const cancelButton = await browser.$('[data-testid="pipeline-cancel-button"]');
      await cancelButton.waitForDisplayed({ timeout: 20_000 });
      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', {
            workspaceId: '__test__',
          });
          return jobs.some(
            (job) => job.metadata?.pipelineId === pipelineId
              && job.status?.type === 'running',
          );
        }, PIPELINE_CANCELLATION_ID),
        { timeout: 20_000, timeoutMsg: 'Cancellable child Job did not start' },
      );

      await cancelButton.click();
      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', {
            workspaceId: '__test__',
          });
          const job = jobs.find((candidate) => candidate.metadata?.pipelineId === pipelineId);
          if (job?.status?.type !== 'killed') return false;
          try {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.id === job.metadata.pipelineRunId
                && run.status === 'cancelled',
            );
          } catch {
            return false;
          }
        }, PIPELINE_CANCELLATION_ID),
        { timeout: 30_000, timeoutMsg: 'Cancellation did not finalize Job and Result state' },
      );

      const cancellationState = await browser.execute(async (pipelineId) => {
        const jobs = await window.Liatir.invoke('lia_jobs_list', {
          workspaceId: '__test__',
        });
        const job = jobs.find((candidate) => candidate.metadata?.pipelineId === pipelineId);
        const raw = await window.Liatir.invoke('lia_app_read_text', {
          rel: 'workspaces/__test__/analysis-runs/index.json',
        });
        const runs = JSON.parse(raw).filter((run) => run.id === job.metadata.pipelineRunId);
        return { job, runs };
      }, PIPELINE_CANCELLATION_ID);
      expect(cancellationState.job.status.type).toBe('killed');
      expect(cancellationState.runs).toHaveLength(1);
      expect(cancellationState.runs[0].status).toBe('cancelled');
      expect(cancellationState.runs[0].error).toBe('Pipeline run cancelled by user.');

      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_B_ID);
      expect(
        await browser.execute(
          () => document.querySelector('[data-testid="pipeline-run-button"]')?.disabled,
        ),
      ).toBe(false);

      await navigateSidebar(browser, '/results');
      const resultSelector = `[data-testid="result-run"][data-run-id="${cancellationState.runs[0].id}"]`;
      await (await browser.$(resultSelector)).waitForDisplayed({ timeout: 20_000 });
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'streams a scientific alignment artifact into a typed downstream QC step',
    async run({ browser, expect }) {
      await navigateSidebar(browser, '/pipelines');
      await openPipeline(browser, PIPELINE_SCIENTIFIC_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();

      await browser.waitUntil(
        async () => browser.execute(async (pipelineId) => {
          try {
            const raw = await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            });
            return JSON.parse(raw).some(
              (run) => run.params?.pipelineId === pipelineId && run.status === 'done',
            );
          } catch {
            return false;
          }
        }, PIPELINE_SCIENTIFIC_ID),
        { timeout: 30_000, timeoutMsg: 'Scientific pipeline Result did not finalize' },
      );

      const evidence = await browser.execute(async (pipelineId) => {
        const jobs = await window.Liatir.invoke('lia_jobs_list', {
          workspaceId: '__test__',
        });
        const pipelineJobs = jobs.filter((job) => job.metadata?.pipelineId === pipelineId);
        const raw = await window.Liatir.invoke('lia_app_read_text', {
          rel: 'workspaces/__test__/analysis-runs/index.json',
        });
        const run = JSON.parse(raw).find(
          (candidate) => candidate.params?.pipelineId === pipelineId,
        );
        return { pipelineJobs, run };
      }, PIPELINE_SCIENTIFIC_ID);

      expect(evidence.pipelineJobs).toHaveLength(2);
      const alignJob = evidence.pipelineJobs.find((job) => job.metadata.nodeId === 'align-step');
      const qcJob = evidence.pipelineJobs.find((job) => job.metadata.nodeId === 'flagstat-step');
      expect(alignJob.status.type).toBe('done');
      expect(qcJob.status.type).toBe('done');
      expect(qcJob.startedAtMs).toBeGreaterThanOrEqual(alignJob.endedAtMs);
      expect(qcJob.args.at(-1)).toMatch(/minimap2-.*\.sam$/);
      expect(evidence.run.outputFiles).toHaveLength(1);
      expect(evidence.run.outputFiles[0].label).toBe('Output SAM');
      expect(evidence.run.outputFiles[0].producer.nodeId).toBe('align-step');
      expect(evidence.run.outputFiles[0].parentRun.pipelineId).toBe(PIPELINE_SCIENTIFIC_ID);
      expect(evidence.run.outputFiles[0].parentRun.pipelineRunId).toBe(evidence.run.id);
      expect(evidence.run.outputFiles[0].path).toBe(qcJob.args.at(-1));
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
