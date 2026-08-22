/** Gate 8: a real official MCP client drives the narrow local Liatir surface. */
import fs from 'node:fs';
import path from 'node:path';

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

import {
  expectNoVisibleRuntimeError,
  navigateInApp,
  openSandboxWorkspace,
  reloadLiatirApp,
} from '../support/liatir-app.mjs';

const PIPELINE_ID = 'gate-8-mcp-fastqc';
const SEQKIT_PIPELINE_ID = 'gate-8-mcp-seqkit';
const SURFACE_PIPELINE_ID = 'gate-8-mcp-input-surface';
const NESTED_PIPELINE_ID = 'gate-8-mcp-nested';
const PLUGIN_ID = 'gate-8-mcp-plugin';
const WORKFLOW_ID = 'gate-8-mcp-workflow';
const API_COLLECTION_ID = 'gate-8-mcp-api';
const API_REQUEST_ID = 'gate-8-mcp-request';
const EXISTING_RESULT_ID = 'gate-8-existing-result';
const RESULT_ARTIFACT_ID = 'gate-8-result-artifact';
const SEQKIT_RECORD_COUNT = 17;
const SEQKIT_THREADS = 3;
const WASM_PENDING = 'AGFzbQEAAAABBAFgAAADAgEABwoBBl9zdGFydAAACgkBBwADQAwACwsAEwRuYW1lAwwBAAEAB2ZvcmV2ZXI=';

async function writeAppJson(browser, rel, value) {
  await browser.execute(async (file, content) => {
    await window.Liatir.invoke('lia_app_write_text', {
      rel: file,
      content: JSON.stringify(content, null, 2),
      createDirs: true,
    });
  }, rel, value);
}

async function readAppJson(browser, rel, fallback = null) {
  return browser.execute(async (file, missing) => {
    try {
      return JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel: file }));
    } catch {
      return missing;
    }
  }, rel, fallback);
}

function pipelineWorkspace(inputPath, updatedAt = Date.now()) {
  const pipeline = {
    id: PIPELINE_ID,
    name: 'Gate 8 MCP FastQC',
    nodes: [{
      id: 'mcp-fastqc',
      type: 'tool',
      position: { x: 120, y: 120 },
      data: {
        stepId: 'fastqc',
        label: 'FastQC through MCP',
        inputs: { input: inputPath },
      },
    }],
    edges: [],
    updatedAt,
  };
  const nested = {
    id: NESTED_PIPELINE_ID,
    name: 'Gate 8 nested inputs',
    nodes: [{
      id: 'nested-variable',
      type: 'variable',
      position: { x: 120, y: 120 },
      data: { varType: 'string', value: 'saved nested value', label: 'Nested value' },
    }],
    edges: [],
    updatedAt: updatedAt - 3,
  };
  const seqkit = {
    id: SEQKIT_PIPELINE_ID,
    name: 'Gate 8 MCP SeqKit stats',
    nodes: [{
      id: 'mcp-seqkit',
      type: 'tool',
      position: { x: 120, y: 120 },
      data: {
        stepId: 'seqkit-stats',
        label: 'SeqKit stats through MCP',
        inputs: {
          inputFile: '/not/the/allowed/seqkit input.fastq',
          threads: '0',
        },
      },
    }],
    edges: [],
    updatedAt: updatedAt - 1,
  };
  const surface = {
    id: SURFACE_PIPELINE_ID,
    name: 'Gate 8 complete input surface',
    nodes: [
      {
        id: 'mcp-ai-tool',
        type: 'tool',
        position: { x: 120, y: 120 },
        data: {
          stepId: 'ai-single-cell-embedding',
          label: 'AI Tool and AI Model',
          inputs: {
            modelId: 'snap-stanford-uce-4layer',
            inputFile: '/not/executed/input.h5ad',
            species: 'human',
            batchSize: '25',
            maxCsvRows: '500',
          },
        },
      },
      {
        id: 'mcp-plugin',
        type: 'tool',
        position: { x: 360, y: 120 },
        data: {
          stepId: `plugin:${PLUGIN_ID}`,
          label: '.lia Plugin',
          inputs: { pluginText: 'saved plugin value', pluginFile: '/not/executed/plugin.txt' },
        },
      },
      {
        id: 'mcp-workflow',
        type: 'tool',
        position: { x: 600, y: 120 },
        data: {
          stepId: `external-workflow:${WORKFLOW_ID}`,
          label: 'External Workflow',
          inputs: {
            workflowInput: '/not/executed/workflow.csv',
            workflowLabel: 'saved workflow value',
            workflowLimit: '5',
            workflowFlag: 'false',
          },
        },
      },
      {
        id: 'mcp-viewer',
        type: 'tool',
        position: { x: 840, y: 120 },
        data: {
          stepId: 'viewer-structure-3d',
          label: 'Scientific viewer',
          inputs: { structureFile: '/not/executed/structure.pdb', style: 'cartoon' },
        },
      },
      {
        id: 'mcp-api',
        type: 'api-request',
        position: { x: 120, y: 360 },
        data: { requestId: API_REQUEST_ID, requestName: 'API Connector', paramOverrides: {} },
      },
      {
        id: 'mcp-variable',
        type: 'variable',
        position: { x: 360, y: 360 },
        data: { varType: 'string', value: 'saved variable', label: 'Variable' },
      },
      {
        id: 'mcp-math',
        type: 'math',
        position: { x: 600, y: 360 },
        data: { operation: '+', literalA: '1', literalB: '2', label: 'Math' },
      },
      {
        id: 'mcp-condition',
        type: 'condition',
        position: { x: 840, y: 360 },
        data: { operator: 'greater-than', valueRef: '3', compareValue: '2', label: 'Condition' },
      },
      {
        id: 'mcp-sub-pipeline',
        type: 'sub-pipeline',
        position: { x: 1080, y: 360 },
        data: { pipelineId: NESTED_PIPELINE_ID, pipelineName: nested.name, label: 'Sub-pipeline' },
      },
    ],
    edges: [],
    updatedAt: updatedAt - 2,
  };
  return {
    current: {
      id: pipeline.id,
      name: pipeline.name,
      nodes: pipeline.nodes,
      edges: pipeline.edges,
    },
    saved: [pipeline, seqkit, surface, nested],
    runtime: [],
  };
}

function externalWorkflowFixture(updatedAt = Date.now()) {
  return {
    schemaVersion: 1,
    id: WORKFLOW_ID,
    name: 'Gate 8 schema-only workflow',
    description: 'Used only to verify MCP input discovery; never executed.',
    engine: 'nextflow',
    source: { kind: 'local', mainScriptPath: '/not/executed/main.nf' },
    parameters: [
      { key: 'workflowLabel', label: 'Workflow label', type: 'string', required: true, default: 'saved' },
      { key: 'workflowLimit', label: 'Workflow limit', type: 'number', default: 5 },
      { key: 'workflowFlag', label: 'Workflow flag', type: 'boolean', default: false },
    ],
    inputs: [{ key: 'workflowInput', label: 'Workflow input', required: true, accept: ['csv'] }],
    outputs: [{ key: 'summary', label: 'Summary', relativePath: 'summary.csv', ext: 'csv' }],
    outputDirectoryParameter: 'outdir',
    createdAt: updatedAt,
    updatedAt,
  };
}

function pluginFixture() {
  return {
    id: PLUGIN_ID,
    name: 'Gate 8 schema-only Plugin',
    version: '1.0.0',
    description: 'Used only to verify MCP input discovery; never executed.',
    category: 'Testing',
    tags: ['gate-8'],
    runtime: 'node',
    path: '/not/executed/gate-8.lia',
    inputSchema: {
      pluginText: { type: 'string', label: 'Plugin text', required: true },
      pluginFile: { type: 'file', label: 'Plugin file', required: true, accept: ['txt'] },
    },
    outputSchema: {},
    addedAt: Date.now(),
  };
}

function apiWorkspaceFixture(updatedAt = Date.now()) {
  return {
    collections: [{
      id: API_COLLECTION_ID,
      name: 'Gate 8 API Connector',
      auth: { type: 'none' },
      sharedHeaders: [],
      sharedParams: [{ key: 'locale', value: 'en', enabled: true, optional: true, private: false }],
      createdAt: updatedAt,
    }],
    requests: [{
      id: API_REQUEST_ID,
      collectionId: API_COLLECTION_ID,
      name: 'Gate 8 request',
      useAs: 'data',
      method: 'GET',
      url: 'http://127.0.0.1:1/not-executed',
      params: [
        { key: 'query', value: 'saved query', enabled: true, optional: false, private: false },
        { key: 'token', value: 'secret', enabled: true, optional: false, private: true },
      ],
      headers: [],
      body: { type: 'none', content: '' },
      auth: { type: 'inherit' },
      createdAt: updatedAt,
      updatedAt,
    }],
    environments: [],
    activeEnvironmentId: null,
  };
}

function toolPayload(result) {
  if (result.structuredContent && typeof result.structuredContent === 'object') {
    return result.structuredContent;
  }
  const text = result.content?.find((entry) => entry.type === 'text')?.text;
  return text ? JSON.parse(text) : null;
}

function resourcePayload(result) {
  const text = result.contents?.find((entry) => 'text' in entry)?.text;
  if (!text) throw new Error('MCP resource did not contain JSON text.');
  return JSON.parse(text);
}

function resourceContent(result) {
  const content = result.contents?.[0];
  if (!content) throw new Error('MCP resource did not contain content.');
  return content;
}

function stringValues(value) {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.flatMap(stringValues);
  if (value && typeof value === 'object') return Object.values(value).flatMap(stringValues);
  return [];
}

async function mcpStatus(browser, runId) {
  const requests = await browser.execute(async () => window.Liatir.desktop.mcp.requests());
  return requests.find((request) => request.runId === runId)?.status ?? null;
}

async function runEvidence(browser, runId) {
  return browser.execute(async (id) => {
    const read = async (rel, fallback = []) => {
      try {
        return JSON.parse(await window.Liatir.invoke('lia_app_read_text', { rel }));
      } catch {
        return fallback;
      }
    };
    const [jobs, results, executions] = await Promise.all([
      window.Liatir.invoke('lia_jobs_list', { workspaceId: '__test__' }),
      read('workspaces/__test__/analysis-runs/index.json'),
      read('workspaces/__test__/execution-runs/index.json'),
    ]);
    return {
      jobs: jobs.filter((job) => job.metadata?.execution?.rootRunId === id),
      results: results.filter((result) => result.id === id || result.execution?.rootRunId === id),
      executions: executions.filter((execution) => execution.identity?.rootRunId === id),
    };
  }, runId);
}

async function clickAuthorization(browser, action) {
  const dialog = await browser.$('[data-testid="mcp-authorization-dialog"]');
  await dialog.waitForDisplayed({ timeout: 20_000 });
  const button = await browser.$(`[data-testid="mcp-${action}"]`);
  await button.click();
}

async function allowPipeline(browser, pipelineId, revision) {
  const allow = await browser.$(`[data-testid="mcp-pipeline-${pipelineId}"] button`);
  await allow.waitForDisplayed({ timeout: 20_000 });
  await allow.click();
  await browser.waitUntil(
    async () => browser.execute(async (id, expectedRevision) => {
      const status = await window.Liatir.desktop.mcp.status();
      return status.allowlist.some((grant) => (
        grant.workspaceId === '__test__'
        && grant.pipelineId === id
        && grant.pipelineRevision === expectedRevision
      ));
    }, pipelineId, String(revision)),
    { timeout: 20_000, timeoutMsg: `Saved pipeline ${pipelineId} was not allowed for MCP` },
  );
}

export const tests = [{
  name: 'passes declared pipeline inputs and exposes owner-scoped Jobs, Results, artifacts, and cancellation',
  async run({ artifactsDir, browser, expect }) {
    await openSandboxWorkspace(browser);
    const seqkitDirectory = path.join(artifactsDir, 'MCP source path with space');
    const seqkitInputPath = path.join(seqkitDirectory, 'reads with space.fastq');
    const sequence = 'ACGT'.repeat(10);
    fs.mkdirSync(seqkitDirectory, { recursive: true });
    fs.writeFileSync(
      seqkitInputPath,
      Array.from(
        { length: SEQKIT_RECORD_COUNT },
        (_unused, index) => `@gate8-${index}\n${sequence}\n+\n${'I'.repeat(sequence.length)}\n`,
      ).join(''),
    );
    expect(seqkitInputPath).toContain(' ');

    const sample = await browser.execute(async () => {
      const samplePath = await window.Liatir.invoke('lia_fastqc_sample_path', {});
      const size = await window.Liatir.invoke('lia_file_size', { path: samplePath });
      return {
        samplePath,
        size,
        artifactId: crypto.randomUUID(),
        seqkitArtifactId: crypto.randomUUID(),
      };
    });
    const samplePath = sample.samplePath;
    const initialData = await readAppJson(browser, 'workspaces/__test__/data-files.json', { files: [], folders: [] });
    const seededFiles = [...initialData.files];
    if (!seededFiles.some((file) => file.path === samplePath)) {
      seededFiles.unshift({
          id: sample.artifactId,
          name: 'sample.fastq',
          path: samplePath,
          ext: 'fastq',
          size: sample.size,
          addedAt: 0,
          folder: 'Gate 8 MCP',
          protected: true,
      });
    }
    seededFiles.unshift({
      id: sample.seqkitArtifactId,
      name: path.basename(seqkitInputPath),
      path: seqkitInputPath,
      ext: 'fastq',
      size: fs.statSync(seqkitInputPath).size,
      addedAt: 0,
      folder: 'Gate 8 MCP',
      protected: true,
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: seededFiles,
      folders: [...new Set([...(initialData.folders ?? []), 'Gate 8 MCP'])],
    });

    const seeded = pipelineWorkspace('/not/the/allowed/input.fastq');
    const fastqcSaved = seeded.saved.find((pipeline) => pipeline.id === PIPELINE_ID);
    const seqkitSaved = seeded.saved.find((pipeline) => pipeline.id === SEQKIT_PIPELINE_ID);
    const surfaceSaved = seeded.saved.find((pipeline) => pipeline.id === SURFACE_PIPELINE_ID);
    expect(fastqcSaved).toBeTruthy();
    expect(seqkitSaved).toBeTruthy();
    expect(surfaceSaved).toBeTruthy();
    await Promise.all([
      writeAppJson(browser, 'workspaces/__test__/pipeline-workspace.json', seeded),
      writeAppJson(browser, 'workspaces/__test__/external-workflows.json', {
        schemaVersion: 1,
        definitions: [externalWorkflowFixture()],
      }),
      writeAppJson(browser, 'workspaces/__test__/liatir-plugins.json', [pluginFixture()]),
      writeAppJson(browser, 'workspaces/__test__/api-workspace.json', apiWorkspaceFixture()),
    ]);
    await reloadLiatirApp(browser);
    await openSandboxWorkspace(browser);
    const dataIndex = await readAppJson(browser, 'workspaces/__test__/data-files.json', { files: [], folders: [] });
    const sampleArtifact = dataIndex.files.find((file) => file.path === samplePath);
    const seqkitArtifact = dataIndex.files.find((file) => file.path === seqkitInputPath);
    expect(sampleArtifact?.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    expect(seqkitArtifact?.id).toMatch(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    const resultArtifactPath = await browser.execute(async () => {
      const root = await window.Liatir.invoke('lia_app_path');
      const rel = 'workspaces/__test__/analysis-runs/gate-8-result.txt';
      await window.Liatir.invoke('lia_app_write_text', {
        rel,
        content: 'gate-8-result-content\n',
        createDirs: true,
      });
      return `${root}/${rel}`;
    });
    await writeAppJson(browser, 'workspaces/__test__/data-files.json', {
      files: [
        ...dataIndex.files.filter((file) => file.id !== RESULT_ARTIFACT_ID),
        {
          id: RESULT_ARTIFACT_ID,
          name: 'gate-8-result.txt',
          path: resultArtifactPath,
          ext: 'txt',
          size: 22,
          addedAt: Date.now(),
          folder: 'Results/Gate 8',
          protected: true,
        },
      ],
      folders: [...new Set([...(dataIndex.folders ?? []), 'Results', 'Results/Gate 8'])],
    });
    const existingResults = await readAppJson(browser, 'workspaces/__test__/analysis-runs/index.json', []);
    await writeAppJson(browser, 'workspaces/__test__/analysis-runs/index.json', [
      {
        id: EXISTING_RESULT_ID,
        tool: 'gate-8-fixture',
        label: 'Gate 8 existing Result',
        inputs: [],
        params: {},
        outputFiles: [{ label: 'Gate 8 text', path: resultArtifactPath, ext: 'txt', size: 22 }],
        status: 'done',
        startedAt: Date.now() - 10,
        endedAt: Date.now(),
        durationMs: 10,
        error: null,
        jobIds: [],
      },
      ...existingResults.filter((result) => result.id !== EXISTING_RESULT_ID),
    ]);
    await writeAppJson(browser, `workspaces/__test__/analysis-runs/${EXISTING_RESULT_ID}.json`, {
      sections: [{
        type: 'text',
        label: 'Fixture',
        content: `Saved at ${resultArtifactPath}`,
      }],
    });
    await reloadLiatirApp(browser);
    await openSandboxWorkspace(browser);

    const nativeToolsEnvironment = await browser.execute(
      async () => window.Liatir.invoke('lia_native_tools_environment', {}),
    );
    expect(nativeToolsEnvironment.available).toBe(true);
    expect(nativeToolsEnvironment.tools).toContain('seqkit');
    expect(nativeToolsEnvironment.execution).toBe(process.platform === 'win32' ? 'wsl2' : 'native');

    // Configure through the user-facing Settings surface, starting from the
    // secure default even if this spec follows another local run.
    await browser.execute(async () => window.Liatir.desktop.mcp.setEnabled(false));
    await navigateInApp(browser, '/settings');
    const toggle = await browser.$('[data-testid="mcp-toggle"]');
    await toggle.waitForDisplayed({ timeout: 20_000 });
    await toggle.click();
    await browser.waitUntil(
      async () => browser.execute(async () => {
        const status = await window.Liatir.desktop.mcp.status();
        return status.enabled && Boolean(status.endpoint);
      }),
      { timeout: 20_000, timeoutMsg: 'Local MCP endpoint did not enable' },
    );

    await allowPipeline(browser, PIPELINE_ID, fastqcSaved.updatedAt);
    await allowPipeline(browser, SEQKIT_PIPELINE_ID, seqkitSaved.updatedAt);
    await allowPipeline(browser, SURFACE_PIPELINE_ID, surfaceSaved.updatedAt);

    const connection = await browser.execute(async () => window.Liatir.desktop.mcp.status());
    expect(connection.enabled).toBe(true);
    expect(connection.endpoint).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
    expect(connection.bearerToken).toMatch(/^[a-f0-9]{64}$/);

    const unauthorized = await fetch(connection.endpoint, {
      headers: { authorization: 'Bearer invalid-gate-8-token' },
    });
    expect(unauthorized.status).toBe(401);

    const client = new Client(
      { name: 'liatir-gate-8-e2e', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    const transport = new StreamableHTTPClientTransport(new URL(connection.endpoint), {
      requestInit: { headers: { authorization: `Bearer ${connection.bearerToken}` } },
    });
    let externalOverride = null;

    try {
      await client.connect(transport);
      const listed = await client.listTools();
      expect(listed.tools.map((tool) => tool.name).sort()).toEqual([
        'cancel_job',
        'cancel_pipeline_run',
        'start_saved_pipeline',
      ]);
      expect(listed.tools.some((tool) => /shell|command|edit|mutat/i.test(tool.name))).toBe(false);

      const resources = await client.listResources();
      expect(resources.resources.map((resource) => resource.uri)).toEqual(expect.arrayContaining([
        'liatir://workspace/active',
        'liatir://workspace/active/pipelines',
        'liatir://runs',
        'liatir://jobs',
        'liatir://artifacts',
      ]));
      const allowed = resourcePayload(await client.readResource({
        uri: 'liatir://workspace/active/pipelines',
      }));
      expect(allowed.pipelines).toHaveLength(3);
      const fastqcGrant = allowed.pipelines.find((pipeline) => pipeline.pipelineId === PIPELINE_ID);
      expect(fastqcGrant).toMatchObject({
        pipelineId: PIPELINE_ID,
        pipelineRevision: String(fastqcSaved.updatedAt),
      });
      const inputDescriptor = fastqcGrant.inputs.find((input) => input.fieldKey === 'input');
      expect(inputDescriptor).toMatchObject({
        id: 'mcp-fastqc:node-input:input',
        type: 'file',
        source: 'node-input',
      });

      const seqkitGrant = allowed.pipelines.find((pipeline) => pipeline.pipelineId === SEQKIT_PIPELINE_ID);
      expect(seqkitGrant).toMatchObject({
        pipelineId: SEQKIT_PIPELINE_ID,
        pipelineRevision: String(seqkitSaved.updatedAt),
      });
      const seqkitFileInput = seqkitGrant.inputs.find((input) => input.fieldKey === 'inputFile');
      const seqkitThreadsInput = seqkitGrant.inputs.find((input) => input.fieldKey === 'threads');
      expect(seqkitFileInput).toMatchObject({
        id: 'mcp-seqkit:node-input:inputFile',
        label: 'FASTA / FASTQ file',
        type: 'file',
        source: 'node-input',
      });
      expect(seqkitThreadsInput).toMatchObject({
        id: 'mcp-seqkit:node-input:threads',
        label: 'Threads',
        type: 'number',
        source: 'node-input',
      });

      const surfaceGrant = allowed.pipelines.find((pipeline) => pipeline.pipelineId === SURFACE_PIPELINE_ID);
      expect(surfaceGrant.pipelineRevision).toBe(String(surfaceSaved.updatedAt));
      const descriptors = Object.fromEntries(surfaceGrant.inputs.map((input) => [input.id, input]));
      expect(descriptors['mcp-ai-tool:node-input:modelId']).toMatchObject({
        fieldKey: 'modelId',
        label: 'AI Model',
        type: 'string',
        options: expect.any(Array),
      });
      expect(descriptors['mcp-ai-tool:node-input:inputFile']).toMatchObject({
        type: 'file',
        accept: ['h5ad'],
      });
      expect(descriptors['mcp-plugin:node-input:pluginText']).toMatchObject({
        type: 'string',
        nodeLabel: '.lia Plugin',
      });
      expect(descriptors['mcp-workflow:node-input:workflowInput']).toMatchObject({
        type: 'file',
        accept: ['csv'],
        nodeLabel: 'External Workflow',
      });
      expect(descriptors['mcp-workflow:node-input:workflowLimit'].type).toBe('number');
      expect(descriptors['mcp-workflow:node-input:workflowFlag'].type).toBe('boolean');
      expect(descriptors['mcp-viewer:node-input:style'].options.map((option) => option.value)).toEqual([
        'cartoon',
        'stick',
        'line',
        'sphere',
      ]);
      expect(descriptors['mcp-api:api-parameter:locale'].source).toBe('api-parameter');
      expect(descriptors['mcp-api:api-parameter:query'].source).toBe('api-parameter');
      expect(surfaceGrant.inputs.some((input) => input.fieldKey === 'token')).toBe(false);
      expect(descriptors['mcp-variable:variable:value'].type).toBe('string');
      expect(descriptors['mcp-math:node-input:literalA'].type).toBe('number');
      expect(descriptors['mcp-condition:node-input:compareValue'].type).toBe('number');
      expect(descriptors['mcp-sub-pipeline/nested-variable:variable:value'].type).toBe('string');

      const unavailableModel = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: SURFACE_PIPELINE_ID,
          inputs: { 'mcp-ai-tool:node-input:modelId': 'not-installed-or-compatible-model' },
        },
      });
      expect(unavailableModel.isError).toBe(true);
      expect(unavailableModel.content?.[0]?.text).toContain('must use a listed value');

      const surfaceStarted = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: SURFACE_PIPELINE_ID,
          inputs: {
            'mcp-plugin:node-input:pluginText': 'plugin from MCP',
            'mcp-workflow:node-input:workflowLabel': 'workflow from MCP',
            'mcp-workflow:node-input:workflowLimit': 12,
            'mcp-workflow:node-input:workflowFlag': true,
            'mcp-viewer:node-input:style': 'stick',
            'mcp-api:api-parameter:query': 'query from MCP',
            'mcp-variable:variable:value': 'variable from MCP',
            'mcp-math:node-input:literalA': 10,
            'mcp-condition:node-input:compareValue': 4,
            'mcp-sub-pipeline/nested-variable:variable:value': 'nested from MCP',
          },
        },
      });
      const surfaceRequest = toolPayload(surfaceStarted);
      expect(surfaceRequest.status).toBe('awaiting-authorization');
      const surfaceDialog = await browser.$('[data-testid="mcp-request-inputs"]');
      await surfaceDialog.waitForDisplayed({ timeout: 20_000 });
      const surfaceDialogText = await surfaceDialog.getText();
      expect(surfaceDialogText).toContain('plugin from MCP');
      expect(surfaceDialogText).toContain('workflow from MCP');
      expect(surfaceDialogText).toContain('query from MCP');
      await clickAuthorization(browser, 'deny');
      await browser.waitUntil(
        async () => (await mcpStatus(browser, surfaceRequest.runId)) === 'denied',
        { timeout: 20_000, timeoutMsg: 'Complete input-surface request was not denied' },
      );

      const overrideAttempt = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: { pipeline_id: PIPELINE_ID, inputs: {}, input: '/tmp/not-authorized.fastq' },
      });
      expect(overrideAttempt.isError).toBe(true);
      expect(overrideAttempt.content?.[0]?.text).toContain('accepts only pipeline_id and inputs');

      const unknownInput = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: { pipeline_id: PIPELINE_ID, inputs: { unknown: 'value' } },
      });
      expect(unknownInput.isError).toBe(true);
      expect(unknownInput.content?.[0]?.text).toContain('Unknown pipeline input');

      const unallowedArtifact = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: PIPELINE_ID,
          inputs: { [inputDescriptor.id]: { artifactId: sampleArtifact.id } },
        },
      });
      expect(unallowedArtifact.isError).toBe(true);
      expect(unallowedArtifact.content?.[0]?.text).toContain('not allowed for MCP');

      // Source files and workspace-wide Results are separate, explicit user
      // permissions in Settings.
      for (const artifact of [sampleArtifact, seqkitArtifact]) {
        const sourcePermission = await browser.$(`[data-testid="mcp-data-file-${artifact.id}"] button`);
        await sourcePermission.waitForDisplayed({ timeout: 20_000 });
        await sourcePermission.click();
      }
      const resultsPermission = await browser.$('[data-testid="mcp-results-toggle"]');
      await resultsPermission.click();
      await browser.waitUntil(
        async () => browser.execute(async (artifactIds) => {
          const status = await window.Liatir.desktop.mcp.status();
          return status.readResults && artifactIds.every((artifactId) => (
            status.dataAllowlist.some((grant) => grant.artifactId === artifactId)
          ));
        }, [sampleArtifact.id, seqkitArtifact.id]),
        { timeout: 20_000, timeoutMsg: 'MCP artifact permissions did not settle' },
      );

      const started = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: PIPELINE_ID,
          inputs: { [inputDescriptor.id]: { artifactId: sampleArtifact.id } },
        },
      });
      expect(started.isError).not.toBe(true);
      const first = toolPayload(started);
      expect(first).toMatchObject({
        pipelineId: PIPELINE_ID,
        status: 'awaiting-authorization',
        client: { name: 'liatir-gate-8-e2e', version: '1.0.0' },
      });
      expect(first.runId).toMatch(/^[a-f0-9-]{36}$/);
      expect(first.inputs).toEqual({ [inputDescriptor.id]: { artifactId: sampleArtifact.id } });

      const awaiting = resourcePayload(await client.readResource({
        uri: `liatir://runs/${first.runId}/status`,
      }));
      expect(awaiting.request.status).toBe('awaiting-authorization');
      expect(awaiting.execution).toBeNull();
      const dialogInputs = await browser.$('[data-testid="mcp-request-inputs"]');
      await dialogInputs.waitForDisplayed({ timeout: 20_000 });
      expect(await dialogInputs.getText()).toContain(sampleArtifact.name);
      await clickAuthorization(browser, 'approve');

      await browser.waitUntil(
        async () => (await mcpStatus(browser, first.runId)) === 'done',
        { timeout: 40_000, timeoutMsg: 'Approved MCP pipeline did not settle as done' },
      );
      const completedStatus = resourcePayload(await client.readResource({
        uri: `liatir://runs/${first.runId}/status`,
      }));
      const completedLogs = resourcePayload(await client.readResource({
        uri: `liatir://runs/${first.runId}/logs`,
      }));
      const completedResult = resourcePayload(await client.readResource({
        uri: `liatir://runs/${first.runId}/result`,
      }));
      expect(completedStatus.request.status).toBe('done');
      expect(completedLogs.executions.some((execution) => (
        execution.logs.some((entry) => entry.message?.includes('$ fastqc'))
      ))).toBe(true);
      expect(completedResult.data.result).toMatchObject({
        id: first.runId,
        tool: 'pipeline',
        status: 'done',
        execution: {
          initiator: {
            kind: 'mcp',
            requestId: first.runId,
            clientName: 'liatir-gate-8-e2e',
          },
        },
      });
      expect(completedResult.data.output?.sections?.length).toBeGreaterThan(0);
      expect(JSON.stringify(completedResult)).not.toContain(samplePath);
      expect(JSON.stringify(completedResult)).not.toContain('/not/the/allowed/input.fastq');

      const completedEvidence = await runEvidence(browser, first.runId);
      expect(completedEvidence.results).toHaveLength(1);
      expect(completedEvidence.executions.find((run) => run.identity.runId === first.runId)).toMatchObject({
        status: 'done',
        resultId: first.runId,
      });
      expect(completedEvidence.executions.every((run) => (
        run.identity.initiator?.kind === 'mcp'
        && run.identity.initiator.requestId === first.runId
      ))).toBe(true);
      expect(completedEvidence.executions.some((run) => run.params?.input === samplePath)).toBe(true);
      expect(completedEvidence.jobs).toHaveLength(1);
      expect(completedEvidence.jobs[0]).toMatchObject({
        status: { type: 'done' },
        metadata: {
          execution: {
            rootRunId: first.runId,
            initiator: { kind: 'mcp', requestId: first.runId },
          },
        },
      });

      // The second approved pipeline crosses the real Native Tools boundary:
      // native on POSIX, and liatir.exe -> WSL2 -> bundled SeqKit on Windows.
      const seqkitStarted = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: SEQKIT_PIPELINE_ID,
          inputs: {
            [seqkitFileInput.id]: { artifactId: seqkitArtifact.id },
            [seqkitThreadsInput.id]: SEQKIT_THREADS,
          },
        },
      });
      expect(seqkitStarted.isError).not.toBe(true);
      const seqkitRun = toolPayload(seqkitStarted);
      expect(seqkitRun).toMatchObject({
        pipelineId: SEQKIT_PIPELINE_ID,
        status: 'awaiting-authorization',
        inputs: {
          [seqkitFileInput.id]: { artifactId: seqkitArtifact.id },
          [seqkitThreadsInput.id]: SEQKIT_THREADS,
        },
      });
      const seqkitDialog = await browser.$('[data-testid="mcp-request-inputs"]');
      await seqkitDialog.waitForDisplayed({ timeout: 20_000 });
      const seqkitDialogText = await seqkitDialog.getText();
      expect(seqkitDialogText).toContain(seqkitArtifact.name);
      expect(seqkitDialogText).toMatch(/Threads[\s\S]*From client[\s\S]*\b3\b/);
      await clickAuthorization(browser, 'approve');

      await browser.waitUntil(
        async () => (await mcpStatus(browser, seqkitRun.runId)) === 'done',
        { timeout: 60_000, timeoutMsg: 'Approved MCP SeqKit pipeline did not settle as done' },
      );
      const seqkitStatus = resourcePayload(await client.readResource({
        uri: `liatir://runs/${seqkitRun.runId}/status`,
      }));
      const seqkitLogs = resourcePayload(await client.readResource({
        uri: `liatir://runs/${seqkitRun.runId}/logs`,
      }));
      const seqkitResult = resourcePayload(await client.readResource({
        uri: `liatir://runs/${seqkitRun.runId}/result`,
      }));
      expect(seqkitStatus).toMatchObject({
        request: { status: 'done', resultId: seqkitRun.runId },
        execution: {
          status: 'done',
          identity: {
            runId: seqkitRun.runId,
            rootRunId: seqkitRun.runId,
            pipelineRunId: seqkitRun.runId,
            initiator: { kind: 'mcp', requestId: seqkitRun.runId },
          },
        },
      });
      expect(seqkitLogs.executions.some((execution) => (
        execution.logs.some((entry) => entry.message?.includes('$ seqkit stats'))
      ))).toBe(true);
      expect(seqkitResult.data.result).toMatchObject({
        id: seqkitRun.runId,
        tool: 'pipeline',
        status: 'done',
        execution: {
          runId: seqkitRun.runId,
          rootRunId: seqkitRun.runId,
          pipelineRunId: seqkitRun.runId,
          initiator: { kind: 'mcp', requestId: seqkitRun.runId },
        },
      });
      const seqkitStats = seqkitResult.data.output.sections.find((section) => section.type === 'stats');
      expect(seqkitStats.items.find((item) => item.label === 'Sequences')?.value).toBe(
        String(SEQKIT_RECORD_COUNT),
      );

      const seqkitEvidence = await runEvidence(browser, seqkitRun.runId);
      expect(seqkitEvidence.results).toHaveLength(1);
      expect(seqkitEvidence.results[0]).toMatchObject({
        id: seqkitRun.runId,
        status: 'done',
        execution: {
          runId: seqkitRun.runId,
          rootRunId: seqkitRun.runId,
          pipelineRunId: seqkitRun.runId,
          initiator: { kind: 'mcp', requestId: seqkitRun.runId },
        },
      });
      expect(seqkitEvidence.executions).toHaveLength(2);
      const seqkitRoot = seqkitEvidence.executions.find((run) => run.identity.runId === seqkitRun.runId);
      const seqkitChild = seqkitEvidence.executions.find((run) => run.identity.runId !== seqkitRun.runId);
      expect(seqkitRoot).toMatchObject({
        status: 'done',
        resultId: seqkitRun.runId,
        identity: {
          runKind: 'pipeline',
          rootRunId: seqkitRun.runId,
          pipelineRunId: seqkitRun.runId,
          initiator: { kind: 'mcp', requestId: seqkitRun.runId },
        },
      });
      expect(seqkitChild).toMatchObject({
        status: 'done',
        resultPolicy: 'parent',
        identity: {
          runKind: 'native-tool',
          rootRunId: seqkitRun.runId,
          parentRunId: seqkitRun.runId,
          pipelineRunId: seqkitRun.runId,
          nodeId: 'mcp-seqkit',
          entityId: 'seqkit-stats',
          initiator: { kind: 'mcp', requestId: seqkitRun.runId },
        },
      });
      expect(seqkitEvidence.jobs).toHaveLength(1);
      expect(seqkitEvidence.jobs[0]).toMatchObject({
        status: { type: 'done' },
        metadata: {
          toolId: 'seqkit-stats',
          execution: {
            rootRunId: seqkitRun.runId,
            pipelineRunId: seqkitRun.runId,
            initiator: { kind: 'mcp', requestId: seqkitRun.runId },
          },
        },
      });

      const seqkitJobs = resourcePayload(await client.readResource({ uri: 'liatir://jobs' }));
      const publicSeqkitJob = seqkitJobs.jobs.find((job) => job.runId === seqkitRun.runId);
      expect(publicSeqkitJob).toMatchObject({ runId: seqkitRun.runId, status: { type: 'done' } });
      const seqkitJob = resourcePayload(await client.readResource({
        uri: `liatir://jobs/${publicSeqkitJob.id}`,
      }));
      expect(seqkitJob.cmd).toBeUndefined();
      expect(seqkitJob.args).toBeUndefined();
      expect(seqkitJob.metadata).toBeUndefined();
      const seqkitArtifactResource = resourcePayload(await client.readResource({
        uri: `liatir://artifacts/${seqkitArtifact.id}`,
      }));
      expect(seqkitArtifactResource).toMatchObject({
        artifactId: seqkitArtifact.id,
        name: seqkitArtifact.name,
        access: 'data-grant',
      });
      expect(seqkitArtifactResource.path).toBeUndefined();

      const publicSeqkitStrings = stringValues([
        seqkitStatus,
        seqkitLogs,
        seqkitResult,
        seqkitJob,
        seqkitArtifactResource,
      ]).join('\n');
      expect(publicSeqkitStrings).not.toContain(seqkitInputPath);
      expect(publicSeqkitStrings).not.toContain(path.dirname(seqkitInputPath));
      expect(publicSeqkitStrings).not.toContain('/not/the/allowed/seqkit input.fastq');
      if (process.platform === 'win32') expect(publicSeqkitStrings).not.toMatch(/\/mnt\/[a-z]\//i);

      const persistedAfterSeqkit = await readAppJson(browser, 'workspaces/__test__/pipeline-workspace.json');
      expect(persistedAfterSeqkit.saved.find((pipeline) => pipeline.id === SEQKIT_PIPELINE_ID)).toEqual(
        seqkitSaved,
      );

      const resultList = resourcePayload(await client.readResource({ uri: 'liatir://results' }));
      expect(resultList.results.some((result) => result.id === EXISTING_RESULT_ID)).toBe(true);
      const existingResult = resourcePayload(await client.readResource({
        uri: `liatir://results/${EXISTING_RESULT_ID}`,
      }));
      expect(existingResult.result).toMatchObject({
        id: EXISTING_RESULT_ID,
        status: 'done',
        artifacts: [{
          artifactId: RESULT_ARTIFACT_ID,
          metadataUri: `liatir://artifacts/${RESULT_ARTIFACT_ID}`,
        }],
      });
      expect(JSON.stringify(existingResult)).not.toContain(resultArtifactPath);
      expect(existingResult.output.sections[0].content).toContain(
        `liatir://artifacts/${RESULT_ARTIFACT_ID}`,
      );

      const artifacts = resourcePayload(await client.readResource({ uri: 'liatir://artifacts' }));
      expect(artifacts.maxChunkBytes).toBe(65_536);
      expect(artifacts.artifacts.map((artifact) => artifact.artifactId)).toEqual(
        expect.arrayContaining([sampleArtifact.id, seqkitArtifact.id, RESULT_ARTIFACT_ID]),
      );
      const resultArtifact = resourcePayload(await client.readResource({
        uri: `liatir://artifacts/${RESULT_ARTIFACT_ID}`,
      }));
      expect(resultArtifact).toMatchObject({
        artifactId: RESULT_ARTIFACT_ID,
        name: 'gate-8-result.txt',
        mediaType: 'text/plain',
        access: 'workspace-results',
      });
      expect(resultArtifact.path).toBeUndefined();
      const resultChunk = resourceContent(await client.readResource({
        uri: `liatir://artifacts/${RESULT_ARTIFACT_ID}/content/0/64`,
      }));
      expect(resultChunk.text).toBe('gate-8-result-content\n');

      const sourceArtifact = resourcePayload(await client.readResource({
        uri: `liatir://artifacts/${sampleArtifact.id}`,
      }));
      expect(sourceArtifact).toMatchObject({
        artifactId: sampleArtifact.id,
        name: sampleArtifact.name,
        access: 'data-grant',
      });
      expect(sourceArtifact.path).toBeUndefined();
      const sourceChunk = resourceContent(await client.readResource({
        uri: `liatir://artifacts/${sampleArtifact.id}/content/0/64`,
      }));
      expect(sourceChunk.text ?? sourceChunk.blob).toBeTruthy();
      await expect(client.readResource({
        uri: `liatir://artifacts/${sampleArtifact.id}/content/0/65537`,
      })).rejects.toThrow();

      const jobs = resourcePayload(await client.readResource({ uri: 'liatir://jobs' }));
      const completedJob = jobs.jobs.find((job) => job.runId === first.runId);
      expect(completedJob).toMatchObject({ runId: first.runId, status: { type: 'done' } });
      const jobDetail = resourcePayload(await client.readResource({
        uri: `liatir://jobs/${completedJob.id}`,
      }));
      expect(jobDetail.runId).toBe(first.runId);
      expect(jobDetail.cmd).toBeUndefined();
      expect(jobDetail.args).toBeUndefined();
      expect(jobDetail.metadata).toBeUndefined();
      expect(JSON.stringify(jobDetail)).not.toContain(samplePath);

      // Replace only the test-home override of the bundled FastQC module with
      // a cancellable infinite WASM fixture, then cancel its owning pipeline
      // through the advertised Job identity.
      const pluginPaths = await browser.execute(async () => window.Liatir.invoke('lia_plugin_paths', {
        plugin: 'fastqc.wasm',
      }));
      externalOverride = path.join(pluginPaths.externalPlugins, 'fastqc.wasm');
      fs.writeFileSync(externalOverride, Buffer.from(WASM_PENDING, 'base64'));

      const secondStarted = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: PIPELINE_ID,
          inputs: { [inputDescriptor.id]: { artifactId: sampleArtifact.id } },
        },
      });
      const second = toolPayload(secondStarted);
      await clickAuthorization(browser, 'approve');
      await browser.waitUntil(
        async () => {
          const evidence = await runEvidence(browser, second.runId);
          return evidence.jobs.some((job) => job.status?.type === 'running');
        },
        { timeout: 20_000, timeoutMsg: 'MCP FastQC Job did not become cancellable' },
      );
      const runningJobs = resourcePayload(await client.readResource({ uri: 'liatir://jobs' }));
      const runningJob = runningJobs.jobs.find((job) => job.runId === second.runId);
      expect(runningJob?.status?.type).toBe('running');
      const cancelResult = await client.callTool({
        name: 'cancel_job',
        arguments: { job_id: runningJob.id },
      });
      expect(toolPayload(cancelResult).run.status).toBe('cancel-requested');
      const idempotentRunCancel = await client.callTool({
        name: 'cancel_pipeline_run',
        arguments: { run_id: second.runId },
      });
      expect(toolPayload(idempotentRunCancel).status).toBe('cancel-requested');
      await browser.waitUntil(
        async () => (await mcpStatus(browser, second.runId)) === 'cancelled',
        { timeout: 30_000, timeoutMsg: 'MCP cancellation did not settle' },
      );
      const cancelledEvidence = await runEvidence(browser, second.runId);
      expect(cancelledEvidence.jobs).toHaveLength(1);
      expect(cancelledEvidence.jobs[0].status.type).toBe('killed');
      expect(cancelledEvidence.results).toHaveLength(1);
      expect(cancelledEvidence.results[0].status).toBe('cancelled');
      const cancelledResource = resourcePayload(await client.readResource({
        uri: `liatir://runs/${second.runId}/result`,
      }));
      expect(cancelledResource.data.result.status).toBe('cancelled');

      fs.rmSync(externalOverride, { force: true });
      externalOverride = null;

      // Denial creates no execution, Job, or Result.
      const deniedStarted = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: PIPELINE_ID,
          inputs: { [inputDescriptor.id]: { artifactId: sampleArtifact.id } },
        },
      });
      const denied = toolPayload(deniedStarted);
      await clickAuthorization(browser, 'deny');
      await browser.waitUntil(
        async () => (await mcpStatus(browser, denied.runId)) === 'denied',
        { timeout: 20_000, timeoutMsg: 'Denied MCP request did not settle' },
      );
      const deniedEvidence = await runEvidence(browser, denied.runId);
      expect(deniedEvidence).toMatchObject({ jobs: [], results: [], executions: [] });

      // Editing the saved pipeline invalidates the revision-bound grant before
      // another authorization dialog can be created.
      const changed = pipelineWorkspace(samplePath, seeded.saved[0].updatedAt + 1);
      await writeAppJson(browser, 'workspaces/__test__/pipeline-workspace.json', changed);
      const stale = await client.callTool({
        name: 'start_saved_pipeline',
        arguments: {
          pipeline_id: PIPELINE_ID,
          inputs: { [inputDescriptor.id]: { artifactId: sampleArtifact.id } },
        },
      });
      expect(stale.isError).toBe(true);
      expect(stale.content?.[0]?.text).toContain('not allowed');

      const revokeSource = await browser.$(`[data-testid="mcp-data-file-${sampleArtifact.id}"] button`);
      await revokeSource.click();
      const revokeResults = await browser.$('[data-testid="mcp-results-toggle"]');
      await revokeResults.click();
      await browser.waitUntil(
        async () => browser.execute(async (artifactId) => {
          const status = await window.Liatir.desktop.mcp.status();
          return !status.readResults && !status.dataAllowlist.some((grant) => grant.artifactId === artifactId);
        }, sampleArtifact.id),
        { timeout: 20_000, timeoutMsg: 'MCP artifact permission revocation did not settle' },
      );
      await expect(client.readResource({ uri: 'liatir://results' })).rejects.toThrow();
      await expect(client.readResource({
        uri: `liatir://artifacts/${sampleArtifact.id}`,
      })).rejects.toThrow();
      const ownedResultAfterRevocation = resourcePayload(await client.readResource({
        uri: `liatir://runs/${first.runId}/result`,
      }));
      expect(ownedResultAfterRevocation.data.result.id).toBe(first.runId);

      const audit = await browser.execute(async () => window.Liatir.desktop.mcp.auditRecords());
      const actions = new Set(audit.map((record) => record.action));
      for (const action of [
        'server-enabled',
        'pipeline-allowed',
        'results-read-enabled',
        'results-read-disabled',
        'data-file-allowed',
        'data-file-revoked',
        'run-requested',
        'run-authorized',
        'run-denied',
        'run-started',
        'run-cancel-requested',
        'job-cancel-requested',
        'run-finished',
        'request-rejected',
        'resource-read',
      ]) {
        expect(actions.has(action)).toBe(true);
      }
      await expectNoVisibleRuntimeError(browser);
    } finally {
      if (externalOverride) fs.rmSync(externalOverride, { force: true });
      await client.close().catch(() => {});
      await browser.execute(async () => window.Liatir.desktop.mcp.setEnabled(false)).catch(() => {});
    }
  },
}];
