import type { Node } from '@xyflow/svelte';
import {
  checkLiatirArtifactCompatibility,
  type LiatirAIModelRecord,
  type LiatirMcpPipelineInputDescriptor,
  type LiatirMcpPipelineInputs,
  type LiatirMcpPipelineInputValue,
} from '@liatir/core';
import { resolveStepEntry } from '$lib/tools/pipeline-registry';
import type {
  ApiRequestNodeData,
  ConditionNodeData,
  MathNodeData,
  SubPipelineNodeData,
  ToolNodeData,
  VariableNodeData,
} from '$lib/types/pipeline';
import { apiConnections } from '$lib/stores/apiConnections.svelte';
import type { DataFile } from '$lib/stores/dataFiles.svelte';
import { conditionNeedsCompareValue } from '$lib/pipeline/conditions';
import { aiModelInputOptions } from '$lib/ai/tool-models';

interface SavedPipelineShape {
  id: string;
  name: string;
  nodes: Node[];
}

interface InputTarget {
  descriptor: LiatirMcpPipelineInputDescriptor;
  savedValue?: unknown;
  defaultValue?: unknown;
}

export interface ResolvedMcpPipelineInputs {
  nodeInputs: Map<string, Record<string, string>>;
  variables: Map<string, string>;
  apiParameters: Map<string, Record<string, string>>;
}

function qualifiedNodeId(prefix: string, nodeId: string): string {
  return prefix ? `${prefix}/${nodeId}` : nodeId;
}

function inputId(nodeId: string, source: LiatirMcpPipelineInputDescriptor['source'], key: string): string {
  return `${nodeId}:${source}:${key}`;
}

function nodeLabel(node: Node, fallback: string, prefix: string): string {
  const own = String(node.data?.label ?? '').trim() || fallback;
  return prefix ? `${prefix} / ${own}` : own;
}

function isConnected(value: unknown): boolean {
  return typeof value === 'string' && value.startsWith('@pipe:');
}

const BINARY_MATH_OPERATIONS = new Set(['+', '-', '*', '/', '%', '^', 'mod', 'min', 'max']);

function collectTargets(
  pipeline: SavedPipelineShape,
  pipelines: SavedPipelineShape[],
  runnableAIModels: LiatirAIModelRecord[],
  prefix = '',
  labelPrefix = '',
  stack: string[] = [],
): InputTarget[] {
  if (stack.includes(pipeline.id)) return [];
  const nextStack = [...stack, pipeline.id];
  const targets: InputTarget[] = [];

  for (const node of pipeline.nodes) {
    const qualifiedId = qualifiedNodeId(prefix, node.id);

    if (node.type === 'tool') {
      const data = node.data as unknown as ToolNodeData;
      const definition = resolveStepEntry(data.stepId)?.definition;
      if (!definition) continue;
      for (const [fieldKey, field] of Object.entries(definition.inputSchema)) {
        const savedValue = data.inputs?.[fieldKey];
        if (isConnected(savedValue)) continue;
        const modelOptions = aiModelInputOptions(definition, fieldKey, runnableAIModels);
        const options = modelOptions ?? field.options?.map((option) => ({ ...option }));
        targets.push({
          descriptor: {
            id: inputId(qualifiedId, 'node-input', fieldKey),
            nodeId: qualifiedId,
            nodeLabel: nodeLabel(node, definition.label, labelPrefix),
            fieldKey,
            label: field.label ?? fieldKey,
            type: field.type,
            required: field.required ?? false,
            source: 'node-input',
            ...(field.description ? { description: field.description } : {}),
            ...(field.accept ? { accept: [...field.accept] } : {}),
            ...(options !== undefined ? { options } : {}),
            ...(field.artifact ? { artifact: field.artifact } : {}),
          },
          savedValue,
          defaultValue: field.default,
        });
      }
      continue;
    }

    if (node.type === 'variable') {
      const data = node.data as unknown as VariableNodeData;
      targets.push({
        descriptor: {
          id: inputId(qualifiedId, 'variable', 'value'),
          nodeId: qualifiedId,
          nodeLabel: nodeLabel(node, 'Variable', labelPrefix),
          fieldKey: 'value',
          label: 'Value',
          type: data.varType === 'number' ? 'number' : 'string',
          required: false,
          source: 'variable',
        },
        savedValue: data.value,
      });
      continue;
    }

    if (node.type === 'math') {
      const data = node.data as unknown as MathNodeData;
      const fields = [
        { key: 'literalA', label: 'Operand A', value: data.literalA },
        ...(BINARY_MATH_OPERATIONS.has(data.operation)
          ? [{ key: 'literalB', label: 'Operand B', value: data.literalB }]
          : []),
      ];
      for (const field of fields) {
        if (isConnected(field.value)) continue;
        targets.push({
          descriptor: {
            id: inputId(qualifiedId, 'node-input', field.key),
            nodeId: qualifiedId,
            nodeLabel: nodeLabel(node, 'Math', labelPrefix),
            fieldKey: field.key,
            label: field.label,
            type: 'number',
            required: false,
            source: 'node-input',
          },
          savedValue: field.value,
          defaultValue: 0,
        });
      }
      continue;
    }

    if (node.type === 'condition') {
      const data = node.data as unknown as ConditionNodeData;
      if (!isConnected(data.valueRef)) {
        targets.push({
          descriptor: {
            id: inputId(qualifiedId, 'node-input', 'valueRef'),
            nodeId: qualifiedId,
            nodeLabel: nodeLabel(node, 'Condition', labelPrefix),
            fieldKey: 'valueRef',
            label: 'Value to test',
            type: 'string',
            required: false,
            source: 'node-input',
          },
          savedValue: data.valueRef,
        });
      }
      if (conditionNeedsCompareValue(data.operator)) {
        const numeric = data.operator === 'greater-than' || data.operator === 'greater-or-equal' ||
          data.operator === 'less-than' || data.operator === 'less-or-equal';
        targets.push({
          descriptor: {
            id: inputId(qualifiedId, 'node-input', 'compareValue'),
            nodeId: qualifiedId,
            nodeLabel: nodeLabel(node, 'Condition', labelPrefix),
            fieldKey: 'compareValue',
            label: 'Compare with',
            type: numeric ? 'number' : 'string',
            required: true,
            source: 'node-input',
          },
          savedValue: data.compareValue,
        });
      }
      continue;
    }

    if (node.type === 'api-request') {
      const data = node.data as unknown as ApiRequestNodeData;
      const request = data.requestId ? apiConnections.requestById(data.requestId) : null;
      if (!request) continue;
      const provider = apiConnections.collectionById(request.collectionId);
      const parameters = new Map(
        (provider?.sharedParams ?? [])
          .filter((parameter) => parameter.enabled && parameter.key)
          .map((parameter) => [parameter.key, parameter] as const),
      );
      for (const parameter of request.params) {
        if (parameter.enabled && parameter.key) parameters.set(parameter.key, parameter);
      }
      for (const parameter of parameters.values()) {
        if (parameter.private) continue;
        const savedValue = data.paramOverrides?.[parameter.key] ?? parameter.value;
        if (isConnected(savedValue)) continue;
        targets.push({
          descriptor: {
            id: inputId(qualifiedId, 'api-parameter', parameter.key),
            nodeId: qualifiedId,
            nodeLabel: nodeLabel(node, data.requestName || request.name, labelPrefix),
            fieldKey: parameter.key,
            label: parameter.key,
            type: 'string',
            required: !parameter.optional,
            source: 'api-parameter',
          },
          savedValue,
        });
      }
      continue;
    }

    if (node.type === 'sub-pipeline') {
      const data = node.data as unknown as SubPipelineNodeData;
      const nested = data.pipelineId
        ? pipelines.find((candidate) => candidate.id === data.pipelineId)
        : null;
      if (!nested) continue;
      targets.push(...collectTargets(
        nested,
        pipelines,
        runnableAIModels,
        qualifiedId,
        nodeLabel(node, nested.name, labelPrefix),
        nextStack,
      ));
    }
  }

  return targets;
}

export function mcpPipelineInputSchema(
  pipeline: SavedPipelineShape,
  pipelines: SavedPipelineShape[],
  runnableAIModels: LiatirAIModelRecord[] = [],
): LiatirMcpPipelineInputDescriptor[] {
  return collectTargets(pipeline, pipelines, runnableAIModels).map((target) => target.descriptor);
}

function isArtifactInput(value: LiatirMcpPipelineInputValue): value is { artifactId: string } {
  return typeof value === 'object' && value !== null &&
    !Array.isArray(value) && Object.keys(value).length === 1 &&
    typeof value.artifactId === 'string' && value.artifactId.trim().length > 0;
}

function scalarValue(
  descriptor: LiatirMcpPipelineInputDescriptor,
  value: LiatirMcpPipelineInputValue,
): string {
  if (descriptor.type === 'string') {
    if (typeof value !== 'string') throw new Error(`${descriptor.label} must be a string.`);
    if (value.startsWith('@pipe:')) {
      throw new Error(`${descriptor.label} cannot create a new pipeline connection.`);
    }
    return value;
  }
  if (descriptor.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`${descriptor.label} must be a finite number.`);
    }
    return String(value);
  }
  if (descriptor.type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${descriptor.label} must be true or false.`);
    return String(value);
  }
  throw new Error(`${descriptor.label} must reference an allowed artifact.`);
}

function resolveArtifact(
  descriptor: LiatirMcpPipelineInputDescriptor,
  value: LiatirMcpPipelineInputValue,
  files: DataFile[],
): string {
  if (!isArtifactInput(value)) {
    throw new Error(`${descriptor.label} must use an artifactId returned by Liatir.`);
  }
  const file = files.find((candidate) => candidate.id === value.artifactId);
  if (!file || file.missing) throw new Error(`${descriptor.label} references an unavailable artifact.`);
  if (descriptor.accept?.length && !descriptor.accept.some((extension) =>
    extension.replace(/^\./, '').toLowerCase() === file.ext.replace(/^\./, '').toLowerCase()
  )) {
    throw new Error(`${file.name} is not an accepted file type for ${descriptor.label}.`);
  }
  if (descriptor.artifact) {
    const compatibility = checkLiatirArtifactCompatibility(file.scientific, descriptor.artifact);
    if (compatibility.status === 'incompatible') {
      throw new Error(compatibility.diagnostics[0]?.message ?? `${file.name} is scientifically incompatible.`);
    }
  }
  return file.path;
}

function emptyValue(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, nested) => {
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) return nested;
    return Object.fromEntries(
      Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)),
    );
  });
}

export function resolveMcpPipelineInputs(
  pipeline: SavedPipelineShape,
  pipelines: SavedPipelineShape[],
  expectedSchema: LiatirMcpPipelineInputDescriptor[],
  supplied: LiatirMcpPipelineInputs,
  files: DataFile[],
  runnableAIModels: LiatirAIModelRecord[] = [],
): ResolvedMcpPipelineInputs {
  const targets = collectTargets(pipeline, pipelines, runnableAIModels);
  const currentSchema = targets.map((target) => target.descriptor);
  // Rust reserializes the approved descriptor snapshot in struct-field order.
  // Object-key order is not contract data; input and option array order is.
  if (canonicalJson(currentSchema) !== canonicalJson(expectedSchema)) {
    throw new Error('The pipeline input contract changed after it was allowed for MCP.');
  }

  const byId = new Map(targets.map((target) => [target.descriptor.id, target]));
  for (const id of Object.keys(supplied)) {
    if (!byId.has(id)) throw new Error(`Unknown pipeline input: ${id}`);
  }

  const resolved: ResolvedMcpPipelineInputs = {
    nodeInputs: new Map(),
    variables: new Map(),
    apiParameters: new Map(),
  };
  for (const target of targets) {
    const { descriptor } = target;
    const suppliedValue = supplied[descriptor.id];
    let value: string | undefined;
    if (suppliedValue !== undefined) {
      value = descriptor.type === 'file'
        ? resolveArtifact(descriptor, suppliedValue, files)
        : scalarValue(descriptor, suppliedValue);
      if (descriptor.options !== undefined && !descriptor.options.some((option) => option.value === value)) {
        throw new Error(`${value} is not an allowed value for ${descriptor.label}.`);
      }
    }

    const effective = value ?? target.savedValue ?? target.defaultValue;
    if (descriptor.required && emptyValue(effective)) {
      throw new Error(`Missing required pipeline input: ${descriptor.nodeLabel} / ${descriptor.label}.`);
    }
    if (value === undefined) continue;

    if (descriptor.source === 'variable') {
      resolved.variables.set(descriptor.nodeId, value);
    } else {
      const destination = descriptor.source === 'api-parameter'
        ? resolved.apiParameters
        : resolved.nodeInputs;
      destination.set(descriptor.nodeId, {
        ...(destination.get(descriptor.nodeId) ?? {}),
        [descriptor.fieldKey]: value,
      });
    }
  }
  return resolved;
}
