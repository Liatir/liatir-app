import { describe, expect, it, vi } from 'vitest';

import type { LiatirAIModelRecord, LiatirMcpPipelineInputDescriptor } from '@liatir/core';

vi.mock('$lib/tools/pipeline-registry', () => ({
  resolveStepEntry: (stepId: string) => {
    const definitions: Record<string, Record<string, unknown>> = {
      'fixture-tool': {
      id: 'fixture-tool',
      type: 'native-tool',
      label: 'Fixture Native Tool',
      description: 'Exercises the MCP input contract.',
      category: 'Native Tools',
      inputSchema: {
        text: { type: 'string', label: 'Text', required: true },
        count: { type: 'number', label: 'Count' },
        enabled: { type: 'boolean', label: 'Enabled' },
        file: { type: 'file', label: 'File', required: true, accept: ['fastq'] },
        connected: { type: 'string', label: 'Connected' },
      },
      outputSchema: {},
      },
      'fixture-ai-tool': {
        id: 'fixture-ai-tool',
        type: 'ai-tool',
        label: 'Fixture AI Tool',
        description: 'Selects a compatible installed AI Model.',
        category: 'AI Tools',
        modelInputKey: 'modelId',
        supportedModelIds: ['model-a'],
        supportedCapabilities: ['single-cell-embedding'],
        inputSchema: {
          modelId: { type: 'string', label: 'AI Model', required: true },
          prompt: { type: 'string', label: 'Prompt', required: false },
        },
        outputSchema: {},
      },
      'plugin:fixture': {
        id: 'plugin:fixture',
        type: 'lia-plugin',
        label: 'Fixture .lia Plugin',
        description: 'Exercises imported Plugin inputs.',
        category: 'Plugins',
        inputSchema: {
          pluginText: { type: 'string', label: 'Plugin text', required: true },
          pluginFile: { type: 'file', label: 'Plugin file', required: true, accept: ['txt'] },
        },
        outputSchema: {},
      },
      'external-workflow:fixture': {
        id: 'external-workflow:fixture',
        type: 'external-workflow',
        label: 'Fixture External Workflow',
        description: 'Exercises saved External Workflow inputs and parameters.',
        category: 'External Workflows',
        inputSchema: {
          workflowInput: { type: 'file', label: 'Workflow input', required: true, accept: ['csv'] },
          workflowFlag: { type: 'boolean', label: 'Workflow flag', required: false },
          workflowLimit: { type: 'number', label: 'Workflow limit', required: false },
        },
        outputSchema: {},
      },
      'viewer-fixture': {
        id: 'viewer-fixture',
        type: 'utility',
        label: 'Fixture Scientific Viewer',
        description: 'Exercises viewer inputs.',
        category: 'Visualization',
        inputSchema: {
          viewerFile: { type: 'file', label: 'Viewer file', required: true, accept: ['pdb'] },
          style: {
            type: 'string',
            label: 'Style',
            options: [{ value: 'cartoon', label: 'Cartoon' }, { value: 'stick', label: 'Stick' }],
          },
        },
        outputSchema: {},
      },
    };
    const definition = definitions[stepId];
    return definition ? { definition } : null;
  },
}));

vi.mock('$lib/stores/apiConnections.svelte', () => ({
  effectiveApiParameters: (request: { params: Array<{ key: string; enabled: boolean }> }, provider?: { sharedParams?: Array<{ key: string; enabled: boolean }> }) => {
    const merged = new Map((provider?.sharedParams ?? [])
      .filter((parameter) => parameter.enabled && parameter.key)
      .map((parameter) => [parameter.key, parameter]));
    for (const parameter of request.params) {
      if (parameter.enabled && parameter.key) merged.set(parameter.key, parameter);
      else if (parameter.key) merged.delete(parameter.key);
    }
    return [...merged.values()];
  },
  apiConnections: {
    requestById: (requestId: string) => requestId === 'request-1' ? {
      collectionId: 'collection-1',
      name: 'Fixture request',
      params: [
        { key: 'query', value: 'saved query', enabled: true, required: true, exposedAsInput: true },
        { key: 'fixed', value: 'hidden', enabled: true, required: true, exposedAsInput: false },
        { key: 'disabled', value: 'hidden', enabled: false, required: false, exposedAsInput: true },
      ],
    } : null,
    collectionById: (collectionId: string) => collectionId === 'collection-1' ? {
      sharedParams: [
        { key: 'locale', value: 'en', enabled: true, required: false, exposedAsInput: true },
        { key: 'token', value: 'hidden', enabled: true, required: true, exposedAsInput: false },
      ],
    } : null,
  },
}));

import {
  mcpPipelineInputSchema,
  resolveMcpPipelineInputs,
} from '../../frontend/src/lib/mcp/pipeline-inputs';

type PipelineShape = Parameters<typeof mcpPipelineInputSchema>[0];

const runnableAIModels = [{
  id: 'model-a',
  name: 'Model A',
  version: '1.0.0',
  runtime: { name: 'Runtime A' },
  modalities: ['single-cell-rna'],
  capabilities: ['single-cell-embedding'],
}, {
  id: 'model-b',
  name: 'Model B',
  version: '2.0.0',
  runtime: { name: 'Runtime B' },
  modalities: ['protein'],
  capabilities: ['protein-embedding'],
}] as unknown as LiatirAIModelRecord[];

function node(id: string, type: string, data: Record<string, unknown>) {
  return { id, type, position: { x: 0, y: 0 }, data };
}

function pipelines(): { root: PipelineShape; all: PipelineShape[] } {
  const nested = {
    id: 'nested',
    name: 'Nested',
    nodes: [node('nested-variable', 'variable', {
      varType: 'string',
      value: 'saved nested value',
      label: 'Nested value',
    })],
  } as PipelineShape;
  const root = {
    id: 'root',
    name: 'Root',
    nodes: [
      node('tool', 'tool', {
        stepId: 'fixture-tool',
        label: 'Tool',
        inputs: {
          text: 'saved text',
          count: '1',
          enabled: 'false',
          file: '/saved/input.fastq',
          connected: '@pipe:upstream:value',
        },
      }),
      node('ai-tool', 'tool', {
        stepId: 'fixture-ai-tool',
        label: 'AI Tool',
        inputs: { modelId: 'model-a', prompt: 'saved prompt' },
      }),
      node('plugin', 'tool', {
        stepId: 'plugin:fixture',
        label: 'Plugin',
        inputs: { pluginText: 'saved plugin text', pluginFile: '/saved/plugin.txt' },
      }),
      node('workflow', 'tool', {
        stepId: 'external-workflow:fixture',
        label: 'External Workflow',
        inputs: {
          workflowInput: '/saved/workflow.csv',
          workflowFlag: 'false',
          workflowLimit: '5',
        },
      }),
      node('viewer', 'tool', {
        stepId: 'viewer-fixture',
        label: 'Viewer',
        inputs: { viewerFile: '/saved/structure.pdb', style: 'cartoon' },
      }),
      node('variable', 'variable', { varType: 'number', value: '2', label: 'Variable' }),
      node('math', 'math', { operation: '+', literalA: '3', literalB: '4', label: 'Math' }),
      node('condition', 'condition', {
        operator: 'greater-than',
        valueRef: '5',
        compareValue: '6',
        label: 'Condition',
      }),
      node('api', 'api-request', {
        requestId: 'request-1',
        requestName: 'Request',
        paramOverrides: {},
      }),
      node('sub', 'sub-pipeline', { pipelineId: 'nested', pipelineName: 'Nested' }),
      node('note', 'note', { text: 'Not executable input data' }),
    ],
  } as PipelineShape;
  return { root, all: [root, nested] };
}

function reorderObjectKeys(
  descriptors: LiatirMcpPipelineInputDescriptor[],
): LiatirMcpPipelineInputDescriptor[] {
  return descriptors.map((descriptor) => Object.fromEntries(
    Object.entries(descriptor).reverse(),
  ) as unknown as LiatirMcpPipelineInputDescriptor);
}

describe('MCP pipeline inputs', () => {
  it('declares every client-settable runtime input while keeping connections and fixed values internal', () => {
    const { root, all } = pipelines();
    const schema = mcpPipelineInputSchema(root, all, runnableAIModels);

    expect(schema.map((input) => input.id)).toEqual([
      'tool:node-input:text',
      'tool:node-input:count',
      'tool:node-input:enabled',
      'tool:node-input:file',
      'ai-tool:node-input:modelId',
      'ai-tool:node-input:prompt',
      'plugin:node-input:pluginText',
      'plugin:node-input:pluginFile',
      'workflow:node-input:workflowInput',
      'workflow:node-input:workflowFlag',
      'workflow:node-input:workflowLimit',
      'viewer:node-input:viewerFile',
      'viewer:node-input:style',
      'variable:variable:value',
      'math:node-input:literalA',
      'math:node-input:literalB',
      'condition:node-input:valueRef',
      'condition:node-input:compareValue',
      'api:api-parameter:locale',
      'api:api-parameter:query',
      'sub/nested-variable:variable:value',
    ]);
    expect(schema.map((input) => input.type)).toEqual([
      'string', 'number', 'boolean', 'file',
      'string', 'string',
      'string', 'file',
      'file', 'boolean', 'number',
      'file', 'string',
      'number', 'number', 'number', 'string', 'number',
      'string', 'string', 'string',
    ]);
    expect(schema.find((input) => input.id === 'ai-tool:node-input:modelId')?.options).toEqual([{
      value: 'model-a',
      label: 'Model A',
      description: 'Version 1.0.0 · Runtime A · single-cell-rna',
    }]);
    expect(schema.some((input) => input.fieldKey === 'connected')).toBe(false);
    expect(schema.some((input) => input.fieldKey === 'fixed' || input.fieldKey === 'token')).toBe(false);
  });

  it('accepts a Rust-reordered descriptor snapshot and resolves typed values and artifacts', () => {
    const { root, all } = pipelines();
    const schema = mcpPipelineInputSchema(root, all, runnableAIModels);
    const resolved = resolveMcpPipelineInputs(root, all, reorderObjectKeys(schema), {
      'tool:node-input:text': 'new text',
      'tool:node-input:count': 7,
      'tool:node-input:enabled': true,
      'tool:node-input:file': { artifactId: 'source-fastq' },
      'ai-tool:node-input:modelId': 'model-a',
      'ai-tool:node-input:prompt': 'new prompt',
      'plugin:node-input:pluginText': 'new plugin text',
      'workflow:node-input:workflowFlag': true,
      'workflow:node-input:workflowLimit': 12,
      'viewer:node-input:style': 'stick',
      'variable:variable:value': 8,
      'math:node-input:literalA': 9,
      'math:node-input:literalB': 10,
      'condition:node-input:valueRef': '11',
      'condition:node-input:compareValue': 12,
      'api:api-parameter:locale': 'it',
      'api:api-parameter:query': 'new query',
      'sub/nested-variable:variable:value': 'new nested value',
    }, [{
      id: 'source-fastq',
      name: 'source.fastq',
      path: '/allowed/source.fastq',
      ext: 'fastq',
      addedAt: 0,
      folder: 'Inputs',
    }], runnableAIModels);

    expect(resolved.nodeInputs.get('tool')).toEqual({
      text: 'new text',
      count: '7',
      enabled: 'true',
      file: '/allowed/source.fastq',
    });
    expect(resolved.nodeInputs.get('ai-tool')).toEqual({ modelId: 'model-a', prompt: 'new prompt' });
    expect(resolved.nodeInputs.get('plugin')).toEqual({ pluginText: 'new plugin text' });
    expect(resolved.nodeInputs.get('workflow')).toEqual({ workflowFlag: 'true', workflowLimit: '12' });
    expect(resolved.nodeInputs.get('viewer')).toEqual({ style: 'stick' });
    expect(resolved.variables).toEqual(new Map([
      ['variable', '8'],
      ['sub/nested-variable', 'new nested value'],
    ]));
    expect(resolved.nodeInputs.get('math')).toEqual({ literalA: '9', literalB: '10' });
    expect(resolved.nodeInputs.get('condition')).toEqual({ valueRef: '11', compareValue: '12' });
    expect(resolved.apiParameters.get('api')).toEqual({ locale: 'it', query: 'new query' });
  });

  it('rejects an AI Model that is not in the compatible installed option set', () => {
    const { root, all } = pipelines();
    const schema = mcpPipelineInputSchema(root, all, runnableAIModels);
    expect(() => resolveMcpPipelineInputs(root, all, schema, {
      'ai-tool:node-input:modelId': 'model-b',
    }, [], runnableAIModels)).toThrow('model-b is not an allowed value for AI Model.');
  });

  it('rejects a semantic descriptor change even when the supplied values remain valid', () => {
    const { root, all } = pipelines();
    const schema = mcpPipelineInputSchema(root, all, runnableAIModels).map((input, index) => (
      index === 0 ? { ...input, required: false } : input
    ));

    expect(() => resolveMcpPipelineInputs(root, all, schema, {}, [], runnableAIModels)).toThrow(
      'The pipeline input contract changed after it was allowed for MCP.',
    );
  });
});
