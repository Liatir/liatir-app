/** Native Gate 6 proof for one saved Nextflow definition in direct and pipeline runs. */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
  reloadLiatirApp,
} from '../support/liatir-app.mjs';

export { reloadLiatirApp };

export const DEFINITION_ID = 'gate-6-nextflow';
export const STEP_ID = `external-workflow:${DEFINITION_ID}`;
const SUCCESS_PIPELINE_ID = 'gate-6-nextflow-success';
const FAILURE_PIPELINE_ID = 'gate-6-nextflow-failure';
const RESTART_RUN_ID = 'gate-6-nextflow-interrupted';
const REQUIRED_ENV = ['LIATIR_E2E_NEXTFLOW'];

let seeded = null;

async function writeWorkspaceJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_app_write_text', {
      rel: file,
      content: JSON.stringify(content, null, 2),
      createDirs: true,
    });
  }, rel, value);
}

export async function readWorkspaceJson(browser, rel) {
  return browser.execute(async (file) => {
    const raw = await window.Liatir.invoke('lia_app_read_text', { rel: file });
    return JSON.parse(raw);
  }, rel);
}

function workflowDefinition(mainScriptPath, configFilePath) {
  const timestamp = Date.now();
  return {
    schemaVersion: 1,
    id: DEFINITION_ID,
    name: 'Gate 6 Nextflow summary',
    description: 'Summarize one staged input with the real system Nextflow engine.',
    engine: 'nextflow',
    source: { kind: 'local', mainScriptPath },
    parameters: [
      { key: 'label', label: 'Sample label', type: 'string', required: true, default: 'direct' },
      { key: 'delay_seconds', label: 'Delay seconds', type: 'number', default: 0 },
      { key: 'fail', label: 'Request failure', type: 'boolean', default: false },
    ],
    inputs: [{ key: 'input', label: 'Input file', required: true, accept: ['txt', 'csv'] }],
    outputs: [{
      key: 'summary',
      label: 'Summary',
      relativePath: 'summary.csv',
      ext: 'csv',
      mediaType: 'text/csv',
    }],
    outputDirectoryParameter: 'outdir',
    nextflow: { configFilePath },
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function toolNode(id, input, label) {
  return {
    id,
    type: 'tool',
    position: { x: id.endsWith('second') ? 500 : 100, y: 140 },
    data: {
      stepId: STEP_ID,
      label,
      inputs: {
        input,
        label,
        delay_seconds: '0',
        fail: 'false',
      },
    },
  };
}

function pipelineWorkspace(inputPath) {
  const first = toolNode('external-first', inputPath, 'nested-first');
  const second = toolNode('external-second', '@pipe:external-first:summary', 'nested-second');
  const success = {
    id: SUCCESS_PIPELINE_ID,
    name: 'Gate 6 Nextflow reuse',
    nodes: [first, second],
    edges: [{
      id: 'external-first-to-second',
      source: first.id,
      sourceHandle: 'output',
      target: second.id,
      targetHandle: 'input',
      selectable: false,
    }],
    updatedAt: Date.now(),
  };
  const failureNode = toolNode('external-failure', inputPath, 'nested-failure');
  failureNode.data.inputs.fail = 'true';
  const failure = {
    id: FAILURE_PIPELINE_ID,
    name: 'Gate 6 Nextflow failure',
    nodes: [failureNode],
    edges: [],
    updatedAt: Date.now(),
  };
  return {
    current: {
      id: success.id,
      name: success.name,
      nodes: success.nodes,
      edges: success.edges,
    },
    saved: [success, failure],
    runtime: [],
  };
}

export async function ensureSeeded({ artifactsDir, browser, rootDir }) {
  if (seeded) return seeded;
  await openSandboxWorkspace(browser);
  const fixtureDir = path.join(artifactsDir, 'reports', 'external-workflow-nextflow-e2e');
  fs.mkdirSync(fixtureDir, { recursive: true });
  const inputPath = path.join(fixtureDir, 'input.txt');
  const originalContent = 'Liatir Gate 6 immutable input\n';
  fs.writeFileSync(inputPath, originalContent);
  const configFilePath = path.join(fixtureDir, 'nextflow.config');
  const configContent = "process.executor = 'local'\n";
  fs.writeFileSync(configFilePath, configContent);
  const mainScriptPath = path.join(rootDir, 'tests', 'fixtures', 'external-workflow-nextflow', 'main.nf');
  const definition = workflowDefinition(mainScriptPath, configFilePath);
  seeded = { definition, inputPath, mainScriptPath, originalContent, configFilePath, configContent };

  await Promise.all([
    writeWorkspaceJson(browser, 'workspaces/__test__/external-workflows.json', {
      schemaVersion: 1,
      definitions: [definition],
    }),
    writeWorkspaceJson(browser, 'workspaces/__test__/data-files.json', {
      files: [{
        id: 'gate-6-input',
        name: path.basename(inputPath),
        path: inputPath,
        ext: 'txt',
        size: fs.statSync(inputPath).size,
        addedAt: Date.now(),
        folder: '',
      }],
      folders: [],
    }),
    writeWorkspaceJson(browser, 'workspaces/__test__/pipeline-workspace.json', pipelineWorkspace(inputPath)),
  ]);

  await reloadLiatirApp(browser);
  await openSandboxWorkspace(browser);
  return seeded;
}

export async function chooseWorkflowInput(browser, fileName) {
  const trigger = await browser.$('[data-testid="external-workflow-input-input"]');
  await trigger.waitForDisplayed({ timeout: 20_000 });
  await trigger.click();
  await browser.waitUntil(
    async () => browser.execute((name) => Array.from(
      document.querySelectorAll('.nowheel button'),
    ).some((button) => button.textContent?.includes(name)), fileName),
    { timeout: 20_000, timeoutMsg: `External Workflow input option ${fileName} did not open` },
  );
  const selected = await browser.execute((name) => {
    const option = Array.from(document.querySelectorAll('.nowheel button'))
      .find((button) => button.textContent?.includes(name));
    option?.click();
    return Boolean(option);
  }, fileName);
  if (!selected) throw new Error(`Could not select External Workflow input ${fileName}.`);
}

export async function waitForDefinitionReady(browser) {
  await browser.waitUntil(
    async () => browser.execute(() => (
      document.body.textContent?.includes('Nextflow + Java ready')
      && !document.querySelector('[data-testid="run-external-workflow"]')?.disabled
    )),
    { timeout: 30_000, timeoutMsg: 'System Nextflow and Java were not ready in the product UI' },
  );
}

export async function waitForResult(browser, matcher, timeout = 120_000) {
  await browser.waitUntil(
    async () => browser.execute(async (expected) => {
      try {
        const raw = await window.Liatir.invoke('lia_app_read_text', {
          rel: 'workspaces/__test__/analysis-runs/index.json',
        });
        return JSON.parse(raw).some((run) => (
          (!expected.tool || run.tool === expected.tool)
          && (!expected.pipelineId || run.params?.pipelineId === expected.pipelineId)
          && (!expected.id || run.id === expected.id)
          && (!expected.startedAfter || run.startedAt >= expected.startedAfter)
          && run.status === expected.status
        ));
      } catch {
        return false;
      }
    }, matcher),
    { timeout, interval: 500, timeoutMsg: `Result did not settle as ${matcher.status}` },
  );
  const runs = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
  return runs.find((run) => (
    (!matcher.tool || run.tool === matcher.tool)
    && (!matcher.pipelineId || run.params?.pipelineId === matcher.pipelineId)
    && (!matcher.id || run.id === matcher.id)
    && (!matcher.startedAfter || run.startedAt >= matcher.startedAfter)
    && run.status === matcher.status
  ));
}

async function openPipeline(browser, pipelineId) {
  await navigateInApp(browser, '/pipelines');
  const selector = `[data-testid="pipeline-card"][data-pipeline-id="${pipelineId}"] [data-testid="pipeline-card-open"]`;
  const button = await browser.$(selector);
  await button.waitForDisplayed({ timeout: 20_000 });
  await button.click();
  await browser.waitUntil(
    async () => browser.execute((id) => (
      window.location.pathname === '/pipeline'
      && document.querySelector('[data-testid="pipeline-editor"]')?.getAttribute('data-pipeline-id') === id
    ), pipelineId),
    { timeout: 20_000, timeoutMsg: `Pipeline ${pipelineId} did not open` },
  );
}

export async function workflowJobs(browser, definitionId) {
  return browser.execute(async (id) => {
    const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
    return jobs.filter((job) => job.metadata?.externalWorkflowDefinitionId === id);
  }, definitionId);
}

function provenanceFromEvidence(entry) {
  return entry?.evidence?.externalWorkflow ?? null;
}

async function nextflowRuntime(browser) {
  return browser.execute(() => window.Liatir.externalWorkflows.runtimeInfo());
}

export function wslTokenProcessIds(distribution, token) {
  const script = `token=$1
for environment in /proc/[0-9]*/environ; do
  [ -r "$environment" ] || continue
  if { tr '\\000' '\\n' < "$environment"; } 2>/dev/null | grep -Fqx "LIATIR_WSL_RUN_TOKEN=$token"; then
    basename "$(dirname "$environment")"
  fi
done`;
  return execFileSync('wsl.exe', [
    '--distribution', distribution,
    '--exec', '/bin/sh', '-c', script, 'liatir-nextflow-e2e', token,
  ], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
}

export const tests = [
  {
    name: 'runs one saved Nextflow definition directly and twice in a reusable pipeline',
    requiredEnv: REQUIRED_ENV,
    async run(context) {
      const { browser, expect } = context;
      const fixture = await ensureSeeded(context);
      const runtime = await nextflowRuntime(browser);
      expect(runtime).toMatchObject({ available: true, platform: process.platform === 'darwin' ? 'macos' : 'linux' });
      if (process.platform === 'win32') {
        expect(runtime).toMatchObject({
          backend: 'wsl2',
          architecture: 'x86_64',
          distribution: expect.any(String),
          nextflow: { available: true, path: expect.stringMatching(/^\//) },
          java: { available: true, path: expect.stringMatching(/^\//) },
        });
        expect(runtime.kernelVersion).toMatch(/wsl2/i);
      } else {
        expect(runtime.backend).toBe('native');
      }
      await navigateInApp(browser, `/tools/external-workflows/${DEFINITION_ID}`);
      await waitForDefinitionReady(browser);
      await chooseWorkflowInput(browser, path.basename(fixture.inputPath));

      const directStartedAt = Date.now();
      await (await browser.$('[data-testid="run-external-workflow"]')).click();
      const direct = await waitForResult(browser, {
        tool: STEP_ID,
        status: 'done',
        startedAfter: directStartedAt,
      });
      expect(direct).toBeTruthy();
      expect(direct.execution).toMatchObject({
        runKind: 'external-workflow',
        runId: direct.id,
        rootRunId: direct.id,
        externalWorkflowRunId: direct.id,
        entityId: DEFINITION_ID,
      });
      expect(direct.jobIds).toHaveLength(1);
      expect(direct.outputFiles).toHaveLength(1);
      expect(fs.readFileSync(direct.outputFiles[0].path, 'utf8')).toContain('direct');
      expect(fs.readFileSync(fixture.inputPath, 'utf8')).toBe(fixture.originalContent);

      const directProvenance = direct.params.externalWorkflow;
      expect(directProvenance).toMatchObject({
        engine: 'nextflow',
        finalStatus: 'done',
        definitionId: DEFINITION_ID,
        jobId: direct.jobIds[0],
        exitCode: 0,
      });
      expect(directProvenance.engineVersion).toMatch(/\b\d+\.\d+\.\d+\b/);
      expect(directProvenance.javaVersion).toBeTruthy();
      expect(directProvenance.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
      expect(directProvenance.configSha256).toMatch(/^[0-9a-f]{64}$/);
      const configArgument = directProvenance.command.indexOf('-c');
      const runArgument = directProvenance.command.indexOf('run');
      expect(configArgument).toBeGreaterThan(0);
      expect(runArgument).toBeGreaterThan(configArgument);
      if (process.platform === 'win32') {
        expect(directProvenance).toMatchObject({ platform: 'linux', architecture: 'x86_64' });
        expect(directProvenance.command.slice(0, 5)).toEqual([
          'wsl.exe', '--distribution', runtime.distribution, '--exec', '/bin/sh',
        ]);
        expect(directProvenance.command[5]).toMatch(/^\/mnt\/[a-z]\//);
        expect(directProvenance.parameters.input).toMatch(/^\/mnt\/[a-z]\//);
        expect(directProvenance.parameters.outdir).toMatch(/^\/mnt\/[a-z]\//);
        expect(directProvenance.command[configArgument + 1]).toMatch(/^\/mnt\/[a-z]\//);
        expect(directProvenance.command[runArgument + 1]).toMatch(/^\/mnt\/[a-z]\//);
        expect(directProvenance.locations.runDirectory).toMatch(/^[A-Za-z]:\\/);
      } else {
        expect(directProvenance.command[0]).toBe('nextflow');
      }
      expect(directProvenance.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ process: expect.stringContaining('SUMMARIZE'), status: 'COMPLETED' }),
      ]));
      for (const evidencePath of [
        directProvenance.locations.logFile,
        directProvenance.locations.traceFile,
        directProvenance.locations.reportFile,
        directProvenance.locations.timelineFile,
        directProvenance.locations.dagFile,
      ]) expect(fs.existsSync(evidencePath)).toBe(true);

      const directOutput = await browser.execute(async (file) => {
        // Data scope: a run's parsed result lives in its own directory, not in app storage.
        const raw = await window.Liatir.invoke('lia_fs_read_text', { rel: file, permanent: true });
        return JSON.parse(raw);
      }, `workspaces/__test__/runs/${direct.id}/result.json`);
      expect(directOutput.sections.some((section) => section.label === 'Nextflow processes')).toBe(true);
      const directJobs = (await workflowJobs(browser, DEFINITION_ID))
        .filter((job) => job.metadata?.execution?.runId === direct.id);
      expect(directJobs).toHaveLength(1);
      expect(directJobs[0]).toMatchObject({ kind: 'external-workflow', status: { type: 'done' } });
      if (process.platform === 'win32') {
        expect(directJobs[0].metadata).toMatchObject({
          executionBackend: 'wsl2',
          executionPlatform: 'linux',
          executionArchitecture: 'x86_64',
          nextflowEnvironment: { NXF_ANSI_LOG: 'false' },
          wslDistribution: runtime.distribution,
          externalWorkflowRunId: direct.id,
        });
        expect(fs.existsSync(directJobs[0].metadata.wslControlFile)).toBe(false);
      }
      const directExecutionRecords = await readWorkspaceJson(
        browser,
        'workspaces/__test__/execution-runs/index.json',
      );
      const directExecution = directExecutionRecords.find((record) => record.identity.runId === direct.id);
      expect(directExecution.logs.map((entry) => entry.message)).toEqual(expect.arrayContaining([
        expect.stringMatching(process.platform === 'win32'
          ? /Execution backend: WSL2 .* Linux x86_64/
          : /Execution backend: native/),
      ]));
      if (process.platform === 'win32') {
        expect(directExecution.logs.map((entry) => entry.message)).toContain(
          'Nextflow environment: NXF_ANSI_LOG=false; other variables come from the selected WSL2 distribution.',
        );
      }

      const addButton = await browser.$('[data-testid="add-output-to-data-summary"]');
      await addButton.waitForDisplayed({ timeout: 20_000 });
      await addButton.click();
      await browser.waitUntil(
        async () => browser.execute(async (outputPath) => {
          const raw = await window.Liatir.invoke('lia_app_read_text', {
            rel: 'workspaces/__test__/data-files.json',
          });
          return JSON.parse(raw).files.some((file) => file.path === outputPath);
        }, direct.outputFiles[0].path),
        { timeout: 20_000, timeoutMsg: 'Direct Nextflow output was not reusable from Data' },
      );

      await reloadLiatirApp(browser);
      await openSandboxWorkspace(browser);
      const reloadedRuns = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
      expect(reloadedRuns.filter((run) => run.id === direct.id)).toHaveLength(1);

      await openPipeline(browser, SUCCESS_PIPELINE_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();
      const pipeline = await waitForResult(browser, {
        pipelineId: SUCCESS_PIPELINE_ID,
        status: 'done',
      });
      expect(pipeline.outputFiles).toHaveLength(2);
      expect(pipeline.outputFiles.map((file) => fs.readFileSync(file.path, 'utf8').trim()))
        .toEqual(expect.arrayContaining([
          expect.stringContaining('nested-first'),
          expect.stringContaining('nested-second'),
        ]));

      const executions = await readWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json');
      const nested = executions.filter((record) => (
        record.identity.runKind === 'external-workflow'
        && record.identity.pipelineRunId === pipeline.id
      ));
      expect(nested).toHaveLength(2);
      for (const record of nested) {
        expect(record.identity).toMatchObject({
          rootRunId: pipeline.id,
          parentRunId: pipeline.id,
          pipelineRunId: pipeline.id,
          externalWorkflowRunId: record.identity.runId,
          entityId: DEFINITION_ID,
        });
        expect(record.jobIds).toHaveLength(1);
        expect(record.params.externalWorkflow).toMatchObject({
          engine: 'nextflow',
          definitionId: DEFINITION_ID,
          finalStatus: 'done',
        });
        expect(record.params.externalWorkflow.sourceSnapshotSha256)
          .toBe(directProvenance.sourceSnapshotSha256);
      }
      expect(pipeline.params.stepEvidence).toHaveLength(2);
      expect(pipeline.params.stepEvidence.every((entry) => (
        provenanceFromEvidence(entry)?.finalStatus === 'done'
      ))).toBe(true);

      const pipelineJobs = (await workflowJobs(browser, DEFINITION_ID))
        .filter((job) => nested.some((record) => record.identity.runId === job.metadata?.execution?.runId));
      expect(pipelineJobs).toHaveLength(2);
      expect(pipelineJobs.every((job) => job.kind === 'external-workflow')).toBe(true);
      expect(new Set(pipelineJobs.map((job) => job.metadata.execution.runId)).size).toBe(2);

      const data = await readWorkspaceJson(browser, 'workspaces/__test__/data-files.json');
      expect(pipeline.outputFiles.every((output) => data.files.some((file) => file.path === output.path)))
        .toBe(true);
      expect(fs.readFileSync(fixture.inputPath, 'utf8')).toBe(fixture.originalContent);

      await navigateInApp(browser, '/jobs');
      const groupedJob = await browser.$(`[data-testid="job-entry"][data-job-id="${pipelineJobs[0].id}"]`);
      await groupedJob.waitForDisplayed({ timeout: 20_000 });
      expect(await groupedJob.getText()).toContain(`Pipeline · Gate 6 Nextflow reuse`);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'preserves Nextflow failure evidence and cancels only the selected direct run',
    requiredEnv: REQUIRED_ENV,
    async run(context) {
      const { browser, expect } = context;
      const fixture = await ensureSeeded(context);
      await openPipeline(browser, FAILURE_PIPELINE_ID);
      await (await browser.$('[data-testid="pipeline-run-button"]')).click();
      const failedPipeline = await waitForResult(browser, {
        pipelineId: FAILURE_PIPELINE_ID,
        status: 'error',
      });
      expect(failedPipeline.outputFiles ?? []).toHaveLength(0);
      expect(failedPipeline.params.stepEvidence).toHaveLength(1);
      const failedProvenance = provenanceFromEvidence(failedPipeline.params.stepEvidence[0]);
      expect(failedProvenance).toMatchObject({
        engine: 'nextflow',
        definitionId: DEFINITION_ID,
        finalStatus: 'error',
      });
      expect(failedProvenance.tasks).toEqual(expect.arrayContaining([
        expect.objectContaining({ status: 'FAILED', exitCode: 17 }),
      ]));

      const failureExecutions = await readWorkspaceJson(
        browser,
        'workspaces/__test__/execution-runs/index.json',
      );
      const failedChild = failureExecutions.find((record) => (
        record.identity.runKind === 'external-workflow'
        && record.identity.pipelineRunId === failedPipeline.id
      ));
      expect(failedChild).toMatchObject({
        status: 'error',
        params: { externalWorkflow: { finalStatus: 'error' } },
      });
      const failedJobs = (await workflowJobs(browser, DEFINITION_ID))
        .filter((job) => job.metadata?.execution?.runId === failedChild.identity.runId);
      expect(failedJobs).toHaveLength(1);
      expect(failedJobs[0].status.type).toBe('failed');

      await navigateInApp(browser, `/results?run=${failedPipeline.id}`);
      await browser.waitUntil(
        async () => (await (await browser.$('body')).getText()).includes('Engine status'),
        { timeout: 20_000, timeoutMsg: 'Failed Nextflow provenance was not visible in Results' },
      );

      await navigateInApp(browser, `/tools/external-workflows/${DEFINITION_ID}`);
      await waitForDefinitionReady(browser);
      await chooseWorkflowInput(browser, path.basename(fixture.inputPath));
      await browser.execute(() => {
        const set = (testId, value) => {
          const input = document.querySelector(`[data-testid="${testId}"]`);
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
          setter?.call(input, String(value));
          input?.dispatchEvent(new Event('change', { bubbles: true }));
        };
        set('external-workflow-parameter-label', 'cancelled-direct');
        set('external-workflow-parameter-delay_seconds', 30);
      });

      const cancelStartedAt = Date.now();
      await (await browser.$('[data-testid="run-external-workflow"]')).click();
      await browser.waitUntil(
        async () => browser.execute(async (definitionId, startedAt) => {
          const jobs = await window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' });
          return jobs.some((job) => (
            job.metadata?.externalWorkflowDefinitionId === definitionId
            && job.startedAtMs >= startedAt
            && job.status?.type === 'running'
          ));
        }, DEFINITION_ID, cancelStartedAt),
        { timeout: 30_000, timeoutMsg: 'Cancellable Nextflow Job did not start' },
      );
      const runningJob = (await workflowJobs(browser, DEFINITION_ID))
        .find((job) => job.startedAtMs >= cancelStartedAt && job.status?.type === 'running');
      expect(runningJob).toBeTruthy();
      let wslControl = null;
      if (process.platform === 'win32') {
        expect(runningJob.metadata).toMatchObject({
          executionBackend: 'wsl2',
          executionArchitecture: 'x86_64',
          wslDistribution: expect.any(String),
          wslControlFile: expect.any(String),
        });
        wslControl = JSON.parse(fs.readFileSync(runningJob.metadata.wslControlFile, 'utf8'));
        expect(wslTokenProcessIds(wslControl.distribution, wslControl.token).length).toBeGreaterThan(0);
      }
      const cancelButton = await browser.$('[data-testid="cancel-external-workflow"]');
      await cancelButton.waitForDisplayed({ timeout: 20_000 });
      await cancelButton.click();

      const cancelled = await waitForResult(browser, {
        tool: STEP_ID,
        status: 'cancelled',
        startedAfter: cancelStartedAt,
      }, 60_000);
      expect(cancelled.outputFiles ?? []).toHaveLength(0);
      expect(cancelled.params.externalWorkflow).toMatchObject({
        definitionId: DEFINITION_ID,
        finalStatus: 'cancelled',
      });
      const cancelledJobs = (await workflowJobs(browser, DEFINITION_ID))
        .filter((job) => job.metadata?.execution?.runId === cancelled.id);
      expect(cancelledJobs).toHaveLength(1);
      expect(cancelledJobs[0].status.type).toBe('killed');
      if (process.platform === 'win32') {
        expect(fs.existsSync(runningJob.metadata.wslControlFile)).toBe(false);
        await browser.waitUntil(
          async () => wslTokenProcessIds(wslControl.distribution, wslControl.token).length === 0,
          { timeout: 15_000, timeoutMsg: 'Cancelled WSL2 process group remained alive' },
        );
      }
      expect(fs.readFileSync(fixture.inputPath, 'utf8')).toBe(fixture.originalContent);
      expect(fs.readFileSync(fixture.configFilePath, 'utf8')).toBe(fixture.configContent);
      await expectNoVisibleRuntimeError(browser);
    },
  },
  {
    name: 'reconciles an interrupted External Workflow Result exactly once after reload',
    requiredEnv: REQUIRED_ENV,
    async run(context) {
      const { browser, expect } = context;
      const fixture = await ensureSeeded(context);
      const records = await readWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json');
      const startedAt = Date.now() - 1_000;
      records.unshift({
        identity: {
          schemaVersion: 1,
          runId: RESTART_RUN_ID,
          runKind: 'external-workflow',
          workspaceId: '__test__',
          rootRunId: RESTART_RUN_ID,
          externalWorkflowRunId: RESTART_RUN_ID,
          entityId: DEFINITION_ID,
        },
        label: fixture.definition.name,
        status: 'running',
        resultPolicy: 'own',
        resultId: RESTART_RUN_ID,
        jobIds: [],
        inputs: [fixture.inputPath],
        params: { values: { input: fixture.inputPath } },
        logs: [{
          timestampMs: startedAt,
          level: 'info',
          stream: 'system',
          message: 'Nextflow launch was interrupted before finalization.',
        }],
        startedAt,
        updatedAt: startedAt,
      });
      await writeWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json', records);

      await reloadLiatirApp(browser);
      await openSandboxWorkspace(browser);
      const recovered = await waitForResult(browser, {
        id: RESTART_RUN_ID,
        status: 'error',
      });
      expect(recovered.tool).toBe(STEP_ID);
      expect(recovered.error).toMatch(/interrupted/i);
      expect(recovered.execution).toMatchObject({
        runKind: 'external-workflow',
        externalWorkflowRunId: RESTART_RUN_ID,
        entityId: DEFINITION_ID,
      });

      await reloadLiatirApp(browser);
      await openSandboxWorkspace(browser);
      const runs = await readWorkspaceJson(browser, 'workspaces/__test__/analysis-runs/index.json');
      expect(runs.filter((run) => run.id === RESTART_RUN_ID)).toHaveLength(1);
      const settledRecords = await readWorkspaceJson(browser, 'workspaces/__test__/execution-runs/index.json');
      expect(settledRecords.find((record) => record.identity.runId === RESTART_RUN_ID))
        .toMatchObject({ status: 'interrupted', resultId: RESTART_RUN_ID });

      await navigateInApp(browser, `/tools/external-workflows/${DEFINITION_ID}`);
      await browser.waitUntil(
        async () => (await (await browser.$('body')).getText()).includes('interrupted'),
        { timeout: 20_000, timeoutMsg: 'Recovered External Workflow was absent from its history' },
      );
      await expectNoVisibleRuntimeError(browser);
    },
  },
];
