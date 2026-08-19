/** Native evidence for the shared execution identity and lifecycle. */
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  navigateSidebar,
  openSandboxWorkspace,
  reloadLiatirApp,
} from '../support/liatir-app.mjs';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(import.meta.dirname, '../../..');
const JSZip = require(path.join(rootDir, 'packages', 'liatir-cli', 'node_modules', 'jszip'));

const WASM_SUCCESS = 'AGFzbQEAAAABDAJgBH9/f38Bf2AAAAIjARZ3YXNpX3NuYXBzaG90X3ByZXZpZXcxCGZkX3dyaXRlAAADAgEBBQMBAAEHEwIGbWVtb3J5AgAGX3N0YXJ0AAEKNwE1AEEAQRA2AgBBBEEZNgIAQQFBAEEBQQgQABpBAEHAADYCAEEEQQk2AgBBAkEAQQFBCBAAGgsLLgIAQRALGXsidmFsdWUiOiJ3YXNtLXNldHRsZWQifQoAQcAACwl3YXNtLWxvZwoADwRuYW1lAQgBAAV3cml0ZQ==';
const WASM_FAILURE = 'AGFzbQEAAAABBAFgAAADAgEABwoBBl9zdGFydAAACgUBAwAACw==';
const WASM_PENDING = 'AGFzbQEAAAABBAFgAAADAgEABwoBBl9zdGFydAAACgkBBwADQAwACwsAEwRuYW1lAwwBAAEAB2ZvcmV2ZXI=';

const PLUGINS = {
  success: { id: 'e2e-wasm-success', name: 'WASM Success', bytes: WASM_SUCCESS },
  failure: { id: 'e2e-wasm-failure', name: 'WASM Failure', bytes: WASM_FAILURE },
  pending: { id: 'e2e-wasm-pending', name: 'WASM Pending', bytes: WASM_PENDING },
};

async function writeWorkspaceJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_app_write_text', {
      rel: file,
      content: JSON.stringify(content, null, 2),
      createDirs: true,
    });
  }, rel, value);
}

async function readWorkspaceJson(browser, rel) {
  return browser.execute(async (file) => {
    try {
      return JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: file }));
    } catch {
      return null;
    }
  }, rel);
}

async function reloadWorkspace(browser) {
  await reloadLiatirApp(browser);
  await openSandboxWorkspace(browser);
}

async function closeServer(server) {
  server.closeAllConnections?.();
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function startApiFixture() {
  const server = createServer((request, response) => {
    if (request.url === '/pending') {
      return;
    }
    response.writeHead(200, {
      'access-control-allow-origin': '*',
      'content-type': 'application/json',
    });
    response.end(JSON.stringify({ ok: true, source: 'execution-spine-e2e' }));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('API fixture did not expose a port.');
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => closeServer(server),
  };
}

function apiWorkspace(baseUrl) {
  const now = Date.now();
  return {
    collections: [{
      id: 'e2e-spine-api',
      name: 'Execution Spine API',
      auth: { type: 'none' },
      sharedHeaders: [],
      sharedParams: [],
      createdAt: now,
    }],
    requests: [
      {
        id: 'e2e-api-pending', collectionId: 'e2e-spine-api', name: 'Pending call', useAs: 'data',
        method: 'GET', url: `${baseUrl}/pending`, params: [], headers: [],
        body: { type: 'none', content: '' }, auth: { type: 'inherit' },
        createdAt: now, updatedAt: now,
      },
      {
        id: 'e2e-api-success', collectionId: 'e2e-spine-api', name: 'Successful call', useAs: 'data',
        method: 'GET', url: `${baseUrl}/success`, params: [], headers: [],
        body: { type: 'none', content: '' }, auth: { type: 'inherit' },
        createdAt: now, updatedAt: now,
      },
    ],
    environments: [],
    activeEnvironmentId: null,
  };
}

async function buildWasmPlugins(artifactsDir) {
  const outputDir = path.join(artifactsDir, 'reports', 'execution-spine-e2e', 'plugins');
  fs.mkdirSync(outputDir, { recursive: true });
  const persisted = [];
  for (const plugin of Object.values(PLUGINS)) {
    const manifest = {
      name: plugin.name,
      version: '1.0.0',
      description: 'Native execution spine fixture',
      runtime: 'wasm',
      category: 'Testing',
      tags: ['e2e'],
      inputSchema: {},
      outputSchema: { value: { type: 'string', label: 'Value' } },
    };
    const zip = new JSZip();
    zip.file('_sig', 'LIATIR/1');
    zip.file('manifest.json', JSON.stringify(manifest, null, 2));
    zip.file('plugin.wasm', Buffer.from(plugin.bytes, 'base64'));
    const bundlePath = path.join(outputDir, `${plugin.id}.lia`);
    fs.writeFileSync(bundlePath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    persisted.push({
      id: plugin.id,
      ...manifest,
      path: bundlePath,
      addedAt: Date.now(),
    });
  }
  return persisted;
}

async function openPlugin(browser, pluginId) {
  await navigateInApp(browser, `/plugins/${pluginId}`);
  const run = await browser.$('[data-testid="plugin-run-button"]');
  await run.waitForDisplayed({ timeout: 20_000 });
  return run;
}

async function findPluginJob(browser, pluginId, status = null) {
  return browser.execute(async (id, expectedStatus) => {
    const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
    return [...jobs].reverse().find((job) => (
      job.metadata?.pluginId === id && (!expectedStatus || job.status?.type === expectedStatus)
    )) ?? null;
  }, pluginId, status);
}

async function waitForPluginResult(browser, runId, status) {
  await browser.waitUntil(
    async () => {
      const runs = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
      return runs?.filter((run) => run.id === runId && run.status === status).length === 1;
    },
    { timeout: 30_000, timeoutMsg: `Plugin Result ${runId} did not settle as ${status}` },
  );
}

async function selectDirectFastqcInput(browser) {
  const input = await browser.$('[data-testid="direct-native-input"]');
  await input.waitForDisplayed({ timeout: 20_000 });
  await input.click();
  await browser.waitUntil(
    async () => browser.execute(() => (
      [...document.querySelectorAll('button')].some((button) => button.textContent?.includes('sample.fastq'))
    )),
    { timeout: 20_000, timeoutMsg: 'FastQC sample was not shown in the file picker' },
  );
  await browser.execute(() => {
    const option = [...document.querySelectorAll('button')]
      .find((button) => button.textContent?.includes('sample.fastq'));
    option?.click();
  });
}

async function findDirectFastqcJob(browser, excludedRunId = null, status = null) {
  return browser.execute(async (excluded, expectedStatus) => {
    const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
    return [...jobs].reverse().find((job) => (
      job.metadata?.toolId === 'fastqc'
      && job.metadata?.execution?.runKind === 'native-tool'
      && job.metadata.execution.runId !== excluded
      && (!expectedStatus || job.status?.type === expectedStatus)
    )) ?? null;
  }, excludedRunId, status);
}

async function startRangeFixture(bytes) {
  const ranges = [];
  const server = createServer((request, response) => {
    const range = request.headers.range ?? null;
    ranges.push(range);
    const match = typeof range === 'string' ? /^bytes=(\d+)-$/.exec(range) : null;
    const start = match ? Number(match[1]) : 0;
    response.writeHead(start > 0 ? 206 : 200, {
      'accept-ranges': 'bytes',
      'content-length': String(bytes.length - start),
      ...(start > 0 ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {}),
    });
    let offset = start;
    const timer = setInterval(() => {
      if (offset >= bytes.length) {
        clearInterval(timer);
        response.end();
        return;
      }
      const end = Math.min(offset + 16_384, bytes.length);
      response.write(bytes.subarray(offset, end));
      offset = end;
    }, 10);
    response.once('close', () => clearInterval(timer));
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Range fixture did not expose a port.');
  return {
    url: `http://127.0.0.1:${address.port}/payload.bin`,
    ranges,
    close: () => closeServer(server),
  };
}

export const tests = [
  {
    name: 'keeps independently owned logical Jobs isolated and first-writer terminal',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      const evidence = await browser.execute(async () => {
        const identity = (runId, entityId) => ({
          schemaVersion: 1,
          runId,
          runKind: 'dependency',
          workspaceId: '__test__',
          rootRunId: runId,
          entityId,
        });
        const first = await window.Liatir.invoke('lia_jobs_begin_logical', {
          name: 'first-logical', workspaceId: '__test__', label: 'First logical', kind: 'dependency',
          metadata: { execution: identity('logical-run-a', 'a') },
        });
        const second = await window.Liatir.invoke('lia_jobs_begin_logical', {
          name: 'second-logical', workspaceId: '__test__', label: 'Second logical', kind: 'dependency',
          metadata: { execution: identity('logical-run-b', 'b') },
        });
        await window.Liatir.invoke('lia_jobs_append_logical_output', {
          jobId: second.jobId, stream: 'stdout', line: 'independent output',
        });
        await window.Liatir.invoke('lia_plugin_progress', {
          jobId: second.jobId, current: 1, total: 2, label: 'Halfway', delta: null, done: false,
        });
        await window.Liatir.invoke('lia_jobs_kill', { jobId: first.jobId });
        await window.Liatir.invoke('lia_plugin_progress', {
          jobId: second.jobId, current: 2, total: 2, label: 'Completed', delta: null, done: true,
        });
        await window.Liatir.invoke('lia_jobs_finish_logical', { jobId: second.jobId, ok: true });
        let lateFinishRejected = false;
        try {
          await window.Liatir.invoke('lia_jobs_finish_logical', { jobId: second.jobId, ok: false });
        } catch {
          lateFinishRejected = true;
        }
        return {
          first: await window.Liatir.invoke('lia_jobs_status', { jobId: first.jobId }),
          second: await window.Liatir.invoke('lia_jobs_status', { jobId: second.jobId }),
          output: await window.Liatir.invoke('lia_jobs_get_output', { jobId: second.jobId }),
          lateFinishRejected,
        };
      });

      expect(evidence.first.status.type).toBe('killed');
      expect(evidence.second.status.type).toBe('done');
      expect(evidence.second.progress).toMatchObject({ current: 2, total: 2, done: true });
      expect(evidence.output.stdout).toContain('independent output');
      expect(evidence.lateFinishRejected).toBe(true);
    },
  },
  {
    name: 'runs and cancels standalone API Connectors without cross-run blocking',
    async run({ browser, expect }) {
      const fixture = await startApiFixture();
      try {
        await writeWorkspaceJson(browser, 'workspaces/__test__/api-workspace.json', apiWorkspace(fixture.baseUrl));
        await reloadWorkspace(browser);
        await navigateSidebar(browser, '/apis');

        const pendingCard = '[data-testid="api-connector-card"][data-request-id="e2e-api-pending"]';
        const successCard = '[data-testid="api-connector-card"][data-request-id="e2e-api-success"]';
        await (await browser.$(`${pendingCard} [data-testid="api-connector-card-toggle"]`)).click();
        await (await browser.$(`${pendingCard} [data-testid="api-connector-run-button"]`)).click();
        await browser.waitUntil(
          async () => browser.execute(async () => {
            const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
            return jobs.some((job) => job.metadata?.requestId === 'e2e-api-pending' && job.status?.type === 'running');
          }),
          { timeout: 20_000, timeoutMsg: 'Pending API Connector Job did not start' },
        );

        await (await browser.$(`${successCard} [data-testid="api-connector-card-toggle"]`)).click();
        await (await browser.$(`${successCard} [data-testid="api-connector-run-button"]`)).click();
        await browser.waitUntil(
          async () => browser.execute(async () => {
            try {
              const runs = JSON.parse(await window.Liatir.invoke('lia_app_read_text', {
                rel: 'workspaces/__test__/analysis-runs/index.json',
              }));
              return runs.some((run) => run.tool === 'e2e-api-success' && run.status === 'done');
            } catch {
              return false;
            }
          }),
          { timeout: 20_000, timeoutMsg: 'Independent API Connector did not complete' },
        );

        await (await browser.$(`${pendingCard} [data-testid="api-connector-cancel-button"]`)).click();
        await browser.waitUntil(
          async () => browser.execute(async () => {
            const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
            const pending = jobs.find((job) => job.metadata?.requestId === 'e2e-api-pending');
            if (pending?.status?.type !== 'killed') return false;
            const runs = JSON.parse(await window.Liatir.invoke('lia_app_read_text', {
              rel: 'workspaces/__test__/analysis-runs/index.json',
            }));
            return runs.filter((run) => run.id === pending.metadata.execution.runId && run.status === 'cancelled').length === 1;
          }),
          { timeout: 20_000, timeoutMsg: 'Pending API Connector did not cancel exactly once' },
        );

        const evidence = await browser.execute(async () => {
          const read = async (rel) => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel }));
          const [jobs, runs, executions, data] = await Promise.all([
            window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
            read('workspaces/__test__/analysis-runs/index.json'),
            read('workspaces/__test__/execution-runs/index.json'),
            read('workspaces/__test__/data-files.json'),
          ]);
          const successJob = jobs.find((job) => job.metadata?.requestId === 'e2e-api-success');
          const pendingJob = jobs.find((job) => job.metadata?.requestId === 'e2e-api-pending');
          const successRun = runs.find((run) => run.id === successJob.metadata.execution.runId);
          return {
            successJob,
            pendingJob,
            successRun,
            successExecution: executions.find((run) => run.identity.runId === successRun.id),
            pendingExecution: executions.find((run) => run.identity.runId === pendingJob.metadata.execution.runId),
            data,
          };
        });
        expect(evidence.successJob.status.type).toBe('done');
        expect(evidence.successJob.progress).toMatchObject({ current: 1, total: 1, done: true });
        expect(evidence.pendingJob.status.type).toBe('killed');
        expect(evidence.successExecution).toMatchObject({ status: 'done', resultId: evidence.successRun.id });
        expect(evidence.pendingExecution.status).toBe('cancelled');
        expect(evidence.successRun.execution.runKind).toBe('api-request');
        expect(evidence.successRun.outputFiles).toHaveLength(1);
        expect(evidence.data.files.some((file) => file.path === evidence.successRun.outputFiles[0].path)).toBe(true);
        await expectNoVisibleRuntimeError(browser);
      } finally {
        await fixture.close();
      }
    },
  },
  {
    name: 'runs and cancels a standalone Native Tool with one Job and Result identity',
    async run({ browser, expect }) {
      await openSandboxWorkspace(browser);
      const sample = await browser.execute(async () => {
        const samplePath = await window.Liatir.invoke('lia_fastqc_sample_path', {});
        const size = await window.Liatir.invoke('lia_file_size', { path: samplePath });
        return { samplePath, size };
      });
      await writeWorkspaceJson(browser, 'workspaces/__test__/data-files.json', {
        files: [{
          id: 'e2e-fastqc-sample',
          name: 'sample.fastq',
          path: sample.samplePath,
          ext: 'fastq',
          size: sample.size,
          addedAt: 0,
          folder: 'Execution spine',
          protected: true,
        }],
        folders: ['Execution spine'],
      });
      await reloadWorkspace(browser);
      await navigateInApp(browser, '/tools/qc/fastqc');
      await selectDirectFastqcInput(browser);

      const runButton = await browser.$('[data-testid="direct-native-run"]');
      await runButton.waitForDisplayed({ timeout: 20_000 });
      await runButton.click();
      await browser.waitUntil(
        async () => Boolean(await findDirectFastqcJob(browser, null, 'done')),
        { timeout: 30_000, timeoutMsg: 'Standalone FastQC Job did not complete' },
      );
      const completedJob = await findDirectFastqcJob(browser, null, 'done');
      await browser.waitUntil(
        async () => {
          const runs = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
          return runs?.filter((run) => (
            run.id === completedJob.metadata.execution.runId && run.status === 'done'
          )).length === 1;
        },
        { timeout: 20_000, timeoutMsg: 'Standalone FastQC Result did not finalize exactly once' },
      );

      const pluginPaths = await browser.execute(async () => window.Liatir.invoke('lia_plugin_paths', {
        plugin: 'fastqc.wasm',
      }));
      const externalOverride = path.join(pluginPaths.externalPlugins, 'fastqc.wasm');
      fs.writeFileSync(externalOverride, Buffer.from(WASM_PENDING, 'base64'));
      try {
        await runButton.click();
        await browser.waitUntil(
          async () => Boolean(await findDirectFastqcJob(
            browser,
            completedJob.metadata.execution.runId,
            'running',
          )),
          { timeout: 20_000, timeoutMsg: 'Cancellable FastQC Job did not start' },
        );
        const pendingJob = await findDirectFastqcJob(
          browser,
          completedJob.metadata.execution.runId,
          'running',
        );
        const cancel = await browser.$('[data-testid="direct-native-cancel"]');
        await cancel.waitForDisplayed({ timeout: 20_000 });
        await cancel.click();
        await browser.waitUntil(
          async () => {
            const [job, runs] = await Promise.all([
              browser.execute(async (jobId) => window.Liatir.invoke('lia_jobs_status', { jobId }), pendingJob.id),
              readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json'),
            ]);
            return job.status?.type === 'killed'
              && runs?.filter((run) => run.id === pendingJob.metadata.execution.runId && run.status === 'cancelled').length === 1;
          },
          { timeout: 30_000, timeoutMsg: 'Standalone FastQC cancellation did not settle exactly once' },
        );

        const evidence = await browser.execute(async (ids) => {
          const read = async (rel) => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel }));
          const [completed, cancelled, output, runs, executions] = await Promise.all([
            window.Liatir.invoke('lia_jobs_status', { jobId: ids.completedJobId }),
            window.Liatir.invoke('lia_jobs_status', { jobId: ids.cancelledJobId }),
            window.Liatir.invoke('lia_jobs_get_output', { jobId: ids.completedJobId }),
            read('workspaces/__test__/analysis-runs/index.json'),
            read('workspaces/__test__/execution-runs/index.json'),
          ]);
          return {
            completed,
            cancelled,
            output,
            completedResults: runs.filter((run) => run.id === ids.completedRunId),
            cancelledResults: runs.filter((run) => run.id === ids.cancelledRunId),
            completedExecution: executions.find((run) => run.identity.runId === ids.completedRunId),
            cancelledExecution: executions.find((run) => run.identity.runId === ids.cancelledRunId),
          };
        }, {
          completedJobId: completedJob.id,
          cancelledJobId: pendingJob.id,
          completedRunId: completedJob.metadata.execution.runId,
          cancelledRunId: pendingJob.metadata.execution.runId,
        });
        expect(evidence.completed.status.type).toBe('done');
        expect(evidence.completed.progress).toMatchObject({ current: 1, total: 1, done: true });
        expect(evidence.output.stdout.length).toBeGreaterThan(0);
        expect(evidence.cancelled.status.type).toBe('killed');
        expect(evidence.completedResults).toHaveLength(1);
        expect(evidence.cancelledResults).toHaveLength(1);
        expect(evidence.completedResults[0].execution).toEqual(completedJob.metadata.execution);
        expect(evidence.completedExecution).toMatchObject({ status: 'done', resultId: completedJob.metadata.execution.runId });
        expect(evidence.cancelledExecution.status).toBe('cancelled');
      } finally {
        fs.rmSync(externalOverride, { force: true });
      }

      await reloadWorkspace(browser);
      const reloadedRuns = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
      expect(reloadedRuns.filter((run) => run.id === completedJob.metadata.execution.runId)).toHaveLength(1);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'settles WASM Plugin success, failure and off-page cancellation through one spine',
    async run({ artifactsDir, browser, expect }) {
      const plugins = await buildWasmPlugins(artifactsDir);
      await writeWorkspaceJson(browser, 'workspaces/__test__/liatir-plugins.json', plugins);
      await reloadWorkspace(browser);

      const successButton = await openPlugin(browser, PLUGINS.success.id);
      await successButton.click();
      await browser.waitUntil(
        async () => Boolean(await findPluginJob(browser, PLUGINS.success.id, 'done')),
        { timeout: 20_000, timeoutMsg: 'Successful WASM Plugin Job did not settle' },
      );
      const firstSuccess = await findPluginJob(browser, PLUGINS.success.id, 'done');
      await waitForPluginResult(browser, firstSuccess.metadata.execution.runId, 'done');

      const failureButton = await openPlugin(browser, PLUGINS.failure.id);
      await failureButton.click();
      await browser.waitUntil(
        async () => Boolean(await findPluginJob(browser, PLUGINS.failure.id, 'failed')),
        { timeout: 20_000, timeoutMsg: 'Failing WASM Plugin Job did not settle' },
      );
      const failed = await findPluginJob(browser, PLUGINS.failure.id, 'failed');
      await waitForPluginResult(browser, failed.metadata.execution.runId, 'error');

      const pendingButton = await openPlugin(browser, PLUGINS.pending.id);
      await pendingButton.click();
      await browser.waitUntil(
        async () => Boolean(await findPluginJob(browser, PLUGINS.pending.id, 'running')),
        { timeout: 20_000, timeoutMsg: 'Pending WASM Plugin Job did not start' },
      );
      const pending = await findPluginJob(browser, PLUGINS.pending.id, 'running');

      await navigateSidebar(browser, '/plugins');
      const independentSelector = `[data-testid="plugin-card-run"][data-plugin-id="${PLUGINS.success.id}"]`;
      await (await browser.$(independentSelector)).click();
      const secondSuccessButton = await browser.$('[data-testid="plugin-run-button"]');
      await secondSuccessButton.waitForDisplayed({ timeout: 20_000 });
      await secondSuccessButton.click();
      await browser.waitUntil(
        async () => browser.execute(async (firstRunId) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
          return jobs.some((job) => (
            job.metadata?.pluginId === 'e2e-wasm-success' &&
            job.metadata?.execution?.runId !== firstRunId &&
            job.status?.type === 'done'
          ));
        }, firstSuccess.metadata.execution.runId),
        { timeout: 20_000, timeoutMsg: 'Independent WASM Plugin was blocked by another run' },
      );

      await navigateSidebar(browser, '/jobs');
      const kill = await browser.$(`[data-testid="job-entry"][data-job-id="${pending.id}"] [data-testid="job-kill-button"]`);
      await kill.waitForDisplayed({ timeout: 20_000 });
      await kill.click();
      await waitForPluginResult(browser, pending.metadata.execution.runId, 'cancelled');

      const evidence = await browser.execute(async (ids) => {
        const read = async (rel) => JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel }));
        const [jobs, runs, executions] = await Promise.all([
          window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
          read('workspaces/__test__/analysis-runs/index.json'),
          read('workspaces/__test__/execution-runs/index.json'),
        ]);
        const output = await window.Liatir.invoke('lia_jobs_get_output', { jobId: ids.successJobId });
        return {
          success: jobs.find((job) => job.id === ids.successJobId),
          failure: jobs.find((job) => job.id === ids.failureJobId),
          pending: jobs.find((job) => job.id === ids.pendingJobId),
          output,
          results: ids.runIds.map((id) => runs.filter((run) => run.id === id)),
          executionStatuses: Object.fromEntries(executions.map((run) => [run.identity.runId, run.status])),
        };
      }, {
        successJobId: firstSuccess.id,
        failureJobId: failed.id,
        pendingJobId: pending.id,
        runIds: [
          firstSuccess.metadata.execution.runId,
          failed.metadata.execution.runId,
          pending.metadata.execution.runId,
        ],
      });
      expect(evidence.success.status.type).toBe('done');
      expect(evidence.success.progress).toMatchObject({ current: 1, total: 1, done: true });
      expect(evidence.output.stderr).toContain('wasm-log');
      expect(evidence.failure.status.type).toBe('failed');
      expect(evidence.pending.status.type).toBe('killed');
      expect(evidence.results.every((runs) => runs.length === 1)).toBe(true);
      expect(evidence.executionStatuses[firstSuccess.metadata.execution.runId]).toBe('done');
      expect(evidence.executionStatuses[failed.metadata.execution.runId]).toBe('error');
      expect(evidence.executionStatuses[pending.metadata.execution.runId]).toBe('cancelled');
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'retains and resumes a cancelled native download with an HTTP Range request',
    async run({ browser, expect }) {
      const bytes = Buffer.alloc(8 * 1024 * 1024);
      for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const fixture = await startRangeFixture(bytes);
      try {
        const paths = await browser.execute(async () => window.Liatir.invoke('lia_fs_paths', {}));
        const destination = `${paths.data}/execution-spine-e2e/payload.bin`;
        await browser.execute((request) => {
          window.__liatirRangeDownload = { status: 'running' };
          void window.Liatir.invoke('lia_managed_download', request)
            .then(() => { window.__liatirRangeDownload = { status: 'done' }; })
            .catch((error) => { window.__liatirRangeDownload = { status: 'error', error: String(error) }; });
        }, { id: 'e2e-range-first', url: fixture.url, destPath: destination, sha256 });

        await browser.waitUntil(
          async () => browser.execute(async (partPath) => {
            try {
              return (await window.Liatir.invoke('lia_file_size', { path: partPath })) > 65_536;
            } catch {
              return false;
            }
          }, `${destination}.part`),
          { timeout: 20_000, timeoutMsg: 'Partial native download was not retained' },
        );
        await browser.execute(async () => window.Liatir.invoke('lia_managed_download_cancel', { id: 'e2e-range-first' }));
        await browser.waitUntil(
          async () => browser.execute(() => window.__liatirRangeDownload?.status === 'error'),
          { timeout: 20_000, timeoutMsg: 'Cancelled native download did not stop' },
        );
        const partialSize = await browser.execute(
          async (partPath) => window.Liatir.invoke('lia_file_size', { path: partPath }),
          `${destination}.part`,
        );
        expect(partialSize).toBeGreaterThan(0);
        expect(partialSize).toBeLessThan(bytes.length);

        await browser.execute(async (request) => window.Liatir.invoke('lia_managed_download', request), {
          id: 'e2e-range-resume', url: fixture.url, destPath: destination, sha256,
        });
        const verified = await browser.execute(
          async (request) => window.Liatir.invoke('lia_managed_verify_sha256', request),
          { path: destination, expected: sha256 },
        );
        expect(verified).toBe(true);
        expect(fixture.ranges.some((range) => typeof range === 'string' && range === `bytes=${partialSize}-`)).toBe(true);
        await browser.execute(async (dir) => window.Liatir.invoke('lia_managed_remove', { path: dir, recursive: true }), path.dirname(destination));
      } finally {
        await fixture.close();
      }
    },
  },
];
